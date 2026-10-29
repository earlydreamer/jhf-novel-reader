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
import {
  SOURCE_HOST_MIN_INTERVAL_MS,
  createRenewalSource,
  isSourceWorkPageUrl,
  normalizeSourceInput,
  sourceWorkId,
  sourceWorkUrl,
} from '../../src/source/sites';
import { createLibraryStore } from '../../src/storage/library';
import { chapterIdentity, workPage } from '../../src/storage/readingValidation';
import type { CompletedTranslation, SourceTransport } from '../../src/contracts';
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

const signal = new AbortController().signal;
const api = (path: string) => `https://www.pixiv.net/ajax/novel/${path}`;
function jsonTransport(responses: Record<string, unknown>, contentType = 'application/json') {
  const requests: string[] = [];
  const transport: SourceTransport = {
    async get(url) {
      requests.push(url);
      if (!(url in responses))
        return { status: 404, url, headers: {} as Record<string, string>, data: '' };
      return {
        status: 200,
        url,
        headers: { 'Content-Type': `${contentType}; charset=utf-8` },
        data: responses[url],
      };
    },
  };
  return { transport, requests };
}
const seriesResponses = {
  [api('5')]: novelJson(),
  [api('series/1')]: seriesJson(),
  [api('series/1/content_titles')]: titlesJson(),
};

describe('원문 경로', () => {
  it('시리즈 회차 주소는 시리즈를 열고 그 회차를 고른다', async () => {
    const { transport, requests } = jsonTransport(seriesResponses);
    const input = normalizeSourceInput('https://www.pixiv.net/novel/show.php?id=5');
    expect(input).toEqual({ workUrl: show('5'), chapterUrl: show('5') });
    const page = await createRenewalSource(transport).getWorkPage(input.chapterUrl!, signal);
    expect(requests).toEqual([api('5'), api('series/1'), api('series/1/content_titles')]);
    expect(page.workId).toBe('pixiv-s1');
    expect(page.chapters.find((chapter) => chapter.canonicalUrl === show('5'))?.chapterId).toBe(
      'pixiv-s1/5',
    );
  });

  it('시리즈 주소는 시리즈 정보와 목차만 요청한다', async () => {
    const { transport, requests } = jsonTransport(seriesResponses);
    const page = await createRenewalSource(transport).getWorkPage(seriesUrl('1'), signal);
    expect(requests).toEqual([api('series/1'), api('series/1/content_titles')]);
    expect(page.chapters.map((chapter) => chapter.ordinal)).toEqual([1, 2, 3]);
  });

  it('단독 작품은 요청 한 번으로 한 화짜리 작품이 된다', async () => {
    const { transport, requests } = jsonTransport({
      [api('7')]: novelJson({ id: '7', seriesNavData: null }),
    });
    const page = await createRenewalSource(transport).getWorkPage(show('7'), signal);
    expect(requests).toEqual([api('7')]);
    expect(page.workId).toBe('pixiv-n7');
    expect(page.chapters).toHaveLength(1);
  });

  it('위조된 회차 참조는 요청하지 않고 맞는 참조만 본문을 받는다', async () => {
    const { transport, requests } = jsonTransport(seriesResponses);
    const source = createRenewalSource(transport);
    const first = (await source.getWorkPage(seriesUrl('1'), signal)).chapters[0]!;
    requests.length = 0;
    for (const forged of [
      { ...first, workId: 'pixiv-s2' },
      { ...first, chapterId: 'pixiv-s2/5' },
      { ...first, chapterId: 'pixiv-s1/6' },
      { ...first, ordinal: 0 },
      { ...first, canonicalUrl: seriesUrl('1') },
    ])
      await expect(source.getChapter(forged, signal)).rejects.toMatchObject({
        code: 'source_access',
      });
    expect(requests).toEqual([]);
    const snapshot = await source.getChapter(first, signal);
    expect(requests).toEqual([api('5')]);
    expect(snapshot).toMatchObject({ chapterId: 'pixiv-s1/5', captureKind: 'fetched' });
    expect(JSON.parse(snapshot.rawHtml!)).toEqual(novelJson());
  });

  it('HTML이나 다른 형식의 응답은 거부한다', async () => {
    const { transport } = jsonTransport(seriesResponses, 'text/html');
    await expect(
      createRenewalSource(transport).getWorkPage(show('5'), signal),
    ).rejects.toMatchObject({ code: 'source_access' });
  });

  it('없는 작품은 접근 오류로 끝난다', async () => {
    const { transport } = jsonTransport({});
    await expect(
      createRenewalSource(transport).getWorkPage(show('9'), signal),
    ).rejects.toMatchObject({ code: 'source_access', status: 404 });
  });

  it('pixiv 원문 요청 간격은 2초다', () => {
    expect(SOURCE_HOST_MIN_INTERVAL_MS['www.pixiv.net']).toBe(2000);
  });

  it('pixiv.net 주소도 같은 작품으로 연다', () => {
    expect(normalizeSourceInput('https://pixiv.net/novel/series/1')).toEqual({
      workUrl: seriesUrl('1'),
    });
  });
});

describe('pixiv 저장 호환', () => {
  it('회차 ID와 목차가 저장 검증을 통과하고 다른 사이트 형식과 섞이지 않는다', async () => {
    expect(() => chapterIdentity('pixiv-s1/5')).not.toThrow();
    expect(() => chapterIdentity('pixiv-n7/7')).not.toThrow();
    for (const value of ['pixiv-n7/8', 'pixiv-s1', 'pixiv-x1/5'])
      expect(() => chapterIdentity(value)).toThrow();
    const page = pixivSeriesPage(readPixivSeries(seriesJson(), titlesJson()));
    await expect(workPage(structuredClone(page))).resolves.toEqual(page);
    const single = pixivSinglePage(readPixivNovel(novelJson({ id: '7', seriesNavData: null })));
    await expect(workPage(structuredClone(single))).resolves.toEqual(single);
    // 쿼리는 사이트가 정규화한 주소와 정확히 같을 때만 허용한다.
    for (const canonicalUrl of [
      `${show('5')}&x=1`,
      'https://kakuyomu.jp/works/1?x=1',
      'https://pixiv.net/novel/show.php?id=5',
    ])
      await expect(
        workPage({ ...page, chapters: [{ ...page.chapters[0]!, canonicalUrl }] }),
      ).rejects.toThrow();
    expect(isSourceWorkPageUrl(seriesUrl('1'), 'pixiv-s1')).toBe(true);
    expect(isSourceWorkPageUrl(show('1'), 'pixiv-s1')).toBe(false);
    expect(sourceWorkId(show('5'))).toBeNull();
    expect(sourceWorkId(seriesUrl('1'))).toBe('pixiv-s1');
    expect(sourceWorkUrl('pixiv-n7')).toBe(show('7'));
    expect(sourceWorkUrl('pixiv-s1')).toBe(seriesUrl('1'));
  });

  it('완성 번역·읽기 위치·목차가 재시작 뒤에도 같은 ID로 유지된다', async () => {
    const memory = new Map<string, string>();
    const files = {
      read: async (path: string) => memory.get(path) ?? null,
      write: async (path: string, text: string) => {
        memory.set(path, text);
      },
    };
    const page = pixivSeriesPage(readPixivSeries(seriesJson(), titlesJson()));
    const chapter = await pixivChapter(readPixivNovel(novelJson()), page.chapters[0]!);
    const version: CompletedTranslation = {
      schemaVersion: 2,
      versionId: 'version-1',
      source: {
        ...chapter,
        captureKind: 'fetched',
        rawHtml: JSON.stringify(novelJson()),
        fetchedAt: '2026-10-27T00:00:00Z',
      },
      text: '번역',
      blocks: [{ id: 'block-1', text: '번역' }],
      createdAt: '2026-10-27T00:00:00Z',
      provenance: {
        provider: 'openai-compatible',
        connectionId: 'local',
        modelId: 'synthetic',
        contractVersion: 'plain-v1',
        promptVersion: 'hymt2-ko-v1',
        languageDirection: 'ja-ko',
      },
    };
    const store = createLibraryStore(files);
    await store.saveWorkPage(page);
    await store.commitVersion(version);
    await store.savePosition({
      workId: chapter.workId,
      chapterId: chapter.chapterId,
      versionId: version.versionId,
      blockId: 'block-1',
      offset: 1,
    });
    const restarted = createLibraryStore(files);
    expect(await restarted.listVersions(chapter.chapterId)).toEqual([version]);
    expect((await restarted.readPosition(version.versionId))?.chapterId).toBe(chapter.chapterId);
    expect((await restarted.readWork(chapter.workId))[0]?.chapters.map((c) => c.ordinal)).toEqual([
      1, 2, 3,
    ]);
  });
});
