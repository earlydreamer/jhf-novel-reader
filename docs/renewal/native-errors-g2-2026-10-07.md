# Fold7 native error gates — 2026-10-07

The remaining auth, length, TLS, logging and bridge rows of [#28](https://github.com/earlydreamer/narou-reader/issues/28) were exercised on Fold7 SM-F966N, Android 16 / API 36, WebView `154.0.8037.58`. The user's Windows MAINPC LM Studio selection remains the production connection. These negative cases use an explicitly selected `narou-synthetic-error-fixture` catalog entry from task-local loopback HTTP/HTTPS servers through temporary ADB reverse ports. They do not test LM Studio translation quality or revive the historical Ollama/Qwen work.

## Exact installed artifact

The tested APK was built from clean main `a21554fc67eab6679dd5c6f545122b5260d32eff`, tree `e134337191a9fdbe400799ea2bf6150d2c5a9e05`, with Node 24.19.0 and Java 21. Production web build, Capacitor sync, app/test APK builds and the complete Windows APK audit passed. App SHA-256: `9a5bf698d1c1bd485e4aeba3e8cac1c3ef83694b8967dc6fda83ef5006b9d4cf`. The installed APK was pulled and its hash matched before scenarios started. The original APK and private data were backed up before the same-signature `install -r`; no uninstall occurred.

The report commit changes documentation/evidence only. It does not relabel this earlier tested APK as a build from the report commit or as a CI artifact.

## Executed error rows

Each row below uses the actual app UI, production provider/whole-chapter flow and native `CapacitorHttp` plugin. The fixture returns the specified HTTP response rather than replacing the native promise. Each explicit start/retry sends exactly one provider POST, displays the matching safe error, exposes no raw response canary or partial reader, and leaves the six original saved versions unchanged. No automatic retry, chunking or provider fallback was observed. The body keys remain `messages`, `model`, `stream`.

| Controlled response | Status | Native POST time | Start to failed UI | Observed result |
| --- | --- | ---: | ---: | --- |
| HTTP 401 | PASS | 9 ms | 365 ms | Authentication failure |
| HTTP 403 | PASS | 8 ms | 375 ms | Authentication failure |
| HTTP 400 / `context_length_exceeded` | PASS | 8 ms | 463 ms | Whole input exceeds the server limit; no split resend |
| HTTP 400 / `max_tokens_exceeded` | PASS | 10 ms | 365 ms | Output limit; no completed save |
| HTTP 200 / `finish_reason=length` | PASS | 6 ms | 367 ms | Truncated output rejected |
| HTTP 200 / `finish_reason=content_filter` | PASS | 9 ms | 382 ms | Blocked output rejected |
| HTTP 200 / `stop` with blank content | PASS | 7 ms | 379 ms | Invalid completed output rejected |

Times are observations from the final measured pass. Native POST time covers the bridge promise; start-to-failed UI includes preparation, the source GET and UI observation at up to 100 ms intervals. It is not model inference latency or a complete phase-duration profile. All seven provider requests carried the same 5,903-character chapter-5 user input hash. Source GETs are counted separately from model POSTs.

## Native security rows

| Scenario | Status | Evidence boundary |
| --- | --- | --- |
| Native Keystore canary | PASS | The real SecureStorage plugin set/get matched. The plaintext canary was absent from ordinary and secure preference files. Only task-created aliases were removed; the original alias set was preserved. This does not establish backup/transfer restoration. |
| Direct native bridge POST | PASS | The actual native plugin sent synthetic authorization and body canaries to the loopback receiver. Browser fetch/XHR patching remains disabled. |
| Untrusted TLS certificate | PASS | A per-request fixture CA allowed the PC positive control. The Android native plugin rejected the self-signed certificate; the TLS server received zero HTTP requests from that rejected call. No trust-anchor, verification, downgrade or global TLS-setting change. This direct plugin test does not establish the full TLS-failure UI. |
| App log canaries | PASS | PID-scoped logcat after the calls contained none of the authorization, request-body or response canaries. This does not claim absence from unrelated OS logs or all future device configurations. |
| Existing native policy/browser suite | PASS | `am instrument -w` executed **16 tests** in 15.325 seconds: six native security checks, nine isolated source-browser checks and one package check. This includes redirect receiver isolation and the bridge-free source WebView. Compilation alone was not used as runtime evidence. |

Three initial setup runs reached the fixture catalog with zero provider POSTs, but the harness's exact label locator failed to find the model select whose label included option text. DOM and native-response evidence identified that harness error; its locator was corrected without an application-source change. The first complete pass succeeded. A second complete pass collected the missing per-row timing and secure-preference plaintext check. Across the two completed passes there were 14 explicit provider error POSTs, two direct synthetic bridge POSTs and two native TLS POST attempts rejected before HTTP. Actual LM Studio generation POSTs were **zero**. The metadata describes the final measured pass, not the sum of all runs.

## Preservation and cleanup

Final checks compare against the backup taken **before installation**, not merely against a later test baseline. All **27 original active private files** match byte-for-byte, including the six saved versions. Reading preferences match the preinstall values and native readback after restart matches the original settings. The native credential alias set was preserved. The credential preference file did not exist before this task; after scoped alias removal, that task-created file was quarantined byte-for-byte outside the active store to restore its original absence. Task-created reader/journal files were also preserved in private archives/quarantine. The app is stopped, task forwards/reverse ports are removed and fixture servers are closed. Raw novel text, private endpoints, backups, credential values and the private fixture key remain outside Git.

The initial USB serial/offline problem cleared after the user's connection intervention. No permanent ADB backend, SDK, driver, registry, firewall/VPN or device security-setting change was made. The cause of that connection failure remains unconfirmed.

## Remaining acceptance

This completes the listed native negative cases, not all of #27/#28. Physical disk exhaustion, full-device physical offline operation, backup/device-transfer restoration, secure-store denial and the full TLS-failure UI are not established here. Other discovery/navigation/source-change/model-switch rows need their own current evidence where still outstanding. Existing G1/LM Studio and earlier cancellation/process-death/save-retry evidence remain separate. Optional paid Gemini acceptance, on-device implementation and public release are outside this run.

Shareable evidence: [device outcomes and sanitized call timing](evidence/native-errors-g2-2026-10-07/device-results.json), [preinstall preservation](evidence/native-errors-g2-2026-10-07/final-preservation.json), [credential-file quarantine](evidence/native-errors-g2-2026-10-07/credential-quarantine.json), [APK audit](evidence/native-errors-g2-2026-10-07/apk-provenance.json), [fixture positive controls](evidence/native-errors-g2-2026-10-07/fixture-self-test.json), [executed instrumentation](evidence/native-errors-g2-2026-10-07/instrumentation.txt).

Follow-up: [connection storage and transport failures](connection-errors-2026-10-07.md) records the later #66 implementation fix, test-only secure-store rejection handling and actual full catalog TLS-failure UI. The original physical OS/hardware-denial and transfer boundaries above remain unestablished.
