import { expect, test } from 'vitest';
import { listModels } from '../../src/providers/catalog';
import type { ModelTransport, SecretStore } from '../../src/contracts';
const secrets: SecretStore = {
  get: async () => 'secret',
  set: async () => {},
  remove: async () => {},
};
test('model_catalog_uses_authenticated_get', async () => {
  const calls: unknown[] = [];
  const transport: ModelTransport = {
    get: async (request) => {
      calls.push(request);
      return { status: 200, url: request.url, headers: {}, data: { data: [{ id: 'actual' }] } };
    },
    post: async () => {
      throw Error('generation');
    },
  };
  expect(
    await listModels(
      {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:1234',
        authRef: 'key',
        revision: 1,
      },
      transport,
      secrets,
      new AbortController().signal,
    ),
  ).toEqual([{ id: 'actual', displayName: 'actual', supportsGeneration: true }]);
  expect(calls).toEqual([
    { url: 'http://localhost:1234/v1/models', authorization: 'Bearer secret' },
  ]);
});
test('auth_empty_and_failed_catalog_are_distinct', async () => {
  for (const [status, data, code] of [
    [401, {}, 'auth'],
    [500, {}, 'connection'],
    [200, {}, 'model_list'],
    [200, { data: [] }, null],
  ] as const) {
    const transport: ModelTransport = {
      get: async (request) => ({ status, data, url: request.url, headers: {} }),
      post: async () => {
        throw Error();
      },
    };
    const action = listModels(
      { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
      transport,
      secrets,
      new AbortController().signal,
    );
    if (code) await expect(action).rejects.toMatchObject({ code });
    else expect(await action).toEqual([]);
  }
});

test('invalid HTTP status is rejected without generation', async () => {
  const transport: ModelTransport = {
    get: async (input) => ({
      status: NaN,
      url: input.url,
      data: { data: [{ id: 'actual' }] },
      headers: {},
    }),
    post: async () => {
      throw Error('No generation');
    },
  };
  await expect(
    listModels(
      { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
      transport,
      secrets,
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'connection' });
});
