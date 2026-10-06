# Whole-chapter fidelity follow-up — 2026-10-07

The confirmed application bugs #68/#69/#71 were delivered separately in [PR #70](https://github.com/earlydreamer/narou-reader/pull/70), merged as d6ad80150eb943db88965ac120fe8beb8f9843fd. This follow-up addresses the remaining [#72](https://github.com/earlydreamer/narou-reader/issues/72) observation, not a recurrence of the SSH or Ollama work.

## Candidate and tests

Clean candidate 9153c39602be2b16a9fabf8268daf20e948315ae, tree 48151b8ec2151f51c448afb09db73e2c16300ec7, makes the local instruction explicit about whole content, actions, negation, quantities, durations, idioms and ruby semantics. Requests and saved provenance identify plain-ja-ko-v2. An outdated local prompt identity is rejected before dispatch; the diagnostic consumer uses the new identity. Gemini retains its prior instruction/identity. Whole input, nonstreaming single dispatch, no output cap and storage-only retry remain intact.

Remote tests657/657, TypeScript/lint and both Windows APK audits pass. The same-signature candidate APK hash is 6f2c71d23960a10ad000d6f7b5e2c0ad6565cc00dcfd1186c533b1634dfc5698; its installed base.apk matched. [Checks](https://github.com/earlydreamer/narou-reader/actions/runs/37510222983) and [Android](https://github.com/earlydreamer/narou-reader/actions/runs/37510222945) pass at that candidate. This is functional/artifact evidence, not semantic acceptance. CodeRabbit skipped automatic review.

## Completed explicit model runs

The phone's native HTTPS catalog now succeeds directly with18 listed models after the earlier transient MagicDNS failure. The candidate runs use that direct existing Windows MAINPC LM Studio endpoint. Each selected model already existed in its live catalog; selection was an explicit settings/UI operation before one explicit translation-button start. There was no automatic model fallback, model download, server inference-setting change, source rewrite, split, resend or output correction.

| Selected model | Native POST time | Observed completion | Semantic result |
| --- | ---: | --- | --- |
| gemma-4-e4b-uncensored-hauhaucs-aggressive | 61,716ms | HTTP200/stop; 4,786 prompt +7,446 completion tokens, including2,525 reasoning;103 nonblank output blocks | FAIL. Period interpreted as a calendar month, tool mistranslated, a name omitted, ruby readings remained in Japanese. |
| ja-ko-vn-12b-v2 | 24,027ms | HTTP200/stop; 4,810 prompt +812 completion tokens;25 nonblank output blocks | FAIL. Most of the source absent and invented scenes/dialogue present. |
| google/gemma-4-26b-a4b | 88,961ms | HTTP200/stop; 4,787 prompt +6,944 completion tokens, including1,737 reasoning;70 nonblank output blocks | FAIL. Month and sickle meaning improved, but a numeral contains a replacement character, another quantity changed and meaning errors remain. |

All three bodies contain exactly model/messages/stream. Their 7,258-character user message equals the normalized whole source, with103 nonblank passages. Every completed run exercises a synthetic native version-write rejection, blocks reader display until storage-only retry, and adds no model POST during that retry. Saved text equals received content after CRLF normalization. Original two versions remain protected. Merged output paragraphs are not counted as omissions; semantic review runs from first through last.

There were six real Windows generation dispatches across the whole remote-PC task: three baseline dispatches described in the [Black Shark report](blackshark-g2-2026-10-07.md) plus these three candidate runs. No automatic retry occurred. The archived task stores retain completed and failed observations privately.

## Disposition and preservation

The candidate remains in [Draft PR #73](https://github.com/earlydreamer/narou-reader/pull/73). Its clearer instruction and passing657 tests do not establish that #72 is fixed. The application cannot infer whole-chapter meaning from HTTP200, stop, hashes or block counts. No heuristic paragraph-count rejection or silent correction was added. #25–#28 remain open. The candidate report commit changes documentation only and does not relabel its earlier APK as a build from the report or CI.

All10 original active private files/two versions and original preferences match the preinstall backup after every candidate run, including native settings readback after restart. The app is stopped and task ADB ports removed. Runtime JIT loading during explicit model selection had replaced MAINPC's original loaded model; the temporary task-selected model was unloaded and the original Gemma identifier,98,304 context,parallel4 and one-hour TTL were restored. Persistent server/security settings were not edited. Raw novel bodies, translations, wire payloads, private addresses, backups and keys remain outside Git.

The merged application fixes are the stable delivery. Further fidelity work must isolate actual server output from the native response and validate an adequate explicit model/prompt combination. Repeating the same generation or treating this Draft as complete would not resolve the gate. [Sanitized metadata](evidence/whole-chapter-fidelity-2026-10-07/results.json).
