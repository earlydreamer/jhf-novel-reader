# ChatGPT 계정 연결

설정의 **번역 서버 → 제공자 → ChatGPT**를 고르면 전송 대상(OpenAI)·플랜 사용량·연결 해제 방법을 먼저 안내합니다. **ChatGPT 사용하기**를 누른 뒤 **Continue with ChatGPT**로 시스템 브라우저에서 로그인하고 권한에 동의합니다. 앱으로 돌아오면 연결 상태와 계정에서 쓸 수 있는 모델 목록을 확인하고 모델을 고릅니다. API 키는 쓰지 않습니다.

ChatGPT 연결은 Android 앱에서만 제공합니다. 웹 미리보기에는 로그인 정보를 안전하게 보관할 곳이 없어 제공자 목록에서 고를 수 없습니다. 이 연결은 [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)의 오픈소스·로컬 앱 경로를 따릅니다.

## 로그인

- 앱 안의 원문 사이트 WebView가 아니라 시스템 브라우저로 `https://auth.openai.com/api/accounts/authorize`를 엽니다. 주소와 매개변수는 고정이며 외부 입력으로 바꾸지 않습니다.
- OAuth Authorization Code와 PKCE S256을 씁니다. 시도마다 `state`·`nonce`·code verifier를 새로 만듭니다. 콜백은 브라우저를 열기 전에 연 `http://127.0.0.1:<임의 포트>/auth/callback`에서만 받습니다. Host·경로·중복 질의·`state`가 맞지 않는 요청은 인증하지 않고 다음 요청을 기다립니다.
- 수신기는 브라우저로 전환해도 닫지 않습니다. 유효한 콜백을 한 번 받거나, 사용자가 **로그인 취소**를 누르거나, 5분이 지나거나, 앱이 종료되면 닫습니다. 프로세스가 끝난 뒤에는 대기 중이던 시도를 이어 가지 않고 새로 시작합니다.
- 첫 로그인은 `client_id=dynamic_agent_client`와 앱 이름으로 등록하고, 콜백이 돌려준 발급 client ID(`oaiapp_…`)를 보관합니다. 다음 로그인은 같은 client ID와 설치별 host ID(`urn:uuid:…`)를 씁니다. 콜백의 client ID가 보관한 값과 다르면 거절합니다.
- 인가 코드 교환 POST는 결과를 알 수 없어도 다시 보내지 않습니다. ID token은 공식 JWKS의 RS256 서명과 issuer·audience·만료·nonce를 확인합니다. 플랜 사용 권한은 신원 검증과 따로, 토큰 응답의 `scope`에 `chatgpt.tokens.use.direct`가 있는지로 판정합니다.
- 권한이 없는 계정, 이 기기에서 전에 연결한 계정과 다른 계정, 검증에 실패한 응답은 저장하지 않고 받은 refresh token의 철회를 시도합니다. 취소·권한 거부·시간 초과도 연결을 저장하지 않으며 바로 다시 시도할 수 있습니다.
- 플랜 사용을 처음 켰을 때 한 번 "ChatGPT 플랜을 사용하고 있어요" 안내와 사용량 관리 링크(`https://chatgpt.com/settings/usage`)를 보여 줍니다. 공식 UI 안내의 문구를 앱 언어로 옮긴 것입니다.

## 토큰 보관과 갱신

- 토큰은 `ChatGptPlugin` 안에서만 다룹니다. Android Keystore AES-256-GCM 키로 암호화해 백업되지 않는 앱 전용 저장소(`noBackupFilesDir`)에 둡니다. 시스템 백업은 꺼져 있고 앱의 백업 파일도 이 폴더를 담지 않습니다.
- 웹 화면·JS 브리지·일반 설정·저장본·진단에는 토큰과 계정 식별자를 넘기지 않습니다. 설정에는 제공자와 고정 주소 `https://api.openai.com/v1`, 선택한 모델만 저장합니다. 모델 요청은 네이티브가 토큰을 붙여 보냅니다.
- 세션 파일과 등록 파일(host ID·발급 client ID·검증된 계정)을 나눠 둡니다. 연결 해제는 세션 파일만 지우고 등록은 다음 로그인에 다시 씁니다.
- access token은 만료 5분 전부터 갱신합니다. 갱신은 같은 잠금으로 직렬화하고 요청 전에 갱신 중 표식을 저장합니다. 응답을 받지 못한 갱신은 회전 결과를 알 수 없으므로 이전 refresh token을 다시 쓰지 않고 다시 로그인을 요구합니다. 공식 종료 오류(`invalid_grant`, `refresh_token_reused` 등)는 세션을 지우고, 서버가 5xx로 답한 갱신은 토큰을 유지합니다.
- 응답이 `subscription_sharing_invalid_user`로 연결 해제를 확인하면 저장한 세션을 더 쓰지 않습니다. 일시적인 실패로는 로그인 정보를 지우지 않습니다.

## 모델 목록과 연결 해제

- 모델 목록은 `GET https://api.openai.com/v1/models`의 `models` 중 `visibility`가 `list`인 항목만 서버 순서대로 보여 줍니다. 목록 조회에 성공했다고 해서 번역 요청 권한까지 확인한 것은 아닙니다.
- **연결 해제**는 먼저 해제 중 표식을 저장하고 `https://auth.openai.com/api/accounts/oauth/revoke`로 refresh token 철회를 요청한 뒤 로컬 세션을 지웁니다. 네트워크 실패·5xx는 짧게 물러난 뒤 두 번까지 다시 시도합니다. 빈 200으로 철회를 확인하지 못하면 로컬 삭제와 나눠 알리고 ChatGPT 설정의 연결된 앱에서 확인하도록 안내합니다.
- 번역·미리 번역·정밀스캔·제목 번역이 ChatGPT 연결을 쓰는 중에는 해제하지 않습니다.

## 회차 번역

- 요청은 `POST https://api.openai.com/v1/responses`에 `model`·`instructions`·`input`·`store:false`·`stream:true`만 담습니다. SiwC가 받지 않는 temperature·`max_output_tokens`·`previous_response_id`는 넣지 않으며 네이티브도 허용 목록 밖의 필드를 거절합니다.
- 구조화 출력 지원이 문서로 확인되지 않아 로컬 스트리밍과 같은 문단 ID 형식(`<main><p id="…">`)을 씁니다. 작품 용어집·공용 용어집·말투·줄거리는 다른 제공자와 같은 선별 규칙으로 넣고, 문단 순서·ID·필수 표기를 확인한 뒤 회차 전체가 완료되면 기존 저장 흐름으로 저장합니다. 적용한 용어집 해시와 `provenance.provider: "chatgpt"`를 저장본에 남기고 독서 화면에 `ChatGPT`로 표시합니다.
- 도착한 delta는 저장 전 미리보기에만 씁니다. `response.completed`의 최종 assistant 텍스트를 확인해야 완료입니다. 완료 이벤트의 `output`이 비어 있으면 같은 응답에서 열고 닫은 모든 출력 항목이 완료됐을 때만 그 텍스트를 씁니다. `response.failed`·`response.incomplete`·연결 종료는 완료본으로 저장하지 않습니다. 서버가 Content-Type을 주지 않아도 본문을 SSE로 해석합니다.
- 문단 재번역·실패 문단 자동 재번역·제목 자동/직접 번역·읽는 회차 자동 번역은 다른 제공자와 같은 설정과 횟수 제한을 따릅니다. 결과를 알 수 없는 요청은 다시 보내지 않습니다.

## 자동 용어집·정밀스캔·표기 채우기

- 세 기능은 다른 제공자와 같은 후보 선별·판정 횟수·저장 기준을 씁니다. 정밀스캔은 묶음마다 세 번 판정하고, 표기 채우기는 결과를 검토 화면의 제안으로만 남깁니다.
- 판정 요청도 `store:false`·`stream:true`로만 보냅니다. temperature와 출력 상한은 넣지 않습니다. 구조화 출력(`text.format: json_schema`)은 SiwC 문서에 지원 여부가 없어 먼저 보내 보고, `subscription_sharing_unsupported_capability`로 거절되면 [공식 복구 기준](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)대로 그 입력을 빼고 스키마를 지시문에 넣어 한 번만 다시 보냅니다. 같은 세션에서는 구조화 출력을 다시 보내지 않습니다.
- 응답은 `response.completed`의 최종 텍스트를 JSON으로 읽습니다. 코드 펜스만 걷어 내며 그 밖의 보정은 하지 않습니다.

## 오류 안내

| 상황                                                               | 앱의 처리                                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `subscription_sharing_user_not_eligible`(403)                      | 플랜으로 쓸 수 없다고 안내합니다. 다시 보내거나 로그인을 반복하지 않습니다.                         |
| `subscription_sharing_usage_limit_exceeded`(429)                   | 사용 한도 도달을 안내하고 ChatGPT 설정의 사용량을 확인하게 합니다. 초기화 시각을 추정하지 않습니다. |
| `subscription_sharing_invalid_user`(401), 갱신 결과 불명·종료 오류 | 다시 로그인을 요구합니다.                                                                           |
| 그 밖의 401·403·5xx                                                | 연결 상태에 HTTP 상태와 함께 안내합니다.                                                            |

오류 본문은 네이티브에서 허용 어휘의 `code`·`param`만 남기고 서버 문장·`detail`·요청 ID는 버립니다. 어떤 오류에서도 다른 제공자나 API 키 과금 경로로 바꾸지 않습니다. 앱이 백그라운드로 가면 진행 중인 모델 요청을 끊고 새 요청을 받지 않습니다. 로그인 대기는 이 규칙의 예외입니다.

## 검증

- JVM 단위 검사(`ChatGptProtocolTest`·`ChatGptLoopbackTest`·`ChatGptSessionTest`): PKCE 알려진 벡터, 인증 주소, 콜백 Host·경로·중복 질의·state, 합성 RSA 키의 ID token 서명·클레임, 모델 목록, 오류 축약, 요청 본문 허용 목록, 로그인 저장·권한 없음 철회·계정 불일치·교환 결과 불명, 갱신 회전·결과 불명·종료 오류·5xx, 연결 해제를 검사합니다.
- 웹 통합 검사(`tests/integration/chatgpt-account.test.tsx`, `tests/platform/chatgpt.test.ts`)는 가짜 계정 연결로 로그인·취소·모델 목록 오류·연결 해제·설정 저장과 설정 화면 흐름을 확인합니다.
- 번역 검사(`tests/providers/chatgpt/responses.test.ts`, [제공자 기능 검사](../tests/integration/provider-capabilities.test.tsx))는 Responses SSE의 완료·빈 완료 출력·중간 실패·불완전·EOF와 요청 필드, 기능 표의 ChatGPT 칸, 저장본 출처·해시, 한도 오류의 저장·재전송 금지를 확인합니다.
- 합성 검사는 실제 OpenAI 로그인·TLS·계정 플랜의 성공을 입증하지 않습니다. 실제 계정 검증은 계정 소유자가 로그인과 동의를 직접 진행하는 기기 검증에서 기록합니다.
