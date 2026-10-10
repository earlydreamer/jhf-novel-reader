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
import {
  EmbeddingError,
  type EmbeddingStatus,
  type OnDeviceEmbedding,
} from '../platform/embedding';
import type {
  ChapterRef,
  ChapterRemovalResult,
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
  WorkRemovalResult,
} from '../contracts/reading';
import type { Route } from './routes';
import { limitsForModel } from '../translation/segments';
import type {
  BatchState,
  BatchTranslation,
  ChapterRange,
  CandidateChoice,
} from '../translation/batch';
import type {
  GuidanceDraft,
  GuidanceRepository,
  GuidanceTerm,
  WorkGuidance,
} from '../translation/guidance';
import {
  applySuggestion,
  removeCommonTerm,
  revertScanChange,
  type createRangeJudge,
  type createTermScan,
  type RangeJudgeResult,
  type TermScanProgress,
  type TermScanResult,
} from '../translation/termScanRun';
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
/** 연결 확인이 실패한 구체적인 이유. 화면 문구는 SettingsScreen이 정한다. */
export type CatalogProblemReason =
  | 'invalid_url' // 주소 형식 오류: 요청을 보내지 않음
  | 'network' // 서버에 닿지 못함(시간 초과·연결 거부·이름 해석 실패 등)
  | 'http' // 서버가 2xx가 아닌 상태로 응답
  | 'redirect' // 서버가 3xx로 다른 주소를 가리킴
  | 'auth_rejected' // 서버가 인증을 거부(401·403)
  | 'auth_missing' // 인증값이 없거나 형식이 잘못돼 요청 전에 막음
  | 'storage' // 보안 저장소 읽기·쓰기 실패
  | 'bad_response' // 응답이 모델 목록 형식이 아님
  | 'unknown';
export interface CatalogProblem {
  readonly reason: CatalogProblemReason;
  readonly httpStatus?: number;
}
export type ConnectionCheckResult =
  | {
      readonly kind: 'done';
      readonly status: CatalogStatus;
      readonly modelCount: number;
      readonly problem: CatalogProblem | null;
    }
  | { readonly kind: 'skipped'; readonly reason: 'busy' | 'not_ready' | 'unavailable' }
  | { readonly kind: 'superseded' };
export type SourceChangeStatus = 'idle' | 'checking' | 'unchanged' | 'changed' | 'unavailable';
export type WorkRecentSnapshot =
  | { workId: string; status: 'loading' }
  | { workId: string; status: 'none' | 'error' }
  | {
      workId: string;
      status: 'verified';
      chapterId: string;
      versionId: string;
      position: ReadingPosition | null;
    };
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
  readonly termScan?: ReturnType<typeof createTermScan>;
  /** 미리 번역 후보를 정밀스캔 판정으로 채우는 엔진. 저장하지 않고 결과만 돌려준다. */
  readonly rangeJudge?: ReturnType<typeof createRangeJudge>;
  /** 기기 안 용어 판정 모델. 네이티브 앱에서만 available이다. */
  readonly embedding?: OnDeviceEmbedding;
  /** 기기 판정 문이 바뀔 때 부른다. 토글이 켜져 있고 모델이 설치된 경우에만 true다. */
  readonly onTermDecisionChange?: (enabled: boolean) => void;
  readonly lifecycle?: AppLifecycle;
  readonly browse?: (startUrl?: string) => Promise<{ selectedUrl: string } | null>;
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
  readonly autoGlossary: boolean;
  /** 리더 용어 강조. 기본은 켜짐이다. */
  readonly termHighlight: boolean;
  readonly lookupWikipedia: boolean;
  readonly lookupNamuwiki: boolean;
  readonly embeddingAvailable: boolean;
  /** 토글은 설치된 모델이 있을 때만 켜진 상태로 남는다. */
  readonly onDeviceEmbedding: boolean;
  /** 상태를 읽기 전에는 null이다. */
  readonly embeddingModel: {
    installed: boolean;
    bytes: number;
    downloading: boolean;
    progress?: { received: number; total: number };
    error?: string;
  } | null;
  readonly paragraphRepair: boolean;
  readonly translationMode: 'stream' | 'legacy';
  readonly streamingAvailable: boolean;
  readonly legacyWarnings: readonly LegacyMigrationWarning[];
  /** 설정에서 빠진 제공자(Google Gemini)를 로컬 기본 연결로 되돌렸을 때 한 번 보여 주는 안내. */
  readonly settingsNotice: { id: number; text: string } | null;
  readonly route: Route;
  readonly work: WorkPage | null;
  readonly workRecent: WorkRecentSnapshot | null;
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
  readonly libraryWorks: readonly {
    work: WorkPage;
    savedChapterIds: readonly string[];
    recent: RenewalSnapshot['recent'][number] | null;
  }[];
  /** 첫 서재 목록을 읽었는지(성공·실패 모두). 그 전에는 빈 서재를 그리지 않는다. */
  readonly libraryLoaded: boolean;
  readonly connection: ConnectionConfig;
  readonly models: readonly ModelChoice[];
  readonly selectedModelId: string | null;
  readonly localLimits?: LocalTranslationLimits;
  readonly catalogStatus: CatalogStatus;
  readonly catalogProblem: CatalogProblem | null;
  readonly fontSize: number;
  readonly theme: ThemePreference;
  readonly readingBackground: ReadingBackground;
  readonly lineHeight: LineHeight;
  readonly showOriginal: boolean;
  readonly error: string | null;
  readonly errorRevision: number;
  readonly busy: boolean;
  readonly sourceAvailable: boolean;
  readonly connectionAvailable: boolean;
  readonly translationAvailable: boolean;
  readonly translationActive: boolean;
  readonly pendingSaveChapter: ChapterRef | null;
  readonly batch: BatchState | null;
  readonly batchAvailable: boolean;
  readonly guidanceAvailable: boolean;
  readonly termScanAvailable: boolean;
  readonly termScan: {
    workId: string;
    phase: 'running' | 'done' | 'failed' | 'cancelled';
    progress?: TermScanProgress;
    result?: TermScanResult;
    /** 결과 화면에서 이미 되돌리거나 적용한 항목(source) */
    handled: readonly string[];
    error?: string;
  } | null;
  readonly batchFillAvailable: boolean;
  /** 미리 번역 검토 후보를 정밀스캔으로 채우는 상태. recordId로 어느 기록의 결과인지 밝힌다. */
  readonly batchFill: {
    recordId: string;
    phase: 'running' | 'done' | 'failed' | 'cancelled';
    progress?: TermScanProgress;
    result?: RangeJudgeResult;
    error?: string;
  } | null;
}
const EMBEDDING_VERIFY_MESSAGE = '내려받은 판정 모델이 올바르지 않아 지웠어요. 다시 시도해 주세요.';
const EMBEDDING_NETWORK_MESSAGE =
  '판정 모델을 내려받지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
const EMBEDDING_REMOVE_MESSAGE = '판정 모델을 지우지 못했어요. 다시 시도해 주세요.';
/** 사용자가 중단했거나 끈 경우는 오류가 아니므로 undefined를 돌려준다. */
function embeddingFailure(error: unknown): string | undefined {
  if (error instanceof EmbeddingError) {
    if (error.code === 'cancelled') return undefined;
    if (error.code === 'verify') return EMBEDDING_VERIFY_MESSAGE;
  }
  return EMBEDDING_NETWORK_MESSAGE;
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
function problemOf(error: unknown): CatalogProblem {
  if (!(error instanceof ReaderError)) return { reason: 'unknown' };
  const httpStatus = error.status;
  switch (error.code) {
    case 'auth':
      return error.outcome === 'received'
        ? { reason: 'auth_rejected', ...(httpStatus ? { httpStatus } : {}) }
        : { reason: 'auth_missing' };
    case 'storage':
      return { reason: 'storage' };
    case 'timeout_unknown':
      return { reason: 'network' };
    case 'connection':
      if (error.outcome !== 'received')
        return { reason: error.outcome === 'unknown' ? 'network' : 'invalid_url' };
      // dispatch는 응답 주소가 요청과 다르면 2xx 상태 그대로 던진다. 리다이렉트로 분류한다.
      if (httpStatus && httpStatus >= 200 && httpStatus < 300) return { reason: 'redirect' };
      if (httpStatus && httpStatus >= 300 && httpStatus < 400)
        return { reason: 'redirect', httpStatus };
      return httpStatus ? { reason: 'http', httpStatus } : { reason: 'network' };
    case 'model_list':
    case 'invalid_output':
      return error.outcome === 'received' ? { reason: 'bad_response' } : { reason: 'unknown' };
    default:
      return { reason: 'unknown' };
  }
}
const TERM_SCAN_CONNECTION_MESSAGE =
  '연결 설정에서 서버와 모델을 확인하면 용어 정밀스캔을 할 수 있어요.';
const TERM_SCAN_GEMINI_MESSAGE = '용어 정밀스캔은 로컬 모델 연결에서만 쓸 수 있어요.';
const TERM_SCAN_BUSY_MESSAGE = '번역이 끝난 뒤 용어 정밀스캔을 시작할 수 있어요.';
const TERM_SCAN_SAVED_MESSAGE = '저장된 회차가 있어야 용어 정밀스캔을 할 수 있어요.';
const TERM_SCAN_FAILED_MESSAGE =
  '용어 정밀스캔을 마치지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
const TERM_SCAN_TRANSLATE_BLOCKED = '용어 정밀스캔이 끝난 뒤 번역할 수 있어요.';
const TERM_SCAN_EDIT_BUSY_MESSAGE = '번역이 끝난 뒤 용어집을 고칠 수 있어요.';
const TERM_SCAN_SAVE_FAILED_MESSAGE = '용어집을 저장하지 못했어요. 다시 시도해 주세요.';
const TERM_FILL_FAILED_MESSAGE =
  '정밀스캔으로 표기를 채우지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
const termKey = (source: string) => source.normalize('NFKC');

export interface RenewalController {
  translateTitles(key?: string): Promise<void>;
  saveTitle(key: string, target: string): Promise<void>;
  changeAutoTranslate(enabled: boolean): void;
  changeAutoRetryFailed(enabled: boolean): void;
  changeAutoGlossary(enabled: boolean): void;
  changeTermHighlight(enabled: boolean): void;
  changeLookupWikipedia(enabled: boolean): void;
  changeLookupNamuwiki(enabled: boolean): void;
  enableOnDeviceEmbedding(): Promise<void>;
  disableOnDeviceEmbedding(): Promise<void>;
  cancelEmbeddingDownload(): Promise<void>;
  removeEmbeddingModel(): Promise<void>;
  retryParagraphs(indexes?: readonly number[]): Promise<void>;
  previewPosition(index: number, offset: number): void;
  changeTranslationMode(mode: 'stream' | 'legacy'): void;
  getSnapshot(): RenewalSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  navigate(route: Route): void;
  back(): void;
  goHome(): void;
  removeWork(workId: string): Promise<WorkRemovalResult>;
  removeChapterVersions(chapter: ChapterRef): Promise<ChapterRemovalResult>;
  canGoBack(): boolean;
  browse(startUrl?: string): Promise<void>;
  cancelTranslation(): void;
  retrySave(): Promise<void>;
  openPendingSave(): void;
  openSavedTranslation(): Promise<void>;
  readerDisplayed(versionId: string): void;
  retryTranslation(): Promise<void>;
  openWork(url: string): Promise<void>;
  openLibraryWork(workId: string): Promise<void>;
  loadMoreWorkPage(): Promise<void>;
  selectChapter(chapter: ChapterRef): Promise<void>;
  continueReading(versionId: string): Promise<void>;
  continueReadingFromWork(workId: string): Promise<void>;
  retryWorkRecent(workId: string): Promise<void>;
  changeConnection(input: Omit<ConnectionConfig, 'revision' | 'authRef'>): void;
  checkConnection(secret?: string): Promise<ConnectionCheckResult>;
  chooseModel(modelId: string): void;
  prepareBatch(range: ChapterRange | null, retranslate: boolean): Promise<void>;
  runBatch(retryUncertain?: boolean): Promise<void>;
  scanBatch(): Promise<void>;
  confirmBatchCandidates(choices: readonly CandidateChoice[]): Promise<void>;
  fillBatchCandidates(): Promise<void>;
  cancelBatchFill(): void;
  cancelBatch(): void;
  retryBatchSave(): Promise<void>;
  openBatch(): void;
  readGuidance(workId: string): Promise<WorkGuidance | null>;
  saveGuidance(workId: string, draft: GuidanceDraft): Promise<WorkGuidance>;
  startTermScan(workId: string): Promise<void>;
  cancelTermScan(): void;
  revertTermScanChange(source: string): Promise<void>;
  applyTermScanSuggestion(source: string): Promise<void>;
  removeTermScanCommon(source: string): Promise<void>;
  closeTermScan(): void;
  translate(): Promise<void>;
  refreshSource(): Promise<void>;
  retranslateChapter(): Promise<void>;
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
  // 기기 판정 문의 마지막으로 알린 값. 초기값 false는 판정 문의 초기 상태와 같다.
  let termDecisionActive = false;
  // 설정 안내의 표시 id. 같은 문구를 다시 띄울 때는 id를 올려 구분한다.
  let settingsNoticeSequence = 0;
  let snapshot: RenewalSnapshot = {
    titles: [],
    titlesBusy: false,
    titlesError: null,
    titlesAvailable: Boolean(dependencies.titles),
    recentTitles: {},
    autoTranslate: true,
    autoRetryFailed: true,
    autoGlossary: true,
    termHighlight: true,
    lookupWikipedia: false,
    lookupNamuwiki: false,
    embeddingAvailable: dependencies.embedding?.available() ?? false,
    onDeviceEmbedding: false,
    embeddingModel: null,
    paragraphRepair: false,
    translationMode: dependencies.defaultTranslationMode ?? 'legacy',
    streamingAvailable: Boolean(dependencies.streamingAvailable),
    route: { kind: 'home' },
    legacyWarnings: [],
    settingsNotice: null,
    work: null,
    workRecent: null,
    savedChapterIds: [],
    chapter: null,
    version: null,
    position: null,
    sourceChange: 'idle',
    translation: { phase: 'idle', elapsedMs: 0 },
    translationTimings: null,
    recent: [],
    libraryWorks: [],
    libraryLoaded: !dependencies.library,
    connection: DEFAULT_CONNECTION,
    models: [],
    selectedModelId: null,
    catalogStatus: dependencies.connect || dependencies.catalog ? 'idle' : 'unavailable',
    catalogProblem: null,
    fontSize: 18,
    theme: 'system',
    readingBackground: 'theme',
    lineHeight: 1.8,
    showOriginal: false,
    error: null,
    errorRevision: 0,
    busy: false,
    sourceAvailable: Boolean(dependencies.source),
    connectionAvailable: Boolean(dependencies.connect || dependencies.catalog),
    translationAvailable: Boolean(dependencies.startTranslation || dependencies.flow),
    translationActive: false,
    pendingSaveChapter: null,
    batch: null,
    batchAvailable: Boolean(dependencies.batch),
    guidanceAvailable: Boolean(dependencies.guidance),
    termScanAvailable: Boolean(dependencies.termScan),
    termScan: null,
    batchFillAvailable: Boolean(dependencies.rangeJudge),
    batchFill: null,
  };
  const listeners = new Set<() => void>();
  const history: Route[] = [];
  const worksById = new Map<string, WorkPage>();
  const pagesByWorkId = new Map<string, Map<string, WorkPage>>();
  const chaptersById = new Map<string, ChapterRef>();
  const savedChaptersByWork = new Map<string, readonly string[]>();
  const versionsById = new Map<string, CompletedTranslation>();
  const positionsByVersion = new Map<string, ReadingPosition | null>();
  const removingWorkIds = new Set<string>();
  // 저장본 삭제 중인 회차. 삭제가 끝날 때까지 같은 회차의 위치 저장이 끼어들지 않게 막는다.
  const removingChapterIds = new Set<string>();
  const removedWorkIds = new Set<string>();
  const retiredBatchRecordIds = new Set<string>();
  const retiredCompletedVersionIds = new Set<string>();
  const removalGenerations = new Map<string, number>();
  const workRecentOperations = new Map<string, number>();
  const workRecentPromises = new Map<string, Promise<WorkRecentSnapshot>>();
  const workWriters = new Map<string, Set<Promise<unknown>>>();
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
      ...(snapshot.autoGlossary ? {} : { autoGlossary: false }),
      ...(snapshot.termHighlight ? {} : { termHighlight: false }),
      ...(snapshot.lookupWikipedia ? { lookupWikipedia: true } : {}),
      ...(snapshot.lookupNamuwiki ? { lookupNamuwiki: true } : {}),
      ...(snapshot.onDeviceEmbedding ? { onDeviceEmbedding: true } : {}),
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
          publish({ error: '설정을 저장하지 못했어요. 다시 시도해 주세요.' });
      });
  }
  let sourceOperation = 0;
  let libraryRefreshOperation = 0;
  let selectionOperation = 0;
  let catalogOperation = 0;
  let session: ProviderSession | null = null;
  let activeTranslation: ActiveTranslation | null = null;
  let livePosition: { chapterId: string; index: number; offset: number } | null = null;
  let catalogAbort: AbortController | null = null;
  let sourceAbort: AbortController | null = null;
  // 정밀스캔 진행 중이면 그 abort 컨트롤러가 있다. 시작 전 용어집 원본은 되돌리기에 쓴다(source NFKC → 항목).
  let termScanAbort: AbortController | null = null;
  // 스캔을 소유한 작품. 스냅샷은 running을 publish해야 갱신되므로 삭제 판정은 이 변수로 한다.
  let termScanOwner: string | null = null;
  let termScanOriginals = new Map<string, GuidanceTerm>();
  // 시작 전 연결 확인이 도는 동안 true다. 확인이 끝나기 전 두 번째 시작 요청을 막는다.
  let termScanChecking = false;
  // 미리 번역 준비 전 연결 확인이 도는 동안 true다. 확인이 끝나기 전 두 번째 준비 요청을 막는다.
  let batchChecking = false;
  let automaticRequest: { chapterId: string; operation: number } | null = null;
  let retryableRepair: ParagraphRepair | null = null;
  const titlesByWork = new Map<string, readonly SavedTitle[]>();
  const observedSavedVersionIds = new Set<string>();
  const titleAttempts = new Set<string>();
  let titleAbort: AbortController | null = null;
  let titleJob: Promise<void> | null = null;
  let titleSaveJob: Promise<void> | null = null;
  let titleWorkId: string | null = null;
  function trackWorkWrite<T>(workId: string, action: () => Promise<T>): Promise<T> {
    if (removingWorkIds.has(workId)) return Promise.reject(new ReaderError('storage'));
    let task: Promise<T>;
    try {
      task = action();
    } catch (error) {
      task = Promise.reject(error);
    }
    const writers = workWriters.get(workId) ?? new Set<Promise<unknown>>();
    writers.add(task);
    workWriters.set(workId, writers);
    void task
      .finally(() => {
        writers.delete(task);
        if (!writers.size) workWriters.delete(workId);
      })
      .catch(() => {});
    return task;
  }
  function removalGeneration(workId: string): number {
    return removalGenerations.get(workId) ?? 0;
  }
  function workIdFromUrl(value: string): string | null {
    try {
      const segment = new URL(value).pathname.split('/').filter(Boolean)[0] ?? '';
      return /^(n[0-9]{4}[a-z]{1,2})$/i.exec(segment)?.[1]?.toLowerCase() ?? null;
    } catch {
      return null;
    }
  }
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
    if (!dependencies.titles || removingWorkIds.has(workId)) return;
    const generation = removalGeneration(workId);
    try {
      const entries = await dependencies.titles.read(workId);
      const attempts = await dependencies.titles.readAttempts(workId);
      if (removingWorkIds.has(workId) || generation !== removalGeneration(workId)) return;
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
            ? '끝나지 않은 제목 번역이 있어요. 그 제목은 자동으로 다시 요청하지 않아요. 제목 옆에서 다시 번역할 수 있어요.'
            : null,
        });
      }
    } catch {
      if (removingWorkIds.has(workId) || generation !== removalGeneration(workId)) return;
      titlesByWork.delete(workId);
      if (snapshot.work?.workId === workId)
        publish({
          titles: [],
          titlesError: '저장한 제목을 읽지 못해서 제목 자동 번역을 멈췄어요.',
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
      removingWorkIds.has(snapshot.work.workId) ||
      titleJob ||
      titleSaveJob ||
      disposed ||
      !initialized ||
      !foreground ||
      snapshot.busy ||
      activeTranslation ||
      dependencies.flow?.active ||
      dependencies.batch?.active ||
      termScanRunning() ||
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
    titleWorkId = workId;
    const job = trackWorkWrite(workId, async () => {
      try {
        if (snapshot.catalogStatus === 'idle' && snapshot.selectedModelId) await checkConnection();
        if (control.signal.aborted || disposed) return;
        if (snapshot.catalogStatus !== 'connected' || !snapshot.selectedModelId) {
          if (!automatic)
            publish({ titlesError: '설정에서 서버를 연결하고 번역 모델을 골라 주세요.' });
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
                '일부 제목을 번역하지 못해 기존 제목을 그대로 두었어요. 제목 옆에서 다시 번역할 수 있어요.',
            });
        }
      } catch (error) {
        if (!control.signal.aborted && !disposed && snapshot.work?.workId === workId)
          publish({
            titlesError:
              error instanceof ReaderError && error.code === 'timeout_unknown'
                ? '제목 요청 결과를 확인하지 못했어요. 자동으로 다시 보내지 않아요. 제목 옆에서 다시 번역할 수 있어요.'
                : '제목을 번역하거나 저장하지 못해 기존 제목을 그대로 두었어요. 제목 옆에서 다시 번역할 수 있어요.',
          });
      }
    });
    titleJob = job;
    try {
      await job;
    } finally {
      if (titleJob === job) {
        titleJob = null;
        titleAbort = null;
        titleWorkId = null;
        publish({ titlesBusy: false });
        runAutomaticTranslation();
      }
    }
  }
  async function saveTitle(key: string, target: string): Promise<void> {
    const workId = snapshot.work?.workId;
    const input = titleInputs().find((input) => input.key === key);
    if (
      !dependencies.titles ||
      !workId ||
      !input ||
      disposed ||
      titleSaveJob ||
      removingWorkIds.has(workId)
    )
      throw new ReaderError('storage');
    titleAbort?.abort();
    const generation = titleJob;
    titleWorkId = workId;
    const job = trackWorkWrite(workId, async () => {
      await generation;
      const entries = await dependencies.titles!.save(workId, [
        { ...input, target: target.trim(), origin: 'user', updatedAt: new Date().toISOString() },
      ]);
      titlesByWork.set(workId, entries);
      if (snapshot.work?.workId === workId) publish({ titles: entries, titlesError: null });
    });
    titleSaveJob = job;
    try {
      await job;
    } finally {
      if (titleSaveJob === job) {
        titleSaveJob = null;
        titleWorkId = null;
      }
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
      termScanRunning() ||
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
      errorRevision:
        Object.hasOwn(update, 'error') && update.error
          ? snapshot.errorRevision + 1
          : snapshot.errorRevision,
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
    // 판정 문은 모든 상태 변경이 지나는 이 자리에서만 맞춘다. 값이 바뀔 때만 알린다.
    const termDecision = snapshot.onDeviceEmbedding && snapshot.embeddingModel?.installed === true;
    if (termDecision !== termDecisionActive) {
      termDecisionActive = termDecision;
      dependencies.onTermDecisionChange?.(termDecision);
    }
    listeners.forEach((listener) => listener());
  }
  const chapterLevel = (route: Route) => route.kind === 'translation' || route.kind === 'reader';
  // 회차 단위 경로가 속한 작품 id. 알 수 없으면 null이다.
  const workIdOf = (route: Route): string | null =>
    route.kind === 'translation'
      ? (chaptersById.get(route.chapterId)?.workId ?? null)
      : route.kind === 'reader'
        ? (versionsById.get(route.versionId)?.source.workId ?? null)
        : null;
  function navigate(route: Route): void {
    titleAbort?.abort();
    automaticRequest = null;
    sourceOperation++;
    selectionOperation++;
    sourceAbort?.abort();
    // 같은 작품 안의 회차끼리 이동(번역→리더, 이전·다음 화)은 쌓지 않는다. 뒤로 가기 한 번이면 회차에 들어오기 전 화면으로 간다.
    // 작품이 다르면 쌓아서 뒤로 가기가 원래 회차로 돌아오게 한다. 현재 작품은 스냅샷 대신 현재 경로로 판정한다(openPendingSave는 navigate 전에 chapter를 바꾼다).
    const currentWork = workIdOf(snapshot.route);
    const sameWorkChapterMove =
      chapterLevel(snapshot.route) &&
      chapterLevel(route) &&
      currentWork !== null &&
      currentWork === workIdOf(route);
    if (!sameWorkChapterMove) history.push(snapshot.route);
    publish({ route, showOriginal: false, error: null, busy: false });
    if (route.kind === 'home') void refreshLibrary();
    if (route.kind === 'work') void verifyWorkRecent(route.workId);
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
    if (route.kind === 'home') void refreshLibrary();
    publish({ route, showOriginal: false, error: null, busy: false });
    const settledToken = dependencies.flow?.getSnapshot().token;
    if (route.kind === 'translation' && settledToken?.chapterId === route.chapterId)
      showNonAdoptingOutcome(settledToken);
    requestAutomaticTranslation();
    if (route.kind === 'work') void verifyWorkRecent(route.workId);
    if (snapshot.work) publish({ titles: titlesByWork.get(snapshot.work.workId) ?? [] });
    requestTitleTranslation();
  }
  function goHome(): void {
    navigate({ kind: 'home' });
    history.length = 0;
  }
  function routeBelongsToWork(route: Route, workId: string): boolean {
    if (route.kind === 'work') return route.workId === workId;
    if (route.kind === 'translation') return route.chapterId.startsWith(`${workId}/`);
    if (route.kind === 'reader') return versionsById.get(route.versionId)?.source.workId === workId;
    return false;
  }
  async function removeWork(workId: string): Promise<WorkRemovalResult> {
    const library = dependencies.library;
    if (!library?.removeWork || disposed || removingWorkIds.has(workId))
      return { removed: false, cleanupComplete: false, remainingInventory: [] };
    const flowState = dependencies.flow?.getSnapshot();
    if (
      (activeTranslation?.chapterId.startsWith(`${workId}/`) ?? false) ||
      (flowState?.token?.chapterId.startsWith(`${workId}/`) && dependencies.flow?.active) ||
      // 정밀스캔이 저장하면 삭제 뒤 고아 파일이 남으므로 번역과 같이 막는다.
      (termScanRunning() && termScanOwner === workId)
    )
      return {
        removed: false,
        cleanupComplete: false,
        remainingInventory: [],
        blockedBy: 'translation',
      };
    const batchState = dependencies.batch?.getSnapshot();
    const batchRuntimeOwner = batchState?.preparing
      ? batchState.preparingWorkId
      : batchState?.active
        ? batchState.record?.work.workId
        : undefined;
    // 저장된 batch 기록은 실행 중이 아니면 막지 않는다. 실행 중인 owner만 막는다.
    if (
      batchState &&
      ((batchState.active && batchRuntimeOwner === workId) ||
        (batchState.preparing && batchState.preparingWorkId === workId))
    )
      return { removed: false, cleanupComplete: false, remainingInventory: [], blockedBy: 'batch' };

    removingWorkIds.add(workId);
    removalGenerations.set(workId, removalGeneration(workId) + 1);
    sourceOperation++;
    libraryRefreshOperation++;
    selectionOperation++;
    automaticRequest = null;
    if (routeBelongsToWork(snapshot.route, workId)) sourceAbort?.abort();
    if (titleWorkId === workId) {
      try {
        await stopTitles();
      } catch {
        // A failed title write is settled below; storage removal still owns the final cleanup.
      }
    }
    for (const [versionId, position] of pendingPositions)
      if (position.workId === workId) pendingPositions.delete(versionId);
    const activeWriters = [...(workWriters.get(workId) ?? [])];
    if (activeWriters.length) await Promise.allSettled(activeWriters);

    let result: WorkRemovalResult;
    try {
      result = await library.removeWork(workId, { activeBatchWorkId: batchRuntimeOwner });
    } catch {
      result = { removed: null, cleanupComplete: false, remainingInventory: ['library/index'] };
    }
    if (result.removed === false) {
      removingWorkIds.delete(workId);
      return result;
    }
    if (result.removed === true) {
      removedWorkIds.add(workId);
      if (batchState?.record?.work.workId === workId)
        retiredBatchRecordIds.add(batchState.record.id);
      const completedBeforeRemoval = dependencies.flow?.getCompleted();
      if (completedBeforeRemoval?.source.workId === workId)
        retiredCompletedVersionIds.add(completedBeforeRemoval.versionId);
      dependencies.flow?.clearWork(workId);
      dependencies.batch?.clearWork(workId);
      if (livePosition?.chapterId.startsWith(`${workId}/`)) livePosition = null;
      if (retryableRepair?.base.source.workId === workId) retryableRepair = null;
      const batchAfterRemoval = dependencies.batch?.getSnapshot() ?? snapshot.batch;
      const versionIds = [...versionsById]
        .filter(([, value]) => value.source.workId === workId)
        .map(([versionId]) => versionId);
      const removedVersionIds = new Set(versionIds);
      versionIds.forEach((versionId) => {
        versionsById.delete(versionId);
        positionsByVersion.delete(versionId);
        observedSavedVersionIds.delete(versionId);
      });
      worksById.delete(workId);
      pagesByWorkId.delete(workId);
      savedChaptersByWork.delete(workId);
      titlesByWork.delete(workId);
      for (const [chapterId, chapter] of chaptersById)
        if (chapter.workId === workId) chaptersById.delete(chapterId);
      for (const attempt of [...titleAttempts]) {
        try {
          if (JSON.parse(attempt)[0] === workId) titleAttempts.delete(attempt);
        } catch {
          titleAttempts.delete(attempt);
        }
      }
      for (let index = history.length - 1; index >= 0; index--) {
        const route = history[index]!;
        if (
          routeBelongsToWork(route, workId) ||
          (route.kind === 'reader' && removedVersionIds.has(route.versionId))
        )
          history.splice(index, 1);
      }
      if (result.cleanupComplete) removingWorkIds.delete(workId);
      publish({
        route: { kind: 'home' },
        work: null,
        chapter: null,
        version: null,
        position: null,
        titles: [],
        titlesBusy: false,
        titlesError: null,
        savedChapterIds: [],
        recent: snapshot.recent.filter((entry) => entry.workId !== workId),
        libraryWorks: snapshot.libraryWorks.filter((entry) => entry.work.workId !== workId),
        batch: batchAfterRemoval,
        translation: { phase: 'idle', elapsedMs: 0 },
        translationTimings: null,
        sourceChange: 'idle',
        showOriginal: false,
        paragraphRepair: false,
        busy: false,
        translationActive: false,
        pendingSaveChapter: null,
        // 제거 결과 안내는 Application의 스낵바가 맡는다. 여기서 error로 또 알리면 두 번 뜬다.
        error: null,
      });
      if (result.cleanupComplete) void refreshLibrary();
      return result;
    }
    return result;
  }
  async function removeChapterVersions(chapter: ChapterRef): Promise<ChapterRemovalResult> {
    const { chapterId, workId } = chapter;
    const library = dependencies.library;
    const refused = (blockedBy?: ChapterRemovalResult['blockedBy']): ChapterRemovalResult => ({
      removed: false,
      cleanupComplete: false,
      remainingInventory: [],
      versionIds: [],
      ...(blockedBy ? { blockedBy } : {}),
    });
    if (
      !library?.removeChapterVersions ||
      disposed ||
      removingWorkIds.has(workId) ||
      removingChapterIds.has(chapterId)
    )
      return refused();
    const flowState = dependencies.flow?.getSnapshot();
    if (
      activeTranslation?.chapterId === chapterId ||
      (flowState?.token?.chapterId === chapterId && dependencies.flow?.active)
    )
      return refused('translation');
    const batchState = dependencies.batch?.getSnapshot();
    const batchRuntimeOwner = batchState?.preparing
      ? batchState.preparingWorkId
      : batchState?.active
        ? batchState.record?.work.workId
        : undefined;
    // 저장된 batch 기록은 실행 중이 아니면 막지 않는다. 실행 중인 owner만 막는다.
    if (
      batchState &&
      ((batchState.active && batchRuntimeOwner === workId) ||
        (batchState.preparing && batchState.preparingWorkId === workId))
    )
      return refused('batch');

    removingChapterIds.add(chapterId);
    try {
      for (const [versionId, position] of pendingPositions)
        if (position.chapterId === chapterId) pendingPositions.delete(versionId);
      const activeWriters = [...(workWriters.get(workId) ?? [])];
      if (activeWriters.length) await Promise.allSettled(activeWriters);

      let result: ChapterRemovalResult;
      try {
        result = await library.removeChapterVersions(chapterId, {
          activeBatchWorkId: batchRuntimeOwner,
        });
      } catch {
        result = {
          removed: null,
          cleanupComplete: false,
          remainingInventory: ['library/index'],
          versionIds: [],
        };
      }
      if (result.removed !== true) return result;

      // 저장소가 색인에서 뺀 저장본과 메모리에 남은 같은 회차 저장본을 함께 지운다.
      const removedVersionIds = new Set(result.versionIds);
      for (const [versionId, value] of versionsById)
        if (value.source.chapterId === chapterId) removedVersionIds.add(versionId);
      removedVersionIds.forEach((versionId) => {
        versionsById.delete(versionId);
        positionsByVersion.delete(versionId);
        observedSavedVersionIds.delete(versionId);
      });
      const completedBeforeRemoval = dependencies.flow?.getCompleted();
      if (completedBeforeRemoval?.source.chapterId === chapterId)
        retiredCompletedVersionIds.add(completedBeforeRemoval.versionId);
      dependencies.flow?.clearChapter(chapterId);
      if (livePosition?.chapterId === chapterId) livePosition = null;
      if (retryableRepair?.base.source.chapterId === chapterId) retryableRepair = null;
      for (let index = history.length - 1; index >= 0; index--) {
        const route = history[index]!;
        if (route.kind === 'reader' && removedVersionIds.has(route.versionId))
          history.splice(index, 1);
      }
      const savedChapterIds = (savedChaptersByWork.get(workId) ?? []).filter(
        (id) => id !== chapterId,
      );
      savedChaptersByWork.set(workId, savedChapterIds);
      const showing = snapshot.version?.source.chapterId === chapterId;
      publish({
        ...(snapshot.work?.workId === workId ? { savedChapterIds } : {}),
        ...(showing ? { version: null, position: null } : {}),
        recent: snapshot.recent.filter((entry) => !removedVersionIds.has(entry.versionId)),
        libraryWorks: snapshot.libraryWorks.map((entry) =>
          entry.work.workId === workId
            ? {
                ...entry,
                savedChapterIds: entry.savedChapterIds.filter((id) => id !== chapterId),
                recent:
                  entry.recent && removedVersionIds.has(entry.recent.versionId)
                    ? null
                    : entry.recent,
              }
            : entry,
        ),
      });
      if (snapshot.route.kind === 'work' && snapshot.route.workId === workId)
        void verifyWorkRecent(workId);
      void refreshLibrary();
      return result;
    } finally {
      removingChapterIds.delete(chapterId);
    }
  }
  function canGoBack(): boolean {
    return history.length > 0;
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
            if (!active) termScanAbort?.abort();
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
        // Gemini 제공자는 정식판 설정에서 빠졌다(#280). 예전에 골라 둔 저장 상태는 로컬 기본 연결로 되돌린다.
        // Gemini로 번역해 둔 저장본은 그대로 두고, 이 선택만 초기화한다.
        const hiddenProvider = saved?.selection?.connection.provider === 'gemini';
        if (saved)
          publish({
            connection: hiddenProvider
              ? DEFAULT_CONNECTION
              : saved.selection?.connection ?? DEFAULT_CONNECTION,
            selectedModelId: hiddenProvider ? null : saved.selection?.modelId ?? null,
            translationMode: hiddenProvider
              ? dependencies.defaultTranslationMode ?? 'legacy'
              : saved.selection?.translationMode ?? dependencies.defaultTranslationMode ?? 'legacy',
            localLimits: undefined,
            fontSize: saved.fontSize,
            theme: saved.theme ?? 'system',
            readingBackground: saved.readingBackground ?? 'theme',
            lineHeight: saved.lineHeight ?? 1.8,
            autoTranslate: saved.autoTranslate ?? true,
            autoRetryFailed: saved.autoRetryFailed ?? saved.selection?.autoRetryFailed ?? true,
            autoGlossary: saved.autoGlossary ?? true,
            termHighlight: saved.termHighlight ?? true,
            lookupWikipedia: saved.lookupWikipedia ?? false,
            lookupNamuwiki: saved.lookupNamuwiki ?? false,
            onDeviceEmbedding: saved.onDeviceEmbedding ?? false,
            ...(hiddenProvider
              ? {
                  settingsNotice: {
                    id: ++settingsNoticeSequence,
                    text: 'Google Gemini 제공자가 설정에서 빠져서 로컬 서버 연결로 되돌렸어요. 번역 서버 주소를 확인해 주세요.',
                  },
                }
              : {}),
          });
        initialized = true;
        // 되돌린 선택을 저장해 두어 다음 시작에는 안내가 다시 나오지 않는다.
        if (hiddenProvider) persistSettings();
        void restoreOnDeviceEmbedding();
        runAutomaticTranslation();
      } catch {
        foreground = false;
        dependencies.flow?.setForeground(false);
        dependencies.batch?.setForeground(false);
        publish({
          error: '저장된 기록이나 요청 상태를 확인하지 못해 새 번역을 막았어요.',
        });
      } finally {
        // Saved reading does not depend on lifecycle, settings or request recovery.
        if (!disposed && dependencies.library) await refreshLibrary();
      }
    })();
    return initialization;
  }

  async function browse(startUrl?: string): Promise<void> {
    if (snapshot.busy || disposed) return;
    const expectedWorkId = startUrl ? workIdFromUrl(startUrl) : null;
    const expectedGeneration = expectedWorkId ? removalGeneration(expectedWorkId) : null;
    if (expectedWorkId && removingWorkIds.has(expectedWorkId)) return;
    if (!dependencies.browse) {
      publish({ error: '작품 찾기를 아직 사용할 수 없어요. URL로 열어 주세요.' });
      return;
    }
    const operation = ++sourceOperation;
    publish({ busy: true, error: null });
    try {
      const result = await dependencies.browse(startUrl);
      if (disposed || operation !== sourceOperation) return;
      if (
        expectedWorkId &&
        (removingWorkIds.has(expectedWorkId) ||
          expectedGeneration !== removalGeneration(expectedWorkId))
      )
        return;
      publish({ busy: false });
      if (result) await openWork(result.selectedUrl);
    } catch (error) {
      if (operation === sourceOperation)
        publish({
          busy: false,
          error:
            error instanceof ReaderError && error.code === 'source_access'
              ? '원문 탐색을 사용할 수 없어요. URL로 열어 주세요.'
              : '앱 내 원문 탐색을 열지 못했어요.',
        });
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
  async function refreshLibrary(): Promise<void> {
    const library = dependencies.library;
    if (!library || disposed) return;
    const operation = ++libraryRefreshOperation;
    let workIds: readonly string[];
    let recent: Awaited<ReturnType<LibraryStore['listRecent']>>;
    try {
      [workIds, recent] = await Promise.all([library.listWorkIds(), library.listRecent()]);
    } catch {
      if (!disposed && operation === libraryRefreshOperation)
        publish({
          error: '서재 목록을 불러오지 못했어요. 다시 열어 주세요.',
          ...(snapshot.libraryLoaded ? {} : { libraryLoaded: true }),
        });
      return;
    }
    if (disposed || operation !== libraryRefreshOperation) return;
    publish({ recent });

    const previous = new Map(snapshot.libraryWorks.map((entry) => [entry.work.workId, entry]));
    const rows = new Map<string, RenewalSnapshot['libraryWorks'][number]>();
    let hadWorkReadFailure = false;
    for (const workId of workIds) {
      if (removingWorkIds.has(workId)) continue;
      try {
        const pages = await library.readWork(workId);
        if (removingWorkIds.has(workId) || disposed || operation !== libraryRefreshOperation)
          return;
        if (!pages.length) throw new Error('Empty cached work');
        let merged: WorkPage | null = null;
        for (const page of pages) merged = rememberWorkPage(page);
        if (!merged) continue;
        const savedChapterIds = await readSavedChapterIds(merged.chapters);
        if (removingWorkIds.has(workId) || disposed || operation !== libraryRefreshOperation)
          return;
        savedChaptersByWork.set(workId, savedChapterIds);
        await loadTitles(workId);
        if (disposed || operation !== libraryRefreshOperation) return;
        rows.set(workId, {
          work: merged,
          savedChapterIds,
          recent: recent.find((entry) => entry.workId === workId) ?? null,
        });
      } catch {
        hadWorkReadFailure = true;
        const prior = previous.get(workId);
        if (prior)
          rows.set(workId, {
            ...prior,
            recent: recent.find((entry) => entry.workId === workId) ?? prior.recent,
          });
      }
    }
    if (disposed || operation !== libraryRefreshOperation) return;
    const registrationRank = new Map(workIds.map((id, index) => [id, index]));
    const recentRank = new Map(recent.map((entry, index) => [entry.workId, index]));
    const libraryWorks = [...rows.values()].sort((left, right) => {
      const leftRecent = recentRank.get(left.work.workId);
      const rightRecent = recentRank.get(right.work.workId);
      if (leftRecent !== undefined && rightRecent !== undefined) return leftRecent - rightRecent;
      if (leftRecent !== undefined) return -1;
      if (rightRecent !== undefined) return 1;
      return (
        (registrationRank.get(right.work.workId) ?? -1) -
        (registrationRank.get(left.work.workId) ?? -1)
      );
    });
    publish({
      recent,
      libraryWorks,
      ...(snapshot.libraryLoaded ? {} : { libraryLoaded: true }),
    });
    if (hadWorkReadFailure) {
      publish({ error: '일부 작품 정보를 불러오지 못했어요.' });
    }
  }
  function verifyWorkRecent(workId: string): Promise<WorkRecentSnapshot> {
    const operation = (workRecentOperations.get(workId) ?? 0) + 1;
    workRecentOperations.set(workId, operation);
    const generation = removalGeneration(workId);
    const selectionAtStart = selectionOperation;
    const isCurrent = () =>
      !disposed &&
      operation === workRecentOperations.get(workId) &&
      generation === removalGeneration(workId) &&
      selectionAtStart === selectionOperation &&
      snapshot.route.kind === 'work' &&
      snapshot.route.workId === workId;
    const promise = (async (): Promise<WorkRecentSnapshot> => {
      const loading: WorkRecentSnapshot = { workId, status: 'loading' };
      if (isCurrent()) publish({ workRecent: loading });
      try {
        if (!dependencies.library) {
          const none: WorkRecentSnapshot = { workId, status: 'none' };
          if (isCurrent()) publish({ workRecent: none });
          return none;
        }
        const recentEntries = await dependencies.library.listRecent();
        if (!isCurrent()) return loading;
        const recent = recentEntries.find((entry) => entry.workId === workId);
        if (!recent) {
          const none: WorkRecentSnapshot = { workId, status: 'none' };
          if (isCurrent()) publish({ workRecent: none });
          return none;
        }
        const version = await dependencies.library.readVersion(recent.versionId);
        if (!isCurrent()) return loading;
        if (!version) {
          const none: WorkRecentSnapshot = { workId, status: 'none' };
          if (isCurrent()) publish({ workRecent: none });
          return none;
        }
        if (
          version.versionId !== recent.versionId ||
          version.source.workId !== workId ||
          version.source.chapterId !== recent.chapterId
        ) {
          const none: WorkRecentSnapshot = { workId, status: 'none' };
          if (isCurrent()) publish({ workRecent: none });
          return none;
        }
        const position = await dependencies.library.readPosition(version.versionId);
        if (!isCurrent()) return loading;
        if (
          position &&
          (position.workId !== workId ||
            position.chapterId !== recent.chapterId ||
            position.versionId !== version.versionId ||
            !version.blocks.some((block) => block.id === position.blockId))
        )
          throw new ReaderError('storage');
        if (!isCurrent()) return loading;
        const verified: WorkRecentSnapshot = {
          workId,
          status: 'verified',
          chapterId: recent.chapterId,
          versionId: recent.versionId,
          position,
        };
        if (isCurrent()) publish({ workRecent: verified, recent: recentEntries });
        return verified;
      } catch {
        const error: WorkRecentSnapshot = { workId, status: 'error' };
        if (isCurrent()) publish({ workRecent: error });
        return error;
      }
    })();
    workRecentPromises.set(workId, promise);
    return promise;
  }
  async function openCachedWork(workId: string): Promise<void> {
    const library = dependencies.library;
    if (
      !library ||
      snapshot.busy ||
      disposed ||
      removingWorkIds.has(workId) ||
      removedWorkIds.has(workId)
    )
      return;
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    publish({ busy: true, error: null });
    try {
      const pages = await library.readWork(workId);
      if (disposed || operation !== sourceOperation) return;
      if (!pages.length) throw new ReaderError('storage');
      let work: WorkPage | null = null;
      for (const page of pages) work = rememberWorkPage(page);
      if (!work) throw new ReaderError('storage');
      const savedChapterIds = await readSavedChapterIds(work.chapters);
      if (disposed || operation !== sourceOperation) return;
      savedChaptersByWork.set(workId, savedChapterIds);
      publish({ work, savedChapterIds, busy: false });
      navigate({ kind: 'work', workId });
      await loadTitles(workId);
      requestTitleTranslation();
    } catch {
      if (!disposed && operation === sourceOperation)
        publish({ busy: false, error: '저장된 목차를 열지 못했어요.' });
    }
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
      !removingWorkIds.has(chaptersById.get(request.chapterId)?.workId ?? '') &&
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
      // 번역 입력(URL·본문 문단·루비)을 나타내는 해시만 비교한다. 페이지 HTML 전체는 광고·스크립트 등 본문 밖 요소로 매번 달라질 수 있다(#157).
      const changed = current.sourceHash !== version.source.sourceHash;
      publish({ sourceChange: changed ? 'changed' : 'unchanged' });
    } catch {
      if (operation === sourceOperation && !disposed) publish({ sourceChange: 'unavailable' });
    } finally {
      if (sourceAbort === control) sourceAbort = null;
    }
  }
  async function openWork(url: string): Promise<void> {
    if (!dependencies.source) {
      publish({ error: '원문 탐색 연결이 없어요. URL로 작품을 열어 주세요.' });
      return;
    }
    try {
      url = dependencies.normalizeInput?.(url) ?? url;
    } catch {
      publish({ error: '지원하는 작품 또는 회차 주소를 입력해 주세요.' });
      return;
    }
    const expectedWorkId = workIdFromUrl(url);
    const expectedGeneration = expectedWorkId ? removalGeneration(expectedWorkId) : null;
    if (expectedWorkId && removingWorkIds.has(expectedWorkId)) return;
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    publish({ busy: true, error: null });
    try {
      const page = await dependencies.source.getWorkPage(url, sourceAbort.signal);
      if (operation !== sourceOperation || disposed) return;
      if (
        removingWorkIds.has(page.workId) ||
        (expectedWorkId === page.workId && expectedGeneration !== removalGeneration(page.workId))
      )
        return;
      if (dependencies.library) await dependencies.library.saveWorkPage(page);
      const newlySavedChapterIds = await readSavedChapterIds(page.chapters);
      if (
        operation !== sourceOperation ||
        disposed ||
        removingWorkIds.has(page.workId) ||
        (expectedWorkId === page.workId && expectedGeneration !== removalGeneration(page.workId))
      )
        return;
      const work = rememberWorkPage(page);
      removedWorkIds.delete(page.workId);
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
          error: '작품 제목과 목차를 불러오지 못했어요. 원문 주소를 확인하고 다시 시도해 주세요.',
        });
    }
  }
  async function loadMoreWorkPage(): Promise<void> {
    const work = snapshot.work;
    const nextPageUrl = work?.nextPageUrl;
    if (
      !dependencies.source ||
      !work ||
      !nextPageUrl ||
      snapshot.busy ||
      disposed ||
      removingWorkIds.has(work.workId)
    )
      return;
    const generation = removalGeneration(work.workId);
    const operation = ++sourceOperation;
    sourceAbort?.abort();
    sourceAbort = new AbortController();
    publish({ busy: true, error: null });
    try {
      const page = await dependencies.source.getWorkPage(nextPageUrl, sourceAbort.signal);
      if (
        operation !== sourceOperation ||
        disposed ||
        removingWorkIds.has(work.workId) ||
        generation !== removalGeneration(work.workId)
      )
        return;
      if (dependencies.library) await dependencies.library.saveWorkPage(page);
      const newlySavedChapterIds = await readSavedChapterIds(page.chapters);
      if (
        operation !== sourceOperation ||
        disposed ||
        removingWorkIds.has(work.workId) ||
        generation !== removalGeneration(work.workId)
      )
        return;
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
        publish({
          busy: false,
          error: '다음 목차 페이지를 불러오지 못했어요. 다시 시도해 주세요.',
        });
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
    if (removingWorkIds.has(chapter.workId)) return;
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
      if (operation !== selectionOperation || disposed || removingWorkIds.has(chapter.workId))
        return;
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
          error: '저장된 번역을 불러오지 못했어요. 새 번역은 자동으로 요청하지 않아요.',
        });
    }
  }
  async function continueReading(versionId: string): Promise<void> {
    if (!dependencies.library) return;
    const operation = ++selectionOperation;
    try {
      const version = await dependencies.library.readVersion(versionId);
      if (!version) {
        if (operation !== selectionOperation || disposed) return;
        publish({ error: '저장된 번역을 찾지 못했어요.' });
        return;
      }
      if (operation !== selectionOperation || disposed) return;
      const workId = version.source.workId;
      const generation = removalGeneration(workId);
      if (removingWorkIds.has(workId) || removedWorkIds.has(workId)) return;
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
      if (
        operation !== selectionOperation ||
        disposed ||
        removingWorkIds.has(workId) ||
        generation !== removalGeneration(workId)
      )
        return;
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
      if (operation === selectionOperation && !disposed)
        publish({ error: '저장된 번역을 불러오지 못했어요.' });
    }
  }
  async function continueReadingFromWork(workId: string): Promise<void> {
    const library = dependencies.library;
    const work = snapshot.work?.workId === workId ? snapshot.work : worksById.get(workId);
    if (!library || !work || removingWorkIds.has(workId) || removedWorkIds.has(workId)) return;
    const routeAtStart = snapshot.route;
    const routeKeyAtStart = JSON.stringify(routeAtStart);
    const selectionAtStart = selectionOperation;
    const generation = removalGeneration(workId);
    const current = () =>
      !disposed &&
      !removingWorkIds.has(workId) &&
      generation === removalGeneration(workId) &&
      selectionAtStart === selectionOperation &&
      JSON.stringify(snapshot.route) === routeKeyAtStart;
    const showError = () => {
      if (current())
        publish({
          workRecent: { workId, status: 'error' },
          error: '최근 읽은 번역을 확인하지 못했어요. 다시 시도해 주세요.',
        });
    };
    try {
      let recent = snapshot.workRecent?.workId === workId ? snapshot.workRecent : null;
      if (!recent || recent.status === 'loading')
        recent = await (workRecentPromises.get(workId) ?? verifyWorkRecent(workId));
      if (!current()) return;
      const fallback = async () => {
        const chapters = work.chapters;
        const first = [...chapters].sort((a, b) => a.ordinal - b.ordinal)[0];
        if (!first) {
          if (current()) publish({ error: '목차에서 읽을 회차를 찾지 못했어요.' });
          return;
        }
        if (current()) await selectChapter(first);
      };
      if (recent.status === 'error') {
        showError();
        return;
      }
      if (recent.status === 'none') {
        await fallback();
        return;
      }
      if (recent.status !== 'verified') return;
      const version = await library.readVersion(recent.versionId);
      if (!current()) return;
      if (
        !version ||
        version.versionId !== recent.versionId ||
        version.source.workId !== workId ||
        version.source.chapterId !== recent.chapterId
      ) {
        await fallback();
        return;
      }
      const position = await library.readPosition(recent.versionId);
      if (
        position &&
        (position.workId !== workId ||
          position.chapterId !== recent.chapterId ||
          position.versionId !== version.versionId ||
          !version.blocks.some((block) => block.id === position.blockId))
      )
        throw new ReaderError('storage');
      const pages = (await library.readWork(workId)).filter((page) => page.workId === workId);
      const chapter =
        pages
          .flatMap((page) => page.chapters)
          .find((entry) => entry.workId === workId && entry.chapterId === recent.chapterId) ??
        work.chapters.find(
          (entry) => entry.workId === workId && entry.chapterId === recent.chapterId,
        ) ??
        null;
      if (!chapter) throw new ReaderError('storage');
      const savedChapterIds = await readSavedChapterIds(pages.flatMap((page) => page.chapters));
      if (!current()) return;
      for (const page of pages) rememberWorkPage(page);
      savedChaptersByWork.set(workId, savedChapterIds);
      versionsById.set(version.versionId, version);
      positionsByVersion.set(version.versionId, position);
      publish({ work, chapter, version, position, savedChapterIds });
      navigate({ kind: 'reader', versionId: version.versionId });
      void loadTitles(workId);
      void checkSourceChange(version, chapter);
      if (snapshot.catalogStatus === 'connected') requestTitleTranslation();
    } catch {
      showError();
    }
  }
  async function retryWorkRecent(workId: string): Promise<void> {
    if (
      snapshot.route.kind !== 'work' ||
      snapshot.route.workId !== workId ||
      removingWorkIds.has(workId)
    )
      return;
    await verifyWorkRecent(workId);
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
      catalogProblem: null,
      localLimits: undefined,
    });
    persistSettings();
  }
  async function checkConnection(secret = ''): Promise<ConnectionCheckResult> {
    if (!dependencies.connect && !dependencies.catalog)
      return { kind: 'skipped', reason: 'unavailable' };
    if (disposed || !initialized) return { kind: 'skipped', reason: 'not_ready' };
    if (dependencies.batch?.active) return { kind: 'skipped', reason: 'busy' };
    const operation = ++catalogOperation;
    catalogAbort?.abort();
    catalogAbort = new AbortController();
    const previousModelId = snapshot.selectedModelId;
    session = null;
    publish({
      catalogStatus: 'checking',
      catalogProblem: null,
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
      if (operation !== catalogOperation || disposed) return { kind: 'superseded' };
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
        catalogProblem: null,
      });
      persistSettings();
      runAutomaticTranslation();
      return {
        kind: 'done',
        status: catalogStatus,
        modelCount: models.filter((model) => model.supportsGeneration).length,
        problem: null,
      };
    } catch (error) {
      if (operation !== catalogOperation) return { kind: 'superseded' };
      session = null;
      const status = errorLabel(error);
      const problem = problemOf(error);
      publish({
        catalogStatus: status,
        catalogProblem: problem,
        models: [],
        selectedModelId: previousModelId,
        localLimits: undefined,
      });
      return { kind: 'done', status, modelCount: 0, problem };
    }
  }
  function chooseModel(modelId: string): void {
    if (modelId === snapshot.selectedModelId) return;
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
          error: '이 모델의 입력 한도로 번역을 준비할 수 없어요. 다른 모델을 선택해 주세요.',
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
  // 저장된 회차를 통째로 다시 번역한다(#197). 용어집을 고친 뒤 쓰는 경로. 기존 저장본은 남긴다.
  async function retranslateChapter(): Promise<void> {
    const chapter = snapshot.chapter;
    if (snapshot.route.kind !== 'reader' || !chapter) return;
    await refreshSource();
    await translate();
  }
  function termScanRunning(): boolean {
    return termScanAbort !== null;
  }
  /** 용어 정밀스캔 시작. 조건이 안 맞으면 안내만 띄우고, 번역과 같은 요청이라 한 번에 하나만 돈다. */
  async function startTermScan(workId: string): Promise<void> {
    const scan = dependencies.termScan;
    if (!scan || disposed || !initialized || !foreground || removingWorkIds.has(workId)) return;
    // 연결 확인 중에 온 두 번째 요청은 확인이 끝날 때까지 기다리지 않고 조용히 끝낸다.
    if (termScanChecking) return;
    termScanChecking = true;
    try {
      if (snapshot.catalogStatus === 'idle' && snapshot.selectedModelId) await checkConnection();
    } finally {
      termScanChecking = false;
    }
    if (disposed || !foreground) return;
    if (snapshot.catalogStatus !== 'connected' || !snapshot.selectedModelId) {
      publish({ error: TERM_SCAN_CONNECTION_MESSAGE });
      return;
    }
    if (snapshot.connection.provider !== 'openai-compatible') {
      publish({ error: TERM_SCAN_GEMINI_MESSAGE });
      return;
    }
    if (
      termScanRunning() ||
      activeTranslation ||
      dependencies.flow?.active ||
      dependencies.batch?.active
    ) {
      publish({ error: TERM_SCAN_BUSY_MESSAGE });
      return;
    }
    const chapterIds = savedChaptersByWork.get(workId) ?? [];
    if (!chapterIds.length) {
      publish({ error: TERM_SCAN_SAVED_MESSAGE });
      return;
    }
    const selection: SelectedModel = {
      connection: snapshot.connection,
      modelId: snapshot.selectedModelId,
      translationMode: snapshot.translationMode,
      ...(snapshot.autoRetryFailed ? {} : { autoRetryFailed: false }),
      ...(snapshot.connection.provider === 'openai-compatible' && snapshot.localLimits
        ? { limits: { ...snapshot.localLimits } }
        : {}),
    };
    // 첫 await 전에 세워 둬야 두 번째 시작 요청이 진행 중으로 보고 막힌다.
    const control = new AbortController();
    termScanAbort = control;
    termScanOwner = workId;
    try {
      await stopTitles();
      const current = (await dependencies.guidance?.read(workId))?.terms ?? [];
      termScanOriginals = new Map(current.map((item) => [termKey(item.source), item]));
      publish({ error: null, termScan: { workId, phase: 'running', handled: [] } });
      const result = await scan({
        workId,
        chapterIds,
        selection,
        sources: { wikipedia: snapshot.lookupWikipedia, namuwiki: snapshot.lookupNamuwiki },
        signal: control.signal,
        onProgress(progress) {
          const running = snapshot.termScan;
          if (control.signal.aborted || termScanAbort !== control) return;
          if (!running || running.workId !== workId) return;
          publish({ termScan: { ...running, progress } });
        },
      });
      publish({ termScan: { workId, phase: 'done', result, handled: [] } });
    } catch (error) {
      const cancelled =
        control.signal.aborted || (error instanceof ReaderError && error.code === 'cancelled');
      publish({
        termScan: cancelled
          ? { workId, phase: 'cancelled', handled: [] }
          : { workId, phase: 'failed', handled: [], error: TERM_SCAN_FAILED_MESSAGE },
      });
    } finally {
      if (termScanAbort === control) {
        termScanAbort = null;
        termScanOwner = null;
      }
      // 스캔 중 미뤄 둔 자동 번역과 제목 번역을 이어 간다. 스캔이 바꾼 용어집을 쓰게 된다.
      runAutomaticTranslation();
      requestTitleTranslation();
    }
  }
  function cancelTermScan(): void {
    termScanAbort?.abort();
  }
  /**
   * 미리 번역 검토 후보의 표기를 정밀스캔 판정으로 채운다. 용어집에는 저장하지 않고 검토 화면에 제안으로만 남긴다.
   * 정밀스캔과 같은 잠금을 써서 진행 중에는 번역·미리 번역·정밀스캔·작품 삭제가 막힌다.
   */
  async function fillBatchCandidates(): Promise<void> {
    const judge = dependencies.rangeJudge;
    if (!judge || disposed || !initialized || !foreground) return;
    // 연결 확인 중에 온 요청은 확인이 끝날 때까지 기다리지 않고 조용히 끝낸다.
    if (termScanChecking) return;
    termScanChecking = true;
    try {
      if (snapshot.catalogStatus === 'idle' && snapshot.selectedModelId) await checkConnection();
    } finally {
      termScanChecking = false;
    }
    if (disposed || !foreground) return;
    if (snapshot.catalogStatus !== 'connected' || !snapshot.selectedModelId) {
      publish({ error: TERM_SCAN_CONNECTION_MESSAGE });
      return;
    }
    if (snapshot.connection.provider !== 'openai-compatible') {
      publish({ error: TERM_SCAN_GEMINI_MESSAGE });
      return;
    }
    const batch = dependencies.batch;
    if (!batch) return;
    if (termScanRunning() || activeTranslation || dependencies.flow?.active || batch.active) {
      publish({ error: TERM_SCAN_BUSY_MESSAGE });
      return;
    }
    const record = snapshot.batch?.record;
    const candidates = record?.scan?.candidates ?? [];
    if (
      !record ||
      record.phase !== 'prepared' ||
      record.scan?.status !== 'review' ||
      !candidates.length ||
      removingWorkIds.has(record.work.workId)
    )
      return;
    const workId = record.work.workId;
    const recordId = record.id;
    const selection: SelectedModel = {
      connection: snapshot.connection,
      modelId: snapshot.selectedModelId,
      translationMode: snapshot.translationMode,
      ...(snapshot.autoRetryFailed ? {} : { autoRetryFailed: false }),
      ...(snapshot.connection.provider === 'openai-compatible' && snapshot.localLimits
        ? { limits: { ...snapshot.localLimits } }
        : {}),
    };
    // 첫 await 전에 세워 둬야 두 번째 요청이 진행 중으로 보고 막힌다.
    const control = new AbortController();
    termScanAbort = control;
    termScanOwner = workId;
    try {
      await stopTitles();
      publish({ batchFill: { recordId, phase: 'running' } });
      const chapters = await batch.scanChapters(control.signal, (done, total) => {
        if (control.signal.aborted || termScanAbort !== control) return;
        publish({
          batchFill: { recordId, phase: 'running', progress: { stage: 'collect', done, total } },
        });
      });
      const result = await judge({
        workId,
        chapters,
        names: candidates.map((candidate) => candidate.source),
        selection,
        signal: control.signal,
        sources: { wikipedia: snapshot.lookupWikipedia, namuwiki: snapshot.lookupNamuwiki },
        onProgress(progress) {
          const running = snapshot.batchFill;
          if (control.signal.aborted || termScanAbort !== control) return;
          if (running?.recordId !== recordId || running.phase !== 'running') return;
          publish({ batchFill: { ...running, progress } });
        },
      });
      // 취소 뒤에 끝난 결과는 버리고 취소로 남긴다.
      if (control.signal.aborted) throw new ReaderError('cancelled');
      publish({ batchFill: { recordId, phase: 'done', result } });
    } catch (error) {
      const cancelledByUser =
        control.signal.aborted || (error instanceof ReaderError && error.code === 'cancelled');
      publish({
        batchFill: cancelledByUser
          ? { recordId, phase: 'cancelled' }
          : { recordId, phase: 'failed', error: TERM_FILL_FAILED_MESSAGE },
      });
    } finally {
      if (termScanAbort === control) {
        termScanAbort = null;
        termScanOwner = null;
      }
      // 채우기 중 미뤄 둔 자동 번역과 제목 번역을 이어 간다.
      runAutomaticTranslation();
      requestTitleTranslation();
    }
  }
  function cancelBatchFill(): void {
    if (snapshot.batchFill?.phase === 'running') termScanAbort?.abort();
  }
  function closeTermScan(): void {
    if (termScanRunning()) return;
    termScanOriginals = new Map();
    publish({ termScan: null });
  }
  /** 용어집을 최신 저장본 기준으로 고쳐 저장한다. 바뀐 것이 없으면 저장하지 않는다. */
  async function editTermScanTerms(
    workId: string,
    edit: (terms: readonly GuidanceTerm[]) => GuidanceTerm[],
  ): Promise<boolean> {
    const guidance = dependencies.guidance;
    if (!guidance || disposed || removingWorkIds.has(workId)) return false;
    if (activeTranslation || dependencies.flow?.active || dependencies.batch?.active) {
      publish({ error: TERM_SCAN_EDIT_BUSY_MESSAGE });
      return false;
    }
    try {
      await trackWorkWrite(workId, async () => {
        const latest = await guidance.read(workId);
        const terms = latest?.terms ?? [];
        const next = edit(terms);
        const changed =
          next.length !== terms.length || next.some((item, index) => item !== terms[index]);
        if (!changed) return;
        await guidance.save(workId, {
          terms: next,
          voices: latest?.voices ?? [],
          ...(latest?.plotSummary !== undefined ? { plotSummary: latest.plotSummary } : {}),
        });
      });
      return true;
    } catch {
      publish({ error: TERM_SCAN_SAVE_FAILED_MESSAGE });
      return false;
    }
  }
  function markTermScanHandled(
    scan: NonNullable<RenewalSnapshot['termScan']>,
    source: string,
  ): void {
    const current = snapshot.termScan;
    // 결과가 그새 닫히거나 다른 스캔으로 바뀌었으면 기록하지 않는다.
    if (!current || current.phase !== 'done' || current.result !== scan.result) return;
    if (current.handled.includes(source)) return;
    publish({ termScan: { ...current, handled: [...current.handled, source] } });
  }
  async function revertTermScanChange(source: string): Promise<void> {
    const scan = snapshot.termScan;
    if (scan?.phase !== 'done' || !scan.result) return;
    const change = scan.result.applied.find((item) => termKey(item.source) === termKey(source));
    if (!change || scan.handled.includes(change.source)) return;
    const original = termScanOriginals.get(termKey(change.source));
    const saved = await editTermScanTerms(scan.workId, (terms) =>
      revertScanChange(terms, change, original),
    );
    if (saved) markTermScanHandled(scan, change.source);
  }
  async function applyTermScanSuggestion(source: string): Promise<void> {
    const scan = snapshot.termScan;
    if (scan?.phase !== 'done' || !scan.result) return;
    const change = scan.result.suggestions.find((item) => termKey(item.source) === termKey(source));
    if (!change || scan.handled.includes(change.source)) return;
    const saved = await editTermScanTerms(scan.workId, (terms) => applySuggestion(terms, change));
    if (saved) markTermScanHandled(scan, change.source);
  }
  async function removeTermScanCommon(source: string): Promise<void> {
    const scan = snapshot.termScan;
    if (scan?.phase !== 'done' || !scan.result) return;
    const item = scan.result.removable?.find((entry) => termKey(entry.source) === termKey(source));
    if (!item || scan.handled.includes(item.source)) return;
    const saved = await editTermScanTerms(scan.workId, (terms) =>
      removeCommonTerm(terms, item.source),
    );
    if (saved) markTermScanHandled(scan, item.source);
  }
  async function translate(repair?: ParagraphRepair): Promise<void> {
    if (termScanRunning()) {
      publish({ error: TERM_SCAN_TRANSLATE_BLOCKED });
      return;
    }
    const intendedChapter = snapshot.chapter?.chapterId;
    const intendedWorkId = intendedChapter ? chaptersById.get(intendedChapter)?.workId : undefined;
    const intendedOperation = selectionOperation;
    if (intendedWorkId && removingWorkIds.has(intendedWorkId)) return;
    if (titleJob || titleSaveJob) await stopTitles();
    if (
      intendedOperation !== selectionOperation ||
      intendedChapter !== snapshot.chapter?.chapterId ||
      (intendedWorkId && removingWorkIds.has(intendedWorkId))
    )
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
      (intendedWorkId !== undefined && removingWorkIds.has(intendedWorkId)) ||
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
          // 일괄 번역은 자체 후보 스캔을 쓰므로 여기서 켜지 않는다. 문단 재번역도 용어집을 만들지 않는다.
          { autoGlossary: snapshot.autoGlossary && !repair },
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
    request: Pick<ActiveTranslation, 'chapterId' | 'settingsRevision'> & { cancelled?: boolean },
  ) {
    if (
      snapshot.route.kind !== 'translation' ||
      snapshot.chapter?.chapterId !== request.chapterId ||
      !dependencies.flow
    )
      return;
    const state = dependencies.flow.getSnapshot();
    if (['ready', 'failed', 'unknown'].includes(state.phase)) {
      // 사용자가 중단했거나 앱이 백그라운드로 가서 멈춘 결과는 리더의 중단 안내로 충분하므로 스낵바를 띄우지 않는다(#164).
      if (request.cancelled || state.error?.code === 'cancelled') {
        publish({ translation: state });
        return;
      }
      publish({
        translation: state,
        error: '이전 요청 결과는 자동으로 열지 않아요. 저장본을 열거나 다시 시도해 주세요.',
      });
    }
  }
  function updateSavedMetadata(value: CompletedTranslation) {
    const workId = value.source.workId;
    if (
      removedWorkIds.has(workId) ||
      removingWorkIds.has(workId) ||
      retiredCompletedVersionIds.has(value.versionId)
    )
      return;
    const ids = [...new Set([...(savedChaptersByWork.get(workId) ?? []), value.source.chapterId])];
    savedChaptersByWork.set(workId, ids);
    if (snapshot.work?.workId === workId) publish({ savedChapterIds: ids });
    const alreadyObserved = observedSavedVersionIds.has(value.versionId);
    observedSavedVersionIds.add(value.versionId);
    if (!alreadyObserved && snapshot.route.kind === 'home') {
      const recentEntry = {
        workId,
        chapterId: value.source.chapterId,
        versionId: value.versionId,
        updatedAt: value.createdAt,
      };
      const recent = [
        recentEntry,
        ...snapshot.recent.filter((entry) => entry.versionId !== value.versionId),
      ];
      publish({
        recent,
        libraryWorks: snapshot.libraryWorks.map((entry) =>
          entry.work.workId === workId
            ? { ...entry, savedChapterIds: ids, recent: recentEntry }
            : entry,
        ),
      });
      void refreshLibrary();
    }
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
    ) {
      // 용어집 실패 알림은 같은 번역에서 상태가 처음 failed로 바뀔 때 한 번만 낸다(#192).
      const glossaryFailedNow =
        state.glossary === 'failed' && snapshot.translation.glossary !== 'failed';
      publish({ translation: state });
      if (glossaryFailedNow) publish({ error: '용어집을 만들지 못해 그대로 번역해요.' });
    }
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
        error: '문단 재번역은 원문과 문단이 맞는 로컬 번역본에서만 쓸 수 있어요.',
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
      publish({
        error: '문단을 다시 번역하려면 연결 설정에서 서버와 생성 모델을 먼저 확인해 주세요.',
      });
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
      publish({ error: '기기에 저장하지 못했어요.' });
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
      publish({ error: '로컬 모델 연결을 확인한 뒤 문단 재번역을 다시 시도할 수 있어요.' });
      return;
    }
    publish({ translation: { phase: 'idle', elapsedMs: 0 } });
    await translate(repair);
  }
  function showContents(): void {
    if (!snapshot.work) return;
    const workId = snapshot.work.workId;
    const selected = snapshot.chapter ? { selectedChapterId: snapshot.chapter.chapterId } : {};
    const previous = history[history.length - 1];
    if (previous?.kind === 'work' && previous.workId === workId) {
      // 이미 쌓인 같은 작품 목차로 돌아간다. 목차-리더 왕복으로 스택이 자라지 않게 한다.
      history[history.length - 1] = { kind: 'work', workId, ...selected };
      back();
      return;
    }
    navigate({ kind: 'work', workId, ...selected });
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
      removingWorkIds.has(version.source.workId) ||
      removingChapterIds.has(version.source.chapterId) ||
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
          if (removingWorkIds.has(next.workId) || removingChapterIds.has(next.chapterId)) continue;
          try {
            await trackWorkWrite(next.workId, () => dependencies.library!.savePosition(next));
          } catch {
            publish({ error: '읽던 위치를 저장하지 못했어요.' });
          }
        }
      })().finally(() => {
        positionDrain = null;
      });
    await positionDrain;
    if (dependencies.library && !disposed && !removingWorkIds.has(position.workId)) {
      try {
        publish({ recent: await dependencies.library.listRecent() });
      } catch {
        // 읽기 위치 저장은 성공했으므로 보조 최근 목록 새로 고침 실패로 reject하지 않는다.
        publish({ error: '최근 읽은 목록을 새로 고치지 못했어요.' });
      }
    }
  }
  async function prepareBatch(range: ChapterRange | null, retranslate: boolean): Promise<void> {
    // 앱을 켠 직후에는 저장된 모델로 먼저 연결을 확인한다. 확인 중 두 번째 요청은 조용히 끝낸다.
    if (batchChecking) return;
    const needsCheck =
      !!dependencies.batch &&
      !!snapshot.work &&
      initialized &&
      foreground &&
      !disposed &&
      snapshot.catalogStatus === 'idle' &&
      !!snapshot.selectedModelId;
    if (needsCheck) {
      batchChecking = true;
      try {
        await checkConnection();
      } finally {
        batchChecking = false;
      }
      if (disposed || !foreground) return;
      if (snapshot.catalogStatus !== 'connected' || !snapshot.selectedModelId) {
        publish({ error: '설정에서 서버를 연결하고 번역 모델을 골라 주세요.' });
        return;
      }
    }
    if (
      !dependencies.batch ||
      !snapshot.work ||
      !snapshot.selectedModelId ||
      snapshot.catalogStatus !== 'connected' ||
      activeTranslation ||
      termScanRunning() ||
      !initialized ||
      !foreground ||
      disposed ||
      removingWorkIds.has(snapshot.work.workId)
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
    if (termScanRunning()) {
      publish({ error: TERM_SCAN_TRANSLATE_BLOCKED });
      return;
    }
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
        error: '연결이나 모델 설정이 바뀌었어요. 번역 범위를 다시 확인해 주세요.',
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
        error: '연결이나 모델 설정이 바뀌었어요. 번역 범위를 다시 확인해 주세요.',
      });
      return;
    }
    await dependencies.batch?.scan();
  }
  async function confirmBatchCandidates(choices: readonly CandidateChoice[]): Promise<void> {
    if (!initialized || disposed || !foreground || activeTranslation) return;
    if (!batchSelectionIsCurrent()) {
      publish({
        error: '연결이나 모델 설정이 바뀌었어요. 번역 범위를 다시 확인해 주세요.',
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
      if (
        retiredBatchRecordIds.has(record.id) ||
        removedWorkIds.has(record.work.workId) ||
        removingWorkIds.has(record.work.workId)
      )
        return;
      worksById.set(record.work.workId, record.work);
      record.work.chapters.forEach((chapter) => chaptersById.set(chapter.chapterId, chapter));
      if (snapshot.work?.workId === record.work.workId) publish({ work: record.work });
      const completed = dependencies.flow?.getCompleted();
      if (completed) updateSavedMetadata(completed);
    }
    publish({ batch, translationActive: batch.active || activeTranslation !== null });
  });
  // 기기 판정 모델. 켜기·끄기·지우기가 겹치면 가장 나중 요청이 이기도록 operation 번호로 확인한다.
  let embeddingOperation = 0;
  function publishEmbedding(update: Partial<NonNullable<RenewalSnapshot['embeddingModel']>>): void {
    const current = snapshot.embeddingModel ?? { installed: false, bytes: 0, downloading: false };
    publish({ embeddingModel: { ...current, ...update } });
  }
  async function refreshEmbeddingModel(): Promise<EmbeddingStatus | null> {
    const port = dependencies.embedding;
    if (!port || disposed) return null;
    try {
      const status = await port.status();
      if (!disposed)
        publishEmbedding({
          installed: status.installed,
          bytes: status.bytes,
          downloading: status.downloading,
        });
      return status;
    } catch {
      return null;
    }
  }
  async function restoreOnDeviceEmbedding(): Promise<void> {
    const status = await refreshEmbeddingModel();
    // 상태를 읽지 못했으면 저장된 값을 그대로 두고, 미설치가 확인됐을 때만 토글을 바로잡는다.
    if (disposed || !status || status.installed || !snapshot.onDeviceEmbedding) return;
    publish({ onDeviceEmbedding: false });
    persistSettings();
  }
  async function enableOnDeviceEmbedding(): Promise<void> {
    const port = dependencies.embedding;
    if (!port || !snapshot.embeddingAvailable || disposed) return;
    const operation = ++embeddingOperation;
    const status = await refreshEmbeddingModel();
    if (disposed || operation !== embeddingOperation) return;
    if (status?.installed) {
      publish({ onDeviceEmbedding: true });
      persistSettings();
      return;
    }
    publishEmbedding({ downloading: true, progress: undefined, error: undefined });
    try {
      await port.download((received, total) => {
        if (operation === embeddingOperation && !disposed)
          publishEmbedding({ progress: { received, total } });
      });
    } catch (error) {
      if (!disposed)
        publishEmbedding({
          downloading: false,
          progress: undefined,
          error: operation === embeddingOperation ? embeddingFailure(error) : undefined,
        });
      await refreshEmbeddingModel();
      return;
    }
    if (disposed) return;
    publishEmbedding({ downloading: false, progress: undefined, error: undefined });
    // 받는 도중 끄거나 지웠다면 받은 파일은 두고 토글은 켜지 않는다.
    if (operation === embeddingOperation) {
      publish({ onDeviceEmbedding: true });
      persistSettings();
    }
    await refreshEmbeddingModel();
  }
  async function disableOnDeviceEmbedding(): Promise<void> {
    embeddingOperation++;
    publish({ onDeviceEmbedding: false });
    persistSettings();
    const port = dependencies.embedding;
    if (!port || disposed) return;
    // 파일은 지우지 않는다. 받는 중이면 내려받기만 멈추고 메모리의 모델만 내린다.
    if (snapshot.embeddingModel?.downloading) await port.cancelDownload().catch(() => {});
    await port.unload().catch(() => {});
  }
  async function cancelEmbeddingDownload(): Promise<void> {
    await dependencies.embedding?.cancelDownload().catch(() => {});
  }
  async function removeEmbeddingModel(): Promise<void> {
    const port = dependencies.embedding;
    if (!port || disposed) return;
    embeddingOperation++;
    try {
      await port.remove();
    } catch {
      publishEmbedding({ error: EMBEDDING_REMOVE_MESSAGE });
      await refreshEmbeddingModel();
      return;
    }
    publish({ onDeviceEmbedding: false });
    persistSettings();
    publishEmbedding({ error: undefined });
    await refreshEmbeddingModel();
  }
  function dispose(): void {
    titleAbort?.abort();
    termScanAbort?.abort();
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
    changeAutoGlossary(enabled) {
      publish({ autoGlossary: enabled });
      persistSettings();
    },
    changeTermHighlight(enabled) {
      publish({ termHighlight: enabled });
      persistSettings();
    },
    changeLookupWikipedia(enabled) {
      publish({ lookupWikipedia: enabled });
      persistSettings();
    },
    changeLookupNamuwiki(enabled) {
      publish({ lookupNamuwiki: enabled });
      persistSettings();
    },
    enableOnDeviceEmbedding,
    disableOnDeviceEmbedding,
    cancelEmbeddingDownload,
    removeEmbeddingModel,
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
        mode === snapshot.translationMode ||
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
    goHome,
    removeWork,
    removeChapterVersions,
    canGoBack,
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
      if (
        value &&
        !retiredCompletedVersionIds.has(value.versionId) &&
        value.source.chapterId === snapshot.chapter?.chapterId
      ) {
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
    openLibraryWork: openCachedWork,
    loadMoreWorkPage,
    selectChapter,
    continueReading,
    continueReadingFromWork,
    retryWorkRecent,
    changeConnection,
    checkConnection,
    chooseModel,
    prepareBatch,
    scanBatch,
    confirmBatchCandidates,
    fillBatchCandidates,
    cancelBatchFill,
    runBatch,
    cancelBatch: () => dependencies.batch?.cancel(),
    retryBatchSave,
    openBatch,
    startTermScan,
    cancelTermScan,
    revertTermScanChange,
    applyTermScanSuggestion,
    removeTermScanCommon,
    closeTermScan,
    readGuidance: async (workId) => (await dependencies.guidance?.read(workId)) ?? null,
    async saveGuidance(workId, draft) {
      if (
        !dependencies.guidance ||
        removingWorkIds.has(workId) ||
        disposed ||
        !initialized ||
        !foreground ||
        snapshot.work?.workId !== workId ||
        activeTranslation ||
        dependencies.batch?.active ||
        dependencies.flow?.active
      )
        throw new ReaderError('storage');
      return trackWorkWrite(workId, () => dependencies.guidance!.save(workId, draft));
    },
    translate,
    refreshSource,
    retranslateChapter,
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
