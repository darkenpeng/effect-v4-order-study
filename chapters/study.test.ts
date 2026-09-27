import assert from "node:assert/strict"
import { test } from "node:test"
import { Deferred, Effect, Fiber, Result } from "effect"
import { TestClock } from "effect/testing"
import { makePlaceOrder9 } from "./09-pipeline.js"
import {
  addressFromPromise, checkAddressesParallel, doubledQuantity, makePlaceOrderFlatMap,
  makePlaceOrderGen, makePriceOrder10, observe, parseLegacyJson, quantityResult,
  validateLinesAll, validateLinesFirst, type Dependencies10,
} from "./10-errors.js"
import { badOrder, makeHarness, sampleOrder, type FixtureOptions } from "./fixtures.js"
import { placeOrderService } from "./services.js"
import { type UnvalidatedOrder } from "./domain.js"

const serviceRun = async (options: FixtureOptions = {}, input = sampleOrder) => {
  const harness = makeHarness(options)
  const result = await Effect.runPromise(placeOrderService(input).pipe(
    Effect.provide(harness.layer), Effect.result,
  ))
  return { result, trace: harness.trace }
}

test("9.8: 완성된 파이프라인은 합계와 세 이벤트를 만든다", () => {
  const harness = makeHarness()
  const events = makePlaceOrder9(harness.dependencies9)(sampleOrder)
  assert.deepEqual(events.map((event) => event._tag), ["OrderPlaced", "OrderAcknowledgmentSent", "BillableOrderPlaced"])
  assert.equal(events.find((event) => event._tag === "OrderPlaced")?.order.amountToBill, 5900)
  assert.deepEqual(harness.trace.slice(-3), ["price:W0001", "price:W0002", "ack:kim@example.com"])
})

test("9→10: 동기 구현과 Effect 구현의 정상 결과 및 호출 순서가 같다", async () => {
  const sync = makeHarness()
  const events = makePlaceOrder9(sync.dependencies9)(sampleOrder)
  const { result, trace } = await serviceRun()
  assert.ok(Result.isSuccess(result))
  assert.deepEqual(result.success, events)
  assert.deepEqual(trace, sync.trace)
})

test("9.6/10.4/10.6: 함수 flatMap, 함수 gen, 서비스 gen이 같은 결과를 만든다", async () => {
  const flatMap = makeHarness()
  const gen = makeHarness()
  const services = await serviceRun()
  const a = await Effect.runPromise(makePlaceOrderFlatMap(flatMap.dependencies10)(sampleOrder))
  const b = await Effect.runPromise(makePlaceOrderGen(gen.dependencies10)(sampleOrder))
  assert.ok(Result.isSuccess(services.result))
  assert.deepEqual(a, b)
  assert.deepEqual(b, services.result.success)
  assert.deepEqual(flatMap.trace, gen.trace)
  assert.deepEqual(gen.trace, services.trace)
})

test("10.1: 프로그램을 만드는 것만으로 외부 호출을 시작하지 않는다", () => {
  const harness = makeHarness()
  makePlaceOrderGen(harness.dependencies10)(sampleOrder)
  placeOrderService(sampleOrder).pipe(Effect.provide(harness.layer))
  assert.deepEqual(harness.trace, [])
})

test("10.2: 두 번째 항목의 오류가 있으면 주소/가격/통지를 호출하지 않는다", async () => {
  const { result, trace } = await serviceRun({}, badOrder)
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure.stage, "validation")
  assert.equal(result.failure.cause._tag, "ValidationError")
  assert.deepEqual(trace, [])
})

test("9.3.3: 미등록 상품은 가격 계산 전 거절한다", async () => {
  const { result, trace } = await serviceRun({}, {
    ...sampleOrder, lines: [{ lineId: "L1", productCode: "W9999", quantity: 1 }],
  })
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure.cause._tag, "ValidationError")
  assert.deepEqual(trace, ["product:W9999"])
})

test("10.2.1: 주소 없음과 주소 서비스 장애는 다른 오류다", async () => {
  for (const [addressMode, tag] of [["notFound", "ValidationError"], ["unavailable", "AddressServiceError"]] as const) {
    const { result, trace } = await serviceRun({ addressMode })
    assert.ok(Result.isFailure(result))
    assert.equal(result.failure.cause._tag, tag)
    assert.equal(trace.some((entry) => entry.startsWith("price:") || entry.startsWith("ack:")), false)
  }
})

test("9.3.1: 외부 서비스가 반환한 주소도 값 제약을 검증한다", async () => {
  const { result, trace } = await serviceRun({ addressMode: "malformed" })
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure.cause._tag, "ValidationError")
  assert.equal(trace.some((entry) => entry.startsWith("price:")), false)
})

test("10.3.4: 가격 실패의 원인/단계를 보존하고 통지를 실행하지 않는다", async () => {
  const { result, trace } = await serviceRun({ prices: {} })
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure.stage, "pricing")
  assert.equal(result.failure.cause._tag, "PricingError")
  assert.equal(trace.at(-1), "price:W0001")
})

test("9.4.1: NotSent여도 주문과 청구 이벤트를 만든다", async () => {
  const { result } = await serviceRun({ acknowledgment: "NotSent" })
  assert.ok(Result.isSuccess(result))
  assert.deepEqual(result.success.map((event) => event._tag), ["OrderPlaced", "BillableOrderPlaced"])
})

test("9.4.2: 합계가 0이면 청구 이벤트를 만들지 않는다", async () => {
  const { result } = await serviceRun({ prices: { W0001: 0, W0002: 0 } })
  assert.ok(Result.isSuccess(result))
  assert.deepEqual(result.success.map((event) => event._tag), ["OrderPlaced", "OrderAcknowledgmentSent"])
})

test("10.4: map은 중첩 결과를 만들고 flatMap은 다음 실패를 전파한다", () => {
  const mapped = quantityResult(600).pipe(Result.map((quantity) => quantityResult(quantity * 2)))
  assert.ok(Result.isSuccess(mapped))
  assert.ok(Result.isFailure(mapped.success))
  assert.ok(Result.isFailure(doubledQuantity(600)))
})

test("10.5: 예외를 타입 오류로 바꾸고 void 관찰 함수는 원래 값을 보존한다", async () => {
  const failure = await Effect.runPromise(parseLegacyJson("{").pipe(Effect.result))
  assert.ok(Result.isFailure(failure))
  assert.equal(failure.failure._tag, "LegacyError")
  const observed: number[] = []
  const value = await Effect.runPromise(Effect.succeed(42).pipe(observe((n: number) => { observed.push(n) })))
  assert.equal(value, 42)
  assert.deepEqual(observed, [42])
})

test("10.6.5: 첫 실패 중단과 모든 항목 오류 수집은 실행 범위가 다르다", async () => {
  const lines = [
    { lineId: "L1", productCode: "W0001", quantity: 0 },
    { lineId: "L2", productCode: "W0002", quantity: -1 },
    { lineId: "L3", productCode: "W0001", quantity: 1 },
  ]
  const first = makeHarness()
  const all = makeHarness()
  const firstResult = await Effect.runPromise(validateLinesFirst(first.dependencies10.checkProduct, lines).pipe(Effect.result))
  const allResult = await Effect.runPromise(validateLinesAll(all.dependencies10.checkProduct, lines).pipe(Effect.result))
  assert.ok(Result.isFailure(firstResult))
  assert.ok(Result.isFailure(allResult))
  assert.equal(allResult.failure.length, 2)
  assert.deepEqual(allResult.failure.map((error) => error.field), ["lines[0]", "lines[1]"])
  assert.deepEqual(first.trace, [])
  assert.deepEqual(all.trace, ["product:W0001"])
})

test("10.7.1: 독립적인 두 주소 검증을 동시에 시작한다", { timeout: 2000 }, async () => {
  const started: string[] = []
  const program = Effect.gen(function*() {
    const bothStarted = yield* Deferred.make<void>()
    const check: Dependencies10["checkAddress"] = (address) => Effect.gen(function*() {
      started.push(address.city)
      if (started.length === 2) yield* Deferred.succeed(bothStarted, undefined)
      yield* Deferred.await(bothStarted)
      return address
    })
    return yield* checkAddressesParallel(check, sampleOrder)
  })
  const result = await Effect.runPromise(program)
  assert.deepEqual(new Set(started), new Set(["Seoul", "Busan"]))
  assert.equal(result.shippingAddress.city, "Seoul")
  assert.equal(result.billingAddress.city, "Busan")
})

test("10.8: Promise 어댑터는 지연 생성하며 rejection을 오류 채널로 보낸다", async () => {
  let calls = 0
  const check = addressFromPromise(async (_address, signal) => {
    calls++
    assert.ok(signal instanceof AbortSignal)
    throw new Error("offline")
  })
  const effect = check(sampleOrder.shippingAddress)
  assert.equal(calls, 0)
  const result = await Effect.runPromise(effect.pipe(Effect.result))
  assert.equal(calls, 1)
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure.reason, "Unavailable")
})

test("10.8: 가상 시계로 지연 성공/실패를 확인한다", { timeout: 2000 }, async () => {
  for (const addressMode of ["success", "unavailable"] as const) {
    const harness = makeHarness({ addressMode, addressDelayMs: 100 })
    const program = Effect.gen(function*() {
      const fiber = yield* makePlaceOrderGen(harness.dependencies10)(sampleOrder).pipe(Effect.result, Effect.forkChild)
      yield* TestClock.adjust(200)
      return yield* Fiber.join(fiber)
    }).pipe(Effect.provide(TestClock.layer()))
    const result = await Effect.runPromise(program)
    assert.equal(Result.isSuccess(result), addressMode === "success")
    assert.equal(harness.trace.some((entry) => entry.startsWith("price:")), addressMode === "success")
  }
})

test("10.8: 시간 초과가 대기를 취소하고 가격 계산을 막는다", { timeout: 2000 }, async () => {
  const harness = makeHarness({ addressMode: "never", addressTimeoutMs: 50 })
  const program = Effect.gen(function*() {
    const fiber = yield* makePlaceOrderGen(harness.dependencies10)(sampleOrder).pipe(Effect.result, Effect.forkChild)
    yield* TestClock.adjust(50)
    return yield* Fiber.join(fiber)
  }).pipe(Effect.provide(TestClock.layer()))
  const result = await Effect.runPromise(program)
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure.cause._tag, "AddressServiceError")
  if (result.failure.cause._tag === "AddressServiceError") assert.equal(result.failure.cause.reason, "Timeout")
  assert.ok(harness.trace.includes("address:cancelled:Seoul"))
  assert.equal(harness.trace.some((entry) => entry.startsWith("price:") || entry.startsWith("ack:")), false)
})

// 10.3.3: 컴파일러가 단계와 미공급 의존성을 확인하는 예시. 실행하지 않는다.
const typecheckOnly = (raw: UnvalidatedOrder) => {
  // @ts-expect-error 검증 전 주문을 가격 계산에 전달할 수 없다.
  makePriceOrder10(() => Effect.succeed(0))(raw)
  // @ts-expect-error 네 가지 서비스를 공급해야 실행할 수 있다.
  Effect.runPromise(placeOrderService(raw))
}
void typecheckOnly
