# #106 하단 inset 진단과 수정 기록

이 문서의 앞부분은 test-only 계측을 준비할 때 정한 실행 계약이고, 마지막 절은 실행 결과와 이어진 제품 수정 범위를 기록해.

## 목적과 범위

Black Shark 2의 기존 `app.narou.reader.devicecheck2`에서 WindowManager가 보고한 하단 navigation frame은 130 물리 px인데, WebView의 `env(safe-area-inset-bottom)`, Capacitor 주입 변수, `--inset-bottom`은 모두 0px이야. KEY2는 WebView 121이라 Capacitor 8.5.2의 구형 WebView padding 분기를 타는 별도 대조군이야. 첫 단계에서는 두 기기의 실제 root insets 전달 경계를 읽기 전용 instrumented test로 관측해 원인을 좁혔고, 그 뒤 확인된 원인을 수정했으며, 수정 APK의 양 기기 실기 결과는 마지막 절에 기록했어.

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

## 수정 전 6cbc 계측 결과 (과거 기준선)

처음 사용한 계측 전용 APK는 test source `76f10235dccc79c71599c6d41daa4107a7c9a846`, SHA-256 `9d321acb60295313f057cb5b948bb11610cfc2015ce130f5246cf8df99a7cbe8`이었어. 이 단계의 target은 제품 source `6cbc56a56ba3587c588fd7c7973c2257065ded4b`, APK SHA-256 `4b13e6a7c2ad7603784bb512c0e30c1baca8fe4127808d2af3b569afe2a1af81`의 기존 `.devicecheck2`였어. 두 기기에서 baseline과 각각 decor/WebView에 한 번 요청하는 선택 테스트를 실행했고, test APK만 설치했어.

Black Shark의 수정 전 fresh native 값은 system/stable bottom 130px, Compat navigation current 및 ignoring-visibility bottom 130px, status top 75px였어. IME는 숨겨져 있었고 decor/WebView bottom padding은 0px이었지만 WebView CSS env와 주입 `--inset-bottom`도 0px이었어. KEY2에서는 navigation bar가 숨겨져 있고 native navigation bottom과 CSS inset이 모두 0px이었어. 이 6cbc 자료는 수정 전 원인 진단용이며 새 제품 APK의 측정값으로 재사용하지 않아.

설치된 Capacitor `@capacitor/android@8.5.2`의 `SystemBars.java`에서 새 `WindowInsetsCompat.Builder(insets).build()` 객체를 CSS 주입에 넘기고, 그 객체에서 IME visibility를 다시 판단하는 경로가 원인이었어. root insets cache가 없는 재생성 객체가 Black Shark의 130px navigation inset과 root stable bottom 0을 보고 IME를 잘못 추정할 수 있음을 소스/DEX 및 native 계측으로 확인했어.

## 제품 수정과 빌드 출처

수정은 `patches/@capacitor+android+8.5.2.patch` 한 파일에서 두 `injectSafeAreaCSS(newInsets)` 호출에 listener 원본의 `keyboardVisible`을 전달하고 private 메서드가 이 값을 하단 CSS 계산에 사용하도록 한 거야. `getBottomInset`, insets builder와 반환값, padding, listener, viewport, 테마 동작은 유지했어. `patch-package`는 개발 의존성으로 정확히 고정했고, `postinstall`의 `patch-package --error-on-fail`이 패치를 복원하도록 했어. clean `npm ci`에서 복원과 `SystemBars`의 boolean descriptor를 확인했어.

실기 소스는 commit `46a681b84905c621bdb2e29607caf437b10d786f`, tree `45a2f491a77b48fc0ca3521e36ba57855e61fe72`야. 그 commit 이후 제품 코드는 바뀌지 않았어. 생산 application ID의 산출물은 `assembleDebug`로 만든 debug APK이며 SHA-256 `8e324801141d6c145bdb80c70e353a6f629d336f42776a4172f4fc2f3114934a`야. 패키지 `app.narou.reader`인 이 APK는 출처/서명 확인만 했고 설치하지 않았어.

양 기기에 실제 설치한 산출물은 debug suffix `.devicecheck2` APK야. 패키지 `app.narou.reader.devicecheck2`, SHA-256 `abcaac7d51448def3b1da79d14ccfd972b29ebcf260dbbe2325748dab19e4df7`, 크기 6,491,774 bytes, minSdk 24, targetSdk 36, 인증서 SHA-256 `8c5d8712374dff61e93c2ecbcc240a17d2db4759c97ee4ab11275322aa5fe0a6`, v2 signature 검증 성공이야. APK native/web 출처는 46a681b/tree 45a2이고, 임시 Gradle suffix 설정으로 native provenance의 dirty 표시는 true였어. web provenance는 clean이었고 APK 안의 11개 web asset은 `dist`와 모두 byte-identical이야. `android/app/build.gradle`은 suffix 변경 전 SHA-256 `ce5351f1d2a993fde3b1cb82db3029ee3e32e0c059caa4a79b9c414115283abd`로 복원됐어. 생산 APK를 설치하지 않고 기존 `.devicecheck2` 패키지만 `-r`로 갱신했어.

기존 instrumentation APK `9d321acb...`는 test source `76f10235...`의 별도 패키지 `app.narou.reader.devicecheck2.insetsprobe.test`로 유지했어. 새 APK나 계측 코드를 빌드하지 않고 이 APK로 기기마다 read-only baseline 메서드만 한 번 실행했어. target source는 46a681b였고 계측/helper source는 76f1023이므로 두 출처를 구분해.

## 수정 APK의 fresh native 측정

각 기기에서 `readOnlyBaselineEmitsAllowlistedMetrics`를 `nrInsetsProbe=true`로 한 번 실행했어. decor 또는 WebView에 `requestApplyInsets()`를 보내지 않았으므로 요청 횟수는 0이야. JS Home readiness, native insets readiness는 두 기기 모두 true였고, 수치는 제품 앱에서 새로 측정한 값이야.

Black Shark에서 platform system/stable bottom은 130px, Compat system bars/current 및 navigation current/ignoring-visibility bottom도 130px이었고 status top은 75px이었어. status/navigation bar는 보이고 IME는 숨겨져 있었어. decor와 WebView frame은 화면 좌표에서 모두 `(0,0)-(1080,2340)` physical px, padding은 모두 0px이었어. WebView CSS env bottom은 0px이지만 주입 `--safe-area-inset-bottom`과 `--inset-bottom`은 각각 47px이야. viewport 높이는 851 CSS px, DPR은 2.75, FAB computed bottom은 63 CSS px, rect bottom은 787.91 CSS px였어. native navigation 영역 시작점은 `2340 - 130 = 2210` physical px, CSS 좌표 약 803.64px이므로 이 Home 측정에서 FAB와 nav 영역 사이 간격은 약 15.73 CSS px야.

KEY2에서 platform system/stable bottom과 Compat navigation current/ignoring-visibility bottom은 0px, status top은 63px이었어. status bar는 보이고 navigation bar와 IME는 숨겨져 있었어. decor top padding은 63px이고 decor frame은 `(0,0)-(1080,1620)` physical px, WebView frame은 `(0,63)-(1080,1620)`이었어. JS 하단 env/주입 inset은 0px이고 viewport 높이는 594.29 CSS px, DPR 2.625, FAB computed bottom은 16px, rect bottom은 578.29px이었어. 이 기기는 아래쪽 navigation bar가 숨겨져 있는 구성이라 Black Shark의 130px overlay inset과 같은 경계로 해석하지 않아.

두 baseline JSON은 다음 경계를 지켜 저장했어. Black Shark `blackshark-67f3906b-runtime/patched-product-fresh-native-baseline.json`; KEY2 `key2-5000337213-runtime/patched-product-fresh-native-baseline.json`. Black Shark runner는 allowlisted status JSON을 내보냈고 adb 명령 exit code 0, failure marker 없음이 확인됐지만 collector가 최종 instrumentation code를 보존하지 못했어. 따라서 해당 실행을 JUnit 1/1 PASS로 확대해 주장하지 않아. KEY2는 adb exit code 0, 최종 `INSTRUMENTATION_CODE: -1`, failure marker 없음과 readiness true를 보존했어.

## 화면 동작, 보존, 복원

Black Shark에서 Home/Settings 최대 스크롤을 각각 확인했어. Home은 scrollTop 249.09, scrollHeight 1100, clientHeight 851 CSS px였고 Settings는 588/1439/851 CSS px였어. Home FAB를 화면 좌표 `(866,2090)`에서 실제 터치해 SourceBrowser를 열고 시스템 Back으로 Home에 돌아왔어. Home root Back은 앱을 background로 보냈고 재실행해 같은 앱의 Home으로 복귀했어. URL 입력 필드 focus 시 viewport 851에서 548.73 CSS px로 줄고 IME 표시가 관측됐으며 inset은 47에서 0 CSS px로 바뀌었어. blur 후 viewport와 47px inset이 돌아왔고 필드에 문자를 입력하지 않았어. 라이트/다크/system 테마와 가로/세로 전환도 확인하고 원래 회전 설정으로 복원했어.

KEY2 Home 최대 스크롤은 128/722/594 CSS px, Settings는 770.67/1365/594 CSS px였어. URL 입력 필드 focus에서 viewport가 594.29에서 554.29 CSS px로 줄고 Android IME 표시를 확인했으며 blur 후 원래 높이로 돌아왔어. 텍스트를 입력하지 않았어. 라이트/다크/system 테마, Settings→Home Back, Home→background Back, 재실행 후 Home 복귀, 회전 변경 후 복원을 확인했어. 이 조작은 실제 소프트 입력기의 표시만 확인하며 물리 키보드 입력 검증은 아니야.

각 기기의 새 제품 runtime before→final after와 이전 6cbc after를 별도로 비교했어. Black Shark의 새 baseline은 FAB/SourceBrowser 왕복 후 수집됐어. 비교 대상은 `.devicecheck2` 허용 경로 19개 파일 SHA-256, app theme 의미값, 합성 서재 논리값, 합성 B payload 5개 SHA, 글꼴/회전/야간 설정이야. 새 제품의 각 기기 before→final after에서 19개 경로 모두 같고 fixture index 논리값 및 B 5개 hash도 같았어. theme는 두 기기 모두 `missing_default/system/light`로 before/after 동일했어. Black Shark의 시스템값은 fontScale 1.0, userRotation 0, accelerometerRotation 1, uiNightMode 1이 전후 동일했고, KEY2는 같은 값과 `uiNightMode=null`이 전후 동일했어. 회전 실기 중 잠시 변경한 system rotation도 원래 값으로 복원했어. Black Shark의 이전 6cbc after snapshot과 수정 제품의 fresh before를 비교하면 `shared_prefs/AwOriginVisitLoggerPrefs.xml` 1개만 달랐어. 이는 수정 제품 검증 전에 SourceBrowser를 열어 본 WebView 방문기록 메타데이터 변화야. 나머지 18개는 같고 새 제품의 fresh before→final after는 19개 모두 같아. KEY2의 이전 6cbc after→수정 제품 fresh before→final after는 19개 모두 같아. `app_webview/cache` 등 허용 목록 밖의 WebView 전체 상태는 비교하지 않았어.

종료 직전 앱 Home을 다시 열고 CDP/시스템 after snapshot을 각각 새 고유 폴더에 저장했어. `.devicecheck2`와 별도 instrumentation 패키지는 기기에 남아 있고, 새로 만든 ADB forward 10667/10668은 제거했어. 현재 프로세스별 6초 `logcat` 관찰은 양쪽 모두 error/fatal/crash marker 0건이었어. 이 제한된 시간창만 말하며 전체 세션의 로그 무오류를 주장하지 않아.

## 증거 파일과 한계

추적 중인 문서와 별도로 ignored evidence는 `D:/projects/narou-reader/.superpowers/verification-106-bottom-insets/46a681b84905c621bdb2e29607caf437b10d786f/` 아래에 있어. `final-runtime-metadata.json`에는 설치 산출물, native/JS baseline, device별 before/after map 비교, fixture와 테마 의미값, 로그 집계 범위가 구조화되어 있어. `suffix-static-audit.json`과 `production-id-debug-metadata.json`은 빌드 출처 자료야. 허용된 raw PNG는 합성 Home만 담은 `blackshark-67f3906b-46a681b-home-insets.png` (SHA-256 `47bbb99219901df0d65c4c5d37e85108ba28f67c77dd30df8f6392b669341335`)와 `key2-5000337213-46a681b-home-final.png` (SHA-256 `ea7b40b0e4fb0b1383376bb3776a3a6a9b8aeaa1901a6006b3d6772ec4d1e498`)뿐이야. 두 캡처는 로컬 ignored 증거이고 tracked commit에 포함하지 않아.

실기 화면 확인과 수치 측정은 이 두 기기와 기록된 화면 상태에 한정돼. 물리 키보드 타이핑은 하지 않았고, 모든 서재 상태나 모든 WebView 캐시/페이지 상태, 전체 세션 로그를 검증했다고 일반화하지 않아. 생산 패키지는 설치하지 않았고 그 저장 데이터도 조회하거나 바이트 동일성을 주장하지 않아. navigation inset이 숨겨진 KEY2와 Black Shark overlay nav 구성의 차이는 위 수치대로 구분해.