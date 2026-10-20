# 2026-10-21 Android·iOS 실기 검증

관련 이슈는 #343이다. #340의 날짜 기준 새 회차 검사와 #342의 메인 작품 찾기 버튼 제거를 실제 Android 및 iPhone에 설치해 확인했다. iOS 코드는 `codex/research-ios`에 유지하며, 이 검증은 iOS의 main 도입을 뜻하지 않는다.

## 설치한 소스와 앱

| 항목 | Android | iOS |
| --- | --- | --- |
| 실기 | SKW-H0, Android 10 | iPhone 12, iOS 26.0.1 |
| 앱 ID | `dev.earlydreamer.jhfreader` | `dev.earlydreamer.jhfreader` |
| 버전 | Debug 1.0.1 / 10001 | Debug 1.0.1 / 10001 |
| 설치 소스 | main `c6b50892ee0e5b1d7328fee7d2e920276ea6dd16` | `3e2c8771301f494ee3cdae6dd4c7dc0ec84d816f` |
| 소스 구성 | main의 Android CI APK | 연구 브랜치 `653ec41`에 main `c6b5089` 통합 후 실기 테스트 보완 |
| 서명·설치·실행 | 모두 성공 | 모두 성공 |

이 문서를 추가한 후속 커밋은 설치 소스와 구분한다.

Android는 [main Android CI 실행](https://github.com/earlydreamer/jhf-novel-reader/actions/runs/39464385479)의 APK SHA-256 `ce49d999f2fbc9d9eb4a0e836cca306260a8d796433bb370608936ca4a1b59f7`을 확인했다. 기존 앱과 같은 로컬 Debug 키로 다시 서명했으며, 서명 영역을 제외한 모든 기존 ZIP 파일 항목의 바이트가 동일했다. 설치한 APK의 SHA-256은 `2bf7c6082e823a6169d6c6a09113ff8f7adc68908a259efbd3b4f78ddd0fd845`이다. `adb install -r` 후 기기에서 다시 가져온 APK의 해시도 일치했다. 운영 앱을 삭제하거나 데이터를 초기화하지 않았다.

iOS는 Tailnet Mac의 Xcode 26.6에서 `tools/ios/device.ps1 -Action test`로 빌드·서명·설치·실행했다. 전송 소스 아카이브 SHA-256은 `2591e58cf727596bc6c0b499089079d55e6f1c6ed3e28f6919bce190f35a266d`이다. 설치 영수증의 `signed`, `installed`, `launched`가 모두 true이고 작업 종료 코드는 0이었다. 원격 provenance의 `dirty: true`는 소스 전송 중 `android/gradlew`, `android/gradlew.bat`의 실행 모드가 뒤바뀐 두 항목 때문이었다. `git diff --numstat`는 두 항목 모두 0/0, `git diff --summary`는 모드 변경만 표시했다. 이를 clean 빌드로 표시하지 않는다.

## 실기에서 확인한 동작

| 검사 | Android | iOS |
| --- | --- | --- |
| 서재 렌더링, 작품 찾기 FAB 부재, URL 입력 버튼 유지 | 통과 | 통과 |
| 기본 1일, 0일·366일 저장 차단 | 통과 | 통과 |
| 3일 저장, 네이티브 Preferences 기록, 설정 재진입 | 통과 | 통과 |
| 작품별 새 회차 검사와 목차·작품 배지 | 통과 | 통과 |
| 서재 전체 검사와 배지 1 → 2 누적 | 통과 | 통과 |
| 앱 프로세스 재시작 후 배지 유지 | 통과 | 미실행 |
| 임시 설정 복원, 합성 작품 제거 | 통과 | 통과 |

새 회차 검사는 합성 작품 한 개를 URL 입력으로 열고 목차를 1화 → 2화 → 3화로 바꾸어 실제 앱 UI와 저장소를 실행했다. `Capacitor.nativePromise`의 해당 합성 작품 HTTP 응답만 테스트 동안 대체했으며, 원문 서버에 요청하지 않았다. 개별·전체 검사 후 목차와 배지 갱신을 확인했다. Android의 검사일은 기기의 Asia/Seoul 날짜인 `2026-10-21`로 기록됐다. 두 플랫폼 모두 검사 주기를 시험 전 값으로 복원하고 합성 작품을 앱의 제거 UI로 삭제했다. 화면 캡처에서도 최종 배지를 확인했다.

iPhone의 기존 화면 캡처는 첫 버튼 렌더링 직후 초기 로딩 화면을 잡을 수 있었다. 실기 테스트의 준비 조건을 서재 내용 또는 설정 화면 렌더링까지 기다리도록 보완하고, 안정된 화면으로 다시 검증했다.

## 네이티브·자동 검사

- Android `NativeSecurityInstrumentedTest`: 실제 기기에서 6개 통과. 네트워크 정책, 백업 제외와 bridge 설정, 합성 loopback HTTP 및 리디렉션 처리 등을 검사했다. 해당 앱 프로세스의 수집 로그에서 `FATAL EXCEPTION` / `Fatal signal`은 0건이었다.
- iPhone `DeviceSmokeTests`: 실제 기기에서 5개 통과, 실패·건너뜀 0개. UI, 합성 파일·Preferences·Keychain 왕복, 선택적 임베딩 상태와 잘못된 원문 URL 거부, 기기 안 HTTP/SSE 서버의 Unicode·리디렉션 검사, 검사 주기·수동 전체/개별 검사·배지를 포함했다.
- iOS 통합 후보에서 typecheck, format, lint, 전체 Vitest 122개 파일·1,701개 테스트, production web build 통과. build의 기존 500 kB chunk 경고는 남아 있다.
- Android 임시 계측 APK와 ADB 포트 포워딩을 정리했다. 원본 로그·기기 식별자·설치 영수증·스크린샷은 기본 checkout의 git 제외 경로 `.local-work-records/343-device-validation/`에 보관한다.

## 검증 범위

이번 새 회차 검사는 합성 응답으로 UI·파서·저장소·상태 변경을 검증한 것이다. 실제 나로우 서버의 접근 가능성, 실시간 연재 추가, 실제 모델 번역, 백업/복원 및 장시간 사용 검증으로 확대하지 않는다. 날짜 경계·N일 일정과 15분 자동 재시도 부재는 자동 테스트에서 가상 시각으로 검증했고, 실제 기기의 날짜를 변경하거나 하루를 기다리는 검사는 수행하지 않았다.

별도로 연결된 Android 8.1 기기는 기존 앱의 서명과 사용 가능한 로컬 키가 달랐다. 그 기기의 앱과 데이터는 보존했으며 이번 최신 앱 설치·통과 대상에 포함하지 않았다.
