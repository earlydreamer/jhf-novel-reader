import { expect, test, vi } from 'vitest';
import { createProviderSession, normalizeChapterInput } from '../../src/providers/plainText';
import { DEFAULT_LOCAL_LIMITS, limitsForModel } from '../../src/translation/segments';
import {
  estimatedLineTokens,
  LINE_INSTRUCTION,
  lineUnits,
  planLineBatches,
  taggedLines,
} from '../../src/translation/lines';
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
  promptVersion: 'lines-v1',
};
const selection = {
  connection: {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://localhost:1234',
    revision: 0,
  },
  modelId: 'chosen-model',
  limits,
};
const secrets = { get: async () => null, set: async () => {}, remove: async () => {} };
const response = (content: string, finish = 'stop') => ({
  choices: [{ finish_reason: finish, message: { content } }],
});
const contentOf = (body: Record<string, unknown>) =>
  (body.messages as { content: string }[])[0]!.content;
const idsOf = (content: string) => [...content.matchAll(/<p id="([A-Za-z]+)">/g)].map((m) => m[1]!);
/** 요청에 들어온 ID마다 `번역<ID>`를 돌려주는 모의 모델. take로 앞쪽 몇 개만 돌려줄 수 있다. */
const echo = (content: string, take = Infinity) =>
  idsOf(content)
    .slice(0, take)
    .map((id) => `<p id="${id}">번역${id}</p>`)
    .join('\n');

test('E4B 제공자와 저장 메타데이터에 같은 추정기가 사용된다', async () => {
  const modelId = '/models/gemma-4-E4B-it-UD-Q4_K_XL.gguf';
  const profile = limitsForModel(modelId, 16384);
  const chapter = {
    ...source,
    paragraphs: Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      text: '夏の朝、ユキは図書館で二冊の本を読みました。'.repeat(3),
      ruby: [],
    })),
  };
  const { transport, bodies } = transportWith((content) => ({ content: echo(content) }));
  const value = await createProviderSession(
    { ...selection, modelId, limits: profile },
    transport,
    secrets,
  ).translateChapter({ ...request, source: chapter }, new AbortController().signal);
  const units = lineUnits(chapter, profile, '', modelId);
  const batches = planLineBatches(units, profile, '', modelId);
  expect(bodies).toHaveLength(batches.length);
  expect(bodies.flatMap((body) => idsOf(contentOf(body)))).toEqual(units.map((u) => u.id));
  expect(bodies.every((body) => body.max_tokens === profile.maxOutputTokens)).toBe(true);
  expect(value.generation).toMatchObject({
    ...profile,
    estimator: 'gemma-e4b-v1',
    segments: batches.length,
  });
});
function transportWith(
  reply: (content: string, call: number) => { content: string; finish?: string },
) {
  const bodies: Record<string, unknown>[] = [];
  const transport: ModelTransport = {
    get: vi.fn(),
    post: async (input) => {
      bodies.push(input.body);
      const r = reply(contentOf(input.body), bodies.length);
      return { status: 200, url: input.url, headers: {}, data: response(r.content, r.finish) };
    },
  };
  return { transport, bodies };
}

test('reference data is matched per batch and placed before the line instruction', async () => {
  const reference = (input: string) =>
    input.includes('最後')
      ? 'Reference the following translations:\n最後 translates to 마지막 (' +
        'note '.repeat(30) +
        ')\n\n'
      : '';
  const { transport, bodies } = transportWith((content) => ({ content: echo(content) }));
  await createProviderSession(selection, transport, secrets).translateChapter(
    { ...request, reference },
    new AbortController().signal,
  );
  const inputs = bodies.map(contentOf);
  expect(inputs.every((input) => input.includes(LINE_INSTRUCTION))).toBe(true);
  expect(inputs.some((input) => input.startsWith(LINE_INSTRUCTION))).toBe(true);
  expect(inputs.some((input) => input.startsWith('Reference the following translations:'))).toBe(
    true,
  );
  for (const input of inputs) {
    const [before] = input.split(LINE_INSTRUCTION);
    expect(before === '' || input.includes('最後')).toBe(true);
  }
});
test('every unit is sent exactly once in order and the chapter is reassembled with blank paragraphs', async () => {
  const progress = vi.fn();
  const { transport, bodies } = transportWith((content) => ({ content: echo(content) }));
  const value = await createProviderSession(selection, transport, secrets).translateChapter(
    { ...request, onProgress: progress },
    new AbortController().signal,
  );
  const units = lineUnits(longSource, limits);
  const batches = planLineBatches(units, limits);
  expect(bodies).toHaveLength(batches.length);
  bodies.forEach((body, i) =>
    expect(body).toEqual({
      model: selection.modelId,
      messages: [{ role: 'user', content: LINE_INSTRUCTION + taggedLines(batches[i]!) }],
      stream: false,
      max_tokens: 512,
    }),
  );
  expect(bodies.flatMap((body) => idsOf(contentOf(body)))).toEqual(units.map((u) => u.id));
  expect(units.map((u) => u.text).join('')).toBe(
    normalizeChapterInput(longSource).replace('\n\n\n\n', ''),
  );
  expect(units.every((u) => estimatedLineTokens([u]) <= limits.inputBudgetTokens)).toBe(true);
  expect(value.generation).toEqual({
    mode: 'lines-v1',
    ...limits,
    segments: batches.length,
    continuations: 0,
    estimator: 'utf8-v1',
  });
  const [first, blank, last] = value.text.split('\n\n');
  expect(blank).toBe('');
  expect(first).toBe(
    units
      .filter((u) => u.paragraph === 0)
      .map((u) => `번역${u.id}`)
      .join(' '),
  );
  expect(last).toBe(
    units
      .filter((u) => u.paragraph === 2)
      .map((u) => `번역${u.id}`)
      .join(' '),
  );
  expect(progress.mock.calls).toEqual(
    Array.from({ length: batches.length + 1 }, (_, completed) => [completed, batches.length]),
  );
});
const manySource = {
  ...source,
  paragraphs: Array.from({ length: 12 }, (_, index) => ({
    id: `m${index}`,
    text: `短い文${index}。`,
    ruby: [],
  })),
};
const roomy = {
  ...selection,
  limits: { contextTokens: 8192, inputBudgetTokens: 2048, maxOutputTokens: 4096 },
};
test('a cut response keeps completed lines and continues with only the unfinished ones', async () => {
  const { transport, bodies } = transportWith((content, call) =>
    call === 1
      ? { content: echo(content, 2) + '\n<p id="C">잘린', finish: 'length' }
      : { content: echo(content) },
  );
  const value = await createProviderSession(roomy, transport, secrets).translateChapter(
    { ...request, source: manySource },
    new AbortController().signal,
  );
  expect(idsOf(contentOf(bodies[0]!))).toHaveLength(12);
  expect(idsOf(contentOf(bodies[1]!))).toEqual(idsOf(contentOf(bodies[0]!)).slice(2));
  expect(bodies).toHaveLength(2);
  expect(value.finishReason).toBe('complete');
  expect(value.generation?.continuations).toBe(1);
  expect(value.text.split('\n\n')).toHaveLength(12);
  expect(value.text).not.toContain('잘린');
});
test('each response publishes the completed paragraphs so far as an unsaved preview', async () => {
  const previews: string[] = [];
  const { transport } = transportWith((content, call) =>
    call === 1 ? { content: echo(content, 3), finish: 'length' } : { content: echo(content) },
  );
  const value = await createProviderSession(roomy, transport, secrets).translateChapter(
    { ...request, source: manySource, onPreview: (text) => previews.push(text) },
    new AbortController().signal,
  );
  expect(previews).toHaveLength(2);
  expect(previews[0]).toBe('번역A\n\n번역B\n\n번역C');
  expect(previews[1]).toBe(value.text);
});
test('a stop that skips lines also continues with the skipped lines only', async () => {
  const { transport, bodies } = transportWith((content, call) => ({
    content: call === 1 ? echo(content).replace(/<p id="E">[^\n]*\n/, '') : echo(content),
  }));
  const value = await createProviderSession(roomy, transport, secrets).translateChapter(
    { ...request, source: manySource },
    new AbortController().signal,
  );
  expect(idsOf(contentOf(bodies[1]!))).toEqual(['E']);
  expect(value.finishReason).toBe('complete');
});
test('a response without progress or beyond the continuation cap stops without a completed chapter', async () => {
  const none = transportWith(() => ({ content: '설명만 있는 응답' }));
  const empty = await createProviderSession(roomy, none.transport, secrets).translateChapter(
    { ...request, source: manySource },
    new AbortController().signal,
  );
  expect(empty.finishReason).toBe('unknown');
  expect(none.bodies).toHaveLength(1);
  const oneAtATime = transportWith((content) => ({ content: echo(content, 1), finish: 'length' }));
  const capped = await createProviderSession(roomy, oneAtATime.transport, secrets).translateChapter(
    { ...request, source: manySource },
    new AbortController().signal,
  );
  expect(capped.finishReason).toBe('length');
  expect(capped.text).toBe('');
  expect(oneAtATime.bodies).toHaveLength(9);
});
test('an oversized per-batch reference fails before any request is sent', async () => {
  const post = vi.fn<ModelTransport['post']>();
  const provider = createProviderSession(selection, { post, get: vi.fn() }, secrets);
  let calls = 0;
  const reference = () => (calls++ === 0 ? '' : 'x'.repeat(limits.inputBudgetTokens));
  await expect(
    provider.translateChapter({ ...request, reference }, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'input_limit' });
  expect(post).not.toHaveBeenCalled();
});
test('catalog capacity and model capability bound internal budgets; unreported capacity is conservative', async () => {
  const transport: ModelTransport = {
    post: vi.fn(),
    get: async (input) => ({
      status: 200,
      url: input.url,
      headers: {},
      data: {
        data: [
          { id: 'hy-mt2', meta: { n_ctx: 16384, n_ctx_train: 8192 } },
          { id: 'gemma', meta: { n_ctx: 4096, n_ctx_train: 131072 } },
          { id: 'unreported' },
        ],
      },
    }),
  };
  const models = await createProviderSession(selection, transport, secrets).listModels(
    new AbortController().signal,
  );
  expect(models.map((model) => model.contextTokens)).toEqual([8192, 4096, undefined]);
  expect(limitsForModel(models[0]!.id, models[0]!.contextTokens)).toEqual(DEFAULT_LOCAL_LIMITS);
  expect(limitsForModel(models[1]!.id, models[1]!.contextTokens)).toEqual({
    contextTokens: 4096,
    inputBudgetTokens: 1194,
    maxOutputTokens: 2390,
  });
  expect(limitsForModel('unreported').contextTokens).toBe(4096);
  expect(() => limitsForModel('too-small', 1024)).toThrow();
  expect(limitsForModel('hy-mt2', 16384).contextTokens).toBe(8192);
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
test.each(['length', 'blocked', 'unknown', 'blank', 'transport'])(
  'a %s second batch without progress saves no partial completed chapter',
  async (failure) => {
    let count = 0;
    const commitVersion = vi.fn();
    const flow = makeFlow(
      {
        get: vi.fn(),
        post: async (input) => {
          count++;
          if (count === 2 && failure === 'transport') throw Error('private failure');
          const content = contentOf(input.body);
          return {
            status: 200,
            url: input.url,
            headers: {},
            data:
              count === 1
                ? response(echo(content))
                : response(
                    failure === 'blank' ? ' ' : '<p id="X">부분',
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
test('all batches are required for one saved version and storage-only retry never generates again', async () => {
  const post = vi.fn(async (input: { url: string; body: Record<string, unknown> }) => ({
    status: 200,
    url: input.url,
    headers: {},
    data: response(echo(contentOf(input.body))),
  }));
  const commit = vi.fn().mockRejectedValueOnce(Error('disk fixture')).mockResolvedValue(undefined);
  const flow = makeFlow({ get: vi.fn(), post }, commit);
  await flow.start(ref, selection);
  expect(flow.getSnapshot().phase).toBe('failed');
  expect(flow.getSnapshot().pendingSave?.provenance.generation?.segments).toBe(
    post.mock.calls.length,
  );
  expect(flow.getSnapshot().pendingSave?.provenance.promptVersion).toBe('lines-v1');
  expect(flow.getCompleted()).toBeNull();
  const calls = post.mock.calls.length;
  await flow.retrySave();
  expect(post).toHaveBeenCalledTimes(calls);
  expect(flow.getSnapshot().phase).toBe('ready');
  expect(flow.getCompleted()?.source).toEqual(longSource);
});
test('stopping after a settled batch does not send the next batch', async () => {
  const control = new AbortController();
  const post = vi.fn(async (input: { url: string; body: Record<string, unknown> }) => ({
    status: 200,
    url: input.url,
    headers: {},
    data: response(echo(contentOf(input.body))),
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
test('default budgets leave output and safety space within the supported context', () => {
  expect(
    DEFAULT_LOCAL_LIMITS.inputBudgetTokens + DEFAULT_LOCAL_LIMITS.maxOutputTokens + 512,
  ).toBeLessThanOrEqual(8192);
});
