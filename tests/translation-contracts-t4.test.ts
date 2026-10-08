import { expect, it } from 'vitest';
import { createAttemptRepository } from '../src/translation/attempts';
import { createSingleFlight } from '../src/translation/singleFlight';
import { readFileSync } from 'node:fs';
it('attempt journal persists only bounded request metadata and fails closed on corrupt bytes', async () => {
  const bytes = new Map<string, string>();
  const files = {
    async read(path: string) {
      return bytes.get(path) ?? null;
    },
    async write(path: string, text: string) {
      bytes.set(path, text);
    },
  };
  const repo = createAttemptRepository(files),
    token = { requestId: crypto.randomUUID(), chapterId: 'n1234ab/2', settingsRevision: 3 };
  await repo.write({ token, phase: 'dispatching' });
  expect(await createAttemptRepository(files).readUnfinished()).toEqual([token]);
  await repo.write({ token, phase: 'unknown' });
  expect(await repo.readUnfinished()).toEqual([token]);
  await repo.write({ token, phase: 'complete' });
  expect(await repo.readUnfinished()).toEqual([]);
  for (const path of bytes.keys()) bytes.set(path, 'corrupt');
  await expect(repo.readUnfinished()).rejects.toThrow();
  await expect(repo.write({ token, phase: 'dispatching' })).rejects.toThrow();
});
it('single flight rejects duplicate work rather than enqueuing it', async () => {
  const slot = createSingleFlight();
  let finish!: () => void;
  let calls = 0;
  const active = slot.run(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        calls++;
      }),
  );
  expect(slot.occupied).toBe(true);
  expect(
    await slot.run(async () => {
      calls++;
    }),
  ).toBe(false);
  finish();
  await active;
  expect(calls).toBe(1);
  expect(slot.occupied).toBe(false);
});
it('active bootstrap and composition have no legacy jobs, chunk engine or prefetch route', () => {
  for (const file of [
    'src/app/bootstrap.tsx',
    'src/app/compose.ts',
    'src/app/renewalController.ts',
    'src/translation/wholeChapter.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*(?:legacy|jobs|openai-compatible)/);
    expect(source).not.toMatch(
      /createReaderController|createPrefetch|translateChunk|contextBudget|outputBudget/,
    );
  }
  expect(readFileSync('src/contracts/index.ts', 'utf8')).not.toMatch(
    /interface (?:ChunkRequest|Checkpoint)|translateChunk|prefetchEnabled/,
  );
});
