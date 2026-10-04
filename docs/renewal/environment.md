# Renewal baseline and execution environment

Recorded 2026-10-04 (UTC). This is T0 preparation, not a renewal feature implementation or native/device acceptance result.

## Source identity and isolation

- Repository: `earlydreamer/narou-reader`.
- Verified remote `main` and clean starting `HEAD`: `acb473b1576a33208b6cbf510bde9c71eb3009b5`.
- Exact root tree: `8ea6aaa4ca65ccc841d4e94e26ac84a4bc205f6b`.
- `package-lock.json` SHA-256 before and after baseline checks: `cdb02b024da36f03c0312ad4f0fb86cb774e71f5d7807f1e4b995ecb305dae5c`.
- `legacy/pre-renewal-acb473b` preserves this exact commit; new work uses `renewal/first-reading-slice` in an isolated linked worktree. No existing branch was overwritten.
- The baseline checkout had empty `git status --porcelain`; `git fsck --full` completed with exit 0.
- The user's PC and its 14 uncommitted files were not accessed, moved, read, cleaned, or backed up. Their backup status remains unknown.

Direct private-repository HTTPS clone could not authenticate. The connected GitHub repository API supplied the original signed commit, complete recursive tree and text blobs. Binary repository files were downloaded using the connector-returned file download URLs. All 139 blob object IDs (including 27 binary entries), 73 tree object IDs and the original signed commit object ID were verified before checkout. This is an exact Git-object shallow checkout, not a re-created initial commit or an unverified file dump. The baseline is marked as a shallow boundary; earlier ancestry is retained on GitHub and is not locally hydrated. No account token was extracted or credential installed. Subsequent publication uses the connected GitHub Git Data API.

## Available toolchain

| Tool | Observed version/status | Renewal requirement |
| --- | --- | --- |
| Git | 2.52.0 | Exact revision/worktree checks available |
| Node | 24.19.0 | Meets >=22.12.0 and CI Node 24 |
| npm | 11.9.0 | Lockfile installation available |
| Java | OpenJDK 21.0.12.1 | Java 21 available |
| Android SDK/platform 36 | Not found; SDK environment variables unset | Needed before local native build |
| Android build-tools 35.0.0 | Not found | Needed before local APK audit |
| Physical phone/LM Studio/Ollama | Not used in T0 | G1/G2 require actual evidence |

Installed project dependencies remain those in the baseline lockfile: React 19.3.0, TypeScript 7.0.2, Vite 8.3.2, Vitest 5.0.3 and Capacitor 8.5.2. No runtime or lockfile version changed. T1 must verify compatible lint/format tool versions before adding them.

The first `npm ci` attempt failed with `ENOENT` while writing the default `/home/agent/.npm` cache. Setting `npm_config_cache=/tmp/narou-npm-cache` recovered it without modifying repository files, credentials, or global settings. npm also reports an environment `http-proxy` warning and the existing `uuid@7.0.3` deprecation; neither failed the recovered baseline checks.

## Baseline results

Commands ran on the exact clean baseline with synthetic fixtures/mock transports only; no live source/model requests.

| Command | Result |
| --- | --- |
| `npm_config_cache=/tmp/narou-npm-cache npm ci` | PASS, 208 packages installed |
| `npm run typecheck` | PASS, exit 0 |
| `npm test -- --run` | PASS, 28 files / 465 tests, exit 0 |
| `npm run build` | PASS, exit 0 |
| Android APK/instrumentation/audit | NOT RUN, SDK/build-tools absent locally |
| Windows APK audit | NOT RUN, remains #28 acceptance requirement |
| G1/G2 actual phone/source/local-model flows | NOT RUN, remains #25/#28 acceptance requirement |

Android tooling absence does not block the web baseline or T1. Do not accept SDK legal terms, create credentials, change security settings, move execution to another environment or claim native acceptance without the required authorization/evidence. Existing Android CI separately checks its preinstalled SDK and builds exact-source debug artifacts; it does not establish physical-phone or Windows success.
