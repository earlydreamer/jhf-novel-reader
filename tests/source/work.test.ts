// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  createRenewalSource,
  normalizeSourceInput,
  normalizeWorkPageUrl,
  parseWorkPage,
} from '../../src/source/work';
import type { SourceTransport } from '../../src/contracts';
const fixture = () =>
  '<h1 class="p-novel__title">合成の題</h1><div class="p-novel__body"><div class="p-novel__text"><p>本文</p></div></div>';

const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const chapterUrl = `${workUrl}2/`;
const toc = `<h1 class="p-novel__title">合成作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">第一話</a></div><div class="p-eplist__sublist"><a href="/n1234ab/2/">第二話</a></div>`;
const signal = new AbortController().signal;

it('최초 등록 시각을 JST에서 UTC로 변환하며 최근 개정일은 사용하지 않는다', () => {
  const page = parseWorkPage(
    `<h1 class="p-novel__title">合成作品</h1>
    <div class="p-eplist__sublist"><a href="/n1234ab/1/">一</a>
      <div class="p-eplist__update">2026/10/19 19:20<span title="2026/10/21 12:30 改稿">（改）</span></div>
    </div>
    <div class="novel_sublist2"><dd class="subtitle"><a href="/n1234ab/2/">二</a></dd>
      <dt class="long_update">2026/10/20 00:05<span title="2026/10/21 01:00 改稿">（改）</span></dt>
    </div>`,
    workUrl,
  );
  expect(page.chapters.map((chapter) => chapter.publishedAt)).toEqual([
    '2026-10-19T10:20:00.000Z',
    '2026-10-19T15:05:00.000Z',
  ]);
});

it.each(['', '2026/02/30 12:00', '2026/10/21 25:00', '不明'])(
  '등록일 %s는 추측하지 않고 생략한다',
  (date) => {
    const page = parseWorkPage(
      `<h1 class="p-novel__title">合成作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">一</a><div class="p-eplist__update">${date}<span title="2026/10/21 12:00 改稿">（改）</span></div></div>`,
      workUrl,
    );
    expect(page.chapters[0]).not.toHaveProperty('publishedAt');
  },
);
function source(html: string) {
  const requests: string[] = [];
  const transport: SourceTransport = {
    async get(url) {
      requests.push(url);
      return {
        status: 200,
        url,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        data: url === chapterUrl ? fixture() : html,
      };
    },
  };
  return { adapter: createRenewalSource(transport), requests };
}

describe('renewal work metadata and explicit source selection', () => {
  it('work_open_fetches_no_chapter', async () => {
    const { adapter, requests } = source(toc);
    const page = await adapter.getWorkPage(workUrl, signal);
    expect(requests).toEqual([workUrl]);
    expect(page).toEqual({
      workId: 'n1234ab',
      canonicalUrl: workUrl,
      title: '合成作品',
      pageUrl: workUrl,
      nextPageUrl: null,
      complete: true,
      chapters: [
        {
          workId: 'n1234ab',
          chapterId: 'n1234ab/1',
          canonicalUrl: `${workUrl}1/`,
          title: '第一話',
          ordinal: 1,
        },
        {
          workId: 'n1234ab',
          chapterId: 'n1234ab/2',
          canonicalUrl: chapterUrl,
          title: '第二話',
          ordinal: 2,
        },
      ],
    });
    const chapter = await adapter.getChapter(page.chapters[1]!, signal);
    expect(requests).toEqual([workUrl, chapterUrl]);
    expect(chapter).toMatchObject({
      canonicalUrl: chapterUrl,
      chapterId: 'n1234ab/2',
      captureKind: 'fetched',
      rawHtml: fixture(),
    });
    expect(Number.isFinite(Date.parse(chapter.fetchedAt!))).toBe(true);
  });
  it('chapter_url_preselects_exact_chapter', async () => {
    expect(normalizeSourceInput(' HTTPS://NCODE.syosetu.com/N1234AB/2#p10 ')).toEqual({
      workUrl,
      chapterUrl,
    });
    const { adapter, requests } = source(toc);
    const page = await adapter.getWorkPage(chapterUrl, signal);
    expect(requests).toEqual([workUrl]);
    expect(
      page.chapters.find(
        (chapter) => chapter.canonicalUrl === normalizeSourceInput(chapterUrl).chapterUrl,
      )?.chapterId,
    ).toBe('n1234ab/2');
  });
  it('short_story_gets_one_entry', async () => {
    const { adapter, requests } = source(
      '<p class="novel_title">短編</p><div id="novel_honbun"><p>本文</p></div>',
    );
    const page = await adapter.getWorkPage(workUrl, signal);
    expect(requests).toEqual([workUrl]);
    expect(page.chapters).toEqual([
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/short',
        canonicalUrl: workUrl,
        title: '短編',
        ordinal: 1,
      },
    ]);
    expect(page.complete).toBe(true);
  });
  it('first_page_is_not_complete_when_next_exists', async () => {
    const { adapter, requests } = source(
      `${toc}<a class="c-pager__item--next" href="?p=2">次へ</a>`,
    );
    const page = await adapter.getWorkPage(workUrl, signal);
    expect(requests).toEqual([workUrl]);
    expect(page).toMatchObject({
      pageUrl: workUrl,
      nextPageUrl: `${workUrl}?p=2`,
      complete: false,
    });
  });
  it('retains legacy TOC order and ordinal identity on later pages', async () => {
    const { adapter, requests } = source(
      '<p class="novel_title">旧作品</p><div class="novel_sublist2"><dd class="subtitle"><a href="/n1234ab/101/">百一話</a></dd></div><div class="novel_sublist2"><dd class="subtitle"><a href="/n1234ab/102/">百二話</a></dd></div>',
    );
    const page = await adapter.getWorkPage(`${workUrl}?p=2`, signal);
    expect(requests).toEqual([`${workUrl}?p=2`]);
    expect(page.complete).toBe(false);
    expect(page.chapters.map((chapter) => [chapter.chapterId, chapter.ordinal])).toEqual([
      ['n1234ab/101', 101],
      ['n1234ab/102', 102],
    ]);
  });
  it('treats a disabled next-page span as the end of the TOC without requesting it', async () => {
    const { adapter, requests } = source(
      `${toc}<span class="c-pager__item c-pager__item--next">次へ</span>`,
    );
    const page = await adapter.getWorkPage(workUrl, signal);
    expect(page.nextPageUrl).toBeNull();
    expect(page.complete).toBe(true);
    expect(requests).toEqual([workUrl]);
  });
  it('prefers an enabled next-page anchor over a disabled duplicate pager and rejects malformed anchors', async () => {
    const { adapter } = source(
      `${toc}<span class="c-pager__item--next">次へ</span><a class="c-pager__item--next" href="?p=2">次へ</a>`,
    );
    expect((await adapter.getWorkPage(workUrl, signal)).nextPageUrl).toBe(workUrl + '?p=2');
    await expect(
      source(`${toc}<a class="c-pager__item--next">次へ</a>`).adapter.getWorkPage(workUrl, signal),
    ).rejects.toMatchObject({ code: 'source_parse' });
  });
  it('unicode_ruby_blank_lines_roundtrip', async () => {
    const html =
      '<h1 class="p-novel__title">龍😀</h1><div class="p-novel__body"><div class="p-novel__text"><p>　<ruby>龍😀<rt>りゅう</rt></ruby></p><p><br></p><p>同じ</p><p>同じ</p><p></p></div></div>';
    const { adapter } = source(html);
    const page = await adapter.getWorkPage(workUrl, signal);
    const chapter = await adapter.getChapter(page.chapters[0]!, signal);
    const roundtrip = JSON.parse(JSON.stringify(chapter)) as typeof chapter;
    expect(roundtrip.paragraphs.map((paragraph) => paragraph.text)).toEqual([
      '　龍😀',
      '',
      '同じ',
      '同じ',
      '',
    ]);
    expect(roundtrip.paragraphs[0]!.ruby).toEqual([{ start: 1, end: 4, reading: 'りゅう' }]);
    expect(roundtrip.paragraphs[2]!.id).not.toBe(roundtrip.paragraphs[3]!.id);
  });
  it('does not fetch forged chapter identities', async () => {
    const { adapter, requests } = source(toc);
    await expect(
      adapter.getChapter(
        {
          workId: 'n1234ab',
          chapterId: 'n1234ab/1',
          canonicalUrl: chapterUrl,
          title: 'forged',
          ordinal: 1,
        },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'source_access' });
    expect(requests).toEqual([]);
  });
  it('rejects an unsafe next-page target instead of claiming completeness', async () => {
    const { adapter } = source(
      `${toc}<a class="c-pager__item--next" href="https://evil.test/?p=2">次へ</a>`,
    );
    await expect(adapter.getWorkPage(workUrl, signal)).rejects.toMatchObject({
      code: 'source_parse',
    });
  });
  it.each(['?p=0', '?p=-1', '?p=1.5', '?p=1&p=2', '?p=2&x=3', '?page=2', '?p=9007199254740992'])(
    'rejects work query %s',
    (query) => {
      expect(() => normalizeWorkPageUrl(workUrl + query)).toThrow();
    },
  );
  it('normalizes a positive TOC query but forbids episode query', () => {
    expect(normalizeWorkPageUrl('https://ncode.syosetu.com/N1234AB?p=2#toc')).toBe(
      `${workUrl}?p=2`,
    );
    expect(() => normalizeSourceInput(`${chapterUrl}?p=2`)).toThrow();
  });
});

describe('renewal source transport boundaries', () => {
  const chapterRef = {
    workId: 'n1234ab',
    chapterId: 'n1234ab/2',
    canonicalUrl: chapterUrl,
    title: '第二話',
    ordinal: 2,
  };
  it.each([401, 403, 429, 302, 404])('maps HTTP %s without parsing or retries', async (status) => {
    const get = vi.fn().mockResolvedValue({
      status,
      headers: { 'content-type': 'text/html' },
      data: fixture(),
      url: chapterUrl,
    });
    await expect(createRenewalSource({ get }).getChapter(chapterRef, signal)).rejects.toMatchObject(
      { code: 'source_access', status },
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
  it.each([
    { url: 'https://evil.test/' },
    { headers: { 'content-type': 'application/json' } },
    { data: {} },
    { headers: {} },
  ])('rejects invalid response %j', async (override) => {
    const get = vi.fn().mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      data: fixture(),
      url: chapterUrl,
      ...override,
    });
    await expect(createRenewalSource({ get }).getChapter(chapterRef, signal)).rejects.toMatchObject(
      { code: 'source_access' },
    );
  });
  it('validates before GET and ignores response after cancellation', async () => {
    const controller = new AbortController();
    const get = vi.fn().mockImplementation(async () => {
      controller.abort();
      return {
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: fixture(),
        url: chapterUrl,
      };
    });
    const renewal = createRenewalSource({ get });
    await expect(
      renewal.getChapter({ ...chapterRef, canonicalUrl: 'https://evil.test/' }, controller.signal),
    ).rejects.toMatchObject({ code: 'source_access' });
    expect(get).not.toHaveBeenCalled();
    await expect(renewal.getChapter(chapterRef, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(get).toHaveBeenCalledTimes(1);
    await expect(renewal.getChapter(chapterRef, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
