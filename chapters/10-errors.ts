import { Effect, Option, Result, Schema } from "effect"
import {
  AddressLookupError, AddressSchema, AddressServiceError, InputSchema, LegacyError,
  LineSchema, MoneySchema, PlaceOrderError, PricingError, QuantitySchema, ValidationError,
  acknowledgmentEvent, createEvents,
  type Acknowledgment, type AcknowledgmentSent, type Address, type PlaceOrderEvent,
  type PricedOrder, type ProductCode, type SendResult, type UnvalidatedAddress,
  type UnvalidatedLine, type UnvalidatedOrder, type ValidatedLine, type ValidatedOrder,
} from "./domain.js"

export type Dependencies10 = {
  readonly checkProduct: (code: ProductCode) => Effect.Effect<boolean>
  readonly checkAddress: (address: UnvalidatedAddress) => Effect.Effect<UnvalidatedAddress, AddressLookupError>
  readonly getPrice: (code: ProductCode) => Effect.Effect<number, PricingError>
  readonly createLetter: (order: PricedOrder) => string
  readonly sendAcknowledgment: (acknowledgment: Acknowledgment) => Effect.Effect<SendResult>
}

// 10.1: fp-ts Either<E, A>에 대응하는 v4 값은 Result<A, E>다. 타입 인자 순서에 주의.
export const quantityResult = (input: number) => Schema.decodeUnknownResult(QuantitySchema)(input).pipe(
  Result.mapError((error) => new ValidationError({ field: "quantity", message: error.message })),
)

// 10.3.1: boolean의 true는 원래 값을 통과시키고 false는 오류로 만든다.
export const predicateToEffect = <A, E>(
  check: (value: A) => Effect.Effect<boolean>,
  onFalse: (value: A) => E,
) => (value: A): Effect.Effect<A, E> => check(value).pipe(
  Effect.flatMap((exists) => exists ? Effect.succeed(value) : Effect.fail(onFalse(value))),
)

export const toValidatedLine10 = (check: Dependencies10["checkProduct"]) =>
  (input: UnvalidatedLine, index: number): Effect.Effect<ValidatedLine, ValidationError> =>
    Effect.gen(function*() {
      const line = yield* Schema.decodeUnknownEffect(LineSchema)(input).pipe(
        Effect.mapError((error) => new ValidationError({ field: `lines[${index}]`, message: error.message })),
      )
      yield* predicateToEffect(check, (code) => new ValidationError({
        field: `lines[${index}].productCode`, message: `상품 없음: ${code}`,
      }))(line.productCode)
      return line
    })

// 9.3.1 / 10.2: 주소 없음은 업무 검증 실패, 서버 장애/시간 초과는 서비스 실패다.
export const toAddress10 = (check: Dependencies10["checkAddress"]) =>
  (input: UnvalidatedAddress, field: string): Effect.Effect<Address, ValidationError | AddressServiceError> =>
    check(input).pipe(
      Effect.mapError((error) => error.reason === "NotFound"
        ? new ValidationError({ field, message: error.message })
        : new AddressServiceError({ reason: error.reason, message: error.message })),
      Effect.flatMap((checked) => Schema.decodeUnknownEffect(AddressSchema)(checked).pipe(
        Effect.mapError((error) => new ValidationError({ field, message: error.message })),
      )),
    )

export const makeValidateOrder10 = (
  dependencies: Pick<Dependencies10, "checkProduct" | "checkAddress">,
) => (input: UnvalidatedOrder): Effect.Effect<ValidatedOrder, ValidationError | AddressServiceError> =>
  Effect.gen(function*() {
    const fields = yield* Schema.decodeUnknownEffect(InputSchema)(input).pipe(
      Effect.mapError((error) => new ValidationError({ field: "order", message: error.message })),
    )
    // 10.6.4 / 10.6.5: 항목별 Effect를 하나의 Effect<Array<...>>로 모은다.
    yield* Effect.forEach(fields.lines, (line, index) =>
      predicateToEffect(dependencies.checkProduct, (code) => new ValidationError({
        field: `lines[${index}].productCode`, message: `상품 없음: ${code}`,
      }))(line.productCode),
    { concurrency: 1, discard: true })
    const checkAddress = toAddress10(dependencies.checkAddress)
    const shippingAddress = yield* checkAddress(fields.shippingAddress, "shippingAddress")
    const billingAddress = yield* checkAddress(fields.billingAddress, "billingAddress")
    return { ...fields, _tag: "ValidatedOrder", shippingAddress, billingAddress }
  })

const moneyEffect = (value: number) => Schema.decodeUnknownEffect(MoneySchema)(value).pipe(
  Effect.mapError((error) => new PricingError({ message: error.message })),
)

export const makePriceOrder10 = (getPrice: Dependencies10["getPrice"]) =>
  (order: ValidatedOrder): Effect.Effect<PricedOrder, PricingError> => Effect.gen(function*() {
    const lines = yield* Effect.forEach(order.lines, (line) => Effect.gen(function*() {
      const unitPrice = yield* getPrice(line.productCode).pipe(Effect.flatMap(moneyEffect))
      const linePrice = yield* moneyEffect(unitPrice * line.quantity)
      return { ...line, linePrice }
    }), { concurrency: 1 })
    const amountToBill = yield* moneyEffect(lines.reduce((sum, line) => sum + line.linePrice, 0))
    return { ...order, _tag: "PricedOrder", lines, amountToBill }
  })

export const makeAcknowledgeOrder10 = (
  dependencies: Pick<Dependencies10, "createLetter" | "sendAcknowledgment">,
) => (order: PricedOrder): Effect.Effect<Option.Option<AcknowledgmentSent>> => Effect.gen(function*() {
  const sent = yield* dependencies.sendAcknowledgment({
    email: order.customer.email, letter: dependencies.createLetter(order),
  })
  return acknowledgmentEvent(order, sent)
})

// 10.3.4: 경계에서 공통 오류로 감싸되 원래 원인과 발생 단계를 보존한다.
export const validationFailure = (cause: ValidationError | AddressServiceError) =>
  new PlaceOrderError({ stage: "validation", cause })
export const pricingFailure = (cause: PricingError) => new PlaceOrderError({ stage: "pricing", cause })

// 10.4: 실패 가능한 다음 단계는 flatMap, 순수한 최종 이벤트 생성은 map.
export const makePlaceOrderFlatMap = (dependencies: Dependencies10) => {
  const validate = makeValidateOrder10(dependencies)
  const price = makePriceOrder10(dependencies.getPrice)
  const acknowledge = makeAcknowledgeOrder10(dependencies)
  return (input: UnvalidatedOrder): Effect.Effect<ReadonlyArray<PlaceOrderEvent>, PlaceOrderError> =>
    validate(input).pipe(
      Effect.mapError(validationFailure),
      Effect.flatMap((order) => price(order).pipe(Effect.mapError(pricingFailure))),
      Effect.flatMap((priced) => acknowledge(priced).pipe(
        Effect.map((ack) => createEvents(priced, ack)),
      )),
    )
}

// 10.6.1~10.6.3: 위 합성을 gen으로 다시 쓴다. 의존성은 여전히 함수 인자로 공급한다.
export const makePlaceOrderGen = (dependencies: Dependencies10) => {
  const validate = makeValidateOrder10(dependencies)
  const price = makePriceOrder10(dependencies.getPrice)
  const acknowledge = makeAcknowledgeOrder10(dependencies)
  return (input: UnvalidatedOrder): Effect.Effect<ReadonlyArray<PlaceOrderEvent>, PlaceOrderError> =>
    Effect.gen(function*() {
      const validated = yield* validate(input).pipe(Effect.mapError(validationFailure))
      const priced = yield* price(validated).pipe(Effect.mapError(pricingFailure))
      const ack = yield* acknowledge(priced)
      return createEvents(priced, ack)
    })
}

// 10.3.2: 작은 Result 합성. map은 값 변환, flatMap은 실패 가능한 다음 함수다.
export const doubledQuantity = (input: number) => quantityResult(input).pipe(
  Result.map((quantity) => quantity * 2),
  Result.flatMap(quantityResult),
)

// 10.5.1: 예외를 던지는 레거시 함수의 경계에서만 try로 오류를 명시한다.
export const parseLegacyJson = (text: string): Effect.Effect<unknown, LegacyError> => Effect.try({
  try: (): unknown => JSON.parse(text),
  catch: (cause) => new LegacyError({ message: String(cause) }),
})

// 10.5.2: void를 반환하는 관찰 함수를 tap으로 연결하면 원래 값이 유지된다.
export const observe = <A>(write: (value: A) => void) => Effect.tap<A, void, never, never>(
  (value) => Effect.sync(() => write(value)),
)

// 10.6.5: 첫 실패에서 중단하는 정책과 모든 실패를 수집하는 정책을 명시적으로 비교한다.
export const validateLinesFirst = (check: Dependencies10["checkProduct"], lines: ReadonlyArray<UnvalidatedLine>) =>
  Effect.forEach(lines, toValidatedLine10(check), { concurrency: 1 })
export const validateLinesAll = (check: Dependencies10["checkProduct"], lines: ReadonlyArray<UnvalidatedLine>) =>
  Effect.validate(lines, toValidatedLine10(check), { concurrency: 1 })

// 10.7.1: 두 주소는 서로의 결과가 필요 없으므로 함께 시작할 수 있다.
// 동시 실행과 오류 누적은 별개다. all은 여기서 첫 실패에 전체를 실패시킨다.
export const checkAddressesParallel = (check: Dependencies10["checkAddress"], input: UnvalidatedOrder) =>
  Effect.all({
    shippingAddress: toAddress10(check)(input.shippingAddress, "shippingAddress"),
    billingAddress: toAddress10(check)(input.billingAddress, "billingAddress"),
  }, { concurrency: 2 })

// 10.8: Promise는 try 콜백 안에서 생성하고 AbortSignal을 전달한다.
export const addressFromPromise = (
  call: (address: UnvalidatedAddress, signal: AbortSignal) => Promise<UnvalidatedAddress>,
): Dependencies10["checkAddress"] => (address) => Effect.tryPromise({
  try: (signal) => call(address, signal),
  catch: (cause) => new AddressLookupError({ reason: "Unavailable", message: String(cause) }),
})

export const withAddressTimeout = (
  check: Dependencies10["checkAddress"], duration: number,
): Dependencies10["checkAddress"] => (address) => check(address).pipe(
  Effect.timeoutOrElse({
    duration,
    orElse: () => Effect.fail(new AddressLookupError({ reason: "Timeout", message: "주소 확인 시간 초과" })),
  }),
)
