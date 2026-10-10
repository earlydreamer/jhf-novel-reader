import { expect, it, vi } from 'vitest';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import type {
  ChapterRef,
  CompletedTranslation,
  ProviderSession,
  WorkPage,
} from '../../src/contracts/reading';
import { createBatchTranslation } from '../../src/translation/batch';

const PREPARE_CONNECTION_MESSAGE = '설정에서 서버를 연결하고 번역 모델을 골라 주세요.';

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

function library() {
  return {
    saveWorkPage: vi.fn(async () => {}),
    listWorkIds: vi.fn(async () => [page.workId]),
    readWork: vi.fn(async () => [page]),
    listRecent: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    readVersion: vi.fn(async () => version),
    commitVersion: vi.fn(async () => {}),
    savePosition: vi.fn(async () => {}),
    readPosition: vi.fn(async () => null),
    removeWork: vi.fn(async () => ({
      removed: false,
      cleanupComplete: false,
      remainingInventory: [],
    })),
  };
}

/** 실제 배치 컨트롤러는 쓰되 준비 실행(prepare)만 막아 호출 여부를 본다. */
function batchSpy() {
  const batch = createBatchTranslation({
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    library: library() as never,
    flow: {
      active: false,
      getSnapshot: () => ({ pendingSave: null }),
      getUnfinished: () => [],
      getCompleted: () => undefined,
      subscribe: () => () => {},
      cancel() {},
      dispose() {},
      start: vi.fn(),
      retrySave: vi.fn(),
    } as never,
    repository: { read: async () => null, write: async () => {} } as never,
  });
  const prepare = vi.spyOn(batch, 'prepare').mockResolvedValue(undefined);
  return { batch, prepare };
}

function session(): ProviderSession {
  return {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
  };
}

/** 앱을 켠 직후처럼 저장된 모델만 있고 연결 확인은 아직 안 한 상태(catalogStatus idle)를 만든다. */
async function restoredApp(deps: Partial<RenewalDependencies> = {}) {
  const app = createRenewalController({
    library: library() as never,
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    connect: async () => session(),
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

it('앱을 켠 직후 연결 확인이 안 됐어도 저장된 모델로 먼저 확인하고 미리 번역을 준비한다', async () => {
  const { batch, prepare } = batchSpy();
  const connect = vi.fn(async () => session());
  const app = await restoredApp({ batch, connect: connect as never });
  expect(app.getSnapshot()).toMatchObject({ catalogStatus: 'idle', selectedModelId: 'local' });
  const before = connect.mock.calls.length;

  await app.prepareBatch({ first: 1, last: 2 }, false);
  expect(connect.mock.calls.length).toBeGreaterThan(before);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(prepare.mock.calls[0]![2]).toEqual({ first: 1, last: 2 });
  expect(app.getSnapshot()).toMatchObject({ catalogStatus: 'connected', error: null });
  app.dispose();
});

it('연결 확인이 실패하면 준비하지 않고 연결 안내를 띄운다', async () => {
  const { batch, prepare } = batchSpy();
  const app = await restoredApp({
    batch,
    connect: async () => {
      throw new Error('offline');
    },
  });
  await app.prepareBatch({ first: 1, last: 2 }, false);
  expect(prepare).not.toHaveBeenCalled();
  expect(app.getSnapshot().error).toBe(PREPARE_CONNECTION_MESSAGE);
  app.dispose();
});

it('연결 확인 중 두 번째 준비 요청은 아무것도 하지 않아 준비가 두 번 돌지 않는다', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let gated = false;
  const { batch, prepare } = batchSpy();
  const app = await restoredApp({
    batch,
    connect: async () => {
      if (gated) await gate;
      return session();
    },
  });
  gated = true;

  const first = app.prepareBatch({ first: 1, last: 2 }, false);
  await vi.waitFor(() => expect(app.getSnapshot().catalogStatus).toBe('checking'));
  await app.prepareBatch({ first: 1, last: 2 }, false);
  expect(app.getSnapshot().error).toBeNull();

  release();
  await first;
  expect(prepare).toHaveBeenCalledTimes(1);
  app.dispose();
});
