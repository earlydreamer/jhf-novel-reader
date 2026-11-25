import { expect, it, vi } from 'vitest';
import type {
  ChapterRef,
  SelectedModel,
  SourceSnapshot,
  WorkPage,
} from '../../src/contracts/reading';
import type { PrivateFiles } from '../../src/storage/journal';
import { createBatchRepository, createBatchTranslation } from '../../src/translation/batch';

const chapters: ChapterRef[] = [1, 2].map((ordinal) => ({
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
// 일괄 번역은 회차 흐름의 오류 코드만 보고 안내를 고른다. 제공자 연결 형태는 결과에 영향을 주지 않는다.
const selection: SelectedModel = {
  connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 1 },
  modelId: 'local',
  translationMode: 'legacy',
};

function sourceOf(chapter: ChapterRef): SourceSnapshot {
  return {
    ...chapter,
    sourceHash: `hash-${chapter.ordinal}`,
    paragraphs: [{ id: 'p0', text: 'アルベルト', ruby: [] }],
    prevUrl: null,
    nextUrl: null,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>원문</p>',
  } as SourceSnapshot;
}

function fixture(code = 'usage_limit') {
  const data = new Map<string, string>();
  const files: PrivateFiles = {
    read: async (path) => data.get(path) ?? null,
    write: async (path, text) => {
      data.set(path, text);
    },
    remove: async (path) => {
      data.delete(path);
    },
  };
  const source = {
    getWorkPage: vi.fn(async () => page),
    getChapter: vi.fn(async (chapter: ChapterRef) => sourceOf(chapter)),
  };
  const library = { saveWorkPage: vi.fn(async () => {}), listVersions: vi.fn(async () => []) };
  // 회차 흐름이 주어진 오류 코드로 실패한 상태를 흉내 낸다.
  const flow = {
    active: false,
    getSnapshot: () => ({
      phase: 'failed',
      pendingSave: null,
      error: { code, delivery: 'received' },
    }),
    getUnfinished: () => [],
    getCompleted: () => undefined,
    subscribe: () => () => {},
    cancel() {},
    dispose() {},
    start: vi.fn(async () => {}),
    retrySave: vi.fn(),
  };
  const repository = createBatchRepository(files);
  const batch = createBatchTranslation({ source, library, flow, repository } as never);
  batch.setForeground(true);
  return { batch, flow };
}

it('플랜 사용 한도로 멈추면 한도 때문임을 알리고 다음 회차는 요청하지 않는다 (#437)', async () => {
  const h = fixture();
  await h.batch.prepare(page, selection, null, false);
  await h.batch.run();

  const state = h.batch.getSnapshot();
  expect(h.flow.start).toHaveBeenCalledTimes(1);
  expect(state.record?.phase).toBe('paused');
  expect(state.error).toContain('사용 한도');
  expect(state.error).toContain('다음 회차도 요청하지 않았어요');
});

it.each([
  ['reconnect_required', '다시 로그인'],
  ['plan_not_eligible', '플랜으로는'],
])('%s로 멈추면 이유를 알리고 다음 회차는 요청하지 않는다 (#439)', async (code, reason) => {
  const h = fixture(code);
  await h.batch.prepare(page, selection, null, false);
  await h.batch.run();

  const state = h.batch.getSnapshot();
  expect(h.flow.start).toHaveBeenCalledTimes(1);
  expect(state.record?.phase).toBe('paused');
  expect(state.error).toContain(reason);
  expect(state.error).toContain('다음 회차도 요청하지 않았어요');
});
