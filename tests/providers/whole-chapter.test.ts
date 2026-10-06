import { expect, test } from 'vitest';
import { createProviderSession, normalizeChapterInput } from '../../src/providers/plainText';
import type { ModelTransport, SecretStore, WholeChapterRequest } from '../../src/contracts';
import { source } from './wholeChapterFixture';
const request: WholeChapterRequest = {
  source,
  token: { requestId: 'r', chapterId: source.chapterId, settingsRevision: 0 },
  languageDirection: 'ja-ko',
  contractVersion: 'plain-v1',
  promptVersion: 'plain-ja-ko-v2',
};
const secrets: SecretStore = { get: async () => null, set: async () => {}, remove: async () => {} };
function session(content: string, finish = 'stop', calls: unknown[] = []) {
  const transport: ModelTransport = {
    get: async () => {
      throw Error();
    },
    post: async (input) => {
      calls.push(input);
      return {
        status: 200,
        url: input.url,
        headers: {},
        data: { choices: [{ finish_reason: finish, message: { content } }] },
      };
    },
  };
  return createProviderSession(
    {
      connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
      modelId: 'actual',
    },
    transport,
    secrets,
  );
}
test('whole_plain_text_is_accepted', async () => {
  expect(
    await session('한국어 번역 한 문단').translateChapter(request, new AbortController().signal),
  ).toEqual({ text: '한국어 번역 한 문단', finishReason: 'complete' });
});
test('whole_request_has_no_json_or_small_budget', async () => {
  const calls: unknown[] = [];
  await session('번역', 'stop', calls).translateChapter(request, new AbortController().signal);
  expect(calls).toHaveLength(1);
  const input = calls[0] as { body: Record<string, unknown> };
  expect(Object.keys(input.body).sort()).toEqual(['messages', 'model', 'stream']);
  expect(input.body.messages).toEqual([
    { role: 'system', content: expect.any(String) },
    { role: 'user', content: '基底《よみ》\n一\n\n\n\n二' },
  ]);
  expect(normalizeChapterInput(source)).toBe('基底《よみ》\n一\n\n\n\n二');
});
test('length_or_blank_is_not_complete', async () => {
  expect(
    (await session('부분', 'length').translateChapter(request, new AbortController().signal))
      .finishReason,
  ).toBe('length');
  await expect(
    session(' ').translateChapter(request, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'invalid_output' });
});
test('missing_selection_is_not_replaced', () => {
  expect(() =>
    createProviderSession(
      {
        connection: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:1234',
          revision: 0,
        },
        modelId: '',
      },
      {
        get: async () => {
          throw Error();
        },
        post: async () => {
          throw Error();
        },
      },
      secrets,
    ),
  ).toThrow();
});

test('outdated local prompt identity is rejected before dispatch', async () => {
  const calls: unknown[] = [];
  await expect(
    session('번역', 'stop', calls).translateChapter(
      { ...request, promptVersion: 'hymt2-ko-v1' },
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'invalid_output' });
  expect(calls).toHaveLength(0);
});
