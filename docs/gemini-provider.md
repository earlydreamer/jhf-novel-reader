# Optional Gemini provider (issue #9)

Gemini is an explicit alternative to the local OpenAI-compatible provider. It is not a fallback. This implementation has synthetic protocol/application tests, not a live-key acceptance test. No real Gemini requests or paid calls were made during development. Android physical-device gates in [android-validation.md](android-validation.md) remain open independently.

## Before use

1. In **번역 공급자**, choose **Gemini · Google 클라우드**. The endpoint is fixed to Google's HTTPS API.
2. Check the current [models and capabilities](https://ai.google.dev/gemini-api/docs/models). Enter a text model ID that supports structured output and its appropriate budgets. No cloud model or model-specific capacity is bundled as a current default. The budgets are conservative application limits, not a promise about available quota or exact token counts.
3. Review [pricing](https://ai.google.dev/gemini-api/docs/pricing) and [data processing / terms](https://ai.google.dev/gemini-api/terms), acknowledge transmission, then apply the provider/model/budgets together. Input paragraphs and their nearby read-only context go to Google. Fees and processing conditions depend on the selected model, service tier and region; unpaid data may be used for improvement and human review. Do not submit sensitive material to unpaid services. The app does not create an account or accept terms for the user.
4. Save your own Gemini key in the Android OS-backed secure store. No shared key exists. Switching providers/endpoints detaches the old credential and requires a new explicit save. Only a reference is stored in settings; keys are never displayed, included in cache identity, or logged. The draft provider cannot receive a key before it has been applied.
5. Open only a source chapter you are authorized to access and translate. Next-chapter prefetch starts off and resets off when changing providers. Turning it on can transmit an additional chapter and incur additional cost.

A timeout or uncertain cancellation does not prove Google stopped processing. Automatic POST retries are **zero**. Explicit Retry may duplicate processing and charges; the reader displays that warning. HTTP 429 remains a connection error with status 429 for quota diagnosis and never triggers a silent retry.

## Protocol, checked 2026-10-04

Primary references:
- [generateContent endpoint and response](https://ai.google.dev/api/generate-content#method:-models.generatecontent)
- [GenerationConfig](https://ai.google.dev/api/generate-content#GenerationConfig), [ResponseFormatConfig](https://ai.google.dev/api/generate-content#ResponseFormatConfig)
- [API-key header guidance](https://ai.google.dev/gemini-api/docs/api-key)
- [Troubleshooting / quota errors](https://ai.google.dev/gemini-api/docs/troubleshooting)

The nonstreaming route is `/v1beta/models/{model}:generateContent`. Authentication uses `x-goog-api-key`, never a URL query parameter or Bearer substitution. The REST reference currently describes `generationConfig.responseFormat.text` with `mimeType: "APPLICATION_JSON"` and a JSON Schema. This implementation uses that shape; it does not copy the newer Interactions API's differently shaped `response_format`. `responseSchema` is documented but deprecated. API documentation evolves; this is a dated implementation contract, not live compatibility evidence for every account/model.

A single candidate is requested. The decoder accepts only STOP with valid JSON and exactly the requested nonempty paragraph IDs in source order. It omits `thought: true` text, joins ordinary text parts, and rejects tools, executable code, media and malformed parts. MAX_TOKENS, safety/recitation blocks, prompt blocks and unknown finish reasons cannot become completed chapters or validated checkpoints. Surrounding context stays input-only. Provider output remains text, never executable HTML or tool instructions.

The common planner is unchanged: conservative UTF-8 byte estimates and framing reserve determine ordered segments. Gemini additionally checks its complete provider-specific serialized body, including the JSON schema, plus framing and output reservation before reading any key or dispatching. Very small budgets can fail locally rather than send an oversized request. Output budget includes whatever tokens the selected model accounts against `maxOutputTokens`; thinking models may exhaust it before producing enough answer text. The service remains authoritative about its model limits.

## Coordinated boundary/security review

Issue #9 extends these shared paths only after coordinator approval:
- `src/contracts/index.ts`: optional, narrowly named `ModelRequest.geminiApiKey`; no arbitrary header map and no changes to persisted data schemas.
- `src/platform/http/index.ts`: Gemini key permitted exclusively for the literal HTTPS Google host, v1beta and safe model-ID generateContent path. Reject queries, fragments, userinfo, alternate hosts/ports, unsafe paths and mixed authentication before native dispatch. Gemini bodies do not receive OpenAI's `stream` field. Existing local requests still force `stream:false`.
- Native redirects stay disabled before dispatch; the final URL is checked as defense in depth. Source transport constructs fresh Accept-only headers. Known native errors are reconstructed without raw message/cause; bridge logging stays disabled.
- `src/app/compose.ts`, `src/app/controller.ts`, `src/jobs/engine.ts`: explicit provider construction, matching normalized endpoint/model cache identity, secret-generation isolation and the existing shared single-request scheduler. There is no secondary provider attempt on failure.
- `src/ui/SettingsScreen.tsx`, `src/app/Application.tsx`: explicit cloud acknowledgment, no cloud defaults, provider/budget application, disabled credentials for an unapplied endpoint and visible cost/duplicate-request warnings. An applied persisted Gemini config represents the user's provider choice; with prefetch disabled, restoration makes no new request. A previously enabled prefetch preference can resume the one-next-chapter behavior after an offline-restored chapter becomes ready in the foreground.

No dependencies, permissions, API credentials, native security policy, account settings, proxy, backend or deployment were added. The platform contract change is covered by header-isolation, target rejection, no-retry, redirect, cancellation and sanitized-error fixtures; local boundary tests still run.

## Verification

Run `npm run typecheck && npm test -- --run && npm run build`, then `npx cap sync android`. Relevant suites:
- `tests/providers/gemini/provider.test.ts`: independent Gemini envelopes, malformed output, safe model/endpoint, key and budget boundaries, completion/safety/truncation/quota and uncertain outcomes.
- `tests/providers/contract.test.ts`: common provider ordering/context and no-retry invariants.
- `tests/contracts/gemini-http.test.ts`: real application transport over an injected native client; no network.
- `tests/integration/gemini.test.ts`: real parser/provider/store/engine composition, default-off prefetch, local failure isolation, offline restoration and explicit retry.
- Settings/controller regressions verify acknowledgment, secret isolation and switching races.

Rebuild and audit the debug APK using [the Android instructions](android-validation.md). Compiling an APK and instrumentation tests does not mean device tests ran. Cloud-browser preview was blocked on localhost in this environment; jsdom UI behavior and production build checks are separate evidence. Real-key calls require separate explicit permission and a spending limit; none is implied by building this adapter.
