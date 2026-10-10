import { expect, test, vi } from 'vitest';
import { createWholeChapterFlow, type FlowDependencies } from '../../src/translation/wholeChapter';
import type {
  ChapterRef,
  ProviderSession,
  SelectedModel,
  SourceSnapshot,
} from '../../src/contracts/reading';
import type { WorkGuidance } from '../../src/translation/guidance';
import type { CandidateDecision } from '../../src/translation/termDecision';
import { source } from '../providers/wholeChapterFixture';

type Decide = NonNullable<FlowDependencies['decideCandidates']>;
type Request = {
  reference?: (input: string) => string;
  requiredTerms?: (input: string) => { source: string; target: string }[];
};

const chapterSource: SourceSnapshot = {
  ...source,
  paragraphs: [{ id: 'p1', text: 'クルシアーノが来た。', ruby: [] }],
};
const ref: ChapterRef = {
  workId: source.workId,
  chapterId: source.chapterId,
  canonicalUrl: source.canonicalUrl,
  title: source.title,
  ordinal: 1,
};
const streaming: SelectedModel = {
  connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
  modelId: 'local',
  translationMode: 'stream',
};
// 'ルシア'는 'ルシアナ'의 별칭이고 입력에서는 'ー'가 뒤에 붙어 후보로만 등장한다.
const guidance: WorkGuidance = {
  schemaVersion: 1,
  workId: source.workId,
  hash: 'hash',
  terms: [{ source: 'ルシアナ', target: '루시아나', aliases: ['ルシア'], category: '', note: '' }],
  voices: [],
};
const confirmed: CandidateDecision = { confirmed: new Set(['ルシア']), rejected: new Set() };

function makeFlow(decideCandidates?: Decide) {
  const translate = vi.fn(async () => ({ text: '번역', finishReason: 'complete' as const }));
  const provider: ProviderSession = { listModels: async () => [], translateChapter: translate };
  const flow = createWholeChapterFlow({
    source: { getChapter: vi.fn(async () => chapterSource), getWorkPage: vi.fn() },
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
    ...(decideCandidates ? { decideCandidates } : {}),
  });
  flow.setForeground(true);
  return { flow, translate };
}

function requestOf(translate: { mock: { calls: unknown[][] } }): Request {
  const calls: unknown[][] = translate.mock.calls;
  return calls[0]![0] as Request;
}

test('번역 전에 판정을 한 번 부르고, 그 결과를 참고 문구와 필수 용어에 반영한다', async () => {
  const decide = vi.fn<Decide>(async () => confirmed);
  const { flow, translate } = makeFlow(decide);
  await flow.start(ref, streaming, guidance);
  expect(decide).toHaveBeenCalledTimes(1);
  expect(decide.mock.calls[0]![0]).toContain('クルシアーノ');
  expect(decide.mock.calls[0]![1]).toEqual(guidance);
  expect(translate.mock.invocationCallOrder[0]!).toBeGreaterThan(
    decide.mock.invocationCallOrder[0]!,
  );
  const request = requestOf(translate);
  expect(request.reference?.('クルシアーノが来た。')).toContain('ルシア->루시아나');
  expect(request.reference?.('クルシアーノが来た。')).not.toContain('only if');
  expect(request.requiredTerms?.('クルシアーノが来た。')).toEqual([
    { source: 'ルシア', target: '루시아나' },
  ]);
  expect(flow.getSnapshot().phase).toBe('ready');
});

test('판정이 던지면 판정 없이 번역을 계속한다', async () => {
  const decide = vi.fn<Decide>(async () => {
    throw new Error('model down');
  });
  const { flow, translate } = makeFlow(decide);
  await flow.start(ref, streaming, guidance);
  expect(decide).toHaveBeenCalledTimes(1);
  expect(translate).toHaveBeenCalledTimes(1);
  expect(flow.getSnapshot().phase).toBe('ready');
  const request = requestOf(translate);
  expect(request.reference?.('クルシアーノが来た。')).toContain(
    'ルシア->루시아나 (only if used as a name here)',
  );
  expect(request.requiredTerms?.('クルシアーノが来た。')).toEqual([]);
});

test('판정 함수가 없으면 기존처럼 번역한다', async () => {
  const { flow, translate } = makeFlow();
  await flow.start(ref, streaming, guidance);
  expect(translate).toHaveBeenCalledTimes(1);
  expect(flow.getSnapshot().phase).toBe('ready');
});
