/** Shared module boundary. No provider, parser, storage or UI implementation belongs here. */
export interface Ruby { readonly start: number; readonly end: number; readonly reading: string }
export interface Paragraph { readonly id: string; readonly text: string; readonly ruby: readonly Ruby[] }
export interface Chapter {
 readonly canonicalUrl: string; readonly workId: string; readonly chapterId: string; readonly title: string;
 readonly prevUrl: string | null; readonly nextUrl: string | null; readonly sourceHash: string;
 readonly paragraphs: readonly Paragraph[];
}
export interface SourceAdapter { getChapter(url: string, signal: AbortSignal): Promise<Chapter> }
export type ProviderId = 'openai-compatible' | 'gemini';
export interface ProviderConfig {
 readonly provider: ProviderId; readonly baseUrl: string; readonly model: string; readonly authRef?: string;
 readonly contextBudget: number; readonly outputBudget: number; readonly settingsRevision: number;
}
export interface JobToken { readonly jobId: string; readonly chapterId: string; readonly settingsRevision: number }
export interface ChunkRequest {
 readonly token: JobToken; readonly chunkId: string;
 /** Read-only surrounding context, never duplicated into the output. */
 readonly context: readonly Paragraph[];
 /** Ordered source segments requested for translation, with stable segment IDs. */
 readonly paragraphs: readonly Paragraph[]; readonly outputIds: readonly string[];
 readonly languageDirection: 'ja-ko'; readonly promptVersion: string;
}
export type FinishReason = 'complete' | 'length' | 'blocked' | 'unknown';
export interface TranslatedParagraph { readonly id: string; readonly text: string }
export interface ChunkResult { readonly chunkId: string; readonly paragraphs: readonly TranslatedParagraph[]; readonly finishReason: FinishReason }
export interface TranslationProvider { translateChunk(request: ChunkRequest, signal: AbortSignal): Promise<ChunkResult> }
export interface CacheIdentity {
 readonly canonicalUrl: string; readonly sourceHash: string; readonly provider: ProviderId;
 readonly normalizedEndpoint: string; readonly model: string; readonly promptVersion: string; readonly languageDirection: 'ja-ko';
}
export interface ReadPosition { readonly chapterId: string; readonly paragraphId: string; readonly offset: number }
export interface ValidatedChunk { readonly chunkId: string; readonly paragraphs: readonly TranslatedParagraph[]; readonly validated: true }
export interface Checkpoint {
 readonly schemaVersion: 1; readonly cacheKey: string; readonly identity: CacheIdentity;
 readonly token: JobToken; readonly chapter: Chapter; readonly chunks: readonly ValidatedChunk[];
}
export interface CompletedChapter {
 readonly schemaVersion: 1; readonly cacheKey: string; readonly identity: CacheIdentity;
 readonly source: Chapter; readonly paragraphs: readonly TranslatedParagraph[]; readonly completedAt: string;
}
export interface StoredReaderData { readonly chapter: CompletedChapter | null; readonly checkpoint: Checkpoint | null; readonly position: ReadPosition | null }
export interface ReaderStore {
 read(key: string): Promise<StoredReaderData | null>;
 saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
 commitChapter(chapter: CompletedChapter): Promise<void>;
 savePosition(position: ReadPosition): Promise<void>;
}
/** Native only: reject unsupported platforms/errors, never use a plaintext fallback. */
export interface SecretStore { get(ref: string): Promise<string | null>; set(ref: string, secret: string): Promise<void>; remove(ref: string): Promise<void> }
export const ERROR_CODES = ['source_access','source_parse','connection','auth','timeout_unknown','invalid_output','storage','cancelled'] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export type RequestOutcome = 'not_sent' | 'unknown' | 'received';
export class ReaderError extends Error {
 constructor(readonly code: ErrorCode, readonly outcome: RequestOutcome = 'not_sent', readonly status?: number) {
  super(code); this.name = 'ReaderError';
 }
}
export type JobPhase = 'idle' | 'preparing' | 'translating' | 'validating' | 'saving' | 'ready' | 'failed' | 'unknown' | 'paused';
export interface JobState { readonly phase: JobPhase; readonly token?: JobToken; readonly completedChunks: number; readonly totalChunks: number; readonly error?: ReaderError }
export interface ReaderPreferences { readonly fontSize: number; readonly prefetchEnabled: boolean }
export const DEFAULT_PREFERENCES: ReaderPreferences = Object.freeze({ fontSize: 18, prefetchEnabled: false });
export interface ReaderViewState {
 readonly job: JobState; readonly chapter: CompletedChapter | null; readonly position: ReadPosition | null;
 readonly preferences: ReaderPreferences; readonly showOriginal: boolean;
}
export interface ReaderActions {
 onOpen(url: string): void; onCancel(): void; onRetry(): void; onResume(): void;
 onNavigate(url: string): void; onShowOriginal(show: boolean): void;
 onFontSize(size: number): void; onPosition(position: ReadPosition): void;
}
export interface SettingsViewState {
 readonly config: ProviderConfig; readonly preferences: ReaderPreferences;
 readonly secretStatus: 'unset' | 'saved' | 'saving' | 'error'; readonly error?: ErrorCode;
}
export interface SettingsActions {
 /** Controller owns incrementing settingsRevision, invalidating stale work. */
 onConfigChange(config: Omit<ProviderConfig, 'settingsRevision'>): void;
 /** Ephemeral password input only: never place secret in settings snapshots. */
 onSaveSecret(secret: string): Promise<void>; onRemoveSecret(): Promise<void>;
 onPrefetchChange(enabled: boolean): void;
}
export interface HttpResponse { readonly status: number; readonly headers: Readonly<Record<string,string>>; readonly data: unknown; readonly url: string }
export interface NativeHttpRequest {
 readonly url: string; readonly method: 'GET' | 'POST'; readonly headers: Record<string,string>;
 readonly data?: Record<string,unknown>; readonly responseType: 'text'; readonly disableRedirects: true;
 readonly connectTimeout: number; readonly readTimeout: number;
}
/** Implementations must really disable redirects before dispatch, not just check final URL. */
export interface NativeHttpClient { request(options: NativeHttpRequest): Promise<HttpResponse> }
export interface SourceTransport { get(url: string, signal: AbortSignal): Promise<HttpResponse> }
export interface ModelRequest { readonly url: string; readonly body: Readonly<Record<string,unknown>>; readonly authorization?: string;
 /** Header-only key, accepted exclusively for the fixed Gemini generateContent endpoint. */
 readonly geminiApiKey?: string }
/** Abort does NOT prove server cancellation. Promise waits for native settlement before rejecting,
 * so a scheduler that awaits it cannot overlap another native model request. Never auto-retry POST. */
export interface ModelTransport { post(request: ModelRequest, signal: AbortSignal): Promise<HttpResponse> }
export interface AppLifecycle { isActive(): Promise<boolean>; subscribe(listener: (active: boolean) => void): Promise<() => Promise<void>> }
export function isCurrentJob(a: JobToken, b: JobToken): boolean {
 return a.jobId === b.jobId && a.chapterId === b.chapterId && a.settingsRevision === b.settingsRevision;
}
async function sha256(value: unknown): Promise<string> {
 const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
 return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function createParagraphId(chapterId: string, index: number, paragraph: Pick<Paragraph, 'text' | 'ruby'>): Promise<string> {
 return 'p-' + await sha256([chapterId, index, paragraph.text, paragraph.ruby.map(({ start, end, reading }) => [start, end, reading])]);
}
/** Callers normalize the endpoint; secret/authRef is deliberately excluded. */
export async function createCacheKey(input: CacheIdentity): Promise<string> {
 return 'v1-' + await sha256([input.canonicalUrl,input.sourceHash,input.provider,input.normalizedEndpoint,input.model,input.promptVersion,input.languageDirection]);
}
const LOG_EVENTS = ['request_failed','request_completed','job_changed','storage_failed'] as const;
/** Allowlist, not recursive redaction: arbitrary error messages, URLs, IDs and bodies are dropped. */
export function toSafeLog(input: Record<string,unknown>): Record<string,string | number> {
 const result: Record<string,string | number> = { event: LOG_EVENTS.includes(input.event as typeof LOG_EVENTS[number]) ? String(input.event) : 'unknown' };
 if (ERROR_CODES.includes(input.code as ErrorCode)) result.code = String(input.code);
 if (typeof input.status === 'number' && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) result.status = input.status;
 if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs >= 0) result.durationMs = input.durationMs;
 return result;
}
