import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../src/contracts';
import type {
  ChapterRef,
  SelectedModel,
  SourceSnapshot,
  WorkPage,
} from '../../src/contracts/reading';
import {
  createBatchTranslation,
  type BatchRecord,
  type BatchRepository,
} from '../../src/translation/batch';

const chapters: ChapterRef[] = [1, 2, 3].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
}));
const page: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters,
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};
const selection: SelectedModel = {
  connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 1 },
  modelId: 'local',
  translationMode: 'legacy',
};

function sourceOf(chapter: ChapterRef): SourceSnapshot {
  return {
    ...chapter,
    sourceHash: `hash-${chapter.ordinal}`,
    paragraphs: [{ id: 'p0', text: `アルベルト${chapter.ordinal}`, ruby: [] }],
    prevUrl: null,
    nextUrl: null,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>원문</p>',
  } as SourceSnapshot;
}

/** 메모리 저장소와 원문 호출을 세는 가짜 의존성. 여러 batch 인스턴스가 같은 저장소를 본다. */
function fixture() {
  const getChapter = vi.fn(async (chapter: ChapterRef, signal: AbortSignal) => {
    if (signal.aborted) throw new ReaderError('cancelled');
    return sourceOf(chapter);
  });
  const source = { getWorkPage: vi.fn(async () => page), getChapter };
  const library = {
    saveWorkPage: vi.fn(async () => {}),
    listVersions: vi.fn(async () => []),
  };
  const flow = {
    active: false,
    getSnapshot: () => ({ pendingSave: null }),
    getUnfinished: () => [],
    getCompleted: () => undefined,
    subscribe: () => () => {},
    cancel() {},
    dispose() {},
    start: vi.fn(),
    retrySave: vi.fn(),
  };
  let stored: BatchRecord | null = null;
  const repository: BatchRepository = {
    read: async () => (stored ? structuredClone(stored) : null),
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
  const guidance = {
    read: async () => null,
    save: async (workId: string, draft: object) => ({
      ...draft,
      schemaVersion: 1,
      workId,
      hash: 'hash',
    }),
  };
  function make() {
    const batch = createBatchTranslation({
      source,
      library,
      flow,
      repository,
      guidance,
    } as never);
    batch.setForeground(true);
    return batch;
  }
  return { getChapter, make };
}

it('범위 스캔에서 받은 원문은 다시 받지 않고 회차 순서대로 돌려준다', async () => {
  const { getChapter, make } = fixture();
  const batch = make();
  await batch.prepare(page, selection, null, false);
  await batch.scan();
  expect(batch.getSnapshot().record?.scan?.status).toBe('review');
  expect(getChapter).toHaveBeenCalledTimes(3);

  const onProgress = vi.fn();
  const result = await batch.scanChapters(new AbortController().signal, onProgress);

  expect(result.map((chapter) => chapter.chapterId)).toEqual([
    'n1234ab/1',
    'n1234ab/2',
    'n1234ab/3',
  ]);
  expect(result[0]!.paragraphs[0]!.text).toBe('アルベルト1');
  // 문단은 text·ruby만 남긴다.
  expect(Object.keys(result[0]!.paragraphs[0]!).sort()).toEqual(['ruby', 'text']);
  expect(getChapter).toHaveBeenCalledTimes(3);
  expect(onProgress.mock.calls).toEqual([
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});

it('기억이 없는 새 인스턴스는 review 기록의 원문을 다시 받아 채운다', async () => {
  const { getChapter, make } = fixture();
  const first = make();
  await first.prepare(page, selection, null, false);
  await first.scan();
  expect(getChapter).toHaveBeenCalledTimes(3);

  const restarted = make();
  await restarted.initialize();
  const result = await restarted.scanChapters(new AbortController().signal);

  expect(result).toHaveLength(3);
  expect(result[2]!.chapterId).toBe('n1234ab/3');
  expect(getChapter).toHaveBeenCalledTimes(6);
});

it('취소 신호를 받으면 cancelled로 끝낸다', async () => {
  const { make } = fixture();
  const batch = make();
  await batch.prepare(page, selection, null, false);
  await batch.scan();

  const aborted = new AbortController();
  aborted.abort();
  await expect(batch.scanChapters(aborted.signal)).rejects.toMatchObject({ code: 'cancelled' });

  const midway = new AbortController();
  await expect(batch.scanChapters(midway.signal, () => midway.abort())).rejects.toMatchObject({
    code: 'cancelled',
  });
});

it('review가 아니면 원문을 모으지 않고 source_parse로 거부한다', async () => {
  const { getChapter, make } = fixture();
  const batch = make();
  await batch.prepare(page, selection, null, false);
  expect(batch.getSnapshot().record?.scan?.status).toBe('pending');

  await expect(batch.scanChapters(new AbortController().signal)).rejects.toMatchObject({
    code: 'source_parse',
  });
  expect(getChapter).not.toHaveBeenCalled();
});
