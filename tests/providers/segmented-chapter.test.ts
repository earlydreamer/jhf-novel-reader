import { expect, test, vi } from 'vitest';
import { createProviderSession, normalizeChapterInput } from '../../src/providers/plainText';
import {
  DEFAULT_LOCAL_LIMITS,
  estimatedInputTokens,
  planSegments,
  SEGMENT_INSTRUCTION,
} from '../../src/translation/segments';
import { createWholeChapterFlow } from '../../src/translation/wholeChapter';
import type {
  CompletedTranslation,
  ModelTransport,
  WholeChapterRequest,
} from '../../src/contracts';
import { source } from './wholeChapterFixture';

const limits = { contextTokens: 2048, inputBudgetTokens: 1024, maxOutputTokens: 512 };
const longSource = {
  ...source,
  paragraphs: [
    {
      id: 'a',
      text: '長い文章。'.repeat(100) + '😀基底',
      ruby: [{ start: 502, end: 504, reading: 'よみ' }],
    },
    { id: 'blank', text: '', ruby: [] },
    { id: 'b', text: '最後の文章。'.repeat(50), ruby: [] },
  ],
};
const request: WholeChapterRequest = {
  source: longSource,
  token: { requestId: 'request', chapterId: source.chapterId, settingsRevision: 0 },
  languageDirection: 'ja-ko',
  contractVersion: 'plain-v1',
  promptVersion: 'hymt2-segments-v1',
};
const selection = {
  connection: {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://localhost:1234',
    revision: 0,
  },
  modelId: 'chosen-hy-mt2',
  limits,
};
const secrets = { get: async () => null, set: async () => {}, remove: async () => {} };
const response = (content: string, finish = 'stop') => ({
  choices: [{ finish_reason: finish, message: { content } }],
});

test('bounded segments reconstruct the entire normalized source without cutting ruby or surrogate pairs', () => {
  const parts = planSegments(longSource, limits);
  expect(parts.length).toBeGreaterThan(2);
  expect(parts.map((p) => p.input).join('')).toBe(normalizeChapterInput(longSource));
  expect(parts.every((p) => estimatedInputTokens(p.input) <= limits.inputBudgetTokens)).toBe(true);
  expect(parts.filter((p) => p.input.includes('基底《よみ》'))).toHaveLength(1);
  expect(
    parts.every((p) => !/[\uD800-\uDBFF]$/.test(p.input) && !/^[\uDC00-\uDFFF]/.test(p.input)),
  ).toBe(true);
  expect(parts.map((p) => p.input).join('')).toContain('\n\n\n\n');
});
test('an impossible context or indivisible oversized ruby is rejected before dispatch', async () => {
  const post = vi.fn();
  const transport: ModelTransport = { get: vi.fn(), post };
  expect(() =>
    createProviderSession(
      { ...selection, limits: { ...limits, contextTokens: 1024 } },
      transport,
      secrets,
    ),
  ).toThrow();
  const huge = {
    ...request,
    source: {
      ...source,
      paragraphs: [
        { id: 'p', text: '字', ruby: [{ start: 0, end: 1, reading: 'あ'.repeat(1000) }] },
      ],
    },
  };
  await expect(
    createProviderSession(selection, transport, secrets).translateChapter(
      huge,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'input_limit' });
  expect(post).not.toHaveBeenCalled();
});
test('explicit budgets, independent requests and ordered progress are used for the frozen selected model', async () => {
  const calls: Record<string, unknown>[] = [];
  const progress = vi.fn();
  const transport: ModelTransport = {
    get: vi.fn(),
    post: async (input) => {
      calls.push(input.body);
      return { status: 200, url: input.url, headers: {}, data: response(`번역${calls.length}`) };
    },
  };
  const value = await createProviderSession(selection, transport, secrets).translateChapter(
    { ...request, onProgress: progress },
    new AbortController().signal,
  );
  const parts = planSegments(longSource, limits);
  expect(calls).toHaveLength(parts.length);
  expect(value.generation).toEqual({ mode: 'segments-v1', ...limits, segments: parts.length });
  calls.forEach((body, i) =>
    expect(body).toEqual({
      model: selection.modelId,
      messages: [{ role: 'user', content: SEGMENT_INSTRUCTION + parts[i]!.input }],
      stream: false,
      max_tokens: 512,
    }),
  );
  expect(progress.mock.calls).toEqual(
    Array.from({ length: parts.length + 1 }, (_, completed) => [completed, parts.length]),
  );
  expect(value.text).toBe(
    parts.map((part, i) => `번역${i + 1}` + (i < parts.length - 1 ? part.separator : '')).join(''),
  );
});
test.each(['length', 'blocked', 'unknown', 'blank', 'transport'])(
  'a %s second segment sends no later request or partial completed chapter',
  async (failure) => {
    let count = 0;
    const commitVersion = vi.fn();
    const flow = makeFlow(
      {
        get: vi.fn(),
        post: async (input) => {
          count++;
          if (count === 2 && failure === 'transport') throw Error('private failure');
          return {
            status: 200,
            url: input.url,
            headers: {},
            data:
              count === 1
                ? response('처음 번역')
                : response(
                    failure === 'blank' ? ' ' : '부분',
                    failure === 'blocked'
                      ? 'content_filter'
                      : failure === 'unknown'
                        ? ''
                        : failure === 'blank'
                          ? 'stop'
                          : 'length',
                  ),
          };
        },
      },
      commitVersion,
    );
    await flow.start(ref, selection);
    expect(count).toBe(2);
    expect(commitVersion).not.toHaveBeenCalled();
    expect(flow.getCompleted()).toBeNull();
    expect(['failed', 'unknown']).toContain(flow.getSnapshot().phase);
  },
);
const ref = {
  workId: source.workId,
  chapterId: source.chapterId,
  canonicalUrl: source.canonicalUrl,
  title: source.title,
  ordinal: 1,
};
function makeFlow(
  transport: ModelTransport,
  commitVersion: (value: CompletedTranslation) => Promise<void>,
) {
  const flow = createWholeChapterFlow({
    source: { getChapter: async () => longSource, getWorkPage: vi.fn() },
    createProvider: (selected) => createProviderSession(selected, transport, secrets),
    store: {
      commitVersion,
      saveWorkPage: vi.fn(),
      readWork: vi.fn(),
      listRecent: vi.fn(),
      listVersions: vi.fn(),
      readVersion: vi.fn(),
      savePosition: vi.fn(),
      readPosition: vi.fn(),
    },
    attempts: { readUnfinished: async () => [], write: async () => {} },
    clock: { now: () => 0 },
  });
  flow.setForeground(true);
  return flow;
}
test('all segments are required for one saved version and storage-only retry never generates again', async () => {
  const post = vi.fn(async (input) => ({
    status: 200,
    url: input.url,
    headers: {},
    data: response('저장할 번역'),
  }));
  const commit = vi.fn().mockRejectedValueOnce(Error('disk fixture')).mockResolvedValue(undefined);
  const flow = makeFlow({ get: vi.fn(), post }, commit);
  await flow.start(ref, selection);
  expect(flow.getSnapshot().phase).toBe('failed');
  expect(flow.getSnapshot().pendingSave?.provenance.generation?.segments).toBe(
    post.mock.calls.length,
  );
  expect(flow.getCompleted()).toBeNull();
  const calls = post.mock.calls.length;
  await flow.retrySave();
  expect(post).toHaveBeenCalledTimes(calls);
  expect(flow.getSnapshot().phase).toBe('ready');
  expect(flow.getCompleted()?.source).toEqual(longSource);
});
test('stopping after a settled segment does not send the next segment', async () => {
  const control = new AbortController();
  const post = vi.fn(async (input) => ({
    status: 200,
    url: input.url,
    headers: {},
    data: response('번역'),
  }));
  const provider = createProviderSession(selection, { get: vi.fn(), post }, secrets);
  await expect(
    provider.translateChapter(
      {
        ...request,
        onProgress: (completed) => {
          if (completed === 1) control.abort();
        },
      },
      control.signal,
    ),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(post).toHaveBeenCalledTimes(1);
});
test('default Hy-MT2 budgets leave output and safety space within the supported context', () => {
  expect(
    DEFAULT_LOCAL_LIMITS.inputBudgetTokens + DEFAULT_LOCAL_LIMITS.maxOutputTokens + 512,
  ).toBeLessThanOrEqual(8192);
});
