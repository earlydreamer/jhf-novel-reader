# Black Shark 2 Windows LM Studio follow-up — 2026-10-07

The user's Windows PC was reached through SSH over Tailscale. Implementation and verification ran in its clean task worktree. The original remote checkout retained its two dirty generated Gradle files and untracked .omo directory; all 19 captured file hashes still match. MAINPC's existing Windows LM Studio and selected Gemma model were used. Historical Ollama, Qwen, optional paid Gemini and on-device work remain outside this run.

## Product fixes

- #68: skipped unfinished, unreadable and missing v1 records now reach the application snapshot and visible per-item warning. Original v1 files remain unchanged, completed model-specific versions import once, and no generation resumes automatically.
- #69: with a confirmed catalog, explicit source refresh now prepares an idle translation screen. The renamed button explains that action. Only the separate translation button dispatches a model POST. The connected-catalog regression checks zero POST before that button and a new version after it.
- #71: local whole-chapter native POST read timeout increases from 120 to 600 seconds. Source/catalog GET, connect timeout and optional Gemini timeout stay unchanged. Unknown/cancellation ownership, one request and no automatic retry remain intact. A simulated 180-second native response regression passes; the original 120,014ms real failure remains recorded. The final real response took 112,245ms, so it is not presented as physical proof of a response beyond 120 seconds.

The native browser GET-form test uses an actual visible button touch and awaits the resulting selectable toolbar, with the exact allowed URL and sandbox checks retained.

## Artifact and execution

The installed app was built from clean e864169fd6039cda7c5754e67401fb3f19018e22, tree 4e184594ae662dc849cffe2dcadc2be1e366a6cc. Its SHA-256 is 552f1a7f04da8c4752f3e09237f017c2f72e78402b62cb68edebe3c582e1bb1a. The same-signature install-r succeeded on Black Shark 2 SKW-H0 / Android 10 / API 29 / WebView 153.0.8010.36; the installed base.apk hash matched. Both Windows hosts passed the complete APK audit. The independently compiled remote APK has a different debug signer and was not installed. No signing key was copied and no uninstall occurred.

Remote web tests: 656/656 in 47 files; TypeScript and lint pass. [Checks](https://github.com/earlydreamer/narou-reader/actions/runs/37507827067) and [Android](https://github.com/earlydreamer/narou-reader/actions/runs/37507827126) pass at the implementation head. CodeRabbit skipped automatic review; this is not independent review. The report commit changes documentation only and does not relabel the tested APK as a build from that report or CI.

The earlier 3e10ff1 native suite passed 16/16. At the final implementation APK, the full suite passed 15/16, with the external-dialog observation failing. That exact case subsequently passed alone in 6.742 seconds without source changes. This establishes a transient observation failure and preserves the two runs separately; it is not called a single final 16/16 run. No app security assertion was weakened.

## Device rows

| Scenario | Result and boundary |
| --- | --- |
| Saved scrolling, home, original toggle, restart | PASS on 46d0470: position error 0px, model POST0. |
| Previous/next saved chapters and pagination | PASS on 46d0470: chapters 3/4 restore their positions; explicit page fetch expands cached contents from 200 to 300 chapters. |
| Switch to another actually listed model | PASS on 46d0470: 18-model catalog; saved reading text unchanged; POST0. |
| Physical offline existing saved reader | PASS on 46d0470: Wi-Fi/data disabled, restart succeeds, source GET fails without blocking saved text/position, POST0. |
| v1 migration | PASS on c80bd68 with native private fixtures: two completed model versions, mapped positions, null legacy provenance, three skipped corrupt/unsupported/unfinished records visibly warned, original fixture bytes unchanged, no duplicate after restart, POST0. |
| Actual in-app discovery | PASS on final APK: real HTML title search, work page and ADB tap of native import toolbar produce the 100-chapter first page. Links activated through DOM automation. POST0. |
| Connected source preparation | PASS on final APK: confirmed catalog; source refresh enters idle; POST0 before explicit translation. |
| Whole request and storage retry | Transport/persistence PASS: one explicit real Windows Gemma request, 7,258-character normalized whole input equal, HTTP200/stop, 112,245ms, 4,698 prompt + 6,864 completion tokens (1,707 reasoning). Stored output equals received content after CRLF normalization. Synthetic native version-write rejection prevents reader exposure; storage-only retry sends POST0 and saves one version. |
| Newly saved Windows version reopened offline | PASS on final APK: the exact task-saved native store was copied from its preserved quarantine, physical Wi-Fi/active-SIM data disabled, app force-stopped/restarted, rendered text unchanged and position error0px, POST0. Original settings were used for reading. |
| Semantic fidelity | FAIL: first-to-last review of all 103 nonblank source passages found changed duration, a tool mistranslated, a missing action and inaccurate ruby/idiom interpretation. The 96 nonblank translation blocks include merged paragraphs; block counts did not determine failure. No large missing middle section was found. This is separate from persistence and requires a quality follow-up. |

Three real Windows generation dispatches occurred in total: the first exposed #69, the second reached the old 120-second limit, and the third completed. Only one dispatch occurred in the completed validation scenario. There was no automatic resend, hidden split, output cap or model fallback.

## Connection and preservation limits

After the physical network transition, the phone could reach public source pages but failed to resolve the existing MAINPC MagicDNS hostname. This run used an explicitly configured task-only USB ADB reverse and a remote-PC HTTPS relay to the existing Windows LM Studio. TLS verification remained enabled, relay paths were restricted to models and chat/completions, and the relay performed no retry. Relay success does not establish direct phone-to-MAINPC DNS connectivity.

The first network restoration check incorrectly used global mobile_data as the active SIM state. Effective cellular data was restored after that error was detected. The final offline check captured/restored active mobile_data1 and wifi_on; it did not rely on that earlier proxy.

At final app shutdown, all 10 original active private files and two saved versions match the preinstall backup byte-for-byte. Preferences match both disk values and native readback after restart. Task-created records and responses remain in private archives/quarantines. The app is stopped, task ADB forward/reverse ports and the relay are removed. Raw novel text, translation, requests, private endpoints, keys, device serial and backups stay outside Git.

The confirmed application bugs can be delivered independently. #25–#28 overall acceptance remains open because current Windows semantic fidelity and direct connection recovery are unresolved. Optional #21/#29/#49/#57 and public release are not completed by this run. [Sanitized evidence](evidence/blackshark-g2-2026-10-07/results.json).
