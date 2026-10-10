import { expect, it, vi } from 'vitest';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type {
  ChapterRef,
  ProviderSession,
  SourceSnapshot,
  WorkPage,
} from '../../src/contracts/reading';
import { createBatchTranslation, type BatchRecord } from '../../src/translation/batch';
import type {
  GuidanceDraft,
  GuidanceRepository,
  WorkGuidance,
} from '../../src/translation/guidance';
import type { RangeJudgeResult, TermScanChange } from '../../src/translation/termScanRun';

type RangeJudge = NonNullable<RenewalDependencies['rangeJudge']>;

const CONNECTION_MESSAGE = '연결 설정에서 서버와 모델을 확인하면 용어 정밀스캔을 할 수 있어요.';
const BUSY_MESSAGE = '번역이 끝난 뒤 용어 정밀스캔을 시작할 수 있어요.';
const TRANSLATE_BLOCKED = '용어 정밀스캔이 끝난 뒤 번역할 수 있어요.';
const FILL_FAILED = '정밀스캔으로 표기를 채우지 못했어요. 연결을 확인하고 다시 시도해 주세요.';

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

const change: TermScanChange = {
  source: 'アルベルト',
  role: 'new',
  after: '알베르트',
  kind: 'real',
  category: '고유명사',
  confidence: 'high',
  reason: '인명',
  evidence: [],
};
const doneResult: RangeJudgeResult = {
  suggestions: [change],
  common: [],
  partial: false,
  counts: { candidates: 1, common: 0, unchanged: 0, unanswered: 0 },
};

function sourceOf(chapter: ChapterRef, text: string): SourceSnapshot {
  return {
    ...chapter,
    sourceHash: `hash-${chapter.ordinal}`,
    paragraphs: [{ id: 'p0', text, ruby: [] }],
    prevUrl: null,
    nextUrl: null,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>원문</p>',
  } as SourceSnapshot;
}

/** 범위 스캔까지 끝난 review 상태의 앱을 만든다. 원문 문단은 text로 정한다. */
async function reviewApp(options: { text?: string; rangeJudge?: RangeJudge } = {}) {
  const text = options.text ?? 'アルベルトとアルベルト。';
  const getChapter = vi.fn(async (chapter: ChapterRef, signal: AbortSignal) => {
    if (signal.aborted) throw new ReaderError('cancelled');
    return sourceOf(chapter, text);
  });
  const source = { getWorkPage: async () => page, getChapter };
  const library = {
    saveWorkPage: vi.fn(async () => {}),
    listWorkIds: vi.fn(async () => [page.workId]),
    readWork: vi.fn(async () => [page]),
    listRecent: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    readVersion: vi.fn(async () => null),
    commitVersion: vi.fn(async () => {}),
    savePosition: vi.fn(async () => {}),
    readPosition: vi.fn(async () => null),
    removeWork: vi.fn(async () => ({
      removed: false,
      cleanupComplete: false,
      remainingInventory: [],
    })),
  };
  let terms: WorkGuidance['terms'] = [];
  const guidance: GuidanceRepository = {
    read: async (workId: string): Promise<WorkGuidance> => ({
      schemaVersion: 1,
      workId,
      hash: 'hash',
      terms,
      voices: [],
    }),
    save: async (workId: string, draft: GuidanceDraft): Promise<WorkGuidance> => {
      terms = draft.terms;
      return { ...draft, schemaVersion: 1, workId, hash: 'hash' };
    },
  };
  let stored: BatchRecord | null = null;
  const repository = {
    read: async () => (stored ? structuredClone(stored) : null),
    write: async (value: BatchRecord) => {
      stored = structuredClone(value);
    },
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
  const batch = createBatchTranslation({
    source,
    library,
    flow,
    repository,
    guidance,
  } as never);
  batch.setForeground(true);
  const rangeJudge = vi.fn<RangeJudge>(options.rangeJudge ?? (async () => doneResult));
  const session: ProviderSession = {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
  };
  const app = createRenewalController({
    library: library as never,
    source: source as never,
    guidance,
    batch,
    rangeJudge,
    connect: async () => session,
  });
  await app.initialize();
  app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await app.checkConnection();
  app.chooseModel('local');
  await app.openWork(page.canonicalUrl);
  await app.prepareBatch({ first: 1, last: 2 }, false);
  await app.scanBatch();
  const record = app.getSnapshot().batch?.record;
  if (!record) throw new Error('record missing');
  return { app, getChapter, rangeJudge, record };
}

/** 취소 신호를 받을 때까지 끝나지 않는 정밀스캔 판정. */
function pendingJudge() {
  return vi.fn<RangeJudge>(
    ({ signal }) =>
      new Promise<RangeJudgeResult>((_, reject) =>
        signal.addEventListener('abort', () => reject(new ReaderError('cancelled'))),
      ),
  );
}

it('정밀스캔 채우기는 판정 의존성이 있을 때만 켜진다', async () => {
  const withJudge = await reviewApp();
  expect(withJudge.app.getSnapshot().batchFillAvailable).toBe(true);
  const without = createRenewalController({});
  expect(without.getSnapshot().batchFillAvailable).toBe(false);
  expect(without.getSnapshot().batchFill).toBeNull();
});

it('연결이 없으면 연결 안내만 띄우고 판정을 부르지 않는다', async () => {
  const rangeJudge = vi.fn<RangeJudge>(async () => doneResult);
  const app = createRenewalController({ rangeJudge });
  await app.fillBatchCandidates();
  expect(app.getSnapshot().error).toBe(CONNECTION_MESSAGE);
  expect(rangeJudge).not.toHaveBeenCalled();
  expect(app.getSnapshot().batchFill).toBeNull();
});

it('후보 원문과 이름을 넘겨 판정하고 결과를 done으로 남긴다', async () => {
  const { app, getChapter, rangeJudge, record } = await reviewApp();
  await app.fillBatchCandidates();

  expect(app.getSnapshot().batchFill).toEqual({
    recordId: record.id,
    phase: 'done',
    result: doneResult,
  });
  expect(rangeJudge).toHaveBeenCalledTimes(1);
  const input = rangeJudge.mock.calls[0]![0];
  expect(input).toMatchObject({
    workId: 'n1234ab',
    names: ['アルベルト'],
    sources: { wikipedia: false, namuwiki: false },
    selection: { modelId: 'local' },
  });
  expect(input.chapters.map((chapter) => chapter.chapterId)).toEqual(['n1234ab/1', 'n1234ab/2']);
  expect(input.chapters[0]!.paragraphs[0]!.text).toBe('アルベルトとアルベルト。');
  // 범위 스캔에서 받은 원문을 다시 받지 않는다.
  expect(getChapter).toHaveBeenCalledTimes(2);
});

it('진행 중에는 번역과 미리 번역이 막히고, 중단하면 cancelled로 끝나 잠금이 풀린다', async () => {
  const rangeJudge = pendingJudge();
  const { app, record } = await reviewApp({ rangeJudge });
  const running = app.fillBatchCandidates();
  await vi.waitFor(() => expect(app.getSnapshot().batchFill?.phase).toBe('running'));
  expect(app.getSnapshot().batchFill).toMatchObject({ recordId: record.id, phase: 'running' });

  await app.fillBatchCandidates();
  expect(app.getSnapshot().error).toBe(BUSY_MESSAGE);

  await app.runBatch();
  expect(app.getSnapshot().error).toBe(TRANSLATE_BLOCKED);
  await app.prepareBatch(null, false);
  expect(app.getSnapshot().batch?.record?.id).toBe(record.id);

  app.cancelBatchFill();
  await running;
  expect(app.getSnapshot().batchFill).toMatchObject({ recordId: record.id, phase: 'cancelled' });
  expect(app.getSnapshot().batchFill?.result).toBeUndefined();

  // 잠금이 풀렸으므로 다시 채울 수 있다.
  rangeJudge.mockImplementationOnce(async () => doneResult);
  await app.fillBatchCandidates();
  expect(app.getSnapshot().batchFill).toMatchObject({ phase: 'done', result: doneResult });
});

it('판정이 실패하면 안내 문구를 남기고 잠금을 풀어 다시 시도할 수 있다', async () => {
  const rangeJudge = vi.fn<RangeJudge>(async () => {
    throw new Error('synthetic judge failure');
  });
  const { app, record } = await reviewApp({ rangeJudge });
  await app.fillBatchCandidates();
  expect(app.getSnapshot().batchFill).toEqual({
    recordId: record.id,
    phase: 'failed',
    error: FILL_FAILED,
  });

  rangeJudge.mockImplementationOnce(async () => doneResult);
  await app.fillBatchCandidates();
  expect(rangeJudge).toHaveBeenCalledTimes(2);
  expect(app.getSnapshot().batchFill).toMatchObject({ phase: 'done', result: doneResult });
});

it('후보가 없으면 판정을 부르지 않고 조용히 끝난다', async () => {
  const { app, rangeJudge } = await reviewApp({ text: 'ふつうの文章です。' });
  await app.fillBatchCandidates();
  expect(rangeJudge).not.toHaveBeenCalled();
  expect(app.getSnapshot().batchFill).toBeNull();
  expect(app.getSnapshot().error).toBeNull();
});
