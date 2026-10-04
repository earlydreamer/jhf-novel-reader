import { expect, test } from 'vitest';
import { createModelTransport } from '../../src/platform/http';
import type { NativeHttpRequest } from '../../src/contracts';
test('catalog get restricts endpoints and disables credential redirects', async () => {
  const calls: NativeHttpRequest[] = [];
  const transport = createModelTransport({
    request: async (request) => {
      calls.push(request);
      return { status: 200, url: request.url, data: '{}', headers: {} };
    },
  });
  await transport.get(
    { url: 'http://localhost:1234/v1/models', authorization: 'Bearer secret' },
    new AbortController().signal,
  );
  expect(calls[0]).toMatchObject({
    method: 'GET',
    disableRedirects: true,
    headers: { Authorization: 'Bearer secret' },
  });
  expect(calls[0]?.data).toBeUndefined();
  for (const url of [
    'http://localhost:1234/v1/models?key=secret',
    'http://localhost:1234/source',
    'http://localhost:1234/../v1/models',
  ])
    await expect(transport.get({ url }, new AbortController().signal)).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
