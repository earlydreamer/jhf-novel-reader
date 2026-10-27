// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  isPixivChapterId,
  normalizePixivUrl,
  pixivChapter,
  pixivSeriesPage,
  pixivSinglePage,
  readPixivNovel,
  readPixivSeries,
} from '../../src/source/pixiv';
import type { ChapterRef } from '../../src/contracts/reading';

const show = (id: string) => `https://www.pixiv.net/novel/show.php?id=${id}`;
const seriesUrl = (id: string) => `https://www.pixiv.net/novel/series/${id}`;

export function novelJson(overrides: Record<string, unknown> = {}) {
  return {
    error: false,
    message: '',
    body: {
      id: '5',
      title: ' 第一話 ',
      content: '　合成の本文[[rb:漢字 > かんじ]]。\n\n二行目',
      language: 'ja',
      xRestrict: 0,
      isLoginOnly: false,
      createDate: '2026-10-25T15:01:05+00:00',
      seriesNavData: {
        seriesId: 1,
        prev: null,
        next: { id: '6', title: '第二話', order: 2, available: true },
      },
      ...overrides,
    },
  };
}
export function seriesJson(overrides: Record<string, unknown> = {}) {
  return {
    error: false,
    message: '',
    body: {
      id: '1',
      title: '合成シリーズ',
      language: 'ja',
      xRestrict: 0,
      maxXRestrict: null,
      publishedContentCount: 3,
      ...overrides,
    },
  };
}
export function titlesJson(
  entries: { id: string; title: string; available: boolean }[] = [
    { id: '5', title: '第一話', available: true },
    { id: '6', title: '第二話', available: true },
    { id: '7', title: '第三話', available: true },
  ],
) {
  return { error: false, message: '', body: entries };
}
const ref = (chapterId: string, novelId: string): ChapterRef => ({
  workId: chapterId.split('/')[0]!,
  chapterId,
  canonicalUrl: show(novelId),
  title: '題',
  ordinal: 1,
});

describe('pixiv 규칙', () => {
  it('주소를 정규화하고 잘못된 주소를 거부한다', () => {
    expect(normalizePixivUrl('https://pixiv.net/novel/series/12/#x')).toBe(seriesUrl('12'));
    expect(normalizePixivUrl(' https://www.pixiv.net/novel/show.php?id=34 ')).toBe(show('34'));
    for (const bad of [
      'https://www.pixiv.net/novel/show.php?id=34&lang=ja',
      'http://www.pixiv.net/novel/show.php?id=34',
      'https://www.pixiv.net/novel/show.php?id=034',
      'https://www.pixiv.net:8443/novel/series/1',
      'https://user@www.pixiv.net/novel/series/1',
      'https://www.pixiv.net/novel/series/1/../2',
      'https://www.pixiv.net/novel/series/%31',
      'https://i.pximg.net/novel/series/1',
      'https://www.pixiv.net/artworks/1',
    ])
      expect(() => normalizePixivUrl(bad), bad).toThrow(
        expect.objectContaining({ code: 'source_access' }),
      );
  });

  it('시리즈 목차는 공개 회차만 빈칸 없는 순번으로 담는다', () => {
    const series = readPixivSeries(
      seriesJson(),
      titlesJson([
        { id: '5', title: '第一話', available: true },
        { id: '6', title: '非公開', available: false },
        { id: '7', title: ' 第三話 ', available: true },
      ]),
    );
    const page = pixivSeriesPage(series);
    expect(page).toMatchObject({
      workId: 'pixiv-s1',
      canonicalUrl: seriesUrl('1'),
      pageUrl: seriesUrl('1'),
      title: '合成シリーズ',
      nextPageUrl: null,
      complete: true,
    });
    expect(page.chapters).toEqual([
      {
        workId: 'pixiv-s1',
        chapterId: 'pixiv-s1/5',
        canonicalUrl: show('5'),
        title: '第一話',
        ordinal: 1,
      },
      {
        workId: 'pixiv-s1',
        chapterId: 'pixiv-s1/7',
        canonicalUrl: show('7'),
        title: '第三話',
        ordinal: 2,
      },
    ]);
  });

  it('공개 회차 수와 목차가 다르면 거부한다', () => {
    expect(() => readPixivSeries(seriesJson({ publishedContentCount: 4 }), titlesJson())).toThrow(
      expect.objectContaining({ code: 'source_parse' }),
    );
    const duplicate = titlesJson([
      { id: '5', title: 'a', available: true },
      { id: '5', title: 'b', available: true },
      { id: '7', title: 'c', available: true },
    ]);
    expect(() => readPixivSeries(seriesJson(), duplicate)).toThrow(
      expect.objectContaining({ code: 'source_parse' }),
    );
  });

  it('로그인 전용·성인·비일본어 작품은 지원하지 않는다', () => {
    for (const overrides of [{ isLoginOnly: true }, { xRestrict: 1 }, { language: 'zh-cn' }])
      expect(() => readPixivNovel(novelJson(overrides))).toThrow(
        expect.objectContaining({ code: 'source_unsupported' }),
      );
    for (const overrides of [{ maxXRestrict: 1 }, { xRestrict: 2 }, { language: 'en' }])
      expect(() => readPixivSeries(seriesJson(overrides), titlesJson())).toThrow(
        expect.objectContaining({ code: 'source_unsupported' }),
      );
  });

  it('없는 작품 응답은 접근 오류다', () => {
    expect(() => readPixivNovel({ error: true, message: '', body: [] })).toThrow(
      expect.objectContaining({ code: 'source_access' }),
    );
    expect(() => readPixivSeries({ error: true, body: [] }, titlesJson())).toThrow(
      expect.objectContaining({ code: 'source_access' }),
    );
  });

  it('단독 작품은 한 화짜리 작품이다', () => {
    const novel = readPixivNovel(novelJson({ id: '9', seriesNavData: null }));
    expect(novel.seriesId).toBeNull();
    expect(pixivSinglePage(novel)).toEqual({
      workId: 'pixiv-n9',
      canonicalUrl: show('9'),
      pageUrl: show('9'),
      title: '第一話',
      nextPageUrl: null,
      complete: true,
      chapters: [
        {
          workId: 'pixiv-n9',
          chapterId: 'pixiv-n9/9',
          canonicalUrl: show('9'),
          title: '第一話',
          ordinal: 1,
          publishedAt: '2026-10-25T15:01:05.000Z',
        },
      ],
    });
  });

  it('본문을 문단·루비와 시리즈 이웃 회차로 만든다', async () => {
    const chapter = await pixivChapter(readPixivNovel(novelJson()), ref('pixiv-s1/5', '5'));
    expect(chapter).toMatchObject({
      workId: 'pixiv-s1',
      chapterId: 'pixiv-s1/5',
      canonicalUrl: show('5'),
      title: '第一話',
      prevUrl: null,
      nextUrl: show('6'),
    });
    expect(chapter.paragraphs.map((p) => p.text)).toEqual(['　合成の本文漢字。', '', '二行目']);
    expect(chapter.paragraphs[0]!.ruby).toEqual([{ start: 6, end: 8, reading: 'かんじ' }]);
  });

  it('다른 시리즈를 가리키는 본문은 거부한다', async () => {
    await expect(
      pixivChapter(
        readPixivNovel(novelJson({ seriesNavData: { seriesId: 2, prev: null, next: null } })),
        ref('pixiv-s1/5', '5'),
      ),
    ).rejects.toMatchObject({ code: 'source_parse' });
    await expect(
      pixivChapter(readPixivNovel(novelJson()), ref('pixiv-n5/5', '5')),
    ).rejects.toMatchObject({ code: 'source_parse' });
    await expect(
      pixivChapter(readPixivNovel(novelJson({ id: '8' })), ref('pixiv-s1/5', '5')),
    ).rejects.toMatchObject({ code: 'source_parse' });
  });

  it('회차 ID는 단독 작품에서 숫자가 같아야 한다', () => {
    expect(isPixivChapterId('pixiv-n5/5')).toBe(true);
    expect(isPixivChapterId('pixiv-s1/5')).toBe(true);
    expect(isPixivChapterId('pixiv-n5/6')).toBe(false);
    expect(isPixivChapterId('pixiv-s01/5')).toBe(false);
    expect(isPixivChapterId('kakuyomu-1/2')).toBe(false);
  });
});
