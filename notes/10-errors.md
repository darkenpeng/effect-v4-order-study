# 10장. 구현: 오류 처리

> 같은 주문 처리 흐름에 실패와 비동기를 추가해도 단계의 계약과 조립 구조를 유지할 수 있을까?

구현: [10-errors.ts](../chapters/10-errors.ts) · 서비스 조립: [services.ts](../chapters/services.ts) · 검증: [study.test.ts](../chapters/study.test.ts)

## 10.1. Either 타입으로 오류 드러내기

한국어판의 `Either<E, A>`를 비교할 때 Effect v4의 값 타입은 `Result<A, E>`다. 성공과 오류 타입의 순서가 반대다.

```ts
const quantityResult = (input: number) =>
  Schema.decodeUnknownResult(QuantitySchema)(input).pipe(
    Result.mapError((error) =>
      new ValidationError({ field: "quantity", message: error.message })),
  )
```

Result는 이미 나온 결과, Effect는 실행할 계산이다. 워크플로는 Effect, 작은 동기 결과 비교는 Result로 구현했다. `Effect.result`는 예상된 실패를 Result로 바꾸지만 결함이나 인터럽트까지 모두 값으로 바꾸지는 않는다.

## 10.2. 도메인 오류 다루기

질문: 잘못된 주문과 일시적인 외부 장애를 같은 오류로 볼 것인가?

| 상황 | 이번 구현의 모델 |
|---|---|
| 수량/상품/주소가 유효하지 않음 | `ValidationError` |
| 가격 누락 또는 금액 연산 실패 | `PricingError` |
| 주소 서비스 사용 불가/시간 초과 | `AddressServiceError` |

### 10.2.1. 타입으로 도메인 오류 모델링하기

`toAddress10`은 외부 오류를 해석한다. `NotFound`는 주문 검증 오류, `Unavailable`과 `Timeout`은 서비스 오류다. 같은 단계에서 발생해도 대응해야 할 일이 다르다. 이는 이번 예제에서 선택한 정책이다.

### 10.2.2. 코드를 어지럽히는 오류 처리

`flatMap`이나 `yield*`가 실패 전파를 담당하게 하고 각 단계에는 그 단계의 검증과 계산을 남긴다. 외부 라이브러리의 예외를 타입 오류로 바꾸는 코드는 10.5.1처럼 경계에 둔다.

## 10.3. Either 타입을 출력하는 함수 연결하기

처음 수량 600은 유효하다. 두 배로 만들면 1200이므로 다음 수량 검증은 실패해야 한다. 이 작은 예제로 합성을 확인한다.

구현: `doubledQuantity`. 실험: `npm run study -- composition`.

### 10.3.1. 어댑터 블록 구현

`predicateToEffect`는 false를 `Effect.fail`로 바꾸고 true이면 원래 값을 전달한다.

```ts
check(value).pipe(
  Effect.flatMap((ok) =>
    ok ? Effect.succeed(value) : Effect.fail(onFalse(value))),
)
```

### 10.3.2. Either 함수들 관리하기

```ts
quantityResult(600).pipe(
  Result.map((quantity) => quantity * 2),
  Result.flatMap(quantityResult),
)
```

출력은 Failure다. 마지막 flatMap을 map으로 바꾸면 바깥 Success 안에 Failure가 들어간다. 실패 가능한 다음 계산을 연결할 때 필요한 차이다.

### 10.3.3. 함수 합성과 타입 검사

테스트 파일의 `@ts-expect-error` 두 곳은 검증 전 주문의 가격 계산과, 서비스 공급 없이 워크플로를 실행하는 것을 막는다. `npm run typecheck`는 실제 타입 오류가 있어야 통과한다. 타입이 느슨해져 잘못된 연결이 허용되면 오히려 검사에 실패한다.

### 10.3.4. 공통 오류 타입으로 변환

워크플로 경계는 `PlaceOrderError`로 통일했다. `stage`에 validation/pricing을, `cause`에 원래 타입 오류를 남긴다.

```ts
validate(input).pipe(Effect.mapError(validationFailure))
price(validated).pipe(Effect.mapError(pricingFailure))
```

단순 메시지 문자열로 바꾸지 않아 발생 단계와 원인을 계속 구분할 수 있다. Effect는 오류 합집합도 지원하므로 이 래핑은 선택한 경계 설계다.

## 10.4. flatMap과 map으로 파이프라인 조립하기

`makePlaceOrderFlatMap`을 읽는다. 검증 → 가격 계산 → 통지는 Effect를 반환하므로 flatMap, 최종 이벤트 생성은 순수한 값 변환이므로 map이다.

첫 단계가 실패하면 가격 조회와 통지가 실행되지 않는지 trace를 확인한다. 이미 수행한 작업을 롤백한다는 의미는 아니다.

## 10.5. 다른 유형의 함수들 이중 선로 모델에 적응시키기

| 기존 함수 | 연결 방식 |
|---|---|
| 순수한 `A -> B` | `Effect.map` |
| `A -> Effect<B, E>` | `Effect.flatMap` |
| `A -> Result<B, E>` | flatMap 안에서 `Effect.fromResult` |
| 예외를 던질 수 있는 동기 함수 | `Effect.try` |
| 부수 효과 실행 후 void 반환 | `Effect.sync`로 감싸고 `Effect.tap` |
| reject될 수 있는 Promise 생성 함수 | `Effect.tryPromise` |

### 10.5.1. 예외 처리

`parseLegacyJson`은 JSON.parse의 예외를 `LegacyError`로 바꾼다. 출력 타입은 unknown이다. JSON 구문 분석 성공이 곧 주문 검증 성공은 아니다.

Effect.sync 안의 예상하지 못한 예외는 결함이다. 예상 가능한 예외를 E에 넣으려면 try의 오류 변환을 명시한다.

### 10.5.2. 막다른 길 함수 처리

`observe(write)`는 void 함수를 tap으로 연결한다. 기록한 뒤 원래 성공값을 유지한다. 테스트에서는 42를 기록한 후 다음 단계에도 42가 전달되는지 확인한다.

## 10.6. 복잡한 파이프라인 다루기

`makePlaceOrderGen`은 flatMap 버전과 같은 단계·오류 변환을 유지하며 중간 결과에 이름을 붙인다.

```ts
const validated = yield* validate(input).pipe(Effect.mapError(validationFailure))
const priced = yield* price(validated).pipe(Effect.mapError(pricingFailure))
const ack = yield* acknowledge(priced)
return createEvents(priced, ack)
```

테스트에서 flatMap, gen, 서비스 버전의 결과와 호출 순서를 비교한다.

### 10.6.1. fp-ts의 do 표기법

중간 결과를 이름으로 이어가는 역할에 주목한다. 이번 구현은 Effect.gen의 지역 변수와 yield*로 표현한다. fp-ts를 함께 설치해 이중 구현하지는 않았다.

### 10.6.2. arrow-kt의 either 블록

이 절은 Kotlin 구현을 별도로 만들지 않고 실패 가능한 계산을 순서대로 읽는 표현을 비교하는 지점이다. Effect에서 확인할 동작은 성공값 바인딩과 실패 시 뒤 단계 중단이다.

### 10.6.3. arrow-kt의 Raise 콘텍스트

실패를 명시하면서 업무 흐름을 읽는 목적을 비교한다. 이번 코드의 검증 대상은 Effect.fail과 yield*의 동작이다. Raise와 Effect의 내부 실행 메커니즘이 같다고 전제하지 않는다.

### 10.6.4. Either 타입으로 주문 검사하기

`makeValidateOrder10`은 전체 필드 → 상품 존재 → 배송 주소 → 청구 주소를 검증한 뒤 ValidatedOrder를 만든다. 각 yield*는 앞 계산의 성공을 전제로 이어진다.

### 10.6.5. Either 리스트의 유효성 검사

```ts
Effect.forEach(lines, validateLine, { concurrency: 1 }) // 첫 실패에서 중단
Effect.validate(lines, validateLine, { concurrency: 1 }) // 항목별 실패 수집
```

구현: `validateLinesFirst`, `validateLinesAll`. 잘못된 두 항목 뒤에 정상 항목을 두고, 정상 항목의 상품 확인까지 수행되는지 본다. 두 번째는 항목별 실패를 모으며 Schema 내부의 모든 필드 오류까지 자동으로 펼치는 것은 아니다.

기본 워크플로는 첫 실패 중단이다. 오류 누적은 별도 비교 실험이다.

## 10.7. 모나드와 기타 개념

앞 결과가 있어야 다음 계산을 만들 수 있다면 flatMap으로 연결한다. 서로의 결과가 필요 없는 계산들은 한데 모아 합성할 수 있다. 이 의존 관계와 실제 동시 실행 여부를 구분한다.

### 10.7.1. 애플리케이티브로 병렬 합성하기

`checkAddressesParallel`은 두 주소를 `Effect.all(..., { concurrency: 2 })`로 동시에 확인한다. 기본 워크플로는 순차 검증이며 이 함수는 별도 비교 실험이다.

테스트는 두 호출이 모두 시작되어야 열리는 Deferred를 사용한다. 실행 시간이 짧았다는 추측 대신 실제 겹쳐 실행됐음을 확인한다. 동시 실행은 오류 누적과 별개이고, 이 all은 첫 실패를 전파한다.

## 10.8. 비동기 효과 추가하기

`addressFromPromise`는 실행할 때 Promise를 만들고 AbortSignal을 전달한다. 실제 외부 함수가 signal을 처리해야 작업 취소에도 반응할 수 있다.

`withAddressTimeout`은 시간 초과를 타입 오류로 바꾼다. 가짜 서비스는 지연 후 성공, 지연 후 장애, 끝나지 않는 대기를 제공한다.

```sh
npm run study -- async
```

성공하면 가격 계산으로 이어진다. 실패나 시간 초과이면 가격 조회는 없다. 시간 초과 시 `address:cancelled:Seoul`도 확인한다. 테스트는 TestClock을 사용해 실제 시간 대기에 의존하지 않는다.

## 10.9. 마무리

타입에는 성공값, 모델링한 실패, 필요한 서비스가 남는다. 함수 인자로 의존성을 공급하거나 Layer로 공급한 뒤 실행한다. 정상 경로의 업무 의미는 9장과 동일하고 실패와 실행 시점의 표현이 달라진다.

발표에서 확인할 것: 실패 뒤 생략된 호출, 공통 오류에 보존된 원인, 비동기를 추가해도 유지되는 도메인 단계.
