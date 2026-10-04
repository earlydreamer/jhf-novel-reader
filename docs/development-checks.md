# Development checks

Run these checks before proposing a change:

- `npm ci`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

The development toolchain requires Node `^22.18.0 || >=24.11.0`, matching Babel 8's supported engines. CI uses Node 24. This changes the development environment requirement, not the React, TypeScript, Vite or Android runtime versions.

## TypeScript and React checks

TypeScript 7.0.2 remains the standalone type checker, with `strict` and `noUncheckedIndexedAccess` unchanged. The current [typescript-eslint dependency support table](https://typescript-eslint.io/users/dependency-versions/) supports TypeScript `>=4.8.4 <6.1.0`, so the project does not install an unsupported parser or force its peer dependencies.

ESLint 10 uses Babel 8's documented [TypeScript and JSX parser plugins](https://babeljs.io/docs/babel-parser#plugins) and the official [React Hooks recommended rules](https://react.dev/reference/eslint-plugin-react-hooks). This checks the syntax used by this repository and React correctness. It does not provide type-aware TypeScript lint rules or promise support for every future TypeScript syntax extension. Unsupported syntax fails lint; type errors still fail the separate `tsc` check. The pinned toolchain has been checked against the full source tree and positive/negative hook-rule probes.

Prettier checks the active renewal screens, routes, controller, contracts, shell stylesheet, preview fixtures and tool configuration. This is deliberately an incremental formatting boundary: legacy runtime files and legacy regression tests are not reformatted during replacement. Formatting-only changes are kept separate from functionality.

## Synthetic preview and temporary legacy tests

With the Vite development server running, open `/tests/ui/renewal-preview.html` for a labelled, synthetic 390 × 844 phone preview. It supplies only test fixtures and cannot send a real translation request. These preview modules are not imported by the production entry point.

The production entry point currently exposes the renewal screens with unavailable native integration controls. Real source browsing, model access, whole-chapter translation, secure configuration persistence and durable library integration require their new adapters before device validation. No old chunk or prefetch job is dispatched by this entry point.

Old UI copies under `src/ui/legacy` and `src/app/legacy` are used solely by preserved regression tests. They are temporary migration scaffolding, not a second production route. Remove them when their safety coverage has been ported to the integrated renewal flow.
