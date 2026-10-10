import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../src/contracts';
import type {
  ChapterRef,
  SelectedModel,
  SourceSnapshot,
  WorkPage,
} from '../../src/contracts/reading';
import type { PrivateFiles } from '../../src/storage/journal';
import {
  createBatchTranslation,
  type BatchRecord,
  type BatchRepository,
} from '../../src/translation/batch';
import { createBatchScanStore, type BatchScanStore } from '../../src/translation/batchScanStore';

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
const cancelMessage = '후보 스캔을 멈췄어요. 다시 누르면 받은 회차는 건너뛰고 이어서 스캔해요.';

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

/** 가짜 파일 저장소, 원문 호출 훅, 실제 저장소 구현을 묶은 의존성. 여러 batch 인스턴스가 같은 파일을 본다. */
function fixture(options: { scanStore?: BatchScanStore } = {}) {
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
  let onFetch: ((chapter: ChapterRef) => void) | null = null;
  const getChapter = vi.fn(async (chapter: ChapterRef, signal: AbortSignal) => {
    onFetch?.(chapter);
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
  const scanStore = options.scanStore ?? createBatchScanStore(files);
  function make(store: BatchScanStore | undefined = scanStore) {
    const batch = createBatchTranslation({
      source,
      library,
      flow,
      repository,
      guidance,
      scanStore: store,
    } as never);
    batch.setForeground(true);
    return batch;
  }
  const savedKeys = () => [...data.keys()].filter((key) => key.startsWith('batches/scan-'));
  const callsFor = (ordinal: number) =>
    getChapter.mock.calls.filter(([chapter]) => chapter.ordinal === ordinal).length;
  return {
    data,
    getChapter,
    make,
    savedKeys,
    callsFor,
    setOnFetch(hook: ((chapter: ChapterRef) => void) | null) {
      onFetch = hook;
    },
  };
}

/** 같은 범위를 중단 없이 한 번에 스캔했을 때의 후보 결과. */
async function referenceCandidates() {
  const batch = fixture().make();
  await batch.prepare(page, selection, null, false);
  await batch.scan();
  return batch.getSnapshot().record!.scan!.candidates;
}

it('취소한 뒤 다시 스캔하면 받은 회차는 건너뛰고 결과는 한 번에 스캔한 것과 같다', async () => {
  const expected = await referenceCandidates();
  const fx = fixture();
  const batch = fx.make();
  await batch.prepare(page, selection, null, false);
  fx.setOnFetch((chapter) => {
    if (chapter.ordinal === 2) batch.cancel();
  });

  await batch.scan();

  expect(batch.getSnapshot().record?.scan?.status).toBe('pending');
  expect(batch.getSnapshot().error).toBe(cancelMessage);
  expect(fx.callsFor(1)).toBe(1);

  fx.setOnFetch(null);
  await batch.scan();

  expect(fx.callsFor(1)).toBe(1);
  expect(batch.getSnapshot().record?.scan?.status).toBe('review');
  expect(batch.getSnapshot().record?.scan?.candidates).toEqual(expected);
});

it('앱을 다시 열어도 저장된 회차로 이어서 스캔한다', async () => {
  const expected = await referenceCandidates();
  const fx = fixture();
  const first = fx.make();
  await first.prepare(page, selection, null, false);
  fx.setOnFetch((chapter) => {
    if (chapter.ordinal === 2) first.cancel();
  });
  await first.scan();
  fx.setOnFetch(null);

  const restarted = fx.make();
  await restarted.initialize();
  await restarted.scan();

  expect(fx.callsFor(1)).toBe(1);
  expect(restarted.getSnapshot().record?.scan?.status).toBe('review');
  expect(restarted.getSnapshot().record?.scan?.candidates).toEqual(expected);
});

it('실패하면 받은 회차는 저장을 남기고, 실패 문구는 다시 스캔하면 건너뛴다고 안내한다', async () => {
  const fx = fixture();
  const batch = fx.make();
  await batch.prepare(page, selection, null, false);
  fx.setOnFetch((chapter) => {
    if (chapter.ordinal === 3) throw new ReaderError('source_access');
  });

  await batch.scan();

  expect(batch.getSnapshot().error).toBe(
    '범위 전체의 원문을 확인하지 못했어요. 다시 스캔하면 받은 회차는 건너뛰어요.',
  );
  expect(fx.savedKeys()).toHaveLength(2);
});

it('저장 실패는 무시하고 스캔을 끝낸다', async () => {
  const failing: BatchScanStore = {
    read: async () => null,
    write: async () => {
      throw new ReaderError('storage');
    },
    clear: async () => {},
  };
  const fx = fixture({ scanStore: failing });
  const batch = fx.make();
  await batch.prepare(page, selection, null, false);

  await batch.scan();

  expect(batch.getSnapshot().record?.scan?.status).toBe('review');
});

it('후보를 확정하면 저장본을 지운다', async () => {
  const fx = fixture();
  const batch = fx.make();
  await batch.prepare(page, selection, null, false);
  await batch.scan();
  expect(fx.savedKeys()).toHaveLength(3);

  await batch.confirmCandidates([{ source: 'アルベルト', target: '알베르트' }]);

  expect(batch.getSnapshot().record?.scan?.status).toBe('confirmed');
  expect(fx.savedKeys()).toHaveLength(0);
});

it('새로 준비하면 이전 기록의 저장본을 지운다', async () => {
  const fx = fixture();
  const batch = fx.make();
  await batch.prepare(page, selection, null, false);
  await batch.scan();
  expect(fx.savedKeys()).toHaveLength(3);

  await batch.prepare(page, selection, null, false);

  expect(batch.getSnapshot().record?.scan?.status).toBe('pending');
  expect(fx.savedKeys()).toHaveLength(0);
});

it('작품 기록을 지우면 그 저장본도 지운다', async () => {
  const fx = fixture();
  const batch = fx.make();
  await batch.prepare(page, selection, null, false);
  await batch.scan();
  expect(fx.savedKeys()).toHaveLength(3);

  expect(batch.clearWork(page.workId)).toBe(true);

  await vi.waitFor(() => expect(fx.savedKeys()).toHaveLength(0));
});

it('표기 채우기는 저장본이 없는 회차를 받아서 저장한다', async () => {
  const fx = fixture();
  const first = fx.make();
  await first.prepare(page, selection, null, false);
  await first.scan();
  for (const key of fx.savedKeys()) fx.data.delete(key);

  const restarted = fx.make();
  await restarted.initialize();
  const result = await restarted.scanChapters(new AbortController().signal);

  expect(result.map((chapter) => chapter.chapterId)).toEqual([
    'n1234ab/1',
    'n1234ab/2',
    'n1234ab/3',
  ]);
  expect(fx.savedKeys()).toHaveLength(3);
});
