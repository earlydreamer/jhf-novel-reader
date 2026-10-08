# Reader UI boundary (issue #5)

`ReaderScreen` accepts only `ReaderViewState & ReaderActions`; `SettingsScreen` accepts only `SettingsViewState & SettingsActions` from the shared contracts. Import from `src/ui/ReaderScreen` and `src/ui/SettingsScreen`. CSS is imported by each component and scoped to their classes. The production entry remains intentionally unchanged; issue #6 owns composing the actual controller.

- A chapter is visible only in `ready` with a non-null committed chapter. Preparing, translating, validating, saving, paused, failed and unknown states do not show stale or partial paragraphs.
- Source ruby uses UTF-16 offsets and safe React text/ruby nodes. Invalid/overlapping annotations are ignored. Model strings, titles and ruby readings are never HTML. Neighbor controls accept supported HTTPS URLs and emit navigation callbacks, never arbitrary links.
- UI URL validation is a convenience boundary; source adapter remains authoritative. Endpoint fields reject credentials, query/hash and non-HTTP(S) schemes. Model config is submitted without settingsRevision; the controller increments revision and invalidates work. Local model only; Gemini is a disabled future option.
- Secret entry uses an uncontrolled password input, cleared before awaiting `onSaveSecret`. Neither config nor state snapshots receive the value. Generic failures never render raw exceptions. Status comes from the controller/secure store. The controller must not claim success without secure persistence.
- Font size, original/translation toggle, navigation and reading-position events are controlled. On focus and scrolling the current paragraph ID and pixel offset emit through `onPosition`. Matching restored positions scroll once when the committed chapter identity changes; the explicit “읽던 위치로” control restores again. A future font/layout change may shift a pixel offset within a paragraph.
- Unknown outcomes have a duplicate-processing/cost warning and explicit retry. Storage failures request storage retry. The controller owns idempotency, network cancellation and server-settlement policy.
- Prefetch reads the shared default-off preference and emits explicit changes; UI makes zero requests. The source-transmission and potential cloud-cost notice is shown before the checkbox for all endpoints, including hosted OpenAI-compatible servers.

## Synthetic preview and tests

`npm run dev -- --host 0.0.0.0`, then open `/tests/ui/renewal-preview.html`. It is a labelled, synthetic 390 × 844 phone preview that supplies only test fixtures and cannot send a real translation request; the production entry does not import it. Tests run with jsdom/Testing Library; no source site or model is contacted. Narrow-screen visual verification is separate from native Android validation.
