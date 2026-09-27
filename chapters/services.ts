import { Context, Effect, Layer } from "effect"
import {
  makeAcknowledgeOrder10, makePriceOrder10, makeValidateOrder10,
  pricingFailure, validationFailure, type Dependencies10,
} from "./10-errors.js"
import { createEvents, type PlaceOrderEvent, type PlaceOrderError, type UnvalidatedOrder, type ValidatedOrder } from "./domain.js"

// 9.6 비교 실험: 같은 함수 구현을 서비스로 공급한다. 기능별 의존성이 R에 남는다.
export class Products extends Context.Service<Products, {
  readonly check: Dependencies10["checkProduct"]
}>()("chapters/Products") {}
export class Addresses extends Context.Service<Addresses, {
  readonly check: Dependencies10["checkAddress"]
}>()("chapters/Addresses") {}
export class Prices extends Context.Service<Prices, {
  readonly get: Dependencies10["getPrice"]
}>()("chapters/Prices") {}
export class Acknowledgments extends Context.Service<Acknowledgments, {
  readonly createLetter: Dependencies10["createLetter"]
  readonly send: Dependencies10["sendAcknowledgment"]
}>()("chapters/Acknowledgments") {}

export const validateOrderService = (input: UnvalidatedOrder) => Effect.gen(function*() {
  const products = yield* Products
  const addresses = yield* Addresses
  return yield* makeValidateOrder10({ checkProduct: products.check, checkAddress: addresses.check })(input)
})
export const priceOrderService = (input: ValidatedOrder) =>
  Effect.gen(function*() {
    const prices = yield* Prices
    return yield* makePriceOrder10(prices.get)(input)
  })

export const placeOrderService = (
  input: UnvalidatedOrder,
): Effect.Effect<ReadonlyArray<PlaceOrderEvent>, PlaceOrderError, Products | Addresses | Prices | Acknowledgments> =>
  Effect.gen(function*() {
    const validated = yield* validateOrderService(input).pipe(Effect.mapError(validationFailure))
    const priced = yield* priceOrderService(validated).pipe(Effect.mapError(pricingFailure))
    const acknowledgments = yield* Acknowledgments
    const ack = yield* makeAcknowledgeOrder10({
      createLetter: acknowledgments.createLetter, sendAcknowledgment: acknowledgments.send,
    })(priced)
    return createEvents(priced, ack)
  })

// 실제 함수 구현은 동일하다. Layer의 생성 자체에는 외부 I/O가 없다.
export const layerFromFunctions = (dependencies: Dependencies10) => Layer.mergeAll(
  Layer.succeed(Products, { check: dependencies.checkProduct }),
  Layer.succeed(Addresses, { check: dependencies.checkAddress }),
  Layer.succeed(Prices, { get: dependencies.getPrice }),
  Layer.succeed(Acknowledgments, {
    createLetter: dependencies.createLetter, send: dependencies.sendAcknowledgment,
  }),
)
