# Gemini 구현과 현재 노출 범위

설정의 **번역 서버 → 제공자 → Google Gemini**에서 원문 전송과 비용 안내를 확인합니다. **API 키**를 입력하고 **연결 확인하기**를 누른 뒤 **모델**에서 연결된 계정의 생성 모델을 선택합니다. 기본 제공자는 로컬 서버입니다.

연결을 확인한 API 키는 기기의 보안 저장소에 보관합니다. 앱 재시작과 제공자 변경 후에도 각 연결의 주소, 키 참조, 모델 선택을 기억합니다. 연결 확인은 모델 목록만 조회합니다. 자동 번역을 켠 상태에서 저장본이 없는 회차를 열면 선택한 모델로 본문을 번역합니다.

## 구현의 연결 조건

Gemini 기본 주소는 `https://generativelanguage.googleapis.com/v1beta`로 제한합니다. 다른 호스트·HTTP·포트·경로·쿼리·fragment·사용자 정보는 허용하지 않습니다.

인증값은 OS 보안 저장소의 `authRef`로 참조하고 요청 직전에 읽습니다. 모델 목록에서는 `generateContent` 지원 모델만 고릅니다. 모델 가용성·한도·가격·지역 조건과 전송 데이터 처리는 계정과 시점에 따라 달라집니다. [모델 문서](https://ai.google.dev/gemini-api/docs/models) · [가격](https://ai.google.dev/gemini-api/docs/pricing) · [데이터 처리·이용 조건](https://ai.google.dev/gemini-api/terms)

## 전체 회차 요청 계약

- 목록 조회는 고정된 `GET https://generativelanguage.googleapis.com/v1beta/models`를 사용합니다.
- Android 설정에서 Gemini를 선택하면 선택한 모델의 `:streamGenerateContent?alt=sse`에 POST 한 번을 보냅니다. 한국어 본문이 도착하면 저장 전 미리보기를 갱신합니다. 스트리밍 전송을 사용할 수 없는 경우 요청 전에 실패합니다.
- 기존 비스트리밍 모드는 선택한 모델의 `:generateContent`로 POST 한 번을 보냅니다. 두 경로 모두 자동 재시도·청크 분할·보정 요청·다른 제공자 전환을 하지 않습니다.
- 본문에는 `systemInstruction`, 전체 원문 `contents`, `generationConfig.candidateCount: 1`을 사용합니다. `responseFormat`, JSON 스키마, 문단 ID JSON 계약을 사용하지 않습니다.
- 결과는 일반 텍스트입니다. `STOP`은 완료, `MAX_TOKENS`는 길이 제한, 안전·차단 종료 이유는 차단, 나머지는 결과 불명으로 변환합니다. 스트리밍은 모델의 추론을 미리보기와 저장에서 제외하며, 전체 SSE 응답에 유효한 `STOP`과 번역문이 있어야 저장합니다.
- 완료한 결과는 `wholeChapter` 흐름에서 버전으로 저장합니다. 제공자를 바꿨다는 이유로 저장본을 삭제하거나 다시 요청하지 않습니다. 연결 식별자에는 제공자와 정규화한 주소를 함께 사용합니다.
- Gemini에서는 제목을 자동 번역하지 않습니다. 기존 제목 저장본과 직접 편집은 계속 쓸 수 있습니다. 자동 용어집, 용어 정밀스캔, 문단 재번역은 로컬 연결에서 지원합니다.

## 전송과 인증 경계

API 키는 `x-goog-api-key` 헤더에만 담습니다. 키가 있는 GET은 고정 모델 목록 주소, POST는 고정 Google HTTPS `generateContent`와 `streamGenerateContent?alt=sse` 주소만 허용합니다. 스트리밍에 고정된 `alt=sse` 외의 쿼리, 다른 목적지, fragment·사용자 정보·경로 순회·Authorization 혼용은 전송 전에 거부합니다.

리디렉션은 네이티브 전송 전에 끄고 응답 URL도 비교합니다. 오류에 키나 원문을 넣지 않습니다.

## 이전 계약과 검증

`src/providers/gemini/index.ts`의 초기 `TranslationProvider` 계약은 문단 JSON을 사용했습니다. 전체 회차 구현은 `ProviderSession` 계약을 별도로 사용합니다. 두 계약을 혼용하지 않습니다.

도입 당시 검증 대상은 다음과 같습니다.

- `tests/providers/gemini/whole-chapter.test.ts`: 고정 목적지, 일반 텍스트 POST 한 번, 종료 이유 변환, 생성 가능 모델 필터를 검사했습니다.
- `tests/integration/renewal-gemini.test.tsx`: 명시적 선택과 통합 구성, Google POST 한 번, 저장본 유지, 차단·결과 불명의 미저장을 검사했습니다.
- `tests/contracts/gemini-http.test.ts`: 고정 목록 GET과 헤더 전용 키의 전송 경계를 검사했습니다.

이 검증은 모의 전송을 사용했으며 실제 Gemini 호출·실제 키·유료 요청을 사용하지 않았습니다. 현재 UI 노출 여부와 해당 테스트의 유지 여부는 현재 소스·테스트 목록을 기준으로 확인합니다. 실제 기기·계정·지역·할당량·장문 품질은 별도 승인과 검증이 필요합니다.

스트리밍 계약과 회차 통합 테스트는 합성 SSE로 미리보기, 완료 후 저장·다시 열기, 차단·출력 한도·중단·취소 시 미저장, 고정 목적지와 키 전송 경계를 검사합니다.
