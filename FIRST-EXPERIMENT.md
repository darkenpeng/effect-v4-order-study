# 첫 실험: 주문 검증 → 가격 계산 — Effect v4

Effect v3와 함수형 프로그래밍에 익숙한 사람을 위한 실행 가능한 학습 예제다.
`effect@4.0.0-beta.107`에 고정했고 Node.js 24.16.0에서 타입 검사, 테스트, 데모를 확인했다.

책의 9·10장에서 다루는 상태 전환, 의존성 주입, 실패 가능한 함수의 합성을 두 단계로 축약했다. 책 전체 코드의 직역이나 발표 원고가 아니라, 설명과 구현을 함께 살펴보는 첫 실험이다.

```sh
npm ci
npm run demo
npm test
npm run typecheck
```

읽는 순서는 [order.ts](./order.ts)의 마지막 `validateAndPrice` → 각 단계의 시그니처 → 구현 → [fixtures.ts](./fixtures.ts) → [order.test.ts](./order.test.ts)를 추천한다.

## 1. 먼저 합성된 함수를 읽는다

```ts
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
```

이 함수의 시그니처에는 세 가지가 드러난다.

- 성공하면 가격이 계산된 주문을 얻는다.
- 예상된 실패는 주문 검증 오류 또는 가격 계산 오류다.
- 실행하려면 상품 존재 확인과 가격 조회 구현을 공급해야 한다.

여기서 `E`는 모델링한 실패를 나타낸다. 모든 예외나 결함이 자동으로 `E`에 들어가는 것은 아니다.

같은 합성은 `validateOrder(input).pipe(Effect.flatMap(priceOrder))`로 쓸 수 있다. `priceOrder`도 Effect를 반환하므로 `flatMap`으로 연결한다. `map(priceOrder)`로 쓰면 계산된 주문 대신 다음 Effect를 값으로 가진 중첩 구조가 생긴다.

## 2. 검증은 다음 단계가 믿을 수 있는 입력을 만든다

`UnvalidatedOrder`의 필드 타입은 `string`, `number`다. 그 타입만으로 상품 코드 형식, 정수 수량, 상품 등록 여부까지 알 수는 없다.

`validateOrder`는 다음 조건을 확인한다.

1. 주문 번호는 빈 문자열이 아니다.
2. 주문에는 하나 이상의 항목이 있다.
3. 상품 코드는 `W` 다음 숫자 네 자리다.
4. 수량은 1~1000의 정수다.
5. 각 상품이 등록되어 있다.

1~4는 Schema, 5는 주입한 `CheckProductCodeExists`가 담당한다. 형태가 올바르다는 것과 실제 상품이 존재한다는 것을 분리했다.

모두 성공하면 `ValidatedOrder`를 만든다. 이 타입에는 brand가 있고, brand를 붙이는 함수는 모듈 안에만 있다. `Brand.nominal` 자체에는 런타임 검증 기능이 없으므로, 실제 검증을 마친 성공 경로에서만 호출한다. TypeScript의 강제 타입 단언까지 막는 보장은 아니다.

`priceOrder`는 `ValidatedOrder`만 받는다. 가격 계산 단계가 상품 코드와 수량을 다시 검증하지 않아도 되는 이유다. 테스트 파일에는 검증 전 주문을 전달하면 컴파일 오류가 나는지도 확인하는 코드가 있다.

## 3. 두 단계의 의존성을 따로 표현한다

| 단계 | 입력 | 성공 | 예상된 실패 | 필요한 서비스 |
|---|---|---|---|---|
| `validateOrder` | `UnvalidatedOrder` | `ValidatedOrder` | `ValidationError` | `CheckProductCodeExists` |
| `priceOrder` | `ValidatedOrder` | `PricedOrder` | `PricingError` | `GetProductPrice` |

저자의 예제에서는 이런 의존성을 함수 인자로 전달한다. 여기서는 Effect의 `R`에 표현하고, 실행하는 곳에서 `Layer.succeed`로 구현을 공급한다. 함수 인자로 주입하는 설계도 유효하다. 서비스로 옮긴 것은 이번 Effect 학습을 위한 선택이다.

v4의 서비스 정의는 다음 형태다.

```ts
export class GetProductPrice extends Context.Service<
  GetProductPrice,
  { readonly get: (code: ProductCode) => Effect.Effect<number, PricingError> }
>()("study/GetProductPrice") {}
```

`fixtures.ts`는 상품 등록 정보와 가격표를 가진 구현을 공급한다. 가격 조회 횟수는 `get`이 반환한 Effect의 실행 안에서 기록한다. 따라서 기록은 프로그램을 만든 횟수가 아니라 가격 조회를 실행한 횟수다.

## 4. 실패는 출력뿐 아니라 이후 실행도 바꾼다

데모의 두 입력은 다음과 같다.

| 입력 | 첫 번째 항목 | 두 번째 항목 | 결과 | 가격 조회 |
|---|---|---|---|---|
| 정상 주문 | W0001 × 2 | W0002 × 1 | 합계 5900 | W0001, W0002 |
| 잘못된 주문 | W0001 × 2 | W0002 × 0 | `ValidationError` | 0회 |

두 번째 주문도 첫 번째 항목은 정상이다. 하지만 주문 전체의 검증을 마치기 전에는 가격 계산 단계에 들어가지 않는다. 이것이 항목마다 검증과 가격 계산을 번갈아 하는 구현과 달라지는 지점이다.

`yield* validateOrder(input)`이 실패하면 `priceOrder`에 도달하지 않는다. 이미 수행한 작업을 되돌리는 트랜잭션 기능을 뜻하지는 않는다. 또한 서비스 Layer를 준비하는 일과 서비스의 `get`을 호출하는 일도 다르다. 이 예제의 Layer 생성에는 외부 I/O가 없다.

순차 실행을 명시하기 위해 `Effect.forEach`에 `concurrency: 1`을 지정했다. 검증 오류는 첫 실패에서 멈추며, 여러 오류를 모으는 정책은 아직 추가하지 않았다.

## 5. v3 경험자가 볼 API 변화

| 이번 예제의 지점 | v4 표현 |
|---|---|
| 서비스 정의 | `Context.Service<Self, Shape>()("key")` |
| 값 제약 | `Schema.Number.check(Schema.isInt(), Schema.isBetween(...))` |
| Schema 디코딩 | `Schema.decodeUnknownEffect(schema)(input)` |
| 예상된 실패를 결과 값으로 관찰 | `Effect.result` → `Result`, `Result.match` |

`demo.ts`는 가장 바깥에서 `Effect.result`로 성공과 예상된 실패를 데이터로 바꿔 출력한다. 워크플로 내부에서는 계속 Effect의 오류 채널을 사용한다. `Effect.result`가 결함이나 인터럽트까지 모두 성공 값으로 바꾸지는 않는다.

서비스의 `Layer`는 명시적으로 조립했다. v4의 `Context.Service`를 v3의 `Effect.Service`처럼 자동 `.Default` Layer가 생기는 API로 이해하면 안 된다.

## 6. 책에서 가져온 구조와 이번 실험의 선택

저자의 공개 구현은 `ValidateOrder`와 `PriceOrder`를 분리하고, 의존성을 함수로 주입하며, 각 단계의 실패를 합성한다. 이 구조를 유지했다. 원래 구현은 검증 단계에 주소 확인도 포함하고, 가격 계산에는 금액 연산의 오류 처리가 있다. [저자의 PlaceOrder 구현](https://github.com/swlaschin/DomainModelingMadeFunctional/blob/master/src/OrderTaking/PlaceOrder.Implementation.fs)

이번 실험에서는 다음과 같이 범위를 정했다.

- 고객, 주소, 항목 ID, 무게 상품, 통지와 이벤트는 생략했다.
- 금액은 원 단위의 안전한 정수다. 책의 decimal과 금액 제약 타입을 그대로 옮긴 것은 아니다.
- 빈 주문을 거절하는 규칙을 추가했다.
- 등록된 상품에도 가격이 없을 수 있는 시나리오를 추가했다. 상품 존재와 가격 제공 가능성은 별도로 다룬다.
- `CheckProductCodeExists` 구현은 실패하지 않는 로컬 조회로 가정했다. 네트워크 구현을 붙일 때는 해당 실패 계약을 다시 설계한다.
- 금액은 음수, 소수, NaN, 안전 정수 범위 초과를 거절한다. 실제 결제 서비스의 가격·통화 모델 전체를 구현한 것은 아니다.

## 7. 확인한 것과 다음 토론

동작 테스트 5개: 정상 합계, 뒤 항목의 검증 실패 시 가격 조회 0회, 미등록 상품 차단, 가격 누락 시 오류 구분 및 후속 조회 중단, 잘못된 금액 거절. `tsc --noEmit`으로 검증 전 주문이 가격 계산에 직접 들어갈 수 없는 것도 확인한다.

다음에는 한 가지씩 바꾸며 토론할 수 있다.

- 수량 오류를 모두 모아 반환하면 검증의 합성 방식은 어떻게 달라질까?
- 상품 존재 확인이 원격 호출이 되면 어떤 오류를 `E`에 추가할까?
- 검증 이후 상품이나 가격이 변경될 수 있다면 `ValidatedOrder`가 보장하는 범위는 어디까지일까?

v4 참고 자료: [서비스 마이그레이션](https://github.com/Effect-TS/effect/blob/main/migration/services.md), [Schema 마이그레이션](https://github.com/Effect-TS/effect/blob/main/migration/schema.md), [Result](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Result.ts). 링크의 main은 바뀔 수 있으므로 실행 기준은 이 폴더의 package-lock.json에 고정된 버전이다.
