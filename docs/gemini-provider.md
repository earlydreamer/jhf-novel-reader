# Gemini 구현과 현재 노출 범위

Gemini 전체 회차 제공자는 renewal T8·이슈 #29에서 추가했습니다. 구현은 남아 있지만 현재 설정 UI에서는 숨겨져 있습니다. 아래 내용은 구현·보안 경계에 관한 기록이며, 현재 사용자에게 설정 화면에서 Gemini를 고르라고 안내하는 절차가 아닙니다. 기본 제공자나 실패 시 자동 대체 수단으로 사용하지 않습니다.

## 구현의 연결 조건

Gemini 기본 주소는 `https://generativelanguage.googleapis.com/v1beta`로 제한합니다. 다른 호스트·HTTP·포트·경로·쿼리·fragment·사용자 정보는 허용하지 않습니다.

인증값은 OS 보안 저장소의 `authRef`로 참조하고 요청 직전에 읽습니다. 모델 목록에서는 `generateContent` 지원 모델만 고릅니다. 모델 가용성·한도·가격·지역 조건은 계정과 시점에 따라 달라집니다. 실제로 사용하도록 기능을 다시 노출한다면 [모델 문서](https://ai.google.dev/gemini-api/docs/models), [가격](https://ai.google.dev/gemini-api/docs/pricing), [데이터 처리·이용 조건](https://ai.google.dev/gemini-api/terms)을 확인해야 합니다. 원문을 Google로 전송하며 비용이 발생할 수 있습니다.

## 전체 회차 요청 계약

- 목록 조회는 고정된 `GET https://generativelanguage.googleapis.com/v1beta/models`를 사용합니다.
- 번역 요청은 선택한 모델의 `:generateContent`로 비스트리밍 POST 한 번을 보냅니다. 이 경로에는 자동 재시도·청크 분할·보정 요청·다른 제공자 전환이 없습니다.
- 본문에는 `systemInstruction`, 전체 원문 `contents`, `generationConfig.candidateCount: 1`을 사용합니다. `responseFormat`, JSON 스키마, 문단 ID JSON 계약을 사용하지 않습니다.
- 결과는 일반 텍스트입니다. `STOP`은 완료, `MAX_TOKENS`는 길이 제한, 안전·차단 종료 이유는 차단, 나머지는 결과 불명으로 변환합니다. 완료가 아닌 결과는 저장하지 않습니다.
- 완료한 결과는 `wholeChapter` 흐름에서 버전으로 저장합니다. 제공자를 바꿨다는 이유로 저장본을 삭제하거나 다시 요청하지 않습니다. 연결 식별자에는 제공자와 정규화한 주소를 함께 사용합니다.

## 전송과 인증 경계

API 키는 URL 쿼리나 Bearer 토큰이 아니라 `x-goog-api-key` 헤더에만 담습니다. 키가 있는 GET은 고정 모델 목록 주소, POST는 고정 Google HTTPS `generateContent` 주소만 허용합니다. 다른 목적지, 쿼리·fragment·사용자 정보·경로 순회·Authorization 혼용은 전송 전에 거부합니다.

리디렉션은 네이티브 전송 전에 끄고 응답 URL도 비교합니다. 오류에 키나 원문을 넣지 않습니다.

## 이전 계약과 검증

`src/providers/gemini/index.ts`의 초기 `TranslationProvider` 계약은 문단 JSON을 사용했습니다. 전체 회차 구현은 `ProviderSession` 계약을 별도로 사용합니다. 두 계약을 혼용하지 않습니다.

도입 당시 검증 대상은 다음과 같습니다.

- `tests/providers/gemini/whole-chapter.test.ts`: 고정 목적지, 일반 텍스트 POST 한 번, 종료 이유 변환, 생성 가능 모델 필터를 검사했습니다.
- `tests/integration/renewal-gemini.test.tsx`: 명시적 선택과 통합 구성, Google POST 한 번, 저장본 유지, 차단·결과 불명의 미저장을 검사했습니다.
- `tests/contracts/gemini-http.test.ts`: 고정 목록 GET과 헤더 전용 키의 전송 경계를 검사했습니다.

이 검증은 모의 전송을 사용했으며 실제 Gemini 호출·실제 키·유료 요청을 사용하지 않았습니다. 현재 UI 노출 여부와 해당 테스트의 유지 여부는 현재 소스·테스트 목록을 기준으로 확인합니다. 실제 기기·계정·지역·할당량·장문 품질은 별도 승인과 검증이 필요합니다.
