import { ReaderError } from '../../contracts';
import type {
  NativeHttpClient,
  NativeHttpRequest,
  HttpResponse,
  SourceTransport,
  ModelTransport,
} from '../../contracts';
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
export function createSourceTransport(client: NativeHttpClient): SourceTransport {
  return {
    async get(value, signal) {
      const url = validateUrl(value, true);
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
export function createModelTransport(client: NativeHttpClient): ModelTransport {
  return {
    async get(input, signal) {
      const url = validateUrl(input.url, false);
      if (
        !/^https?:\/\/[^/?#]+(?:\/[A-Za-z0-9._-]+)*\/v1\/models$/.test(input.url) ||
        input.url.includes('/../') ||
        input.geminiApiKey !== undefined
      )
        throw new ReaderError('connection');
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (input.authorization !== undefined) {
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
          readTimeout: 120000,
        },
        signal,
        false,
      );
    },
  };
}
