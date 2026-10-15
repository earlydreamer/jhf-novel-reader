# Android SiwC 연결·세션·합성 번역 검증

## 연구 전용 보존 결정 — 2026-10-15

사용자 결정으로 이 코드는 제품 도입 미확정 외부 서비스 연동 연구입니다. 보존 브랜치는 `codex/research-external-services`이며, main 대상 PR #333은 병합 없이 종료했습니다. #307은 정책·개인정보·법률 검토 대기로 OPEN 상태입니다. 실제 인증·합성 번역 성공과 CI 통과는 제품 도입 승인이나 제공자 정책·법률 적합성을 뜻하지 않습니다.

제공자 정책과 실제 전송 데이터, 프로젝트의 개인정보처리방침·약관 및 적용 법률 검토, 사용자의 명시적 제품 도입 결정이 정리되기 전 이 연구 브랜치를 main에 병합하거나 제품 제공자·설정·릴리스에 노출하지 않습니다. 후속 관리 이슈는 #334이며, main의 `docs/external-service-research.md`에 도입 검토 기준을 별도 문서 PR로 전달합니다. 추가 로그인·모델 호출·소설 원문 전송은 이번 정리의 범위에 없습니다.

아래 기록은 과거 소스별 기술 실측입니다. 과거의 Draft 유지·다음 실기 단계 안내보다 위 보존 결정이 우선하며, 새로운 연구 실행이나 외부 사용량을 자동으로 승인하지 않습니다.

#307의 A 인증 왕복, B 보호 저장·갱신, C 합성 문단 1회 번역을 위한 수동 PoC 화면입니다. 제품의 ChatGPT 번역 제공자가 아닙니다. `src/debug`의 코드·manifest만 추가하며 release 빌드와 웹 설정에 노출하지 않습니다. A의 실제 성공 경로를 확인한 뒤 B·C 검증 코드를 확장했습니다.

## 최종 수정의 실제 성공 — 2026-10-15

소스 `3fc2854a84c96a71f61acb3d0202835a86232028`, 격리 패키지 APK SHA-256 `B251F36539F96B7FD18D103F474A81273A91BCF86F342FBAC7B4D2A2A34B4874`에서 사용자가 새 로그인을 완료했습니다. 인증·신원·플랜 권한·보호 저장을 16044ms에 확인했고 별도 허용한 합성 추론 1회가 실제 성공했습니다. 모델은 `gpt-6.1-sol`, HTTP 200, 첫 출력 2940ms·완료 3567ms, input 61/output 30 tokens, 최종 37자, 33프레임입니다. Content-Type은 native의 세 조회에서 모두 없었고 `response.completed` 확인 뒤 연결된 완료 항목에서 최종 텍스트를 확정했습니다(`textSource:completed_items`). 원문·번역문·응답 ID는 진단에 저장하지 않았습니다.

같은 실제 흐름에서 보호 저장 복원·refresh 회전·표시 모델 7개 조회·추론 완료·원격 철회·로컬 삭제·연결 복원 거절을 모두 확인했습니다. 세션 파일과 `.bak`·`.new` 부재도 별도 확인했습니다. 실제 흐름 1개가 통과했고 별도의 cleanup-only 메서드 1개는 기본 skip입니다. 계측 출력의 `OK (2 tests)`를 실제 계정 검사 2개 통과로 집계하지 않습니다.

해당 소스의 합성 기기 검사 28개(RSA/loopback 5·세션 9·SSE 11·HTTP 3), 기본 format/lint/typecheck·웹 118파일 1668개 검사, 웹·debug·계측·release 빌드가 통과했습니다. release manifest·DEX 2개에서 Siwc 제외도 확인했습니다. 실제 기기는 Android 10·Chrome 149.0.7827.103 한 조합입니다. 화면 잠금·브라우저 취소 등 모든 물리 조합과 장기 세션은 검증하지 않았으며 제품 제공자 전체 도입으로 확대하지 않습니다.

## 반복 로그인 부담과 후속 검증 원칙

이번 반복 로그인은 각 검증 묶음에서 세션 철회를 확인한 뒤 새 묶음을 시작한 절차 때문에 발생했습니다. 짧은 토큰 수명이나 매 번역마다 OAuth가 필요하다는 증거가 아닙니다. 공식 세션 계약은 보호 저장한 세션을 사용하고 만료 근처에 refresh를 직렬화하며 최신 회전 토큰을 보관하는 방식입니다. 반복 로그인에 대한 비정상 탐지 기준이나 위험도를 이 결과로 추정하지 않습니다.

후속 검증은 인증 왕복·세션 철회 검사를 추론 회귀 검사와 분리하고, 보관 범위를 알린 하나의 검증 묶음 안에서는 보호 세션을 재사용합니다. 추론 횟수는 별도 명시적 한도로 제한하며 세션 유지를 추가 사용량 동의로 취급하지 않습니다. 세션 철회 검증이나 연결 해제 시점에 정리하고, 일상적인 코드 변경마다 재로그인을 요구하는 절차를 반복하지 않습니다. 이미 종료한 이번 세션을 복구하거나 추가 인증·추론을 실행하지 않습니다.

## A 실제 인증 결과 (이전 소스)

2026-10-15, 소스 `9e8c7212cd4d49fedfb1304ce9fa4f17aae23af9`의 별도 패키지 APK SHA-256 `521CB26ED4C020B82F3AFC852D553DD4582F3D92D1F556BAA59311D725FCAD6B`에서 확인했습니다. Android 10 Black Shark 2·Chrome 149.0.7827.103에서 사용자가 직접 인증·동의하고 검증 화면 복귀를 확인했습니다. 앱의 비밀 없는 결과는 콜백 수신·토큰 응답·신원 검증·플랜 권한·임시 refresh 세션 철회가 모두 true, 취소 false, 경과 109451ms입니다.

이 소스는 토큰을 파일에 저장하지 않고 검증 뒤 임시 세션을 철회한 A 전용 코드입니다. 다음 B·C 코드에서 같은 인증 결과가 나왔다고 표시하지 않습니다. 모든 잠금·종료·취소 조합을 실제 계정으로 검증했다는 뜻도 아닙니다.

## B 실제 세션 결과와 C 첫 실패

소스 `ead1a4c3b7d88e8e98189669c02960c582e321bd`, 별도 패키지 APK SHA-256 `C621E9BDAAB9E96D3ADA1555BBCD35874273D0EAFC05F84A70AB00EFC0A93171`에서 사용자가 다시 로그인·복귀했습니다. 인증·신원·플랜 권한·보호 저장 true, 경과 14225ms를 확인했습니다. 테스트 앱 프로세스를 종료·재실행한 뒤 저장 연결 복원, 실제 refresh token 갱신, 표시 모델 7개 조회가 성공했습니다.

같은 소스의 명시적 실제 계정 흐름 검사는 합성 추론 1회에서 `completed:false`로 실패했습니다. 이어진 원격 철회 응답과 로컬 삭제는 true였습니다. 세션 파일과 `.bak`·`.new`의 부재도 별도 확인했습니다. 흐름 검사는 1개 실패이며 성공으로 집계하지 않습니다. 완료 뒤 복원 거절 단언은 이 실패로 실행되지 않았습니다.

이 첫 진단은 실패 시 모델 slug·HTTP 상태·SSE 종료 사유를 보존하지 않아 정확한 실패 원인과 실제 선택 모델을 확인할 수 없었습니다. 코드의 모델 우선순위 규칙을 실제 선택 모델의 증거로 대신하지 않습니다. 원시 응답이나 브라우저 로그를 덤프해 복구하지 않았고, 자동으로 두 번째 추론을 보내지 않았습니다. 사용자 요청에 따라 진단 보완 후 별도 명시적 추가 1회로 원인을 추적합니다.

소스 `99ca3dfb72c9db14ea7f4f13ad6b933cbd3bd299`, APK SHA-256 `63FCB7C35D721FFA7B2B9C38D5A5EB8EFFE83839E2A1F30767B9082D41611268`의 추가 1회도 완료하지 못했습니다. 이번 선택 모델은 `gpt-6.1-sol`, 실패 분류는 `protocol_validation`이며 취소 false였습니다. 복원·갱신·표시 모델 7개 조회와 원격 철회·로컬 삭제는 다시 성공했습니다. 이 분류는 로컬 IllegalArgumentException을 뜻하며 HTTP 권한 오류나 서버 실패 이벤트의 증거가 아닙니다. 구체적인 로컬 검증 사유는 이 소스에서도 보존하지 못했습니다.

사용자의 정밀 검증·추적 강화·추가 테스트 요청에 따라 다음 소스는 고정된 로컬 검증 사유, 코드의 component/method/line, 이벤트 종류·프레임/문자 카운터를 남깁니다. 자유 예외 메시지·스트림 내용·응답 식별자는 기록하지 않습니다. 스트림 전체/한 줄/출력 크기, 이벤트 불일치, 완료 상태/ID 불일치, content-type 검사를 구분합니다. 아직 확인하지 않은 구체 원인을 가설로 확정하지 않습니다.

## 실행 범위

같은 정밀 연결 두 번째 시도는 소스 `e809aaef95ce39009fc3b20e91f090a2e59b8e19`, APK `00E29E0DBB692191847C9BECE31B2B532493C9B34B04EA531F928EEDE2C02059`에서 헤더 검사를 통과해 `response.completed` 처리까지 도달했지만 최종 번역문 검사로 실패했습니다. 세 번째 시도는 소스 `8d8c6340f2be91b11c88e5ca033aeec0d6cc106c`, APK `3C94562054850B2DBFA32977E6207A6143AC56EF8D3E76D6535B1019FB2FDA07`에서 32개 프레임, delta 24개·36자, `output_text.done`·`output_item.done`·`response.completed` 각 1개를 확인했습니다. 첫 출력 2669ms·완료 이벤트 처리 3000ms였고 완료 이벤트의 `output`은 빈 배열이었습니다. 완료 이벤트 도달을 앱 번역 성공으로 집계하지 않습니다. 두 소스 모두 native getter와 이름/소문자 헤더 조회에서 Content-Type 부재가 확인됐습니다. 안전 진단에 원문·번역문·응답 ID를 기록하지 않았습니다.

기존 파서는 완료 이벤트의 `output`에서만 최종 문장을 찾아 거절했습니다. 후속 수정은 빈 `completed.output`에 한해 같은 스트림의 `response.created`와 완료 응답 ID, `output_item.added/done`의 index·ID·종류·역할과 모든 항목의 완료 상태를 검증한 뒤 종료된 assistant 항목의 텍스트를 사용합니다. 부분 delta를 완성본으로 승격하지 않으며 failed·incomplete·EOF·취소는 계속 실패입니다. 완료 이벤트에 실제 output이 있으면 그 최종값을 우선합니다. 이는 [공식 스트리밍 예제](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)의 텍스트 수집 뒤 완료 이벤트 확인 계약을 따르며, 이 수정의 실제 계정 성공은 별도 재검증이 필요합니다.

이번 정밀 연결은 3회 예산을 모두 사용했고 추가 추론 없이 종료했습니다. 실제 원격 철회 응답·로컬 삭제·연결 복원 거절을 확인했고 세션 파일과 `.bak`·`.new` 부재를 별도 확인했습니다. 실제 스트림 취소 시나리오는 원인 확인에 마지막 시도를 사용해 미실행이며 합성 취소 검사와 구분합니다. 원인 수정 뒤의 새 실제 1회가 남아 PR은 Draft로 유지합니다.

정밀 진단 소스 `790a8dc0c75571fe7fc2be7c3930ebf8e8e35785`, APK SHA-256 `FE1A6C303D3908B80288C484A369DDE8A106449B515A0B46140A90CB5274B099`의 같은 연결 첫 시도는 `gpt-6.1-sol`, HTTP 200에서 `content_type` 검증으로 중단됐습니다. native `getContentType()`가 null이라 SSE 본문을 읽기 전에 거절한 위치까지 확인했습니다. 실제 서버의 wire 헤더 누락이나 앞선 두 실패의 동일 원인까지 입증한 것은 아닙니다. 보호 저장·복원·표시 모델 7개 조회는 성공했고 정밀 진단 예산 3회 중 1회를 사용했습니다.

후속 수정은 Content-Type이 없을 때 고정된 공식 HTTPS Responses 경로의 본문을 기존 SSE 파서로 검증합니다. 명시적인 비 SSE 형식은 거절하며 typed 이벤트·완료 상태·응답 ID·최종 assistant text·크기 제한을 유지합니다. 헤더 getter와 대소문자 이름 조회의 안전한 MIME 분류, 프레임/문자 수만 추가 기록합니다. 합성 HTTP 200의 헤더 누락 성공, 명시 JSON 거절, completed 없는 EOF 거절과 첫 delta 뒤 취소를 회귀 검사합니다. 실제 수정 성공은 후속 명시적 요청으로 별도 판정합니다.

별도 applicationId의 debug APK를 허가된 기기에 설치합니다. `SiwcProbeActivity`를 실행해도 인증은 시작되지 않습니다. 사용자가 화면의 **Continue with ChatGPT**를 누른 뒤 시스템 브라우저에서 직접 로그인·권한 동의를 진행합니다. 계정·인증 URL·토큰을 진단으로 내보내거나 화면을 녹화하지 않습니다.

고정된 공식 인증 주소, HTTP `127.0.0.1:<port>/auth/callback`, PKCE S256·state·nonce, 발급 client ID, 공식 JWKS의 RS256 서명과 issuer·audience·만료를 검증합니다. 토큰 응답의 플랜 권한은 신원 검증과 별도로 판정합니다. 엔드포인트나 콜백 값은 외부 Intent로 받지 않습니다.

리스너는 브라우저 전환의 `onPause`에서 취소하지 않으며, 유효 콜백을 한 번 받거나 취소·5분 제한·Activity 종료 시 닫습니다. 잘못된 Host·경로·중복 query·state는 인증하지 않습니다. 프로세스 종료 후 대기 시도를 복원하지 않고 새 state·nonce·verifier로 다시 시작합니다. 토큰 교환 POST는 결과 불명에도 자동 재전송하지 않습니다.

현재 B·C 화면은 인증·플랜 권한을 확인한 세션을 Android Keystore AES-256-GCM으로 암호화해 앱 전용 `noBackupFilesDir`에 원자적으로 저장합니다. 네이티브 토큰을 WebView·JS 브리지·일반 설정에 넘기지 않도록 debug 전용 저장소를 둡니다. 암호 키를 내보내거나 파일에 저장하지 않으며 복호화 실패 시 평문이나 새 키로 대체하지 않습니다. 인증 실패·취소로 저장하지 못한 토큰 응답은 임시 refresh 세션 철회를 시도합니다.

저장에 성공한 B 세션은 **사용자가 명시적으로 연결 해제를 실행할 때까지 유지**합니다. 화면에도 이 차이를 안내하며 이전 A 토큰은 재사용하지 않습니다. 연결 해제는 먼저 사용 중지 표식을 저장하고, 원격 refresh 세션 철회와 로컬 삭제를 진행합니다. HTTP 200 확인 여부와 로컬 삭제를 나누어 표시합니다. 교환 결과가 불명하거나 철회를 확인하지 못하면 사용자가 ChatGPT 연결 관리에서 확인합니다. 브라우저 로그인 자체와 등록 client를 삭제하는 작업은 아닙니다. JVM 문자열의 즉시 물리적 삭제를 보장하지 않습니다.

안정된 host ID, 검증된 계정 식별자와 발급 client ID는 별도 등록 메타데이터에 보존합니다. access/refresh/ID token은 암호화한 세션 파일에만 저장합니다. 재로그인 시 같은 client ID를 사용하며 다른 계정의 검증된 식별자로 바뀌면 거절합니다. 활성 세션이 있으면 새 로그인으로 덮어쓰지 않고 먼저 연결 해제를 요구합니다. 여러 계정 선택 UI는 이 PoC 범위에 없습니다. 검증 화면에는 `FLAG_SECURE`를 적용합니다.

사용자가 시작한 인증 시도가 끝나면 `noBackupFilesDir/siwc-probe-result.json`에 콜백·토큰 응답 수신·신원·플랜 권한·보호 저장·철회 확인 여부와 경과 시간·고정 결과 문구만 기록합니다. 이 파일의 `completed`는 시도 종료를 뜻하며 인증 성공과 다릅니다. `siwc-session-result.json`에는 복원·갱신·모델 목록 수·연결 해제의 성패를, `siwc-inference-result.json`에는 합성 추론 시도·완료 여부·모델 slug·첫 출력/완료 시간·완료 이벤트의 input/output token 수·번역문 글자 수만 기록합니다. 계정·등록 ID·토큰·인증 URL·번역문·원시 응답은 진단 파일에 넣지 않습니다. 이 진단 파일만 읽고 앱 전체 저장소나 브라우저 로그는 덤프하지 않습니다.

실패 진단은 모델 slug, HTTP 상태, 응답 형태(`error` 객체·`detail` 문자열·기타 JSON·비 JSON·빈 본문·읽기 실패), 알려진 오류 코드·파라미터·SSE 종료 이벤트, 검증된 요청 ID와 고정 어휘의 존재 여부를 남깁니다. 서버의 자유 문장·detail·message는 복사하지 않습니다. 이는 단어의 존재를 보여 주는 단서이며 서버 정책의 확정 설명으로 취급하지 않습니다. 공식 문서의 직접 진입 401/403/503과 Responses 구조화 오류를 구분하여 다음 행동을 정합니다. [공식 오류와 복구](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

## B·C 검증 순서와 중단 조건

1. **Continue with ChatGPT**로 다시 로그인합니다. 이후 연결 토큰을 이 테스트 앱에 보호 저장한다는 안내를 읽고 시작합니다. 인증을 직접 진행하고 화면에 돌아옵니다.
2. **보호 저장 연결 복원**으로 복호화를 확인합니다. 앱 프로세스를 종료하고 다시 실행한 뒤 같은 동작으로 재시작 복원을 확인합니다.
3. **토큰 갱신 검증 1회**로 회전 토큰을 받습니다. 갱신은 프로세스 내 공통 잠금으로 직렬화하며 요청 전 `refreshing`을 저장합니다. 결과 불명·프로세스 종료 뒤에는 이전 refresh token으로 재전송하지 않고 재인증을 요구합니다. 새 회전 토큰을 보호 저장한 뒤 서명된 ID token이 있으면 계정 일치를 검증합니다. 실패한 새 토큰은 추론에 쓰지 않고 명시적 철회에만 사용할 수 있습니다.
4. **계정 모델 목록 읽기**로 공식 `models` 배열 중 `visibility:list`인 모델만 표시합니다. 화면에서 모델을 선택합니다. 모델 목록의 성공만으로 추론 접근 성공으로 판정하지 않습니다.
5. **합성 문단 번역 1회**로 화면에 공개된 합성 문단과 번역 지침만 전송합니다. `POST https://api.openai.com/v1/responses`, `stream:true`, `store:false`, `input` 배열을 사용하고 미지원 temperature·출력 상한·이전 응답 ID를 넣지 않습니다. API 키·다른 제공자로 자동 전환하지 않습니다.
6. delta는 화면에 수신 중으로만 표시합니다. `response.completed`의 최종 assistant text를 받은 경우에만 완료로 판정합니다. failed·incomplete·명시적 error·EOF·취소는 완료로 저장하지 않습니다. 추론 시작 표식을 보호 저장하므로 결과 불명·재시작 후 같은 연결에서 두 번째 POST를 보낼 수 없습니다. 번역 중 앱 전환은 전송을 취소하며 자동 재개하지 않습니다.
7. **연결 해제**로 원격 철회 응답과 로컬 삭제를 각각 확인합니다. 전체 제품의 용어집·정밀스캔·제목·미리 번역·다중 계정 기능은 구현하지 않습니다.

정밀 진단을 별도로 요청한 경우에만 **정밀 진단 허용 · 같은 연결 총 3회**를 실행할 수 있습니다. 기본 연결의 1회 한도를 총 3회로 늘리되 이미 사용한 시도 수는 초기화하지 않습니다. 한도·시도 수는 암호화한 세션에 저장하며 재시작·갱신·허용 버튼 반복으로 되돌릴 수 없습니다. 각각의 추론은 별도 명시적 실행이며 결과 불명도 시도 수에 포함합니다. 서버의 권한·한도·지원 불가 오류를 확인하면 같은 잘못된 요청을 반복하지 않습니다.

## 빌드와 합성 검사

기본 검사와 `npm run android:sync` 뒤 Android debug·계측 APK를 빌드합니다. 테스트 패키지 ID는 외부 Gradle init의 `defaultConfig.applicationId`로 지정하며 제품 applicationId를 변경하여 커밋하지 않습니다. 빌드 소스 커밋과 APK SHA-256을 기록합니다. 패키지 ID가 다른 검증 산출물을 정식 CI APK로 표시하지 않습니다.

```powershell
# 검증 전용 package ID로 빌드한 APK에만 사용합니다.
adb.exe -s <허가된 기기> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb.exe -s <허가된 기기> install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb.exe -s <허가된 기기> shell am instrument -w -e class dev.earlydreamer.jhfreader.SiwcProbeInstrumentedTest dev.earlydreamer.jhfreader.issue307.test/androidx.test.runner.AndroidJUnitRunner
adb.exe -s <허가된 기기> shell am start -W -n dev.earlydreamer.jhfreader.issue307/dev.earlydreamer.jhfreader.SiwcProbeActivity
```

`SiwcProbeInstrumentedTest`는 합성 RSA 키와 로컬 HTTP 요청만 사용합니다. PKCE 알려진 벡터, state·중복 query·client 혼합 거절, 잘못된 Host·오래된 state 이후 유효 콜백 한 번 수신, 취소·시간 초과의 리스너 종료, 서명·issuer·audience·만료·nonce 거절을 검사합니다. 이 검사는 브라우저 로그인·실제 OAuth 토큰·원격 철회 성공을 입증하지 않습니다. CI의 `assembleDebugAndroidTest`는 계측 코드 컴파일이며 기기 실행과 구분합니다.

`SiwcSessionInstrumentedTest`는 테스트 전용 Keystore alias와 합성 토큰으로 암호화·재열기·변조·키 소실·계정 분리·동시 갱신·결과 불명 재사용 차단·새 토큰 철회·추론 중복 방지를 검사합니다. `SiwcResponsesInstrumentedTest`는 완료·후발 실패·불완전·연결 종료·취소·요청 계약을 검사합니다. `SiwcNetworkInstrumentedTest`는 Android 전송 계층의 고정 길이 POST에서 본문 수신 뒤 연결 절단의 재전송 부재와 리디렉션·401에서 bearer 전송/POST 반복 부재를 합성 HTTP loopback으로 검사합니다. 합성 HTTP 검사가 실제 OpenAI TLS·구독 모델의 성공을 입증하지 않습니다.

`SiwcManualFlowInstrumentedTest`는 기본적으로 skip합니다. 사용자가 B 로그인을 완료하고 실제 합성 1회 검증을 진행할 때만 아래 명령으로 명시적으로 실행합니다. `.issue307` 패키지·사용자 로그인 완료 진단·이전 추론 결과 부재를 요구하며, 인증을 시작하거나 토큰 파일을 읽지 않습니다. 같은 네이티브 버튼을 실행해 복원·갱신·모델 목록·합성 1회·연결 해제를 검사합니다. 계정 목록에서 `gpt-6.1-sol`이 보이면 선택하고 없으면 첫 표시 모델을 선택합니다. 실패 후에는 추론을 반복하지 않고 연결 해제만 시도합니다. `siwc-manual-result.json`에는 단계별 성패만 기록합니다. 일반 기기 검사에서 이 인자를 켜지 않습니다.

```powershell
# 사용자 로그인과 공유 한도 사용 범위를 확인한 실제 검증에서만 실행합니다.
adb.exe -s <허가된 기기> shell am instrument -w -e siwcManualFlow true -e class dev.earlydreamer.jhfreader.SiwcManualFlowInstrumentedTest dev.earlydreamer.jhfreader.issue307.test/androidx.test.runner.AndroidJUnitRunner
```

원인을 추적하는 동안 재로그인을 반복하지 않으려면 사용자에게 보관·추가 실행 범위를 알린 뒤 `-e siwcDiagnostic true`를 함께 지정합니다. 이 모드는 강제 토큰 갱신을 생략해 비교 조건을 유지하고, native 버튼으로 총 3회 진단 한도를 명시적으로 허용하며, 실행마다 추론 한 번만 시도합니다. 성공·실패 뒤 연결을 암호화한 상태로 유지합니다. 다음 실행 전 이전 안전 진단을 보존하고 해당 추론 진단 파일만 정리해야 하며 암호화한 시도 수는 지우지 않습니다. 검증 종료 시 반드시 **연결 해제**를 실행하고 원격 철회·로컬 삭제를 확인합니다. 기본 CI와 합성 기기 검사에는 두 실제 계정 인자를 지정하지 않습니다.

## 사용자 참여 검증표

정밀 진단의 마지막 시도를 실제 첫 출력 뒤 취소 검사에 쓸 때만 `-e siwcCancelAfterDelta true`를 두 실제 계정 인자와 함께 지정합니다. 첫 부분 출력 UI 갱신을 관측한 뒤 같은 native 취소 버튼을 호출하고 completed false와 cancelled true를 요구합니다. 빠른 완료로 취소가 늦으면 실패로 기록하며 추가 요청을 자동 실행하지 않습니다. 검증 종료의 별도 철회·삭제 검사는 `-e siwcDisconnectOnly true`만 지정하며 추론을 실행하지 않습니다. `siwc-cleanup-result.json`에 원격 철회 확인·로컬 삭제·복원 거절만 남깁니다.

기기 OS·브라우저 버전·소스·APK 해시를 고정한 뒤 다음을 개별 기록합니다. 실제 인증은 사람이 수행하며 브라우저 주소·계정 화면을 캡처하거나 로그를 수집하지 않습니다.

- Continue → 시스템 브라우저 → 사용자 동의 → loopback → 코드 교환 → ID 검증 → 원래 화면으로 수동 복귀
- 짧은 로그인과 오래 걸린 로그인, 브라우저 뒤로가기와 앱 취소, 앱 전환과 잠금 후 복귀
- 취소·시간 초과 뒤 예전 콜백 거절, 앱 프로세스 종료 뒤 새 시도
- 검증된 신원과 플랜 권한의 별도 결과, 임시 refresh 세션 철회 HTTP 응답
- 기존 앱과 별도 패키지 설치 여부, 기존 설정·서재를 읽거나 쓰지 않는 범위

이 표가 통과하기 전 Android 연결 성공이나 제품 지원 완료를 주장하지 않습니다. 합성 테스트·컴파일과 실제 사용자 인증의 결과를 나누어 #307과 PR에 기록합니다. B·C가 남아 있는 동안 #307을 닫지 않습니다.

## 공식 계약

2026-10-15 재확인했습니다. 실제 OIDC discovery의 issuer·authorization/token/JWKS/revocation endpoint도 공식 주소와 일치함을 읽기 전용으로 확인했습니다. 이 조회는 사용자 인증이나 토큰 발급이 아닙니다.

- [등록·브라우저·PKCE·ID 검증](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [계정별 세션과 철회](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [모델과 추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [프리뷰 요청 제약](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [공식 discovery](https://auth.openai.com/.well-known/openid-configuration)
