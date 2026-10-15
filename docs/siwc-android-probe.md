# Android SiwC 인증 검증

#307의 A 단계용 수동 검증 화면입니다. 제품의 ChatGPT 번역 제공자가 아닙니다. `src/debug`의 Activity·인증 코드·manifest만 추가하며 release 빌드와 웹 설정에 노출하지 않습니다. 실제 계정 인증을 마치기 전 B 세션 보호 저장·C 추론으로 진행하지 않습니다.

## 실행 범위

별도 applicationId의 debug APK를 허가된 기기에 설치합니다. `SiwcProbeActivity`를 실행해도 인증은 시작되지 않습니다. 사용자가 화면의 **Continue with ChatGPT**를 누른 뒤 시스템 브라우저에서 직접 로그인·권한 동의를 진행합니다. 계정 정보·인증 URL·토큰·화면 녹화를 수집하지 않습니다.

고정된 공식 인증 주소, HTTP `127.0.0.1:<port>/auth/callback`, PKCE S256·state·nonce, 발급 client ID, 공식 JWKS의 RS256 서명과 issuer·audience·만료를 검증합니다. 토큰 응답의 플랜 권한은 신원 검증과 별도로 판정합니다. 엔드포인트나 콜백 값은 외부 Intent로 받지 않습니다.

리스너는 브라우저 전환의 `onPause`에서 취소하지 않으며, 유효 콜백을 한 번 받거나 취소·5분 제한·Activity 종료 시 닫습니다. 잘못된 Host·경로·중복 query·state는 인증하지 않습니다. 프로세스 종료 후 대기 시도를 복원하지 않고 새 state·nonce·verifier로 다시 시작합니다. 토큰 교환 POST는 결과 불명에도 자동 재전송하지 않습니다.

검증용 토큰은 파일에 저장하지 않습니다. 토큰 응답을 받으면 검증 실패·취소 여부와 관계없이 임시 refresh 세션의 원격 철회를 시도하고 HTTP 200 확인 여부를 따로 표시합니다. 교환 결과가 불명하거나 refresh token이 없으면 원격 철회를 확인했다고 표시하지 않습니다. 이런 경우 사용자가 ChatGPT 연결 관리에서 확인합니다. 브라우저 로그인 자체와 등록 client를 삭제하는 작업은 아닙니다. JVM 문자열을 즉시 물리적으로 지운다는 보장은 없으며 장기 토큰 보호 저장은 B 단계의 별도 검증입니다.

안정된 host ID, 검증된 계정 식별자와 발급 client ID만 앱 전용 `noBackupFilesDir`에 원자적으로 보존합니다. 이메일·ID/access/refresh token을 보존하지 않습니다. 재로그인 시 같은 client ID를 사용하며 다른 계정의 검증된 식별자로 바뀌면 거절합니다. 여러 계정 등록 UI는 A 범위에 없습니다. 검증 화면에는 `FLAG_SECURE`를 적용합니다.

사용자가 시작한 시도가 끝나면 `noBackupFilesDir/siwc-probe-result.json`에 콜백·토큰 응답 수신·신원·플랜 권한·철회 확인 여부와 경과 시간·고정 결과 문구만 기록합니다. `completed`는 시도 종료를 뜻하며 인증 성공과 다릅니다. 계정·등록 ID·토큰·인증 URL·원시 응답은 결과 파일에 넣지 않습니다. 다음 시도 시작 전 이전 결과를 삭제합니다. 진단을 읽을 때 이 파일만 대상으로 하며 앱 전체 저장소나 브라우저 로그를 덤프하지 않습니다.

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
- [모델과 추론](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): A 단계에서는 호출하지 않습니다.
- [공식 discovery](https://auth.openai.com/.well-known/openid-configuration)
