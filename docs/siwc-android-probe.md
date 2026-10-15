# Android SiwC 연결·세션·합성 번역 검증

#307의 A 인증 왕복, B 보호 저장·갱신, C 합성 문단 1회 번역을 위한 수동 PoC 화면입니다. 제품의 ChatGPT 번역 제공자가 아닙니다. `src/debug`의 코드·manifest만 추가하며 release 빌드와 웹 설정에 노출하지 않습니다. A의 실제 성공 경로를 확인한 뒤 B·C 검증 코드를 확장했습니다.

## A 실제 인증 결과

2026-10-15, 소스 `9e8c7212cd4d49fedfb1304ce9fa4f17aae23af9`의 별도 패키지 APK SHA-256 `521CB26ED4C020B82F3AFC852D553DD4582F3D92D1F556BAA59311D725FCAD6B`에서 확인했습니다. Android 10 Black Shark 2·Chrome 149.0.7827.103에서 사용자가 직접 인증·동의하고 검증 화면 복귀를 확인했습니다. 앱의 비밀 없는 결과는 콜백 수신·토큰 응답·신원 검증·플랜 권한·임시 refresh 세션 철회가 모두 true, 취소 false, 경과 109451ms입니다.

이 소스는 토큰을 파일에 저장하지 않고 검증 뒤 임시 세션을 철회한 A 전용 코드입니다. 다음 B·C 코드에서 같은 인증 결과가 나왔다고 표시하지 않습니다. 모든 잠금·종료·취소 조합을 실제 계정으로 검증했다는 뜻도 아닙니다.

## 실행 범위

별도 applicationId의 debug APK를 허가된 기기에 설치합니다. `SiwcProbeActivity`를 실행해도 인증은 시작되지 않습니다. 사용자가 화면의 **Continue with ChatGPT**를 누른 뒤 시스템 브라우저에서 직접 로그인·권한 동의를 진행합니다. 계정·인증 URL·토큰을 진단으로 내보내거나 화면을 녹화하지 않습니다.

고정된 공식 인증 주소, HTTP `127.0.0.1:<port>/auth/callback`, PKCE S256·state·nonce, 발급 client ID, 공식 JWKS의 RS256 서명과 issuer·audience·만료를 검증합니다. 토큰 응답의 플랜 권한은 신원 검증과 별도로 판정합니다. 엔드포인트나 콜백 값은 외부 Intent로 받지 않습니다.

리스너는 브라우저 전환의 `onPause`에서 취소하지 않으며, 유효 콜백을 한 번 받거나 취소·5분 제한·Activity 종료 시 닫습니다. 잘못된 Host·경로·중복 query·state는 인증하지 않습니다. 프로세스 종료 후 대기 시도를 복원하지 않고 새 state·nonce·verifier로 다시 시작합니다. 토큰 교환 POST는 결과 불명에도 자동 재전송하지 않습니다.

현재 B·C 화면은 인증·플랜 권한을 확인한 세션을 Android Keystore AES-256-GCM으로 암호화해 앱 전용 `noBackupFilesDir`에 원자적으로 저장합니다. 네이티브 토큰을 WebView·JS 브리지·일반 설정에 넘기지 않도록 debug 전용 저장소를 둡니다. 암호 키를 내보내거나 파일에 저장하지 않으며 복호화 실패 시 평문이나 새 키로 대체하지 않습니다. 인증 실패·취소로 저장하지 못한 토큰 응답은 임시 refresh 세션 철회를 시도합니다.

저장에 성공한 B 세션은 **사용자가 명시적으로 연결 해제를 실행할 때까지 유지**합니다. 화면에도 이 차이를 안내하며 이전 A 토큰은 재사용하지 않습니다. 연결 해제는 먼저 사용 중지 표식을 저장하고, 원격 refresh 세션 철회와 로컬 삭제를 진행합니다. HTTP 200 확인 여부와 로컬 삭제를 나누어 표시합니다. 교환 결과가 불명하거나 철회를 확인하지 못하면 사용자가 ChatGPT 연결 관리에서 확인합니다. 브라우저 로그인 자체와 등록 client를 삭제하는 작업은 아닙니다. JVM 문자열의 즉시 물리적 삭제를 보장하지 않습니다.

안정된 host ID, 검증된 계정 식별자와 발급 client ID는 별도 등록 메타데이터에 보존합니다. access/refresh/ID token은 암호화한 세션 파일에만 저장합니다. 재로그인 시 같은 client ID를 사용하며 다른 계정의 검증된 식별자로 바뀌면 거절합니다. 활성 세션이 있으면 새 로그인으로 덮어쓰지 않고 먼저 연결 해제를 요구합니다. 여러 계정 선택 UI는 이 PoC 범위에 없습니다. 검증 화면에는 `FLAG_SECURE`를 적용합니다.

사용자가 시작한 인증 시도가 끝나면 `noBackupFilesDir/siwc-probe-result.json`에 콜백·토큰 응답 수신·신원·플랜 권한·보호 저장·철회 확인 여부와 경과 시간·고정 결과 문구만 기록합니다. 이 파일의 `completed`는 시도 종료를 뜻하며 인증 성공과 다릅니다. `siwc-session-result.json`에는 복원·갱신·모델 목록 수·연결 해제의 성패를, `siwc-inference-result.json`에는 합성 추론 시도·완료 여부·모델 slug·첫 출력/완료 시간·완료 이벤트의 input/output token 수·번역문 글자 수만 기록합니다. 계정·등록 ID·토큰·인증 URL·번역문·원시 응답은 진단 파일에 넣지 않습니다. 이 진단 파일만 읽고 앱 전체 저장소나 브라우저 로그는 덤프하지 않습니다.

## B·C 검증 순서와 중단 조건

1. **Continue with ChatGPT**로 다시 로그인합니다. 이후 연결 토큰을 이 테스트 앱에 보호 저장한다는 안내를 읽고 시작합니다. 인증을 직접 진행하고 화면에 돌아옵니다.
2. **보호 저장 연결 복원**으로 복호화를 확인합니다. 앱 프로세스를 종료하고 다시 실행한 뒤 같은 동작으로 재시작 복원을 확인합니다.
3. **토큰 갱신 검증 1회**로 회전 토큰을 받습니다. 갱신은 프로세스 내 공통 잠금으로 직렬화하며 요청 전 `refreshing`을 저장합니다. 결과 불명·프로세스 종료 뒤에는 이전 refresh token으로 재전송하지 않고 재인증을 요구합니다. 새 회전 토큰을 보호 저장한 뒤 서명된 ID token이 있으면 계정 일치를 검증합니다. 실패한 새 토큰은 추론에 쓰지 않고 명시적 철회에만 사용할 수 있습니다.
4. **계정 모델 목록 읽기**로 공식 `models` 배열 중 `visibility:list`인 모델만 표시합니다. 화면에서 모델을 선택합니다. 모델 목록의 성공만으로 추론 접근 성공으로 판정하지 않습니다.
5. **합성 문단 번역 1회**로 화면에 공개된 합성 문단과 번역 지침만 전송합니다. `POST https://api.openai.com/v1/responses`, `stream:true`, `store:false`, `input` 배열을 사용하고 미지원 temperature·출력 상한·이전 응답 ID를 넣지 않습니다. API 키·다른 제공자로 자동 전환하지 않습니다.
6. delta는 화면에 수신 중으로만 표시합니다. `response.completed`의 최종 assistant text를 받은 경우에만 완료로 판정합니다. failed·incomplete·명시적 error·EOF·취소는 완료로 저장하지 않습니다. 추론 시작 표식을 보호 저장하므로 결과 불명·재시작 후 같은 연결에서 두 번째 POST를 보낼 수 없습니다. 번역 중 앱 전환은 전송을 취소하며 자동 재개하지 않습니다.
7. **연결 해제**로 원격 철회 응답과 로컬 삭제를 각각 확인합니다. 전체 제품의 용어집·정밀스캔·제목·미리 번역·다중 계정 기능은 구현하지 않습니다.

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

## 사용자 참여 검증표

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
