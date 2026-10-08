# #106 하단 inset 진단과 수정 기록

이 문서의 앞부분은 test-only 계측을 준비할 때 정한 실행 계약이고, 마지막 절은 실행 결과와 이어진 제품 수정 범위를 기록해.

## 목적과 범위

Black Shark 2의 기존 `app.narou.reader.devicecheck2`에서 WindowManager가 보고한 하단 navigation frame은 130 물리 px인데, WebView의 `env(safe-area-inset-bottom)`, Capacitor 주입 변수, `--inset-bottom`은 모두 0px이야. KEY2는 WebView 121이라 Capacitor 8.5.2의 구형 WebView padding 분기를 타는 별도 대조군이야. 첫 단계에서는 두 기기의 실제 root insets 전달 경계를 읽기 전용 instrumented test로 관측해 원인을 좁혔고, 그 뒤 확인된 원인에 대한 버그 수정을 진행 중이야.

test-only 계측 구현에서는 이 계획과 `android/app/src/androidTest/java/app/narou/reader/InsetsProbeInstrumentedTest.java`만 변경했어. 계측 APK 빌드 때 `android/app/build.gradle`에 임시 debug suffix와 `testApplicationId`를 설정한 뒤 원래 바이트로 복원했어. 이어진 제품 수정은 이 문서의 마지막 절에 범위와 검증 상태를 따로 기록해.

## 실행 guard와 대상

일반 instrument suite처럼 `nrInsetsProbe` 인자가 없는 실행은 JUnit assumption으로 skip하고 `ActivityScenario`를 열지 않아. 진단 실행에서 `nrInsetsProbe`를 명시했다면 그 값이 정확히 `true`인지 검사하고, instrumentation target context package ID가 `app.narou.reader.devicecheck2`, instrumentation context ID가 `app.narou.reader.devicecheck2.insetsprobe.test`인지 검증해. 명시 실행에서 값이나 패키지가 다르면 실패하고 activity를 열지 않아. request 비교 메서드는 추가로 `nrInsetsProbeTarget=decor` 또는 `webView` 중 메서드에 지정된 하나만 요구해. baseline은 target 인자가 없어야 해.

선택 실행 대상은 다음 세 메서드야.

- `readOnlyBaselineEmitsAllowlistedMetrics`: 아무 inset 요청도 하지 않는 baseline.
- `baselineThenDecorRequestSettledAfter`: baseline 뒤 decor에 `requestApplyInsets()`를 정확히 1회 호출하고 settled after를 비교.
- `baselineThenWebViewRequestSettledAfter`: baseline 뒤 WebView에 `requestApplyInsets()`를 정확히 1회 호출하고 settled after를 비교.

request 비교 두 메서드는 한 번의 실행에서 baseline → 선택된 view에 단발 요청 → after 비교 순서로 수행해. decor와 WebView를 한 실행에서 모두 요청하지 않아. listener를 추가·교체하지 않고 insets를 consume하거나 transform하지 않아. 요청 외에 테마, window flags, padding, window, 데이터, 설정을 변경하지 않아.

## 수집값과 좌표계

모든 Android native snapshot은 `ActivityScenario.onActivity`로 UI thread에서 읽어. root/decor와 WebView가 attach/layout 상태이고 platform 및 Compat root insets가 null이 아닌지 최대 4초 동안 test thread에서 반복 확인해. JS는 동기 `evaluateJavascript()` 결과를 100ms 간격으로 bounded polling해 `.nr-library`와 `.nr-fab` 존재, `document.readyState`, `document.fonts.status`, 유효한 DPR·viewport·CSS 수치가 준비됐는지 확인해. native 준비와 JS 준비를 각각 기다리고, JS readiness가 성공하면 비교용 fresh native baseline 직전에 native readiness도 다시 확인해. 두 조건이 모두 준비된 경우에만 그 뒤 native snapshot으로 baseline을 대체해. JS readiness나 재확인 timeout이면 앞서 읽은 native partial snapshot을 유지하고 마지막 부분 JS snapshot(없으면 null), 준비 여부와 샘플 수를 보고한 뒤 실패해. UI thread에서는 대기하지 않아. timeout 때 아직 유효하지 않은 객체/프레임 값을 0으로 꾸미지 않고 JSON `null`로 내보내.

native snapshot은 `SystemClock.elapsedRealtime()` 시각과 함께 다음 값만 담아.

- platform `WindowInsets`: legacy `systemWindowInsets` 및 `stableInsets`의 left/top/right/bottom.
- AndroidX `WindowInsetsCompat`: current `systemBars | displayCutout`, `navigationBars`, `displayCutout`, `ime`; `navigationBars`의 `getInsetsIgnoringVisibility`; status/navigation/IME visibility.
- decor padding 4변, decor와 WebView의 screen coordinate frame (`getLocationOnScreen`, width, height; 물리 pixel), window visible display frame, real display size, density/densityDpi, window flags, soft-input mode, decor system-UI flags.
- WebView JS: 임시 숨은 요소로 읽은 `env(safe-area-inset-bottom)` computed px, 주입된 `--safe-area-inset-top/bottom`, computed `--inset-top/bottom`, `.nr-fab` 존재 여부와 computed bottom 및 DOM rect (CSS px), `innerHeight`, `visualViewport`, DPR, screen/client 크기. 정확한 앱 ID는 Java의 instrumentation target context package guard에서 확인하므로 JS에서 App API를 호출하지 않아. 본문·주소·제목·저장 데이터는 읽지 않아.

native view frame 좌표는 Android `getLocationOnScreen()` 기준 화면 좌표계 물리 px이고, JS rect/viewport는 WebView viewport 기준 CSS px야. `devicePixelRatio`와 density는 관측 메타로 함께 기록하지만 보정 기준으로 사용하지 않아. native insets `null`이나 아직 layout되지 않은 frame은 `0`으로 바꾸지 않아. native와 JS는 순차 측정이므로 같은 시각의 원자 snapshot이라고 주장하지 않아. 각 native snapshot은 `SystemClock.elapsedRealtime()` 기준 `capturedUptimeMs`를 갖고, JS snapshot에는 같은 monotonic clock으로 측정한 `callbackReceivedUptimeMs`를 넣어. 이 값은 native `ValueCallback` 수신 시각이지 JavaScript 평가 순간을 직접 잰 값은 아니야. baseline native는 JS 준비와 native readiness 재확인 뒤 캡처됐는지를 별도 boolean으로 표시해. JS는 동기식 `evaluateJavascript()` 반환 객체를 `ValueCallback`으로 받고, callback 대기는 test thread의 `CountDownLatch`에서만 제한 시간 동안 수행해. JavaScript interface나 별도 진단 API는 추가하지 않아. 허용된 숫자/boolean만 `Bundle` status의 `nrInsetsProbe` JSON으로 보내. URL, HTML/body, 원시 dump, 로그, exception text는 기록하거나 출력하지 않아.

## settled 판정과 callback 한계

각 테스트 snapshot에는 `SystemClock.elapsedRealtime()`을 기록해. 요청 비교는 같은 Activity 실행 안에서 native·JS baseline이 준비된 것을 확인하고, 선택한 하나의 view에 요청을 한 번 보낸 다음 after를 관측해. 요청 뒤 test thread에서 최대 3초 동안 100ms 간격으로 native snapshot을 읽어. root insets와 layout이 준비된 상태에서 native inset/frame/padding 값이 세 번 연속 같으면 `nativeSettled=true`로 판정해. JS readiness는 별도로 bounded polling하며 native 안정 판정에 섞지 않아. after의 native 안정 판정과 JS callback은 서로 다른 시각의 순차 관측이고 원자 snapshot이 아니야. 각 native 읽기는 `ActivityScenario.onActivity`의 UI thread에서 실행하지만 sleep/wait는 test thread에만 있어. JS callback도 UI thread에서 값을 반환하고 test thread latch가 받으므로 UI thread를 막지 않아. `requestApplyInsets()`는 재계산 요청을 보낼 뿐, 특정 native listener callback이 호출·완료됐다는 보장은 아니야. 테스트는 listener를 설치하지 않으므로 callback delivery 자체는 증명하지 않아. `requestCount`는 실제 호출 0회 또는 1회를 기록해. 결과는 “요청 뒤 동일한 native 값 snapshot 세 번을 관측함”으로만 표현해.

각 phase의 `capturedUptimeMs`, request target/count, baseline/after native·JS 값, stable sample 수, 동일 여부를 allowlist JSON에 넣어. display real size는 관측 메타일 뿐 safe-area 보정 기준으로 사용하지 않아. 선택 계측에서는 별도 screenshot이나 전체 instrument suite를 실행하지 않았고 `connectedDebugAndroidTest`도 실행하지 않았어. 뒤이은 수정의 compile 확인으로 `:app:assembleDebug :app:assembleDebugAndroidTest`를 실행해 로컬 APK 두 개를 만들었지만, 이 task에서는 설치하지 않았어.

## 초기 실행 준비·보존 계약

test APK는 임시 suffix/testApplicationId 설정을 적용해 `:app:assembleDebugAndroidTest`로만 빌드했어. target `.devicecheck2` APK는 교체하지 않았어. test APK manifest의 target package와 인증서를 확인한 다음 계측 패키지만 설치해 선택 메서드를 `am instrument`로 호출했어. 생산, `.test`, 기존 `.devicecheck`에는 접근하지 않았어.

AndroidJUnitRunner는 target process를 재시작할 수 있고 ActivityScenario는 MainActivity를 닫아. 실행 전후 각 기기의 `.devicecheck2` synthetic library index/file summary, 테마 선택과 `font_scale`을 값이나 private data 없이 비교하고, 테스트 뒤 앱을 Home 서재 화면으로 다시 열었어. 비교 결과는 아래 실행 기록에 있어.

실행 전 가설은 Black Shark의 nav bottom이 root platform/Compat raw inset에는 양수지만 Capacitor safe-area 주입에서만 0이 된다는 것이었어. 아래 계측에서 플랫폼/Compat 값은 양수로 관측됐고, decor 및 WebView에 단발 `requestApplyInsets()`를 보내도 native나 JS 값은 바뀌지 않았어. `numeric-measurements.json`과 `env-probe.json`은 `D:/projects/narou-reader/.superpowers/verification-106-bottom-insets/`의 선행 읽기 전용 근거야.

## 실기 계측 결과와 현재 수정

test-only 계측 source는 `76f10235dccc79c71599c6d41daa4107a7c9a846`이고 계측 APK SHA-256은 `9d321acb60295313f057cb5b948bb11610cfc2015ce130f5246cf8df99a7cbe8`, 인증서 SHA-256은 `8c5d8712374dff61e93c2ecbcc240a17d2db4759c97ee4ab11275322aa5fe0a6`이야. 설치된 target 앱은 제품 source `6cbc56a56ba3587c588fd7c7973c2257065ded4b`의 `.devicecheck2` APK였고 SHA-256 `4b13e6a7c2ad7603784bb512c0e30c1baca8fe4127808d2af3b569afe2a1af81`을 실행 전후 확인했어. 두 기기에서 계측 APK만 설치했고, 생산·`.test`·기존 `.devicecheck` 패키지는 설치·교체·실행하지 않았어.

Black Shark에서 system window 및 stable insets bottom은 각각 130px, Compat `navigationBars` current 및 ignoring-visibility bottom도 130px이었어. 상단 status inset은 75px, IME는 숨김, decor와 WebView padding은 0이었고 WebView는 화면 전체 1080×2340px이었어. CSS `env(safe-area-inset-bottom)`, 주입된 `--safe-area-inset-bottom`, `--inset-bottom`은 모두 0px이었고 FAB의 CSS bottom은 16px이었어. KEY2에서는 navigation bar가 숨겨져 있고 platform/Compat navigation bottom이 0px이었어. status inset은 63px, decor padding top도 63px, WebView frame은 y=63px부터 화면 하단까지였으며 JS의 하단 env/토큰은 0px이었어.

두 기기에서 선택한 세 메서드가 각각 1/1로 성공했어. decor와 WebView에 각각 한 번 요청한 뒤 native 값은 3회 연속 동일했고, baseline/after native 값 및 CSS/FAB 값도 같았어. 이는 해당 요청 이후 측정값이 바뀌지 않았다는 뜻이며 특정 listener callback delivery를 증명하지 않아. Black Shark와 KEY2의 보존 요약은 `D:/projects/narou-reader/.superpowers/verification-106-bottom-insets/blackshark-67f3906b-76f10235/after-run-20261008T020527Z/runtime-preservation-summary.json` 및 `D:/projects/narou-reader/.superpowers/verification-106-bottom-insets/key2-5000337213-76f10235/after-run-20261008T020611Z/runtime-preservation-summary.json`에 있어. 각 요약에서 허용된 19개 앱 private 경로 해시, 테마 의미값, 설정값, synthetic fixture의 2개 work/2개 version/2개 recent 항목, B의 5개 private payload hash, 기존 n1020aa 인덱스 보존, Home readiness가 모두 baseline과 같았어. 허용된 경로에는 `CapWebViewSettings.xml`, `WebViewChromiumPrefs.xml`, `AwOriginVisitLoggerPrefs.xml` shared preference hash도 포함되어 동일했어. `app_webview/cache` 등 허용 경로 밖의 WebView 전체 상태는 비교하지 않았어.

원인은 Capacitor `@capacitor/android@8.5.2` `SystemBars.java`에서 새 `WindowInsetsCompat.Builder(insets).build()` 객체로 CSS 주입을 호출한 뒤 그 객체에서 IME visibility를 다시 읽는 경로야. 독립 DEX/소스 대조에서 이 새 객체는 root insets cache를 보유하지 않고, AndroidX의 visibility 추정은 Black Shark에서 nav/system inset 130px과 root stable bottom 0을 바탕으로 IME를 표시 중으로 오판할 수 있음을 확인했어. 실기 baseline은 실제 IME hidden인데 주입 bottom이 0px인 결과와 일치해. 현재 수정은 `patches/@capacitor+android+8.5.2.patch` 한 파일로 제한해. 두 `injectSafeAreaCSS(newInsets)` 호출에 원본 listener의 `keyboardVisible`을 전달하고 private 메서드에 boolean 인자를 추가해 그 값으로 하단 CSS를 계산해. 기존 `getBottomInset`, insets builder/반환, padding, listener, viewport 및 테마 동작은 바꾸지 않아.

의존성은 `patch-package` 8.0.1로 정확히 고정하고 `postinstall`에 `patch-package --error-on-fail`을 걸었어. `npm ci`를 실행해 clean install에서 patch가 자동 복원되는 것을 확인했어. 현재 수정된 제품 APK는 아직 실기 검증하지 않았어. 다음 검증에서는 patched clean install/build, 웹/Android 필수 검사를 먼저 완료하고 새 source commit/APK 출처를 고정한 뒤, Black Shark에서 130px nav inset일 때 CSS bottom의 복원과 실제 FAB 좌표/터치, 두 기기 IME show/hide 및 테마·설정·저장소 회귀를 확인해야 해.
