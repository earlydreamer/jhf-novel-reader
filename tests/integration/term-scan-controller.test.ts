import { expect, it, vi } from 'vitest';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError, type AppLifecycle } from '../../src/contracts';
import type {
  ChapterRef,
  CompletedTranslation,
  ProviderSession,
  WorkPage,
} from '../../src/contracts/reading';
import type {
  GuidanceDraft,
  GuidanceRepository,
  GuidanceTerm,
  WorkGuidance,
} from '../../src/translation/guidance';
import type { TermScanChange, TermScanResult } from '../../src/translation/termScanRun';

type TermScan = NonNullable<RenewalDependencies['termScan']>;

const CONNECTION_MESSAGE = '연결 설정에서 서버와 모델을 확인하면 용어 정밀스캔을 할 수 있어요.';
const GEMINI_MESSAGE = '용어 정밀스캔은 로컬 모델 연결에서만 쓸 수 있어요.';
const BUSY_MESSAGE = '번역이 끝난 뒤 용어 정밀스캔을 시작할 수 있어요.';
const SAVED_MESSAGE = '저장된 회차가 있어야 용어 정밀스캔을 할 수 있어요.';
const FAILED_MESSAGE = '용어 정밀스캔을 마치지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
const TRANSLATE_BLOCKED = '용어 정밀스캔이 끝난 뒤 번역할 수 있어요.';

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
const version: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'saved-1',
  source: {
    ...chapters[0]!,
    sourceHash: 'hash-0',
    paragraphs: [{ id: 'source-0', text: '原文', ruby: [] }],
    prevUrl: null,
    nextUrl: null,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>原文</p>',
  },
  text: '저장된 한국어 본문',
  blocks: [{ id: 'translated-0', text: '저장된 한국어 본문' }],
  createdAt: '2026-10-04T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'connection',
    modelId: 'fixture',
    contractVersion: 'plain-v1',
    promptVersion: 'fixture',
    languageDirection: 'ja-ko',
  },
};
const emptyResult: TermScanResult = { applied: [], confirmed: 0, suggestions: [], partial: false };

type RemoveWork = (workId: string, options?: unknown) => Promise<unknown>;
/** 삭제를 막거나 실패시키는 기본 응답. 테스트가 호출 여부를 보려고 vi.fn으로 감싸 넘긴다. */
const keepWork: RemoveWork = async () => ({
  removed: false,
  cleanupComplete: false,
  remainingInventory: [],
});

function library(saved: boolean, removeWork: RemoveWork = keepWork) {
  return {
    saveWorkPage: vi.fn(async () => {}),
    listWorkIds: vi.fn(async () => [page.workId]),
    readWork: vi.fn(async () => [page]),
    listRecent: vi.fn(async () => []),
    listVersions: vi.fn(async (chapterId: string) =>
      saved && chapterId === chapters[0]!.chapterId ? [version] : [],
    ),
    readVersion: vi.fn(async () => version),
    commitVersion: vi.fn(async () => {}),
    savePosition: vi.fn(async () => {}),
    readPosition: vi.fn(async () => null),
    removeWork,
  } as never;
}

/** 저장된 용어집 한 벌. read는 복사본을 주고 save는 상태를 바꾼다. */
function guidanceStore(initial: GuidanceTerm[]) {
  const state = { terms: initial };
  const repo: GuidanceRepository = {
    read: vi.fn(async (workId: string): Promise<WorkGuidance> => ({
      schemaVersion: 1,
      workId,
      hash: 'hash',
      terms: state.terms.map((item) => ({ ...item, aliases: [...item.aliases] })),
      voices: [],
    })),
    save: vi.fn(async (workId: string, draft: GuidanceDraft): Promise<WorkGuidance> => {
      state.terms = draft.terms;
      return { ...draft, schemaVersion: 1, workId, hash: 'hash' };
    }),
  };
  return { state, repo };
}

/** 취소 신호를 받으면 cancelled로 끝나는 스캔. 끝나지 않는 진행 중 상태를 만든다. */
function pendingScan() {
  return vi.fn<TermScan>(
    ({ signal }) =>
      new Promise<TermScanResult>((_, reject) =>
        signal.addEventListener('abort', () => reject(new ReaderError('cancelled'))),
      ),
  );
}

/** release를 부를 때까지 기다렸다가 result를 주는 스캔. */
function gatedScan(result: TermScanResult = emptyResult) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scan = vi.fn<TermScan>(async () => {
    await gate;
    return result;
  });
  return { scan, release: () => release() };
}

async function connectedApp(
  deps: Partial<RenewalDependencies> = {},
  options: {
    provider?: 'openai-compatible' | 'gemini';
    saved?: boolean;
    removeWork?: RemoveWork;
  } = {},
) {
  const provider = options.provider ?? 'openai-compatible';
  const session: ProviderSession = {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
  };
  const app = createRenewalController({
    library: library(options.saved ?? true, options.removeWork),
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    connect: async () => session,
    ...deps,
  });
  await app.initialize();
  app.changeConnection({
    provider,
    baseUrl:
      provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'http://localhost:1234',
  });
  await app.checkConnection();
  app.chooseModel('local');
  await app.openWork(page.canonicalUrl);
  return app;
}

/** 앱을 켠 직후처럼 저장된 모델만 있고 연결 확인은 아직 안 한 상태(catalogStatus idle)를 만든다. */
async function restoredApp(deps: Partial<RenewalDependencies> = {}) {
  const session: ProviderSession = {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
  };
  const app = createRenewalController({
    library: library(true),
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    connect: async () => session,
    settings: {
      readReadingSettings: async () => ({
        schemaVersion: 2,
        selection: {
          connection: {
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:1234',
            revision: 1,
          },
          modelId: 'local',
        },
        fontSize: 18,
      }),
      saveReadingSettings: async () => {},
    } as never,
    ...deps,
  });
  await app.initialize();
  await app.openWork(page.canonicalUrl);
  return app;
}

const recheck: TermScanChange = {
  source: '갑',
  role: 'recheck',
  before: '옛표기',
  after: '새표기',
  kind: 'real',
  category: '인명',
  confidence: 'high',
  reason: '근거',
  evidence: [],
};
const created: TermScanChange = {
  source: '새항목',
  role: 'new',
  after: '신규',
  kind: 'work',
  category: '기타',
  confidence: 'high',
  reason: '근거',
  evidence: [],
};
const suggestion: TermScanChange = {
  source: '을',
  role: 'suggest',
  before: '기존',
  after: '제안',
  kind: 'real',
  category: '지명',
  confidence: 'medium',
  reason: '근거',
  evidence: [],
};

it('연결이 없으면 스캔을 시작하지 않고 연결 안내만 띄운다', async () => {
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const bare = createRenewalController({ termScan: scan, library: library(true) });
  expect(bare.getSnapshot().termScanAvailable).toBe(true);
  expect(createRenewalController().getSnapshot().termScanAvailable).toBe(false);

  await bare.startTermScan(page.workId);
  expect(scan).not.toHaveBeenCalled();
  expect(bare.getSnapshot().error).toBe(CONNECTION_MESSAGE);
  expect(bare.getSnapshot().termScan).toBeNull();
});

it('앱을 켠 직후 연결 확인이 안 됐어도 저장된 모델로 먼저 확인하고 스캔을 시작한다', async () => {
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const connect = vi.fn(async () => ({
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
  }));
  const app = await restoredApp({ termScan: scan, connect: connect as never });
  expect(app.getSnapshot()).toMatchObject({ catalogStatus: 'idle', selectedModelId: 'local' });
  const before = connect.mock.calls.length;

  await app.startTermScan(page.workId);
  expect(connect.mock.calls.length).toBeGreaterThan(before);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(app.getSnapshot()).toMatchObject({ error: null, termScan: { phase: 'done' } });
  app.dispose();
});

it('연결 확인이 실패하면 스캔을 시작하지 않고 기존 연결 안내를 띄운다', async () => {
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const app = await restoredApp({
    termScan: scan,
    connect: async () => {
      throw new Error('offline');
    },
  });
  await app.startTermScan(page.workId);
  expect(scan).not.toHaveBeenCalled();
  expect(app.getSnapshot().error).toBe(CONNECTION_MESSAGE);
  expect(app.getSnapshot().termScan).toBeNull();
  app.dispose();
});

it('연결 확인 중 두 번째 시작 요청은 아무것도 하지 않아 스캔이 두 번 시작되지 않는다', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let gated = false;
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const app = await restoredApp({
    termScan: scan,
    connect: async () => {
      if (gated) await gate;
      return {
        listModels: async () => [
          { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
        ],
        translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
      };
    },
  });
  gated = true;

  const first = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().catalogStatus).toBe('checking'));
  await app.startTermScan(page.workId);
  expect(app.getSnapshot().error).toBeNull();

  release();
  await first;
  expect(scan).toHaveBeenCalledTimes(1);
  app.dispose();
});

it('Gemini 연결에서는 로컬 모델 연결만 쓸 수 있다고 안내한다', async () => {
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const app = await connectedApp({ termScan: scan }, { provider: 'gemini' });
  await app.startTermScan(page.workId);
  expect(scan).not.toHaveBeenCalled();
  expect(app.getSnapshot().error).toBe(GEMINI_MESSAGE);
  app.dispose();
});

it('저장된 회차가 없으면 스캔을 시작하지 않는다', async () => {
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const app = await connectedApp({ termScan: scan }, { saved: false });
  await app.startTermScan(page.workId);
  expect(scan).not.toHaveBeenCalled();
  expect(app.getSnapshot().error).toBe(SAVED_MESSAGE);
  app.dispose();
});

it('시작하면 진행 중이 되고 진행률을 보이며 끝나면 결과를 보관한다', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result: TermScanResult = {
    applied: [recheck],
    confirmed: 0,
    suggestions: [],
    partial: false,
  };
  const scan = vi.fn<TermScan>(async ({ onProgress }) => {
    onProgress?.({ stage: 'collect', done: 1, total: 1 });
    await gate;
    return result;
  });
  const app = await connectedApp({ termScan: scan });

  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() =>
    expect(app.getSnapshot().termScan).toMatchObject({
      workId: page.workId,
      phase: 'running',
      progress: { stage: 'collect', done: 1, total: 1 },
    }),
  );
  expect(scan.mock.calls[0]![0]).toMatchObject({
    workId: page.workId,
    chapterIds: ['n1234ab/1'],
    selection: { modelId: 'local' },
  });

  release();
  await pending;
  expect(app.getSnapshot().termScan).toMatchObject({ phase: 'done', result, handled: [] });
  app.dispose();
});

it('취소하면 cancelled가 되고 실패하면 failed와 안내 문구를 남긴다', async () => {
  const app = await connectedApp({ termScan: pendingScan() });
  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('running'));
  app.cancelTermScan();
  await pending;
  expect(app.getSnapshot().termScan).toMatchObject({ phase: 'cancelled' });
  app.dispose();

  const failing = await connectedApp({
    termScan: vi.fn<TermScan>(async () => {
      throw new Error('boom');
    }),
  });
  await failing.startTermScan(page.workId);
  expect(failing.getSnapshot().termScan).toMatchObject({ phase: 'failed', error: FAILED_MESSAGE });
  failing.dispose();
});

it('진행 중에는 다시 시작하지 않고 번역도 시작하지 않는다', async () => {
  const scan = pendingScan();
  const startTranslation = vi.fn(async () => {});
  const app = await connectedApp({ termScan: scan, startTranslation });
  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('running'));

  await app.startTermScan(page.workId);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(app.getSnapshot().error).toBe(BUSY_MESSAGE);

  await app.translate();
  expect(startTranslation).not.toHaveBeenCalled();
  expect(app.getSnapshot().error).toBe(TRANSLATE_BLOCKED);

  app.cancelTermScan();
  await pending;
  app.dispose();
});

it('스캔 중 자동 번역 요청은 오류 없이 미뤘다가 끝난 뒤 시작한다', async () => {
  const { scan, release } = gatedScan();
  const startTranslation = vi.fn(async () => {});
  const app = await connectedApp({ termScan: scan, startTranslation });
  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('running'));

  // 저장되지 않은 2화로 이동하면 자동 번역이 요청된다.
  await app.selectChapter(chapters[1]!);
  expect(app.getSnapshot().route).toEqual({ kind: 'translation', chapterId: 'n1234ab/2' });
  expect(startTranslation).not.toHaveBeenCalled();
  expect(app.getSnapshot().error).toBeNull();

  release();
  await pending;
  await vi.waitFor(() => expect(startTranslation).toHaveBeenCalledTimes(1));
  app.dispose();
});

it('되돌리기는 바꾼 표기를 원래대로 돌리고 새 항목은 지우며 handled에 남긴다', async () => {
  const original: GuidanceTerm = {
    source: '갑',
    target: '옛표기',
    aliases: [],
    category: '인명',
    note: '',
    origin: 'scan',
    evidence: [],
  };
  const { state, repo } = guidanceStore([original]);
  const scan = vi.fn<TermScan>(async () => {
    state.terms = [
      { ...original, target: '새표기' },
      { source: '새항목', target: '신규', aliases: [], category: '기타', note: '', origin: 'scan' },
    ];
    return { applied: [recheck, created], confirmed: 0, suggestions: [], partial: false };
  });
  const app = await connectedApp({ termScan: scan, guidance: repo });
  await app.startTermScan(page.workId);

  await app.revertTermScanChange('갑');
  expect(state.terms.find((item) => item.source === '갑')).toMatchObject({ target: '옛표기' });
  await app.revertTermScanChange('새항목');
  expect(state.terms.map((item) => item.source)).toEqual(['갑']);
  expect(app.getSnapshot().termScan?.handled).toEqual(['갑', '새항목']);
  app.dispose();
});

it('제안 적용은 사람 항목의 표기를 바꾸고 handled에 남긴다', async () => {
  const human: GuidanceTerm = {
    source: '을',
    target: '기존',
    aliases: [],
    category: '지명',
    note: '',
  };
  const { state, repo } = guidanceStore([human]);
  const scan = vi.fn<TermScan>(async () => ({
    applied: [],
    confirmed: 0,
    suggestions: [suggestion],
    partial: false,
  }));
  const app = await connectedApp({ termScan: scan, guidance: repo });
  await app.startTermScan(page.workId);

  await app.applyTermScanSuggestion('을');
  expect(state.terms).toEqual([{ ...human, target: '제안' }]);
  expect(app.getSnapshot().termScan?.handled).toEqual(['을']);
  app.dispose();
});

it('앱이 백그라운드로 가면 진행 중인 스캔을 취소한다', async () => {
  let listener: ((active: boolean) => void) | undefined;
  const lifecycle: AppLifecycle = {
    isActive: async () => true,
    subscribe: async (next) => {
      listener = next;
      return async () => {};
    },
  };
  const app = await connectedApp({ termScan: pendingScan(), lifecycle });
  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('running'));

  listener!(false);
  await pending;
  expect(app.getSnapshot().termScan).toMatchObject({ phase: 'cancelled' });
  app.dispose();
});

it('closeTermScan은 진행 중에는 무시하고 끝난 뒤에만 결과를 닫는다', async () => {
  const { scan, release } = gatedScan();
  const app = await connectedApp({ termScan: scan });
  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('running'));

  app.closeTermScan();
  expect(app.getSnapshot().termScan).toMatchObject({ phase: 'running' });

  release();
  await pending;
  app.closeTermScan();
  expect(app.getSnapshot().termScan).toBeNull();
  app.dispose();
});

it('스캔 중인 같은 작품은 삭제가 막히고 다른 작품 삭제는 막히지 않는다', async () => {
  const removeWork = vi.fn(keepWork);
  const scan = pendingScan();
  const app = await connectedApp({ termScan: scan }, { removeWork });
  const pending = app.startTermScan(page.workId);
  await vi.waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('running'));

  await expect(app.removeWork(page.workId)).resolves.toMatchObject({
    removed: false,
    blockedBy: 'translation',
  });
  expect(removeWork).not.toHaveBeenCalled();

  const other = await app.removeWork('n9999zz');
  expect(other.blockedBy).toBeUndefined();
  expect(removeWork).toHaveBeenCalledWith('n9999zz', expect.anything());

  app.cancelTermScan();
  await pending;
  app.dispose();
});

it('외부 조회 설정은 기본으로 꺼져 있고 바꾸면 설정에 저장하며 끄면 키를 지운다', async () => {
  const saveReadingSettings = vi.fn(async (_value: Record<string, unknown>) => {});
  const app = await connectedApp({
    termScan: vi.fn<TermScan>(async () => emptyResult),
    settings: {
      readReadingSettings: async () => ({ schemaVersion: 2, selection: null, fontSize: 18 }),
      saveReadingSettings,
    } as never,
  });
  expect(app.getSnapshot()).toMatchObject({ lookupWikipedia: false, lookupNamuwiki: false });

  app.changeLookupWikipedia(true);
  expect(app.getSnapshot().lookupWikipedia).toBe(true);
  await vi.waitFor(() =>
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).toMatchObject({ lookupWikipedia: true }),
  );
  app.changeLookupNamuwiki(true);
  await vi.waitFor(() =>
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).toMatchObject({
      lookupWikipedia: true,
      lookupNamuwiki: true,
    }),
  );

  app.changeLookupWikipedia(false);
  await vi.waitFor(() =>
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('lookupWikipedia'),
  );
  expect(saveReadingSettings.mock.calls.at(-1)?.[0]).toMatchObject({ lookupNamuwiki: true });
  app.dispose();
});

it('저장된 외부 조회 설정을 불러오고 정밀스캔에 출처를 엔진으로 넘긴다', async () => {
  const scan = vi.fn<TermScan>(async () => emptyResult);
  const app = await connectedApp({
    termScan: scan,
    settings: {
      readReadingSettings: async () => ({
        schemaVersion: 2,
        selection: null,
        fontSize: 18,
        lookupNamuwiki: true,
      }),
      saveReadingSettings: async () => {},
    } as never,
  });
  expect(app.getSnapshot()).toMatchObject({ lookupWikipedia: false, lookupNamuwiki: true });

  await app.startTermScan(page.workId);
  expect(scan.mock.calls[0]?.[0]).toMatchObject({
    sources: { wikipedia: false, namuwiki: true },
  });
  app.dispose();
});
