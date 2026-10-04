// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createRenewalSource,
  normalizeSourceInput,
  normalizeWorkPageUrl,
} from '../../src/source/work';
import type { SourceTransport } from '../../src/contracts';
const fixture = () =>
  '<h1 class="p-novel__title">合成の題</h1><div class="p-novel__body"><div class="p-novel__text"><p>本文</p></div></div>';

const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const chapterUrl = `${workUrl}2/`;
const toc = `<h1 class="p-novel__title">合成作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">第一話</a></div><div class="p-eplist__sublist"><a href="/n1234ab/2/">第二話</a></div>`;
const signal = new AbortController().signal;
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
