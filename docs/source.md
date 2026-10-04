# Source adapter (issue #2)

`src/source/index.ts` exports `NarouSourceAdapter`, `normalizeSourceUrl`, `parseChapter`, and `parseWork`. Supply the existing credential-free `SourceTransport`; the production transport must disable redirects before dispatch as required in `docs/architecture.md`. The adapter independently rejects non-200 responses, mismatched final URLs, absent/non-HTML content types, and non-string bodies. Cancellation is checked before requests and after native settlement and hashing. It performs no retries.

## URLs and bounded resolution

Only HTTPS `ncode.syosetu.com/nNNNNx[x]/` work/short-story URLs and `/nNNNNx[x]/<positive-safe-integer>/` chapter URLs are supported. Host/work-code casing and a missing trailing slash are normalized; fragments are removed. Query parameters, credentials, non-default ports, dot segments, escaped paths, whitespace/control characters, other schemes, and other hosts (including adult hosts) are rejected. Work information pages such as `/novelview/infotop/` are not supported: use the work's canonical URL. No login, age check, CAPTCHA or block bypass exists.

A work-root short story is parsed directly. Otherwise, a valid first-page TOC resolves to its first listed safe same-work chapter with one additional GET. No TOC pagination, parallel requests, full-work collection, or prefetch is performed. `parseWork` exposes that page's title and valid deduplicated chapter entries for callers needing metadata; it never fetches links. Prev/next links are plain strings, restricted to the same work and correct episode direction. Unsafe links are discarded. HTML `<base>` is ignored.

## Extraction and identity

A detached HTML template is used because its content stays inert, including remote image/frame resources. Parsed nodes are never inserted into the live document. Active/resource nodes are removed, and only text plus ruby UTF-16 offsets are returned. UI consumers must render strings as text, never HTML. Paragraph order, empty paragraph spacing, internal `<br>` line breaks and Japanese fullwidth indentation are retained; ASCII edge formatting whitespace is removed. Ruby readings are separated from base text, including sequential base/reading pairs. Complex grouped base/reading lists, nested ruby and `rtc` annotations are rejected as `source_parse` rather than silently dropping readings. Preface and afterword sections are excluded, matching the pinned upstream selector.

Missing title/body, multiple candidate body containers, empty content, mixed non-paragraph text that would be omitted, nesting deeper than 256 levels, over 100,000 nodes, and over-2,000,000-character input fail as `source_parse`. Known access-page titles/forms/challenges fail as `source_access`. Detection is deliberately conservative and cannot recognize every future interstitial; unsupported layouts fail instead of returning an empty successful chapter.

`parseChapter(html, url): Promise<Chapter>` is network-free and deterministic. This intentionally refines issue #2's synchronous sketch to async so it can reuse the foundation's SHA-256 `createParagraphId` and browser Web Crypto without duplicating cryptography. `SourceAdapter.getChapter` is unchanged. IDs include chapter identity, ordinal, normalized text and ruby; repeated paragraphs at different positions differ. Source hash is SHA-256 over canonical URL and ordered normalized text/ruby (not executable markup, tracking attributes or title). Hashing requires Web Crypto, available in the native secure localhost context.

## Attribution and verification limits

See `THIRD_PARTY_NOTICES.md` for the exact upstream revision, adapted selectors and MIT license. Tests contain only newly written synthetic content and mocked transport responses. No copyrighted novel was fetched, no real Syosetu request was made, and no public distribution or novel-access rights are established. Live-source usage remains gated on separately verifying permitted access and content rights. Android/WebView resource-inertness, native transport behavior and real-device functionality require issue #8 validation.

Common checks: `npm ci`, `npm run typecheck`, `npm test -- --run`, `npm run build`. In restricted dot VM environments, use a writable npm cache (`npm ci --cache /tmp/narou-source-npm`); this does not modify dependency pins.
