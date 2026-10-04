import { ReaderError } from '../../contracts';
import type { NativeHttpClient, NativeHttpRequest, HttpResponse, SourceTransport, ModelTransport } from '../../contracts';
function validateUrl(value: string, source: boolean): URL {
 try {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
  if (source && url.protocol !== 'https:') throw new Error();
  return url;
 } catch { throw new ReaderError(source ? 'source_access' : 'connection'); }
}
async function dispatch(client: NativeHttpClient, request: NativeHttpRequest, signal: AbortSignal, source: boolean): Promise<HttpResponse> {
 if (signal.aborted) throw new ReaderError('cancelled');
 let response: HttpResponse;
 try { response = await client.request(request); }
 catch (error) {
  if (error instanceof ReaderError) throw error;
  if (signal.aborted) throw new ReaderError('cancelled', source ? 'not_sent' : 'unknown');
  throw new ReaderError(source ? 'connection' : 'timeout_unknown', source ? 'not_sent' : 'unknown');
 }
 if (signal.aborted) throw new ReaderError('cancelled', source ? 'received' : 'unknown');
 // Redirects are disabled in the native client before sending any request. Also fail closed here.
 let sameUrl = false;
 try { sameUrl = new URL(response.url).href === new URL(request.url).href; } catch { /* fail closed */ }
 if ((response.status >= 300 && response.status < 400) || !sameUrl) throw new ReaderError(source ? 'source_access' : 'connection', 'received', response.status);
 return response;
}
export function createSourceTransport(client: NativeHttpClient): SourceTransport {
 return { async get(value, signal) {
  const url = validateUrl(value, true);
  return dispatch(client, { url: url.href, method: 'GET', headers: { Accept: 'text/html' }, responseType: 'text', disableRedirects: true, connectTimeout: 15000, readTimeout: 30000 }, signal, true);
 } };
}
export function createModelTransport(client: NativeHttpClient): ModelTransport {
 return { async post(input, signal) {
  const url = validateUrl(input.url, false);
  const headers: Record<string,string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (input.authorization) headers.Authorization = input.authorization;
  return dispatch(client, { url: url.href, method: 'POST', headers, data: { ...input.body, stream: false }, responseType: 'text', disableRedirects: true, connectTimeout: 15000, readTimeout: 120000 }, signal, false);
 } };
}
