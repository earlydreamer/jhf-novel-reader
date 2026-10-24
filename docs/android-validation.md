# Android 디버그 패키징과 검증

현재 Android 빌드와 검증 절차를 설명합니다. 자동 검사와 실제 기기 검증의 범위를 구분합니다.


서명된 디버그 APK, 모의 앱 테스트, 계측 테스트 컴파일, 기기에서의 실제 실행을 구별합니다. 아래 수동 점검표는 실행 절차이며 통과 결과표가 아닙니다.

## 같은 소스로 다시 빌드하기

Node 24.21.0(`.nvmrc`)을 사용합니다. `package.json`의 허용 범위는 `^22.22.2 || ^24.15.0 || >=26.0.0`입니다. Java 21, Android SDK platform 36, build-tools 35.0.0, 저장소의 Gradle 8.14.3 래퍼를 사용합니다. 이미 수락한 SDK 라이선스를 사용하며 빌드 통과를 위해 새 약관을 자동 수락하거나 인증서 검사·신뢰 기준·방화벽·VPN 설정을 바꾸지 않습니다.

변경 사항이 없는 커밋된 체크아웃에서 실행합니다.

```sh
export ANDROID_HOME=/path/to/android-sdk
export JAVA_HOME=/path/to/jdk-21
npm ci
npm run typecheck
npm test -- --run
npm run build
npx cap sync android
(cd android && ./gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest)
node tests/e2e/verify-apk.mjs
```

- 앱 APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- 기기 테스트 APK: `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`
- 검증 자료: `android/build/verification/provenance.json`, SHA-256, 서명, 컴파일한 매니페스트, 패키지 메타데이터, 네트워크 정책
- 앱 ID: `dev.earlydreamer.jhfreader`; 최소 Android 7 / API 24; compile/target SDK 36

감사는 APK v2 서명, ID·SDK, 백업·브리지 로깅 비활성화, 필수 네이티브 플러그인, 컴파일한 네트워크 정책, 운영 CSP, 현재 빌드와 웹 자산의 일치를 검사합니다. Vite와 Gradle은 각각 빌드 시점의 커밋·트리·작업 트리 변경 여부를 기록하며 두 기록 모두 현재의 깨끗한 체크아웃과 일치해야 합니다. 이전 웹 빌드에 새 네이티브 빌드의 이름만 붙일 수 없습니다.

보고서는 정확한 Git 커밋·트리와 잠금 파일·APK 해시를 기록하지만 설치·실행 시험은 아닙니다. 원하는 커밋을 체크아웃한 뒤 새로 빌드합니다.

[Android 워크플로](../.github/workflows/android-check.yml)는 임시 병합 커밋 대신 정확한 PR 머리를 검사하고 앱·테스트 APK와 감사 자료를 14일 보관합니다. 공식 액션의 고정 커밋과 실행기에 설치된 SDK를 사용하며 없는 SDK의 약관을 자동 수락하지 않습니다. 합성 데이터·패키지 레지스트리만 필요하고 실제 원문·모델 요청이나 키는 필요하지 않습니다. 별도의 Checks 워크플로가 병합 통합도 검사합니다.

디버그 서명은 배포용 서명이 아닙니다. 기계마다 인증서가 다를 수 있으므로 이 절차가 바이트 단위로 동일한 서명 APK를 보장하지는 않습니다. 업그레이드 때 서명이 다르면 같은 서명 환경을 쓰거나 데이터가 지워지는 제거를 사용자가 선택해야 합니다. 앱을 조용히 제거하지 않습니다.

<a id="http-policy-and-its-limits"></a>

## HTTP 정책과 한계

사용자가 실행 중에 LAN·tailnet·호스트 이름 등 모델 주소를 입력하므로 정적 Android 네트워크 보안 XML에 미래 호스트를 모두 열거할 수 없습니다. 앱은 `base-config`에서 평문 HTTP를 허용하고 `syosetu.com`과 하위 도메인에는 HTTPS 전용 예외를 둡니다. 이는 앱 전체의 HTTP 허용이며 OS 설정·사설 IP 판별·요청별 네트워크 격리 기능은 아닙니다.

실제 요청은 다음 경계로 제한합니다.

- 원문은 HTTPS·지원 호스트·경로만 허용하고 Accept 헤더를 직접 구성합니다. 모델 인증값은 받지 않습니다.
- 모델은 고정한 사용자 연결에 정해진 요청 경로를 붙입니다. 원문·모델 결과가 다른 목적지를 선택하거나 HTML·도구를 실행하지 않습니다.
- 네이티브 전송 전에 리디렉션을 차단하고 예상하지 않은 최종 URL을 거부합니다. 통신 결과 불명 요청을 자동 재전송하거나 다른 제공자로 전환하지 않습니다.
- HTTP에서는 인증값과 원문도 암호화되지 않음을 안내합니다. 신뢰할 수 있는 HTTPS 또는 이미 구성한 신뢰할 수 있는 터널을 권장합니다. 앱이 서버를 공개하거나 네트워크를 설정하지 않습니다.
- TLS 검증과 플랫폼 기본 신뢰 기준을 유지하며 잘못된 인증서·자체 서명 인증서를 우회하지 않습니다.

WebView는 HTTPS localhost를 사용하며 혼합 콘텐츠, 외부 이동 허용 목록, 원격 `server.url`을 사용하지 않습니다. 운영 CSP는 번들 스크립트·스타일, 리더에 필요한 인라인 스타일, 로컬/data 이미지를 허용하고 브라우저 연결·프레임·객체·폼·기본 URL 변경을 차단합니다. Vite 개발 환경은 React 초기 코드와 HMR을 사용합니다. CSP는 브라우저 콘텐츠를 제어하며 직접 네이티브 브리지 HTTP를 제어하지는 않습니다.

앱 안 원문 브라우저는 별도 WebView이며 위 운영 CSP를 쓰지 않습니다. 사이트 스크립트를 실행하므로 `SourceBrowserLoader`가 모든 응답에 사이트 프로필 CSP(`connect-src` 허용 호스트, `worker-src 'none'`, `object-src 'none'`)를 붙입니다. 원문 브라우저가 열리면 프로세스 전역 `ServiceWorkerClient`가 모든 서비스 워커 요청을 403으로 막습니다. 이 client는 Capacitor Bridge가 등록한 client를 대체하므로, 앱 본체가 서비스 워커를 쓰게 되면 이 설계를 다시 검토해야 합니다. loader는 Capacitor가 등록한 전역 `CookieHandler`를 `SourceBrowserCookies`로 감싸서, 원문 사이트 요청에서만 쿠키를 읽거나 저장하지 않습니다. 경계와 감수한 잔여 위험(WebRTC, 프로필 호스트 WebSocket)은 [원문 조회와 파싱](source.md#원문-브라우저)에 있습니다. `SourceBrowserInstrumentedTest`는 페이지 스크립트의 브리지 부재, 금지 대상 연결(WebSocket 포함) 부재, 서비스 워커 등록 거부, 실제 나로우 요청에서 앱 쿠키 저장소를 쓰지 않는지, pushState로 바뀐 작품 주소의 선택을 기기에서 확인합니다. 쿠키 검사는 인터넷 연결이 필요합니다.

Capacitor 8.5.2는 문자 그대로의 `<head>` 바로 뒤, meta CSP 앞에 신뢰된 인라인 초기 코드를 삽입합니다. 나머지 스크립트에는 `unsafe-inline`·`unsafe-eval`을 허용하지 않습니다. 버전을 올릴 때 이 순서를 다시 확인합니다. 응답 헤더 CSP를 사용하려면 별도의 nonce·해시 해법이 필요합니다. `CapacitorHttp.enabled=false`는 fetch/XHR 패치를 끄며 명시적 네이티브 요청을 끄지는 않습니다.

[Android 네트워크 보안](https://developer.android.com/privacy-and-security/security-config), [로컬 네트워크 권한](https://developer.android.com/privacy-and-security/local-network-permission), [Capacitor 설정](https://capacitorjs.com/docs/config), [CSP meta 규칙](https://www.w3.org/TR/CSP/#meta-element)을 참고합니다. target 36의 LAN 연결은 `INTERNET`을 사용합니다. target SDK를 올리기 전에 권한을 재검토합니다. `INTERNET`은 실행 중 동의창이 아니므로 앱이 요청하지 않는 권한의 거부 시험을 꾸며내지 않습니다.

### 호스트·기기 파일시스템의 복원 상태 교체

`BackupRestoreTransaction`은 동기화를 마친 임시 상태 표식을 원자적으로 교체합니다. Android 운영 코드는 `Os.rename`을 사용하며 같은 파일시스템의 POSIX rename으로 기존 표식을 교체합니다. 호스트 JVM 테스트는 `Files.move(..., ATOMIC_MOVE, REPLACE_EXISTING)`를 주입하며, 별도의 비-POSIX 파일시스템 시험에서 기존 표식 교체를 확인했습니다.

Java 명세에서 `ATOMIC_MOVE`는 다른 옵션을 무시할 수 있으며 기존 대상의 교체 동작은 구현에 따라 달라집니다. 따라서 호스트 시험은 시험한 파일시스템 제공자의 증거이며 모든 호스트 파일시스템을 보장하지 않습니다. 요청한 원자적 이동을 수행할 수 없으면 실패하고, 대체 처리로 기존 표식을 먼저 삭제하지 않습니다.

호스트 테스트는 임시 디렉터리와 합성 내용을 사용합니다. Linux Android 워크플로는 POSIX 권한 실패 시 정리 사례를 포함한 전체 `:app:testDebugUnitTest`를 실행합니다. 해당 비-POSIX 환경에서는 JVM 테스트 51개를 실행해 46개가 통과하고 기존 정리 실패 테스트 5개가 실패했습니다. 그 환경의 `File.setWritable(false)`는 POSIX와 달리 삭제를 막지 못하기 때문입니다. 실패한 테스트는 다음과 같습니다.

- `BackupArchiveTest.failedAbortBlocksCommitAndNewPreparationUntilCleanupSucceeds`
- `failedPrepareCleanupPreventsAReplacementSession`
- `placementFailureRestoresOriginalTreeWithoutDeletingTheStage`
- `BackupRestoreTransactionTest.failureDeletingTheFinalMarkerNeverRollsBackCommittedData`
- `terminalCleanupFailureKeepsItsDecisionAcrossRepeatedRecovery`

이 5개를 통과로 집계하지 않습니다. Android `Os.rename` 경로는 실제 기기에서 백업부터 복원까지 확인해야 합니다. 이 시험 모음에 앱의 운영 데이터 대상 계측 작업을 사용하지 않습니다.

## 자동 검사와 기기 증거의 차이

| 검사 | 확인하는 내용 | 확인하지 못하는 내용 |
| --- | --- | --- |
| 타입 검사·운영 웹 빌드 | 컴파일·번들 생성 | 네이티브 브리지·실제 렌더링 |
| 계약·제공자·원문·저장·통합·UI 합성 테스트 | 파싱·인증 분리·리디렉션·출력 검증·취소·저장 오류·복원 등 해당 시험의 조건 | 실제 네트워크·Keystore·디스크 원자성·OS 종료·실제 배치 |
| `android-packaging.test.ts`, `apk-audit.test.mjs` | 정적 정책·산출물 감사 회귀 | 브라우저·기기 전체 흐름 |
| `verify-apk.mjs` | 컴파일한 자원·자산·서명·출처 | 설치·실행·원문 이용 권한 |
| `assembleDebugAndroidTest` | 계측 코드 컴파일 | 계측 실행·통과 |
| 사용 가능한 기기의 `connectedDebugAndroidTest` | 실제 실행한 네이티브 단언 | 전체 사용자 흐름·모델 번역 품질 |

## 허가된 기기에서 설치·실행하기

USB 디버깅이 이미 허가된 기기를 사용합니다. 개발자·보안 설정을 바꾸거나 새 기기 승인을 조용히 수락하지 않습니다.

```sh
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n dev.earlydreamer.jhfreader/.MainActivity
(cd android && ./gradlew :app:connectedDebugAndroidTest)
```

공유 검증 결과에는 앱 커밋·APK 해시와 실행한 검사, 통과·실패·미실행 범위를 기록합니다. 개인 기기·연결 환경과 원시 실행 로그는 `/.local-work-records/`처럼 Git에서 제외한 공간에 보관합니다. 인증값·전체 원문·사설 주소·원시 플러그인 인자를 공유 로그에 넣지 않습니다. 디버그 APK는 허가된 개발 시험용이며 공개 배포용이 아닙니다.

### 수동 점검표

실제 기기에서 아래 동작을 확인하고, 실행하지 않은 항목은 미실행으로 표시합니다.

- 설치와 최초 실행에서 화면·네이티브 브리지가 정상적으로 열리는지 확인합니다.
- 허가된 원문을 가져와 번역하고 저장한 뒤, 재시작·오프라인 상태에서 저장본과 읽기 위치를 복원합니다.
- 글자 크기, 원문 전환, 뒤로 가기, 회차 이동과 접근성을 확인합니다.
- 연결 실패·잘못된 인증·시간 초과에서 안전한 오류를 표시하고 자동 재요청하지 않는지 확인합니다.
- 요청 중 이동·설정 변경·백그라운드 전환·강제 종료가 오래된 결과를 현재 화면에 덮어쓰지 않는지 확인합니다.
- 잘림·출력 누락·저장 실패에서 미완성 결과를 완성본으로 표시하지 않고 기존 저장본을 보존하는지 확인합니다.
- 보안 저장소, 백업·복원, 리디렉션과 TLS 오류에서 인증 보호 정책이 유지되는지 확인합니다.
- 합성 확인값으로 앱·브리지 로그를 검사하고, 검사를 마친 뒤 테스트 값을 삭제합니다.

운영 원문 어댑터는 지원하는 Syosetu 경로만 받습니다. 시험 서버를 연결하려고 DNS·TLS를 가로채거나 정책을 넓히지 않습니다. 전체 네이티브 원문 시험은 허가된 지원 원문 또는 별도 검토한 테스트 전용 경로가 필요합니다.

