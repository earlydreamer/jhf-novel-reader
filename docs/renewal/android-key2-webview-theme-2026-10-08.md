# Android 8.1 WebView 테마 바 호환성 검증 (#102, 2026-10-08)

## 결론

KEY2의 Android 8.1 / API 27 / Chrome WebView 121에서 재현된 앱 다크 테마의 상태 표시줄 저대비가 제품 커밋 `a47f77163fde2be1d94602b6994416196c6ac40a`에서 해결됐다. KEY2와 BlackShark 2 모두 수정본의 다크·라이트 테마를 실제 표시줄 배경과 아이콘으로 확인했다. KEY2에서는 빠른 테마 전환, 저장된 다크 테마 cold start, 회전, 글꼴 배율, SourceBrowser 복귀도 확인했다.

검증 범위는 KEY2 Android 8.1과 BlackShark 2 Android 10의 실기 결과다. `minSdk=24`의 실제 기기 검증이 API 24 전체 또는 더 낮은 Android 버전 지원을 의미하지는 않는다.

## 원인과 변경

이전 제품 소스 `f4b0e2f1b80dd854d790d1b7af6988bdefced9e2`에서는 KEY2에서 앱 다크 테마를 선택하면 시스템 상태 표시줄이 밝은 바탕에 밝은 아이콘을 표시했다. 앱 라이트 테마는 정상으로 보였다. 당시 다크 실패 스크린샷은 이후 같은 이름의 PNG를 재측정 과정에서 덮어썼고, 로컬 evidence 트리에서 별도 원본을 찾지 못했다. 따라서 실패 결과는 당시 실기 관찰로 기록하며 현재 파일로 과거 상태를 입증한다고 주장하지 않는다. 기존 f4 APK 두 개의 해시는 metadata에만 기록했다.

`a47f771`에서는 앱 전용 `ReaderTheme` 브리지가 Activity의 `windowBackground` 테마 overlay와 decor 배경을 해결된 앱 테마에 맞춘다. JS는 이 적용과 기존 Capacitor `SystemBars.setStyle` 호출을 순서대로 완료한다. 시스템바 아이콘을 설정하는 기존 경로는 유지했다. AppCompat 야간 모드 변경, Activity 강제 재생성, manifest나 의존성 변경은 추가하지 않았다.

## 소스와 APK 출처

검증 제품 소스는 commit `a47f77163fde2be1d94602b6994416196c6ac40a`, tree `2cd9481597d7762c80088d29ad7b31b821dc5618`이다.

| 용도                   | 패키지                          | APK SHA-256                                                        | 출처 및 설치 경계                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| clean 제품 패키징 감사 | `app.narou.reader`              | `c068bbea3f4efd46ab352b9dab78aadf8bc0d1e0c0a90c3d52eb776f45a0d3d6` | a47 clean source, `dirty:false`; `tests/e2e/verify-apk.mjs` 통과. 정적 패키징·서명·출처 검사만 했고 어느 기기에도 설치하거나 실행하지 않았다.                                                                                                                                                                                                 |
| 실기 수정본            | `app.narou.reader.devicecheck2` | `258cc7d7f92171cc47e983c93bd8fc1516582dd03f2d1c72188bf5a3ab9a0fb8` | 같은 a47 제품 소스에서 `android/app/build.gradle`의 임시 debug `applicationIdSuffix ".devicecheck2"`만 추가했다. native provenance의 `dirty:true` 원인은 이 446바이트 Gradle diff 하나뿐이고, web provenance는 `dirty:false`; 패키징된 웹 자산 11개가 `dist`와 바이트 단위로 일치했다. APK는 두 기기의 `.devicecheck2`에만 업데이트 설치했다. |

두 APK는 같은 디버그 서명 인증서를 사용하며 인증서 SHA-256은 `8c5d8712374dff61e93c2ecbcc240a17d2db4759c97ee4ab11275322aa5fe0a6`이다. APK 파일은 로컬 ignored evidence `D:/projects/narou-reader/.superpowers/verification-102-key2/artifacts/`에 보존했다. 설치용 임시 Gradle suffix는 빌드 후 원복했고, 보고서 작성 시 워크트리는 제품 커밋 기준으로 clean이었다.

## 실기 결과

| 기기                         | OS / API / ABI                       | 활성 WebView                               |
| ---------------------------- | ------------------------------------ | ------------------------------------------ |
| BlackBerry KEY2 (`BBF100_6`) | Android 8.1.0 / API 27 / `arm64-v8a` | `com.android.chrome` 121.0.6167.178        |
| BlackShark 2 (`SKW-H0`)      | Android 10 / API 29 / `arm64-v8a`    | `com.google.android.webview` 153.0.8010.36 |

- **테마 대비:** 두 기기에서 앱의 라이트·다크 설정을 각각 실제 적용했다. KEY2 캡처에서 상태 표시줄과 앱 표면 평탄부 픽셀은 다크 `rgb(19,19,27)`, 라이트 `rgb(250,250,253)`로 일치했다. 시스템 아이콘은 다크 표면에서 밝게, 라이트 표면에서 어둡게 식별됐다. BlackShark도 같은 배경 픽셀 결과와 시각적 아이콘 대비를 확인했다. 시험 중 기기의 시스템 야간 모드는 바꾸지 않았다.
- **인셋과 방향:** KEY2 WebView의 CSS safe-area top/bottom은 `0px`이고, 상태 표시줄 아래에 앱 상단 UI가 표시됐다. BlackShark의 CSS top inset은 `27px`, bottom은 `0px`였다. KEY2에서 시스템 자동 회전을 `1→0`, 회전을 `0→1`로 임시 설정했을 때 가로 화면(1620×1080)에서도 앱 다크 테마·서재가 유지됐다. 두 설정은 원래 값 `1/0`으로 복원했다.
- **빠른 전환과 생명주기:** KEY2에서 설정 UI로 `dark→light→dark`를 빠르게 바꾼 후 최종 앱 배경이 `#13131b`였다. 강제 종료 후 다시 시작한 cold start, 다른 Activity인 실제 `SourceBrowserActivity` 왕복 및 Back, launcher로 보내는 루트 시스템 Back 후 재전경에서도 다크 배경이 유지됐다. 루트 Back 후 테스트 앱 프로세스는 살아 있었다. SourceBrowser 복귀 뒤 MainActivity·서재 항목도 유지됐다.
- **글꼴 배율:** KEY2 원래 `font_scale=1.0`에서 2.0으로 바꿨을 때 실제 HTML/body 글꼴은 16→32px, h1은 24→48px였다. 원래 `1.0` 복귀 후 다시 16px/24px를 확인했다.
- **저장본 화면:** KEY2에서 합성 저장 항목을 열어 실제 리더에 합성 번역 1블록(표시 길이 17)이 나타나고 snackbar가 없음을 확인했다. cold start 전후에도 합성 서재 항목이 유지됐다. BlackShark에서도 별도 테스트 패키지의 기존 합성 서재 항목이 유지됐다.
- **키 입력 범위:** Android 시스템 Back은 `adb shell input keyevent 4`로 실행했다. KEY2 물리 키보드의 실제 타이핑은 이번 #102 수정본에서 직접 시험하지 않았다.

KEY2의 전역 설정 최종 readback은 `font_scale=1.0`, `accelerometer_rotation=1`, `user_rotation=0`이다. BlackShark에서는 이 작업 중 전역 설정을 바꾸지 않았다. 기기 값은 테스트 전후 readback으로 확인했다.

## 회귀·오류·데이터 경계

현재 변경 커밋에서 플랫폼 shell 관련 테스트 13/13, `npm run typecheck`, `npm run build`, Android `:app:assembleDebug`, APK provenance verifier가 통과했다. 전체 Vitest 로컬 병렬 실행은 937개 중 936개 통과했고, 기존 `batch-translation` 시간 제한 테스트 하나가 실패했다. 그 파일의 단독 재실행은 23/23 통과했고 별도 이슈 #101로 관리 중이다. 이는 이번 Android 테마 수정의 실패로 분류하지 않는다.

최종 a47 실기 경로에서 기록한 CDP 평가 예외는 0건이고 합성 리더 화면 snackbar는 0개였다. 테스트 앱은 root Back 후에도 프로세스가 남아 있었다. a47 WebView console 전체 메시지나 네이티브 logcat의 fatal/crash 로그는 집계하지 않았다. f4 기준의 저대비 관찰은 남아 있지만 그 빌드의 console/fatal 집계는 보존되지 않아 앱 예외 상태와 연결하지 않는다. 검증 도구에서 설정 화면을 열기 전 실행한 테마 측정의 무동작, PowerShell의 예약 변수명 사용으로 인한 임시 CDP forward 오류, 바이트 캡처용 PowerShell 인코딩 옵션 오류는 확인 후 수정해 재측정했다.

테스트 설치는 `app.narou.reader.devicecheck2`만 대상으로 했다. KEY2의 user 0에는 이 패키지만 표시됐고, BlackShark에서는 기존 `app.narou.reader`, `.test`, `.devicecheck`와 함께 `.devicecheck2`가 표시됐다. 생산 APK는 설치·실행하지 않았고 생산 앱·다른 테스트 패키지에 쓰기/삭제 명령을 보내지 않았다. 생산 저장 데이터의 전후 파일 해시는 측정하지 않았으므로 바이트 단위 보존을 검증했다고 주장하지 않는다. 테스트 패키지에서 생성한 합성 fixture만 사용했다.

`SourceBrowserActivity` 진입과 Back 복귀는 Activity 이름과 돌아온 앱 상태로만 판정했다. 외부 원문 HTML, 페이지 내용, 원문 캡처를 저장하지 않았다. 인증값·사설 endpoint·실제 소설 본문은 보고서와 metadata에 포함하지 않았다.

새 a47 증거 PNG는 source SHA가 포함된 파일명과 SHA-256을 `D:/projects/narou-reader/.superpowers/verification-102-key2/images/`에 보관했다. 초기 f4 다크 실패 PNG는 재측정 중 덮어써져 별도 사본이 없으며 현재 보존 파일은 a47 수정 성공 화면만 담고 있다. 이전 실패는 기록상 실기 관찰로만 남긴다.
