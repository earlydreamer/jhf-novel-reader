import { ReaderError } from '../contracts';
import type { ChapterRef, CompletedTranslation, ConnectionConfig, LibraryStore, ModelChoice, ProviderSession, ReadingPosition, RenewalSource, SelectedModel, TranslationState, WorkPage } from '../contracts/reading';
import type { Route } from './routes';

export type CatalogStatus = 'idle' | 'checking' | 'connected' | 'auth' | 'connection' | 'model_list' | 'empty' | 'model_missing' | 'unavailable';
export interface RenewalDependencies {
  readonly library?: LibraryStore;
  readonly source?: RenewalSource;
  readonly connect?: (config: ConnectionConfig, secret: string, signal: AbortSignal) => Promise<ProviderSession>;
  /** T4 owns the real whole-chapter lifecycle. T1 never fabricates completion. */
  readonly startTranslation?: (chapter: ChapterRef, model: SelectedModel, session: ProviderSession) => Promise<void>;
}
export interface RenewalSnapshot {
  readonly route: Route;
  readonly work: WorkPage | null;
  readonly savedChapterIds: readonly string[];
  readonly chapter: ChapterRef | null;
  readonly translation: TranslationState;
  readonly version: CompletedTranslation | null;
  readonly position: ReadingPosition | null;
  readonly recent: readonly { workId: string; chapterId: string; versionId: string; updatedAt: string }[];
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
}
const DEFAULT_CONNECTION: ConnectionConfig = { provider: 'openai-compatible', baseUrl: '', revision: 0 };
function safeEndpoint(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new ReaderError('connection'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ReaderError('connection');
  return url.href.replace(/\/$/, '');
}
function errorLabel(error: unknown): CatalogStatus {
  if (error instanceof ReaderError && error.code === 'auth') return 'auth';
  if (error instanceof ReaderError && error.code === 'connection') return 'connection';
  return 'model_list';
}
export function createRenewalController(dependencies: RenewalDependencies = {}) {
  let snapshot: RenewalSnapshot = {
    route: { kind: 'home' }, work: null, savedChapterIds: [], chapter: null, version: null, position: null,
    translation: { phase: 'idle', elapsedMs: 0 }, recent: [], connection: DEFAULT_CONNECTION,
    models: [], selectedModelId: null, catalogStatus: dependencies.connect ? 'idle' : 'unavailable',
    fontSize: 18, showOriginal: false, error: null, busy: false,
    sourceAvailable: Boolean(dependencies.source), connectionAvailable: Boolean(dependencies.connect),
    translationAvailable: Boolean(dependencies.startTranslation),
  };
  const listeners = new Set<() => void>();
  const history: Route[] = [];
  const worksById = new Map<string, WorkPage>();
  const chaptersById = new Map<string, ChapterRef>();
  const savedChaptersByWork = new Map<string, readonly string[]>();
  const versionsById = new Map<string, CompletedTranslation>();
  const positionsByVersion = new Map<string, ReadingPosition | null>();
  let disposed = false;
  let sourceOperation = 0;
  let selectionOperation = 0;
  let catalogOperation = 0;
  let session: ProviderSession | null = null;
  let catalogAbort: AbortController | null = null;
  let sourceAbort: AbortController | null = null;
  function publish(update: Partial<RenewalSnapshot>): void {
    if (disposed) return;
    snapshot = { ...snapshot, ...update };
    listeners.forEach(listener => listener());
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
      const work = version ? worksById.get(version.source.workId) ?? null : null;
      const chapter = version ? chaptersById.get(version.source.chapterId) ?? null : null;
      publish({ work, chapter, version, position: positionsByVersion.get(route.versionId) ?? null });
    }
    if (route.kind === 'translation') {
      const chapter = chaptersById.get(route.chapterId) ?? null;
      publish({ chapter, work: chapter ? worksById.get(chapter.workId) ?? null : null });
    }
    if (route.kind === 'work') {
      publish({ work: worksById.get(route.workId) ?? null, savedChapterIds: savedChaptersByWork.get(route.workId) ?? [] });
    }
    publish({ route, showOriginal: false, error: null, busy: false });
  }
  async function initialize(): Promise<void> {
    if (!dependencies.library) return;
    try { publish({ recent: await dependencies.library.listRecent() }); }
    catch { publish({ error: '저장된 독서 기록을 불러오지 못했습니다.' }); }
  }
  async function openWork(url: string): Promise<void> {
    if (!dependencies.source) { publish({ error: '원문 탐색 연결은 아직 사용할 수 없습니다.' }); return; }
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    publish({ busy: true, error: null });
    try {
      const page = await dependencies.source.getWorkPage(url, sourceAbort.signal);
      if (operation !== sourceOperation || disposed) return;
      if (dependencies.library) await dependencies.library.saveWorkPage(page);
      const savedChapterIds: string[] = [];
      const library = dependencies.library;
      if (library) {
        const entries = await Promise.all(page.chapters.map(async chapter => ({ chapterId: chapter.chapterId, versions: await library.listVersions(chapter.chapterId) })));
        entries.forEach(entry => { if (entry.versions.length > 0) savedChapterIds.push(entry.chapterId); });
      }
      if (operation !== sourceOperation || disposed) return;
      worksById.set(page.workId, page);
      page.chapters.forEach(chapter => chaptersById.set(chapter.chapterId, chapter));
      savedChaptersByWork.set(page.workId, savedChapterIds);
      const selected = page.chapters.find(chapter => chapter.canonicalUrl === url.trim());
      publish({ work: page, savedChapterIds, chapter: selected ?? null, busy: false });
      navigate({ kind: 'work', workId: page.workId, ...(selected ? { selectedChapterId: selected.chapterId } : {}) });
    } catch { if (operation === sourceOperation) publish({ busy: false, error: '작품 제목과 목차를 불러오지 못했습니다. 원문 주소를 확인하고 다시 시도하세요.' }); }
  }
  async function selectChapter(chapter: ChapterRef): Promise<void> {
    const operation = ++selectionOperation;
    publish({ chapter, busy: true, error: null });
    try {
      const versions = await dependencies.library?.listVersions(chapter.chapterId) ?? [];
      const recentVersionId = snapshot.recent.find(entry => entry.chapterId === chapter.chapterId)?.versionId;
      const version = versions.find(value => value.versionId === recentVersionId) ?? versions[0];
      const position = version ? await dependencies.library?.readPosition(version.versionId) ?? null : null;
      if (operation !== selectionOperation || disposed) return;
      if (version) { versionsById.set(version.versionId, version); positionsByVersion.set(version.versionId, position); }
      publish({ version: version ?? null, position, busy: false, translation: { phase: 'idle', elapsedMs: 0 } });
      if (version) navigate({ kind: 'reader', versionId: version.versionId });
      else navigate({ kind: 'translation', chapterId: chapter.chapterId });
    } catch { if (operation === selectionOperation) publish({ busy: false, error: '저장된 번역을 불러오지 못했습니다. 새 번역을 자동 요청하지 않습니다.' }); }
  }
  async function continueReading(versionId: string): Promise<void> {
    if (!dependencies.library) return;
    const operation = ++selectionOperation;
    try {
      const version = await dependencies.library.readVersion(versionId);
      if (!version) { publish({ error: '저장된 번역을 찾지 못했습니다.' }); return; }
      const pages = await dependencies.library.readWork(version.source.workId);
      const work = pages[0] ?? null;
      const chapter = pages.flatMap(page => page.chapters).find(value => value.chapterId === version.source.chapterId) ?? null;
      const position = await dependencies.library.readPosition(versionId);
      if (operation !== selectionOperation || disposed) return;
      if (work) worksById.set(work.workId, work);
      pages.flatMap(page => page.chapters).forEach(value => chaptersById.set(value.chapterId, value));
      versionsById.set(version.versionId, version);
      positionsByVersion.set(version.versionId, position);
      publish({ work, chapter, version, position });
      navigate({ kind: 'reader', versionId });
    } catch { publish({ error: '저장된 번역을 불러오지 못했습니다.' }); }
  }
  function changeConnection(input: Omit<ConnectionConfig, 'revision' | 'authRef'>): void {
    catalogOperation++;
    catalogAbort?.abort();
    session = null;
    publish({ connection: { ...input, revision: snapshot.connection.revision + 1 }, models: [], selectedModelId: null, catalogStatus: dependencies.connect ? 'idle' : 'unavailable' });
  }
  async function checkConnection(secret = ''): Promise<void> {
    if (!dependencies.connect) return;
    const operation = ++catalogOperation;
    catalogAbort?.abort();
    catalogAbort = new AbortController();
    const previousModelId = snapshot.selectedModelId;
    session = null;
    publish({ catalogStatus: 'checking', error: null, selectedModelId: null });
    try {
      const connection = { ...snapshot.connection, baseUrl: safeEndpoint(snapshot.connection.baseUrl) };
      const nextSession = await dependencies.connect(connection, secret, catalogAbort.signal);
      const models = await nextSession.listModels(catalogAbort.signal);
      if (operation !== catalogOperation || disposed) return;
      session = nextSession;
      const selectedExists = models.some(model => model.id === previousModelId && model.supportsGeneration);
      let catalogStatus: CatalogStatus = 'connected';
      if (!models.some(model => model.supportsGeneration)) catalogStatus = 'empty';
      else if (previousModelId && !selectedExists) catalogStatus = 'model_missing';
      publish({ connection, models, selectedModelId: selectedExists ? previousModelId : null, catalogStatus });
    } catch (error) { if (operation === catalogOperation) { session = null; publish({ catalogStatus: errorLabel(error), models: [], selectedModelId: null }); } }
  }
  function chooseModel(modelId: string): void {
    if (!snapshot.models.some(model => model.id === modelId && model.supportsGeneration)) return;
    publish({ selectedModelId: modelId, catalogStatus: 'connected' });
  }
  async function translate(): Promise<void> {
    if (!dependencies.startTranslation || !session || !snapshot.chapter || !snapshot.selectedModelId || snapshot.translation.phase !== 'idle') return;
    const chapter = snapshot.chapter;
    const selectedModel: SelectedModel = { connection: snapshot.connection, modelId: snapshot.selectedModelId };
    publish({ translation: { phase: 'preparing', elapsedMs: 0 } });
    try { await dependencies.startTranslation(chapter, selectedModel, session); }
    catch { publish({ translation: { phase: 'failed', elapsedMs: 0, error: new ReaderError('connection') } }); }
  }
  function showContents(): void {
    if (!snapshot.work) return;
    navigate({ kind: 'work', workId: snapshot.work.workId, ...(snapshot.chapter ? { selectedChapterId: snapshot.chapter.chapterId } : {}) });
  }
  function adjacentChapter(direction: -1 | 1): void {
    if (!snapshot.work || !snapshot.chapter) return;
    const index = snapshot.work.chapters.findIndex(value => value.chapterId === snapshot.chapter?.chapterId);
    const target = snapshot.work.chapters[index + direction];
    if (target) void selectChapter(target);
  }
  function changeFontSize(fontSize: number): void {
    if (Number.isInteger(fontSize) && fontSize >= 10 && fontSize <= 48) publish({ fontSize });
  }
  async function savePosition(blockId: string, offset: number): Promise<void> {
    const version = snapshot.version;
    if (!dependencies.library || !version || !version.blocks.some(block => block.id === blockId) || !Number.isFinite(offset) || offset < 0) return;
    const position: ReadingPosition = { workId: version.source.workId, chapterId: version.source.chapterId, versionId: version.versionId, blockId, offset };
    positionsByVersion.set(version.versionId, position);
    publish({ position });
    try { await dependencies.library.savePosition(position); }
    catch { publish({ error: '읽던 위치를 저장하지 못했습니다.' }); }
  }
  function dispose(): void {
    disposed = true;
    sourceOperation++;
    selectionOperation++;
    catalogOperation++;
    sourceAbort?.abort();
    catalogAbort?.abort();
    listeners.clear();
  }
  return { getSnapshot: (): RenewalSnapshot => snapshot, subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }, initialize, navigate, back, openWork, selectChapter, continueReading, changeConnection, checkConnection, chooseModel, translate, showContents, adjacentChapter, changeFontSize, savePosition, showOriginal(showOriginal: boolean): void { publish({ showOriginal }); }, dispose };
}
export type RenewalController = ReturnType<typeof createRenewalController>;
