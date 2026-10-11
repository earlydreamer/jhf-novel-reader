import { expect, it, vi } from 'vitest';
import { cleanupUnreferencedCredentials } from '../../src/storage/credentialCleanup';
import { createBatchRepository, type BatchRecord } from '../../src/translation/batch';
import { Journal } from '../../src/storage/journal';
import type { SelectedModel } from '../../src/contracts';

const a = 'provider.00000000-0000-4000-8000-000000000001';
const b = 'provider.00000000-0000-4000-8000-000000000002';
const orphan = 'provider.00000000-0000-4000-8000-000000000003';
function selection(authRef: string): SelectedModel {
  return {
    connection: {
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      revision: 1,
      authRef,
    },
    modelId: 'synthetic',
  };
}
function batch(authRef: string, phase: BatchRecord['phase'] = 'paused'): BatchRecord {
  const chapters = [
    {
      workId: 'n1234ab',
      chapterId: 'n1234ab/1',
      canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
      title: '합성',
      ordinal: 1,
    },
  ];
  return {
    schemaVersion: 1,
    id: 'synthetic',
    createdAt: '2026-10-01T00:00:00Z',
    work: {
      workId: 'n1234ab',
      canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
      pageUrl: 'https://ncode.syosetu.com/n1234ab/',
      title: '합성',
      chapters,
      complete: true,
      nextPageUrl: null,
    },
    selection: selection(authRef),
    chapters,
    phase,
    cursor: phase === 'complete' ? 1 : 0,
    completed: phase === 'complete' ? 1 : 0,
    skipped: 0,
    retranslate: false,
    alreadySaved: 0,
  };
}
function fixture() {
  const bytes = new Map<string, string>();
  let settings: string | null = JSON.stringify({
    schemaVersion: 2,
    fontSize: 18,
    selection: selection(b),
  });
  const refs = new Set([a, b, orphan, 'provider.legacy', 'unrelated']);
  const files = {
    read: async (path: string) => bytes.get(path) ?? null,
    write: async (path: string, value: string) => {
      bytes.set(path, value);
    },
  };
  const preferences = { get: async () => ({ value: settings }), set: async () => {} };
  const secrets = {
    keys: vi.fn(async () => [...refs]),
    remove: vi.fn(async (ref: string) => {
      refs.delete(ref);
    }),
  };
  return {
    files,
    preferences,
    secrets,
    bytes,
    refs,
    setSettings(value: string | null) {
      settings = value;
    },
    run: () => cleanupUnreferencedCredentials(files, preferences, secrets),
  };
}
it('collects only generated unreferenced keys without reading secret values', async () => {
  const h = fixture();
  await h.run();
  expect([...h.refs]).toEqual([b, 'provider.legacy', 'unrelated']);
});
it.each(['prepared', 'paused', 'running', 'unknown', 'saving', 'complete'] as const)(
  'preserves %s batch credentials across startup and settings rotation',
  async (phase) => {
    const h = fixture();
    await createBatchRepository(h.files).write(batch(a, phase));
    await h.run();
    expect([...h.refs]).toEqual([a, b, 'provider.legacy', 'unrelated']);
    expect((await createBatchRepository(h.files).read())?.selection.connection.authRef).toBe(a);
  },
);
it('preserves both valid batch recovery slots, not only the latest', async () => {
  const h = fixture();
  const repo = createBatchRepository(h.files);
  await repo.write(batch(a));
  await repo.write(batch(orphan));
  await h.run();
  expect(h.secrets.remove).not.toHaveBeenCalled();
});
it.each([
  'settings-corrupt',
  'settings-future',
  'settings-io',
  'batch-corrupt',
  'batch-future',
  'batch-io',
  'keys-io',
])('fails closed on %s', async (failure) => {
  const h = fixture();
  if (failure === 'settings-corrupt') h.setSettings('{');
  if (failure === 'settings-future')
    h.setSettings(JSON.stringify({ schemaVersion: 99, selection: null, fontSize: 18 }));
  if (failure === 'settings-io')
    h.preferences.get = async () => {
      throw Error('private detail');
    };
  if (failure === 'batch-corrupt') {
    await createBatchRepository(h.files).write(batch(a));
    h.bytes.set('batches/current.1.json', '{');
  }
  if (failure === 'batch-future')
    await new Journal(h.files).save(
      'batches/current',
      { schemaVersion: 99 },
      async (value) => value,
    );
  if (failure === 'batch-io')
    h.files.read = async () => {
      throw Error('private detail');
    };
  if (failure === 'keys-io') h.secrets.keys.mockRejectedValue(Error('private detail'));
  await expect(h.run()).resolves.toBeUndefined();
  expect(h.secrets.remove).not.toHaveBeenCalled();
});
it('keeps failed deletions for a future startup without blocking startup', async () => {
  const h = fixture();
  h.secrets.remove.mockRejectedValueOnce(Error('private detail'));
  await expect(h.run()).resolves.toBeUndefined();
  expect(h.refs.has(a)).toBe(true);
  await h.run();
  expect(h.refs.has(a)).toBe(false);
});
it('collects retired settings and batch keys only after all durable references disappear', async () => {
  const h = fixture();
  const journal = new Journal(h.files);
  await createBatchRepository(h.files).write(batch(a));
  await h.run();
  h.setSettings(JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 18 }));
  await journal.save('batches/current', null, async (value) => value);
  await h.run();
  expect(h.refs.has(a)).toBe(true);
  await journal.save('batches/current', null, async (value) => value);
  await h.run();
  expect([...h.refs]).toEqual(['provider.legacy', 'unrelated']);
});
