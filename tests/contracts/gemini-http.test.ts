import { expect, it, vi } from 'vitest';
import {
  ReaderError,
  type NativeHttpClient,
  type NativeStreamingClient,
} from '../../src/contracts';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
const url =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-synthetic:generateContent';
const modelsUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
const streamUrl = url.replace(':generateContent', ':streamGenerateContent?alt=sse');
const signal = () => new AbortController().signal;
const body = { contents: [{ parts: [{ text: 'synthetic' }] }] };
function setup() {
  const request = vi.fn<NativeHttpClient['request']>(async (input) => ({
    status: 200,
    headers: {},
    data: {},
    url: input.url,
  }));
  const requestStream = vi.fn<NativeStreamingClient['requestStream']>(request);
  return { request, requestStream, model: createModelTransport({ request }, { requestStream }) };
}
it('emits fixed Gemini key header without OpenAI stream or Authorization', async () => {
  const h = setup();
  await h.model.post({ url, body, geminiApiKey: 'synthetic-key' }, signal());
  expect(h.request.mock.calls[0]![0]).toMatchObject({
    url,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-goog-api-key': 'synthetic-key',
    },
    data: body,
    disableRedirects: true,
  });
  expect(h.request.mock.calls[0]![0].headers).not.toHaveProperty('Authorization');
  expect(h.request.mock.calls[0]![0].data).not.toHaveProperty('stream');
});
it.each([modelsUrl, modelsUrl + '?pageToken=next%2F%2B%3D%3D'])(
  'emits the fixed Gemini catalog GET with a header-only key (%s)',
  async (url) => {
    const h = setup();
    await h.model.get({ url, geminiApiKey: 'synthetic-key' }, signal());
    expect(h.request.mock.calls[0]![0]).toMatchObject({
      url,
      method: 'GET',
      headers: { Accept: 'application/json', 'x-goog-api-key': 'synthetic-key' },
      disableRedirects: true,
    });
    expect(h.request.mock.calls[0]![0].headers).not.toHaveProperty('Authorization');
  },
);
it.each([
  modelsUrl + '/',
  modelsUrl + '?key=bad',
  modelsUrl + '?pageToken=',
  modelsUrl + '?pageToken=next&pageToken=other',
  modelsUrl + '?pageToken=next&key=bad',
  modelsUrl.replace('googleapis.com', 'googleapis.com.evil.test') + '?pageToken=next',
  modelsUrl.replace('googleapis.com', 'googleapis.com.evil.test'),
  modelsUrl.replace('https://', 'https://secret@'),
  modelsUrl.replace('.com/', '.com:444/'),
  url,
])('rejects Gemini key catalog GET to an unapproved target %s', async (target) => {
  const h = setup();
  await expect(
    h.model.get({ url: target, geminiApiKey: 'synthetic-key' }, signal()),
  ).rejects.toMatchObject({ code: 'connection', outcome: 'not_sent' });
  expect(h.request).not.toHaveBeenCalled();
});
it('rejects invalid or mixed Gemini catalog authentication before dispatch', async () => {
  for (const input of [
    { url: modelsUrl, geminiApiKey: ' ' },
    { url: modelsUrl, geminiApiKey: 'synthetic-key', authorization: 'Bearer local-key' },
  ]) {
    const h = setup();
    await expect(h.model.get(input, signal())).rejects.toMatchObject({
      code: 'auth',
      outcome: 'not_sent',
    });
    expect(h.request).not.toHaveBeenCalled();
  }
});
it.each([
  'https://evil.test/v1beta/models/x:generateContent',
  'http://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
  url + '?',
  url + '#',
  url + '?key=bad',
  url.replace('googleapis.com', 'googleapis.com.evil.test'),
  url.replace('/gemini-synthetic:', '/%2e%2e:'),
  url.replace('https://', 'https://secret@'),
  url.replace('.com/', '.com:444/'),
  url.replace(':generateContent', ':streamGenerateContent'),
])('rejects key dispatch to unapproved target %s', async (target) => {
  const h = setup();
  await expect(
    h.model.post({ url: target, body, geminiApiKey: 'synthetic-key' }, signal()),
  ).rejects.toMatchObject({ code: 'connection', outcome: 'not_sent' });
  expect(h.request).not.toHaveBeenCalled();
});
it.each(['', ' ', 'bad\nheader', 'bad\u0000header'])(
  'rejects invalid Gemini key before native dispatch %#',
  async (geminiApiKey) => {
    const h = setup();
    await expect(h.model.post({ url, body, geminiApiKey }, signal())).rejects.toMatchObject({
      code: 'auth',
      outcome: 'not_sent',
    });
    expect(h.request).not.toHaveBeenCalled();
  },
);
it('rejects mixed key and Authorization including empty authorization', async () => {
  for (const authorization of ['Bearer local-key', '']) {
    const h = setup();
    await expect(
      h.model.post({ url, body, geminiApiKey: 'synthetic-key', authorization }, signal()),
    ).rejects.toMatchObject({ code: 'auth', outcome: 'not_sent' });
    expect(h.request).not.toHaveBeenCalled();
  }
});
it('does not forward Gemini key to source requests', async () => {
  const h = setup();
  await h.model.post({ url, body, geminiApiKey: 'synthetic-key' }, signal());
  await createSourceTransport({ request: h.request }).get(
    'https://ncode.syosetu.com/n1234ab/1/',
    signal(),
  );
  expect(h.request.mock.calls[1]![0].headers).toEqual({ Accept: 'text/html' });
});
it('rejects Gemini redirects and never retries or exposes key on failure', async () => {
  const h = setup();
  h.request.mockResolvedValue({
    status: 307,
    headers: { location: 'https://evil.test' },
    data: 'synthetic-key',
    url,
  });
  await expect(
    h.model.post({ url, body, geminiApiKey: 'synthetic-key' }, signal()),
  ).rejects.toMatchObject({ code: 'connection', outcome: 'received', status: 307 });
  expect(h.request).toHaveBeenCalledTimes(1);
  h.request.mockRejectedValue(new Error('synthetic-key'));
  await expect(
    h.model.post({ url, body, geminiApiKey: 'synthetic-key' }, signal()),
  ).rejects.toMatchObject({
    code: 'timeout_unknown',
    outcome: 'unknown',
    message: 'timeout_unknown',
  });
  expect(h.request).toHaveBeenCalledTimes(2);
});
it('sanitizes a known native error rather than leaking its message/cause', async () => {
  const h = setup();
  const error = new ReaderError('connection');
  error.message = 'synthetic-key';
  error.cause = body;
  h.request.mockRejectedValue(error);
  const caught = await h.model
    .post({ url, body, geminiApiKey: 'synthetic-key' }, signal())
    .catch((e) => e);
  expect(caught.message).toBe('connection');
  expect(caught).not.toHaveProperty('cause');
});

it('sends Gemini SSE with a header key and the unmodified generation body', async () => {
  const h = setup();
  await h.model.streamPost!(
    { url: streamUrl, body, geminiApiKey: 'synthetic-key' },
    signal(),
    vi.fn(),
  );
  expect(h.requestStream.mock.calls[0]?.[0]).toMatchObject({
    url: streamUrl,
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'x-goog-api-key': 'synthetic-key',
    },
    disableRedirects: true,
  });
  expect(h.requestStream.mock.calls[0]?.[0].data).toEqual(body);
  expect(h.requestStream.mock.calls[0]?.[0].headers).not.toHaveProperty('Authorization');
});

it.each([
  streamUrl.replace('https:', 'http:'),
  streamUrl.replace('.com/', '.com.example/'),
  streamUrl.replace('.com/', '.com:443/'),
  streamUrl.replace('https://', 'https://user@'),
  streamUrl.replace('/gemini-synthetic:', '/../models/gemini-synthetic:'),
  streamUrl.replace('/gemini-synthetic:', '/%2e%2e:'),
  streamUrl + '&key=bad',
  streamUrl + '#',
  streamUrl + '\n',
  streamUrl.replace('alt=sse', 'alt=json'),
  url,
])('rejects streaming a Gemini key to %s before native dispatch', async (target) => {
  const h = setup();
  await expect(
    h.model.streamPost!({ url: target, body, geminiApiKey: 'synthetic-key' }, signal(), vi.fn()),
  ).rejects.toMatchObject({ code: 'connection', outcome: 'not_sent' });
  expect(h.requestStream).not.toHaveBeenCalled();
});

it.each([
  { geminiApiKey: '', authorization: undefined },
  { geminiApiKey: 'bad\nheader', authorization: undefined },
  { geminiApiKey: 'synthetic-key', authorization: 'Bearer mixed' },
])('rejects invalid Gemini streaming credentials before native dispatch', async (auth) => {
  const h = setup();
  await expect(
    h.model.streamPost!({ url: streamUrl, body, ...auth }, signal(), vi.fn()),
  ).rejects.toMatchObject({ code: 'auth', outcome: 'not_sent' });
  expect(h.requestStream).not.toHaveBeenCalled();
});
