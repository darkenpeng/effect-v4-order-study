import { Brand, Context, Data, Effect, Schema } from "effect"

// 첫 실험의 범위: 낱개 상품(W + 숫자 4자리), 수량 1~1000, 정수 금액.
// 책의 고객/주소, 무게 상품, 통지/이벤트는 이후에 붙인다.
const ProductCodeSchema = Schema.String.check(
  Schema.isPattern(/^W\d{4}$/),
).pipe(Schema.brand("ProductCode"))

const QuantitySchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 1000 }),
).pipe(Schema.brand("Quantity"))

const OrderFields = Schema.Struct({
  orderId: Schema.String.check(Schema.isMinLength(1)),
  lines: Schema.Array(Schema.Struct({
    productCode: ProductCodeSchema,
    quantity: QuantitySchema,
  })).check(Schema.isMinLength(1)),
})

export type ProductCode = typeof ProductCodeSchema.Type
export type UnvalidatedOrder = typeof OrderFields.Encoded

// 형태 검증과 상품 존재 확인을 모두 통과했다는 증거.
// Brand 자체는 검증하지 않는다. 생성 함수를 모듈 내부에 두고 성공 경로에서만 호출한다.
export type ValidatedOrder = typeof OrderFields.Type & Brand.Brand<"ValidatedOrder">
const markValidated = Brand.nominal<ValidatedOrder>()

export type PricedOrder = {
  readonly orderId: string
  readonly lines: ReadonlyArray<{
    readonly productCode: ProductCode
    readonly quantity: typeof QuantitySchema.Type
    readonly unitPrice: number
    readonly linePrice: number
  }>
  readonly amountToBill: number
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly reason: "InvalidFields" | "UnknownProduct"
  readonly message: string
}> {}

export class PricingError extends Data.TaggedError("PricingError")<{
  readonly reason: "PriceUnavailable" | "InvalidAmount"
  readonly message: string
}> {}

// 책에서 인자로 전달하던 두 함수를 별도 서비스로 표현한다.
// v4: Context.Service로 정의하며, Layer는 실행 경계에서 직접 조립한다.
export class CheckProductCodeExists extends Context.Service<
  CheckProductCodeExists,
  { readonly check: (code: ProductCode) => Effect.Effect<boolean> }
>()("study/CheckProductCodeExists") {}

export class GetProductPrice extends Context.Service<
  GetProductPrice,
  { readonly get: (code: ProductCode) => Effect.Effect<number, PricingError> }
>()("study/GetProductPrice") {}

export const validateOrder = (
  input: UnvalidatedOrder,
): Effect.Effect<ValidatedOrder, ValidationError, CheckProductCodeExists> =>
  Effect.gen(function*() {
    // Schema의 구조/값 제약 오류를 이 단계의 도메인 오류로 변환한다.
    const order = yield* Schema.decodeUnknownEffect(OrderFields)(input).pipe(
      Effect.mapError((error) => new ValidationError({
        reason: "InvalidFields",
        message: error.message,
      })),
    )

    // 형식이 올바른 상품 코드와 실제로 존재하는 상품은 다른 조건이다.
    const products = yield* CheckProductCodeExists
    yield* Effect.forEach(order.lines, (line) =>
      Effect.gen(function*() {
        if (!(yield* products.check(line.productCode))) {
          return yield* Effect.fail(new ValidationError({
            reason: "UnknownProduct",
            message: `등록되지 않은 상품: ${line.productCode}`,
          }))
        }
      }),
    { concurrency: 1, discard: true })

    return markValidated(order)
  })

// 이 예제는 금액을 원 단위의 정수로 취급한다.
// 외부 가격과 곱셈/합산 결과가 음수·NaN·안전 정수 범위 밖이면 실패한다.
const checkedAmount = (amount: number): Effect.Effect<number, PricingError> =>
  Number.isSafeInteger(amount) && amount >= 0
    ? Effect.succeed(amount)
    : Effect.fail(new PricingError({
      reason: "InvalidAmount",
      message: `유효하지 않은 정수 금액: ${amount}`,
    }))

export const priceOrder = (
  order: ValidatedOrder,
): Effect.Effect<PricedOrder, PricingError, GetProductPrice> =>
  Effect.gen(function*() {
    const prices = yield* GetProductPrice
    const lines = yield* Effect.forEach(order.lines, (line) =>
      Effect.gen(function*() {
        const unitPrice = yield* prices.get(line.productCode)
          .pipe(Effect.flatMap(checkedAmount))

        const linePrice = yield* checkedAmount(unitPrice * line.quantity)
        return { ...line, unitPrice, linePrice }
      }),
    { concurrency: 1 })

    const amountToBill = yield* checkedAmount(
      lines.reduce((total, line) => total + line.linePrice, 0),
    )
    return { orderId: order.orderId, lines, amountToBill }
  })

// 오류 E와 의존성 R은 두 단계의 합집합이다.
// 첫 yield*가 실패하면 두 번째 단계에는 도달하지 않는다.
export const validateAndPrice = (
  input: UnvalidatedOrder,
): Effect.Effect<
  PricedOrder,
  ValidationError | PricingError,
  CheckProductCodeExists | GetProductPrice
> => Effect.gen(function*() {
  const validated = yield* validateOrder(input)
  return yield* priceOrder(validated)
})
