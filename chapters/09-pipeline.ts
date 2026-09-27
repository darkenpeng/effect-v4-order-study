import { Option, Schema } from "effect"
import {
  AddressSchema, CustomerSchema, InputSchema, LineSchema, MoneySchema, OrderIdSchema,
  acknowledgmentEvent, createEvents,
  type Acknowledgment, type AcknowledgmentSent, type Address, type PlaceOrderEvent,
  type PricedOrder, type ProductCode, type SendResult, type UnvalidatedAddress,
  type UnvalidatedLine, type UnvalidatedOrder, type ValidatedLine, type ValidatedOrder,
} from "./domain.js"

// 9.6: 모든 의존성은 함수다. 9장 버전은 동기 실행과 예외를 사용한다.
// 반환 타입에서 오류가 보이지 않는다는 한계를 10장에서 바꾼다.
export type Dependencies9 = {
  readonly checkProduct: (code: ProductCode) => boolean
  readonly checkAddress: (address: UnvalidatedAddress) => UnvalidatedAddress
  readonly getPrice: (code: ProductCode) => number
  readonly createLetter: (order: PricedOrder) => string
  readonly sendAcknowledgment: (acknowledgment: Acknowledgment) => SendResult
}

// 9.3.3: boolean을 돌려주는 의존성을 A -> A 파이프라인에 맞춘다.
export const predicateToPassthrough = <A>(predicate: (value: A) => boolean, message: string) =>
  (value: A): A => {
    if (!predicate(value)) throw new Error(message)
    return value
  }

// 9.3.1: 외부 확인 결과도 도메인 값 제약을 만족하는지 확인한다.
export const toAddress = (check: Dependencies9["checkAddress"]) =>
  (input: UnvalidatedAddress): Address => Schema.decodeUnknownSync(AddressSchema)(check(input))

// 9.3.2: 입력 필드와 상품 존재를 확인해 다음 단계가 믿을 수 있는 항목을 만든다.
export const toValidatedLine = (check: Dependencies9["checkProduct"]) =>
  (input: UnvalidatedLine): ValidatedLine => {
    const line = Schema.decodeUnknownSync(LineSchema)(input)
    predicateToPassthrough(check, `상품 없음: ${line.productCode}`)(line.productCode)
    return line
  }

// 9.2: 구현보다 먼저 읽을 계약. 의존성을 채우면 주문만 받는 함수가 된다.
export type ValidateOrder9 = (input: UnvalidatedOrder) => ValidatedOrder
export type PriceOrder9 = (input: ValidatedOrder) => PricedOrder

export const makeValidateOrder9 = (
  dependencies: Pick<Dependencies9, "checkProduct" | "checkAddress">,
): ValidateOrder9 => (input) => {
  // 전체 입력의 필드 검증을 먼저 완료해 잘못된 주문의 외부 호출을 피한다.
  Schema.decodeUnknownSync(InputSchema)(input)
  return {
    _tag: "ValidatedOrder",
    orderId: Schema.decodeUnknownSync(OrderIdSchema)(input.orderId),
    customer: Schema.decodeUnknownSync(CustomerSchema)(input.customer),
    lines: input.lines.map(toValidatedLine(dependencies.checkProduct)),
    shippingAddress: toAddress(dependencies.checkAddress)(input.shippingAddress),
    billingAddress: toAddress(dependencies.checkAddress)(input.billingAddress),
  }
}

// 9.4: 값 계산은 순수하고, 가격 조회 방법만 주입받는다.
export const makePriceOrder9 = (getPrice: Dependencies9["getPrice"]): PriceOrder9 => (order) => {
  const money = Schema.decodeUnknownSync(MoneySchema)
  const lines = order.lines.map((line) => ({
    ...line,
    linePrice: money(money(getPrice(line.productCode)) * line.quantity),
  }))
  return {
    ...order,
    _tag: "PricedOrder",
    lines,
    amountToBill: money(lines.reduce((sum, line) => sum + line.linePrice, 0)),
  }
}

export const makeAcknowledgeOrder9 = (
  dependencies: Pick<Dependencies9, "createLetter" | "sendAcknowledgment">,
) => (order: PricedOrder): Option.Option<AcknowledgmentSent> => acknowledgmentEvent(
  order,
  dependencies.sendAcknowledgment({ email: order.customer.email, letter: dependencies.createLetter(order) }),
)

// 9.5 / 9.6.1 / 9.8: 조립 시점에 의존성을 공급한다. 각 단계는 필요한 의존성만 받는다.
export const makePlaceOrder9 = (dependencies: Dependencies9) => {
  const validate = makeValidateOrder9(dependencies)
  const price = makePriceOrder9(dependencies.getPrice)
  const acknowledge = makeAcknowledgeOrder9(dependencies)
  return (input: UnvalidatedOrder): ReadonlyArray<PlaceOrderEvent> => {
    const validated = validate(input)
    const priced = price(validated)
    return createEvents(priced, acknowledge(priced))
  }
}
