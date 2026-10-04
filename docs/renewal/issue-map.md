# Renewal issue map

Recorded 2026-10-04 (UTC), after the functional spec and implementation plan were approved. The new issues remain open; this mapping records scope transfer, not feature completion or bug fixes.

## New ownership

| Issue | Scope | Prerequisite and gate |
| --- | --- | --- |
| [#24](https://github.com/earlydreamer/narou-reader/issues/24) | Renewal umbrella and task order | T0 → T1–T4 → G1 → T5–T7/G2; T8 optional |
| [#25](https://github.com/earlydreamer/narou-reader/issues/25) | First complete chapter: discovery, selected chapter, plain-text request, durable save/read | T0; G1 on the actual priority phone before T5–T8 |
| [#26](https://github.com/earlydreamer/narou-reader/issues/26) | Paginated TOC, navigation and per-version reading positions | G1 passed; T5 |
| [#27](https://github.com/earlydreamer/narou-reader/issues/27) | Failure recovery and non-destructive v1 migration | G1/T5; T6 and G2 evidence |
| [#28](https://github.com/earlydreamer/narou-reader/issues/28) | Android/Windows tooling and full actual-use verification | G1/T5/T6; T7/G2, Windows proof separate |
| [#29](https://github.com/earlydreamer/narou-reader/issues/29) | Explicit optional Gemini whole-chapter contract | G1 passed and UI/compose ownership transferred; T8 |

## Legacy handoff

Each old issue received a successor link and supersession reason before it was closed with `state_reason: not_planned`. Original issue bodies and historical evidence were preserved. GitHub has no `superseded` state reason in this connector; the explicit comments explain that these closures are scope transfers and do not mean the failures are fixed.

| Old issue | Successor | Preserved requirement/evidence |
| --- | --- | --- |
| [#10](https://github.com/earlydreamer/narou-reader/issues/10) | #24 | Old chunk/prefetch implementation plan is replaced by the approved renewal task order |
| [#8](https://github.com/earlydreamer/narou-reader/issues/8) | #25 and #28 | Actual native HTTP, persistence, restart, offline, interruption and boundary proof move into G1/G2; APK/mock success is insufficient |
| [#20](https://github.com/earlydreamer/narou-reader/issues/20) | #25 | Hy-MT2 context/target confusion and blank/repeated/ruby source fidelity regressions |
| [#22](https://github.com/earlydreamer/narou-reader/issues/22) | #25 | Real phone returned HTTP 200/stop but mandatory JSON parsing prevented reading a completed body |
| [#23](https://github.com/earlydreamer/narou-reader/issues/23) | #28 | Windows ZIP separator and signer invocation failure, exact Windows proof and retained security/provenance checks |

[#21](https://github.com/earlydreamer/narou-reader/issues/21) remains open as the later glossary/character-voice requirement. A comment marks its old chunk/JSON/manual-budget assumptions for reconsideration under the whole-chapter contract. It is not implemented or required for the current renewal gates. Already-closed #1–#7 and #9 were not changed.

## Regression evidence and acceptance links

- **#20:** Original test used a synthetic 12-paragraph source, including an empty p04 and whitespace p08. The fourth response returned context p11 instead of target p12 despite HTTP 200, valid JSON and `stop`; complete commit and partial exposure both remained zero. Preserve this as the reason to test complete original text exactly once, ordering, repeated content, blank lines and ruby in T2/T3, plus meaningful omissions/order/dialogue/ruby in actual G1 quality checks. The original 4-call context-free diagnostic is not evidence of the new one-call contract succeeding.
- **#22:** Original SM-F966N / Android 16/API 36, Hy-MT2 7B Q4_K_M run had server context 16384 and old app output budget 3000. HTTP 200/`stop`/reasoning_tokens 0 was rejected for JSON syntax, so no complete chapter was readable. T3 tests normal plain Korean text without JSON/ID or equal paragraph-count requirements; length, blank, blocked and provider error-only responses remain failures. T4/G1 must independently prove durable complete reading and exactly one generation.
- **#23:** Windows/PowerShell clean `main` acb473b APK audit incorrectly rejected an existing `assets\\base-....js` due to filesystem versus ZIP separators. SDK `apksigner.bat` also conflicts with the Linux extensionless invocation. T7 must normalize ZIP paths and use the same SDK's `lib/apksigner.jar` through Java on Windows, while retaining all asset byte equality, compiled manifest, CSP, plugin, signature and clean exact-source provenance checks. Actual full Windows audit and Linux Android CI are distinct proof; an unavailable Windows run stays NOT RUN and blocks a Windows-success claim.

G1 requires actual in-app site discovery through search/ranking/category, a chosen non-first chapter, actual catalog model selection, HyMT2 7B through LM Studio, exactly one generation, durable full reading, offline reopening and native browser boundary checks. G2 adds pagination/navigation, restart, model switching, migration, source change, interruption/error paths and both LM Studio and Ollama. Synthetic tests, APK inspection, Windows tooling and actual-phone results must be reported separately.

Legacy source remains at [legacy/pre-renewal-acb473b](https://github.com/earlydreamer/narou-reader/tree/legacy/pre-renewal-acb473b), pinned to `acb473b1576a33208b6cbf510bde9c71eb3009b5`. The approved [functional spec](../superpowers/specs/2026-10-04-narou-reader-renewal.md) and [implementation plan](../superpowers/plans/2026-10-04-narou-reader-renewal.md) are the implementation requirements; live source access/content rights, paid calls, signing keys and public distribution are separate gates.
