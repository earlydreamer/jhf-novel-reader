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

function fixture() {
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
  const repository = createBatchRepository(files);
  const batch = createBatchTranslation({ source, library, flow, repository } as never);
  batch.setForeground(true);
  return { batch, repository };
}

it('안내를 닫으면 기록에 dismissed를 저장하고, 다시 읽어도 유지된다', async () => {
  const h = fixture();
  await h.batch.prepare(page, selection, null, false);
  expect((await h.repository.read())?.dismissed).toBeUndefined();

  h.batch.dismissNotice();
  await vi.waitFor(async () => {
    expect((await h.repository.read())?.dismissed).toBe(true);
  });
});
