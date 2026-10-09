import { expect, it, vi } from 'vitest';
import { createRenewalController } from '../../src/app/renewalController';
import type { ChapterRef, ProviderSession, WorkPage } from '../../src/contracts/reading';
import type { ReadingSettings } from '../../src/storage/settings';
import { createWholeChapterFlow, type FlowDependencies } from '../../src/translation/wholeChapter';
import { source } from '../providers/wholeChapterFixture';

type AutoGlossary = NonNullable<FlowDependencies['autoGlossary']>;

const chapter: ChapterRef = {
  workId: source.workId,
  chapterId: source.chapterId,
  canonicalUrl: source.canonicalUrl,
  title: source.title,
  ordinal: 1,
};
const workPage: WorkPage = {
  workId: source.workId,
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '작품',
  chapters: [chapter],
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};

// 빈 문단을 포함해 원문과 같은 세 문단으로 나뉘어야 문단 재번역을 검사할 수 있다.
const threeParagraphs = '첫째\n\n\n\n셋째';

function makeFlow(autoGlossary: AutoGlossary) {
  const provider: ProviderSession = {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({
      text: threeParagraphs,
      finishReason: 'complete' as const,
    })),
  };
  return createWholeChapterFlow({
    source: { getChapter: vi.fn(async () => source), getWorkPage: vi.fn() },
    createProvider: () => provider,
    store: {
      commitVersion: vi.fn(async () => {}),
      saveWorkPage: vi.fn(),
      listWorkIds: vi.fn(async () => []),
      readWork: vi.fn(),
      listRecent: vi.fn(),
      listVersions: vi.fn(),
      readVersion: vi.fn(),
      savePosition: vi.fn(),
      readPosition: vi.fn(),
    },
    attempts: { readUnfinished: async () => [], write: async () => {} },
    clock: { now: () => 0 },
    autoGlossary,
  });
}

async function readyController(
  options: { flow?: ReturnType<typeof makeFlow>; saved?: Partial<ReadingSettings> } = {},
) {
  const saved: ReadingSettings = {
    schemaVersion: 2,
    selection: null,
    fontSize: 18,
    autoTranslate: false,
    ...options.saved,
  };
  const saveReadingSettings = vi.fn(async (_value: ReadingSettings) => {});
  const flow = options.flow ?? makeFlow(vi.fn<AutoGlossary>(async () => 'added'));
  const session: ProviderSession = {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({
      text: threeParagraphs,
      finishReason: 'complete' as const,
    })),
  };
  const controller = createRenewalController({
    flow,
    connect: async () => session,
    source: { getWorkPage: vi.fn(async () => workPage), getChapter: vi.fn(async () => source) },
    streamingAvailable: true,
    settings: { readReadingSettings: async () => saved, saveReadingSettings },
  });
  await controller.initialize();
  controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await controller.checkConnection();
  controller.chooseModel('local');
  await controller.openWork(workPage.pageUrl);
  await controller.selectChapter(chapter);
  return { controller, flow, saveReadingSettings };
}

it('자동 용어집은 기본으로 켜져 있고 끄면 설정에 false로 저장되며 다시 켜면 키가 빠진다', async () => {
  const { controller, saveReadingSettings } = await readyController();
  expect(controller.getSnapshot().autoGlossary).toBe(true);

  controller.changeAutoGlossary(false);
  expect(controller.getSnapshot().autoGlossary).toBe(false);
  await vi.waitFor(() =>
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).toMatchObject({ autoGlossary: false }),
  );

  controller.changeAutoGlossary(true);
  await vi.waitFor(() =>
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('autoGlossary'),
  );
  controller.dispose();
});

it('저장된 끔 설정을 불러오면 자동 용어집이 꺼진 상태로 시작한다', async () => {
  const { controller } = await readyController({ saved: { autoGlossary: false } });
  expect(controller.getSnapshot().autoGlossary).toBe(false);
  controller.dispose();
});

it('번역은 flow.start에 자동 용어집 옵션을 넘기고 끄면 false를 넘긴다', async () => {
  const { controller, flow } = await readyController();
  const start = vi.spyOn(flow, 'start');

  await controller.translate();
  expect(start).toHaveBeenLastCalledWith(
    expect.objectContaining({ chapterId: source.chapterId }),
    expect.objectContaining({ modelId: 'local' }),
    undefined,
    undefined,
    undefined,
    { autoGlossary: true },
  );

  controller.changeAutoGlossary(false);
  controller.dispose();
});

it('자동 용어집을 끄면 번역 호출에 false를 넘긴다', async () => {
  const { controller, flow } = await readyController();
  const start = vi.spyOn(flow, 'start');
  controller.changeAutoGlossary(false);

  await controller.translate();
  expect(start).toHaveBeenLastCalledWith(
    expect.anything(),
    expect.anything(),
    undefined,
    undefined,
    undefined,
    { autoGlossary: false },
  );
  controller.dispose();
});

it('자동 용어집이 실패하면 오류 알림을 같은 번역에서 한 번만 publish한다', async () => {
  const flow = makeFlow(
    vi.fn(async () => {
      throw new Error('synthetic glossary failure');
    }),
  );
  const { controller } = await readyController({ flow });
  const revisions = new Set<number>();
  controller.subscribe(() => {
    const snapshot = controller.getSnapshot();
    if (snapshot.error === '용어집을 만들지 못해 그대로 번역해요.')
      revisions.add(snapshot.errorRevision);
  });

  await controller.translate();

  expect(controller.getSnapshot().translation).toMatchObject({ phase: 'ready' });
  expect(revisions.size).toBe(1);
  controller.dispose();
});

it('문단 재번역에는 자동 용어집을 쓰지 않는다', async () => {
  const { controller, flow } = await readyController();
  await controller.translate();
  const start = vi.spyOn(flow, 'start');
  await controller.retryParagraphs([0]);
  expect(start).toHaveBeenCalled();
  expect(start.mock.calls.at(-1)?.[5]).toEqual({ autoGlossary: false });
  controller.dispose();
});
