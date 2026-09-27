import { Effect, Result } from "effect"
import { makePlaceOrder9 } from "./09-pipeline.js"
import { doubledQuantity, makePlaceOrderFlatMap, makePlaceOrderGen, quantityResult } from "./10-errors.js"
import { badOrder, makeHarness, sampleOrder, type FixtureOptions } from "./fixtures.js"
import { placeOrderService } from "./services.js"
import { type PlaceOrderError, type PlaceOrderEvent, type UnvalidatedOrder } from "./domain.js"

const summarize = (events: ReadonlyArray<PlaceOrderEvent>) => ({
  events: events.map((event) => event._tag),
  amount: events.find((event) => event._tag === "OrderPlaced")?.order.amountToBill,
})
const show = async (
  title: string,
  effect: Effect.Effect<ReadonlyArray<PlaceOrderEvent>, PlaceOrderError>,
  trace: string[],
) => {
  const result = await Effect.runPromise(effect.pipe(Effect.result))
  console.log(title, Result.match(result, {
    onSuccess: (events) => ({ status: "Success", ...summarize(events) }),
    onFailure: (error) => ({ status: "Failure", stage: error.stage, cause: error.cause._tag }),
  }))
  console.log("호출 순서:", trace)
}
const serviceScenario = async (title: string, options: FixtureOptions, input: UnvalidatedOrder = sampleOrder) => {
  const harness = makeHarness(options)
  await show(title, placeOrderService(input).pipe(Effect.provide(harness.layer)), harness.trace)
}

const labs: Record<string, () => Promise<void>> = {
  "9": async () => {
    const harness = makeHarness()
    const events = makePlaceOrder9(harness.dependencies9)(sampleOrder)
    console.log("9.1~9.9 | 동기 함수 조립", summarize(events))
    console.log("호출 순서:", harness.trace)
  },
  di: async () => {
    const byFunction = makeHarness()
    await show("9.6~9.7 | 함수 주입", makePlaceOrderGen(byFunction.dependencies10)(sampleOrder), byFunction.trace)
    await serviceScenario("9.6~9.7 | 서비스 주입", {})
  },
  errors: async () => {
    await serviceScenario("10.1~10.4 | 잘못된 수량", {}, badOrder)
    await serviceScenario("10.2 | 주소 없음", { addressMode: "notFound" })
    await serviceScenario("10.2 | 주소 서비스 장애", { addressMode: "unavailable" })
    await serviceScenario("10.3.4 | 가격 없음", { prices: {} })
    await serviceScenario("9.4.1 | 통지 실패 후에도 주문 완료", { acknowledgment: "NotSent" })
  },
  composition: async () => {
    const flatMap = makeHarness()
    const gen = makeHarness()
    await show("10.4 | flatMap/map", makePlaceOrderFlatMap(flatMap.dependencies10)(sampleOrder), flatMap.trace)
    await show("10.6 | Effect.gen", makePlaceOrderGen(gen.dependencies10)(sampleOrder), gen.trace)
    console.log("10.3 | 600을 두 배로 만든 뒤 수량 재검증:", doubledQuantity(600)._tag)
    console.log("10.3 | map으로 실패 가능한 함수를 연결하면:", quantityResult(600).pipe(
      Result.map((quantity) => quantityResult(quantity * 2)),
      Result.match({ onSuccess: (inner) => `바깥 Success / 안쪽 ${inner._tag}`, onFailure: () => "Failure" }),
    ))
  },
  async: async () => {
    await serviceScenario("10.8 | 지연 후 성공", { addressDelayMs: 20 })
    await serviceScenario("10.8 | 지연 후 실패", { addressDelayMs: 20, addressMode: "unavailable" })
    await serviceScenario("10.8 | 시간 초과", { addressMode: "never", addressTimeoutMs: 10 })
  },
}

const selected = process.argv[2]
if (selected === undefined) {
  for (const lab of Object.values(labs)) await lab()
} else {
  const lab = labs[selected]
  if (lab === undefined) throw new Error(`실험 이름: ${Object.keys(labs).join(", ")}`)
  await lab()
}
