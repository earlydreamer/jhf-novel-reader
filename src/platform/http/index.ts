import { ReaderError } from '../../contracts';
import type {
  NativeHttpClient,
  NativeHttpRequest,
  HttpResponse,
  SourceTransport,
  LookupTransport,
  ModelTransport,
  NativeStreamingClient,
} from '../../contracts';
import packageInfo from '../../../package.json';
function validateUrl(value: string, source: boolean): URL {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error();
    if (source && url.protocol !== 'https:') throw new Error();
    return url;
  } catch {
    throw new ReaderError(source ? 'source_access' : 'connection');
  }
}
async function dispatch(
  client: NativeHttpClient,
  request: NativeHttpRequest,
  signal: AbortSignal,
  source: boolean,
): Promise<HttpResponse> {
  if (signal.aborted) throw new ReaderError('cancelled');
  let response: HttpResponse;
  try {
    response = await client.request(request);
  } catch (error) {
    if (error instanceof ReaderError)
      throw new ReaderError(error.code, error.outcome, error.status);
    if (signal.aborted) throw new ReaderError('cancelled', source ? 'not_sent' : 'unknown');
    throw new ReaderError(
      source ? 'connection' : 'timeout_unknown',
      source ? 'not_sent' : 'unknown',
    );
  }
  if (signal.aborted) throw new ReaderError('cancelled', source ? 'received' : 'unknown');
  // Redirects are disabled in the native client before sending any request. Also fail closed here.
  let sameUrl = false;
  try {
    sameUrl = new URL(response.url).href === new URL(request.url).href;
  } catch {
    /* fail closed */
  }
  if ((response.status >= 300 && response.status < 400) || !sameUrl)
    throw new ReaderError(source ? 'source_access' : 'connection', 'received', response.status);
  return response;
}
export type SourcePacing = {
  /** 연속한 원문 요청 사이의 최소 간격(ms). 원문 사이트에 요청이 몰리지 않게 한다. */
  minIntervalMs: number;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), {
      once: true,
    });
  });
}
/** 요청을 한 줄로 세워 보낸 시각 기준으로 간격을 둔다. 대기 중 취소되면 보내지 않는다. */
function createTurn(pacing: SourcePacing): (signal: AbortSignal) => Promise<void> {
  const now = pacing.now ?? Date.now;
  const wait = pacing.wait ?? sleep;
  let lastSent = Number.NEGATIVE_INFINITY;
  let queue: Promise<void> = Promise.resolve();
  return function turn(signal: AbortSignal): Promise<void> {
    const next = queue.then(async () => {
      const delay = lastSent + pacing.minIntervalMs - now();
      if (delay > 0) {
        try {
          await wait(delay, signal);
        } catch {
          throw new ReaderError('cancelled', 'not_sent');
        }
      }
      if (signal.aborted) throw new ReaderError('cancelled', 'not_sent');
      lastSent = now();
    });
    queue = next.catch(() => undefined);
    return next;
  };
}

export function createSourceTransport(
  client: NativeHttpClient,
  pacing: SourcePacing = { minIntervalMs: 0 },
): SourceTransport {
  const turn = createTurn(pacing);
  return {
    async get(value, signal) {
      const url = validateUrl(value, true);
      await turn(signal);
      return dispatch(
        client,
        {
          url: url.href,
          method: 'GET',
          headers: { Accept: 'text/html' },
          responseType: 'text',
          disableRedirects: true,
          connectTimeout: 15000,
          readTimeout: 30000,
        },
        signal,
        true,
      );
    },
  };
}
export type LookupGroup = 'wikimedia' | 'namu';
export type LookupPacing = {
  /** 출처 묶음별 최소 간격(ms). 빠뜨리면 기본값(위키미디어 1000, 나무위키 2500)을 쓴다. */
  minIntervalMs?: Partial<Record<LookupGroup, number>>;
  now?: () => number;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const LOOKUP_USER_AGENT = `JHFNovelReader/${packageInfo.version} (https://github.com/earlydreamer/narou-reader)`;
// 정확한 주소만 허용한다. 쿼리·경로 규칙은 조회 함수가 쓰는 주소와 한 쌍으로 유지한다.
const WIKIMEDIA_API =
  /^https:\/\/(?:ja\.wikipedia\.org|ko\.wikipedia\.org|www\.wikidata\.org)\/w\/api\.php\?[^#\s]+$/;
const NAMU_SEARCH = /^https:\/\/namu\.wiki\/Search\?q=[^&#\s]+$/;
const NAMU_DOCUMENT = /^https:\/\/namu\.wiki\/w\/[^?#\s]+$/;
const DOT_SEGMENT_OR_BACKSLASH = /\.\.|%2e|\\/i;

function lookupGroup(value: string): LookupGroup {
  if (WIKIMEDIA_API.test(value)) return 'wikimedia';
  if (NAMU_SEARCH.test(value)) return 'namu';
  if (NAMU_DOCUMENT.test(value) && !DOT_SEGMENT_OR_BACKSLASH.test(value)) return 'namu';
  throw new ReaderError('connection');
}

/** 외부 조회 통로. 허용 주소 밖은 요청 없이 거부하고, 리다이렉트를 끈 GET만 보낸다. */
export function createLookupTransport(
  client: NativeHttpClient,
  pacing: LookupPacing = {},
): LookupTransport {
  const turns: Record<LookupGroup, (signal: AbortSignal) => Promise<void>> = {
    wikimedia: createTurn({
      minIntervalMs: pacing.minIntervalMs?.wikimedia ?? 1000,
      now: pacing.now ?? Date.now,
      wait: pacing.wait ?? sleep,
    }),
    namu: createTurn({
      minIntervalMs: pacing.minIntervalMs?.namu ?? 2500,
      now: pacing.now ?? Date.now,
      wait: pacing.wait ?? sleep,
    }),
  };
  return {
    async get(value, responseType, signal) {
      const group = lookupGroup(value);
      await turns[group](signal);
      return dispatch(
        client,
        {
          url: value,
          method: 'GET',
          headers: {
            'User-Agent': LOOKUP_USER_AGENT,
            Accept: responseType === 'json' ? 'application/json' : 'text/html',
          },
          responseType,
          disableRedirects: true,
          connectTimeout: 10000,
          readTimeout: 20000,
        },
        signal,
        false,
      );
    },
  };
}

export function createModelTransport(
  client: NativeHttpClient,
  streaming?: NativeStreamingClient,
): ModelTransport {
  return {
    ...(streaming
      ? ({
          async streamPost(input, signal, onData) {
            const url = validateUrl(input.url, false);
            if (
              input.geminiApiKey !== undefined ||
              !/^https?:\/\/[^/?#]+(?:\/[A-Za-z0-9._-]+)*\/v1\/chat\/completions$/.test(
                input.url,
              ) ||
              input.url.includes('/../') ||
              input.url.includes('/./')
            )
              throw new ReaderError('connection');
            if (
              input.authorization !== undefined &&
              !/^Bearer [^\s\u007f]+$/.test(input.authorization)
            )
              throw new ReaderError('auth');
            return dispatch(
              { request: (options) => streaming.requestStream(options, signal, onData) },
              {
                url: url.href,
                method: 'POST',
                headers: {
                  Accept: 'text/event-stream',
                  'Content-Type': 'application/json',
                  ...(input.authorization ? { Authorization: input.authorization } : {}),
                },
                data: { ...input.body, stream: true },
                responseType: 'text',
                disableRedirects: true,
                connectTimeout: 15000,
                readTimeout: 600000,
              },
              signal,
              false,
            );
          },
        } satisfies Partial<ModelTransport>)
      : {}),
    async get(input, signal) {
      const url = validateUrl(input.url, false);
      const gemini = input.geminiApiKey !== undefined;
      if (
        input.url.includes('/../') ||
        (gemini
          ? input.url !== 'https://generativelanguage.googleapis.com/v1beta/models'
          : !/^https?:\/\/[^/?#]+(?:\/[A-Za-z0-9._-]+)*\/v1\/models$/.test(input.url))
      )
        throw new ReaderError('connection');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (gemini) {
        if (
          input.authorization !== undefined ||
          !input.geminiApiKey ||
          /[\u0000-\u0020\u007f]/.test(input.geminiApiKey)
        )
          throw new ReaderError('auth');
        headers['x-goog-api-key'] = input.geminiApiKey;
      } else if (input.authorization !== undefined) {
        if (!/^Bearer [^\s\u007f]+$/.test(input.authorization)) throw new ReaderError('auth');
        headers.Authorization = input.authorization;
      }
      return dispatch(
        client,
        {
          url: url.href,
          method: 'GET',
          headers,
          responseType: 'text',
          disableRedirects: true,
          connectTimeout: 15000,
          readTimeout: 30000,
        },
        signal,
        false,
      );
    },
    async post(input, signal) {
      const url = validateUrl(input.url, false);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      const gemini = input.geminiApiKey !== undefined;
      if (gemini) {
        // Match the unnormalized input: URL normalization must not hide traversal or delimiters.
        if (
          !/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}:generateContent$/.test(
            input.url,
          )
        )
          throw new ReaderError('connection');
        if (
          input.authorization !== undefined ||
          !input.geminiApiKey ||
          /[\u0000-\u0020\u007f]/.test(input.geminiApiKey)
        )
          throw new ReaderError('auth');
        headers['x-goog-api-key'] = input.geminiApiKey;
      } else if (input.authorization) headers.Authorization = input.authorization;
      return dispatch(
        client,
        {
          url: url.href,
          method: 'POST',
          headers,
          data: gemini ? { ...input.body } : { ...input.body, stream: false },
          responseType: 'text',
          disableRedirects: true,
          connectTimeout: 15000,
          // Local whole-chapter generation can outlast the two-minute cloud bound.
          readTimeout: gemini ? 120000 : 600000,
        },
        signal,
        false,
      );
    },
  };
}
