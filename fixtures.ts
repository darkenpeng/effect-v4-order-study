import { Effect, Layer } from "effect"
import {
  CheckProductCodeExists,
  GetProductPrice,
  PricingError,
  type UnvalidatedOrder,
} from "./order.js"

export const validOrder: UnvalidatedOrder = {
  orderId: "ORDER-001",
  lines: [
    { productCode: "W0001", quantity: 2 },
    { productCode: "W0002", quantity: 1 },
  ],
}

// 첫 번째 항목은 정상이어도 뒤 항목이 잘못되면 주문 전체의 가격 계산을 멈춘다.
export const invalidOrder: UnvalidatedOrder = {
  orderId: "ORDER-002",
  lines: [
    { productCode: "W0001", quantity: 2 },
    { productCode: "W0002", quantity: 0 },
  ],
}

export const makeTestDependencies = (
  priceTable: Readonly<Record<string, number>> = { W0001: 1200, W0002: 3500 },
) => {
  const priceLookups: string[] = []
  const registeredProducts = new Set(["W0001", "W0002"])

  const layer = Layer.mergeAll(
    Layer.succeed(CheckProductCodeExists, {
      check: (code) => Effect.sync(() => registeredProducts.has(code)),
    }),
    Layer.succeed(GetProductPrice, {
      get: (code) => Effect.gen(function*() {
        // 프로그램을 만들 때가 아니라, 가격 조회 Effect가 실행될 때 기록한다.
        priceLookups.push(code)
        const price = priceTable[code]
        if (price === undefined) {
          return yield* Effect.fail(new PricingError({
            reason: "PriceUnavailable",
            message: `가격을 조회할 수 없는 상품: ${code}`,
          }))
        }
        return price
      }),
    }),
  )

  return { layer, priceLookups }
}
