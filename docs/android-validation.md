# Android debug packaging and validation

Renewal acceptance is tracked by [#25](https://github.com/earlydreamer/narou-reader/issues/25) and [#28](https://github.com/earlydreamer/narou-reader/issues/28); the earlier #8 was superseded. Current partial physical-device evidence is recorded in the [Windows MAINPC LM Studio G2 follow-up](renewal/mainpc-lmstudio-g2-2026-10-06.md) and [Fold7 native error gates](renewal/native-errors-g2-2026-10-07.md). The former distinguishes real cancellation/process death from injected storage/network faults; the latter records actual native HTTP error responses, certificate rejection, Keystore/log canaries and 16 executed instrumentation tests on the `a21554f` APK. These partial reports do not complete the whole acceptance matrix. A signed debug APK, mocked application tests and compiled instrumentation tests remain separate evidence; the historical manual matrix below is not a current result for the renewal APK.

## Rebuild the same source

Prerequisites: Node 24 (minimum 22.12), Java 21, Android SDK platform 36, build-tools 35.0.0, and the checked-in Gradle 8.14.3 wrapper. Use the installed SDK's accepted licenses; do not automatically accept new agreements, disable certificate checking, add trust anchors, or change firewall/VPN settings to make a build pass.

From a clean, committed checkout:

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

- App: `android/app/build/outputs/apk/debug/app-debug.apk`
- Device tests: `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`
- Evidence: `android/build/verification/provenance.json`, SHA-256, signature, compiled manifest, package metadata, and network policy
- ID: `app.narou.reader`; minimum Android 7 / API 24; compile/target SDK 36

The audit verifies APK v2 signature, ID/SDK levels, disabled backups and bridge logging, all required native plugins, compiled network policy, packaged production CSP, and web-asset equality with the current build. Vite and Gradle separately stamp their build-time commit/tree/dirty state; both packaged stamps must match the current clean checkout. An older web build cannot be relabeled by a later native build. The report records exact Git commit/tree and lockfile/APK hashes. It is not an installation or runtime test. Build after checking out the desired commit; do not reuse an older APK just because its name is the same.

The [Android workflow](../.github/workflows/android-check.yml) checks out the exact PR head (not the temporary merge commit), runs the same checks and uploads app/test APKs with audit evidence for 14 days. Actions are pinned to verified official action commits. It verifies the hosted runner's preinstalled SDK platform/build-tools and fails if missing, without accepting new SDK agreements. Only synthetic test data and package registries are used; no credentials or real source/model requests are needed. Standard merge integration is also checked by the existing Checks workflow. Debug builds use Android tooling's development signature, not a release signing identity. Different machines may use different debug certificates, so this is a reproducible procedure, not a byte-for-byte reproducible signed APK claim. A signature mismatch during upgrade requires the user to choose between the same signing environment and an uninstall that deletes app data; never silently uninstall.

## HTTP policy and its limits

Users enter their existing model's LAN, tailnet, hostname or other explicitly chosen endpoint at runtime. Android's packaged network-security XML cannot enumerate an unknown future host. Therefore the app opts into cleartext in `base-config`, with an explicit HTTPS-only exception for `syosetu.com` and subdomains. This allows HTTP for this app globally; it is **not** an OS setting, a private-IP detector or a per-request network sandbox. A per-user APK rebuild is not required.

Application routing remains narrower:

- Source transport requires HTTPS, creates its own Accept-only headers, and the source adapter limits host/path. It never receives model authorization.
- The model provider snapshots the user's configured endpoint and appends its fixed completions path. Source and model output cannot choose another destination or execute HTML/tools.
- Both native transports disable redirects before dispatch and reject redirects/unexpected final URLs. No automatic model POST retry or cloud fallback is added.
- Settings always explain that HTTP is unencrypted and should only be used over a trusted local network. Authentication headers and source text sent over HTTP are also unencrypted. Prefer a trustworthy HTTPS endpoint or an already configured trusted tunnel; the app does not expose a server or configure the user's network.
- TLS verification and the platform's default trust anchors are unchanged. Invalid/self-signed certificates are not bypassed.

The bundled WebView stays on HTTPS localhost with mixed content disabled, no external navigation allowlist and no remote `server.url`. A production-only CSP allows bundled scripts and style resources, inline styling needed by the reader, and local/data images; it denies browser connections, frames, objects, forms and base-URL changes. Vite development keeps its normal inline React preamble/HMR. Raw source/model HTML is never mounted. CSP controls browser content, **not** direct native bridge HTTP.

Capacitor 8.5.2 injects its trusted inline native bootstrap immediately after literal `<head>`, before the meta CSP; the rest of the document is restricted to self-hosted scripts, without `unsafe-inline` or `unsafe-eval` for scripts. This version-specific ordering must be rechecked on Capacitor upgrades. A response-header CSP would require a different bootstrap nonce/hash solution. `CapacitorHttp.enabled=false` disables browser fetch/XHR patching, not explicit native requests. Device startup and native calls under the CSP still need runtime evidence.

Reference: [Android network security](https://developer.android.com/privacy-and-security/security-config), [local-network permissions](https://developer.android.com/privacy-and-security/local-network-permission), [Capacitor configuration](https://capacitorjs.com/docs/config), [CSP meta semantics](https://www.w3.org/TR/CSP/#meta-element). Target 36 currently uses `INTERNET` for LAN; reconsider local-network permissions before raising target SDK. INTERNET is not a runtime consent dialog. Do not invent a denied-permission test for a permission the app does not request.

## Automated evidence versus device evidence

| Layer | What it establishes | What it does not establish |
| --- | --- | --- |
| Typecheck /  production web build | Typed app compiles and bundles | Native bridge or render success |
| `tests/contracts`, `providers`, `source`, `storage`, `jobs`, `integration`, `ui` | Synthetic parsing, auth separation, redirect rejection, output validation, single native slot, timeout unknown, cancellation, storage failures, restart model, offline restore and bounded prefetch | Real native networking, Keystore, disk atomicity, OS process death, real layout |
| `tests/e2e/android-packaging.test.ts` and `apk-audit.test.mjs` | Static policy guardrails and artifact-audit regression tests | Browser or device end-to-end execution |
| `verify-apk.mjs` | Actual compiled resources/assets/signature and exact provenance | Install, launch, behavior or live-source permission |
| `assembleDebugAndroidTest` | Instrumentation compiles | Instrumentation executed/passed |
| `connectedDebugAndroidTest` on a usable device | Only the exact native assertions that ran | Entire user workflow or physical-device model quality |

## Install and run on an authorized device

Use an already authorized device with USB debugging permission. Do not enable developer/security settings or accept a new device authorization silently.

```sh
adb devices
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n app.narou.reader/.MainActivity
(cd android && ./gradlew :app:connectedDebugAndroidTest)
```

Record device model, Android/API and WebView version, app commit/tree/APK hash, model/server version, endpoint category (redact the actual private address), model ID, context/output budgets, and result for every row below. Do not include real bearer tokens, complete source text, private endpoints or raw plugin payloads in shared logs. Use synthetic canary credentials to check logging, then delete test credentials through the app. A debug APK is inspectable and is for authorized development testing, not public distribution.

### Required manual matrix

| Scenario | Expected result | Current status |
| --- | --- | --- |
| Install + cold launch | Visible settings/reader, no crash, native bridge initialized under CSP | NOT RUN on final APK |
| Native policy/loopback instrumentation | Dynamic model HTTP allowed; source HTTP denied; 307 target receives zero calls/headers | Compiled only; NOT RUN |
| Chosen PC endpoint | Same authorized LAN/tailnet; existing Ollama/LM Studio responds through native HTTP | NOT RUN: user's endpoint/model unavailable |
| Authorized source → model → save | Whole chapter validated and durable before ready | BLOCKED: source rights/allowed fixture route and device/model needed |
| Restart + offline read | Completed text and saved paragraph/offset restore without source/model requests | Synthetic app regression only |
| Font resize, source toggle, back/navigation | CSP-compatible render; no executable HTML; correct reading position | Synthetic UI regression only |
| PC disconnected / DNS failure | Safe connection or unknown-outcome guidance; no automatic POST retry | Synthetic regression only |
| Wrong/denied authentication | Auth error without raw key/response exposure; no retry loop | Synthetic regression only |
| Slow model / timeout | Outcome unknown; explicit duplicate-processing warning before retry | Synthetic regression only |
| Background / force-stop / relaunch | Stale output never overwrites current work; incomplete checkpoint needs explicit retry | Synthetic lifecycle regression only; OS process death NOT RUN |
| Navigation/settings change during native request | At most one native model request; stale response ignored | Synthetic regression only |
| Truncated, blocked, missing/reordered output | No partial chapter presented as complete | Synthetic regression only |
| Storage full/write failure | Safe storage error; valid persisted data retained; storage retry does not resend validated chunks | Synthetic failure injection only |
| Secure storage unavailable/denied | Explicit auth/storage failure; no plaintext fallback or invented permission prompt | Synthetic failure injection only |
| Native Keystore + backup/D2D | Canary secret readable only through secure store; app data excluded from backup/transfer | Compiled rules only; real restore NOT RUN |
| Source/model redirect | No redirected request, especially no bearer header to another origin | Synthetic transport regression; device loopback NOT RUN |
| TLS failure | Certificate error without trust bypass or downgrade | NOT RUN natively |
| Log inspection with synthetic canary | No canary key/auth/body in app/bridge logs; distinguish OS unrelated logs | Static logging contract only; device NOT RUN |
| Prefetch OFF / ON | OFF requests zero; ON only next one after durable current completion, in foreground | Synthetic regression only |

The production source adapter deliberately only accepts its supported Syosetu paths. Do not modify DNS, intercept TLS or broaden that policy merely to point it at a fixture server. In-process fixture tests already cover the integrated parser/provider/store path. A full native source test must wait for an authorized supported source route or a separately reviewed test-only source harness. No live Syosetu calls, paid API calls, public release, user-PC/firewall changes or iOS validation are included.

## Environment limitation recorded 2026-10-04

An earlier issue-6 APK installed on a software-emulated AOSP Android 15 / API 35 device in the development VM. Without KVM, boot took about 15 minutes and system_server watchdog/System UI/phone/media ANRs plus a WebView renderer crash made launch unreliable. The app launch timed out and no usable app UI was verified. That older artifact is not evidence for the current revision. The emulator and adb were stopped; repeating the same unstable run is not a useful test. A physical Android device or usable accelerated environment is still needed. The final APK remains **packaged, not device-validated** until the checklist has actual evidence.

Use the explicit `:app:` instrumentation tasks above. A diagnostic unqualified `assembleDebugAndroidTest` also tried to build dependency-library test applications and failed in generated `capacitor-cordova-android-plugins:checkDebugAndroidTestDuplicateClasses` (Kotlin stdlib 1.8.22 versus jdk7/jdk8 1.6.21). This does not occur in the application's scoped test APK task. Dependency-library test applications are not this project's device suite; their aggregate build is not reported as passing.
