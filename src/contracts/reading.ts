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
  mode: 'segments-v1';
  segments: number;
};
export type SelectedModel = {
  connection: ConnectionConfig;
  modelId: string;
  limits?: LocalTranslationLimits;
};
export type TranslationToken = { requestId: string; chapterId: string; settingsRevision: number };
export type WholeChapterRequest = {
  token: TranslationToken;
  source: SourceSnapshot;
  languageDirection: 'ja-ko';
  contractVersion: 'plain-v1';
  promptVersion: 'hymt2-ko-v1' | 'hymt2-segments-v1';
  onProgress?: (completed: number, total: number) => void;
  /** 입력 하나에 대한 승인된 참고 데이터. 해당 입력의 지시문 앞에만 붙여 보낸다. */
  reference?: (input: string) => string;
};
export type WholeChapterResult = {
  text: string;
  finishReason: 'complete' | 'length' | 'blocked' | 'unknown';
  generation?: SegmentedGeneration;
};
export type TranslationBlock = { id: string; text: string }; // translated IDs, never source paragraph IDs
export type CompletedTranslation = {
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
  readWork(workId: string): Promise<readonly WorkPage[]>;
  listRecent(): Promise<
    readonly { workId: string; chapterId: string; versionId: string; updatedAt: string }[]
  >;
  listVersions(chapterId: string): Promise<readonly CompletedTranslation[]>;
  readVersion(versionId: string): Promise<CompletedTranslation | null>;
  commitVersion(value: CompletedTranslation): Promise<void>;
  savePosition(value: ReadingPosition): Promise<void>;
  readPosition(versionId: string): Promise<ReadingPosition | null>;
}

export type { ProviderId } from './index';
