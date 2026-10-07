import { expect, test, vi } from 'vitest';
import { createModelTransport } from '../../src/platform/http';
import { createNativeStreamingClient } from '../../src/platform/http/stream';
import type { NativeHttpRequest } from '../../src/contracts';
const request: NativeHttpRequest = {
  url: 'http://localhost:1234/v1/chat/completions',
  method: 'POST',
  headers: {},
  data: { stream: true },
  responseType: 'text',
  disableRedirects: true,
  connectTimeout: 15000,
  readTimeout: 600000,
};
test('model SSE validates endpoints/headers and disables redirects before native dispatch', async () => {
  const calls: NativeHttpRequest[] = [];
  const transport = createModelTransport(
    { request: vi.fn() },
    {
      requestStream: async (options, _signal, onData) => {
        calls.push(options);
        onData('frame');
        return { status: 200, url: options.url, headers: {}, data: 'frame' };
      },
    },
  );
  const onData = vi.fn();
  await transport.streamPost!(
    { url: request.url, body: { stream: false }, authorization: 'Bearer example' },
    new AbortController().signal,
    onData,
  );
  expect(calls[0]).toMatchObject({
    disableRedirects: true,
    data: { stream: true },
    headers: { Authorization: 'Bearer example', Accept: 'text/event-stream' },
  });
  expect(onData).toHaveBeenCalledWith('frame');
  for (const url of [
    'http://localhost:1234/v1/chat/completions?key=x',
    'http://localhost:1234/../v1/chat/completions',
    'http://localhost:1234/source',
    'https://other.invalid/v1/models',
  ])
    await expect(
      transport.streamPost!({ url, body: {} }, new AbortController().signal, onData),
    ).rejects.toThrow();
  await expect(
    transport.streamPost!(
      { url: request.url, body: {}, authorization: 'Bearer x\r\nCookie: bad' },
      new AbortController().signal,
      onData,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
test('stream redirects fail closed and never trigger a second POST', async () => {
  const native = vi.fn(async (options: NativeHttpRequest) => ({
    status: 307,
    url: options.url,
    headers: {},
    data: '',
  }));
  const transport = createModelTransport({ request: vi.fn() }, { requestStream: native });
  await expect(
    transport.streamPost!({ url: request.url, body: {} }, new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ code: 'connection', outcome: 'received' });
  expect(native).toHaveBeenCalledTimes(1);
});
test('cancel waits for native settlement and removes the listener, ignoring other request IDs', async () => {
  let listener!: (event: { id: string; data: string }) => void,
    id = '',
    settle!: (value: {
      status: number;
      url: string;
      headers: Record<string, string>;
      data: string;
      sse: boolean;
    }) => void;
  const gate = new Promise<{
    status: number;
    url: string;
    headers: Record<string, string>;
    data: string;
    sse: boolean;
  }>((r) => {
    settle = r;
  });
  const remove = vi.fn(async () => {}),
    cancel = vi.fn(async () => {});
  const plugin = {
    addListener: async (_event: 'data', fn: typeof listener) => {
      listener = fn;
      return { remove };
    },
    start: vi.fn(async (options: NativeHttpRequest & { id: string }) => {
      id = options.id;
      return gate;
    }),
    cancel,
  };
  const control = new AbortController(),
    chunks = vi.fn();
  let settled = false;
  const pending = createNativeStreamingClient(plugin)
    .requestStream(request, control.signal, chunks)
    .catch((error) => {
      settled = true;
      return error;
    });
  await vi.waitFor(() => expect(plugin.start).toHaveBeenCalledTimes(1));
  listener({ id: 'other', data: 'wrong' });
  listener({ id, data: 'correct' });
  expect(chunks).toHaveBeenCalledExactlyOnceWith('correct');
  control.abort();
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledWith({ id });
  expect(settled).toBe(false);
  settle({ status: 200, url: request.url, headers: {}, data: '', sse: true });
  expect(await pending).toMatchObject({ code: 'cancelled', outcome: 'unknown' });
  expect(remove).toHaveBeenCalledTimes(1);
});
test('a server returning ordinary JSON is not silently treated as streaming or resent', async () => {
  const remove = vi.fn(async () => {}),
    plugin = {
      addListener: async () => ({ remove }),
      cancel: vi.fn(async () => {}),
      start: vi.fn(async () => ({
        status: 200,
        url: request.url,
        headers: {},
        data: '{}',
        sse: false,
      })),
    };
  await expect(
    createNativeStreamingClient(plugin).requestStream(
      request,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'invalid_output', outcome: 'received' });
  expect(plugin.start).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
});
