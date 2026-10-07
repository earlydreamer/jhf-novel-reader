import { expect, test, vi } from 'vitest';
import { createSourceTransport } from '../../src/platform/http';
import type { NativeHttpClient } from '../../src/contracts';

const url = 'https://ncode.syosetu.com/n1234ab/1/';
const ok = { status: 200, url, headers: {}, data: '<html></html>' };
function pacedTransport(minIntervalMs: number) {
  let time = 0;
  const waits: number[] = [];
  const request = vi.fn<NativeHttpClient['request']>(async () => ok);
  const transport = createSourceTransport(
    { request },
    {
      minIntervalMs,
      now: () => time,
      wait: async (ms, signal) => {
        waits.push(ms);
        if (signal.aborted) throw new Error('aborted');
        time += ms;
      },
    },
  );
  return { transport, request, waits, advance: (ms: number) => (time += ms) };
}
test('source requests keep the minimum interval between consecutive sends', async () => {
  const paced = pacedTransport(1000);
  const signal = new AbortController().signal;
  await paced.transport.get(url, signal);
  paced.advance(300);
  await paced.transport.get(url, signal);
  expect(paced.waits).toEqual([700]);
  paced.advance(5000);
  await paced.transport.get(url, signal);
  expect(paced.waits).toEqual([700]);
  expect(paced.request).toHaveBeenCalledTimes(3);
});
test('concurrent source requests are serialized and spaced', async () => {
  const paced = pacedTransport(1000);
  const signal = new AbortController().signal;
  await Promise.all([url, url, url].map((value) => paced.transport.get(value, signal)));
  expect(paced.waits).toEqual([1000, 1000]);
});
test('a request cancelled while waiting is never sent', async () => {
  const paced = pacedTransport(1000);
  await paced.transport.get(url, new AbortController().signal);
  const control = new AbortController();
  control.abort();
  await expect(paced.transport.get(url, control.signal)).rejects.toMatchObject({
    code: 'cancelled',
    outcome: 'not_sent',
  });
  expect(paced.request).toHaveBeenCalledTimes(1);
});
