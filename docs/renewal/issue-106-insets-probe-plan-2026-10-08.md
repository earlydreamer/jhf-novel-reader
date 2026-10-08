# #106 하단 inset 진단 probe 계획

## 목적과 범위

Black Shark 2의 기존 `app.narou.reader.devicecheck2`에서 WindowManager가 보고한 하단 navigation frame은 130 물리 px인데, WebView의 `env(safe-area-inset-bottom)`, Capacitor 주입 변수, `--inset-bottom`은 모두 0px이야. KEY2는 WebView 121이라 Capacitor 8.5.2의 구형 WebView padding 분기를 타는 별도 대조군이야. 이번 단계는 두 기기의 실제 root insets 전달 경계를 읽기 전용 instrumented test로 관측해 원인을 더 좁혀. 제품 코드는 수정하지 않아.

변경 파일은 이 계획과 `android/app/src/androidTest/java/app/narou/reader/InsetsProbeInstrumentedTest.java` 두 개뿐이야. 제품 Java, 플러그인, manifest, 의존성, CSS, Gradle 파일은 이 단계에서 바꾸지 않아. build 때만 `android/app/build.gradle`의 debug suffix를 임시로 `.devicecheck2`로 두고 `testApplicationId`를 `app.narou.reader.devicecheck2.insetsprobe.test`로 설정할 예정이며, 그 파일은 원래 바이트로 복원해. 현재는 build/install/run/commit을 하지 않아.

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

각 phase의 `capturedUptimeMs`, request target/count, baseline/after native·JS 값, stable sample 수, 동일 여부를 allowlist JSON에 넣어. display real size는 관측 메타일 뿐 safe-area 보정 기준으로 사용하지 않아. 별도 screenshot, 전체 instrument suite, 제품 APK build, target APK 교체, `connectedDebugAndroidTest`는 하지 않아.

## 다음 수동 실행 준비와 보존 경계

검토 승인 후에만 임시 suffix/testApplicationId 설정을 적용해 `:app:assembleDebugAndroidTest`로 test APK만 빌드할 거야. target `.devicecheck2` APK는 교체하지 않아. test APK manifest의 target package와 test certificate가 기존 설치 앱과 instrumentation 목적에 맞는지 먼저 정적으로 확인한 다음, 승인된 test APK만 설치해 선택 메서드를 `am instrument`로 호출해. 생산, `.test`, 기존 `.devicecheck`에는 접근하지 않아.

AndroidJUnitRunner는 target process를 재시작할 수 있고 ActivityScenario는 MainActivity를 닫아. 실행 전후 각 기기의 `.devicecheck2` synthetic library index/file summary, 테마 선택과 `font_scale`을 값이나 private data 없이 비교하고, 테스트 뒤 앱을 Home 서재 화면으로 다시 열어. 저장 요약이 바뀌거나 target ID가 다르면 기기 실행을 중단해.

현재 가설은 Black Shark의 nav bottom이 root platform/Compat raw inset에는 양수지만 Capacitor safe-area 주입에서만 0이 된다는 것이야. 이번 관측 결과가 이걸 입증하지 않으면 결과를 그대로 보고하고 CSS 수정이나 다른 기기 설정 변경을 하지 않아. `numeric-measurements.json`과 `env-probe.json`은 기존 `D:/projects/narou-reader/.superpowers/verification-106-bottom-insets/`의 선행 읽기 전용 근거야.
