# 선택형 Gemini 전체 회차 제공자 (renewal T8, issue #29)

Gemini는 renewal 경로에서만 사용할 수 있는 선택형 전체 회차 번역 제공자다. 기본값도 실패 시 대체 수단도 아니다. 사용자가 설정 화면에서 **Google Gemini**를 명시적으로 고르고, 자신의 API 키로 모델 목록을 확인한 뒤 모델을 선택해야만 Google 요청이 만들어진다.

## 사용 전 확인

1. 연결 설정에서 **Google Gemini**를 선택하고 API 기본 주소에 `https://generativelanguage.googleapis.com/v1beta`를 입력한다. 다른 호스트, HTTP, 포트, 경로, 쿼리, fragment, 사용자 정보가 있는 주소는 허용되지 않는다.
2. 인증값에 자신의 Gemini API 키를 입력하고 연결을 확인한다. 키는 Android OS 보안 저장소에만 저장되며, 일반 설정과 저장된 번역본에는 키 자체가 남지 않는다. 저장된 `authRef`로만 요청 직전에 키를 읽는다.
3. 앱은 Gemini ListModels 응답에서 `generateContent`를 지원한다고 보고한 모델만 선택 목록에 보인다. 모델 가용성, 한도, 가격, 지역별 조건은 계정과 시점에 따라 달라지므로 [Gemini 모델 문서](https://ai.google.dev/gemini-api/docs/models)와 [가격](https://ai.google.dev/gemini-api/docs/pricing)을 사용자가 직접 확인해야 한다.
4. 원문 회차는 Google로 전송되고 비용이 발생할 수 있다. 민감한 원문을 보내지 말고 [데이터 처리·이용 조건](https://ai.google.dev/gemini-api/terms)을 확인한다.

## renewal 요청 계약

- 모델 목록 확인은 고정된 `GET https://generativelanguage.googleapis.com/v1beta/models`만 사용한다.
- 사용자가 번역을 시작하면 선택한 모델의 `:generateContent`로 비스트리밍 `POST`를 정확히 한 번 보낸다. 자동 재시도, 청크 분할, 보정 요청, 다른 제공자 fallback은 없다.
- 요청 본문은 `systemInstruction`, 전체 원문 `contents`, `generationConfig.candidateCount: 1`만 사용한다. `responseFormat`, JSON schema, 문단 ID JSON 계약은 renewal Gemini 경로에 없다.
- 정상 결과는 일반 텍스트 한 덩어리다. `STOP`은 완료, `MAX_TOKENS`는 길이 제한, 안전·차단 finish reason은 차단, 나머지는 unknown으로 변환한다. 완료가 아닌 결과는 저장되지 않는다.
- 완료된 일반 텍스트는 기존 `wholeChapter` 저장 흐름으로 버전 저장된다. 저장본은 제공자를 바꿔도 삭제되거나 다시 요청되지 않으며, provenance의 connection identity는 제공자와 해당 제공자의 정규화된 endpoint를 함께 사용한다.

## 전송 및 인증 경계

- API 키는 URL 쿼리나 Bearer 토큰으로 보내지 않고 `x-goog-api-key` 헤더에만 담긴다.
- Gemini 키가 있는 `GET`은 위의 고정 models endpoint만, `POST`는 고정 Google HTTPS `generateContent` endpoint만 native client로 전달한다. 다른 host·port·path, query, fragment, userinfo, traversal, mixed `Authorization`은 dispatch 전에 거부한다.
- redirect는 native dispatch 전에 비활성화되고, 응답 URL도 요청 URL과 일치해야 한다. 요청 오류에는 키나 원문을 포함하지 않으며, POST는 자동 재시도하지 않는다.

## legacy와의 분리

기존 `src/providers/gemini/index.ts`의 legacy `TranslationProvider`는 문단 단위 JSON 계약을 계속 사용한다. renewal T8은 이를 재사용하지 않고 `ProviderSession` 전체 회차 plain-text 계약을 별도로 구현한다. legacy 경로, v1 migration, 로컬 OpenAI-compatible 제공자 계약과 저장 형식은 변경하지 않는다.

## 검증과 제한

- `tests/providers/gemini/whole-chapter.test.ts`: 고정 선택, plain-text 단일 POST, finish reason 변환, generation-capable catalog filtering.
- `tests/integration/renewal-gemini.test.tsx`: 명시적 선택, 실제 renewal composition, 단일 Google POST, 저장본 유지, blocked/unknown 미저장.
- `tests/contracts/gemini-http.test.ts`: 고정 Gemini catalog GET과 header-only 키의 fail-closed transport 경계.

모든 테스트는 mock transport를 사용한다. 개발과 검증에서 실제 Gemini API 호출, 실키 사용, 유료 요청은 하지 않았다. 실제 기기·계정·지역·할당량·모델별 장문 품질은 별도의 명시적 승인과 검증이 필요하다.
