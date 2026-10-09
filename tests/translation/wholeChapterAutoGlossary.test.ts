import { expect, test, vi } from 'vitest';
import { createWholeChapterFlow, type FlowDependencies } from '../../src/translation/wholeChapter';
import type {
  ChapterRef,
  CompletedTranslation,
  ProviderSession,
  SelectedModel,
} from '../../src/contracts/reading';
import { GEMINI_BASE_URL } from '../../src/providers/gemini';
import { source } from '../providers/wholeChapterFixture';

type AutoGlossary = NonNullable<FlowDependencies['autoGlossary']>;

const ref: ChapterRef = {
  workId: source.workId,
  chapterId: source.chapterId,
  canonicalUrl: source.canonicalUrl,
  title: source.title,
  ordinal: 1,
};
const local: SelectedModel = {
  connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
  modelId: 'local',
};

function makeFlow(autoGlossary?: AutoGlossary, text = '번역 본문') {
  const translate = vi.fn(async () => ({ text, finishReason: 'complete' as const }));
  const provider: ProviderSession = { listModels: async () => [], translateChapter: translate };
  const flow = createWholeChapterFlow({
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
    ...(autoGlossary ? { autoGlossary } : {}),
  });
  flow.setForeground(true);
  return { flow, translate };
}

test('옵션이 켜져 있으면 원문을 받은 뒤 번역 전에 자동 용어집을 한 번 실행한다', async () => {
  const autoGlossary = vi.fn<AutoGlossary>(async () => 'added');
  const { flow, translate } = makeFlow(autoGlossary);
  await flow.start(ref, local, undefined, undefined, undefined, { autoGlossary: true });
  expect(autoGlossary).toHaveBeenCalledTimes(1);
  expect(autoGlossary.mock.calls[0]?.[0]).toMatchObject({
    workId: source.workId,
    source: expect.objectContaining({ chapterId: source.chapterId }),
    selection: expect.objectContaining({ modelId: 'local' }),
    signal: expect.any(AbortSignal),
  });
  expect(autoGlossary.mock.invocationCallOrder[0]!).toBeLessThan(
    translate.mock.invocationCallOrder[0]!,
  );
  expect(flow.getSnapshot()).toMatchObject({ phase: 'ready' });
  expect(flow.getSnapshot().glossary).toBeUndefined();
});

test('자동 용어집이 실패하면 번역은 계속되고 glossary 상태는 failed가 된다', async () => {
  const autoGlossary = vi.fn<AutoGlossary>(async () => {
    throw new Error('model down');
  });
  const { flow, translate } = makeFlow(autoGlossary);
  await flow.start(ref, local, undefined, undefined, undefined, { autoGlossary: true });
  expect(translate).toHaveBeenCalledTimes(1);
  expect(flow.getCompleted()).not.toBeNull();
  expect(flow.getSnapshot()).toMatchObject({ phase: 'ready', glossary: 'failed' });
});

test('자동 용어집 진행 중 사용자가 취소하면 번역이 시작되지 않는다', async () => {
  const autoGlossary = vi.fn<AutoGlossary>(
    ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const { flow, translate } = makeFlow(autoGlossary);
  const started = flow.start(ref, local, undefined, undefined, undefined, { autoGlossary: true });
  await vi.waitFor(() => expect(autoGlossary).toHaveBeenCalled());
  flow.cancel();
  await started;
  expect(translate).not.toHaveBeenCalled();
  expect(flow.getSnapshot().phase).toBe('failed');
  expect(flow.getSnapshot().error?.code).toBe('cancelled');
});

test('자동 용어집이 30초를 넘기면 신호가 중단되고 번역은 failed 상태로 계속된다', async () => {
  vi.useFakeTimers();
  try {
    let entered!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let childSignal: AbortSignal | undefined;
    const autoGlossary = vi.fn<AutoGlossary>(({ signal }) => {
      childSignal = signal;
      entered();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('timeout'))),
      );
    });
    const { flow, translate } = makeFlow(autoGlossary);
    const started = flow.start(ref, local, undefined, undefined, undefined, { autoGlossary: true });
    await called;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(childSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(childSignal?.aborted).toBe(true);
    await started;
    expect(translate).toHaveBeenCalledTimes(1);
    expect(flow.getSnapshot()).toMatchObject({ phase: 'ready', glossary: 'failed' });
  } finally {
    vi.useRealTimers();
  }
});

test('옵션이 없으면 자동 용어집을 호출하지 않는다', async () => {
  const autoGlossary = vi.fn<AutoGlossary>(async () => 'added');
  const { flow, translate } = makeFlow(autoGlossary);
  await flow.start(ref, local);
  expect(autoGlossary).not.toHaveBeenCalled();
  expect(translate).toHaveBeenCalledTimes(1);
});

test('gemini 선택이면 옵션이 켜져 있어도 자동 용어집을 호출하지 않는다', async () => {
  const autoGlossary = vi.fn<AutoGlossary>(async () => 'added');
  const { flow, translate } = makeFlow(autoGlossary);
  const gemini: SelectedModel = {
    connection: { provider: 'gemini', baseUrl: GEMINI_BASE_URL, revision: 0 },
    modelId: 'gemini-test',
  };
  await flow.start(ref, gemini, undefined, undefined, undefined, { autoGlossary: true });
  expect(autoGlossary).not.toHaveBeenCalled();
  expect(translate).toHaveBeenCalledTimes(1);
});

test('문단 복구 요청이면 옵션이 켜져 있어도 자동 용어집을 호출하지 않는다', async () => {
  const autoGlossary = vi.fn<AutoGlossary>(async () => 'added');
  const { flow, translate } = makeFlow(autoGlossary, '수정\n\n\n\n');
  const base = {
    schemaVersion: 2,
    versionId: 'base',
    source,
    text: '기존0\n\n\n\n기존2',
    blocks: source.paragraphs.map((_paragraph, index) => ({
      id: `b${index}`,
      text: `기존${index}`,
    })),
    createdAt: '2026-10-04T00:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'connection',
      modelId: 'local',
      contractVersion: 'plain-v1',
      promptVersion: 'colomo-local-v1',
      languageDirection: 'ja-ko',
    },
  } as CompletedTranslation;
  const streaming: SelectedModel = { ...local, translationMode: 'stream' };
  await flow.start(
    ref,
    streaming,
    undefined,
    undefined,
    { base, indexes: [0] },
    {
      autoGlossary: true,
    },
  );
  expect(translate).toHaveBeenCalledTimes(1);
  expect(flow.getSnapshot().phase).toBe('ready');
  expect(autoGlossary).not.toHaveBeenCalled();
});
