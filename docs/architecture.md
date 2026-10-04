# Foundation contract (issue #1)

## Scope and ownership

Android first: a React/TypeScript/Vite UI packaged with Capacitor. The phone owns source fetch, parsing, translation requests, and private storage. A PC only runs the user's existing Ollama/LM Studio server. No operator backend, proxy, PC companion, live scraping, or paid provider calls are added here. The shell is intentionally not a working translator.

`src/contracts/index.ts` is the single shared API. The source, provider, storage, and UI workstreams implement these boundaries in their own directories. Changes to package/lock/config/contracts/platform require a coordinated prerequisite PR. `src/app` assembles services in issue #6. Synthetic fixtures only until content rights and source access are resolved.

## Runtime/toolchain

Pinned registry versions checked during foundation implementation; `package-lock.json` is authoritative:

- React/React DOM 19.3.0, TypeScript 7.0.2, Vite 8.3.2, React Vite plugin 6.1.1, Vitest 5.0.3.
- Capacitor core/Android/CLI 8.5.2; App 8.1.2, Filesystem 8.1.4, Preferences 8.0.1.
- Node >=22.12 (CI: Node 24). Local verification uses Node 24.19.0. Vite requires Node ^20.19 or >=22.12; Capacitor 8 requires Node 22+. [Vite guide](https://vite.dev/guide/), [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup).
- Generated Android baseline: minSdk 24, compile/target SDK 36, Java 21, Android Studio 2025.2.1+. Device/APK validation is a separate gate, not established by web tests.
- jsdom and Testing Library are dev-only dependencies for the upcoming parser/UI fixture suites; production parsers can use the WebView DOMParser. No web request proxy is configured.

Common commands: `npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run build`. Run `npm run android:sync` after web/native dependency changes. CI uses only mocks and fixtures, without API keys or source-site access.

## Boundary types and invariants

- Chapter includes canonical URL, work/chapter IDs, title, neighbor URLs, source hash and ordered Paragraphs. Ruby offsets are UTF-16 string indices into paragraph text, end-exclusive. A paragraph ID hashes chapter identity, ordinal, text and ruby; duplicate text at different positions stays distinct. Hashes are SHA-256, requiring a secure browser context (native localhost is secure).
- ChunkRequest separates read-only context, ordered input segments and outputIds. A split segment receives its own stable ID; orchestration in #6 owns mapping/reassembly. Providers return ordered ID/text values and complete/length/blocked/unknown finishReason, never executable instructions.
- CacheIdentity covers canonical URL, source hash, provider, normalized endpoint, model, prompt version and language direction. Endpoint normalization belongs to the provider/settings boundary; use the same normalized string for requests and identity. Secrets/authRef are excluded. `createCacheKey` hashes a fixed-order tuple.
- Only validated chunks enter Checkpoint. The persistence layer in #4 validates input and recovered data, not just TypeScript types. CompletedChapter is not proof of durable storage until commitChapter resolves. Whole-chapter ID/completeness validation belongs to #6; UI must show translated text only after ready.
- JobToken compares jobId/chapterId/settingsRevision. Controller increments revision on effective model/endpoint/settings changes and rejects stale results.
- ReaderStore returns completed chapter/checkpoint/position separately. Positions use chapterId/paragraphId/offset. Production body files are app-private; preferences only hold small non-secret settings; SecretStore exclusively owns credential references.
- UI callbacks own no transport or persistence policy. Credentials flow only through ephemeral password input and onSaveSecret, never SettingsViewState. Model/endpoint edits emit a config without revision, which the controller advances.
- Job phases distinguish preparing, translating, validating, saving, ready, failed, unknown and paused. Prefetch is default OFF and is bounded to the next one chapter in foreground; orchestration is not implemented here.

## HTTP and cancellation

SourceTransport exposes GET(url, signal), without a headers/auth argument. It constructs a fresh Accept-only header map; credentials in URL userinfo and non-HTTPS source URLs are rejected. Source host/path allowlisting belongs to #2. ModelTransport owns optional Authorization and JSON POST for local requests, forcibly sets `stream:false`, and performs exactly one request. Issue #9 adds a narrowly scoped Gemini key field and fixed-target header route without OpenAI fields; see [the Gemini boundary review](gemini-provider.md). There is no automatic cloud fallback or POST retry.

Direct `CapacitorHttp.request` is native-only; browser fallback fails closed. Global fetch/XMLHttpRequest patching stays disabled. `disableRedirects:true` is sent before dispatch; every 3xx is rejected, with final URL equality checked as defense in depth. Installed Capacitor 8.5.2 Android source was inspected: HttpRequestHandler passes the flag to CapacitorHttpUrlConnection, which calls setInstanceFollowRedirects(false). [Official HTTP API](https://capacitorjs.com/docs/apis/http). Injected clients must honor the same pre-dispatch guarantee. The comparison after response alone is not a credential-leak defense.

Native HTTP cancellation cannot guarantee remote cancellation. Abort before dispatch sends nothing. Abort after dispatch marks results stale, but the promise waits for native settlement before rejecting; schedulers must keep their single in-flight slot until then. Model connection/timeout failures conservatively become timeout_unknown because execution may have occurred. Known local ReaderError failures keep their not_sent outcome. The UI/controller may show cancellation immediately, but must not start another model request while the native promise remains pending. Native read timeout is inactivity-based, not a guarantee of total duration. A stuck native operation can therefore delay the next operation; do not release its slot using a JavaScript-only timer.

Error codes are source_access/source_parse/connection/auth/timeout_unknown/invalid_output/storage/cancelled. HTTP status mapping is provider/source-specific. Capacitor `loggingBehavior:'none'` also disables native bridge argument logging, including debug APKs; the default debug bridge otherwise logs raw plugin parameters before app-level redaction. Diagnostics use `toSafeLog`, an event/code/numeric allowlist: raw exceptions, URLs, IDs, headers, keys and content are never copied.

## Secure storage selection

Selected dependency: `@aparajita/capacitor-secure-storage` **8.0.1** (MIT, supports Capacitor 8). Android uses Keystore and AES-GCM-encrypted SharedPreferences; iOS uses Keychain. Its September 23, 2026 release includes Android prefix-clear safety fixes. [Maintainer docs](https://github.com/aparajita/capacitor-secure-storage), [changelog](https://github.com/aparajita/capacitor-secure-storage/blob/main/CHANGELOG.md).

Storage worker requirements:

1. Reject non-native/unsupported platforms before any plugin call: plugin web storage is plaintext localStorage. Never fallback to plaintext on any native error.
2. Use a fixed nonblank app-specific key prefix. Use getItem/setItem consistently for raw strings; get/set JSON-serialize values.
3. Explicitly disable iCloud synchronization and use `KeychainAccess.whenUnlockedThisDeviceOnly` for iOS writes. Await accessibility setup before writing. Keychain values may survive uninstall; device-only is not a claim that all backups vanish.
4. Android encrypted preference file is `WSSecureStorageSharedPreferences.xml`. Foundation disables backup and excludes all sharedpref/file/database/root/external data in both legacy backup and Android 12+ cloud/device-transfer rules. These are conservative private-data exclusions. Device behavior still needs validation; hardware backing is not guaranteed on every phone. [Android backup guidance](https://developer.android.com/identity/data/autobackup).
5. Treat secure-store errors as errors, with no secret in logs or config snapshots.

Compared: `capacitor-secure-storage-plugin` supports Capacitor 8 but has base64-only web storage and less explicit iOS accessibility controls; Capawesome Secure Preferences has a paid registry requirement. No paid package/account is needed. SecretStore implementation belongs to #4, not this foundation.

## Verification limits / handoff

Web build and contract tests do not establish Android APK/device correctness. Native redirect behavior, Keystore backup/restore, LAN endpoint communication, lifecycle interruptions and storage atomicity still require #8 device evidence. No cleartext/network-security override is enabled here; #8 must review the narrowest Android policy required for explicitly chosen local HTTP endpoints. No firewall/server settings are changed. No signing keys, release build or deployment are included. Project license remains undecided.
