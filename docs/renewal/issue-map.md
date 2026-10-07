# Renewal issue map

처음 이관은 2026-10-04에 기록했다. 2026-10-07 현재 사용자의 후속 진행·컨텍스트 분할·범위와 전체 회차 번역 승인에 맞춰 아래 실행 기준을 갱신했다. 최초 한 POST·G1 전 후속 금지 가정은 현재 실행 지시가 아니다. merged 구현, 새 Draft 제안, 실제 품질 실패를 구분한다.

## New ownership

| Issue | Scope | Prerequisite and gate |
| --- | --- | --- |
| [#24](https://github.com/earlydreamer/narou-reader/issues/24) | Renewal umbrella and task order | 이관 이슈 CLOSED. 현재 후속은 아래 개별 이슈와 실제 소스 기준으로 진행한다. |
| [#25](https://github.com/earlydreamer/narou-reader/issues/25) | First complete chapter: discovery, selected chapter, plain-text request, durable save/read | 기본 구현 merged, 전체 회차 의미 보존 G1 FAIL. #74의 순차 요청 계약으로 재검증한다. |
| [#26](https://github.com/earlydreamer/narou-reader/issues/26) | Paginated TOC, navigation and per-version reading positions | #51/#60 merged. 기기별 실제 이동·위치·재시작 증거는 G2 문서와 구분해 읽는다. |
| [#27](https://github.com/earlydreamer/narou-reader/issues/27) | Failure recovery and non-destructive v1 migration | #55/#61/#64/#67/#70 merged. 원본 보존과 네이티브 실패 복구 증거를 유지한다. |
| [#28](https://github.com/earlydreamer/narou-reader/issues/28) | Android/Windows tooling and full actual-use verification | Windows 검사·LM Studio와 Android 경계/복구 증거 있음. 의미 보존 FAIL과 미실행 제공자는 별도다. |
| [#29](https://github.com/earlydreamer/narou-reader/issues/29) | Explicit optional Gemini whole-chapter contract | #58 merged, 실제 유료 호출 NOT RUN. 자동 fallback이나 전체 회차 품질 통과를 뜻하지 않는다. |
| [#74](https://github.com/earlydreamer/narou-reader/issues/74) | 모델 context 안의 순차 구간 번역 | PR #76 Draft. 입력 전체 정확히 한 번·완전 저장 후 읽기, 실제 Hy-MT2 의미 보존 FAIL. |
| [#75](https://github.com/earlydreamer/narou-reader/issues/75) | 범위·전체 회차 일괄 번역 | PR #77 Draft, #74 위에 쌓음. foreground 순차 실행·재시작·저장만 재시도 검증. |
| [#21](https://github.com/earlydreamer/narou-reader/issues/21) | 작품 용어집·캐릭터 말투 | PR #78 Draft, #75 위에 쌓음. 직접 저장한 지침·해시·예산, Android와 Linux 자체 원문 적용 검증. |
| [#72](https://github.com/earlydreamer/narou-reader/issues/72) | 모델의 기간·행동·루비 의미 변경 | Gemma와 Hy-MT2 모두 FAIL. 작은 입력에서도 남는 의미 오류를 유지한다. |
| [#49](https://github.com/earlydreamer/narou-reader/issues/49) | Android Hy-MT2 1.8B 실행·품질 검토 | 모델·NDK 설치, 실제 CLI 중단과 전체 회차 14구간 완료. 의미 보존 FAIL이며 앱 제공자는 미구현이다. |
| [#57](https://github.com/earlydreamer/narou-reader/issues/57) | Ollama 실사용 | NOT RUN. 현재 사용자가 지정한 Linux 서버 검증을 위해 새 Ollama 환경을 설치하지 않는다. |

## Legacy handoff

Each old issue received a successor link and supersession reason before it was closed with `state_reason: not_planned`. Original issue bodies and historical evidence were preserved. GitHub has no `superseded` state reason in this connector; the explicit comments explain that these closures are scope transfers and do not mean the failures are fixed.

| Old issue | Successor | Preserved requirement/evidence |
| --- | --- | --- |
| [#10](https://github.com/earlydreamer/narou-reader/issues/10) | #24 | Old chunk/prefetch implementation plan is replaced by the approved renewal task order |
| [#8](https://github.com/earlydreamer/narou-reader/issues/8) | #25 and #28 | Actual native HTTP, persistence, restart, offline, interruption and boundary proof move into G1/G2; APK/mock success is insufficient |
| [#20](https://github.com/earlydreamer/narou-reader/issues/20) | #25 | Hy-MT2 context/target confusion and blank/repeated/ruby source fidelity regressions |
| [#22](https://github.com/earlydreamer/narou-reader/issues/22) | #25 | Real phone returned HTTP 200/stop but mandatory JSON parsing prevented reading a completed body |
| [#23](https://github.com/earlydreamer/narou-reader/issues/23) | #28 | Windows ZIP separator and signer invocation failure, exact Windows proof and retained security/provenance checks |

[#21](https://github.com/earlydreamer/narou-reader/issues/21)의 과거 문단 ID·JSON 출력·수동 예산 가정은 [현재 구현](work-guidance.md)에서 일반 텍스트와 내부 context 예산으로 대체됐다. 자동 추출·추정 화자는 포함하지 않는다. 이미 닫힌 #1–#7과 #9의 과거 기록은 바꾸지 않는다.

## Regression evidence and acceptance links

- **#20:** Original test used a synthetic 12-paragraph source, including an empty p04 and whitespace p08. The fourth response returned context p11 instead of target p12 despite HTTP 200, valid JSON and `stop`; complete commit and partial exposure both remained zero. Preserve this as the reason to test complete original text exactly once, ordering, repeated content, blank lines and ruby in T2/T3, plus meaningful omissions/order/dialogue/ruby in actual G1 quality checks. The original 4-call context-free diagnostic is not evidence of the new one-call contract succeeding.
- **#22:** Original SM-F966N / Android 16/API 36, Hy-MT2 7B Q4_K_M run had server context 16384 and old app output budget 3000. HTTP 200/`stop`/reasoning_tokens 0 was rejected for JSON syntax, so no complete chapter was readable. T3 tests normal plain Korean text without JSON/ID or equal paragraph-count requirements; length, blank, blocked and provider error-only responses remain failures. T4/G1 must independently prove durable complete reading and exactly one generation.
- **#23:** Windows/PowerShell clean `main` acb473b APK audit incorrectly rejected an existing `assets\\base-....js` due to filesystem versus ZIP separators. SDK `apksigner.bat` also conflicts with the Linux extensionless invocation. T7 must normalize ZIP paths and use the same SDK's `lib/apksigner.jar` through Java on Windows, while retaining all asset byte equality, compiled manifest, CSP, plugin, signature and clean exact-source provenance checks. Actual full Windows audit and Linux Android CI are distinct proof; an unavailable Windows run stays NOT RUN and blocks a Windows-success claim.

현재 G1은 실제 인앱 탐색·비첫회차·실제 목록의 모델 선택·전체 원문 순차 처리·완전 저장·오프라인 읽기·브라우저 경계와 처음부터 끝까지의 의미 대조를 요구한다. 사용자가 지정한 Linux Hy-MT2 실행의 [최신 결과](hy-mt2-segmented-g1-2026-10-07.md)는 전송·저장 PASS, 의미 보존 FAIL이다. 합성 통과나 구간 수로 G1을 대체하지 않는다. 후속 구현은 사용자 승인 범위에서 진행하되 Draft들의 의미 품질 게이트가 해결됐다고 보고하지 않는다.

G2의 실제 증거는 [Windows LM Studio](mainpc-lmstudio-g2-2026-10-06.md), [Black Shark 2](blackshark-g2-2026-10-07.md), [네이티브 오류](native-errors-g2-2026-10-07.md)로 나눈다. Ollama·실제 유료 Gemini·새 앱 온디바이스 제공자는 따로 미완료다. 합성 테스트, APK, Windows 검사와 실제 기기 결과를 서로 대신하지 않는다.

Legacy source remains at [legacy/pre-renewal-acb473b](https://github.com/earlydreamer/narou-reader/tree/legacy/pre-renewal-acb473b), pinned to `acb473b1576a33208b6cbf510bde9c71eb3009b5`. The approved [functional spec](../superpowers/specs/2026-10-04-narou-reader-renewal.md) and [implementation plan](../superpowers/plans/2026-10-04-narou-reader-renewal.md) are the implementation requirements; live source access/content rights, paid calls, signing keys and public distribution are separate gates.
