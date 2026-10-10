import { expect, test, vi } from 'vitest';
import { createProviderSession } from '../../src/providers/plainText';
import { createOpenAIStream } from '../../src/providers/openaiStream';
import { streamingLimits } from '../../src/providers/localStreaming';
import {
  ReaderError,
  type ModelRequest,
  type ModelTransport,
  type WholeChapterRequest,
} from '../../src/contracts';
import { source } from './wholeChapterFixture';
import {
  appliedGuidance,
  plotSummaryWithoutNames,
  type WorkGuidance,
} from '../../src/translation/guidance';
const selection = {
  connection: {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://localhost:1234',
    revision: 0,
  },
  modelId: 'gemma-4-E4B',
  limits: { contextTokens: 16384, inputBudgetTokens: 5290, maxOutputTokens: 10582 },
  translationMode: 'stream' as const,
};
const secrets = { get: async () => null, set: async () => {}, remove: async () => {} };
const chapter = {
  ...source,
  paragraphs: Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`,
    text: '夏の朝、扉を開けた。',
    ruby: [],
  })),
};
const request: WholeChapterRequest = {
  source: chapter,
  token: { chapterId: source.chapterId, requestId: 'request', settingsRevision: 0 },
  contractVersion: 'plain-v1',
  promptVersion: 'colomo-local-v1',
  languageDirection: 'ja-ko',
};
const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
const ending =
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function fixture(reply?: (body: string, call: number) => string) {
  const calls: ModelRequest[] = [];
  const transport: ModelTransport = {
    get: vi.fn(),
    post: vi.fn(),
    streamPost: async (input, _signal, onData) => {
      calls.push(input);
      const body = (input.body.messages as { content: string }[]).at(-1)!.content;
      const lines = [...body.matchAll(/<p id="([A-Za-z]+)">([\s\S]*?)<\/p>/g)];
      const text =
        reply?.(body, calls.length) ??
        '<main>\n' + lines.map((m) => `<p id="${m[1]}">번역${m[1]}</p>`).join('\n') + '\n</main>';
      const data = delta(text) + ending;
      for (let i = 0; i < data.length; i += 7) onData(data.slice(i, i + 7));
      return { status: 200, url: input.url, headers: {}, data };
    },
  };
  return { calls, transport, provider: createProviderSession(selection, transport, secrets) };
}
test('SSE handles arbitrary network/JSON/Unicode boundaries and requires terminal completion', () => {
  const observed: string[] = [];
  const parser = createOpenAIStream((t) => observed.push(t));
  const data = ': keepalive\r\n\r\n' + delta('첫😀문단').replaceAll('\n', '\r\n') + ending;
  for (const char of data.split('')) parser.push(char);
  expect(parser.complete()).toEqual({ text: '첫😀문단', finishReason: 'complete' });
  expect(observed).toEqual(['첫😀문단']);
  const incomplete = createOpenAIStream(() => {});
  incomplete.push(delta('부분'));
  expect(() => incomplete.complete()).toThrow();
});
test.each([
  'data: {bad}\n\n',
  'data: {"error":{"message":"private"}}\n\n',
  'data: {"choices":[{"delta":{"tool_calls":[{}]}}]}\n\n',
  'data: {"choices":[{"index":1,"delta":{}}]}\n\n',
])('rejects invalid SSE without adopting content: %s', (frame) => {
  const parser = createOpenAIStream(() => {});
  expect(() => parser.push(frame)).toThrow(ReaderError);
});
test('first 8 and following 16 paragraph batches stay inside 8K and include only the last pair', async () => {
  const f = fixture();
  const preview = vi.fn();
  const result = await f.provider.translateChapter(
    { ...request, onPreview: preview },
    new AbortController().signal,
  );
  expect(
    f.calls.map(
      (c) =>
        [
          ...(c.body.messages as { content: string }[])
            .at(-1)!
            .content.matchAll(/<p id="[A-Za-z]+">/g),
        ].length,
    ),
  ).toEqual([8, 16, 16]);
  expect(f.calls.map((c) => (c.body.messages as unknown[]).length)).toEqual([1, 3, 3]);
  expect((f.calls[2]!.body.messages as { content: string }[])[0]!.content).not.toContain('id="A"');
  expect(result.generation).toMatchObject({
    mode: 'colomo-local-v1',
    contextTokens: 8192,
    segments: 3,
    continuations: 0,
  });
  expect(f.calls.every((c) => c.body.stream === true)).toBe(true);
  expect(f.transport.post).not.toHaveBeenCalled();
  expect(preview).toHaveBeenCalled();
});
test('shows partial text before the first native response finishes', async () => {
  let settle!: () => void;
  const gate = new Promise<void>((r) => {
    settle = r;
  });
  const transport: ModelTransport = {
    get: vi.fn(),
    post: vi.fn(),
    streamPost: async (input, _signal, onData) => {
      onData(delta('<main><p id="A">지금 읽는'));
      await gate;
      const raw = delta('<main><p id="A">지금 읽는 문단</p></main>') + ending;
      return { status: 200, url: input.url, headers: {}, data: raw };
    },
  };
  const previews: string[] = [];
  let completed = false;
  const running = createProviderSession(selection, transport, secrets)
    .translateChapter(
      {
        ...request,
        source: { ...chapter, paragraphs: chapter.paragraphs.slice(0, 1) },
        onPreview: (t) => previews.push(t),
      },
      new AbortController().signal,
    )
    .then((r) => {
      completed = true;
      return r;
    });
  await vi.waitFor(() => expect(previews).toContain('지금 읽는'));
  expect(completed).toBe(false);
  settle();
  await running;
});
test('sends locked names as source text, checks their renderings, and preserves blank paragraphs', async () => {
  const f = fixture(
    () =>
      '<main><p id="A">알베르트는 기타지마를 보았다.</p><p id="B">기타지마는 웃었다.</p></main>',
  );
  const value = await f.provider.translateChapter(
    {
      ...request,
      source: {
        ...source,
        paragraphs: [
          {
            id: 'p1',
            text: 'アルベルトは北嶋を見た。',
            ruby: [{ start: 6, end: 8, reading: 'きたじま' }],
          },
          { id: 'blank', text: '', ruby: [] },
          { id: 'p2', text: '北嶋は笑った。', ruby: [] },
        ],
      },
      requiredTerms: (input) =>
        [
          { source: 'アルベルト', target: '알베르트' },
          { source: '北嶋', target: '기타지마' },
        ].filter((term) => input.includes(term.source)),
    },
    new AbortController().signal,
  );
  const sent = (f.calls[0]!.body.messages as { content: string }[])[0]!.content;
  // 용어 이름 바로 뒤의 루비 읽기는 모델 입력에서 빠진다.
  expect(sent).toContain('アルベルトは北嶋を見た。');
  expect(sent).not.toContain('きたじま');
  expect(sent).not.toContain('__ENT_');
  expect(f.calls).toHaveLength(1);
  expect(value.text).toBe('알베르트는 기타지마를 보았다.\n\n\n\n기타지마는 웃었다.');
});
test('retries a defective chunk once, then keeps only defective rows as marked source', async () => {
  const f = fixture(() => '<main><p id="A">정상 문단</p><p id="B">まだ日本語</p></main>');
  const result = await f.provider.translateChapter(
    { ...request, source: { ...chapter, paragraphs: chapter.paragraphs.slice(0, 2) } },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(2);
  expect(result.failedParagraphs).toEqual([1]);
  expect(result.text).toContain('정상 문단');
  expect(result.text).toContain('[번역 실패 · 원문]');
  expect(result.generation?.continuations).toBe(1);
  const retryInput = (f.calls[1]!.body.messages as { content: string }[]).at(-1)!.content;
  expect(retryInput).toContain('<p id="B">');
  expect(retryInput).not.toContain('<p id="A">');
});
test('automatic paragraph retry off makes one request and marks the failed paragraph', async () => {
  const f = fixture(() => '<main><p id="A">정상</p><p id="B">まだ日本語</p></main>');
  const provider = createProviderSession(
    { ...selection, autoRetryFailed: false },
    f.transport,
    secrets,
  );
  const result = await provider.translateChapter(
    { ...request, source: { ...chapter, paragraphs: chapter.paragraphs.slice(0, 2) } },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(1);
  expect(result.failedParagraphs).toEqual([1]);
  expect(result.generation?.continuations).toBe(0);
});
test('automatic retry only regenerates failed rows and retains the accepted first result', async () => {
  const f = fixture((_body, call) =>
    call === 1
      ? '<main><p id="A">처음 정상</p><p id="B">まだ</p></main>'
      : '<main><p id="B">복구 번역</p></main>',
  );
  const result = await f.provider.translateChapter(
    { ...request, source: { ...chapter, paragraphs: chapter.paragraphs.slice(0, 2) } },
    new AbortController().signal,
  );
  expect(result.text).toBe('처음 정상\n\n복구 번역');
  expect(result.failedParagraphs).toBeUndefined();
  expect(f.calls).toHaveLength(2);
});
test('rejects merged, duplicate or reordered IDs after one retry', async () => {
  for (const output of [
    '<main><p id="A">합친 두 줄</p></main>',
    '<main><p id="A">하나</p><p id="A">둘</p></main>',
    '<main><p id="B">둘</p><p id="A">하나</p></main>',
  ]) {
    const f = fixture(() => output);
    const result = await f.provider.translateChapter(
      { ...request, source: { ...chapter, paragraphs: chapter.paragraphs.slice(0, 2) } },
      new AbortController().signal,
    );
    expect(f.calls).toHaveLength(2);
    expect(result.failedParagraphs).toEqual([0, 1]);
  }
});
test('a missing rendering is requested once more with the required line and the retry is used', async () => {
  const f = fixture((_body, call) =>
    call === 1
      ? '<main><p id="A">르시아나는 웃었다.</p></main>'
      : '<main><p id="A">루시아나는 웃었다.</p></main>',
  );
  const value = await f.provider.translateChapter(
    {
      ...request,
      source: { ...source, paragraphs: [{ id: 'p1', text: 'ルシアナは笑った。', ruby: [] }] },
      requiredTerms: (input) =>
        input.includes('ルシアナ') ? [{ source: 'ルシアナ', target: '루시아나' }] : [],
    },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(2);
  const first = (f.calls[0]!.body.messages as { content: string }[])[0]!.content;
  expect(first).toContain('ルシアナは笑った。');
  expect(first).not.toContain('Required renderings');
  const retry = (f.calls[1]!.body.messages as { content: string }[]).at(-1)!.content;
  expect(retry).toContain(
    'Required renderings for this passage (use exactly):\nルシアナ → 루시아나\n',
  );
  expect(value.text).toBe('루시아나는 웃었다.');
  expect(value.failedParagraphs).toBeUndefined();
});
test('a rendering still missing after the retry keeps the last translation instead of failing', async () => {
  const f = fixture(() => '<main><p id="A">르시아나는 웃었다.</p></main>');
  const value = await f.provider.translateChapter(
    {
      ...request,
      source: { ...source, paragraphs: [{ id: 'p1', text: 'ルシアナは笑った。', ruby: [] }] },
      requiredTerms: () => [{ source: 'ルシアナ', target: '루시아나' }],
    },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(2);
  expect(value.text).toBe('르시아나는 웃었다.');
  expect(value.failedParagraphs).toBeUndefined();
});
test('automatic retry off accepts a paragraph with a missing rendering after one request', async () => {
  const f = fixture(() => '<main><p id="A">르시아나는 웃었다.</p></main>');
  const provider = createProviderSession(
    { ...selection, autoRetryFailed: false },
    f.transport,
    secrets,
  );
  const value = await provider.translateChapter(
    {
      ...request,
      source: { ...source, paragraphs: [{ id: 'p1', text: 'ルシアナは笑った。', ruby: [] }] },
      requiredTerms: () => [{ source: 'ルシアナ', target: '루시아나' }],
    },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(1);
  expect(value.text).toBe('르시아나는 웃었다.');
  expect(value.failedParagraphs).toBeUndefined();
});
test('never retries an unknown transport outcome or an authentication response', async () => {
  for (const error of [
    new ReaderError('timeout_unknown', 'unknown'),
    new ReaderError('auth', 'received', 401),
  ]) {
    const f = fixture();
    f.transport.streamPost = vi.fn(async () => {
      throw error;
    });
    await expect(
      createProviderSession(selection, f.transport, secrets).translateChapter(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: error.code });
    expect(f.transport.streamPost).toHaveBeenCalledTimes(1);
  }
});
test('drops previous history before reducing new content and rejects an indivisible huge paragraph before POST', async () => {
  const f = fixture(
    (_text, call) =>
      '<main>' +
      Array.from(
        { length: call === 1 ? 8 : 16 },
        (_, i) =>
          `<p id="${call === 1 ? String.fromCharCode(65 + i) : String.fromCharCode(73 + i)}">${'내용'.repeat(300)}</p>`,
      ).join('') +
      '</main>',
  );
  await f.provider.translateChapter(
    { ...request, source: { ...chapter, paragraphs: chapter.paragraphs.slice(0, 24) } },
    new AbortController().signal,
  );
  expect((f.calls[1]!.body.messages as unknown[]).length).toBe(1);
  const tooLong = fixture();
  await expect(
    tooLong.provider.translateChapter(
      {
        ...request,
        source: { ...chapter, paragraphs: [{ id: 'huge', text: '長'.repeat(100000), ruby: [] }] },
      },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'input_limit' });
  expect(tooLong.calls).toHaveLength(0);
  expect(
    streamingLimits({
      ...selection,
      limits: { contextTokens: 4096, inputBudgetTokens: 1024, maxOutputTokens: 2048 },
    }).contextTokens,
  ).toBe(4096);
});
test('plot summary excludes known source names, targets, aliases and voice names', () => {
  expect(
    plotSummaryWithoutNames({
      schemaVersion: 1,
      workId: 'n1234ab',
      hash: 'hash',
      terms: [
        { source: 'ミカエル', target: '미카엘', aliases: ['ミカ'], category: '인물', note: '' },
      ],
      voices: [],
      plotSummary: 'ミカエル/미카엘/ミカ는 마을을 떠났다.',
    }),
  ).toBe('//는 마을을 떠났다.');
});
test('짧은 히라가나 용어는 스트리밍 모델 입력에서 자리표시로 가리지 않는다', async () => {
  const value: WorkGuidance = {
    schemaVersion: 1,
    workId: 'n1234ab',
    hash: 'hash',
    terms: [{ source: 'ち', target: '루시아나', aliases: [], category: '', note: '' }],
    voices: [],
  };
  const f = fixture();
  await f.provider.translateChapter(
    {
      ...request,
      source: { ...source, paragraphs: [{ id: 'p1', text: '……ちょっと心配ですね', ruby: [] }] },
      requiredTerms: (input) =>
        (appliedGuidance(value, 'n1234ab', input, [])?.terms ?? []).flatMap(({ term, names }) =>
          names.map((name) => ({ source: name, target: term.target })),
        ),
    },
    new AbortController().signal,
  );
  const sent = (f.calls[0]!.body.messages as { content: string }[])[0]!.content;
  expect(sent).toContain('ちょっと心配ですね');
  expect(sent).not.toContain('__ENT_');
});
test('용어 이름 바로 뒤의 루비 읽기만 모델 입력에서 빼고 다른 루비는 그대로 둔다', async () => {
  const f = fixture(() => '<main><p id="A">기타지마는 도쿄를 보았다.</p></main>');
  const value = await f.provider.translateChapter(
    {
      ...request,
      source: {
        ...source,
        paragraphs: [
          {
            id: 'p1',
            text: '北嶋は東京を見た。',
            ruby: [
              { start: 0, end: 2, reading: 'きたじま' },
              { start: 3, end: 5, reading: 'とうきょう' },
            ],
          },
        ],
      },
      requiredTerms: (input) =>
        input.includes('北嶋') ? [{ source: '北嶋', target: '기타지마' }] : [],
    },
    new AbortController().signal,
  );
  const sent = (f.calls[0]!.body.messages as { content: string }[])[0]!.content;
  expect(sent).toContain('北嶋は東京《とうきょう》を見た。');
  expect(sent).not.toContain('きたじま');
  expect(f.calls).toHaveLength(1);
  expect(value.text).toBe('기타지마는 도쿄를 보았다.');
});
test('기록으로 다시 보내는 이전 문단에도 용어 루비 제거를 적용한다', async () => {
  const f = fixture(
    (body) =>
      '<main>' +
      [...body.matchAll(/<p id="([A-Za-z]+)">/g)]
        .map((m) => `<p id="${m[1]}">기타지마 ${m[1]}</p>`)
        .join('') +
      '</main>',
  );
  await f.provider.translateChapter(
    {
      ...request,
      source: {
        ...source,
        paragraphs: Array.from({ length: 9 }, (_, i) =>
          i === 0
            ? {
                id: 'p0',
                text: '北嶋は東京を見た。',
                ruby: [
                  { start: 0, end: 2, reading: 'きたじま' },
                  { start: 3, end: 5, reading: 'とうきょう' },
                ],
              }
            : { id: `p${i}`, text: '夏の朝、扉を開けた。', ruby: [] },
        ),
      },
      requiredTerms: (input) =>
        input.includes('北嶋') ? [{ source: '北嶋', target: '기타지마' }] : [],
    },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(2);
  const history = (f.calls[1]!.body.messages as { content: string }[])[0]!.content;
  expect(history).toContain('北嶋は東京《とうきょう》を見た。');
  expect(history).not.toContain('きたじま');
});
test('표기 줄을 붙이면 입력 예산을 넘는 재시도는 표기 줄 없이 같은 문단을 보낸다', async () => {
  const f = fixture(() => '<main><p id="A">르시아나는 웃었다.</p></main>');
  const value = await f.provider.translateChapter(
    {
      ...request,
      source: { ...source, paragraphs: [{ id: 'p1', text: 'ルシアナは笑った。', ruby: [] }] },
      requiredTerms: () => [{ source: 'ルシアナ', target: '긴'.repeat(4000) }],
    },
    new AbortController().signal,
  );
  expect(f.calls).toHaveLength(2);
  const retry = (f.calls[1]!.body.messages as { content: string }[]).at(-1)!.content;
  expect(retry).not.toContain('Required renderings');
  expect(retry).toContain('ルシアナは笑った。');
  expect(value.text).toBe('르시아나는 웃었다.');
  expect(value.failedParagraphs).toBeUndefined();
});
