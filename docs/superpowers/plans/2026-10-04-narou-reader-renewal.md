# Narou Reader Renewal Implementation Plan

**Goal:** 앱 안에서 찾은 작품의 원하는 회차를 한 번의 시작 동작으로 번역·저장하고 읽는다. 로컬 모델은 컨텍스트에 맞춘 구간을 순차 처리하고 실제 휴대폰에서 전체 의미 보존과 저장·독서를 확인한다.

**Architecture:** Android의 브리지 없는 원문 탐색 화면과 신뢰된 React 작품·리더·설정을 분리한다. 원문 추출, 모델 목록, 컨텍스트에 맞춘 전체 회차 번역, 버전별 저장을 좁은 계약으로 연결하고, 현재 설정과 독립된 저장본 조회를 사용한다. 목차 확장·이어 읽기·이전 등 승인된 후속 구현을 진행하며 물리 기기의 의미 보존 검증을 병합 조건으로 유지한다.

**Tech Stack:** 기준 저장소의 React 19.3.0, TypeScript 7.0.2, Vite 8.3.2, Vitest 5.0.3, Capacitor 8.5.2 및 기존 native HTTP·Filesystem·Preferences·Secure Storage. Node >=22.12.0, 검증은 Node 24 / Java 21 / Android SDK 36 / build-tools 35.0.0 기준. 버전 변경은 이 계획의 기본 동작이 아니다.

**Spec:** [승인된 기능 기획 1.0](../specs/2026-10-04-narou-reader-renewal.md).

## Global Constraints

- 앱 내 탐색, 작품 제목과 목차, 원하는 회차 선택, 완료 후 읽기, 이전·다음 화, 이어 읽기를 연결한다.
- 선택한 한 화의 정규화 원문은 문단·문장 경계에 따라 순차 요청하되 전체가 정확히 한 번씩 포함돼야 한다. 구간 수를 표시하고 모든 구간을 저장한 뒤 읽는다. 자동 재전송·출력 보정용 추가 호출은 하지 않는다. 사용자 승인과 #74가 기존 회차당 단일 요청 조건을 변경한다.
- PC·리눅스 서버의 LM Studio·Ollama·llama.cpp OpenAI 호환 API에 휴대폰이 Tailnet 주소나 IP로 직접 연결한다. 사용자가 지정한 리눅스 모델 서버를 검증에 사용하며 앱 전용 중계 서버를 추가하지 않는다.
- 서버의 실제 모델 목록에서 고른다. 앱 사용자가 컨텍스트 길이나 출력 토큰 예산을 계산해 입력하지 않는다.
- HyMT2 계열을 우선 검증한다. 모든 모델에 JSON 출력이나 구조화 출력 지원을 요구하지 않는다.
- 저장된 번역은 현재 연결·모델 설정과 독립적으로 읽을 수 있어야 한다. 로컬 연결 실패 시 Gemini 등 다른 제공자로 자동 전환하지 않는다.
- 동시에 활성화되는 번역 요청은 하나로 제한한다. 스트리밍과 부분 번역 표시도 이번에는 넣지 않는다.
- #75에 따라 범위 지정·전체 회차 일괄 번역을 포함한다. 전체 목차에서 범위와 기존 저장본 수를 확인한 뒤 사용자가 시작하며, 포그라운드에서 회차를 순차 처리한다. 백그라운드·재시작 시 자동 요청과 다음 화 자동 미리 번역은 하지 않는다.
- 기존 로컬 작업 트리의 커밋되지 않은 변경은 건드리지 않는다. 공개 배포 전 원문 이용 조건·접근·저장 권리는 별도로 확인한다.

## Review Focus

1. 짧은 단편과 회차 URL 직행: 첫 화 자동 실행 없이 같은 작품 화면에서 해당 회차를 고를 수 있어야 한다. T2 테스트.
2. 같은 문장 반복·빈 줄·루비·보조 평면 문자: 문단 순서와 ruby UTF-16 범위가 깨지거나 본문이 중복되지 않아야 한다. T2/T3 테스트.
3. 연속 탭·화면 전환·모델 변경 뒤 늦은 응답: 생성은 하나이며 응답이 다른 회차나 설정에 붙지 않아야 한다. T4 테스트.
4. 저장 도중 종료·목록 색인 갱신 실패: 이전 완성본과 위치를 유지하며 저장만 재시도할 수 있어야 한다. T3/T6 테스트.
5. 외부 링크·서브프레임·리다이렉트: 페이지가 앱 브리지·인증값·파일·모델 요청 권한을 얻지 못해야 한다. T2/T4 테스트.

---

## 현재 확인한 상태와 실행 전제

2026-10-04에 GitHub 읽기 전용으로 `acb473b1576a33208b6cbf510bde9c71eb3009b5`의 트리와 주요 파일을 확인했다. `src/source/index.ts`는 목차 파서가 있으나 작품 URL의 첫 회차를 자동 가져온다. `src/app/Application.tsx`는 설정과 리더를 한 화면에 표시한다. `src/providers/openai-compatible/index.ts`는 JSON·문단 ID·예산을 강제한다. 저장은 모델·endpoint 기반 cacheKey에 묶여 있으며 위치는 chapterId 기준이다.

이 문서는 계획이다. 제품 코드를 수정하거나 테스트·APK 빌드·기기 검증을 실행한 결과가 아니다. 현재 dot VM에 프로젝트 clone이나 Android 도구가 준비됐다고 가정하지 않는다. 사용자 PC의 `issue-22-native-translation` 작업 트리에 있는 14개 미커밋 파일은 읽거나 이동하거나 복구하지 않는다. 이 문서 작성으로 그 파일이 백업됐다는 뜻도 아니다.

실행 방식은 dot VM + GitHub Flow + 독립 작업의 worktree 병렬 진행으로 이미 정해졌다. 계획 검토를 기다리며 현재는 commit·branch·issue·PR을 만들지 않는다. 승인 이후 새 clone과 재현 가능한 도구 확인부터 시작한다. 연결된 PC나 별도 실행 환경으로 옮겨야 하면 그 이유와 대상을 먼저 승인받는다.

## 작업 지도와 의존성

- T0 실행 준비와 레거시 기록 → T1 최소 기능 화면과 계약.
- T1 후 T2 탐색·소스와 T3 모델·저장 경로를 독립 worktree에서 병렬 진행할 수 있다. `src/contracts/**`, package/lock, 공통 native 설정은 T1 소유이며 중간 변경은 먼저 합의한 작은 선행 변경으로 반영한다.
- T2 + T3 → T4 실제 어댑터 통합 → G1 실제 휴대폰에서 전체 원문 의미 보존과 완성본 읽기 확인.
- 후속 구현은 사용자의 계속 진행 승인에 따라 T5 이어 읽기 → T6 복구·데이터 이전 → T7 배포 검사와 G2 전체 회귀로 진행한다. G1 실패는 병합·품질 완료 조건으로 계속 남긴다.
- T8 Gemini는 G1 이후의 선택 작업이다. 로컬 경로의 G1/G2 통과를 막지 않는다. UI/compose 소유권을 넘겨받은 뒤 순차 반영한다.

새 파일은 역할별로 둔다. `src/contracts/reading.ts`는 새 독서 계약, `src/source/work.ts`는 작품·목차, `src/providers/catalog.ts`는 모델 목록, `src/translation/wholeChapter.ts`는 전체 회차 상태 전이, `src/storage/library.ts`는 완성본 색인과 버전, `src/app/controller.ts`는 화면 전환을 맡는다. 기존 파일의 재사용 여부는 아래 작업에 명시한다. 별도 legacy 화면이나 구형 번역 토글은 새 앱에 남기지 않는다.

## 공통 인터페이스 결정

T1이 아래 타입을 `src/contracts/reading.ts`에 만든다. 기존 `Ruby`, `Paragraph`, `Chapter`, `HttpResponse`, `SecretStore`의 의미는 유지한다. `Chapter.paragraphs`는 원문 구조다. `src/contracts/index.ts`는 새 계약을 재수출하되 구형 ChunkRequest/Checkpoint 기반 실행 계약은 T4 통합 때 제거한다.

```ts
type ChapterRef = { workId: string; chapterId: string; canonicalUrl: string; title: string; ordinal: number };
type WorkPage = { workId: string; canonicalUrl: string; title: string; chapters: readonly ChapterRef[];
  pageUrl: string; nextPageUrl: string | null; complete: boolean };
type SourceSnapshot = Chapter & ({ captureKind: 'fetched'; fetchedAt: string; rawHtml: string }
  | { captureKind: 'legacy-import'; fetchedAt: null; rawHtml: null });
type ProviderId = 'openai-compatible' | 'gemini';
type ConnectionConfig = { provider: ProviderId; baseUrl: string; authRef?: string; revision: number };
type ModelChoice = { id: string; displayName: string; supportsGeneration: boolean };
type SelectedModel = { connection: ConnectionConfig; modelId: string };
type TranslationToken = { requestId: string; chapterId: string; settingsRevision: number };
type WholeChapterRequest = { token: TranslationToken; source: SourceSnapshot;
  languageDirection: 'ja-ko'; contractVersion: 'plain-v1'; promptVersion: 'hymt2-ko-v1' };
type WholeChapterResult = { text: string; finishReason: 'complete' | 'length' | 'blocked' | 'unknown' };
type TranslationBlock = { id: string; text: string }; // translated IDs, never source paragraph IDs
type CompletedTranslation = { schemaVersion: 2; versionId: string; source: SourceSnapshot;
  text: string; blocks: readonly TranslationBlock[]; createdAt: string;
  provenance: { provider: ProviderId; connectionId: string; modelId: string;
    contractVersion: string; promptVersion: string; languageDirection: 'ja-ko' } };
type ReadingPosition = { workId: string; chapterId: string; versionId: string; blockId: string; offset: number };
type TranslationPhase = 'idle' | 'preparing' | 'translating' | 'validating' | 'saving' | 'ready' | 'failed' | 'unknown';
type TranslationState = { phase: TranslationPhase; token?: TranslationToken; elapsedMs: number;
  error?: ReaderError; pendingSave?: CompletedTranslation };
interface RenewalSource {
  getWorkPage(url: string, signal: AbortSignal): Promise<WorkPage>;
  getChapter(ref: ChapterRef, signal: AbortSignal): Promise<SourceSnapshot>;
}
interface ProviderSession {
  listModels(signal: AbortSignal): Promise<readonly ModelChoice[]>;
  translateChapter(request: WholeChapterRequest, signal: AbortSignal): Promise<WholeChapterResult>;
}
interface LibraryStore {
  saveWorkPage(page: WorkPage): Promise<void>;
  readWork(workId: string): Promise<readonly WorkPage[]>;
  listRecent(): Promise<readonly { workId: string; chapterId: string; versionId: string; updatedAt: string }[]>;
  listVersions(chapterId: string): Promise<readonly CompletedTranslation[]>;
  readVersion(versionId: string): Promise<CompletedTranslation | null>;
  commitVersion(value: CompletedTranslation): Promise<void>;
  savePosition(value: ReadingPosition): Promise<void>;
  readPosition(versionId: string): Promise<ReadingPosition | null>;
}
```

`versionId`는 최초 결과 생성 때 정한 UUID이며 저장 재시도에서 유지한다. `listVersions`는 createdAt 내림차순으로 반환한다. 회차 선택 시 마지막으로 읽은 해당 회차의 versionId를 우선하고, 없으면 가장 최근 완성본을 연다. `WorkPage.complete`는 반환된 범위만으로 전체 목차임이 확인될 때만 true다. 여러 페이지를 모을 때는 첫 페이지부터 마지막까지 nextPageUrl 연결이 모두 저장돼야 전체 완료로 표시한다. `connectionId`는 provider + 정규 endpoint의 SHA-256로서 비밀값·원문 주소를 넣지 않는다. 현재 설정은 번역 이력 조회 키가 아니다. v1에는 원문 HTML·가져온 시각이 없으므로 이전 시 `captureKind:'legacy-import'`와 null로 기록하고 새로 가져온 데이터처럼 만들지 않는다. 새 source adapter는 항상 `captureKind:'fetched'`를 생성한다. `blocks`는 CRLF를 LF로 정규화한 번역 텍스트를 빈 줄을 보존하여 나눈 표시 단위이며 원문 문단과 1:1 대응하지 않는다. `blockId`는 versionId + 순서의 SHA-256이다. `ReaderError.code`에 `model_list`, `model_missing`, `input_limit`, `output_limit`, `blocked`를 추가하되 raw 오류 본문은 노출하지 않는다.

## 사람이 읽기 쉬운 코드와 검토 기준

- 의미가 드러나는 도메인 이름과 명시적 반환 타입을 쓴다. 짧은 이름·삼항 중첩·압축된 한 줄 구현을 피하고, 함수·모듈은 한 가지 책임을 갖게 한다. 복잡한 분기는 guard clause와 작은 이름 붙인 함수로 나눈다.
- 현재 `strict`와 `noUncheckedIndexedAccess`를 유지한다. 네트워크·저장소의 `unknown`은 런타임 검증 후 타입을 좁히고 무분별한 `any`·타입 단언으로 넘기지 않는다.
- 적용할 패턴은 실제 경계에 한정한다. source/provider/native transport는 Adapter, 저장은 Repository, `compose.ts`는 composition root다. 결합된 비동기 흐름에는 명시적 상태 전이 또는 reducer를 쓰고, 불필요한 클래스 계층·DI 컨테이너·범용 이벤트 버스는 넣지 않는다.
- React는 사용자 동작을 이벤트 핸들러에서 처리하고 표시용 값은 기존 상태에서 계산한다. 외부 시스템 동기화에만 Effect를 쓰며 Hooks 규칙과 정리 함수를 지킨다. Java Android 코드를 유지하고 Kotlin/Compose 전환은 하지 않는다.
- T1에서 TS 7·React 19·Vite 8과 호환되는 ESLint/TypeScript ESLint/React Hooks 플러그인 및 Prettier 버전을 공식 지원표와 작은 설치 검증으로 확인한다. 맞는 버전만 lockfile에 고정하고 `lint`, `format:check` 스크립트를 추가한다. 호환되지 않으면 runtime을 임의 업그레이드하거나 타입 검사를 끄지 않고 정확한 차단과 대안을 검토받는다. 포맷만 바꾸는 diff는 기능 변경과 분리한다.
- 매 PR은 `npm run format:check`, `npm run lint`, `npm run typecheck`, 관련/전체 테스트, production build를 통과해야 한다. Vite build는 별도 타입 검사를 대체하지 않는다. Android 변경은 Java/native compile·lint·해당 instrumentation도 추가한다.
- 코드 작성 시 적용할 자료는 TDD, systematic-debugging, React best-practices, verification-before-completion이다. Vite 클라이언트 앱에 맞는 React 규칙만 적용하고 Next.js/RSC 전용 규칙은 적용하지 않는다. 리뷰에는 변경 목적·상태 전이·에러 경로·테스트를 사람이 따라 읽을 수 있는지와 패턴이 실제 복잡성을 줄였는지를 포함한다.

### T0 실행 준비와 레거시 기록

**Files:** Create `docs/renewal/issue-map.md`, `docs/renewal/environment.md`; 기준 README·lockfile·CI를 참조한다. 이 작업은 승인 후 실행한다.

**Interfaces:** 기존 사용자 PC 작업 트리에 의존하지 않는 clean checkout과 기준 SHA, 도구 버전, 새 이슈 번호 매핑을 후속 작업에 제공한다.

- [ ] dot VM에 GitHub의 허용된 경로로 새 clone을 만들고 `git rev-parse HEAD`, `git status --porcelain`, lockfile 해시와 Node/Java/SDK 설치 상태를 기록한다. 없거나 설치 동의가 필요한 도구는 정확한 차단으로 보고한다.
- [ ] `legacy/pre-renewal-acb473b`가 없으면 정확히 기준 SHA를 가리키도록 보존하고, 이미 있으면 SHA를 확인한다. 다른 SHA이면 덮어쓰지 않는다. 새 작업은 `renewal/first-reading-slice`에서 시작한다.
- [ ] 새 리뉴얼 총괄·첫 한 화·이어 읽기·복구와 이전·배포 검증·선택 Gemini 이슈를 생성해 선행 조건과 G1/G2를 적는다. 새 번호는 실제 생성 응답으로 채운다.
- [ ] 새 이슈 링크와 대체 이유를 기존 #10/#8/#20/#22에 남긴 뒤 superseded로 종료한다. #20/#22의 실패 조건은 회귀 테스트와 수동 품질 점검에 연결한다. 해결됐다고 쓰지 않는다. #23은 T7 새 담당 이슈에 Windows 요구와 증빙을 이관한 후 종료한다. #21은 후속으로 유지하고 청크·JSON 전제만 재검토 대상으로 표시한다. 닫힌 #1–#7/#9 기록은 유지한다.
- [ ] clean checkout에서 `npm ci && npm run typecheck && npm test -- --run && npm run build`로 기준 상태를 기록한다. 실패는 원래 실패와 새 변경을 구분한다. 이 단계에서는 실사이트나 모델에 요청하지 않는다.
- [ ] 위 기록과 승인된 기획·계획을 작은 docs PR로 보존한다. 저장소 보안 설정은 변경하지 않는다.

### T1 최소 기능 화면과 새 독서 계약

**Files:** Modify `package.json`, `package-lock.json`; Create `eslint.config.mjs`, `.prettierrc.json`, `src/contracts/reading.ts`, `src/app/routes.ts`, `src/ui/HomeScreen.tsx`, `src/ui/WorkScreen.tsx`, `src/ui/TranslationScreen.tsx`, `tests/ui/renewal-flow.test.tsx`; Modify `src/app/Application.tsx`, `src/app/controller.ts`, `src/ui/ReaderScreen.tsx`, `src/ui/SettingsScreen.tsx`, `src/app/application.css`.

**Interfaces:** Produce `Route = {kind:'home'} | {kind:'work';workId:string;selectedChapterId?:string} | {kind:'translation';chapterId:string} | {kind:'reader';versionId:string} | {kind:'settings'}` and `navigate(route: Route): void`, `back(): void`. Consume LibraryStore for saved entries; source/provider actions are injected test doubles until T4. Production controls awaiting native implementations show unavailable, never fake success.

- [ ] Write `open_work_does_not_translate`, `saved_chapter_opens_without_settings`, `settings_returns_to_selected_chapter`, `reader_has_no_settings_panel`, `no_budget_or_prefetch_controls`: assert generation count 0 on open/select, title visible before translation, saved reading does not require config, distinct screens, no token-budget or prefetch input. Fixture chapter selection is a screen interaction, not a URL-only test.
- [ ] Run `npm test -- --run tests/ui/renewal-flow.test.tsx`; expect missing new routes/controls assertions to fail.
- [ ] Verify and pin the compatible formatting/lint toolchain described above, with separate formatting-only changes. Implement named routes and screen props around the common contracts. Settings has endpoint, optional secret entry, connection check, catalog refresh and model dropdown. Translation page uses “이 화 번역”, stage + elapsed time; no completion percentage. Reader uses default 18px type, adjustable 10–48px, line-height 1.8, readable margins, original/TOC/back/prev/next controls outside body.
- [ ] Run the same test and `npm run typecheck`; expect PASS. Review a narrow phone viewport and keyboard/back navigation with fixtures. Commit `feat: add renewal reading screens and contracts`.

### T2 실제 사이트 탐색과 명시적 회차 선택

**Files:** Create `src/platform/browse.ts`, `src/source/parse.ts`, `src/source/work.ts`, `android/app/src/main/java/app/narou/reader/SourceBrowserActivity.java`, `SourceBrowserPlugin.java` in that same directory, `tests/source/work.test.ts`, `tests/contracts/browse.test.ts`, `android/app/src/androidTest/java/app/narou/reader/SourceBrowserInstrumentedTest.java`; Modify `src/source/index.ts`, `MainActivity.java`, `AndroidManifest.xml` and `src/ui/WorkScreen.tsx`.

**Interfaces:** Produce `openSourceBrowser(startUrl: string): Promise<{selectedUrl:string} | null>` from trusted app UI; Java `SourceBrowserPlugin.open(PluginCall)` launches nonexported SourceBrowserActivity. Produce `createRenewalSource(transport: SourceTransport): RenewalSource`, `normalizeWorkPageUrl(input: string): string`, `normalizeSourceInput(input: string): {workUrl:string;chapterUrl?:string}`. Return only validated URL from the native toolbar and validate again in TypeScript.

- [ ] Write `work_open_fetches_no_chapter`, `chapter_url_preselects_exact_chapter`, `short_story_gets_one_entry`, `first_page_is_not_complete_when_next_exists`, `unicode_ruby_blank_lines_roundtrip` with synthetic old/new site markup. Assert TOC order, stable `workId/chapterId`, no first-chapter side effect, one selected body fetch. Include `龍😀` + ruby readings, repeated lines, U+3000 and blank paragraphs.
- [ ] Run `npm test -- --run tests/source/work.test.ts tests/contracts/browse.test.ts`; expect new adapter/browser contract failures.
- [ ] Reuse inert parsing, limits and source URL security from `src/source/index.ts`; move shared parser helpers to `src/source/parse.ts` with parser tests adjusted. Extract ordinary metadata with no body prefetch. Work URL accepts only an optional positive integer `p` TOC query; episode canonical URL rejects queries as before. First slice exposes loaded range and further-page availability, but loading more is T5. Short stories become one explicit selectable chapter, never auto translated.
- [ ] Implement a separate plain Android WebView Activity with a native toolbar (“이 작품 열기”, back, close). Start at `https://syosetu.com/`; preserve the site's search/ranking/category/link history. Keep page and subresource requests restricted to reviewed public source hosts (`syosetu.com`, `www.syosetu.com`, `yomou.syosetu.com`, `ncode.syosetu.com`, `static.syosetu.com` initially); add a needed CDN only after observing and reviewing its public destination. Block arbitrary network destinations, local/model hosts and non-HTTPS schemes before requests, including navigation, iframe/subresource requests and redirect chains. Do not treat an after-navigation URL check as a pre-request protection; prove zero requests to a controlled forbidden target in the instrumented fixture. If the chosen WebView hooks cannot enforce this, stop the native-browser task and report the failing path before weakening the boundary. An external link offers a trusted user-operated “외부 브라우저에서 열기” action, with no model headers or app privileges. Only validated ncode work/chapter URLs enable import. Do not inject Capacitor, JavaScript interfaces or message ports; do not reuse BridgeActivity's WebView. Allow only the page JavaScript needed for ordinary site browsing, no file/content access, downloads, mixed content or popup native intents. Cancel SSL errors. Never place model headers/secrets in browser requests. Permission prompts remain denied unless explicitly authorized. The source browsing allowlist is independent of extraction's stricter work/chapter paths; navigation never changes model target.
- [ ] Add instrumented adversarial fixture assertions: `Capacitor`/bridge absent, `file:`/`content:`/`javascript:`/`intent:` rejected, forged URL does not enable import, iframe cannot invoke native code and script fetch to the model/LAN host sends no network request, normal search/ranking/link/back remains usable. Run `npm test -- --run tests/source/work.test.ts tests/contracts/browse.test.ts && npm run typecheck`; compile `./gradlew :app:assembleDebugAndroidTest :app:lintDebug` when toolchain exists. Instrumentation execution is recorded separately at G1. Commit `feat: isolate source browsing and select work chapters`.

### T3 실제 모델 선택과 한 화 저장 경로

**Files:** Create `src/providers/catalog.ts`, `src/providers/plainText.ts`, `src/storage/library.ts`, `src/storage/readingValidation.ts`, `tests/providers/catalog.test.ts`, `tests/providers/whole-chapter.test.ts`, `tests/storage/library.test.ts`; Modify `src/providers/openai-compatible/index.ts`, `src/platform/http/index.ts`, `src/contracts/index.ts`, `src/storage/native.ts`, `src/storage/settings.ts`. Reuse existing journal/secrets with tests kept. New `ReadingSettings = {schemaVersion:2; selection:SelectedModel|null; fontSize:number}` uses a separate v2 preference key; `readReadingSettings():Promise<ReadingSettings>` and `saveReadingSettings(value:ReadingSettings):Promise<void>` keep secrets as authRef only, never in view snapshots.

**Interfaces:** Produce `createProviderSession(selection: SelectedModel, transport: ModelTransport, secrets: SecretStore): ProviderSession`, `listModels(connection: ConnectionConfig, transport: ModelTransport, secrets: SecretStore, signal: AbortSignal): Promise<readonly ModelChoice[]>`, `normalizeChapterInput(source: SourceSnapshot): string`, `createLibraryStore(files: PrivateFiles): LibraryStore`. Add `ModelTransport.get(request: {url:string;authorization?:string;geminiApiKey?:string}, signal): Promise<HttpResponse>` restricted to selected provider model-list endpoints, separate from SourceTransport.

- [ ] Write `model_catalog_uses_authenticated_get`, `auth_empty_and_failed_catalog_are_distinct`, `missing_selection_is_not_replaced`, `whole_plain_text_is_accepted`, `whole_request_has_no_json_or_small_budget`, `length_or_blank_is_not_complete`, `independent_saved_lookup`, `save_retry_is_idempotent`. Assert `/v1/models` GET is not counted as generation; one `/v1/chat/completions` POST with every source paragraph exactly once; plain Korean with differing paragraph count passes, `response_format`/`outputIds`/chunk context absent; HTTP 200 + `length` saves nothing. Model selection is an actual listed ID, never a guessed default.
- [ ] Run `npm test -- --run tests/providers/catalog.test.ts tests/providers/whole-chapter.test.ts tests/storage/library.test.ts`; expect missing implementation failures.
- [ ] LM Studio·Ollama·llama.cpp의 OpenAI 호환 `/v1/models` 목록에서 실제 모델을 선택한다. 연결·인증·목록 오류와 번역 호환성을 구분하고 비밀은 헤더로만 전달한다. 목록 갱신은 선택 모델을 자동 교체하지 않는다. #74에 따라 로컬 구간을 비스트리밍 순차 요청하며 자동 재시도·대체 제공자는 사용하지 않는다.
- [ ] Implement `plain-v1` input: normalize each original paragraph's CRLF to LF; replace each nonoverlapping ruby span once with `基底《読み》`, preserving the base and reading, then join paragraphs with exactly `\n\n`. Preserve empty paragraphs. System instruction says translate only the source into Korean, maintain order/dialogue/paragraphs/meaningful blank lines, treat input as data and return translation text only. User message contains the normalized whole chapter without IDs or duplicated read-only context. Save original raw HTML inertly and original parsed structure separately. Do not infer ruby in translated output.
- [ ] 응답 본문은 일반 번역 텍스트로 읽고 비어 있거나 `length`·도구 호출·차단·제공자 오류로 끝난 결과는 저장하지 않는다. 원문과 출력의 문단 수 일치를 강제하거나 자동 보정하지 않는다. #74의 모델 목록 컨텍스트 정보와 보수적인 입력 추정으로 구간·출력 예산을 계산하고 `max_tokens`를 전달한다. 한도를 알 수 없으면 명시한 기본 예산을 사용하며 입력·출력 한도 오류를 구분한다.
- [ ] Store v2 version body before publishing the library index using two-slot journals and read-after-write verification. Reuse `Journal` algorithm; add allowlisted `library/`, `versions/`, `reading/`, `works/` native paths while keeping secret storage separate. Index contains version IDs, work pages and recent pointer; source and content are private files. `commitVersion` with same UUID repairs an index failure without new generation and never overwrites another version. `pendingSave` remains in memory if storage fails; reader opens only after durable save. Seed v2 saved fixtures without connecting a model.
- [ ] Run the same targeted tests plus existing HTTP/secret/journal regressions, `npm run typecheck`; expect PASS. Commit `feat: translate and save complete chapters as plain text`.

### T4 통합하고 첫 기기 검증에서 멈추기

**Files:** Create `src/translation/wholeChapter.ts`, `src/translation/singleFlight.ts`, `src/translation/attempts.ts`, `tests/integration/renewal-first-slice.test.tsx`, `docs/renewal/first-device-check.md`; Modify `src/app/compose.ts`, `src/app/controller.ts`, `src/app/bootstrap.tsx`, `src/platform/lifecycle.ts`, `src/storage/native.ts`; remove `src/jobs/chunking.ts`, `engine.ts`, `prefetch.ts`, `scheduler.ts` after their retained safety behavior has moved into the new tests.

**Interfaces:** Produce `createWholeChapterFlow({source,createProvider,store,attempts,clock}): {start(ref:ChapterRef,selection:SelectedModel):Promise<void>;cancel():void;retrySave():Promise<void>;subscribe(fn:(s:TranslationState)=>void):()=>void}`. `AttemptRepository.write({token,phase:'dispatching'|'unknown'|'complete'}):Promise<void>` and `readUnfinished():Promise<readonly TranslationToken[]>` journal metadata under `attempts/`. `clock.now():number` is injected for duration tests. Controller owns config revision; flow snapshots target/config per request.

- [ ] Write `browse_select_translate_save_read`, `open_and_double_tap_generate_once`, `late_response_never_retargets`, `cancel_keeps_native_slot`, `startup_never_reposts`, `save_retry_calls_no_model`, `source_and_catalog_not_generation`. Assert actual adapter composition with synthetic transport, one POST, no content before save, no queue from duplicate taps, and no model call from route/config change. Leave single-flight occupied until native promise settles even after UI cancellation. Settings revision mismatch cannot update visible/current result.
- [ ] Run `npm test -- --run tests/integration/renewal-first-slice.test.tsx`; expect fail before replacing composition.
- [ ] Wire T1–T3 without legacy runtime imports. Persist dispatching marker before POST; interrupted markers become unknown on startup with explicit retry and remote-execution warning. App backgrounding stops new dispatch; no timer or startup path retries. A late or canceled result never becomes the selected chapter; completed older saved versions remain. Retry save uses captured result/token, not current settings. Allow browse, TOC and saved reading with missing settings; ask for connection only on new translation. Preserve useful existing safe transport tests; replace obsolete chunk/prefetch tests with absence-of-generation assertions rather than weakening them.
- [ ] Run full `npm run typecheck && npm test -- --run && npm run build`; commit `feat: connect the first full chapter reading flow`. From clean committed source run `npm run android:sync`, `./gradlew --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest` in android, then `node tests/e2e/verify-apk.mjs`. Extend APK audit to require the local browse plugin/activity without removing CSP, signature, byte equality or provenance checks.
- [ ] **G1 실기 검증:** 정확한 소스·APK 해시·기기를 기록한다. 실제 인앱 탐색으로 작품을 찾고 비첫회차를 선택하여 실제 목록의 Hy-MT2 7B로 전체 원문을 순차 번역·저장·읽는다. 2026-10-07 사용자가 지정한 리눅스 서버를 사용하며, 로컬 구간 수와 실제 토큰·서버 한도를 확인한다. URL·합성 데이터만으로 탐색 통과를 대신하지 않는다. 저장본의 실제 오프라인 재열기와 원문 브라우저 경계도 확인한다.
- [ ] 원문 준비·모델 대기·검증과 저장·리더 표시 시간 및 모델·서버 설정을 구분해 기록한다. 공개 기록에는 원문·원시 응답·비밀·사설 엔드포인트를 올리지 않는다. 누락·순서·숫자·대사·루비 의미를 처음부터 끝까지 대조하고, HTTP 200/stop이나 문단 수만으로 품질 통과를 선언하지 않는다. 후속 구현은 계속 진행 승인 범위에서 수행하되 G1 실패를 해결이나 병합 가능으로 보고하지 않는다. 실패가 발생하면 해당 원인과 영향 경로를 수정하고 필요한 검증만 반복한다.

### T5 목차 확장과 이어 읽기

**Files:** Modify `src/source/work.ts`, `src/app/controller.ts`, `src/ui/HomeScreen.tsx`, `WorkScreen.tsx`, `ReaderScreen.tsx`, `src/storage/library.ts`; Create `src/reading/position.ts`, `tests/integration/continue-reading.test.tsx`, `tests/source/pagination.test.ts`.

**Interfaces:** Use `RenewalSource.getWorkPage`, `LibraryStore.saveWorkPage/readWork/savePosition/readPosition`. Produce `resolveNeighbor(chapters:readonly ChapterRef[],currentId:string,direction:'prev'|'next'):ChapterRef|null`; unknown unloaded neighbors are distinguished by WorkPage completeness in controller. `capturePosition(version:CompletedTranslation,visibleBlockId:string,offset:number):ReadingPosition` uses translated block IDs.

- [ ] Write `second_page_chapter_keeps_identity`, `refresh_preserves_versions_and_positions`, `saved_next_opens_without_post`, `unsaved_next_waits_for_button`, `return_and_restart_restore_each_version`, `end_and_deleted_chapter_are_explicit`. Assert stable IDs despite inserted/reordered rows, one user-requested TOC page fetch and no body prefetch, positions for two chapters/two translation versions remain distinct, missing next does not start generation.
- [ ] Run `npm test -- --run tests/source/pagination.test.ts tests/integration/continue-reading.test.tsx`; expect new pagination/position assertions to fail.
- [ ] Add explicit next-TOC-page and refresh controls; validate page query and dedupe stable chapter IDs without marking unloaded pages complete. Add previous/next and per-version positions, update on scroll with bounded debounce and flush on navigation/lifecycle pause, restore after layout. Clamp invalid offsets and fall back to the first block only when no valid position exists. Home shows recent works and resume; empty library starts exploration. Source view is whole chapter text with ruby information, never executable HTML or assumed aligned bilingual paragraphs.
- [ ] Run targeted suites and full typecheck/tests/build; verify two chapters, restart, offline and model-switch reading in native build before commit `feat: continue reading across chapters and versions`.

### T6 실패 복구와 기존 데이터 보존

**Files:** Create `src/storage/migrateV1.ts`, `src/storage/legacyV1.ts`, `tests/storage/migrate-v1.test.ts`, `tests/integration/renewal-failures.test.ts`; Modify `src/storage/native.ts`, `src/storage/library.ts`, `src/translation/wholeChapter.ts`, `src/app/controller.ts`, `src/ui/TranslationScreen.tsx`, `src/ui/WorkScreen.tsx`.

**Interfaces:** Add `PrivateFiles.list(prefix:string):Promise<readonly string[]>` for app-private allowlisted directories. Produce `migrateV1(files:PrivateFiles,preferences:PreferenceBackend,target:LibraryStore):Promise<{imported:number;pending:number;failed:number}>`. Legacy decoder is data-only, not a retained old execution path. Produce `refreshSource(ref:ChapterRef,signal:AbortSignal):Promise<{source:SourceSnapshot;changed:boolean}>` using stored hash comparison; a new version requires explicit retranslation.

- [ ] Write `migration_keeps_all_completed_models`, `migration_is_restart_safe`, `incomplete_v1_is_not_resumed`, `unknown_schema_is_untouched`, `source_change_does_not_overwrite`, `disk_full_keeps_old_version`, `lost_response_requires_explicit_retry`, `input_length_blocked_auth_parse_are_distinct`. Include v1 journals with valid older slot, bad newest slot, matching paragraph position, multiple cache keys, old last pointer and unsupported schema.
- [ ] Run `npm test -- --run tests/storage/migrate-v1.test.ts tests/integration/renewal-failures.test.ts`; expect migration/failure assertions to fail.
- [ ] Enumerate v1 chapter journals using app-private listing, validate old checksum/schema, convert completed entries to deterministic `legacy-<cacheKey>` version IDs and preserve paragraph text/source/provenance/position. Missing raw HTML and fetchedAt are recorded as legacy-import nulls, not fabricated. Convert old translated paragraph IDs to version-scoped block IDs with an explicit old-to-new position map. Index only after verified v2 write. Keep all v1 files unchanged and a resumable migration ledger. Old incomplete checkpoints are reported as unfinished, never generated or exposed as complete. Unsupported/corrupt entries stay untouched with a per-item warning. Settings migration drops old budgets/prefetch, preserves endpoint/authRef, and requires actual catalog selection before new work.
- [ ] Finish UI errors/actions: source failure → original/TOC/manual retry; auth/model failure → settings while saved reading stays open; capacity/length → cause and server/model advice; unknown after send → possible completion/duplicate cost warning then explicit retry; storage → save-only retry. Explicit source refresh retains old versions and offers new translation; failed new result does not change active saved version or position. Count zero hidden POSTs for every failure path.
- [ ] Run full typecheck/tests/build and a fault-injected native persistence check; commit `feat: preserve reading data through failures and migration`.

### T7 Windows 검사와 전체 실제 사용 검증

**Files:** Modify `tests/e2e/verify-apk.mjs`, `tests/e2e/apk-audit.test.mjs`, `.github/workflows/android-check.yml`, `docs/android-validation.md`, `README.md`; Create `docs/renewal/acceptance-results.md`.

**Interfaces:** Retain `auditAssets`/`auditProvenance`; export `toZipEntry(relative:string):string` and `signerCommand(platform:string,buildTools:string):{file:string;args:readonly string[]}`. Windows uses the same SDK's `lib/apksigner.jar` with Java; Linux uses `apksigner`.

- [ ] Write Windows separator and signer-resolution tests plus tampered byte/provenance/CSP/signature regressions. Run `npm test -- --run tests/e2e/apk-audit.test.mjs`; expect only new Windows cases to fail before implementation.
- [ ] Implement slash normalization for ZIP membership while keeping all asset-byte comparisons. Keep SDK/version/provenance/security checks. Record #23's original failure and actual Windows proof separately from Android execution. Add a Windows CI job if the authorized runner can build/audit using documented dependencies; do not silently move development to the user's PC. If unavailable, Windows remains NOT RUN and is an explicit release blocker for that claim.
- [ ] Run full web tests, Android build/audit and the native instrumentation. **G2:** real phone checks actual paginated source discovery, chapter URL entry, previous/next, restart, offline, model switch, old-data migration, source change, interrupted request, auth/length/storage errors, logs and bridge isolation. Verify one complete chapter through both LM Studio and Ollama paths using real listed models; HyMT2 7B remains priority. Count generation requests independently of GETs and catalog calls.
- [ ] Record build commit/APK hash/device/server/model and results, then compare representative successful timing before proposing optimizations. Source terms/access and intended storage/use must be reviewed before public distribution; neither parser MIT notices nor this plan establishes novel rights. No store publishing, signing-key generation, redistributable translations or security-settings changes are implied. Commit `test: verify renewal on Android and Windows tooling` after evidence review; unresolved rows remain visibly open.

### T8 선택 Gemini 경로

**Files:** Modify `src/providers/gemini/index.ts`, `src/providers/catalog.ts`, `src/app/compose.ts`, `src/ui/SettingsScreen.tsx`, `docs/gemini-provider.md`; Create `tests/providers/gemini/whole-chapter.test.ts`, `tests/integration/renewal-gemini.test.tsx`.

**Interfaces:** Implement the same ProviderSession and whole-chapter plain-text result contract; `listModels` filters actual Gemini models by generation support. Use fixed Google API destinations and header-only secret handling already isolated by ModelTransport.

- [ ] Write `explicit_google_selection_required`, `catalog_filters_generation_models`, `single_request_and_no_local_fallback`, `provider_switch_keeps_saved_versions`, `blocked_and_unknown_not_saved`. Run targeted suites; expect missing new contract failures.
- [ ] Before live calls, verify current official API model-list/generation contract. Show Google receives the chapter and charges may apply before user selects that provider; no auto-selection from local failure. Keep ordinary text output without mandatory JSON; required limits follow verified model metadata. Implement then rerun targeted and full suites.
- [ ] Commit `feat: retain optional Gemini whole chapter translation`. Live paid testing occurs only with approved provider/data/cost scope; if not authorized record NOT RUN without blocking the local-first result.

## 기획 요구사항 연결

| 기획 | 구현 및 검증 |
| --- | --- |
| 1 기능 우선 리뉴얼과 로컬 직접 연결 | T1–T4, G1; Android 기존 스택, PC 동반 서버 없음 |
| 2 앱 내 사이트 탐색과 URL 보조 진입 | T1/T2/T4; G1 실제 사이트 발견, T5 다페이지와 이동 |
| 3 실제 모델 목록과 예산 없는 설정 | T3 catalog/provider, T4 설정 복귀, T8 선택 Gemini |
| 3 한 번의 시작 동작과 HyMT2 일반 텍스트 | T3 input/provider, #74 컨텍스트 구간, T4 single-flight와 요청 횟수, G1 실제 품질 |
| 4 완료 판정과 원문 번역 분리 | T3 저장 계약, T4 저장 후 표시, T6 실패와 버전 |
| 4 최근 작품과 이어 읽기 및 모델 독립 저장 | T3 library, T5 위치/재실행/오프라인, T6 이전 |
| 5 브리지 격리와 사용자 오류 및 권리 | T2 native browser, T3 transport, T4/G1 안전 경계, T6/T7 |
| 6 실제 사용 검증과 측정 | G1 조기 휴대폰 중단, T5–T7 G2, 합성/APK/실기기 증빙 구분 |
| 7 레거시와 이슈 이전 및 후속 범위 | T0 보존·이슈, T4 구형 실행 제거, T6 저장 이전, T7 #23, T8 선택 |

## 계획 자체 검토

기획 1–7장의 요구를 위 표와 대조했고 공통 타입·호출명·테스트 소유권을 확인했다. 검토 위험 다섯 항목에 해당 테스트를 추가했다. 각 코드 작업은 실패 테스트 → 실패 확인 → 최소 구현 → 통과 확인 → 작은 커밋으로 진행하며, 문서·실기기 체크포인트에는 가짜 red/green 결과를 만들지 않는다. 이 문서에 적힌 PASS는 미래 검증의 기대 조건이고 현재 실행 결과가 아니다.

사용자 승인에 따라 #74 구간 번역과 #75 범위·전체 회차 일괄 번역을 진행한다. 기존 T0–T8 항목은 리뉴얼의 작업 구분이며 현재 진행 상태는 GitHub 이슈·PR과 실기기 증거로 확인한다. 시각 디자인, 용어집·말투 #21, 웹페이지 전체 번역, EPUB, 소셜, 동기화, 앱 전용 PC 서버, 다음 화 자동 미리 번역은 #75의 완료 조건에서 제외한다.

## 확인한 근거

- 기준 트리와 코드: https://github.com/earlydreamer/narou-reader/tree/acb473b
- 기존 구조: https://github.com/earlydreamer/narou-reader/blob/acb473b/docs/architecture.md
- 출력 회귀: https://github.com/earlydreamer/narou-reader/issues/20 와 https://github.com/earlydreamer/narou-reader/issues/22
- Windows 증빙 요구: https://github.com/earlydreamer/narou-reader/issues/23
- Android WebView 브리지 위험: https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges
- 로컬 모델 목록: https://lmstudio.ai/docs/developer/openai-compat/models
- Ollama OpenAI 호환 API: https://docs.ollama.com/api/openai-compatibility
