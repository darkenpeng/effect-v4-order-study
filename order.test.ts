import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Result } from "effect"
import { invalidOrder, makeTestDependencies, validOrder } from "./fixtures.js"
import { priceOrder, validateAndPrice, type UnvalidatedOrder } from "./order.js"

const run = async (
  input: UnvalidatedOrder,
  prices?: Readonly<Record<string, number>>,
) => {
  const dependencies = makeTestDependencies(prices)
  const result = await Effect.runPromise(validateAndPrice(input).pipe(
    Effect.provide(dependencies.layer),
    Effect.result,
  ))
  return { result, priceLookups: dependencies.priceLookups }
}

test("정상 주문: 행별 금액과 합계 계산", async () => {
  const { result, priceLookups } = await run(validOrder)
  assert.ok(Result.isSuccess(result))
  assert.equal(result.success.orderId, "ORDER-001")
  assert.deepEqual(result.success.lines.map((line) => line.linePrice), [2400, 3500])
  assert.equal(result.success.amountToBill, 5900)
  assert.deepEqual(priceLookups, ["W0001", "W0002"])
})

test("두 번째 행의 수량이 잘못되어도 첫 번째 행 가격조차 조회하지 않음", async () => {
  const { result, priceLookups } = await run(invalidOrder)
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure._tag, "ValidationError")
  assert.equal(result.failure.reason, "InvalidFields")
  assert.deepEqual(priceLookups, [])
})

test("형식은 맞지만 등록되지 않은 상품도 검증 단계에서 차단", async () => {
  const { result, priceLookups } = await run({
    ...validOrder,
    lines: [...validOrder.lines, { productCode: "W9999", quantity: 1 }],
  })
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure._tag, "ValidationError")
  assert.equal(result.failure.reason, "UnknownProduct")
  assert.deepEqual(priceLookups, [])
})

test("검증 이후의 가격 누락은 PricingError로 구분하고 후속 조회를 멈춤", async () => {
  const { result, priceLookups } = await run(validOrder, {})
  assert.ok(Result.isFailure(result))
  assert.equal(result.failure._tag, "PricingError")
  assert.equal(result.failure.reason, "PriceUnavailable")
  assert.deepEqual(priceLookups, ["W0001"])
})

test("잘못된 외부 가격 또는 계산 결과를 성공으로 내보내지 않음", async () => {
  for (const price of [-1, Number.NaN, 0.5, Number.MAX_SAFE_INTEGER]) {
    const { result } = await run(validOrder, { W0001: price, W0002: 3500 })
    assert.ok(Result.isFailure(result))
    assert.equal(result.failure._tag, "PricingError")
    assert.equal(result.failure.reason, "InvalidAmount")
  }
})

// tsc가 이 오류를 계속 감지하는지도 확인한다. 함수는 실행하지 않는다.
const typecheckOnly = (input: UnvalidatedOrder) => {
  // @ts-expect-error 검증 전 주문은 가격 계산의 입력이 될 수 없다.
  priceOrder(input)
}
void typecheckOnly
