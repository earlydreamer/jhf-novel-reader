import { expect, test } from 'vitest';
import { createProviderSession, normalizeChapterInput } from '../../src/providers/plainText';
import { source } from './wholeChapterFixture';
import type { ModelTransport, WholeChapterRequest } from '../../src/contracts';
const request: WholeChapterRequest = {
  source,
  token: { requestId: 'r', chapterId: source.chapterId, settingsRevision: 0 },
  languageDirection: 'ja-ko',
  contractVersion: 'plain-v1',
  promptVersion: 'hymt2-ko-v1',
};
function run(data: unknown, status = 200) {
  let calls = 0;
  const transport: ModelTransport = {
    get: async () => {
      throw Error();
    },
    post: async (input) => {
      calls++;
      return { status, data, url: input.url, headers: {} };
    },
  };
  const session = createProviderSession(
    {
      connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
      modelId: 'actual',
    },
    transport,
    { get: async () => null, set: async () => {}, remove: async () => {} },
  );
  return {
    result: session.translateChapter(request, new AbortController().signal),
    calls: () => calls,
  };
}
function response(content: unknown, extra: Record<string, unknown> = {}) {
  return { choices: [{ finish_reason: 'stop', message: { content, ...extra } }] };
}
test.each([
  response('번역', { tool_calls: [{}] }),
  response('번역', { refusal: 'blocked' }),
  { error: { code: 'bad' } },
  response('Error: unavailable'),
  response('오류: 서버 문제'),
  response('I cannot translate this request.'),
])('rejects envelope errors tools and anchored error-only output', async (data) => {
  const operation = run(data);
  await expect(operation.result).rejects.toMatchObject({ code: 'invalid_output' });
  expect(operation.calls()).toBe(1);
});
test('ordinary narrative containing 오류 remains valid', async () => {
  expect(await run(response('그는 오류라는 말을 떠올렸다.')).result).toMatchObject({
    finishReason: 'complete',
  });
});
test.each([
  ['context_length_exceeded', 'input_limit'],
  ['max_tokens_exceeded', 'output_limit'],
])('known limit %s is explicit', async (code, expected) => {
  await expect(run({ error: { code } }, 400).result).rejects.toMatchObject({ code: expected });
});
test('unknown finish is never complete', async () => {
  expect(
    await run({ choices: [{ finish_reason: null, message: { content: '번역' } }] }).result,
  ).toEqual({ text: '', finishReason: 'unknown' });
});
test('overlapping ruby is rejected without mutation', () => {
  const modified = {
    ...structuredClone(source),
    paragraphs: [
      {
        id: 'p',
        text: 'abcd',
        ruby: [
          { start: 0, end: 3, reading: 'a' },
          { start: 2, end: 4, reading: 'b' },
        ],
      },
    ],
  };
  expect(() => normalizeChapterInput(modified)).toThrow();
  expect(modified.paragraphs[0]?.text).toBe('abcd');
});
