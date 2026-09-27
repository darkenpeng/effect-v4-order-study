# 9장. 파이프라인 조합하기

> 주문 처리의 단계와 외부 의존성을 타입에 드러내면서 작은 함수들을 어떻게 하나의 흐름으로 조립할까?

이 장은 동기 함수와 함수 인자 주입으로 시작한다. 단순 타입에는 Effect v4의 Schema를 사용한다. 실패는 예외로 드러나며 반환 타입에 기록되지 않는다. 이 한계를 10장에서 바꾼다.

공통 타입: [domain.ts](../chapters/domain.ts) · 구현: [09-pipeline.ts](../chapters/09-pipeline.ts)

## 9.1. 단순 타입 다루기

질문: `number`가 수량으로 쓰일 때 어떤 조건을 추가해야 할까?

```ts
const QuantitySchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 1000 }),
).pipe(Schema.brand("Quantity"))
```

`check`는 실제 값을 검사하고 brand는 타입에서 다른 숫자와 구분한다. brand 자체가 검증은 아니다. 구현은 `QuantitySchema`, `ProductCodeSchema`, `MoneySchema`에서 확인한다.

## 9.2. 함수 타입으로 구현 가이드하기

```ts
type ValidateOrder9 = (input: UnvalidatedOrder) => ValidatedOrder
type PriceOrder9 = (input: ValidatedOrder) => PricedOrder
```

질문: 가격 계산에 검증 전 주문이 들어올 수 있는가? 입력 타입이 이 연결을 제한한다. 검증된 필드의 brand와 주문 상태의 `_tag`를 함께 사용한다. 강제 타입 단언까지 막는 보장은 아니다.

## 9.3. 유효성 검증 단계 구현

`makeValidateOrder9`는 전체 입력의 필드 제약을 검사한 뒤 상품 존재와 두 주소를 확인한다. 모두 성공해야 `ValidatedOrder`를 만든다.

실험: 두 번째 항목의 수량을 0으로 바꾼다. 앞 항목이 정상이더라도 가격 조회가 실행되지 않아야 한다.

### 9.3.1. 유효한 주소 생성

`toAddress(check)`는 외부 확인 함수를 호출한 뒤 응답을 `AddressSchema`로 검사한다. 외부 서비스가 주소를 찾았다는 것과 응답이 우리 필드 제약을 만족한다는 것은 별개다.

구현: `toAddress`. 10장 테스트의 `malformed` 시나리오로 잘못된 응답 우편번호를 확인한다.

### 9.3.2. 주문 항목 생성

`toValidatedLine(check)`는 항목 ID, 상품 코드 형식, 수량을 검사한 뒤 상품 등록 여부를 확인한다. `W9999`는 형식은 맞지만 가짜 상품 목록에 없어 거절된다.

### 9.3.3. 함수 어댑터 생성

상품 확인 함수는 `ProductCode -> boolean`이다. 다음 단계에는 확인한 상품 코드를 넘겨야 한다.

```ts
predicateToPassthrough(check, "상품 없음")(productCode)
```

true이면 원래 값을 반환하고 false이면 예외를 던진다. 10.3.1에서는 실패를 Effect 오류 채널로 옮긴다.

## 9.4. 나머지 단계 구현

`makePriceOrder9(getPrice)`는 항목별 가격을 조회하고 수량을 곱해 합산한다. 조회 방법을 주입하므로 가격표를 바꿔도 계산 함수를 수정하지 않는다.

예제 금액은 `1200 × 2 + 3500 × 1 = 5900`이다. 음수, 소수, 안전 정수 범위 밖의 계산 결과는 거절한다.

### 9.4.1. 승인 단계 구현

여기서 승인은 주문 확인 통지(acknowledgment)다. 결제 승인을 뜻하지 않는다.

`makeAcknowledgeOrder9`는 문구를 만들고 전송한다. `Sent`이면 통지 이벤트의 `Option.some`, `NotSent`이면 `Option.none()`이다. 업무 정책상 NotSent는 주문 전체의 실패로 취급하지 않는다. 예상하지 못한 예외까지 자동으로 무시하는 것은 아니다.

### 9.4.2. 이벤트 생성

`createEvents`는 주문 처리 시 `OrderPlaced`, 통지를 보낸 경우 `OrderAcknowledgmentSent`, 금액이 양수인 경우 `BillableOrderPlaced`를 만든다. 이벤트는 반환되는 데이터이며 브로커 발행은 별도 책임이다.

## 9.5. 파이프라인 단계들 모두 모으기

```ts
const validated = validate(input)
const priced = price(validated)
return createEvents(priced, acknowledge(priced))
```

마지막 단계에는 가격 계산된 주문과 선택적인 통지 이벤트가 함께 필요하다. 그 데이터 의존성을 지역 변수로 읽을 수 있다. 구현: `makePlaceOrder9`.

## 9.6. 의존 주입

`makePlaceOrder9(dependencies)`에 의존성을 공급하면 주문만 받는 함수를 얻는다.

별도 비교 실험에서는 10장의 같은 Effect 함수를 함수 인자와 Context.Service로 각각 공급한다. Effect 사용 여부와 서비스 주입 여부를 분리해 비교할 수 있다.

| 형태 | 조립 후 남는 계약 |
|---|---|
| `makePlaceOrderGen(dependencies)(input)` | `Effect<Events, PlaceOrderError>` |
| `placeOrderService(input)` | `Effect<Events, PlaceOrderError, Products \| Addresses \| Prices \| Acknowledgments>` |

실험: `npm run study -- di`. 두 결과와 호출 순서가 같아야 한다.

### 9.6.1. 넘쳐 나는 의존

검증에는 상품·주소 확인, 가격 계산에는 가격 조회, 통지에는 문구 생성·전송만 필요하다. `Pick<Dependencies, ...>`와 단계별 factory로 필요한 것만 전달한다. 서비스 버전도 같은 경계를 유지한다.

의존성을 객체에 모았다고 실제 의존 관계가 사라지지는 않는다. `R`이 커진다면 어떤 단계가 무엇을 요구하는지 확인한다.

## 9.7. 의존 테스트

[fixtures.ts](../chapters/fixtures.ts)의 `makeHarness`는 가짜 함수와 호출 기록을 만든다. HTTP 요청 없이 가격표, 주소 결과, 통지 성공 여부를 교체한다.

결과뿐 아니라 가격 조회와 통지가 언제 실행됐는지도 확인한다. 검증 실패 뒤에 `price:*` 기록이 남으면 단계 경계를 잘못 조립한 것이다.

## 9.8. 조립한 파이프라인

```sh
npm run study -- 9
```

정상 결과는 합계 5900과 세 이벤트다. 상세 데이터는 `OrderPlaced.order`, 외부 작업은 `trace`에서 확인한다.

## 9.9. 마무리

지금 설명할 수 있어야 하는 것: 각 단계의 계약, 함수로 공급하는 의존성, 조건부 이벤트.

다음 질문: 잘못된 수량이나 주소 서비스 실패를 반환 타입에서 알 수 있는가? 이 버전의 타입에는 보이지 않는다. [10장](./10-errors.md)에서 같은 구조에 오류와 비동기를 추가한다.
