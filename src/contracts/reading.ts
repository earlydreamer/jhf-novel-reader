import type { Chapter, ProviderId, ReaderError } from './index';

export type ChapterRef = {
  workId: string;
  chapterId: string;
  canonicalUrl: string;
  title: string;
  ordinal: number;
};
export type WorkPage = {
  workId: string;
  canonicalUrl: string;
  title: string;
  chapters: readonly ChapterRef[];
  pageUrl: string;
  nextPageUrl: string | null;
  complete: boolean;
};
export type SourceSnapshot = Chapter &
  (
    | { captureKind: 'fetched'; fetchedAt: string; rawHtml: string }
    | { captureKind: 'legacy-import'; fetchedAt: null; rawHtml: null }
  );

export type ConnectionConfig = {
  provider: ProviderId;
  baseUrl: string;
  authRef?: string;
  revision: number;
};
export type ModelChoice = {
  id: string;
  displayName: string;
  supportsGeneration: boolean;
  contextTokens?: number;
};
export type LocalTranslationLimits = {
  contextTokens: number;
  inputBudgetTokens: number;
  maxOutputTokens: number;
};
export type SegmentedGeneration = LocalTranslationLimits & {
  /** segments-v1은 이전 평문 구간 저장본, lines-v1은 줄 ID 방식이다. */
  mode: 'segments-v1' | 'lines-v1' | 'colomo-local-v1';
  segments: number;
  /** lines-v1에서 완료되지 않은 줄을 이어 보낸 횟수. */
  continuations?: number;
  /** 이전 저장본은 없을 수 있다. 실행에 실제 사용한 입력 추정 방식. */
  estimator?: 'utf8-v1' | 'gemma-e4b-v1';
};
export type SelectedModel = {
  connection: ConnectionConfig;
  modelId: string;
  limits?: LocalTranslationLimits;
  translationMode?: 'stream' | 'legacy';
  autoRetryFailed?: boolean;
};
export type TranslationToken = { requestId: string; chapterId: string; settingsRevision: number };
export type WholeChapterRequest = {
  token: TranslationToken;
  source: SourceSnapshot;
  languageDirection: 'ja-ko';
  contractVersion: 'plain-v1';
  promptVersion: 'hymt2-ko-v1' | 'hymt2-segments-v1' | 'lines-v1' | 'colomo-local-v1';
  onProgress?: (completed: number, total: number) => void;
  /** 저장 전 미리보기: 지금까지 완료된 문단을 원문 순서로 조립한 텍스트. */
  onPreview?: (text: string) => void;
  /** 입력 하나에 대한 승인된 참고 데이터. 해당 입력의 지시문 앞에만 붙여 보낸다. */
  reference?: (input: string) => string;
  lockedTerms?: (input: string) => readonly { source: string; target: string }[];
  plotSummary?: string;
};
export type WholeChapterResult = {
  text: string;
  finishReason: 'complete' | 'length' | 'blocked' | 'unknown';
  generation?: SegmentedGeneration;
  failedParagraphs?: readonly number[];
};
export type TranslationBlock = { id: string; text: string }; // translated IDs, never source paragraph IDs
export type TranslationQuality = {
  readonly ruleVersion: 'deterministic-v1';
  readonly japaneseBlocks: readonly number[];
  readonly missingTerms: readonly { source: string; target: string }[];
};
export type CompletedTranslation = {
  failedParagraphs?: readonly number[];
  readonly quality?: TranslationQuality;
  schemaVersion: 2;
  versionId: string;
  source: SourceSnapshot;
  text: string;
  blocks: readonly TranslationBlock[];
  createdAt: string;
  provenance: {
    provider: ProviderId;
    connectionId: string;
    modelId: string;
    contractVersion: string;
    promptVersion: string;
    languageDirection: 'ja-ko';
    generation?: SegmentedGeneration;
    guidanceHash?: string;
    repair?: { baseVersionId: string; paragraphIndexes: readonly number[] };
  };
};
export type ReadingPosition = {
  workId: string;
  chapterId: string;
  versionId: string;
  blockId: string;
  /** Visual distance in CSS pixels from the saved block, not a character index. */
  offset: number;
};
export type TranslationPhase =
  'idle' | 'preparing' | 'translating' | 'validating' | 'saving' | 'ready' | 'failed' | 'unknown';
export type TranslationState = {
  phase: TranslationPhase;
  token?: TranslationToken;
  elapsedMs: number;
  error?: ReaderError;
  pendingSave?: CompletedTranslation;
  progress?: { completed: number; total: number };
  /** 번역 중에만 보여 주는 저장 전 미리보기. 저장 기준은 완성본이다. */
  preview?: string;
};
export interface RenewalSource {
  getWorkPage(url: string, signal: AbortSignal): Promise<WorkPage>;
  getChapter(ref: ChapterRef, signal: AbortSignal): Promise<SourceSnapshot>;
}
export interface ProviderSession {
  listModels(signal: AbortSignal): Promise<readonly ModelChoice[]>;
  translateChapter(request: WholeChapterRequest, signal: AbortSignal): Promise<WholeChapterResult>;
}
export interface LibraryStore {
  saveWorkPage(page: WorkPage): Promise<void>;
  listWorkIds(): Promise<readonly string[]>;
  readWork(workId: string): Promise<readonly WorkPage[]>;
  listRecent(): Promise<
    readonly { workId: string; chapterId: string; versionId: string; updatedAt: string }[]
  >;
  listVersions(chapterId: string): Promise<readonly CompletedTranslation[]>;
  readVersion(versionId: string): Promise<CompletedTranslation | null>;
  commitVersion(value: CompletedTranslation): Promise<void>;
  savePosition(value: ReadingPosition): Promise<void>;
  readPosition(versionId: string): Promise<ReadingPosition | null>;
  readRemovalInventory?(): Promise<readonly WorkRemovalInventory[]>;
  isWorkRemovalPending?(workId: string): Promise<boolean>;
  removeWork?(workId: string, runtime?: { activeBatchWorkId?: string }): Promise<WorkRemovalResult>;
  removeChapterVersions?(
    chapterId: string,
    runtime?: { activeBatchWorkId?: string },
  ): Promise<ChapterRemovalResult>;
}
export interface WorkRemovalInventory {
  workId: string;
  cacheKeys: string[];
  paths: string[];
  createdAt: string;
  pointerCacheKey?: string;
  issues?: string[];
}
export interface WorkRemovalResult {
  removed: boolean | null;
  cleanupComplete: boolean;
  remainingInventory: readonly string[];
  blockedBy?: 'translation' | 'batch';
}
export interface ChapterRemovalResult extends WorkRemovalResult {
  /** 색인에서 뺀 저장본 ID. removed가 true가 아니면 빈 배열이다. */
  versionIds: readonly string[];
}

export type { ProviderId } from './index';
