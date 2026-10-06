# MAINPC LM Studio G2 follow-up — 2026-10-06

MAINPC is Windows and already uses LM Studio. The Linux PC's llama-server is a separate environment. This follow-up uses the existing Windows LM Studio connection and selected `gemma-4-e4b-uncensored-hauhaucs-aggressive` model. Historical Ollama work in #57 is outside this run. Existing provider capabilities and the earlier gemma G1 evidence remain valid.

## Merged baseline

- PR #60 merged as `ebf0cf0d089ad13114abc2f954df174cb950a978`.
- PR #61 merged as `b390967281d14b754f690b79263f924fe15e565d`; #54 is closed. #59 stays open for the original Black Shark 2 observation.
- Their combined head `ac1abd557d2ca3f0931b83ce54a964d01a6e7cbc` passed 85 focused reading, integration and storage tests plus TypeScript. [Checks](https://github.com/earlydreamer/narou-reader/actions/runs/37473783115) and [Android debug](https://github.com/earlydreamer/narou-reader/actions/runs/37473783189) passed. CodeRabbit skipped its automatic review; this is not an independent-review result.
- The tested local candidate's tree `88a850478d036b7b3f0e2471a04bad786fecf091` is identical to merged main `b390967`. Its production/debug/test builds and full Windows APK audit passed. The app APK SHA-256 is `a8b2ea9e64d12dc8b22a74e6b10f6fe194c93c0017d76a27f7569c5161f76bf6`.
- The same-signature app update was installed on Fold7 SM-F966N / Android 16. This local APK's provenance identifies `ac1abd5`; it is not claimed to be a build stamped with `b390967` or byte-identical to a CI APK.

## Current execution status

| Scenario | Status | Evidence boundary |
| --- | --- | --- |
| Existing Windows LM Studio catalog | PASS | Local and actual-app `/v1/models` returned the existing model. The configured server owns its 98,304-token loaded context. No server reconfiguration or model download. |
| Integrated APK update and preservation | PASS | Six original saved versions remain. Private file hashes, persisted settings and settings readback after app restart match the pretest state. |
| Native request cancellation | PASS | A real chapter-5 POST was dispatched. Waiting cancellation displayed the unknown-outcome warning, kept retry disabled until the native promise settled, exposed no partial reader and saved no new version. The native call rejected after 34,165ms; server cancellation is not established. |
| Force-stop after durable dispatch; restart without automatic POST | PASS | Chapter-6 dispatch was present in the checksum-validated native journal before actual `am force-stop`. Restart persisted `unknown`, displayed the duplicate-processing warning, sent zero automatic POSTs and saved no version. The archived attempt ledger contains only the two explicitly dispatched continuation attempts. |
| Storage failure; storage-only retry with zero additional POSTs | PASS with synthetic fault injection | A real chapter-7 response reached the actual app. A test-only native-bridge write rejection prevented version storage and reader display. Removing that fault and selecting storage-only retry added one saved version with no additional POST. This is not a physical disk-full test. |
| Newly saved version reopened with native transport unavailable | PASS with synthetic transport fault | After app force-stop/restart, test-only native HTTP rejection left the saved reader usable with identical rendered text and zero model POSTs. This is not an airplane-mode or physical disconnection test. |
| Whole-chapter translation fidelity | NOT RUN in this follow-up | HTTP success, completion markers and storage equality will not establish semantic fidelity. |

## Whole request and restoration

Three explicitly started model POSTs were used across the cancellation, process-death and storage scenarios. The completed chapter-7 request took 49,734ms, returned HTTP 200 / `stop`, and used 4,349 prompt + 4,422 completion tokens with zero reported reasoning tokens. Its 6,918-character user message exactly equals the full source normalized by the production provider. The body contains only `model`, `messages`, `stream`; no chunking, automatic resend or app output cap was introduced. The saved text equals the received content exactly after CRLF normalization. These observations establish input/output transport and persistence, not semantic completeness.

The first locked attempt sent zero POSTs. After user unlock, the cancellation check passed; a subsequent UI actionability timeout ended that harness run. The harness was corrected to bring a hidden app back into the foreground, and the already-passed cancellation was preserved rather than repeated. The continuation completed the other scenarios.

Additional native-call accounting on an original chapter-4 saved version confirmed zero model POST attempts and identical stored/rendered text. The existing source-change check attempted one background source GET, which the injected offline transport rejected without preventing reading. Generation POSTs are counted separately from source GETs, as required by the renewal plan; the initially stricter zero-HTTP assertion was corrected to that contract.

The task-created chapter-7 version was preserved in a local private archive and app-private quarantine. All **27 original private files and six original saved versions** match the pretest bytes after final app shutdown. Preferences match on disk and through native readback after restart. The app is stopped and the harness's ADB forwards are removed. Raw source/translation, wire payloads, backups, private addresses and credentials stay outside Git.

The complete #27/#28 acceptance remains open. Physical disk exhaustion, physical offline operation, broader auth/length/TLS/log/bridge rows, optional Gemini calls, Black Shark 2 #59 and release are not completed by this follow-up. Historical Ollama work remains outside the current user-selected LM Studio scope.

Shareable metadata: [device outcomes](evidence/mainpc-lmstudio-g2-2026-10-06/device-results.json), [whole-input and final file checks](evidence/mainpc-lmstudio-g2-2026-10-06/metadata.json), [offline native-call accounting](evidence/mainpc-lmstudio-g2-2026-10-06/offline-calls.json).
