import { Data, Option, Schema } from "effect"

// 9.1: 제약 검사는 Schema.check, 값의 구분은 brand가 담당한다.
const NonEmpty50 = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50))
export const OrderIdSchema = NonEmpty50.pipe(Schema.brand("OrderId"))
export const LineIdSchema = NonEmpty50.pipe(Schema.brand("OrderLineId"))
export const ProductCodeSchema = Schema.String.check(
  Schema.isPattern(/^W\d{4}$/),
).pipe(Schema.brand("ProductCode"))
export const QuantitySchema = Schema.Number.check(
  Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 1000 }),
).pipe(Schema.brand("Quantity"))
export const MoneySchema = Schema.Number.check(
  Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand("Money"))
export const CustomerSchema = Schema.Struct({
  name: NonEmpty50,
  email: Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)),
})
export const AddressSchema = Schema.Struct({
  line1: NonEmpty50,
  city: NonEmpty50,
  zipCode: Schema.String.check(Schema.isPattern(/^\d{5}$/)),
})
export const LineSchema = Schema.Struct({
  lineId: LineIdSchema,
  productCode: ProductCodeSchema,
  quantity: QuantitySchema,
})
export const InputSchema = Schema.Struct({
  orderId: OrderIdSchema,
  customer: CustomerSchema,
  shippingAddress: AddressSchema,
  billingAddress: AddressSchema,
  lines: Schema.Array(LineSchema).check(Schema.isMinLength(1)),
})

export type ProductCode = typeof ProductCodeSchema.Type
export type Money = typeof MoneySchema.Type
export type Address = typeof AddressSchema.Type
export type UnvalidatedAddress = typeof AddressSchema.Encoded
export type UnvalidatedLine = typeof LineSchema.Encoded
export type UnvalidatedOrder = typeof InputSchema.Encoded
export type ValidatedLine = typeof LineSchema.Type

// 9.2: 각 단계가 만드는 상태를 입력/출력 타입으로 드러낸다.
export type ValidatedOrder = {
  readonly _tag: "ValidatedOrder"
  readonly orderId: typeof OrderIdSchema.Type
  readonly customer: typeof CustomerSchema.Type
  readonly shippingAddress: Address
  readonly billingAddress: Address
  readonly lines: ReadonlyArray<ValidatedLine>
}
export type PricedLine = ValidatedLine & { readonly linePrice: Money }
export type PricedOrder = Omit<ValidatedOrder, "_tag" | "lines"> & {
  readonly _tag: "PricedOrder"
  readonly lines: ReadonlyArray<PricedLine>
  readonly amountToBill: Money
}
export type Acknowledgment = { readonly email: string; readonly letter: string }
export type SendResult = "Sent" | "NotSent"
export type AcknowledgmentSent = {
  readonly _tag: "OrderAcknowledgmentSent"
  readonly orderId: typeof OrderIdSchema.Type
  readonly email: string
}
export type PlaceOrderEvent =
  | { readonly _tag: "OrderPlaced"; readonly order: PricedOrder }
  | AcknowledgmentSent
  | { readonly _tag: "BillableOrderPlaced"; readonly orderId: typeof OrderIdSchema.Type; readonly amount: Money }

// 10.2: 도메인 검증 실패, 금액 실패, 외부 서비스 문제를 구분한다.
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}
export class PricingError extends Data.TaggedError("PricingError")<{
  readonly message: string
}> {}
export class AddressLookupError extends Data.TaggedError("AddressLookupError")<{
  readonly reason: "NotFound" | "Unavailable" | "Timeout"
  readonly message: string
}> {}
export class AddressServiceError extends Data.TaggedError("AddressServiceError")<{
  readonly reason: "Unavailable" | "Timeout"
  readonly message: string
}> {}
export class LegacyError extends Data.TaggedError("LegacyError")<{
  readonly message: string
}> {}
export class PlaceOrderError extends Data.TaggedError("PlaceOrderError")<{
  readonly stage: "validation" | "pricing"
  readonly cause: ValidationError | PricingError | AddressServiceError
}> {}

// 9.4.1: 여기서 acknowledgment는 주문 확인 통지다. NotSent도 업무상 정상 결과다.
export const acknowledgmentEvent = (
  order: PricedOrder,
  sent: SendResult,
): Option.Option<AcknowledgmentSent> => sent === "Sent"
  ? Option.some({ _tag: "OrderAcknowledgmentSent", orderId: order.orderId, email: order.customer.email })
  : Option.none()

// 9.4.2: 이벤트를 데이터로 만든다. 여기서 메시지 브로커에 발행하지 않는다.
export const createEvents = (
  order: PricedOrder,
  acknowledgment: Option.Option<AcknowledgmentSent>,
): ReadonlyArray<PlaceOrderEvent> => {
  const events: PlaceOrderEvent[] = [{ _tag: "OrderPlaced", order }]
  if (Option.isSome(acknowledgment)) events.push(acknowledgment.value)
  if (order.amountToBill > 0) {
    events.push({ _tag: "BillableOrderPlaced", orderId: order.orderId, amount: order.amountToBill })
  }
  return events
}
