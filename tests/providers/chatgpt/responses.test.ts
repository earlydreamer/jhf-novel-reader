import { describe, expect, it } from 'vitest';
import {
  ReaderError,
  type ChatGptAccount,
  type SelectedModel,
  type WholeChapterRequest,
} from '../../../src/contracts';
import { CHATGPT_BASE_URL } from '../../../src/providers/chatgpt';
import { createResponsesStream } from '../../../src/providers/chatgpt/responses';
import { createChatGptProviderSession } from '../../../src/providers/chatgpt/session';
import { source } from '../wholeChapterFixture';

const sse = (...events: Record<string, unknown>[]) =>
  events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');
const item = { id: 'msg_1', type: 'message', role: 'assistant' };
const created = { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } };
const completed = (text: string, output = true) => ({
  type: 'response.completed',
  response: {
    id: 'resp_1',
    status: 'completed',
    output: output
      ? [{ ...item, status: 'completed', content: [{ type: 'output_text', text }] }]
      : [],
  },
});

function parse(data: string, chunk = 7) {
  const previews: string[] = [];
  const stream = createResponsesStream((text) => previews.push(text));
  // 네이티브는 줄 단위로 넘기지만 경계가 어디서 잘려도 같은 결과여야 한다.
  for (let i = 0; i < data.length; i += chunk) stream.push(data.slice(i, i + chunk));
  return { result: () => stream.complete(), previews };
}

describe('Responses SSE 해석', () => {
  it('completed의 최종 assistant 텍스트로만 완료한다', () => {
    const { result, previews } = parse(
      sse(
        created,
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_text.delta', delta: '안녕' },
        { type: 'response.output_text.delta', delta: '하세요' },
        completed('안녕하세요'),
      ),
    );
    expect(result()).toEqual({ text: '안녕하세요', finishReason: 'complete' });
    expect(previews).toEqual(['안녕', '안녕하세요']);
  });

  it('completed.output이 비어 있으면 같은 응답에서 끝난 항목의 텍스트를 쓴다', () => {
    const done = { ...item, status: 'completed', content: [{ type: 'output_text', text: '번역' }] };
    const reasoning = { id: 'rs_1', type: 'reasoning' };
    const data = sse(
      created,
      { type: 'response.output_item.added', output_index: 0, item: reasoning },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { ...reasoning, status: 'completed' },
      },
      { type: 'response.output_item.added', output_index: 1, item },
      { type: 'response.output_text.delta', delta: '번역' },
      { type: 'response.output_item.done', output_index: 1, item: done },
      completed('', false),
    );
    expect(parse(data).result()).toEqual({ text: '번역', finishReason: 'complete' });
    // 닫히지 않은 항목이 있으면 delta를 완료로 올리지 않는다.
    const open = sse(
      created,
      { type: 'response.output_item.added', output_index: 0, item },
      { type: 'response.output_text.delta', delta: '번역' },
      completed('', false),
    );
    expect(() => parse(open).result()).toThrow(ReaderError);
  });

  it('중간 실패·불완전·EOF·다른 응답 ID를 완료로 보지 않는다', () => {
    const failed = sse(
      created,
      { type: 'response.output_text.delta', delta: '일부' },
      {
        type: 'response.failed',
        response: { id: 'resp_1', error: { code: 'subscription_sharing_usage_limit_exceeded' } },
      },
    );
    expect(() => parse(failed).result()).toThrow(
      expect.objectContaining({ code: 'usage_limit', outcome: 'received' }),
    );
    expect(
      parse(
        sse(created, {
          type: 'response.incomplete',
          response: { id: 'resp_1', incomplete_details: { reason: 'max_output_tokens' } },
        }),
      ).result(),
    ).toEqual({ text: '', finishReason: 'length' });
    expect(() =>
      parse(sse(created, { type: 'response.output_text.delta', delta: '끊김' })).result(),
    ).toThrow(expect.objectContaining({ code: 'invalid_output' }));
    const other = sse(created, {
      ...completed('x'),
      response: { ...completed('x').response, id: 'resp_2' },
    });
    expect(() => parse(other).result()).toThrow(ReaderError);
  });
});

const selection: SelectedModel = {
  connection: { provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL, revision: 1 },
  modelId: 'gpt-6.1-sol',
};
const request: WholeChapterRequest = {
  source,
  token: { requestId: 'request', chapterId: source.chapterId, settingsRevision: 1 },
  languageDirection: 'ja-ko',
  contractVersion: 'plain-v1',
  promptVersion: 'colomo-local-v1',
};

function account(reply: (body: Record<string, unknown>) => { status: number; data: string }) {
  const bodies: Record<string, unknown>[] = [];
  const value: ChatGptAccount = {
    status: async () => 'connected',
    connect: async () => 'connected',
    cancelConnect: async () => {},
    disconnect: async () => ({ revoked: true, hadSession: true }),
    models: async () => ({ status: 200, headers: {}, url: '', data: { models: [] } }),
    async respond(body, _signal, onData) {
      bodies.push(structuredClone(body as Record<string, unknown>));
      const { status, data } = reply(body as Record<string, unknown>);
      if (status === 200) for (const line of data.split('\n')) onData(line + '\n');
      return { status, headers: {}, url: `${CHATGPT_BASE_URL}/responses`, data };
    },
  };
  return { value, bodies };
}

const paragraphs = (body: Record<string, unknown>) => {
  const input = body.input as { content: string }[];
  const prompt = input.at(-1)!.content;
  const rows = [...prompt.slice(prompt.lastIndexOf('<main>')).matchAll(/<p id="([^"]+)">/g)];
  return '<main>' + rows.map(([, id]) => `<p id="${id}">한국어 번역</p>`).join('') + '</main>';
};

describe('ChatGPT 제공자 세션', () => {
  it('SiwC가 받는 필드만 보내고 문단 응답을 확인해 완료한다', async () => {
    const fake = account((body) => ({
      status: 200,
      data: sse(created, completed(paragraphs(body))),
    }));
    const result = await createChatGptProviderSession(selection, fake.value).translateChapter(
      request,
      new AbortController().signal,
    );
    expect(result.finishReason).toBe('complete');
    expect(result.text).toContain('한국어 번역');
    const body = fake.bodies[0]!;
    expect(body).toMatchObject({ model: 'gpt-6.1-sol', store: false, stream: true });
    expect(Object.keys(body).sort()).toEqual(['input', 'instructions', 'model', 'store', 'stream']);
    for (const item of body.input as { role: string }[])
      expect(['user', 'assistant']).toContain(item.role);
  });

  it('플랜 한도와 연결 끊김은 다시 보내지 않고 그대로 알린다', async () => {
    for (const [status, code, expected] of [
      [429, 'subscription_sharing_usage_limit_exceeded', 'usage_limit'],
      [401, 'subscription_sharing_invalid_user', 'reconnect_required'],
      [403, 'subscription_sharing_user_not_eligible', 'plan_not_eligible'],
    ] as const) {
      const fake = account(() => ({ status, data: JSON.stringify({ error: { code } }) }));
      await expect(
        createChatGptProviderSession(selection, fake.value).translateChapter(
          request,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: expected, outcome: 'received' });
      expect(fake.bodies).toHaveLength(1);
    }
  });

  it('스트림 중간의 한도 실패도 부분 결과를 완료로 돌려주지 않는다', async () => {
    const fake = account(() => ({
      status: 200,
      data: sse(
        created,
        { type: 'response.output_text.delta', delta: '<main><p id="A">일부' },
        {
          type: 'response.failed',
          response: { id: 'resp_1', error: { code: 'subscription_sharing_usage_limit_exceeded' } },
        },
      ),
    }));
    await expect(
      createChatGptProviderSession(selection, fake.value).translateChapter(
        request,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'usage_limit' });
    expect(fake.bodies).toHaveLength(1);
  });
});
