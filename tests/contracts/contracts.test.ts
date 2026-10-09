import { describe, expect, it } from 'vitest';
import { createParagraphId, ERROR_CODES } from '../../src/contracts';
import { createCacheKey, DEFAULT_PREFERENCES, isCurrentJob } from '../../src/contracts/legacy';
const identity = {
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
  sourceHash: 'source',
  provider: 'openai-compatible' as const,
  normalizedEndpoint: 'http://192.168.1.2:11434/v1',
  model: 'local',
  promptVersion: 'v1',
  languageDirection: 'ja-ko' as const,
};
describe('shared contracts', () => {
  it('gives stable ordered paragraph identity including ruby', async () => {
    const p = { text: '本文', ruby: [{ start: 0, end: 2, reading: 'ほんぶん' }] };
    expect(await createParagraphId('chapter', 0, p)).toBe(await createParagraphId('chapter', 0, p));
    expect(await createParagraphId('chapter', 1, p)).not.toBe(
      await createParagraphId('chapter', 0, p),
    );
    expect(await createParagraphId('chapter', 0, { ...p, ruby: [] })).not.toBe(
      await createParagraphId('chapter', 0, p),
    );
  });
  it('separates every cache identity input without embedding content', async () => {
    const key = await createCacheKey(identity);
    for (const field of Object.keys(identity))
      expect(
        await createCacheKey({
          ...identity,
          [field]: identity[field as keyof typeof identity] + '-different',
        }),
      ).not.toBe(key);
    expect(key).toMatch(/^v1-[a-f0-9]{64}$/);
  });
  it('keeps stable failure categories and conservative defaults', () => {
    expect(ERROR_CODES).toEqual([
      'source_access',
      'source_parse',
      'connection',
      'auth',
      'timeout_unknown',
      'invalid_output',
      'storage',
      'cancelled',
      'model_list',
      'model_missing',
      'input_limit',
      'output_limit',
      'blocked',
      'guidance_unsupported',
    ]);
    expect(DEFAULT_PREFERENCES.prefetchEnabled).toBe(false);
  });
  it('rejects stale job or settings revisions', () => {
    const token = { jobId: 'a', chapterId: 'b', settingsRevision: 1 };
    expect(isCurrentJob(token, { ...token })).toBe(true);
    for (const change of [{ jobId: 'x' }, { chapterId: 'x' }, { settingsRevision: 2 }])
      expect(isCurrentJob(token, { ...token, ...change })).toBe(false);
  });
});
it('hashes equivalent ruby independently of object property insertion order', async () => {
  const first = { text: '本文', ruby: [{ start: 0, end: 2, reading: 'ほんぶん' }] };
  const second = { text: '本文', ruby: [{ reading: 'ほんぶん', end: 2, start: 0 }] };
  expect(await createParagraphId('chapter', 0, first)).toBe(
    await createParagraphId('chapter', 0, second),
  );
});
