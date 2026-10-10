import { expect, test, vi } from 'vitest';
import { createLookupTransport } from '../../src/platform/http';
import type { NativeHttpClient } from '../../src/contracts';

const wikipedia = 'https://ja.wikipedia.org/w/api.php?action=query&titles=%E6%96%8E%E8%97%A4';
const wikidata = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=x';
const namuSearch = 'https://namu.wiki/Search?q=%EC%82%AC';
const namuDoc = 'https://namu.wiki/w/%EC%82%AC%EC%9D%B4%ED%86%A0';

function ok(url: string, data: unknown = {}) {
  return { status: 200, url, headers: {}, data };
}

function fakeClient() {
  const request = vi.fn<NativeHttpClient['request']>(async (options) => ok(options.url));
  return { client: { request }, request };
}

function pacedTransport(options: { wikimedia?: number; namu?: number } = {}) {
  let time = 0;
  const waits: number[] = [];
  const { client, request } = fakeClient();
  const transport = createLookupTransport(client, {
    minIntervalMs: options,
    now: () => time,
    wait: async (ms, signal) => {
      waits.push(ms);
      if (signal.aborted) throw new Error('aborted');
      time += ms;
    },
  });
  return { transport, request, waits, advance: (ms: number) => (time += ms) };
}

const signal = () => new AbortController().signal;

test('allowed lookup addresses send one bounded GET with the lookup User-Agent and no redirects', async () => {
  const { transport, request } = pacedTransport();
  await transport.get(wikipedia, 'json', signal());
  await transport.get(namuSearch, 'text', signal());

  expect(request).toHaveBeenCalledTimes(2);
  const json = request.mock.calls[0]?.[0];
  expect(json).toMatchObject({
    url: wikipedia,
    method: 'GET',
    responseType: 'json',
    disableRedirects: true,
    connectTimeout: 10000,
    readTimeout: 20000,
    headers: { Accept: 'application/json' },
  });
  expect(json?.headers['User-Agent']).toMatch(
    /^JHFNovelReader\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/earlydreamer\/jhf-novel-reader\)$/,
  );
  expect(request.mock.calls[1]?.[0]).toMatchObject({
    url: namuSearch,
    responseType: 'text',
    headers: { Accept: 'text/html' },
  });
});

test('accepts the fixed Wikimedia API hosts, namu document path and namu search', async () => {
  const { transport, request } = pacedTransport({ wikimedia: 0, namu: 0 });
  const allowed = [
    'https://ko.wikipedia.org/w/api.php?action=query&titles=a',
    'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1',
    namuDoc,
  ];
  for (const url of allowed) await transport.get(url, 'text', signal());
  expect(request.mock.calls.map(([options]) => options.url)).toEqual(allowed);
});

test.each([
  ['http scheme', 'http://ja.wikipedia.org/w/api.php?action=query'],
  ['other host', 'https://evil.example/w/api.php?action=query'],
  ['wrong api path', 'https://ja.wikipedia.org/w/index.php?action=query'],
  ['wikipedia without query', 'https://ja.wikipedia.org/w/api.php'],
  ['wikipedia with port', 'https://ja.wikipedia.org:8443/w/api.php?action=query'],
  ['wikipedia with user info', 'https://user:pw@ja.wikipedia.org/w/api.php?action=query'],
  ['wikipedia with hash', 'https://ja.wikipedia.org/w/api.php?action=query#x'],
  ['namu search with extra parameter', 'https://namu.wiki/Search?q=a&x=1'],
  ['namu search without q', 'https://namu.wiki/Search'],
  ['namu search with empty q', 'https://namu.wiki/Search?q='],
  ['namu search with other path', 'https://namu.wiki/search?q=a'],
  ['namu search with hash', 'https://namu.wiki/Search?q=a#x'],
  ['namu document empty title', 'https://namu.wiki/w/'],
  ['namu document with dot segments', 'https://namu.wiki/w/../x'],
  ['namu document with inner dot segments', 'https://namu.wiki/w/a/../b'],
  ['namu document with encoded dot segments', 'https://namu.wiki/w/%2e%2e/x'],
  ['namu document outside /w/', 'https://namu.wiki/x/a'],
  ['namu document with hash', 'https://namu.wiki/w/a#x'],
  ['namu with user info', 'https://user@namu.wiki/w/a'],
])('refuses %s without sending a request', async (_name, url) => {
  const { transport, request } = pacedTransport();
  await expect(transport.get(url, 'text', signal())).rejects.toMatchObject({
    code: 'connection',
  });
  expect(request).not.toHaveBeenCalled();
});

test('a redirect or a changed final URL is refused as a connection error', async () => {
  const redirect = vi.fn<NativeHttpClient['request']>(async () => ({
    status: 302,
    url: wikipedia,
    headers: { location: 'https://evil.example/' },
    data: '',
  }));
  await expect(
    createLookupTransport({ request: redirect }, { now: () => 0, wait: async () => {} }).get(
      wikipedia,
      'json',
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'connection' });
  expect(redirect).toHaveBeenCalledTimes(1);

  const moved = vi.fn<NativeHttpClient['request']>(async () => ok('https://evil.example/', {}));
  await expect(
    createLookupTransport({ request: moved }, { now: () => 0, wait: async () => {} }).get(
      wikipedia,
      'json',
      signal(),
    ),
  ).rejects.toMatchObject({ code: 'connection' });
});

test('Wikimedia hosts share one 1000ms queue and namu uses its own 2500ms queue by default', async () => {
  const { transport, waits, advance } = pacedTransport();
  await transport.get(wikipedia, 'json', signal());
  advance(300);
  await transport.get(wikidata, 'json', signal());
  expect(waits).toEqual([700]);

  // namu is a separate host queue: it does not wait behind the Wikimedia requests.
  await transport.get(namuSearch, 'text', signal());
  expect(waits).toEqual([700]);

  await transport.get(namuDoc, 'text', signal());
  expect(waits).toEqual([700, 2500]);
});

test('injected pacing overrides the per-source interval', async () => {
  const paced = pacedTransport({ wikimedia: 50, namu: 75 });
  await paced.transport.get(wikipedia, 'json', signal());
  await paced.transport.get(wikidata, 'json', signal());
  await paced.transport.get(namuSearch, 'text', signal());
  await paced.transport.get(namuDoc, 'text', signal());
  expect(paced.waits).toEqual([50, 75]);
});

test('a lookup cancelled while waiting for its interval is never sent', async () => {
  const { transport, request } = pacedTransport();
  await transport.get(wikipedia, 'json', signal());
  const control = new AbortController();
  control.abort();
  await expect(transport.get(wikidata, 'json', control.signal)).rejects.toMatchObject({
    code: 'cancelled',
    outcome: 'not_sent',
  });
  expect(request).toHaveBeenCalledTimes(1);
});
