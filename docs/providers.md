# Local OpenAI-compatible provider

`createOpenAICompatibleProvider(config, transport, secrets)` implements `TranslationProvider` in `src/providers/openai-compatible`. Inject the existing native `ModelTransport` and OS-backed `SecretStore`; no fetch/browser fallback, SDK, companion server or cloud adapter is constructed here. App composition belongs to issue #6.

## Configuration and endpoint identity

- `provider` must be `openai-compatible`; `model` must be nonblank. The trimmed model is sent to the server. Use this same effective model in cache identity.
- `normalizeOpenAICompatibleBaseUrl` accepts HTTP/HTTPS server roots or explicit `/v1` API bases (including reverse-proxy prefixes ending `/v1`). Root, trailing slash and `/v1/` variants normalize to the same `/v1` base. Callers must use this exported result as `CacheIdentity.normalizedEndpoint`. The request appends `/chat/completions` exactly once. Full operation URLs, other paths, query parameters, fragments and URL credentials are rejected.
- `authRef` is optional. Without it, no secret lookup or Authorization header occurs. With it, read the secret immediately before dispatch and send it only as `Bearer` authorization. Missing/unreadable/blank/invalid-header credentials fail before POST. Do not put raw keys in `ProviderConfig`, URLs, cache identity, logs or source requests.
- `contextBudget` is the user-verified total context-token budget; `outputBudget` is the output-token reservation and becomes `max_tokens`. Both must be positive safe integers and output must be smaller than context. No model defaults or claimed context capacities are invented.
- This provider guards input using UTF-8 bytes of the serialized messages plus 256 framing units, then adds the output reservation. This is deliberately conservative for common byte-based tokenizers but is **not a tokenizer or a guarantee for an arbitrary model/chat template**. Issue #6 must budget chunks, preserve context/output separation and allow conservative limits; the selected server is authoritative. Ollama's actual loaded context must be configured independently by the user; sending `max_tokens` does not enlarge it.

## Request and result

Each invocation performs at most one nonstreaming POST to the selected endpoint, with `stream:false`, `model`, `max_tokens` and two messages. No tools or response-format extension are required. The system instruction requests Korean translation and JSON `{ "paragraphs": [{ "id": "...", "text": "..." }] }`. Context, source paragraphs, requested IDs, direction and prompt version are JSON data in the user message. Embedded novel instructions/URLs never trigger tool calls, external requests or credential access.

Only `stop` plus one valid response choice, valid JSON, exact ordered requested IDs and nonblank text produces `complete`. `length` maps to `length`; `content_filter` maps to `blocked`; unrecognized finishes/tool finishes map to `unknown`. All noncomplete finishes return an empty paragraph array, so truncated JSON cannot obscure the finish status or become a valid partial translation. Markdown fences are intentionally not guessed or repaired. Whole-chapter validation and durable commit still belong to orchestration/storage.

## Errors and recovery

`ReaderError` carries fixed codes/outcomes/status only; provider code never logs raw exceptions, responses, source text or keys.

- HTTP 401/403: `auth`, `received`, status retained.
- HTTP 429: `connection`, `received`, status 429 distinguishes rate limiting without extending the shared error union. Other non-2xx statuses use `connection` and their status. There is no automatic delay/retry.
- Known native `connection/not_sent` errors stay known. Transport timeout/unclassified connection interruption becomes `timeout_unknown/unknown`, because the server may already have processed the request.
- Malformed successful response: `invalid_output/received`; invalid chunk or exceeded estimated budget: `invalid_output/not_sent`.
- Pre-dispatch abort sends nothing. An abort after POST waits for transport settlement, then rejects `cancelled/unknown`; the orchestration single-request slot must remain held until that promise settles.

Expose `getLocalConnectionGuidance()` with connection failures: localhost on the phone means the phone itself. Check the PC's LAN address and whether the existing Ollama/LM Studio server is running. No firewall/server configuration changes or public internet exposure are needed by this adapter. Android LAN cleartext policy and actual device reachability remain issue #8, not proven by synthetic tests.

For unknown outcomes, show the user that explicit retry may duplicate server work/cost before starting another request. Never silently switch to Gemini or another endpoint. Choosing a local server does not itself prove a selected model runs locally; users should verify their existing server/model configuration rather than select a server-side cloud model accidentally.

## References and verification

Protocol references checked during implementation: [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility) and [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions). Both expose `/v1/chat/completions`; the implementation uses only their common nonstreaming message interface.

Independent synthetic Ollama and LM Studio envelopes cover success, optional auth, request data boundaries, normalization, budget rejection, malformed JSON/IDs, finish reasons, HTTP errors, cancellation and one-POST unknown outcomes. No real model/server, source-site, paid API, Android device, firewall or credential change is exercised.
