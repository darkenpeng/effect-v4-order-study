import { Effect } from "effect"
import { withAddressTimeout, type Dependencies10 } from "./10-errors.js"
import { type Dependencies9 } from "./09-pipeline.js"
import {
  AddressLookupError, PricingError,
  type SendResult, type UnvalidatedAddress, type UnvalidatedOrder,
} from "./domain.js"
import { layerFromFunctions } from "./services.js"

export const sampleOrder: UnvalidatedOrder = {
  orderId: "ORDER-001",
  customer: { name: "Kim", email: "kim@example.com" },
  shippingAddress: { line1: "1 Sample Road", city: "Seoul", zipCode: "01234" },
  billingAddress: { line1: "2 Sample Road", city: "Busan", zipCode: "12345" },
  lines: [
    { lineId: "L1", productCode: "W0001", quantity: 2 },
    { lineId: "L2", productCode: "W0002", quantity: 1 },
  ],
}
export const badOrder: UnvalidatedOrder = {
  ...sampleOrder,
  lines: [sampleOrder.lines[0]!, { lineId: "L2", productCode: "W0002", quantity: 0 }],
}
export type FixtureOptions = {
  readonly addressMode?: "success" | "notFound" | "unavailable" | "malformed" | "never"
  readonly addressDelayMs?: number
  readonly addressTimeoutMs?: number
  readonly acknowledgment?: SendResult
  readonly prices?: Readonly<Record<string, number>>
}

// 9.7: 테스트마다 독립적인 함수 구현과 관찰 기록을 만든다.
export const makeHarness = (options: FixtureOptions = {}) => {
  const trace: string[] = []
  const prices = options.prices ?? { W0001: 1200, W0002: 3500 }
  const products = new Set(["W0001", "W0002"])
  const checkProduct: Dependencies9["checkProduct"] = (code) => {
    trace.push(`product:${code}`)
    return products.has(code)
  }
  const addressResult = (address: UnvalidatedAddress): UnvalidatedAddress => {
    if (options.addressMode === "notFound") {
      throw new AddressLookupError({ reason: "NotFound", message: "주소 없음" })
    }
    if (options.addressMode === "unavailable") {
      throw new AddressLookupError({ reason: "Unavailable", message: "주소 서비스 사용 불가" })
    }
    trace.push(`address:ok:${address.city}`)
    return { ...address, line1: address.line1.trim(), zipCode: options.addressMode === "malformed" ? "?" : address.zipCode }
  }
  const getPrice: Dependencies9["getPrice"] = (code) => {
    trace.push(`price:${code}`)
    const price = prices[code]
    if (price === undefined) throw new PricingError({ message: `가격 없음: ${code}` })
    return price
  }
  const sendAcknowledgment: Dependencies9["sendAcknowledgment"] = (ack) => {
    trace.push(`ack:${ack.email}`)
    return options.acknowledgment ?? "Sent"
  }
  const createLetter: Dependencies9["createLetter"] = (order) => `주문 ${order.orderId}, 합계 ${order.amountToBill}원`
  const dependencies9: Dependencies9 = {
    checkProduct, getPrice, createLetter, sendAcknowledgment,
    checkAddress: (address) => {
      trace.push(`address:start:${address.city}`)
      if (options.addressMode === "never") throw new Error("9장 동기 버전에는 무한 대기를 사용하지 않습니다")
      return addressResult(address)
    },
  }

  // 실행 전에는 trace가 바뀌지 않는다. 동기 가짜 외부 함수도 try/sync 안에서 호출한다.
  const addressEffect: Dependencies10["checkAddress"] = (address) => Effect.gen(function*() {
    yield* Effect.sync(() => trace.push(`address:start:${address.city}`))
    if (options.addressMode === "never") return yield* Effect.never
    yield* Effect.sleep(options.addressDelayMs ?? 0)
    return yield* Effect.try({
      try: () => addressResult(address),
      catch: (cause) => cause instanceof AddressLookupError
        ? cause : new AddressLookupError({ reason: "Unavailable", message: String(cause) }),
    })
  }).pipe(Effect.onInterrupt(() => Effect.sync(() => trace.push(`address:cancelled:${address.city}`))))

  const dependencies10: Dependencies10 = {
    checkProduct: (code) => Effect.sync(() => checkProduct(code)),
    checkAddress: options.addressTimeoutMs === undefined
      ? addressEffect : withAddressTimeout(addressEffect, options.addressTimeoutMs),
    getPrice: (code) => Effect.try({
      try: () => getPrice(code),
      catch: (cause) => cause instanceof PricingError ? cause : new PricingError({ message: String(cause) }),
    }),
    createLetter,
    sendAcknowledgment: (ack) => Effect.sync(() => sendAcknowledgment(ack)),
  }
  return { dependencies9, dependencies10, layer: layerFromFunctions(dependencies10), trace }
}
