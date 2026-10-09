import { describe, expect, test, vi } from 'vitest';
import {
  lookupNamuwiki,
  lookupWikidata,
  lookupWikipedia,
  namuKoreanFor,
} from '../../src/translation/lookup';
import { ReaderError, type HttpResponse, type LookupTransport } from '../../src/contracts';

const ja = '斎藤道三';

function response(url: string, data: unknown, status = 200): HttpResponse {
  return { status, url, headers: {}, data };
}

function fakeTransport(handler: (url: string, type: 'json' | 'text') => unknown) {
  const get = vi.fn<LookupTransport['get']>(async (url, type) =>
    response(url, await handler(url, type)),
  );
  return { transport: { get } satisfies LookupTransport, get };
}

const signal = () => new AbortController().signal;

describe('namuKoreanFor', () => {
  test('counts the Korean form written before the Japanese name in the page text', () => {
    const html = [
      '<p><a href="/w/사이토">사이토 도산</a> (斎藤道三) 은 전국 시대의 다이묘다.</p>',
      '<p>사이토 도산 (斎藤道三 ; 1494-1556)</p>',
      '<p>다른 이름 도산 (斎藤道三)</p>',
    ].join('');
    expect(namuKoreanFor(html, ja)).toEqual({ ko: '사이토 도산', count: 2 });
  });

  test('ignores text inside script and style blocks', () => {
    const html =
      '<script>var x = "가짜 (斎藤道三)";</script><style>.a{}</style>' +
      '<p>사이토 도산 (斎藤道三)</p><SCRIPT>가짜2 (斎藤道三)</SCRIPT>';
    expect(namuKoreanFor(html, ja)).toEqual({ ko: '사이토 도산', count: 1 });
  });

  test('drops one-character Korean candidates', () => {
    expect(namuKoreanFor('<p>도 (斎藤道三)</p>', ja)).toBeNull();
  });

  test('returns null when the Japanese name has no Korean form', () => {
    expect(namuKoreanFor('<p>斎藤道三 only</p>', ja)).toBeNull();
    expect(namuKoreanFor('', ja)).toBeNull();
  });

  test('decodes entities before matching', () => {
    expect(namuKoreanFor('<p>사이토&nbsp;도산 (斎藤道三)</p>', ja)).toEqual({
      ko: '사이토 도산',
      count: 1,
    });
  });
});

describe('namuKoreanFor word boundaries and suffix choice', () => {
  test('block tags do not glue the preceding heading to the name', () => {
    expect(namuKoreanFor('<div>문서</div><div>사이토 도산 (斎藤道三)</div>', ja)).toEqual({
      ko: '사이토 도산',
      count: 1,
    });
  });

  test('a role word in front is not chosen when the bare name is the majority form', () => {
    const html =
      '<p>배우 사이토 도산 (斎藤道三)</p><p>사이토 도산 (斎藤道三 ; 1494)</p><p>사이토 도산 (斎藤道三 ; 1556)</p>';
    expect(namuKoreanFor(html, ja)).toEqual({ ko: '사이토 도산', count: 3 });
  });

  test('a lone surname-like suffix is returned as is', () => {
    expect(namuKoreanFor('<p>도산 (斎藤道三)</p>', ja)).toEqual({ ko: '도산', count: 1 });
  });
});

describe('lookupWikipedia', () => {
  test('uses the exact Japanese title and returns the Korean language link as an exact hit', async () => {
    const { transport, get } = fakeTransport(() => ({
      query: {
        pages: [{ title: ja, langlinks: [{ lang: 'ko', title: '사이토 도산 (무장)' }] }],
      },
    }));
    const hit = await lookupWikipedia(transport, ja, signal());
    expect(get.mock.calls[0]?.[0]).toBe(
      `https://ja.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=langlinks&lllang=ko&titles=${encodeURIComponent(ja)}`,
    );
    expect(get.mock.calls[0]?.[1]).toBe('json');
    expect(hit).toEqual({
      kind: 'wikipedia',
      ko: '사이토 도산',
      url: `https://ko.wikipedia.org/wiki/${encodeURIComponent('사이토_도산_(무장)')}`,
      note: `위키백과: ${ja} → 사이토 도산`,
      exact: true,
    });
  });

  test('a redirected title is reported in the note', async () => {
    const { transport } = fakeTransport(() => ({
      query: {
        redirects: [{ from: '斎藤道三 (戦国)', to: ja }],
        pages: [{ title: ja, langlinks: [{ lang: 'ko', title: '사이토 도산' }] }],
      },
    }));
    const hit = await lookupWikipedia(transport, '斎藤道三 (戦国)', signal());
    expect(hit?.note).toBe(`위키백과: 斎藤道三 (戦国) → ${ja} → 사이토 도산`);
    expect(hit?.ko).toBe('사이토 도산');
  });

  test('a missing page or a page without a Korean link is not a hit', async () => {
    const missing = fakeTransport(() => ({ query: { pages: [{ title: ja, missing: true }] } }));
    expect(await lookupWikipedia(missing.transport, ja, signal())).toBeNull();

    const noKorean = fakeTransport(() => ({ query: { pages: [{ title: ja }] } }));
    expect(await lookupWikipedia(noKorean.transport, ja, signal())).toBeNull();
  });

  test('an unexpected response shape is null without throwing', async () => {
    const { transport } = fakeTransport(() => ({ error: { code: 'x' } }));
    expect(await lookupWikipedia(transport, ja, signal())).toBeNull();
  });
});

describe('lookupWikidata', () => {
  test('uses the Korean label of the search hit only when the Japanese label matches exactly', async () => {
    const { transport, get } = fakeTransport((url) => {
      if (url.includes('wbsearchentities')) return { search: [{ id: 'Q123', label: ja }] };
      return { entities: { Q123: { labels: { ko: { language: 'ko', value: '사이토 도산' } } } } };
    });
    const hit = await lookupWikidata(transport, ja, signal());
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1]?.[0]).toContain('ids=Q123');
    expect(get.mock.calls[1]?.[0]).toContain('languages=ko');
    expect(hit).toEqual({
      kind: 'wikidata',
      ko: '사이토 도산',
      url: 'https://www.wikidata.org/wiki/Q123',
      note: '위키데이터 Q123: 사이토 도산',
      exact: false,
    });
  });

  test('a search hit with a different Japanese label is not used', async () => {
    const { transport, get } = fakeTransport(() => ({
      search: [{ id: 'Q9', label: '斎藤' }],
    }));
    expect(await lookupWikidata(transport, ja, signal())).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('no search result, no Korean label, or a malformed id is null', async () => {
    const empty = fakeTransport(() => ({ search: [] }));
    expect(await lookupWikidata(empty.transport, ja, signal())).toBeNull();

    const noKo = fakeTransport((url) =>
      url.includes('wbsearchentities')
        ? { search: [{ id: 'Q1', label: ja }] }
        : { entities: { Q1: { labels: {} } } },
    );
    expect(await lookupWikidata(noKo.transport, ja, signal())).toBeNull();

    const malformed = fakeTransport(() => ({ search: [{ id: 'x/../y', label: ja }] }));
    expect(await lookupWikidata(malformed.transport, ja, signal())).toBeNull();
  });
});

describe('lookupNamuwiki', () => {
  test('returns the namu search address as the evidence link with the counted Korean form', async () => {
    const { transport, get } = fakeTransport(
      () => '<p>사이토 도산 (斎藤道三)</p><p>사이토 도산 (斎藤道三 ; 1494)</p>',
    );
    const hit = await lookupNamuwiki(transport, ja, signal());
    expect(get.mock.calls[0]?.[0]).toBe(`https://namu.wiki/Search?q=${encodeURIComponent(ja)}`);
    expect(get.mock.calls[0]?.[1]).toBe('text');
    expect(hit).toEqual({
      kind: 'namuwiki',
      ko: '사이토 도산',
      url: `https://namu.wiki/Search?q=${encodeURIComponent(ja)}`,
      note: `나무위키(CC BY-NC-SA 2.0 KR) 검색: 사이토 도산 (${ja}) 2회`,
      exact: false,
    });
  });

  test('a page without the pattern, or a non-text body, is null', async () => {
    const none = fakeTransport(() => '<p>없음</p>');
    expect(await lookupNamuwiki(none.transport, ja, signal())).toBeNull();

    const object = fakeTransport(() => ({ html: '사이토 도산 (斎藤道三)' }));
    expect(await lookupNamuwiki(object.transport, ja, signal())).toBeNull();
  });
});

describe('cancellation and transport errors', () => {
  test('an aborted signal throws cancelled without calling the transport', async () => {
    const { transport, get } = fakeTransport(() => ({}));
    const control = new AbortController();
    control.abort();
    for (const lookup of [lookupWikipedia, lookupWikidata, lookupNamuwiki]) {
      await expect(lookup(transport, ja, control.signal)).rejects.toMatchObject({
        code: 'cancelled',
      });
    }
    expect(get).not.toHaveBeenCalled();
  });

  test('a transport failure passes through unchanged for the caller to handle', async () => {
    const get = vi.fn<LookupTransport['get']>(async () => {
      throw new ReaderError('connection');
    });
    await expect(lookupWikipedia({ get }, ja, signal())).rejects.toMatchObject({
      code: 'connection',
    });
  });
});
