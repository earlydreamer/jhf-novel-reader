# Opt-in next-chapter preparation (#7)

The saved `prefetchEnabled` preference defaults to false. The visible checkbox explains that enabling it sends the next chapter's source to the selected model endpoint and can incur extra cost for a hosted endpoint. No cloud fallback or paid API test is included. The preference persists alongside font size and survives app restart.

## Dispatch and ownership

Only a validated, committed current-reader `ready` snapshot supplies a candidate to `createPrefetchCoordinator`. It prepares that chapter's direct `nextUrl`, never a whole work or the neighbor of a speculative result. Changing the current URL, retrying/resuming the current reader, changing model/endpoint/settings revision, cancelling, or disposing invalidates the candidate. Reentrant navigation from a current-ready listener is also checked before scheduling.

Current and speculative engines share exactly one `createRequestScheduler` instance in `compose.ts`. Current queued requests have priority. An aborted request that already reached the provider retains the native slot until its promise settles; JavaScript abort never proves server cancellation. Queued aborted requests are removed without dispatch. Native timeouts may therefore delay current navigation, but cannot trigger concurrent POSTs or automatic retries.

The reader subscribes only to the current engine. Only that engine has the last-cache-key callback. Prefetch never replaces the visible chapter, reading position, reader error, or restore pointer. Both engines use the same serialized reader store, so an already-started write finishes before a newer session reads/writes its cache. Session checks prevent retired responses from initiating later writes. The ordinary fingerprint includes source hash and model identity; refetching a changed source cannot reuse another body's translation.

## Foreground, OFF and interruption

OFF means no new next-chapter source or model request. Backgrounding cancels speculative work. If the current reader is still ready, an unchanged candidate can begin on foreground return or explicit opt-in. In-memory work paused before dispatch or after a validated chunk can safely continue from those verified chunks without retranslating them.

An active request cancelled by OFF/background/navigation can still be processed remotely. Its late result is discarded and the native slot remains occupied until settlement. Unknown outcomes, source/model failures and storage failures do not auto-retry when toggling or foregrounding. A recovered incomplete checkpoint is conservatively unknown because the persisted schema cannot prove whether a later request was sent before process death. Opening that chapter shows the existing duplicate-processing/cost warning; only explicit reader resume/retry permits further model calls. Valid complete neighbor caches are reused without another model call.

Speculative failure does not interrupt the ready reader; there is no separate speculative progress/error UI in this version. Navigating to the neighbor uses the regular reader error/retry flow. No background service or OS-surviving task is promised.

## Evidence

Synthetic tests cover default OFF, persisted opt-in, A→B with no C, current failures, late native settlement with max active count 1, current queue priority, OFF/background invalidation, source/settings races, cache reuse, last-pointer ownership, storage failure isolation, checkpoint recovery and known-unsent foreground continuation. No real source page, PC server, API key or paid model was contacted. Actual Android lifecycle/kill/restart, LAN access and secure-store behavior still require device evidence under #8.
