# 파이프라인 조합하기 — Effect v4 스터디

> 주문 처리의 성공, 실패, 외부 의존성을 타입에 드러내면서 작은 함수들을 어떻게 하나의 흐름으로 조립할까? 구현과 함께 살펴보자.

한국어판 9·10장 목차에 연결한 실행 예제와 설명이다. Effect v3와 함수형 프로그래밍 경험자를 기준으로 작성했다. **effect@4.0.0-beta.107**에 고정했으며 Node.js 24.16.0에서 검증했다.

## 다섯 가지 구현 실험

| 단계 | 연결되는 절 | 풀어볼 질문 | 실행 |
|---|---|---|---|
| 9장 복원 | 9.1~9.5, 9.8~9.9 | 입력과 출력은 무엇을 보장하는가? | `npm run study -- 9` |
| 의존성 드러내기 | 9.6~9.7 | 같은 외부 기능을 함수/서비스로 어떻게 교체하는가? | `npm run study -- di` |
| 오류 도입 | 10.1~10.3 | 실패하면 이후 호출은 어떻게 되는가? | `npm run study -- errors` |
| 합성 이해하기 | 10.4~10.7 | map/flatMap/gen과 실행 정책은 어떻게 다른가? | `npm run study -- composition` + 테스트 |
| 비동기 도입 | 10.8~10.9 | 지연·실패가 생겨도 흐름이 유지되는가? | `npm run study -- async` |

처음에는 **[9장 설명](./notes/09-pipeline.md)**에서 읽은 부분만 보고 첫 명령을 실행하면 된다. **[10장 설명](./notes/10-errors.md)**은 책을 읽는 순서에 맞춰 절별로 볼 수 있다. 각 절에 질문, 코드 위치, 확인할 동작을 붙였다.

```sh
npm ci
npm run study -- 9
npm run typecheck
npm test
```

`npm run study`는 다섯 데모를 모두 실행한다. 첫 번째 두 단계 예제는 [FIRST-EXPERIMENT.md](./FIRST-EXPERIMENT.md)와 `npm run demo`에 남아 있다.

## 코드 위치

| 파일 | 역할 |
|---|---|
| [domain.ts](./chapters/domain.ts) | 단순 타입, 주문 상태, 오류, 조건부 이벤트 |
| [09-pipeline.ts](./chapters/09-pipeline.ts) | 동기 함수와 함수 의존성으로 조립한 9장 버전 |
| [10-errors.ts](./chapters/10-errors.ts) | 타입 오류, flatMap/gen, 함수 어댑터, 오류 누적, 동시 실행, Promise |
| [services.ts](./chapters/services.ts) | 같은 구현을 Context.Service/Layer로 공급 |
| [fixtures.ts](./chapters/fixtures.ts) | 성공·실패·지연을 제어하는 가짜 외부 함수와 호출 기록 |
| [study.test.ts](./chapters/study.test.ts) | 단계 계약, 호출 중단, 구현 간 동등성, 비동기 검증 |

## 확인할 결과

| 시나리오 | 결과 |
|---|---|
| 정상 주문 | 합계 5900, 주문·통지·청구 이벤트 |
| 잘못된 수량 | 검증 실패, 주소/가격/통지 호출 없음 |
| 주소 없음 | ValidationError, 가격 조회 없음 |
| 주소 서비스 장애/시간 초과 | AddressServiceError, 가격 조회 없음 |
| 가격 누락 | PricingError, 통지 없음 |
| 확인 통지 NotSent | 주문 성공, 통지 이벤트만 없음 |
| 합계 0 | 주문 성공, 청구 이벤트 없음 |

타입 검사와 동작 테스트 23개(첫 예제 5개 포함), 다섯 데모를 확인했다. 시간 관련 테스트는 가상 시계로, 주소 동시 실행은 두 호출의 시작을 동기화하는 장치로 검증한다.

## 책과 이번 구현의 관계

한국어판 공개 TypeScript 예제의 동기 파이프라인, 오류가 있는 파이프라인, 확인 통지/이벤트 분리 구조를 참고해 Effect v4로 재구성했다. 설명은 목차와 공개 코드에 연결한 학습 해설이며 본문 문단을 전부 대조한 해설은 아니다.

이번 실험은 낱개 상품(W 코드), 원 단위 정수 금액, 축약한 고객·주소 필드를 사용한다. 무게 상품과 책의 금액 상한 규칙은 전체 이식 범위에 포함하지 않았다. 빈 주문 거절, 서비스 장애 타입, 시간 초과는 이 예제의 선택이다. 주소 동시 검증과 항목 오류 누적은 기본 순차 워크플로와 비교하는 별도 실험이다.

참고한 소스:

- [한국어판 목차 및 예제 안내](https://jpub.tistory.com/468950)
- [한국어판 TypeScript 코드](https://github.com/on-the-ground/domain-modeling-made-functional-typescript/tree/f0da19b3b11bf727d4dc4c43df102896de8e193b/src/order-taking/place-order): implementation-without-effects.ts, implementation.ts, implementation.common.ts (공개 저장소의 Apache-2.0 라이선스)
- [Effect v4 서비스 가이드](https://github.com/Effect-TS/effect/blob/main/migration/services.md), [Schema 가이드](https://github.com/Effect-TS/effect/blob/main/migration/schema.md)

Effect API는 설치된 beta.107의 타입 선언과 구현으로 확인했다. main 문서는 이후 달라질 수 있으므로 실행 버전은 package-lock.json을 기준으로 한다.
