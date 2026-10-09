import { expect, test } from 'vitest';
import { createProviderSession } from '../../src/providers/plainText';
import type { ModelTransport, ProviderSession } from '../../src/contracts';

const request = {
  system: 'system prompt',
  user: 'user prompt',
  schema: { type: 'object', properties: { terms: { type: 'array' } }, required: ['terms'] },
  maxTokens: 1500,
};

function provider(responses: { status: number; data: unknown }[]) {
  const bodies: Record<string, unknown>[] = [];
  const transport: ModelTransport = {
    get: async () => {
      throw Error();
    },
    post: async (input) => {
      bodies.push(input.body);
      const next = responses.shift();
      if (!next) throw Error('unexpected extra request');
      return { ...next, url: input.url, headers: {} };
    },
  };
  const session: ProviderSession = createProviderSession(
    {
      connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
      modelId: 'actual',
    },
    transport,
    { get: async () => null, set: async () => {}, remove: async () => {} },
  );
  if (!session.completeJson) throw Error('completeJson is missing');
  const complete = session.completeJson.bind(session);
  return { bodies, complete: () => complete(request, new AbortController().signal) };
}

const ok = (content: unknown) => ({
  status: 200,
  data: { choices: [{ finish_reason: 'stop', message: { content } }] },
});

test('JSON request is non-streaming, deterministic and asks for the strict schema', async () => {
  const { bodies, complete } = provider([ok('{"terms":[]}')]);
  await expect(complete()).resolves.toEqual({ terms: [] });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toEqual({
    model: 'actual',
    messages: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 1500,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'glossary', strict: true, schema: request.schema },
    },
  });
});

test('a 400 response is retried once without response_format', async () => {
  const { bodies, complete } = provider([
    { status: 400, data: { error: { message: 'response_format is not supported' } } },
    ok('{"terms":[]}'),
  ]);
  await expect(complete()).resolves.toEqual({ terms: [] });
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).not.toHaveProperty('response_format');
  expect(bodies[1]).toMatchObject({ stream: false, temperature: 0, max_tokens: 1500 });
});

test('a 400 that reports an input limit is not retried', async () => {
  const { bodies, complete } = provider([
    { status: 400, data: { error: { code: 'context_length_exceeded' } } },
  ]);
  await expect(complete()).rejects.toMatchObject({ code: 'input_limit' });
  expect(bodies).toHaveLength(1);
});

test('a fenced JSON answer is unwrapped before parsing', async () => {
  const { complete } = provider([ok('```json\n{"terms":[{"source":"北嶋"}]}\n```')]);
  await expect(complete()).resolves.toEqual({ terms: [{ source: '北嶋' }] });
});

test('broken JSON is reported as invalid output', async () => {
  const { complete } = provider([ok('{"terms": [')]);
  await expect(complete()).rejects.toMatchObject({ code: 'invalid_output' });
});

test('401 is reported as an auth error without a retry', async () => {
  const { bodies, complete } = provider([{ status: 401, data: {} }]);
  await expect(complete()).rejects.toMatchObject({ code: 'auth', status: 401 });
  expect(bodies).toHaveLength(1);
});
