# Current-chapter workflow (#6)

The app now composes the source parser, OpenAI-compatible local-model provider, private reader store and reader/settings UI. The browser build is a shell and synthetic-test target: production HTTP, body storage and credentials remain native-only. No backend, proxy, PC companion or live-source permission is implied.

## Translation and durable readiness

`createTranslationEngine` in `src/jobs/engine.ts` owns a current job and one model-request queue. `startChapter(url, config)` reads the source and constructs the shared cache fingerprint; `restoreChapter(key, config)` reads a saved snapshot without contacting the source or model; `resumeChapter(key, config)` explicitly resumes a compatible checkpoint. Each returns a handle with `done` and `cancel()`. The application keeps one engine instance, observes its immutable snapshots and uses `retry()` to retain validated in-memory output after a storage failure.

The planner in `src/jobs/chunking.ts` groups ordered paragraphs, assigns deterministic UTF-16-range IDs to split paragraphs and preserves code-point/ruby boundaries. An indivisible ruby span that cannot fit is rejected rather than truncated. Empty source paragraphs and whitespace-only split ranges bypass the model and are restored exactly. Context is a bounded previous segment, distinct from output IDs. Input estimates include nested JSON escaping plus a system/framing reserve; output estimates include ID/JSON overhead and conservative text expansion. These are planning estimates, not a model-specific tokenizer guarantee. The provider independently checks its exact serialized prompt; truncation is always rejected.

A result must have the expected chunk ID, complete finish reason and exactly ordered, nonempty translated output IDs. Only verified chunks are checkpointed. Reassembly validates full original-paragraph coverage and restores original IDs. `ready` is emitted only after the whole chapter's durable `commitChapter` resolves, or after a previously committed chapter is loaded and validated. Partial text never reaches the reader as a completed chapter.

## Cancellation, foreground and ambiguous outcomes

Cancellation or a settings change immediately invalidates the UI job. A queued job rechecks its identity and foreground state before starting. The model slot remains occupied until the native promise actually settles; aborting JavaScript is not evidence of server cancellation. A stuck native operation can therefore delay the next job. There is no automatic POST retry and no cloud fallback.

Backgrounding stops further source/model dispatch and invalidates in-flight results. Returning to the foreground does not automatically continue. If a model request may have been sent, the UI warns about unknown server outcome and duplicate processing/cost before explicit retry. Incomplete checkpoints found after restart receive the same warning: the saved schema cannot prove that no subsequent request was active when the process died. Storage failures preserve validated output in memory and retry checkpoint/commit without resending those chunks to the model.

## Cache, offline restore and settings

The cache fingerprint includes canonical source URL/hash, provider, normalized endpoint, model, prompt version and language direction. Explicit URL open fetches the source again, so changed body content gets a new key. When only the title or previous/next link changes, the cached translation is reused with freshly fetched source metadata and the refreshed record is committed before ready. Offline restore intentionally reads the saved source version; it cannot detect a remote edit without fetching. Model/endpoint/prompt mismatches are rejected. Completed translations do not depend on future chunk budgets; incomplete checkpoints are re-planned and only exact ordered matching chunks are reused. Changed chunk budgets invalidate checkpoint chunk reuse.

Application-owned Preferences hold a strict last-cache-key pointer separately from body files. Startup restores a completed chapter and its saved position in one snapshot. Positions are viewport pixel offsets, rounded to nonnegative safe integers before persistence; UI restoration clamps them to the rendered paragraph height. Settings and pointer failures are visible without exposing raw exceptions or credentials.

An endpoint change detaches the previous credential reference. Secret save/remove operations use captured endpoint generations, so stale completions cannot assign credentials to a newer endpoint. Secret values never enter snapshots or Preferences. The existing explicit save action uses the native secure store; no plaintext fallback is introduced. Prefetch remains inactive and hidden in the production composition until issue #7.

## Evidence and limits

Tests use newly written synthetic HTML, mocked model responses, in-memory private-file adapters and lifecycle fixtures. They exercise real parser/provider/store/controller composition as well as chunk coverage, ambiguous retries, late responses, foreground interruption, storage-only retries, settings/credential races and offline position restoration. No real Syosetu page, local LLM, paid API or genuine credential was used.

Web tests, typechecking, bundle build and native sync do not establish actual Android installation, LAN HTTP policy, Keystore behavior, power-loss durability or kill/restart behavior. Those require issue #8 device evidence. Live source access/content rights, signed release and public distribution remain separate gates.

The source depth regression keeps both a 512-level boundary fixture and the original adversarial 4,000-level fixture. The latter has an explicit 20-second test timeout because jsdom parsing exceeded the default five seconds while integration tests ran concurrently. This changes no production parser limit. Native WebView parsing latency and UI responsiveness on adversarial markup remain unmeasured device concerns.
