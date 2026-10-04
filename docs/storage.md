# Private storage (#4)

## Composition API

Production composition in issue #6 can import:

- `createNativeReaderStore()` and `createNativeSettingsRepository()` from `src/storage/native`.
- `createNativeSecretStore()` / `createProviderSecrets(nativeStore)` from `src/storage/secrets`.
- `createReaderStore(files)` / `createSettingsRepository(preferences)` for injected fixture backends.

Reader methods implement the unmodified shared `ReaderStore` contract. Settings provide `read()` and `save({config, preferences})`; an absent configuration returns `config: null`, font size 18 and prefetch OFF. The app should show setup when config is null. Fonts accept integral 10–48 px; budgets must be positive safe integers with output smaller than context. Preferences do not include the credential or its value, only an optional opaque `authRef`.

`createProviderSecrets` offers `get(ref)`, `save(ref, secret, persist = false)` and `remove(ref)`. Persistence is an explicit opt-in. Session mode first removes the old durable value for the same reference, then retains the new value only in memory. This deletion can fail; the caller must display the error and must not claim the prior credential was removed. Removal is scoped to one reference, so switching/removing one provider cannot erase another provider's secret. No plugin-wide clear is used. The higher-level coordinator is intended for the native app. `createSessionSecretStore()` is a separate deliberately ephemeral implementation for explicit session-only use; it is never substituted after native errors.

Keep one composed store/coordinator for the application. All reader repositories sharing a file adapter serialize reads and writes through a shared queue; production factories use one adapter. Credential operations likewise serialize plugin setup with the operation. Multiple operating-system processes or distinct custom adapters writing the same paths are not supported. Stale jobs and settings revisions must still be rejected by #6 before persistence. Storage does not claim to cancel or arbitrate translation jobs.

## Body files and durability protocol

The Capacitor Filesystem adapter is native-only. It uses `Directory.LibraryNoCloud`, which maps to app-internal files on Android and the non-cloud Library on iOS, with UTF-8 data. It never requests public/external storage permission and never uses the browser Filesystem implementation. Production paths are constrained below `narou-reader/chapters/` and `narou-reader/positions/`. Position filenames hash the chapter identity; cache filenames use the shared fingerprint key.

Each record uses two journal slots, `name.0.json` and `name.1.json`. Each envelope has `format: 1`, a positive generation, a payload and a SHA-256 checksum of `[format, generation, payload]`.

1. Snapshot the input and validate its entire runtime shape, identity and required content.
2. Read both slots and validate their envelope, checksum and payload. Select the highest valid generation.
3. Write the next generation into the other slot, preserving the newest valid slot unchanged.
4. Read the written bytes back and verify equality before resolving the commit promise.

No rename-overwrite guarantee is assumed. A process interruption or partial write to the inactive slot leaves the previous slot available; a restart selects the highest fully valid record. If the write fully reached storage just before the process died, restart may recover that fully validated generation. If a write fails after bytes are accepted, the caller still sees a failure and may safely retry storage using the already completed translation, without calling the model again.

`commitChapter` is the durable-ready boundary. Checkpoints and completed chapters are separate payload alternatives, and a checkpoint cannot downgrade an already completed record for the same key. Committing the complete chapter replaces checkpoint state in one journal generation. Prior checkpoints may still physically exist in the recovery slot. There is no network dependency for loading source, translation or position.

The checksum detects accidental corruption, not malicious tampering by an actor who already controls app-private files. Native file writes do not expose an explicit fsync barrier. Power-loss durability, Android OEM storage behavior and real kill/restart behavior require device validation; mocked tests do not establish those properties.

## Validation, schemas and recovery

- Inputs and restored payloads reject unknown fields, missing/duplicate/empty translation IDs/text, inconsistent chapter/token identity and invalid ruby ranges. Completed IDs must match the complete source paragraph order exactly.
- A checkpoint contains only `validated: true` chunks with unique chunk and output IDs. Split-segment IDs are permitted because splitting/reassembly belongs to #6; the orchestrator must establish semantic completeness before creating a validated chunk.
- The shared cache key is recomputed from canonical URL, source hash, provider, endpoint, model, prompt version and direction. Source identity must agree with the embedded chapter. Source bytes are not independently rehashed with a second parser algorithm. Secrets never participate in this fingerprint.
- URLs in stored configuration/identity reject unsupported schemes, userinfo, query and fragments, preventing credentials from being embedded in endpoint URLs. Source URL fields additionally require HTTPS.
- Envelope, chapter/checkpoint and settings schema 1 are the first persisted versions. There is no released schema 0 to migrate. Future envelope/payload/settings versions fail with `unsupported_schema` and are not overwritten, even when an older valid slot exists. A later schema migration must explicitly validate the old version, transform to the new payload and commit through this journal; there is no best-effort downgrade or speculative migration.
- A corrupt latest slot falls back to a valid older slot. Two corrupt slots throw `corrupt`, not a cache miss. An explicit new validated save can rebuild a fully corrupt body/position record; reads never silently reset it. Unknown schemas and I/O failures remain protected from overwrite.
- Settings corruption throws instead of silently turning prefetch on or replacing the user's configuration. An absent record alone returns defaults. This first version has no destructive settings-reset UI/API.
- Explicit ENOSPC/EDQUOT errors map to `disk_full`; other plugin errors map to `io`. Capacitor's wrapped Android ENOSPC error is classified without retaining its path or message. A native implementation that does not expose the underlying storage-full code remains `io`.
- Only the plugin's documented file-not-found code becomes a missing record. Permission errors never become cache misses. Raw native messages, paths, body text and secrets are neither retained in exceptions nor logged.

Read positions are stored independently by chapter ID, with the paragraph ordinal observed by a read/commit. Existing IDs clamp offsets to the currently displayed paragraph length. A removed ID moves to the nearest valid saved ordinal with offset zero; unknown positions fall back to the first paragraph. Call `read` before saving a position after app restart so the repository can remember the paragraph's ordinal. Different cached translations of one chapter share that chapter's last position.

## Native secret guarantees and limits

Only Android/iOS native platforms may call `@aparajita/capacitor-secure-storage`. Web and unknown platforms reject before any plugin call because the plugin's web implementation is plaintext localStorage. Every operation awaits fixed prefix `narou-reader.credentials.`, synchronization OFF and `KeychainAccess.whenUnlockedThisDeviceOnly` setup. Raw `getItem`/`setItem` preserve the credential string without JSON conversion. Backend/setup errors are surfaced as sanitized storage errors; there is no Preferences, file or localStorage fallback.

Android uses the selected plugin's Keystore/AES-GCM implementation. Existing foundation backup exclusions remain unchanged. This PR does not prove hardware-backed keys, Keystore availability, uninstall behavior, actual backup/restore exclusions, iOS Keychain behavior or iOS support of the complete app. Credentials can remain in process memory until garbage collection; JavaScript cannot guarantee zeroization. No genuine keys or provider calls are used in tests.

## Verification

Targeted tests cover journal write/disk-full/partial-write failure, corruption, fingerprint changes, checkpoint recovery, offline position repair, schema protection, allowlisted settings, default-OFF prefetch, unsupported-native failure, credential setup ordering, scoped deletion and lack of fallback/log leakage. Fixtures and injected in-memory adapters only.

Run `npm ci`, `npm run typecheck`, `npm test -- --run`, and `npm run build`. This environment required `npm ci --cache /tmp/narou-storage-npm-cache` because its default home cache path was unavailable. Native adapter tests check option contracts, not actual Android/iOS storage. APK/device testing is explicitly deferred to #8.
