/** Shared module boundary. No provider, parser, storage or UI implementation belongs here. */
export interface Ruby {
  readonly start: number;
  readonly end: number;
  readonly reading: string;
}
export interface Paragraph {
  readonly id: string;
  readonly text: string;
  readonly ruby: readonly Ruby[];
}
export interface Chapter {
  readonly canonicalUrl: string;
  readonly workId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly prevUrl: string | null;
  readonly nextUrl: string | null;
  readonly sourceHash: string;
  readonly paragraphs: readonly Paragraph[];
}
export interface SourceAdapter {
  getChapter(url: string, signal: AbortSignal): Promise<Chapter>;
}
export const PROVIDER_IDS = ['openai-compatible', 'gemini', 'chatgpt'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
/** Native only: reject unsupported platforms/errors, never use a plaintext fallback. */
export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, secret: string): Promise<void>;
  remove(ref: string): Promise<void>;
}
export const ERROR_CODES = [
  'source_access',
  'source_parse',
  'connection',
  'auth',
  'timeout_unknown',
  'invalid_output',
  'storage',
  'cancelled',
  'model_list',
  'model_missing',
  'model_unavailable',
  'input_limit',
  'output_limit',
  'blocked',
  'guidance_unsupported',
  /** 로그인 전용·성인·지원하지 않는 언어처럼 앱이 열지 않기로 한 원문. */
  'source_unsupported',
  /** 계정 연결이 끊겼거나 토큰 갱신 결과를 확인하지 못해 다시 로그인해야 한다. */
  'reconnect_required',
  /** 연결한 계정의 플랜으로는 이 기능을 쓸 수 없다. */
  'plan_not_eligible',
  /** 계정 플랜의 사용량 한도에 도달했다. */
  'usage_limit',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export type RequestOutcome = 'not_sent' | 'unknown' | 'received';
export class ReaderError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly outcome: RequestOutcome = 'not_sent',
    readonly status?: number,
  ) {
    super(code);
    this.name = 'ReaderError';
  }
}
export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: unknown;
  readonly url: string;
}
export interface NativeHttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Record<string, string>;
  readonly data?: Record<string, unknown>;
  readonly responseType: 'json' | 'text';
  readonly disableRedirects: true;
  readonly connectTimeout: number;
  readonly readTimeout: number;
}
/** Implementations must really disable redirects before dispatch, not just check final URL. */
export interface NativeHttpClient {
  request(options: NativeHttpRequest): Promise<HttpResponse>;
}
export interface NativeStreamingClient {
  requestStream(
    options: NativeHttpRequest,
    signal: AbortSignal,
    onData: (data: string) => void,
  ): Promise<HttpResponse>;
}
export interface SourceTransport {
  get(url: string, signal: AbortSignal): Promise<HttpResponse>;
}
export interface LookupTransport {
  /** 허용된 조회 주소에만 GET. json이면 파싱된 값, text면 문자열을 data로 돌려준다. */
  get(url: string, responseType: 'json' | 'text', signal: AbortSignal): Promise<HttpResponse>;
}
export interface ModelRequest {
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly authorization?: string;
  /** Header-only key, accepted exclusively for fixed Gemini endpoints. */
  readonly geminiApiKey?: string;
}
/** Abort does NOT prove server cancellation. Promise waits for native settlement before rejecting,
 * so a scheduler that awaits it cannot overlap another native model request. Never auto-retry POST. */
export interface ModelTransport {
  get(
    request: { url: string; authorization?: string; geminiApiKey?: string },
    signal: AbortSignal,
  ): Promise<HttpResponse>;
  post(request: ModelRequest, signal: AbortSignal): Promise<HttpResponse>;
  streamPost?(
    request: ModelRequest,
    signal: AbortSignal,
    onData: (data: string) => void,
  ): Promise<HttpResponse>;
}
/** ChatGPT 계정 연결 상태. 토큰과 계정 식별자는 네이티브 저장소에만 있고 웹 화면에는 오지 않는다. */
export type ChatGptAccountState = 'disconnected' | 'connected' | 'reconnect';
export type ChatGptConnectOutcome =
  | 'connected'
  | 'cancelled'
  | 'denied'
  | 'timeout'
  | 'not_eligible'
  | 'account_mismatch'
  | 'already_connected'
  | 'no_browser'
  | 'failed';
export interface ChatGptAccount {
  status(): Promise<ChatGptAccountState>;
  /** 시스템 브라우저로 로그인하고 결과를 돌려준다. 결과가 connected가 아니면 연결을 저장하지 않는다. */
  connect(): Promise<ChatGptConnectOutcome>;
  cancelConnect(): Promise<void>;
  /** 원격 철회와 로컬 삭제의 결과를 나눠 돌려준다. */
  disconnect(): Promise<{ readonly revoked: boolean; readonly hadSession: boolean }>;
  /** 공식 모델 목록. 표시 대상만 오며, 2xx가 아니면 허용 어휘만 남긴 오류 본문이 온다. */
  models(signal: AbortSignal): Promise<HttpResponse>;
  /** Responses 스트림. 네이티브가 토큰을 붙이고 store:false·stream:true를 강제한다. */
  respond(
    body: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    onData: (data: string) => void,
  ): Promise<HttpResponse>;
}
export interface AppLifecycle {
  isActive(): Promise<boolean>;
  subscribe(listener: (active: boolean) => void): Promise<() => Promise<void>>;
}
async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function createParagraphId(
  chapterId: string,
  index: number,
  paragraph: Pick<Paragraph, 'text' | 'ruby'>,
): Promise<string> {
  return (
    'p-' +
    (await sha256([
      chapterId,
      index,
      paragraph.text,
      paragraph.ruby.map(({ start, end, reading }) => [start, end, reading]),
    ]))
  );
}
const LOG_EVENTS = [
  'request_failed',
  'request_completed',
  'job_changed',
  'storage_failed',
] as const;
/** Allowlist, not recursive redaction: arbitrary error messages, URLs, IDs and bodies are dropped. */
export function toSafeLog(input: Record<string, unknown>): Record<string, string | number> {
  const result: Record<string, string | number> = {
    event: LOG_EVENTS.includes(input.event as (typeof LOG_EVENTS)[number])
      ? String(input.event)
      : 'unknown',
  };
  if (ERROR_CODES.includes(input.code as ErrorCode)) result.code = String(input.code);
  if (
    typeof input.status === 'number' &&
    Number.isInteger(input.status) &&
    input.status >= 100 &&
    input.status <= 599
  )
    result.status = input.status;
  if (
    typeof input.durationMs === 'number' &&
    Number.isFinite(input.durationMs) &&
    input.durationMs >= 0
  )
    result.durationMs = input.durationMs;
  return result;
}

export type * from './reading';
