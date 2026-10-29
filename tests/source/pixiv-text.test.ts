// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parsePixivContent } from '../../src/source/pixivText';
import { chapterFromParagraphs } from '../../src/source/parse';

const texts = (content: string) => parsePixivContent(content).map((p) => p.text);

describe('pixiv 본문 마크업', () => {
  it('줄마다 문단을 만들고 빈 줄과 전각 들여쓰기를 보존한다', () => {
    expect(parsePixivContent('　一行目\n\n二行目 ')).toEqual([
      { text: '　一行目', ruby: [] },
      { text: '', ruby: [] },
      { text: '二行目', ruby: [] },
    ]);
    expect(texts('一\r\n二\r三')).toEqual(['一', '二', '三']);
  });

  it('루비를 본문과 읽기로 나눈다', () => {
    expect(parsePixivContent('これは[[rb:漢字 > かんじ]]です')).toEqual([
      { text: 'これは漢字です', ruby: [{ start: 3, end: 5, reading: 'かんじ' }] },
    ]);
  });

  it('쪽 나눔과 소제목을 문단으로 바꾼다', () => {
    const paragraphs = parsePixivContent('A\n[newpage]\n[chapter:第[[rb:一 > いち]]章]\nB');
    expect(paragraphs.map((p) => p.text)).toEqual(['A', '', '第一章', 'B']);
    expect(paragraphs[2]!.ruby).toEqual([{ start: 1, end: 2, reading: 'いち' }]);
  });

  it('링크와 삽화 태그를 정리한다', () => {
    expect(
      texts(
        '[jumpuri:公式 > https://example.test]を見る[pixivimage:123-1][jump:2][uploadedimage:9]',
      ),
    ).toEqual(['公式を見る']);
  });

  it('깨진 태그는 글자 그대로 둔다', () => {
    expect(parsePixivContent('[[rb:漢字')).toEqual([{ text: '[[rb:漢字', ruby: [] }]);
    expect(parsePixivContent('[unknown:x]')).toEqual([{ text: '[unknown:x]', ruby: [] }]);
  });

  it('텍스트가 없는 본문은 거부한다', async () => {
    const values = parsePixivContent('[pixivimage:1]\n[newpage]');
    await expect(
      chapterFromParagraphs(
        values,
        '題',
        {
          canonicalUrl: 'https://www.pixiv.net/novel/show.php?id=1',
          workId: 'pixiv-n1',
          chapterId: 'pixiv-n1/1',
        },
        { prevUrl: null, nextUrl: null },
      ),
    ).rejects.toMatchObject({ code: 'source_parse' });
  });

  it('너무 긴 본문은 거부한다', () => {
    expect(() => parsePixivContent('あ'.repeat(2_000_001))).toThrow(
      expect.objectContaining({ code: 'source_parse' }),
    );
  });
});
