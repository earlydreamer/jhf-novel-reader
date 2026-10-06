# Connection storage and transport failures — 2026-10-07

Issue [#66](https://github.com/earlydreamer/narou-reader/issues/66) fixes error classification in connection checks and generation preparation. SecureStorage failures were converted to authentication errors during credential reads and to model-list errors during credential writes. Native transport errors, including TLS rejection, also fell through to model-list errors. Storage failures now retain the sanitized `storage` code, and catalog `timeout_unknown` failures use connection guidance. Storage errors during generation describe reading or writing device storage. Request routing, retry rules, credential persistence and TLS verification are unchanged.

## Physical-device before/after

Fold7 SM-F966N, Android 16 / API 36, WebView 154.0.8037.58 ran the actual production UI/provider composition. Both installed APKs were pulled and their SHA-256 hashes verified before execution. The candidate replaced the original with same-signature `install -r`; no uninstall or app-data clear occurred.

| Failure | Original UI classification | Fixed UI classification | Request/save result |
| --- | --- | --- | --- |
| Secure credential write fails | `model_list` | `storage`, with device secure-storage guidance | No catalog HTTP request; password cleared and model selection disabled |
| Secure credential read fails during catalog | `auth` | `storage`, with device secure-storage guidance | No catalog HTTP request; saved selection/authRef preserved |
| Secure credential read fails before generation | `auth` | `storage`, with device storage guidance | Zero model POSTs, no partial reader or new saved version |
| Native catalog TLS certificate rejection | `model_list` | `connection` | Android rejects the certificate before the fixture receives HTTP; model selection disabled |

Secure-store failure rows inject a test-only rejection into `Capacitor.nativePromise` for SecureStorage `internalSetItem` or `internalGetItem`, before the actual operation. They establish production handling/UI for plugin rejection, **not physical OS permission denial, hardware Keystore failure or device-transfer recovery**. Positive controls use the real native SecureStorage set/get and native catalog HTTP call. After the injected failure is removed, an explicit reconnect succeeds. No plaintext fallback was observed in preferences.

The TLS row uses a task-local self-signed HTTPS fixture through a temporary ADB reverse port. A PC positive control succeeds with a per-request CA; the actual Android native plugin rejects the certificate. No global trust, security, certificate-verification or downgrade setting was changed. This completes the full catalog TLS-failure UI row left unestablished by the earlier [native error report](native-errors-g2-2026-10-07.md).

Both completed passes sent zero model POSTs, including zero real Windows MAINPC LM Studio generation calls. Each pass made two successful controlled catalog GETs, one rejected TLS catalog GET and separate Syosetu source GETs for the work/chapter. Auth and raw synthetic-exception canaries were absent from UI; PID-scoped logcat contained none of the synthetic auth/body/response canaries. Raw screenshots and private backup material remain outside Git.

Two earlier harness attempts stopped after the secure-write row with zero model POSTs: a WebView screenshot timed out, then a navigation locator requested the hidden Settings button while already on that route. The harness switched to ADB screen capture and reused the active settings route. Their incomplete results are retained privately. Restoration verification was moved after the restart readback with the app stopped. The completed before/after passes and the final preinstall comparison passed; no application-source change was needed for those harness errors.

## Exact artifacts and verification

- Original installed source: `a21554fc67eab6679dd5c6f545122b5260d32eff`; APK SHA-256 `9a5bf698d1c1bd485e4aeba3e8cac1c3ef83694b8967dc6fda83ef5006b9d4cf`.
- Fixed installed source: `1a871ec307e24c5fab24605b58bd163c6c0b4269`; tree `d33019fa14e200b46a59c11fcb0a4fe63cb1fdab`; APK SHA-256 `a8898a9ac5a89d23914ea8498ee0d5dba271107d1da79353780fa5cf47e3ee20`.
- Debug signer SHA-256 matched both APKs: `16cfc33a078a6e0130e6305067a7b69271e2579407bff41b9cf4f9389ed4c690`.
- Before the fix, all seven new regressions failed while 67 existing integration/UI tests passed. After the fix, the six affected integration/UI/catalog/provider/secret suites passed **103 tests**. The two integration/UI suites were rerun after the typing/format repair: **74 passed**.
- TypeScript and lint passed. Production web build, Capacitor sync, debug/app-test APK compilation and Windows full APK audit passed from the clean committed implementation source.
- The evidence/documentation commit comes after the tested implementation commit. It does not relabel the installed APK as a CI artifact or as a build from the report commit. The native instrumentation suite was not rerun for this JavaScript-only fix; its earlier 16-test runtime result remains attached to the earlier APK/report.

## Preservation and scope

Final preservation is checked against the backup taken before this unit's device scenarios and installation. All 27 original active private files match byte-for-byte, including the six saved versions. Reading preferences and the original credential alias set are preserved; the original settings were also read back through the native Preferences plugin after restart. The credential preference file was absent in the preinstall backup. The task-created file was quarantined byte-for-byte after scoped task-alias removal to restore that absence. Task-created reader/journal files and private archives are retained outside the active store.

The app is stopped, task forwards/reverse ports are removed and fixture servers are closed. Windows MAINPC's existing LM Studio/Gemma selection is restored. The original dirty checkout remains outside the implementation worktree. Ollama/Qwen, paid Gemini, model downloads, on-device implementation and release are outside this unit.

Issue #66 is the implementation defect addressed here. [#27](https://github.com/earlydreamer/narou-reader/issues/27)/[#28](https://github.com/earlydreamer/narou-reader/issues/28) remain open for their remaining acceptance, including physical disk exhaustion/offline operation and backup/device-transfer recovery. Secure-store fault handling is covered above; actual OS/hardware denial remains unestablished.

Evidence: [before](evidence/connection-errors-2026-10-07/before-device-results.json), [after](evidence/connection-errors-2026-10-07/after-device-results.json), [preinstall preservation](evidence/connection-errors-2026-10-07/final-preservation.json), [credential quarantine](evidence/connection-errors-2026-10-07/credential-quarantine.json), [APK provenance](evidence/connection-errors-2026-10-07/apk-provenance.json).
