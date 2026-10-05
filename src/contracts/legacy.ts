import type { Chapter, Paragraph, ProviderId, ReaderError, ErrorCode } from './index';
export interface ProviderConfig {
  readonly provider: ProviderId;
  readonly baseUrl: string;
  readonly model: string;
  readonly authRef?: string;
  readonly contextBudget: number;
  readonly outputBudget: number;
  readonly settingsRevision: number;
}
export interface JobToken {
  readonly jobId: string;
  readonly chapterId: string;
  readonly settingsRevision: number;
}
export interface ChunkRequest {
  readonly token: JobToken;
  readonly chunkId: string;
  /** Read-only surrounding context, never duplicated into the output. */
  readonly context: readonly Paragraph[];
  /** Ordered source segments requested for translation, with stable segment IDs. */
  readonly paragraphs: readonly Paragraph[];
  readonly outputIds: readonly string[];
  readonly languageDirection: 'ja-ko';
  readonly promptVersion: string;
}
export type FinishReason = 'complete' | 'length' | 'blocked' | 'unknown';
export interface TranslatedParagraph {
  readonly id: string;
  readonly text: string;
}
export interface ChunkResult {
  readonly chunkId: string;
  readonly paragraphs: readonly TranslatedParagraph[];
  readonly finishReason: FinishReason;
}
export interface TranslationProvider {
  translateChunk(request: ChunkRequest, signal: AbortSignal): Promise<ChunkResult>;
}
export interface CacheIdentity {
  readonly canonicalUrl: string;
  readonly sourceHash: string;
  readonly provider: ProviderId;
  readonly normalizedEndpoint: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly languageDirection: 'ja-ko';
}
export interface ReadPosition {
  readonly chapterId: string;
  readonly paragraphId: string;
  readonly offset: number;
}
export interface ValidatedChunk {
  readonly chunkId: string;
  readonly paragraphs: readonly TranslatedParagraph[];
  readonly validated: true;
}
export interface Checkpoint {
  readonly schemaVersion: 1;
  readonly cacheKey: string;
  readonly identity: CacheIdentity;
  readonly token: JobToken;
  readonly chapter: Chapter;
  readonly chunks: readonly ValidatedChunk[];
}
export interface CompletedChapter {
  readonly schemaVersion: 1;
  readonly cacheKey: string;
  readonly identity: CacheIdentity;
  readonly source: Chapter;
  readonly paragraphs: readonly TranslatedParagraph[];
  readonly completedAt: string;
}
export interface StoredReaderData {
  readonly chapter: CompletedChapter | null;
  readonly checkpoint: Checkpoint | null;
  readonly position: ReadPosition | null;
}
export interface ReaderStore {
  read(key: string): Promise<StoredReaderData | null>;
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  commitChapter(chapter: CompletedChapter): Promise<void>;
  savePosition(position: ReadPosition): Promise<void>;
}

export type JobPhase =
  | 'idle'
  | 'preparing'
  | 'translating'
  | 'validating'
  | 'saving'
  | 'ready'
  | 'failed'
  | 'unknown'
  | 'paused';
export interface JobState {
  readonly phase: JobPhase;
  readonly token?: JobToken;
  readonly completedChunks: number;
  readonly totalChunks: number;
  readonly error?: ReaderError;
}
export interface ReaderPreferences {
  readonly fontSize: number;
  readonly prefetchEnabled: boolean;
}
export const DEFAULT_PREFERENCES: ReaderPreferences = Object.freeze({
  fontSize: 18,
  prefetchEnabled: false,
});
export interface ReaderViewState {
  readonly job: JobState;
  readonly chapter: CompletedChapter | null;
  readonly position: ReadPosition | null;
  readonly preferences: ReaderPreferences;
  readonly showOriginal: boolean;
}
export interface ReaderActions {
  onOpen(url: string): void;
  onCancel(): void;
  onRetry(): void;
  onResume(): void;
  onNavigate(url: string): void;
  onShowOriginal(show: boolean): void;
  onFontSize(size: number): void;
  onPosition(position: ReadPosition): void;
}
export interface SettingsViewState {
  readonly config: ProviderConfig;
  readonly preferences: ReaderPreferences;
  readonly secretStatus: 'unset' | 'saved' | 'saving' | 'error';
  readonly error?: ErrorCode;
}
export interface SettingsActions {
  /** Controller owns incrementing settingsRevision, invalidating stale work. */
  onConfigChange(config: Omit<ProviderConfig, 'settingsRevision'>): void;
  /** Ephemeral password input only: never place secret in settings snapshots. */
  onSaveSecret(secret: string): Promise<void>;
  onRemoveSecret(): Promise<void>;
  onPrefetchChange(enabled: boolean): void;
}

export function isCurrentJob(a: JobToken, b: JobToken): boolean {
  return (
    a.jobId === b.jobId && a.chapterId === b.chapterId && a.settingsRevision === b.settingsRevision
  );
}

/** Callers normalize the endpoint; secret/authRef is deliberately excluded. */
export async function createCacheKey(input: CacheIdentity): Promise<string> {
  return (
    'v1-' +
    (await sha256([
      input.canonicalUrl,
      input.sourceHash,
      input.provider,
      input.normalizedEndpoint,
      input.model,
      input.promptVersion,
      input.languageDirection,
    ]))
  );
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
