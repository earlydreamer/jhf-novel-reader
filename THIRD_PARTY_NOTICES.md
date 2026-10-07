# Third-party notices

## LNReader plugins: Syosetu selectors and extraction structure

- Upstream: https://github.com/LNReader/lnreader-plugins
- Pinned commit: `358388426c0b23674b97760c352ee972b8e4d7b8`
- Source: [`plugins/japanese/Syosetu.ts`](https://github.com/LNReader/lnreader-plugins/blob/358388426c0b23674b97760c352ee972b8e4d7b8/plugins/japanese/Syosetu.ts)
- License: MIT, Copyright (c) 2021 Rajarshee Chatterjee. The complete unchanged license is in [`licenses/lnreader-plugins-MIT.txt`](licenses/lnreader-plugins-MIT.txt).
- Adapted in `src/source/index.ts`: chapter title/body selectors, exclusion of preface/afterword text variants, and per-page table-of-contents selectors.
- Changes: replace Cheerio/plugin fetch with a detached inert browser template and injected SourceTransport; emit plain structured paragraphs/ruby instead of HTML; add URL and navigation validation, deterministic SHA-256 identities, access-page detection, bounded parsing, cancellation checks, and legacy selectors. Remove rankings, search, filters, covers, user-agent impersonation, plugin runtime, and all-page collection.

Only parsing logic is reused. No upstream novel fixture or novel body is included. The upstream code license grants no rights to novel content or permission for automated access. The narou-reader project's own license remains undecided; this notice does not assign it one.

## Pretendard Variable 1.3.9

- Upstream: https://github.com/orioncactus/pretendard
- File: `src/ui/theme/fonts/PretendardVariable.woff2` (unchanged, from the npm package `pretendard@1.3.9`)
- License: SIL Open Font License 1.1. The complete license is in [`licenses/Pretendard-OFL.txt`](licenses/Pretendard-OFL.txt).

## Material Symbols (Outlined, weight 400)

- Upstream: https://github.com/google/material-design-icons (npm `@material-symbols/svg-400@0.47.6`)
- Files: `src/ui/icons/*.svg` (unchanged copies of the icons the app uses)
- License: Apache License 2.0. The complete license is in [`licenses/material-symbols-Apache-2.0.txt`](licenses/material-symbols-Apache-2.0.txt).
