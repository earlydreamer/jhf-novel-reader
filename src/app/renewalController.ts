import type { AppLifecycle } from '../contracts';
import type {
  ParagraphRepair,
  PhaseDurations,
  WholeChapterFlow,
} from '../translation/wholeChapter';
import {
  LINE_HEIGHTS,
  READING_BACKGROUNDS,
  THEME_PREFERENCES,
  type LineHeight,
  type ReadingBackground,
  type ReadingSettings,
  type ThemePreference,
} from '../storage/settings';
import type { LegacyMigrationSummary, LegacyMigrationWarning } from '../storage/migration';
import { ReaderError } from '../contracts';
import type {
  ChapterRef,
  CompletedTranslation,
  ConnectionConfig,
  LibraryStore,
  LocalTranslationLimits,
  ModelChoice,
  ProviderSession,
  ReadingPosition,
  RenewalSource,
  SelectedModel,
  TranslationState,
  WorkPage,
} from '../contracts/reading';
import type { Route } from './routes';
import { limitsForModel } from '../translation/segments';
import type {
  BatchState,
  BatchTranslation,
  ChapterRange,
  CandidateChoice,
} from '../translation/batch';
import type { GuidanceDraft, GuidanceRepository, WorkGuidance } from '../translation/guidance';
import {
  displayedTitle,
  workTitleInputs,
  type SavedTitle,
  type TitleInput,
  type TitleRepository,
  type TitleTranslation,
} from '../translation/titles';

export type CatalogStatus =
  | 'idle'
  | 'checking'
  | 'connected'
  | 'auth'
  | 'storage'
  | 'connection'
  | 'model_list'
  | 'empty'
  | 'model_missing'
  | 'unavailable';
export type SourceChangeStatus = 'idle' | 'checking' | 'unchanged' | 'changed' | 'unavailable';
export interface RenewalDependencies {
  readonly titles?: TitleRepository;
  readonly translateTitles?: TitleTranslation;
  readonly defaultTranslationMode?: 'stream' | 'legacy';
  readonly streamingAvailable?: boolean;
  readonly library?: LibraryStore;
  readonly migrateLegacy?: () => Promise<LegacyMigrationSummary>;
  readonly clock?: { now(): number };
  readonly flow?: WholeChapterFlow;
  readonly batch?: BatchTranslation;
  readonly guidance?: GuidanceRepository;
  readonly lifecycle?: AppLifecycle;
  readonly browse?: () => Promise<{ selectedUrl: string } | null>;
  readonly normalizeInput?: (url: string) => string;
  readonly catalog?: (
    config: ConnectionConfig,
    secret: string,
    signal: AbortSignal,
  ) => Promise<{ connection: ConnectionConfig; models: readonly ModelChoice[] }>;
  readonly settings?: {
    readReadingSettings(): Promise<ReadingSettings>;
    saveReadingSettings(value: ReadingSettings): Promise<void>;
  };
  readonly source?: RenewalSource;
  readonly connect?: (
    config: ConnectionConfig,
    secret: string,
    signal: AbortSignal,
  ) => Promise<ProviderSession>;
  /** T4 owns the real whole-chapter lifecycle. T1 never fabricates completion. */
  readonly startTranslation?: (
    chapter: ChapterRef,
    model: SelectedModel,
    session: ProviderSession,
  ) => Promise<void>;
}
export interface RenewalSnapshot {
  readonly titles: readonly SavedTitle[];
  readonly titlesBusy: boolean;
  readonly titlesError: string | null;
  readonly titlesAvailable: boolean;
  readonly recentTitles: Readonly<Record<string, string>>;
  readonly autoTranslate: boolean;
  readonly autoRetryFailed: boolean;
  readonly paragraphRepair: boolean;
  readonly translationMode: 'stream' | 'legacy';
  readonly streamingAvailable: boolean;
  readonly legacyWarnings: readonly LegacyMigrationWarning[];
  readonly route: Route;
  readonly work: WorkPage | null;
  readonly savedChapterIds: readonly string[];
  readonly chapter: ChapterRef | null;
  readonly translation: TranslationState;
  readonly translationTimings: (PhaseDurations & { readerDisplayMs: number }) | null;
  readonly version: CompletedTranslation | null;
  readonly position: ReadingPosition | null;
  readonly sourceChange: SourceChangeStatus;
  readonly recent: readonly {
    workId: string;
    chapterId: string;
    versionId: string;
    updatedAt: string;
  }[];
  readonly connection: ConnectionConfig;
  readonly models: readonly ModelChoice[];
  readonly selectedModelId: string | null;
  readonly localLimits?: LocalTranslationLimits;
  readonly catalogStatus: CatalogStatus;
  readonly fontSize: number;
  readonly theme: ThemePreference;
  readonly readingBackground: ReadingBackground;
  readonly lineHeight: LineHeight;
  readonly showOriginal: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly sourceAvailable: boolean;
  readonly connectionAvailable: boolean;
  readonly translationAvailable: boolean;
  readonly translationActive: boolean;
  readonly pendingSaveChapter: ChapterRef | null;
  readonly batch: BatchState | null;
  readonly batchAvailable: boolean;
  readonly guidanceAvailable: boolean;
}
const DEFAULT_CONNECTION: ConnectionConfig = {
  provider: 'openai-compatible',
  baseUrl: '',
  revision: 0,
};
function safeEndpoint(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ReaderError('connection');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ReaderError('connection');
  return url.href.replace(/\/$/, '');
}
function errorLabel(error: unknown): CatalogStatus {
  if (error instanceof ReaderError && error.code === 'auth') return 'auth';
  if (error instanceof ReaderError && error.code === 'storage') return 'storage';
  if (
    error instanceof ReaderError &&
    (error.code === 'connection' || error.code === 'timeout_unknown')
  )
    return 'connection';
  return 'model_list';
}
export interface RenewalController {
  translateTitles(key?: string): Promise<void>;
  saveTitle(key: string, target: string): Promise<void>;
  changeAutoTranslate(enabled: boolean): void;
  changeAutoRetryFailed(enabled: boolean): void;
  retryParagraphs(indexes?: readonly number[]): Promise<void>;
  previewPosition(index: number, offset: number): void;
  changeTranslationMode(mode: 'stream' | 'legacy'): void;
  getSnapshot(): RenewalSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  navigate(route: Route): void;
  back(): void;
  browse(): Promise<void>;
  cancelTranslation(): void;
  retrySave(): Promise<void>;
  openPendingSave(): void;
  openSavedTranslation(): Promise<void>;
  readerDisplayed(versionId: string): void;
  retryTranslation(): Promise<void>;
  openWork(url: string): Promise<void>;
  loadMoreWorkPage(): Promise<void>;
  selectChapter(chapter: ChapterRef): Promise<void>;
  continueReading(versionId: string): Promise<void>;
  changeConnection(input: Omit<ConnectionConfig, 'revision' | 'authRef'>): void;
  checkConnection(secret?: string): Promise<void>;
  chooseModel(modelId: string): void;
  prepareBatch(range: ChapterRange | null, retranslate: boolean): Promise<void>;
  runBatch(retryUncertain?: boolean): Promise<void>;
  scanBatch(): Promise<void>;
  confirmBatchCandidates(choices: readonly CandidateChoice[]): Promise<void>;
  cancelBatch(): void;
  retryBatchSave(): Promise<void>;
  openBatch(): void;
  readGuidance(workId: string): Promise<WorkGuidance | null>;
  saveGuidance(workId: string, draft: GuidanceDraft): Promise<WorkGuidance>;
  translate(): Promise<void>;
  refreshSource(): Promise<void>;
  showContents(): void;
  adjacentChapter(direction: -1 | 1): void;
  changeFontSize(fontSize: number): void;
  changeTheme(theme: ThemePreference): void;
  changeReadingBackground(value: ReadingBackground): void;
  changeLineHeight(value: LineHeight): void;
  savePosition(blockId: string, offset: number): Promise<void>;
  showOriginal(show: boolean): void;
  dispose(): void;
}
interface ActiveTranslation {
  cancelled?: boolean;
  readonly chapterId: string;
  readonly settingsRevision: number;
  readonly selectionOperation: number;
}
export function createRenewalController(dependencies: RenewalDependencies = {}): RenewalController {
  let snapshot: RenewalSnapshot = {
    titles: [],
    titlesBusy: false,
    titlesError: null,
    titlesAvailable: Boolean(dependencies.titles),
    recentTitles: {},
    autoTranslate: true,
    autoRetryFailed: true,
    paragraphRepair: false,
    translationMode: dependencies.defaultTranslationMode ?? 'legacy',
    streamingAvailable: Boolean(dependencies.streamingAvailable),
    route: { kind: 'home' },
    legacyWarnings: [],
    work: null,
    savedChapterIds: [],
    chapter: null,
    version: null,
    position: null,
    sourceChange: 'idle',
    translation: { phase: 'idle', elapsedMs: 0 },
    translationTimings: null,
    recent: [],
    connection: DEFAULT_CONNECTION,
    models: [],
    selectedModelId: null,
    catalogStatus: dependencies.connect || dependencies.catalog ? 'idle' : 'unavailable',
    fontSize: 18,
    theme: 'system',
    readingBackground: 'theme',
    lineHeight: 1.8,
    showOriginal: false,
    error: null,
    busy: false,
    sourceAvailable: Boolean(dependencies.source),
    connectionAvailable: Boolean(dependencies.connect || dependencies.catalog),
    translationAvailable: Boolean(dependencies.startTranslation || dependencies.flow),
    translationActive: false,
    pendingSaveChapter: null,
    batch: null,
    batchAvailable: Boolean(dependencies.batch),
    guidanceAvailable: Boolean(dependencies.guidance),
  };
  const listeners = new Set<() => void>();
  const history: Route[] = [];
  const worksById = new Map<string, WorkPage>();
  const pagesByWorkId = new Map<string, Map<string, WorkPage>>();
  const chaptersById = new Map<string, ChapterRef>();
  const savedChaptersByWork = new Map<string, readonly string[]>();
  const versionsById = new Map<string, CompletedTranslation>();
  const positionsByVersion = new Map<string, ReadingPosition | null>();
  let disposed = false;
  let initialized = !dependencies.lifecycle,
    foreground = !dependencies.lifecycle;
  let initialization: Promise<void> | null = null,
    lifecycleEvents = 0;
  let unsubscribeLifecycle: (() => Promise<void>) | null = null;
  let settingsQueue: Promise<void> = Promise.resolve();
  let settingsOperation = 0;
  const clock = dependencies.clock ?? { now: () => performance.now() };
  let readerReadyAt = 0,
    measuredVersionId: string | null = null;
  function persistSettings() {
    if (!dependencies.settings || !initialized || disposed) return;
    const operation = ++settingsOperation;
    const value: ReadingSettings = {
      schemaVersion: 2,
      fontSize: snapshot.fontSize,
      ...(snapshot.theme !== 'system' ? { theme: snapshot.theme } : {}),
      ...(snapshot.readingBackground !== 'theme'
        ? { readingBackground: snapshot.readingBackground }
        : {}),
      ...(snapshot.lineHeight !== 1.8 ? { lineHeight: snapshot.lineHeight } : {}),
      ...(snapshot.autoTranslate ? {} : { autoTranslate: false }),
      ...(snapshot.autoRetryFailed ? {} : { autoRetryFailed: false }),
      selection: snapshot.selectedModelId
        ? {
            connection: { ...snapshot.connection },
            modelId: snapshot.selectedModelId,
            translationMode: snapshot.translationMode,
            ...(snapshot.localLimits ? { limits: { ...snapshot.localLimits } } : {}),
          }
        : null,
    };
    settingsQueue = settingsQueue
      .then(() => dependencies.settings!.saveReadingSettings(value))
      .catch(() => {
        if (operation === settingsOperation)
          publish({ error: '연결 설정을 저장하지 못했습니다. 다시 확인하세요.' });
      });
  }
  let sourceOperation = 0;
  let selectionOperation = 0;
  let catalogOperation = 0;
  let session: ProviderSession | null = null;
  let activeTranslation: ActiveTranslation | null = null;
  let livePosition: { chapterId: string; index: number; offset: number } | null = null;
  let catalogAbort: AbortController | null = null;
  let sourceAbort: AbortController | null = null;
  let automaticRequest: { chapterId: string; operation: number } | null = null;
  let retryableRepair: ParagraphRepair | null = null;
  const titlesByWork = new Map<string, readonly SavedTitle[]>();
  const titleAttempts = new Set<string>();
  let titleAbort: AbortController | null = null;
  let titleJob: Promise<void> | null = null;
  let titleSaveJob: Promise<void> | null = null;
  function titleInputs(): TitleInput[] {
    const work = snapshot.work;
    if (!work) return [];
    const inputs = workTitleInputs(work);
    if (snapshot.route.kind !== 'work') {
      const source = snapshot.version?.source;
      if (source?.workId === work.workId && source.chapterId === snapshot.chapter?.chapterId)
        return inputs.map((input) =>
          input.key === source.chapterId ? { ...input, source: source.title } : input,
        );
    }
    return inputs;
  }
  async function loadTitles(workId: string) {
    if (!dependencies.titles) return;
    try {
      const entries = await dependencies.titles.read(workId);
      const attempts = await dependencies.titles.readAttempts(workId);
      attempts.forEach((input) =>
        titleAttempts.add(JSON.stringify([workId, input.key, input.source])),
      );
      titlesByWork.set(workId, entries);
      if (snapshot.work?.workId === workId) {
        const current = workTitleInputs(snapshot.work);
        const unresolved = attempts.some(
          (input) =>
            current.some((title) => title.key === input.key && title.source === input.source) &&
            !entries.some((entry) => entry.key === input.key && entry.source === input.source),
        );
        publish({
          titles: entries,
          titlesError: unresolved
            ? '이전에 완료되지 않은 제목 번역이 있습니다. 해당 제목은 자동 재요청하지 않습니다. 제목 옆에서 다시 번역할 수 있습니다.'
            : null,
        });
      }
    } catch {
      titlesByWork.delete(workId);
      if (snapshot.work?.workId === workId)
        publish({
          titles: [],
          titlesError: '제목 저장본을 읽지 못했습니다. 자동 제목 번역을 중단했습니다.',
        });
    }
  }
  function requestTitleTranslation() {
    if (
      snapshot.autoTranslate &&
      snapshot.work &&
      titlesByWork.has(snapshot.work.workId) &&
      ['work', 'reader', 'translation'].includes(snapshot.route.kind)
    )
      void translateTitles(undefined, true);
  }
  async function stopTitles() {
    titleAbort?.abort();
    await titleJob;
    await titleSaveJob;
  }
  async function translateTitles(
    key?: string,
    automatic = false,
    currentOnly = false,
  ): Promise<void> {
    if (
      !dependencies.titles ||
      !dependencies.translateTitles ||
      !snapshot.work ||
      titleJob ||
      titleSaveJob ||
      disposed ||
      !initialized ||
      !foreground ||
      snapshot.busy ||
      activeTranslation ||
      dependencies.flow?.active ||
      dependencies.batch?.active ||
      snapshot.pendingSaveChapter ||
      (automatic && (!snapshot.autoTranslate || !titlesByWork.has(snapshot.work.workId)))
    )
      return;
    const workId = snapshot.work.workId;
    const inputs = titleInputs()
      .filter(
        (input) =>
          !currentOnly || input.key === workId || input.key === snapshot.chapter?.chapterId,
      )
      .filter((input) =>
        key
          ? input.key === key
          : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(input.source) &&
            !snapshot.titles.some(
              (entry) => entry.key === input.key && entry.source === input.source,
            ) &&
            (!automatic || !titleAttempts.has(JSON.stringify([workId, input.key, input.source]))),
      );
    if (!inputs.length) return;
    const control = new AbortController();
    titleAbort = control;
    publish({ titlesBusy: true, titlesError: null });
    const job = (async () => {
      try {
        if (snapshot.catalogStatus === 'idle' && snapshot.selectedModelId) await checkConnection();
        if (control.signal.aborted || disposed) return;
        if (snapshot.catalogStatus !== 'connected' || !snapshot.selectedModelId) {
          if (!automatic)
            publish({ titlesError: '설정에서 서버를 연결하고 번역 모델을 선택하세요.' });
          return;
        }
        const selected: SelectedModel = {
          connection: { ...snapshot.connection },
          modelId: snapshot.selectedModelId,
          ...(snapshot.localLimits ? { limits: { ...snapshot.localLimits } } : {}),
          ...(snapshot.autoRetryFailed ? {} : { autoRetryFailed: false }),
        };
        for (let cursor = 0; cursor < inputs.length; cursor += 8) {
          if (control.signal.aborted || disposed || !foreground) return;
          const batch = inputs.slice(cursor, cursor + 8);
          await dependencies.titles!.recordAttempt(workId, batch);
          if (control.signal.aborted || disposed) return;
          batch.forEach((input) =>
            titleAttempts.add(JSON.stringify([workId, input.key, input.source])),
          );
          const results = await dependencies.translateTitles!(
            selected,
            workId,
            batch,
            control.signal,
          );
          if (
            control.signal.aborted ||
            disposed ||
            selected.connection.revision !== snapshot.connection.revision
          )
            return;
          if (results.length !== batch.length) throw new ReaderError('invalid_output');
          const entries: SavedTitle[] = batch.flatMap((input, index) =>
            results[index]
              ? [
                  {
                    ...input,
                    target: results[index]!,
                    origin: 'model',
                    modelId: selected.modelId,
                    updatedAt: new Date().toISOString(),
                  },
                ]
              : [],
          );
          if (entries.length) {
            const saved = await dependencies.titles!.save(workId, entries);
            titlesByWork.set(workId, saved);
            if (snapshot.work?.workId === workId) publish({ titles: saved });
          }
          if (results.some((result) => !result))
            publish({
              titlesError:
                '일부 제목을 번역하지 못했습니다. 기존 제목을 유지했습니다. 제목 옆에서 다시 번역할 수 있습니다.',
            });
        }
      } catch (error) {
        if (!control.signal.aborted && !disposed && snapshot.work?.workId === workId)
          publish({
            titlesError:
              error instanceof ReaderError && error.code === 'timeout_unknown'
                ? '제목 요청 결과를 확인하지 못했습니다. 자동으로 재전송하지 않습니다. 제목 옆에서 다시 번역할 수 있습니다.'
                : '제목 번역 또는 저장에 실패했습니다. 기존 제목을 유지했습니다. 제목 옆에서 다시 번역할 수 있습니다.',
          });
      }
    })();
    titleJob = job;
    try {
      await job;
    } finally {
      if (titleJob === job) {
        titleJob = null;
        titleAbort = null;
        publish({ titlesBusy: false });
        runAutomaticTranslation();
      }
    }
  }
  async function saveTitle(key: string, target: string): Promise<void> {
    const workId = snapshot.work?.workId;
    const input = titleInputs().find((input) => input.key === key);
    if (!dependencies.titles || !workId || !input || disposed || titleSaveJob)
      throw new ReaderError('storage');
    titleAbort?.abort();
    const generation = titleJob;
    const job = (async () => {
      await generation;
      const entries = await dependencies.titles!.save(workId, [
        { ...input, target: target.trim(), origin: 'user', updatedAt: new Date().toISOString() },
      ]);
      titlesByWork.set(workId, entries);
      if (snapshot.work?.workId === workId) publish({ titles: entries, titlesError: null });
    })();
    titleSaveJob = job;
    try {
      await job;
    } finally {
      if (titleSaveJob === job) titleSaveJob = null;
    }
  }
  const pendingPositions = new Map<string, ReadingPosition>();
  let positionDrain: Promise<void> | null = null;
  function requestAutomaticTranslation() {
    if (
      !snapshot.autoTranslate ||
      snapshot.route.kind !== 'translation' ||
      !snapshot.chapter ||
      snapshot.translation.phase !== 'idle'
    )
      return;
    automaticRequest = { chapterId: snapshot.chapter.chapterId, operation: selectionOperation };
    runAutomaticTranslation();
  }
  function runAutomaticTranslation() {
    const request = automaticRequest;
    if (!request) return;
    if (
      disposed ||
      !snapshot.autoTranslate ||
      request.operation !== selectionOperation ||
      snapshot.route.kind !== 'translation' ||
      snapshot.chapter?.chapterId !== request.chapterId ||
      snapshot.translation.phase !== 'idle'
    ) {
      automaticRequest = null;
      return;
    }
    if (
      !initialized ||
      !foreground ||
      snapshot.busy ||
      activeTranslation ||
      dependencies.flow?.active ||
      dependencies.batch?.active ||
      snapshot.pendingSaveChapter ||
      snapshot.catalogStatus !== 'connected' ||
      !snapshot.selectedModelId
    )
      return;
    automaticRequest = null;
    void translate();
  }
  function publish(update: Partial<RenewalSnapshot>): void {
    if (disposed) return;
    const pending = dependencies.flow?.getSnapshot().pendingSave;
    snapshot = {
      ...snapshot,
      ...update,
      recentTitles: Object.fromEntries(
        [...worksById.values()].flatMap((work) =>
          workTitleInputs(work).map((input) => [
            input.key,
            displayedTitle(titlesByWork.get(work.workId) ?? [], input.key, input.source),
          ]),
        ),
      ),
      pendingSaveChapter: pending ? (chaptersById.get(pending.source.chapterId) ?? null) : null,
    };
    listeners.forEach((listener) => listener());
  }
  function navigate(route: Route): void {
    titleAbort?.abort();
    automaticRequest = null;
    sourceOperation++;
    selectionOperation++;
    sourceAbort?.abort();
    history.push(snapshot.route);
    publish({ route, showOriginal: false, error: null, busy: false });
  }
  function back(): void {
    titleAbort?.abort();
    automaticRequest = null;
    sourceOperation++;
    sourceAbort?.abort();
    selectionOperation++;
    const route = history.pop() ?? { kind: 'home' };
    if (route.kind === 'reader') {
      const version = versionsById.get(route.versionId) ?? null;
      const work = version ? (worksById.get(version.source.workId) ?? null) : null;
      const chapter = version ? (chaptersById.get(version.source.chapterId) ?? null) : null;
      publish({
        work,
        chapter,
        version,
        savedChapterIds: work ? (savedChaptersByWork.get(work.workId) ?? []) : [],
        position: positionsByVersion.get(route.versionId) ?? null,
      });
    }
    if (route.kind === 'translation') {
      const chapter = chaptersById.get(route.chapterId) ?? null;
      publish({
        chapter,
        work: chapter ? (worksById.get(chapter.workId) ?? null) : null,
        translation: translationForChapter(route.chapterId),
      });
    }
    if (route.kind === 'work') {
      publish({
        work: worksById.get(route.workId) ?? null,
        savedChapterIds: savedChaptersByWork.get(route.workId) ?? [],
      });
    }
    publish({ route, showOriginal: false, error: null, busy: false });
    const settledToken = dependencies.flow?.getSnapshot().token;
    if (route.kind === 'translation' && settledToken?.chapterId === route.chapterId)
      showNonAdoptingOutcome(settledToken);
    requestAutomaticTranslation();
    if (snapshot.work) publish({ titles: titlesByWork.get(snapshot.work.workId) ?? [] });
    requestTitleTranslation();
  }
  async function initialize(): Promise<void> {
    if (initialization || disposed) return initialization ?? undefined;
    initialization = (async () => {
      try {
        if (dependencies.lifecycle) {
          const eventAtStart = lifecycleEvents;
          const unsubscribe = await dependencies.lifecycle.subscribe((active) => {
            lifecycleEvents++;
            foreground = active;
            if (!active && activeTranslation) activeTranslation.cancelled = true;
            if (!active) titleAbort?.abort();
            dependencies.flow?.setForeground(active);
            dependencies.batch?.setForeground(active);
            if (active) runAutomaticTranslation();
          });
          if (disposed) {
            await unsubscribe();
            return;
          }
          unsubscribeLifecycle = unsubscribe;
          const active = await dependencies.lifecycle.isActive();
          if (lifecycleEvents === eventAtStart) foreground = active;
        }
        if (disposed) return;
        const migration = await dependencies.migrateLegacy?.();
        if (migration && !disposed) publish({ legacyWarnings: migration.warnings });
        if (disposed) return;
        dependencies.flow?.setForeground(foreground);
        dependencies.batch?.setForeground(foreground);
        await dependencies.flow?.initialize();
        await dependencies.batch?.initialize();
        const saved = await dependencies.settings?.readReadingSettings();
        if (disposed) return;
        if (saved)
          publish({
            connection: saved.selection?.connection ?? DEFAULT_CONNECTION,
            selectedModelId: saved.selection?.modelId ?? null,
            translationMode:
              saved.selection?.translationMode ?? dependencies.defaultTranslationMode ?? 'legacy',
            localLimits: undefined,
            fontSize: saved.fontSize,
            theme: saved.theme ?? 'system',
            readingBackground: saved.readingBackground ?? 'theme',
            lineHeight: saved.lineHeight ?? 1.8,
            autoTranslate: saved.autoTranslate ?? true,
            autoRetryFailed: saved.autoRetryFailed ?? saved.selection?.autoRetryFailed ?? true,
          });
        initialized = true;
        runAutomaticTranslation();
      } catch {
        foreground = false;
        dependencies.flow?.setForeground(false);
        dependencies.batch?.setForeground(false);
        publish({
          error: '저장된 기록 또는 요청 상태를 확인하지 못했습니다. 새 번역을 차단했습니다.',
        });
      } finally {
        // Saved reading does not depend on lifecycle, settings or request recovery.
        if (!disposed && dependencies.library) {
          try {
            const recent = await dependencies.library.listRecent();
            publish({ recent });
            if (dependencies.titles) {
              for (const entry of recent) {
                for (const page of await dependencies.library.readWork(entry.workId))
                  rememberWorkPage(page);
                await loadTitles(entry.workId);
              }
              publish({});
            }
          } catch {
            publish({ error: '저장된 독서 목록을 불러오지 못했습니다.' });
          }
        }
      }
    })();
    return initialization;
  }
  async function browse(): Promise<void> {
    if (!dependencies.browse || snapshot.busy || disposed) return;
    const operation = ++sourceOperation;
    publish({ busy: true, error: null });
    try {
      const result = await dependencies.browse();
      if (disposed || operation !== sourceOperation) return;
      publish({ busy: false });
      if (result) await openWork(result.selectedUrl);
    } catch {
      if (operation === sourceOperation)
        publish({ busy: false, error: '앱 내 원문 탐색을 열지 못했습니다.' });
    }
  }
  async function readSavedChapterIds(chapters: readonly ChapterRef[]): Promise<readonly string[]> {
    const library = dependencies.library;
    if (!library) return [];
    const savedEntries = await Promise.all(
      chapters.map(async (chapter) => {
        const versions = await library.listVersions(chapter.chapterId);
        return versions.length > 0 ? chapter.chapterId : null;
      }),
    );
    return savedEntries.filter((chapterId): chapterId is string => chapterId !== null);
  }
  function rememberWorkPage(page: WorkPage): WorkPage {
    let pages = pagesByWorkId.get(page.workId);
    if (!pages) {
      pages = new Map<string, WorkPage>();
      pagesByWorkId.set(page.workId, pages);
    }
    pages.set(page.pageUrl, page);
    const loadedPages = [...pages.values()];
    const chapters = [
      ...new Map(
        loadedPages.flatMap((loadedPage) =>
          loadedPage.chapters.map((chapter) => [chapter.chapterId, chapter] as const),
        ),
      ).values(),
    ].sort((left, right) => left.ordinal - right.ordinal);
    const latestPage = loadedPages[loadedPages.length - 1] ?? page;
    const work = { ...latestPage, chapters };
    worksById.set(work.workId, work);
    chapters.forEach((chapter) => chaptersById.set(chapter.chapterId, chapter));
    return work;
  }
  function ownsVisibleTranslation(request: ActiveTranslation): boolean {
    return (
      !request.cancelled &&
      request.selectionOperation === selectionOperation &&
      snapshot.route.kind === 'translation' &&
      snapshot.route.chapterId === request.chapterId &&
      snapshot.chapter?.chapterId === request.chapterId &&
      snapshot.connection.revision === request.settingsRevision
    );
  }
  async function checkSourceChange(
    version: CompletedTranslation,
    chapter: ChapterRef | null,
  ): Promise<void> {
    if (!dependencies.source || !chapter) {
      publish({ sourceChange: 'unavailable' });
      return;
    }
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    const control = new AbortController();
    sourceAbort = control;
    publish({ sourceChange: 'checking' });
    try {
      const current = await dependencies.source.getChapter(chapter, control.signal);
      if (
        disposed ||
        operation !== sourceOperation ||
        snapshot.route.kind !== 'reader' ||
        snapshot.route.versionId !== version.versionId
      )
        return;
      const changed =
        current.sourceHash !== version.source.sourceHash ||
        (version.source.rawHtml !== null && current.rawHtml !== version.source.rawHtml);
      publish({ sourceChange: changed ? 'changed' : 'unchanged' });
    } catch {
      if (operation === sourceOperation && !disposed) publish({ sourceChange: 'unavailable' });
    } finally {
      if (sourceAbort === control) sourceAbort = null;
    }
  }
  async function openWork(url: string): Promise<void> {
    if (!dependencies.source) {
      publish({ error: '원문 탐색 연결은 아직 사용할 수 없습니다.' });
      return;
    }
    try {
      url = dependencies.normalizeInput?.(url) ?? url;
    } catch {
      publish({ error: '지원하는 작품 또는 회차 주소를 확인하세요.' });
      return;
    }
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    publish({ busy: true, error: null });
    try {
      const page = await dependencies.source.getWorkPage(url, sourceAbort.signal);
      if (operation !== sourceOperation || disposed) return;
      if (dependencies.library) await dependencies.library.saveWorkPage(page);
      const newlySavedChapterIds = await readSavedChapterIds(page.chapters);
      if (operation !== sourceOperation || disposed) return;
      const work = rememberWorkPage(page);
      const savedChapterIds = [
        ...new Set([...(savedChaptersByWork.get(page.workId) ?? []), ...newlySavedChapterIds]),
      ];
      savedChaptersByWork.set(page.workId, savedChapterIds);
      const selected = work.chapters.find((chapter) => chapter.canonicalUrl === url.trim());
      publish({ work, savedChapterIds, chapter: selected ?? null, busy: false });
      navigate({
        kind: 'work',
        workId: work.workId,
        ...(selected ? { selectedChapterId: selected.chapterId } : {}),
      });
      await loadTitles(work.workId);
      requestTitleTranslation();
    } catch {
      if (operation === sourceOperation)
        publish({
          busy: false,
          error: '작품 제목과 목차를 불러오지 못했습니다. 원문 주소를 확인하고 다시 시도하세요.',
        });
    }
  }
  async function loadMoreWorkPage(): Promise<void> {
    const work = snapshot.work;
    const nextPageUrl = work?.nextPageUrl;
    if (!dependencies.source || !work || !nextPageUrl || snapshot.busy || disposed) return;
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    publish({ busy: true, error: null });
    try {
      const page = await dependencies.source.getWorkPage(nextPageUrl, sourceAbort.signal);
      if (operation !== sourceOperation || disposed) return;
      if (dependencies.library) await dependencies.library.saveWorkPage(page);
      const newlySavedChapterIds = await readSavedChapterIds(page.chapters);
      if (operation !== sourceOperation || disposed) return;
      const mergedWork = rememberWorkPage(page);
      const savedChapterIds = [
        ...new Set([...(savedChaptersByWork.get(work.workId) ?? []), ...newlySavedChapterIds]),
      ];
      savedChaptersByWork.set(work.workId, savedChapterIds);
      publish({ work: mergedWork, savedChapterIds, busy: false });
      await loadTitles(work.workId);
      requestTitleTranslation();
    } catch {
      if (operation === sourceOperation)
        publish({ busy: false, error: '다음 목차 페이지를 불러오지 못했습니다. 다시 시도하세요.' });
    }
  }
  function translationForChapter(chapterId: string): TranslationState {
    const flow = dependencies.flow;
    const state = flow?.getSnapshot();
    if (
      state &&
      (state.pendingSave?.source.chapterId === chapterId ||
        activeTranslation?.chapterId === chapterId)
    )
      return state;
    if (flow?.getUnfinished().some((token) => token.chapterId === chapterId))
      return {
        phase: 'unknown',
        elapsedMs: 0,
        error: new ReaderError('timeout_unknown', 'unknown'),
      };
    return { phase: 'idle', elapsedMs: 0 };
  }
  async function selectChapter(chapter: ChapterRef): Promise<void> {
    titleAbort?.abort();
    if (livePosition?.chapterId !== chapter.chapterId) livePosition = null;
    if (dependencies.flow?.getSnapshot().pendingSave?.source.chapterId === chapter.chapterId) {
      openPendingSave();
      return;
    }
    const operation = ++selectionOperation;
    publish({ chapter, busy: true, error: null });
    try {
      const versions = (await dependencies.library?.listVersions(chapter.chapterId)) ?? [];
      const recentVersionId = snapshot.recent.find(
        (entry) => entry.chapterId === chapter.chapterId,
      )?.versionId;
      const version = versions.find((value) => value.versionId === recentVersionId) ?? versions[0];
      const position = version
        ? ((await dependencies.library?.readPosition(version.versionId)) ?? null)
        : null;
      if (operation !== selectionOperation || disposed) return;
      if (version) {
        versionsById.set(version.versionId, version);
        positionsByVersion.set(version.versionId, position);
      }
      publish({
        version: version ?? null,
        paragraphRepair: false,
        position,
        busy: false,
        translation: translationForChapter(chapter.chapterId),
      });
      if (version) {
        navigate({ kind: 'reader', versionId: version.versionId });
        void checkSourceChange(version, chapter);
        if (titleJob) void stopTitles().then(() => requestTitleTranslation());
        else requestTitleTranslation();
      } else {
        navigate({ kind: 'translation', chapterId: chapter.chapterId });
        const routedOperation = selectionOperation;
        // Restore connectivity on demand; cached reading and startup stay offline.
        if (
          initialized &&
          foreground &&
          snapshot.selectedModelId &&
          snapshot.catalogStatus === 'idle'
        )
          await checkConnection();
        if (routedOperation === selectionOperation) requestAutomaticTranslation();
      }
    } catch {
      if (operation === selectionOperation)
        publish({
          busy: false,
          error: '저장된 번역을 불러오지 못했습니다. 새 번역을 자동 요청하지 않습니다.',
        });
    }
  }
  async function continueReading(versionId: string): Promise<void> {
    if (!dependencies.library) return;
    const operation = ++selectionOperation;
    try {
      const version = await dependencies.library.readVersion(versionId);
      if (!version) {
        publish({ error: '저장된 번역을 찾지 못했습니다.' });
        return;
      }
      const pages = (await dependencies.library.readWork(version.source.workId)).filter(
        (page) => page.workId === version.source.workId,
      );
      let work: WorkPage | null = null;
      const chapter =
        pages
          .flatMap((page) => page.chapters)
          .find((value) => value.chapterId === version.source.chapterId) ?? null;
      const position = await dependencies.library.readPosition(versionId);
      const savedChapterIds = await readSavedChapterIds(pages.flatMap((page) => page.chapters));
      if (operation !== selectionOperation || disposed) return;
      for (const page of pages) work = rememberWorkPage(page);
      if (work) savedChaptersByWork.set(work.workId, savedChapterIds);
      versionsById.set(version.versionId, version);
      positionsByVersion.set(version.versionId, position);
      publish({ work, chapter, version, position, savedChapterIds });
      navigate({ kind: 'reader', versionId });
      await loadTitles(version.source.workId);
      void checkSourceChange(version, chapter);
      // Cached reading remains offline. Title generation here needs an already checked connection.
      if (snapshot.catalogStatus === 'connected') requestTitleTranslation();
    } catch {
      publish({ error: '저장된 번역을 불러오지 못했습니다.' });
    }
  }
  function changeConnection(input: Omit<ConnectionConfig, 'revision' | 'authRef'>): void {
    titleAbort?.abort();
    if (disposed || dependencies.batch?.active) return;
    catalogOperation++;
    catalogAbort?.abort();
    session = null;
    publish({
      connection: { ...input, revision: snapshot.connection.revision + 1 },
      models: [],
      selectedModelId: null,
      catalogStatus: dependencies.connect || dependencies.catalog ? 'idle' : 'unavailable',
      localLimits: undefined,
    });
    persistSettings();
  }
  async function checkConnection(secret = ''): Promise<void> {
    if (
      (!dependencies.connect && !dependencies.catalog) ||
      disposed ||
      !initialized ||
      dependencies.batch?.active
    )
      return;
    const operation = ++catalogOperation;
    catalogAbort?.abort();
    catalogAbort = new AbortController();
    const previousModelId = snapshot.selectedModelId;
    session = null;
    publish({
      catalogStatus: 'checking',
      error: null,
      selectedModelId: null,
      connection: { ...snapshot.connection, revision: snapshot.connection.revision + 1 },
    });
    try {
      let connection = {
        ...snapshot.connection,
        baseUrl: safeEndpoint(snapshot.connection.baseUrl),
      };
      let nextSession: ProviderSession | null = null;
      let models: readonly ModelChoice[];
      if (dependencies.catalog) {
        const result = await dependencies.catalog(connection, secret, catalogAbort.signal);
        connection = result.connection;
        models = result.models;
      } else {
        nextSession = await dependencies.connect!(connection, secret, catalogAbort.signal);
        models = await nextSession.listModels(catalogAbort.signal);
      }
      if (operation !== catalogOperation || disposed) return;
      session = nextSession;
      const selectedChoice = models.find(
        (model) => model.id === previousModelId && model.supportsGeneration,
      );
      const selectedExists = selectedChoice !== undefined;
      let catalogStatus: CatalogStatus = 'connected';
      if (!models.some((model) => model.supportsGeneration)) catalogStatus = 'empty';
      else if (previousModelId && !selectedExists) catalogStatus = 'model_missing';
      publish({
        connection,
        models,
        selectedModelId: selectedExists ? previousModelId : null,
        localLimits:
          connection.provider === 'openai-compatible' && selectedChoice
            ? limitsForModel(selectedChoice.id, selectedChoice.contextTokens)
            : undefined,
        catalogStatus,
      });
      persistSettings();
      runAutomaticTranslation();
    } catch (error) {
      if (operation === catalogOperation) {
        session = null;
        publish({
          catalogStatus: errorLabel(error),
          models: [],
          selectedModelId: previousModelId,
          localLimits: undefined,
        });
      }
    }
  }
  function chooseModel(modelId: string): void {
    titleAbort?.abort();
    const model = snapshot.models.find(
      (choice) => choice.id === modelId && choice.supportsGeneration,
    );
    if (!model) return;
    if (disposed || dependencies.batch?.active) return;
    let localLimits: LocalTranslationLimits | undefined;
    if (snapshot.connection.provider === 'openai-compatible') {
      try {
        localLimits = limitsForModel(model.id, model.contextTokens);
      } catch {
        publish({
          error: '이 모델의 입력 한도로 번역을 준비할 수 없습니다. 다른 모델을 선택하세요.',
        });
        return;
      }
    }
    publish({
      selectedModelId: modelId,
      localLimits,
      catalogStatus: 'connected',
      connection: {
        ...snapshot.connection,
        revision: snapshot.connection.revision + (snapshot.selectedModelId === modelId ? 0 : 1),
      },
    });
    persistSettings();
    runAutomaticTranslation();
    requestTitleTranslation();
  }
  async function refreshSource(): Promise<void> {
    const chapter = snapshot.chapter;
    if (snapshot.route.kind !== 'reader' || !chapter) return;
    publish({
      sourceChange: 'idle',
      paragraphRepair: false,
      translation: { phase: 'idle', elapsedMs: 0 },
    });
    navigate({ kind: 'translation', chapterId: chapter.chapterId });
  }
  async function translate(repair?: ParagraphRepair): Promise<void> {
    const intendedChapter = snapshot.chapter?.chapterId;
    const intendedOperation = selectionOperation;
    if (titleJob || titleSaveJob) await stopTitles();
    if (intendedOperation !== selectionOperation || intendedChapter !== snapshot.chapter?.chapterId)
      return;
    if (
      (!dependencies.startTranslation && !dependencies.flow) ||
      (!session && !dependencies.catalog) ||
      !initialized ||
      !foreground ||
      (dependencies.catalog && snapshot.catalogStatus !== 'connected') ||
      dependencies.flow?.active ||
      dependencies.batch?.active ||
      dependencies.flow?.getSnapshot().pendingSave ||
      !snapshot.chapter ||
      !snapshot.selectedModelId ||
      activeTranslation !== null ||
      disposed ||
      snapshot.translation.phase !== 'idle'
    )
      return;
    const chapter = snapshot.chapter;
    retryableRepair = repair ? structuredClone(repair) : null;
    const selectedModel: SelectedModel = {
      connection: snapshot.connection,
      modelId: snapshot.selectedModelId,
      translationMode: repair ? 'stream' : snapshot.translationMode,
      ...(snapshot.autoRetryFailed ? {} : { autoRetryFailed: false }),
      ...(snapshot.connection.provider === 'openai-compatible' && snapshot.localLimits
        ? { limits: { ...snapshot.localLimits } }
        : {}),
    };
    const request: ActiveTranslation = {
      chapterId: chapter.chapterId,
      settingsRevision: selectedModel.connection.revision,
      selectionOperation,
    };
    activeTranslation = request;
    publish({
      paragraphRepair: Boolean(repair),
      translation: {
        phase: 'preparing',
        elapsedMs: 0,
        ...(repair ? { preview: repair.base.text } : {}),
      },
      translationActive: true,
    });
    try {
      if (dependencies.flow) {
        await dependencies.flow.start(
          chapter,
          selectedModel,
          undefined,
          repair?.base.source,
          repair,
        );
        publish({ translationTimings: { ...dependencies.flow.getTimings(), readerDisplayMs: 0 } });
        const completed = dependencies.flow.getCompleted();
        if (completed) updateSavedMetadata(completed);
        if (completed && ownsVisibleTranslation(request)) await adoptCompleted(completed, request);
      } else await dependencies.startTranslation!(chapter, selectedModel, session!);
    } catch {
      if (activeTranslation === request && ownsVisibleTranslation(request)) {
        publish({
          translation: { phase: 'failed', elapsedMs: 0, error: new ReaderError('connection') },
        });
      }
    } finally {
      if (activeTranslation === request) {
        if (!ownsVisibleTranslation(request)) showNonAdoptingOutcome(request);
        activeTranslation = null;
        publish({ translationActive: false });
        runAutomaticTranslation();
        requestTitleTranslation();
        if (
          !snapshot.autoTranslate &&
          dependencies.flow?.getCompleted()?.source.chapterId === chapter.chapterId &&
          snapshot.chapter?.chapterId === chapter.chapterId &&
          snapshot.version?.versionId === dependencies.flow?.getCompleted()?.versionId
        )
          void translateTitles(undefined, false, true);
      }
    }
  }
  function showNonAdoptingOutcome(
    request: Pick<ActiveTranslation, 'chapterId' | 'settingsRevision'>,
  ) {
    if (
      snapshot.route.kind !== 'translation' ||
      snapshot.chapter?.chapterId !== request.chapterId ||
      !dependencies.flow
    )
      return;
    const state = dependencies.flow.getSnapshot();
    if (['ready', 'failed', 'unknown'].includes(state.phase)) {
      publish({
        translation: state,
        error:
          '이전 요청의 결과를 자동으로 열지 않습니다. 저장본 열기 또는 명시적 재시도를 선택하세요.',
      });
    }
  }
  function updateSavedMetadata(value: CompletedTranslation) {
    const workId = value.source.workId;
    const ids = [...new Set([...(savedChaptersByWork.get(workId) ?? []), value.source.chapterId])];
    savedChaptersByWork.set(workId, ids);
    if (snapshot.work?.workId === workId) publish({ savedChapterIds: ids });
  }
  async function openCompleted(value: CompletedTranslation, request: ActiveTranslation) {
    readerReadyAt = clock.now();
    measuredVersionId = value.versionId;
    const position = (await dependencies.library?.readPosition(value.versionId)) ?? null;
    const recent = (await dependencies.library?.listRecent()) ?? [];
    if (disposed || !ownsVisibleTranslation(request)) return;
    versionsById.set(value.versionId, value);
    positionsByVersion.set(value.versionId, position);
    publish({ version: value, position, recent });
    navigate({ kind: 'reader', versionId: value.versionId });
  }
  const unsubscribeFlow = dependencies.flow?.subscribe((state) => {
    const token = state.token;
    const request = activeTranslation;
    if (
      token &&
      request &&
      token.chapterId === request.chapterId &&
      token.settingsRevision === request.settingsRevision &&
      ownsVisibleTranslation(request)
    )
      publish({ translation: state });
  });
  async function adoptCompleted(value: CompletedTranslation, request: ActiveTranslation) {
    if (value.provenance.generation?.mode !== 'colomo-local-v1')
      return openCompleted(value, request);
    // Saving must not replace the live reading surface or reset its scroll position.
    const recent = (await dependencies.library?.listRecent()) ?? [];
    if (!ownsVisibleTranslation(request)) return;
    versionsById.set(value.versionId, value);
    positionsByVersion.set(value.versionId, null);
    publish({ version: value, recent });
    if (livePosition?.chapterId === value.source.chapterId) {
      const block = value.blocks[livePosition.index];
      if (block) await savePosition(block.id, livePosition.offset);
    }
  }
  async function retryParagraphs(indexes?: readonly number[]): Promise<void> {
    const base = snapshot.version;
    if (
      !base ||
      !dependencies.flow ||
      disposed ||
      activeTranslation ||
      dependencies.batch?.active ||
      dependencies.flow.active ||
      snapshot.pendingSaveChapter ||
      !initialized ||
      !foreground
    )
      return;
    if (
      base.blocks.length !== base.source.paragraphs.length ||
      !dependencies.streamingAvailable ||
      snapshot.connection.provider !== 'openai-compatible'
    ) {
      publish({
        error: '문단별 재번역은 원문과 문단이 대응되는 로컬 번역본에서 사용할 수 있습니다.',
      });
      return;
    }
    const wanted = [
      ...new Set(indexes ?? base.failedParagraphs ?? base.quality?.japaneseBlocks ?? []),
    ].sort((a, b) => a - b);
    if (
      !wanted.length ||
      wanted.some(
        (index) =>
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= base.blocks.length ||
          !base.source.paragraphs[index]!.text.trim(),
      )
    )
      return;
    const operation = selectionOperation;
    if (snapshot.catalogStatus === 'idle' && snapshot.selectedModelId) await checkConnection();
    if (operation !== selectionOperation || snapshot.version?.versionId !== base.versionId) return;
    if (snapshot.catalogStatus !== 'connected' || !snapshot.selectedModelId) {
      publish({ error: '문단을 재번역하려면 연결 설정에서 서버와 생성 모델을 먼저 확인하세요.' });
      return;
    }
    const chapter = chaptersById.get(base.source.chapterId);
    if (!chapter) return;
    const blockIndex = base.blocks.findIndex((block) => block.id === snapshot.position?.blockId);
    livePosition = {
      chapterId: chapter.chapterId,
      index: Math.max(0, blockIndex),
      offset: snapshot.position?.offset ?? 0,
    };
    publish({
      chapter,
      translation: { phase: 'idle', elapsedMs: 0, preview: base.text },
    });
    navigate({ kind: 'translation', chapterId: chapter.chapterId });
    await translate({ base, indexes: wanted });
  }
  function cancelTranslation() {
    dependencies.flow?.cancel();
    if (activeTranslation) activeTranslation.cancelled = true;
  }
  function openPendingSave() {
    const batchRecord = snapshot.batch?.record;
    if (batchRecord?.phase === 'saving') {
      publish({ work: batchRecord.work });
      navigate({ kind: 'work', workId: batchRecord.work.workId });
      return;
    }
    const state = dependencies.flow?.getSnapshot();
    const chapter = state?.pendingSave
      ? chaptersById.get(state.pendingSave.source.chapterId)
      : null;
    if (!state || !chapter || disposed) return;
    const work = worksById.get(chapter.workId) ?? null;
    publish({
      chapter,
      work,
      savedChapterIds: savedChaptersByWork.get(chapter.workId) ?? [],
      translation: state,
      version: null,
      position: null,
    });
    navigate({ kind: 'translation', chapterId: chapter.chapterId });
  }
  async function retrySave() {
    if (snapshot.batch?.record?.phase === 'saving') {
      await retryBatchSave();
      return;
    }
    const token = dependencies.flow?.getSnapshot().token;
    if (!token || dependencies.flow?.active || activeTranslation || !foreground || disposed) return;
    const request: ActiveTranslation = {
      chapterId: token.chapterId,
      settingsRevision: token.settingsRevision,
      selectionOperation,
    };
    activeTranslation = request;
    publish({ translationActive: true });
    try {
      await dependencies.flow?.retrySave();
      if (snapshot.route.kind === 'translation' && snapshot.chapter?.chapterId === token.chapterId)
        publish({ translation: dependencies.flow!.getSnapshot() });
      const value = dependencies.flow?.getCompleted();
      if (value) updateSavedMetadata(value);
      if (value && ownsVisibleTranslation(request)) await adoptCompleted(value, request);
    } catch {
      publish({ error: '기기 저장을 완료하지 못했습니다.' });
    } finally {
      if (activeTranslation === request) {
        if (!ownsVisibleTranslation(request)) showNonAdoptingOutcome(request);
        activeTranslation = null;
        publish({ translationActive: false });
      }
    }
  }
  async function retryTranslation() {
    if (
      activeTranslation ||
      dependencies.flow?.active ||
      dependencies.batch?.active ||
      snapshot.translation.pendingSave
    )
      return;
    if (!['unknown', 'failed'].includes(snapshot.translation.phase)) return;
    const repair =
      snapshot.paragraphRepair &&
      retryableRepair?.base.source.chapterId === snapshot.chapter?.chapterId
        ? (retryableRepair ?? undefined)
        : undefined;
    if (repair && snapshot.connection.provider !== 'openai-compatible') {
      publish({ error: '문단 재번역 재시도는 로컬 모델 연결을 확인한 뒤 사용할 수 있습니다.' });
      return;
    }
    publish({ translation: { phase: 'idle', elapsedMs: 0 } });
    await translate(repair);
  }
  function showContents(): void {
    if (!snapshot.work) return;
    navigate({
      kind: 'work',
      workId: snapshot.work.workId,
      ...(snapshot.chapter ? { selectedChapterId: snapshot.chapter.chapterId } : {}),
    });
    requestTitleTranslation();
  }
  function adjacentChapter(direction: -1 | 1): void {
    if (!snapshot.work || !snapshot.chapter || snapshot.busy) return;
    const index = snapshot.work.chapters.findIndex(
      (value) => value.chapterId === snapshot.chapter?.chapterId,
    );
    const target = snapshot.work.chapters[index + direction];
    if (target && index >= 0) void selectChapter(target);
  }
  function changeFontSize(fontSize: number): void {
    if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 48) {
      publish({ fontSize });
      persistSettings();
    }
  }
  function changeTheme(theme: ThemePreference): void {
    if (!THEME_PREFERENCES.includes(theme) || theme === snapshot.theme) return;
    publish({ theme });
    persistSettings();
  }
  function changeReadingBackground(value: ReadingBackground): void {
    if (!READING_BACKGROUNDS.includes(value) || value === snapshot.readingBackground) return;
    publish({ readingBackground: value });
    persistSettings();
  }
  function changeLineHeight(value: LineHeight): void {
    if (!LINE_HEIGHTS.includes(value) || value === snapshot.lineHeight) return;
    publish({ lineHeight: value });
    persistSettings();
  }
  async function savePosition(blockId: string, offset: number): Promise<void> {
    const version = snapshot.version;
    if (
      !dependencies.library ||
      !version ||
      !version.blocks.some((block) => block.id === blockId) ||
      !Number.isFinite(offset) ||
      offset < 0 ||
      offset > Number.MAX_SAFE_INTEGER
    )
      return;
    const position: ReadingPosition = {
      workId: version.source.workId,
      chapterId: version.source.chapterId,
      versionId: version.versionId,
      blockId,
      offset,
    };
    positionsByVersion.set(version.versionId, position);
    publish({ position });
    pendingPositions.set(position.versionId, position);
    if (!positionDrain)
      positionDrain = (async () => {
        while (pendingPositions.size) {
          const next = pendingPositions.values().next().value!;
          pendingPositions.delete(next.versionId);
          try {
            await dependencies.library!.savePosition(next);
          } catch {
            publish({ error: '읽던 위치를 저장하지 못했습니다.' });
          }
        }
      })().finally(() => {
        positionDrain = null;
      });
    await positionDrain;
  }
  async function prepareBatch(range: ChapterRange | null, retranslate: boolean): Promise<void> {
    if (
      !dependencies.batch ||
      !snapshot.work ||
      !snapshot.selectedModelId ||
      snapshot.catalogStatus !== 'connected' ||
      activeTranslation ||
      !initialized ||
      !foreground ||
      disposed
    )
      return;
    await dependencies.batch.prepare(
      snapshot.work,
      {
        connection: snapshot.connection,
        modelId: snapshot.selectedModelId,
        translationMode: snapshot.translationMode,
        ...(snapshot.autoRetryFailed ? {} : { autoRetryFailed: false }),
        ...(snapshot.localLimits ? { limits: snapshot.localLimits } : {}),
      },
      range,
      retranslate,
    );
  }
  function batchSelectionIsCurrent(): boolean {
    const selection = snapshot.batch?.record?.selection;
    return Boolean(
      selection &&
      selection.modelId === snapshot.selectedModelId &&
      selection.connection.provider === snapshot.connection.provider &&
      selection.connection.baseUrl === snapshot.connection.baseUrl &&
      selection.connection.authRef === snapshot.connection.authRef &&
      (selection.translationMode ?? 'legacy') === snapshot.translationMode &&
      (selection.autoRetryFailed ?? true) === snapshot.autoRetryFailed &&
      JSON.stringify(selection.limits) === JSON.stringify(snapshot.localLimits),
    );
  }
  async function runBatch(retryUncertain: boolean = false): Promise<void> {
    await stopTitles();
    if (
      !dependencies.batch ||
      disposed ||
      !initialized ||
      !foreground ||
      activeTranslation ||
      snapshot.catalogStatus !== 'connected'
    )
      return;
    if (!batchSelectionIsCurrent()) {
      publish({
        error: '확인한 대상의 연결·모델 설정이 바뀌었습니다. 번역 범위를 다시 확인하세요.',
      });
      return;
    }
    await dependencies.batch.run(retryUncertain);
    if (!disposed && dependencies.library)
      publish({ recent: await dependencies.library.listRecent() });
  }
  async function scanBatch(): Promise<void> {
    await stopTitles();
    if (!initialized || disposed || !foreground || activeTranslation) return;
    if (!batchSelectionIsCurrent()) {
      publish({
        error: '확인한 대상의 연결·모델 설정이 바뀌었습니다. 번역 범위를 다시 확인하세요.',
      });
      return;
    }
    await dependencies.batch?.scan();
  }
  async function confirmBatchCandidates(choices: readonly CandidateChoice[]): Promise<void> {
    if (!initialized || disposed || !foreground || activeTranslation) return;
    if (!batchSelectionIsCurrent()) {
      publish({
        error: '확인한 대상의 연결·모델 설정이 바뀌었습니다. 번역 범위를 다시 확인하세요.',
      });
      return;
    }
    await dependencies.batch?.confirmCandidates(choices);
  }
  async function retryBatchSave(): Promise<void> {
    if (!dependencies.batch || disposed || !initialized || !foreground || activeTranslation) return;
    await dependencies.batch.retrySave();
    if (!disposed && dependencies.library)
      publish({ recent: await dependencies.library.listRecent() });
  }
  function openBatch(): void {
    const record = snapshot.batch?.record;
    if (!record || disposed) return;
    publish({
      work: record.work,
      savedChapterIds: savedChaptersByWork.get(record.work.workId) ?? [],
    });
    navigate({ kind: 'work', workId: record.work.workId });
  }
  const unsubscribeBatch = dependencies.batch?.subscribe((batch) => {
    const record = batch.record;
    if (record) {
      worksById.set(record.work.workId, record.work);
      record.work.chapters.forEach((chapter) => chaptersById.set(chapter.chapterId, chapter));
      if (snapshot.work?.workId === record.work.workId) publish({ work: record.work });
      const completed = dependencies.flow?.getCompleted();
      if (completed) updateSavedMetadata(completed);
    }
    publish({ batch, translationActive: batch.active || activeTranslation !== null });
  });
  function dispose(): void {
    titleAbort?.abort();
    disposed = true;
    sourceOperation++;
    selectionOperation++;
    catalogOperation++;
    sourceAbort?.abort();
    catalogAbort?.abort();
    dependencies.batch?.dispose();
    dependencies.flow?.dispose();
    unsubscribeFlow?.();
    unsubscribeBatch?.();
    if (unsubscribeLifecycle) void unsubscribeLifecycle().catch(() => {});
    listeners.clear();
  }
  return {
    translateTitles,
    saveTitle,
    changeAutoTranslate(enabled) {
      publish({ autoTranslate: enabled });
      if (!enabled) automaticRequest = null;
      if (!enabled) titleAbort?.abort();
      persistSettings();
      if (enabled) requestAutomaticTranslation();
      if (enabled) requestTitleTranslation();
    },
    changeAutoRetryFailed(enabled) {
      publish({ autoRetryFailed: enabled });
      persistSettings();
    },
    retryParagraphs,
    previewPosition(index, offset) {
      if (
        snapshot.route.kind !== 'translation' ||
        !snapshot.chapter ||
        !Number.isSafeInteger(index) ||
        index < 0 ||
        !Number.isFinite(offset) ||
        offset < 0
      )
        return;
      livePosition = { chapterId: snapshot.chapter.chapterId, index, offset };
      if (
        snapshot.translation.phase === 'ready' &&
        snapshot.version?.source.chapterId === snapshot.chapter.chapterId
      ) {
        const block = snapshot.version.blocks[index];
        if (block) void savePosition(block.id, offset);
      }
    },
    changeTranslationMode(mode) {
      if (
        disposed ||
        activeTranslation ||
        dependencies.flow?.active ||
        dependencies.batch?.active ||
        snapshot.pendingSaveChapter ||
        (mode === 'stream' && !dependencies.streamingAvailable)
      )
        return;
      publish({
        translationMode: mode,
        connection: { ...snapshot.connection, revision: snapshot.connection.revision + 1 },
      });
      persistSettings();
    },
    getSnapshot: (): RenewalSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize,
    navigate,
    back,
    browse,
    cancelTranslation,
    retrySave,
    openPendingSave,
    retryTranslation,
    readerDisplayed(versionId: string) {
      if (versionId !== measuredVersionId || !snapshot.translationTimings) return;
      publish({
        translationTimings: {
          ...snapshot.translationTimings,
          readerDisplayMs: Math.max(0, clock.now() - readerReadyAt),
        },
      });
      measuredVersionId = null;
    },
    async openSavedTranslation() {
      const value = dependencies.flow?.getCompleted();
      if (value && value.source.chapterId === snapshot.chapter?.chapterId) {
        if (livePosition?.chapterId === value.source.chapterId) {
          const block = value.blocks[livePosition.index];
          if (block && dependencies.library)
            await dependencies.library.savePosition({
              versionId: value.versionId,
              chapterId: value.source.chapterId,
              workId: value.source.workId,
              blockId: block.id,
              offset: livePosition.offset,
            });
        }
        await continueReading(value.versionId);
      }
    },
    openWork,
    loadMoreWorkPage,
    selectChapter,
    continueReading,
    changeConnection,
    checkConnection,
    chooseModel,
    prepareBatch,
    scanBatch,
    confirmBatchCandidates,
    runBatch,
    cancelBatch: () => dependencies.batch?.cancel(),
    retryBatchSave,
    openBatch,
    readGuidance: async (workId) => (await dependencies.guidance?.read(workId)) ?? null,
    async saveGuidance(workId, draft) {
      if (
        !dependencies.guidance ||
        disposed ||
        !initialized ||
        !foreground ||
        snapshot.work?.workId !== workId ||
        activeTranslation ||
        dependencies.batch?.active ||
        dependencies.flow?.active
      )
        throw new ReaderError('storage');
      return dependencies.guidance.save(workId, draft);
    },
    translate,
    refreshSource,
    showContents,
    adjacentChapter,
    changeFontSize,
    changeTheme,
    changeReadingBackground,
    changeLineHeight,
    savePosition,
    showOriginal(showOriginal: boolean): void {
      publish({ showOriginal });
    },
    dispose,
  };
}
