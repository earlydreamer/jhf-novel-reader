// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseKakuyomuChapter, parseKakuyomuWorkPage } from '../../src/source/kakuyomu';
import {
  createRenewalSource,
  normalizeSourceInput,
  normalizeWorkPageUrl,
  sourceWorkId,
  sourceWorkUrl,
} from '../../src/source/sites';
import { createLibraryStore } from '../../src/storage/library';
import { chapterIdentity, workPage } from '../../src/storage/readingValidation';
import type { CompletedTranslation, SourceTransport } from '../../src/contracts';

// Number로 바꾸면 정밀도가 깨지는 길이의 합성 ID.
const WORK = '16816452219389165420';
const EP = ['16816452219389165421', '16816452219389165499', '16816452219389165430'];
const workUrl = `https://kakuyomu.jp/works/${WORK}`;
const episodeUrl = (id: string) => `${workUrl}/episodes/${id}`;
const signal = new AbortController().signal;

type State = Record<string, unknown>;
function apolloState(overrides: (state: State) => void = () => {}): State {
  const state: State = {
    // 객체 나열 순서를 목차와 다르게 둬서 tableOfContentsV2 순서를 따르는지 확인한다.
    [`Episode:${EP[2]}`]: { __typename: 'Episode', id: EP[2], title: '第三話', publishedAt: null },
    [`Episode:${EP[0]}`]: {
      __typename: 'Episode',
      id: EP[0],
      title: ' 第一話\n',
      publishedAt: '2026-10-19T10:20:00Z',
    },
    [`Episode:${EP[1]}`]: {
      __typename: 'Episode',
      id: EP[1],
      title: '第二話',
      publishedAt: '2026-10-20T00:00:00.000Z',
    },
    'TableOfContentsChapter:b': {
      __typename: 'TableOfContentsChapter',
      chapter: { __ref: 'Chapter:b' },
      episodeUnions: [{ __ref: `Episode:${EP[1]}` }, { __ref: `Episode:${EP[2]}` }],
    },
    'TableOfContentsChapter:a': {
      __typename: 'TableOfContentsChapter',
      chapter: null,
      episodeUnions: [{ __ref: `Episode:${EP[0]}` }],
    },
    'Chapter:b': { __typename: 'Chapter', id: 'b', level: 1, title: '第一章' },
    [`Work:${WORK}`]: {
      __typename: 'Work',
      id: WORK,
      title: '合成作品',
      publicEpisodeCount: 3,
      tableOfContentsV2: [
        { __ref: 'TableOfContentsChapter:a' },
        { __ref: 'TableOfContentsChapter:b' },
      ],
    },
  };
  overrides(state);
  return state;
}
function workHtml(state: State = apolloState(), title = '合成作品 - カクヨム'): string {
  const json = JSON.stringify({ props: { pageProps: { __APOLLO_STATE__: state } } });
  return `<html><head><title>${title}</title></head><body><h1>合成作品</h1><script id="__NEXT_DATA__" type="application/json">${json}</script></body></html>`;
}
function work(state: State): State {
  return state[`Work:${WORK}`] as State;
}
const chapterHtml = (prev = '', next = `/works/${WORK}/episodes/${EP[1]}`) =>
  `<title>第一話 - 合成作品 - カクヨム</title>
  <p class="chapterTitle level1">第一章</p>
  <p class="widget-episodeTitle js-vertical-composition-item">第一話</p>
  <div class="widget-episodeBody js-episode-body">
    <p id="p1">　<ruby><rb>合成</rb><rp>（</rp><rt>ごうせい</rt><rp>）</rp></ruby>の本文</p>
    <p id="p2" class="blank"><br /></p>
    <p id="p3">次の行</p>
  </div>
  ${prev ? `<a id="contentMain-readPreviousEpisode" href="${prev}">前</a>` : ''}
  ${next ? `<a id="contentMain-readNextEpisode" href="${next}">次</a>` : ''}`;

describe('카쿠요무 목차', () => {
  it('tableOfContentsV2 순서로 회차를 읽고 사이트 ID와 읽는 순번을 분리한다', () => {
    const page = parseKakuyomuWorkPage(workHtml(), `${workUrl}/`);
    expect(page).toEqual({
      workId: `kakuyomu-${WORK}`,
      canonicalUrl: workUrl,
      title: '合成作品',
      pageUrl: workUrl,
      nextPageUrl: null,
      complete: true,
      chapters: [
        {
          workId: `kakuyomu-${WORK}`,
          chapterId: `kakuyomu-${WORK}/${EP[0]}`,
          canonicalUrl: episodeUrl(EP[0]!),
          title: '第一話',
          ordinal: 1,
          publishedAt: '2026-10-19T10:20:00.000Z',
        },
        {
          workId: `kakuyomu-${WORK}`,
          chapterId: `kakuyomu-${WORK}/${EP[1]}`,
          canonicalUrl: episodeUrl(EP[1]!),
          title: '第二話',
          ordinal: 2,
          publishedAt: '2026-10-20T00:00:00.000Z',
        },
        {
          workId: `kakuyomu-${WORK}`,
          chapterId: `kakuyomu-${WORK}/${EP[2]}`,
          canonicalUrl: episodeUrl(EP[2]!),
          title: '第三話',
          ordinal: 3,
        },
      ],
    });
  });

  it.each<[string, (state: State) => void]>([
    [
      '중복 회차',
      (state) => {
        work(state).publicEpisodeCount = 4;
        (state['TableOfContentsChapter:a'] as State).episodeUnions = [
          { __ref: `Episode:${EP[0]}` },
          { __ref: `Episode:${EP[1]}` },
        ];
      },
    ],
    ['공개 회차 수와 다른 목차', (state) => (work(state).publicEpisodeCount = 4)],
    ['공개 회차 수 누락', (state) => delete work(state).publicEpisodeCount],
    ['공개 회차 수 null', (state) => (work(state).publicEpisodeCount = null)],
    ['문자열 공개 회차 수', (state) => (work(state).publicEpisodeCount = '3')],
    ['논리값 공개 회차 수', (state) => (work(state).publicEpisodeCount = true)],
    ['소수 공개 회차 수', (state) => (work(state).publicEpisodeCount = 3.5)],
    ['0인 공개 회차 수', (state) => (work(state).publicEpisodeCount = 0)],
    ['음수 공개 회차 수', (state) => (work(state).publicEpisodeCount = -1)],
    [
      '안전한 정수 범위를 넘는 공개 회차 수',
      (state) => (work(state).publicEpisodeCount = Number.MAX_SAFE_INTEGER + 1),
    ],
    ['빈 목차', (state) => (work(state).tableOfContentsV2 = [])],
    ['없는 회차 참조', (state) => delete state[`Episode:${EP[2]}`]],
    [
      '참조와 다른 회차 ID',
      (state) => ((state[`Episode:${EP[2]}`] as State).id = '16816452219389165431'),
    ],
    ['다른 작품의 상태', (state) => (work(state).id = '1')],
    ['빈 제목', (state) => (work(state).title = ' ')],
    [
      '잘못된 형식의 참조',
      (state) => (work(state).tableOfContentsV2 = [{ __ref: `Episode:${EP[0]}` }]),
    ],
  ])('%s는 불완전한 목차로 저장하지 않는다', (_name, change) => {
    expect(() => parseKakuyomuWorkPage(workHtml(apolloState(change)), workUrl)).toThrow(
      expect.objectContaining({ code: 'source_parse' }),
    );
  });

  it('구조화 데이터가 없거나 손상되면 거부한다', () => {
    expect(() => parseKakuyomuWorkPage('<title>合成</title><h1>合成</h1>', workUrl)).toThrow(
      expect.objectContaining({ code: 'source_parse' }),
    );
    expect(() =>
      parseKakuyomuWorkPage(
        '<script id="__NEXT_DATA__" type="application/json">{"props":</script>',
        workUrl,
      ),
    ).toThrow(expect.objectContaining({ code: 'source_parse' }));
  });

  it('로그인·접근 제한 화면은 목차 파싱 전에 접근 오류로 처리한다', () => {
    expect(() => parseKakuyomuWorkPage(workHtml(apolloState(), 'ログイン'), workUrl)).toThrow(
      expect.objectContaining({ code: 'source_access' }),
    );
  });
});

describe('카쿠요무 본문', () => {
  it('문단·루비·빈 줄과 이전·다음 회차를 보존한다', async () => {
    const chapter = await parseKakuyomuChapter(
      chapterHtml(`/works/${WORK}/episodes/${EP[2]}`),
      episodeUrl(EP[0]!),
    );
    expect(chapter).toMatchObject({
      canonicalUrl: episodeUrl(EP[0]!),
      workId: `kakuyomu-${WORK}`,
      chapterId: `kakuyomu-${WORK}/${EP[0]}`,
      title: '第一話',
      prevUrl: episodeUrl(EP[2]!),
      nextUrl: episodeUrl(EP[1]!),
    });
    expect(chapter.paragraphs.map((p) => p.text)).toEqual(['　合成の本文', '', '次の行']);
    expect(chapter.paragraphs[0]!.ruby).toEqual([{ start: 1, end: 3, reading: 'ごうせい' }]);
    expect(chapter.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('다른 작품이나 자기 자신을 가리키는 이웃 링크는 버린다', async () => {
    const chapter = await parseKakuyomuChapter(
      chapterHtml(`/works/1/episodes/2`, `/works/${WORK}/episodes/${EP[0]}`),
      episodeUrl(EP[0]!),
    );
    expect(chapter.prevUrl).toBeNull();
    expect(chapter.nextUrl).toBeNull();
  });

  it('본문 컨테이너가 하나가 아니거나 문단 밖 본문이 있으면 거부한다', async () => {
    await expect(
      parseKakuyomuChapter(
        chapterHtml().replace('widget-episodeBody', 'other'),
        episodeUrl(EP[0]!),
      ),
    ).rejects.toMatchObject({ code: 'source_parse' });
    await expect(
      parseKakuyomuChapter(
        chapterHtml().replace('<p id="p3">', 'stray<p id="p3">'),
        episodeUrl(EP[0]!),
      ),
    ).rejects.toMatchObject({ code: 'source_parse' });
  });
});

describe('사이트 경계', () => {
  it('회차 주소는 선택을 유지하고 목차는 작품 주소에서 가져온다', () => {
    expect(normalizeSourceInput(`${episodeUrl(EP[1]!)}/#top`)).toEqual({
      workUrl,
      chapterUrl: episodeUrl(EP[1]!),
    });
    expect(normalizeSourceInput(`${workUrl}/`)).toEqual({ workUrl });
    expect(normalizeWorkPageUrl(workUrl)).toBe(workUrl);
    expect(() => normalizeWorkPageUrl(episodeUrl(EP[0]!))).toThrow();
    expect(sourceWorkId(episodeUrl(EP[0]!))).toBe(`kakuyomu-${WORK}`);
    expect(sourceWorkId('https://ncode.syosetu.com/N1234AB/2/')).toBe('n1234ab');
    expect(sourceWorkUrl(`kakuyomu-${WORK}`)).toBe(workUrl);
  });

  it.each([
    `http://kakuyomu.jp/works/${WORK}`,
    `https://kakuyomu.jp:8443/works/${WORK}`,
    `https://user@kakuyomu.jp/works/${WORK}`,
    `https://kakuyomu.jp/works/${WORK}?utm=x`,
    `https://kakuyomu.jp/works/0${WORK}`,
    `https://kakuyomu.jp/works/${WORK}/episodes/`,
    `https://kakuyomu.jp/works/%31`,
    `https://kakuyomu.jp/works/${WORK}/../1`,
    `https://cdn-static.kakuyomu.jp/works/${WORK}`,
    `https://kakuyomu.jp.evil.test/works/${WORK}`,
    `https://kakuyomu.jp/users/${WORK}`,
  ])('%s는 요청 전에 거부한다', (input) => {
    expect(() => normalizeSourceInput(input)).toThrow(
      expect.objectContaining({ code: 'source_access' }),
    );
    expect(sourceWorkId(input)).toBeNull();
  });

  it('작품 주소로 목차를 한 번만 요청하고 위조된 회차 참조는 요청하지 않는다', async () => {
    const requests: string[] = [];
    const transport: SourceTransport = {
      async get(url) {
        requests.push(url);
        return {
          status: 200,
          url,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          data: url === workUrl ? workHtml() : chapterHtml(),
        };
      },
    };
    const source = createRenewalSource(transport);
    const page = await source.getWorkPage(episodeUrl(EP[0]!), signal);
    expect(requests).toEqual([workUrl]);
    const first = page.chapters[0]!;
    for (const forged of [
      { ...first, workId: 'kakuyomu-1' },
      { ...first, chapterId: `kakuyomu-${WORK}/${EP[1]}` },
      { ...first, ordinal: 0 },
      { ...first, canonicalUrl: workUrl },
    ])
      await expect(source.getChapter(forged, signal)).rejects.toMatchObject({
        code: 'source_access',
      });
    expect(requests).toEqual([workUrl]);
    const snapshot = await source.getChapter(first, signal);
    expect(requests).toEqual([workUrl, episodeUrl(EP[0]!)]);
    expect(snapshot).toMatchObject({ chapterId: first.chapterId, captureKind: 'fetched' });
  });
});

describe('저장 호환', () => {
  it('카쿠요무 회차 ID는 저장 검증을 통과하고 나로우 형식과 섞이지 않는다', async () => {
    expect(() => chapterIdentity(`kakuyomu-${WORK}/${EP[0]}`)).not.toThrow();
    expect(() => chapterIdentity('n1234ab/2')).not.toThrow();
    for (const value of [`kakuyomu-${WORK}/short`, `${WORK}/${EP[0]}`, `kakuyomu-${WORK}`])
      expect(() => chapterIdentity(value)).toThrow();
    const page = parseKakuyomuWorkPage(workHtml(), workUrl);
    await expect(workPage(structuredClone(page))).resolves.toEqual(page);
    await expect(workPage({ ...page, pageUrl: `${workUrl}?p=2` })).rejects.toThrow();
    await expect(
      workPage({ ...page, workId: 'n1234ab', chapters: [], pageUrl: workUrl }),
    ).rejects.toThrow();
  });

  it('완성 번역·읽기 위치·목차가 재시작 뒤에도 같은 ID로 유지된다', async () => {
    const memory = new Map<string, string>();
    const files = {
      read: async (path: string) => memory.get(path) ?? null,
      write: async (path: string, text: string) => {
        memory.set(path, text);
      },
    };
    const chapter = await parseKakuyomuChapter(chapterHtml(), episodeUrl(EP[0]!));
    const version: CompletedTranslation = {
      schemaVersion: 2,
      versionId: 'version-1',
      source: {
        ...chapter,
        captureKind: 'fetched',
        rawHtml: chapterHtml(),
        fetchedAt: '2026-10-23T00:00:00Z',
      },
      text: '번역',
      blocks: [{ id: 'block-1', text: '번역' }],
      createdAt: '2026-10-23T00:00:00Z',
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
    await store.saveWorkPage(parseKakuyomuWorkPage(workHtml(), workUrl));
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
    // 회차 ID는 개인 파일 경로에 들어가지 않는다.
    expect([...memory.keys()].some((path) => path.includes(EP[0]!))).toBe(false);
  });
});
