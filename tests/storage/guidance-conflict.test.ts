import { expect, test } from 'vitest';
import { createGuidanceRepository, GuidanceConflictError } from '../../src/translation/guidance';
import type { PrivateFiles } from '../../src/storage/journal';

test('같은 초안에서 동시에 저장하면 하나만 반영하고 다른 변경을 덮어쓰지 않는다', async () => {
  const data = new Map<string, string>();
  const files: PrivateFiles = {
    read: async (path) => data.get(path) ?? null,
    write: async (path, text) => {
      data.set(path, text);
    },
  };
  const repo = createGuidanceRepository(files);
  const base = await repo.save('n1234ab', { terms: [], voices: [] }, null);
  const first = { terms: [], voices: [], plotSummary: '첫 변경' };
  const second = { terms: [], voices: [], plotSummary: '둘째 변경' };
  const results = await Promise.allSettled([
    repo.save('n1234ab', first, base.hash),
    repo.save('n1234ab', second, base.hash),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const winner = results.find((result) => result.status === 'fulfilled');
  const loser = results.find((result) => result.status === 'rejected');
  expect(loser).toMatchObject({ reason: expect.any(GuidanceConflictError) });
  expect(await repo.read('n1234ab')).toEqual(winner?.value);
  await expect(repo.save('n1234ab', first, base.hash)).rejects.toBeInstanceOf(
    GuidanceConflictError,
  );
  await expect(repo.save('n1234ab', second, null)).rejects.toBeInstanceOf(GuidanceConflictError);
});
