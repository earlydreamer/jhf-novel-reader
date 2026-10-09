// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseChapter, parseWork, normalizeSourceUrl } from '../../src/source/parse';
import { createParagraphId } from '../../src/contracts';
export const url = 'https://ncode.syosetu.com/n1234ab/2/';
export const fixture = (
  body = '<p>　光と<ruby>空<rp>（</rp><rt>そら</rt><rp>）</rp></ruby>。</p><p><br></p><p>二行<br>続き &amp; 三</p>',
) =>
  `<h1 class="p-novel__title"> 合成の題 </h1><div class="p-novel__body"><div class="p-novel__text p-novel__text--preface">前書き</div><div class="p-novel__text">${body}</div><div class="p-novel__text p-novel__text--afterword">後書き</div></div><a class="c-pager__item--before" href="../1/">前へ</a><a class="c-pager__item--next" href="../3/">次へ</a>`;
describe('chapter extraction from synthetic HTML', () => {
  it('extracts ordered text, ruby, metadata, neighbors and stable contract IDs', async () => {
    const result = await parseChapter(fixture(), url);
    expect(result).toMatchObject({
      canonicalUrl: url,
      workId: 'n1234ab',
      chapterId: 'n1234ab/2',
      title: '合成の題',
      prevUrl: url.replace('/2/', '/1/'),
      nextUrl: url.replace('/2/', '/3/'),
    });
    expect(result.paragraphs.map((p) => p.text)).toEqual(['　光と空。', '', '二行\n続き & 三']);
    expect(result.paragraphs[0]!.ruby).toEqual([{ start: 3, end: 4, reading: 'そら' }]);
    expect(result.paragraphs[0]!.id).toBe(
      await createParagraphId(result.chapterId, 0, result.paragraphs[0]!),
    );
    expect(await parseChapter(fixture(), url)).toEqual(result);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('changes hashes for text and ruby changes and separates duplicate paragraphs', async () => {
    const a = await parseChapter(fixture('<p>同じ</p><p>同じ</p>'), url);
    expect(a.paragraphs[0]!.id).not.toBe(a.paragraphs[1]!.id);
    expect((await parseChapter(fixture('<p>違う</p>'), url)).sourceHash).not.toBe(a.sourceHash);
    expect((await parseChapter(fixture(), url)).sourceHash).not.toBe(
      (await parseChapter(fixture().replace('そら', 'くう'), url)).sourceHash,
    );
  });
  it('supports legacy content and standalone short stories', async () => {
    const a = await parseChapter(
      '<p class="novel_subtitle">短編</p><div id="novel_honbun"><p>合成本文</p></div>',
      'https://ncode.syosetu.com/n1234ab/',
    );
    expect(a.chapterId).toBe('n1234ab/short');
    expect(a.nextUrl).toBeNull();
    expect(a.prevUrl).toBeNull();
  });
  it.each([
    '',
    '<h1>changed</h1><div>body</div>',
    fixture('<p><br></p>'),
    fixture().replace('p-novel__title', 'changed'),
  ])('fails closed on missing or changed structure', async (html) => {
    await expect(parseChapter(html, url)).rejects.toMatchObject({ code: 'source_parse' });
  });
  it('preserves long paragraphs and UTF-16 ruby offsets', async () => {
    const a = await parseChapter(
      fixture(`<p>😀<ruby>星<rt>ほし</rt></ruby>${'あ'.repeat(20000)}</p>`),
      url,
    );
    expect(a.paragraphs[0]!.text.length).toBe(20003);
    expect(a.paragraphs[0]!.ruby).toEqual([{ start: 2, end: 3, reading: 'ほし' }]);
  });
  it('parses only safe same-work TOC entries without following pagination', () => {
    const a = parseWork(
      '<h1 class="p-novel__title">作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">第一話</a></div><div class="p-eplist__sublist"><a href="https://evil.test/">外</a></div><a class="c-pager__item--last" href="?p=40">最後</a>',
      'https://ncode.syosetu.com/n1234ab/',
    );
    expect(a).toEqual({
      title: '作品',
      workId: 'n1234ab',
      chapters: [{ title: '第一話', url: 'https://ncode.syosetu.com/n1234ab/1/' }],
    });
  });
  it('normalizes supported hosts, work code casing, fragment and trailing slash', () => {
    expect(normalizeSourceUrl('  https://NCODE.syosetu.com/N1234AB/2#p2 ')).toBe(url);
  });
});
it('fails closed rather than silently truncating mixed paragraph/container text', async () => {
  await expect(parseChapter(fixture('失う本文<p>残る本文</p>'), url)).rejects.toMatchObject({
    code: 'source_parse',
  });
});
it('supports multiple ruby base-reading pairs without including fallback punctuation', async () => {
  const a = await parseChapter(
    fixture('<p><ruby>青<rt>あお</rt>空<rt>ぞら</rt></ruby>へ</p>'),
    url,
  );
  expect(a.paragraphs[0]!.text).toBe('青空へ');
  expect(a.paragraphs[0]!.ruby).toEqual([
    { start: 0, end: 1, reading: 'あお' },
    { start: 1, end: 2, reading: 'ぞら' },
  ]);
});
it('rejects oversized HTML before parsing', async () => {
  await expect(parseChapter('x'.repeat(2_000_001), url)).rejects.toMatchObject({
    code: 'source_parse',
  });
});
