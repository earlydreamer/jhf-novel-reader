import type { AppLifecycle } from '../contracts';
import type { PhaseDurations, WholeChapterFlow } from '../translation/wholeChapter';
import type { ReadingSettings } from '../storage/settings';
import { ReaderError } from '../contracts';
import type {
  ChapterRef,
  CompletedTranslation,
  ConnectionConfig,
  LibraryStore,
  ModelChoice,
  ProviderSession,
  ReadingPosition,
  RenewalSource,
  SelectedModel,
  TranslationState,
  WorkPage,
} from '../contracts/reading';
import type { Route } from './routes';

export type CatalogStatus =
  | 'idle'
  | 'checking'
  | 'connected'
  | 'auth'
  | 'connection'
  | 'model_list'
  | 'empty'
  | 'model_missing'
  | 'unavailable';
export type SourceChangeStatus = 'idle' | 'checking' | 'unchanged' | 'changed' | 'unavailable';
export interface RenewalDependencies {
  readonly library?: LibraryStore;
  readonly migrateLegacy?: () => Promise<void>;
  readonly clock?: { now(): number };
  readonly flow?: WholeChapterFlow;
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
  readonly catalogStatus: CatalogStatus;
  readonly fontSize: number;
  readonly showOriginal: boolean;
  readonly error: string | null;
  readonly busy: boolean;
  readonly sourceAvailable: boolean;
  readonly connectionAvailable: boolean;
  readonly translationAvailable: boolean;
  readonly translationActive: boolean;
  readonly pendingSaveChapter: ChapterRef | null;
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
  if (error instanceof ReaderError && error.code === 'connection') return 'connection';
  return 'model_list';
}
export interface RenewalController {
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
  translate(): Promise<void>;
  refreshSource(): Promise<void>;
  showContents(): void;
  adjacentChapter(direction: -1 | 1): void;
  changeFontSize(fontSize: number): void;
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
    route: { kind: 'home' },
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
    showOriginal: false,
    error: null,
    busy: false,
    sourceAvailable: Boolean(dependencies.source),
    connectionAvailable: Boolean(dependencies.connect || dependencies.catalog),
    translationAvailable: Boolean(dependencies.startTranslation || dependencies.flow),
    translationActive: false,
    pendingSaveChapter: null,
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
      selection: snapshot.selectedModelId
        ? { connection: { ...snapshot.connection }, modelId: snapshot.selectedModelId }
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
  let catalogAbort: AbortController | null = null;
  let sourceAbort: AbortController | null = null;
  function publish(update: Partial<RenewalSnapshot>): void {
    if (disposed) return;
    const pending = dependencies.flow?.getSnapshot().pendingSave;
    snapshot = {
      ...snapshot,
      ...update,
      pendingSaveChapter: pending ? (chaptersById.get(pending.source.chapterId) ?? null) : null,
    };
    listeners.forEach((listener) => listener());
  }
  function navigate(route: Route): void {
    sourceOperation++;
    selectionOperation++;
    sourceAbort?.abort();
    history.push(snapshot.route);
    publish({ route, showOriginal: false, error: null, busy: false });
  }
  function back(): void {
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
            dependencies.flow?.setForeground(active);
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
        await dependencies.migrateLegacy?.();
        if (disposed) return;
        dependencies.flow?.setForeground(foreground);
        await dependencies.flow?.initialize();
        const saved = await dependencies.settings?.readReadingSettings();
        if (disposed) return;
        if (saved)
          publish({
            connection: saved.selection?.connection ?? DEFAULT_CONNECTION,
            selectedModelId: saved.selection?.modelId ?? null,
            fontSize: saved.fontSize,
          });
        initialized = true;
      } catch {
        foreground = false;
        dependencies.flow?.setForeground(false);
        publish({
          error: '저장된 기록 또는 요청 상태를 확인하지 못했습니다. 새 번역을 차단했습니다.',
        });
      } finally {
        // Saved reading does not depend on lifecycle, settings or request recovery.
        if (!disposed && dependencies.library) {
          try {
            publish({ recent: await dependencies.library.listRecent() });
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
        position,
        busy: false,
        translation: translationForChapter(chapter.chapterId),
      });
      if (version) {
        navigate({ kind: 'reader', versionId: version.versionId });
        void checkSourceChange(version, chapter);
      } else navigate({ kind: 'translation', chapterId: chapter.chapterId });
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
      void checkSourceChange(version, chapter);
    } catch {
      publish({ error: '저장된 번역을 불러오지 못했습니다.' });
    }
  }
  function changeConnection(input: Omit<ConnectionConfig, 'revision' | 'authRef'>): void {
    if (disposed) return;
    catalogOperation++;
    catalogAbort?.abort();
    session = null;
    publish({
      connection: { ...input, revision: snapshot.connection.revision + 1 },
      models: [],
      selectedModelId: null,
      catalogStatus: dependencies.connect || dependencies.catalog ? 'idle' : 'unavailable',
    });
    persistSettings();
  }
  async function checkConnection(secret = ''): Promise<void> {
    if ((!dependencies.connect && !dependencies.catalog) || disposed || !initialized) return;
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
      const selectedExists = models.some(
        (model) => model.id === previousModelId && model.supportsGeneration,
      );
      let catalogStatus: CatalogStatus = 'connected';
      if (!models.some((model) => model.supportsGeneration)) catalogStatus = 'empty';
      else if (previousModelId && !selectedExists) catalogStatus = 'model_missing';
      publish({
        connection,
        models,
        selectedModelId: selectedExists ? previousModelId : null,
        catalogStatus,
      });
      persistSettings();
    } catch (error) {
      if (operation === catalogOperation) {
        session = null;
        publish({ catalogStatus: errorLabel(error), models: [], selectedModelId: null });
      }
    }
  }
  function chooseModel(modelId: string): void {
    if (!snapshot.models.some((model) => model.id === modelId && model.supportsGeneration)) return;
    if (disposed) return;
    publish({
      selectedModelId: modelId,
      catalogStatus: 'connected',
      connection: {
        ...snapshot.connection,
        revision: snapshot.connection.revision + (snapshot.selectedModelId === modelId ? 0 : 1),
      },
    });
    persistSettings();
  }
  async function refreshSource(): Promise<void> {
    const chapter = snapshot.chapter;
    if (snapshot.route.kind !== 'reader' || !chapter) return;
    publish({ sourceChange: 'idle', translation: { phase: 'idle', elapsedMs: 0 } });
    navigate({ kind: 'translation', chapterId: chapter.chapterId });
    await translate();
  }
  async function translate(): Promise<void> {
    if (
      (!dependencies.startTranslation && !dependencies.flow) ||
      (!session && !dependencies.catalog) ||
      !initialized ||
      !foreground ||
      (dependencies.catalog && snapshot.catalogStatus !== 'connected') ||
      dependencies.flow?.active ||
      dependencies.flow?.getSnapshot().pendingSave ||
      !snapshot.chapter ||
      !snapshot.selectedModelId ||
      activeTranslation !== null ||
      disposed ||
      snapshot.translation.phase !== 'idle'
    )
      return;
    const chapter = snapshot.chapter;
    const selectedModel: SelectedModel = {
      connection: snapshot.connection,
      modelId: snapshot.selectedModelId,
    };
    const request: ActiveTranslation = {
      chapterId: chapter.chapterId,
      settingsRevision: selectedModel.connection.revision,
      selectionOperation,
    };
    activeTranslation = request;
    publish({ translation: { phase: 'preparing', elapsedMs: 0 }, translationActive: true });
    try {
      if (dependencies.flow) {
        await dependencies.flow.start(chapter, selectedModel);
        publish({ translationTimings: { ...dependencies.flow.getTimings(), readerDisplayMs: 0 } });
        const completed = dependencies.flow.getCompleted();
        if (completed) updateSavedMetadata(completed);
        if (completed && ownsVisibleTranslation(request)) await openCompleted(completed, request);
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
  function cancelTranslation() {
    dependencies.flow?.cancel();
    if (activeTranslation) activeTranslation.cancelled = true;
  }
  function openPendingSave() {
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
      if (value && ownsVisibleTranslation(request)) await openCompleted(value, request);
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
    if (activeTranslation || dependencies.flow?.active || snapshot.translation.pendingSave) return;
    if (!['unknown', 'failed'].includes(snapshot.translation.phase)) return;
    publish({ translation: { phase: 'idle', elapsedMs: 0 } });
    await translate();
  }
  function showContents(): void {
    if (!snapshot.work) return;
    navigate({
      kind: 'work',
      workId: snapshot.work.workId,
      ...(snapshot.chapter ? { selectedChapterId: snapshot.chapter.chapterId } : {}),
    });
  }
  function adjacentChapter(direction: -1 | 1): void {
    if (!snapshot.work || !snapshot.chapter) return;
    const index = snapshot.work.chapters.findIndex(
      (value) => value.chapterId === snapshot.chapter?.chapterId,
    );
    const target = snapshot.work.chapters[index + direction];
    if (target) void selectChapter(target);
  }
  function changeFontSize(fontSize: number): void {
    if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 48) {
      publish({ fontSize });
      persistSettings();
    }
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
    try {
      await dependencies.library.savePosition(position);
    } catch {
      publish({ error: '읽던 위치를 저장하지 못했습니다.' });
    }
  }
  function dispose(): void {
    disposed = true;
    sourceOperation++;
    selectionOperation++;
    catalogOperation++;
    sourceAbort?.abort();
    catalogAbort?.abort();
    dependencies.flow?.dispose();
    unsubscribeFlow?.();
    if (unsubscribeLifecycle) void unsubscribeLifecycle().catch(() => {});
    listeners.clear();
  }
  return {
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
      if (value && value.source.chapterId === snapshot.chapter?.chapterId)
        await continueReading(value.versionId);
    },
    openWork,
    loadMoreWorkPage,
    selectChapter,
    continueReading,
    changeConnection,
    checkConnection,
    chooseModel,
    translate,
    refreshSource,
    showContents,
    adjacentChapter,
    changeFontSize,
    savePosition,
    showOriginal(showOriginal: boolean): void {
      publish({ showOriginal });
    },
    dispose,
  };
}
