import { expect, it, vi } from 'vitest';
import { createSourceTransport, createModelTransport } from '../../src/platform/http';
import type { NativeHttpClient } from '../../src/contracts';
const response = { status: 200, headers: { 'Content-Type': 'text/html' }, data: 'ok', url: 'https://ncode.syosetu.com/n1234ab/1/' };
const signal = () => new AbortController().signal;
it('constructs source headers independently, rejecting runtime auth injection', async () => {
 const request = vi.fn<NativeHttpClient["request"]>(async () => response);
 const source = createSourceTransport({ request });
 await source.get(response.url, signal());
 expect(request.mock.calls[0]?.[0]).toMatchObject({ method: 'GET', headers: { Accept: 'text/html' }, disableRedirects: true });
 expect(JSON.stringify(request.mock.calls)).not.toContain('Authorization');
 await expect(source.get('https://secret:password@ncode.syosetu.com/a', signal())).rejects.toMatchObject({ code: 'source_access' });
});
it('refuses redirects without following or forwarding auth', async () => {
 const request = vi.fn<NativeHttpClient["request"]>(async () => ({ ...response, status: 302, headers: { location: 'https://evil.example' } }));
 await expect(createSourceTransport({ request }).get(response.url, signal())).rejects.toMatchObject({ code: 'source_access' });
 expect(request).toHaveBeenCalledTimes(1);
});
it('enforces non-streaming and never retries model POST', async () => {
 const request = vi.fn<NativeHttpClient["request"]>(async () => ({ ...response, url: 'http://192.168.1.2/v1/chat/completions', data: {} }));
 await createModelTransport({ request }).post({ url: 'http://192.168.1.2/v1/chat/completions', body: { stream: true, model: 'local' }, authorization: 'Bearer secret' }, signal());
 expect(request.mock.calls[0]?.[0]).toMatchObject({ method: 'POST', data: { stream: false }, disableRedirects: true });
 expect(request).toHaveBeenCalledTimes(1);
});
it('maps timeout and uncertain model connection failure without exposing errors', async () => {
 const request = vi.fn<NativeHttpClient["request"]>(async () => { throw new Error('secret native failure'); });
 await expect(createModelTransport({ request }).post({ url: 'http://192.168.1.2/v1/chat/completions', body: {} }, signal())).rejects.toMatchObject({ code: 'timeout_unknown', outcome: 'unknown' });
 expect(request).toHaveBeenCalledTimes(1);
});
it('holds native completion after cancellation and ignores the eventual response', async () => {
 let finish!: (value: typeof response) => void;
 const request: NativeHttpClient['request'] = () => new Promise(resolve => { finish = resolve; });
 const controller = new AbortController();
 const result = createModelTransport({ request }).post({ url: response.url, body: {} }, controller.signal);
 controller.abort();
 let settled = false;
 void result.then(() => { settled = true; }, () => { settled = true; });
 await Promise.resolve();
 expect(settled).toBe(false);
 finish(response);
 await expect(result).rejects.toMatchObject({ code: 'cancelled', outcome: 'unknown' });
});
it('does not send an already cancelled request', async () => {
 const request = vi.fn<NativeHttpClient["request"]>(async () => response);
 const controller = new AbortController(); controller.abort();
 await expect(createSourceTransport({ request }).get(response.url, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
 expect(request).not.toHaveBeenCalled();
});
it('rejects unexpected final origin as defense in depth', async () => {
 const request = vi.fn<NativeHttpClient["request"]>(async () => ({ ...response, url: 'https://evil.example/' }));
 await expect(createModelTransport({ request }).post({ url: response.url, body: {} }, signal())).rejects.toMatchObject({ code: 'connection' });
});
it('preserves a known pre-dispatch native platform rejection as not sent', async () => {
 const { ReaderError } = await import('../../src/contracts');
 const request = vi.fn<NativeHttpClient['request']>(async () => { throw new ReaderError('connection', 'not_sent'); });
 await expect(createModelTransport({ request }).post({ url: 'http://192.168.1.2/v1/chat/completions', body: {} }, signal())).rejects.toMatchObject({ code: 'connection', outcome: 'not_sent' });
});
it('rejects authenticated model redirects in exactly one request', async () => {
 const request = vi.fn<NativeHttpClient['request']>(async () => ({ ...response, status: 307, headers: { location: 'https://evil.example' } }));
 await expect(createModelTransport({ request }).post({ url: response.url, body: {}, authorization: 'Bearer secret' }, signal())).rejects.toMatchObject({ code: 'connection' });
 expect(request).toHaveBeenCalledTimes(1);
 expect(request.mock.calls[0]?.[0].disableRedirects).toBe(true);
});
