import { Effect, Result } from "effect"
import { invalidOrder, makeTestDependencies, validOrder } from "./fixtures.js"
import { validateAndPrice } from "./order.js"

for (const [name, input] of [
  ["정상 주문", validOrder],
  ["잘못된 주문 (두 번째 상품의 수량이 0)", invalidOrder],
] as const) {
  const dependencies = makeTestDependencies()
  const result = await Effect.runPromise(
    validateAndPrice(input).pipe(
      Effect.provide(dependencies.layer),
      Effect.result,
    ),
  )

  console.log(name)
  console.log(Result.match(result, {
    onSuccess: (order) => ({
      status: "Success",
      linePrices: order.lines.map((line) => line.linePrice),
      amountToBill: order.amountToBill,
    }),
    onFailure: (error) => ({ status: "Failure", error: error._tag, reason: error.reason }),
  }))
  console.log("가격 조회:", dependencies.priceLookups)
  console.log()
}
