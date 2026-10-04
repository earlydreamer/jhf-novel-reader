import { expect, test } from 'vitest';
import { createLibraryStore } from '../../src/storage/library';
import type { CompletedTranslation } from '../../src/contracts';
import { source } from '../providers/wholeChapterFixture';
const value: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'version-1',
  source,
  text: '번역',
  blocks: [{ id: 'b1', text: '번역' }],
  createdAt: '2026-10-04T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'local',
    modelId: 'actual',
    contractVersion: 'plain-v1',
    promptVersion: 'hymt2-ko-v1',
    languageDirection: 'ja-ko',
  },
};
test('independent_saved_lookup', async () => {
  const memory = new Map<string, string>();
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, t);
    },
  });
  await store.commitVersion(value);
  expect(await store.readVersion(value.versionId)).toEqual(value);
  expect(await store.listVersions(source.chapterId)).toEqual([value]);
});
test('save_retry_is_idempotent', async () => {
  const memory = new Map<string, string>();
  let fail = true;
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      if (fail && p.startsWith('library/')) throw Error();
      memory.set(p, t);
    },
  });
  await expect(store.commitVersion(value)).rejects.toThrow();
  fail = false;
  await store.commitVersion(value);
  await store.commitVersion(value);
  expect(await store.listVersions(source.chapterId)).toHaveLength(1);
  await expect(
    store.commitVersion({ ...value, text: '다른', blocks: [{ id: 'b1', text: '다른' }] }),
  ).rejects.toThrow();
  expect(await store.readVersion(value.versionId)).toEqual(value);
});

test('positions and recent pointer persist across independent factories', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const first = createLibraryStore(files);
  await first.commitVersion(value);
  await first.savePosition({
    workId: source.workId,
    chapterId: source.chapterId,
    versionId: value.versionId,
    blockId: 'b1',
    offset: 1,
  });
  const reopened = createLibraryStore(files);
  expect(await reopened.readPosition(value.versionId)).toMatchObject({ blockId: 'b1', offset: 1 });
  expect(await reopened.listRecent()).toEqual([
    {
      workId: source.workId,
      chapterId: source.chapterId,
      versionId: value.versionId,
      updatedAt: expect.any(String),
    },
  ]);
  await expect(
    reopened.savePosition({
      workId: 'other',
      chapterId: source.chapterId,
      versionId: value.versionId,
      blockId: 'b1',
      offset: 1,
    }),
  ).rejects.toThrow();
});
test('partial durable write cannot publish a ready version', async () => {
  const memory = new Map<string, string>();
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, t.slice(0, 20));
    },
  });
  await expect(store.commitVersion(value)).rejects.toMatchObject({ reason: 'io' });
  expect(memory.has('library/index.0.json')).toBe(false);
});
test('work pages and independent translation structures roundtrip', async () => {
  const memory = new Map<string, string>();
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, t);
    },
  });
  const page = {
    workId: source.workId,
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: 'work',
    chapters: [
      {
        workId: source.workId,
        chapterId: source.chapterId,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        ordinal: 1,
      },
    ],
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
  };
  await store.saveWorkPage(page);
  expect(await store.readWork(source.workId)).toEqual([page]);
  await store.commitVersion(value);
  expect((await store.readVersion(value.versionId))?.source.rawHtml).toBe(source.rawHtml);
});

test('reading an older saved version moves the durable recent pointer', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const store = createLibraryStore(files);
  await store.commitVersion(value);
  await store.commitVersion({
    ...value,
    versionId: 'version-2',
    createdAt: '2026-10-05T00:00:00Z',
  });
  await store.savePosition({
    workId: source.workId,
    chapterId: source.chapterId,
    versionId: value.versionId,
    blockId: 'b1',
    offset: 1,
  });
  expect((await createLibraryStore(files).listRecent())[0]?.versionId).toBe(value.versionId);
  expect((await store.listVersions(source.chapterId))[0]?.versionId).toBe('version-2');
});

test('same UUID repairs a partial first index write without rewriting the version body', async () => {
  const memory = new Map<string, string>();
  let partial = true;
  const writes: string[] = [];
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      writes.push(p);
      memory.set(p, partial && p.startsWith('library/') ? t.slice(0, 10) : t);
    },
  });
  await expect(store.commitVersion(value)).rejects.toMatchObject({ reason: 'io' });
  partial = false;
  await store.commitVersion(value);
  expect(await store.listVersions(source.chapterId)).toEqual([value]);
  expect(writes.filter((p) => p.startsWith('versions/'))).toHaveLength(1);
});
