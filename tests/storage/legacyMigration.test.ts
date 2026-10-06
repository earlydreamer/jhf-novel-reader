import { expect, it } from 'vitest';
import { migrateLegacyData } from '../../src/storage/legacyMigration';
import { createLibraryStore } from '../../src/storage/library';
import { digest } from '../../src/storage/journal';
import type { PrivateFiles } from '../../src/storage/journal';
import { createReaderStore } from '../../src/storage/store';
import { createV1Migration } from '../../src/storage/migration';
import { createLastChapterRepository } from '../../src/app/lastChapter';
import {
  createCacheKey,
  type CacheIdentity,
  type CompletedChapter,
} from '../../src/contracts/legacy';

class Files implements PrivateFiles {
  readonly data = new Map<string, string>();

  async read(path: string): Promise<string | null> {
    return this.data.get(path) ?? null;
  }

  async write(path: string, text: string): Promise<void> {
    this.data.set(path, text);
  }
}

async function fixture(overrides: Partial<CacheIdentity> = {}): Promise<CompletedChapter> {
  const identity: CacheIdentity = {
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
    sourceHash: 'source-1',
    provider: 'openai-compatible',
    normalizedEndpoint: 'http://192.0.2.1:1234/v1',
    model: 'local',
    promptVersion: '1',
    languageDirection: 'ja-ko',
    ...overrides,
  };
  return {
    schemaVersion: 1,
    cacheKey: await createCacheKey(identity),
    identity,
    source: {
      canonicalUrl: identity.canonicalUrl,
      sourceHash: identity.sourceHash,
      workId: 'n1234ab',
      chapterId: new URL(identity.canonicalUrl).pathname.split('/').filter(Boolean).join('/'),
      title: 'test',
      prevUrl: null,
      nextUrl: null,
      paragraphs: [
        { id: 'p1', text: '原文一', ruby: [] },
        { id: 'p2', text: '原文二', ruby: [] },
      ],
    },
    paragraphs: [
      { id: 'p1', text: '번역 하나' },
      { id: 'p2', text: '번역 둘' },
    ],
    completedAt: '2026-10-04T00:00:00.000Z',
  };
}

it('migrates a pointer-reachable completed v1 chapter without changing its journal', async () => {
  const files = new Files();
  const legacy = await fixture();
  const legacyStore = createReaderStore(files);
  await legacyStore.commitChapter(legacy);
  await legacyStore.savePosition({
    chapterId: legacy.source.chapterId,
    paragraphId: 'p2',
    offset: 27,
  });
  const v1Before = new Map(files.data);
  const library = createLibraryStore(files);

  const first = await migrateLegacyData({
    cacheKeys: [legacy.cacheKey],
    legacy: legacyStore,
    library,
  });

  expect(first).toMatchObject({ migrated: 1, skipped: 0, warnings: [] });
  for (const [path, content] of v1Before) expect(files.data.get(path)).toBe(content);
  const [version] = await library.listVersions(legacy.source.chapterId);
  expect(version).toMatchObject({
    schemaVersion: 2,
    source: {
      ...legacy.source,
      captureKind: 'legacy-import',
      rawHtml: null,
      fetchedAt: null,
    },
    text: '번역 하나\n\n번역 둘',
    blocks: [{ text: '번역 하나' }, { text: '번역 둘' }],
    provenance: {
      provider: legacy.identity.provider,
      modelId: legacy.identity.model,
      promptVersion: legacy.identity.promptVersion,
      languageDirection: legacy.identity.languageDirection,
      contractVersion: 'plain-v1',
    },
  });
  expect((await library.readWork(legacy.source.workId))[0]?.chapters).toEqual([
    {
      workId: legacy.source.workId,
      chapterId: legacy.source.chapterId,
      canonicalUrl: legacy.source.canonicalUrl,
      title: legacy.source.title,
      ordinal: 1,
    },
  ]);
  expect(await library.readPosition(version!.versionId)).toMatchObject({
    workId: legacy.source.workId,
    chapterId: legacy.source.chapterId,
    versionId: version!.versionId,
    blockId: version!.blocks[1]!.id,
    offset: 27,
  });

  const second = await migrateLegacyData({
    cacheKeys: [legacy.cacheKey],
    legacy: legacyStore,
    library,
  });

  expect(second).toMatchObject({ migrated: 0, skipped: 1, warnings: [] });
  expect(await library.listVersions(legacy.source.chapterId)).toHaveLength(1);
});

it('preserves corrupt and unfinished v1 records while reporting migration warnings', async () => {
  const files = new Files();
  const unfinished = await fixture({ sourceHash: 'unfinished' });
  const corrupt = await fixture({ sourceHash: 'corrupt' });
  const unsupported = await fixture({ sourceHash: 'unsupported' });
  const legacyStore = createReaderStore(files);
  await legacyStore.saveCheckpoint({
    schemaVersion: 1,
    cacheKey: unfinished.cacheKey,
    identity: unfinished.identity,
    chapter: unfinished.source,
    token: { jobId: 'job-1', chapterId: unfinished.source.chapterId, settingsRevision: 1 },
    chunks: [],
  });
  await legacyStore.commitChapter(unsupported);
  const unsupportedPath = `chapters/${unsupported.cacheKey}.0.json`;
  const unsupportedRecord = JSON.parse(files.data.get(unsupportedPath)!);
  unsupportedRecord.payload.chapter.schemaVersion = 3;
  unsupportedRecord.checksum = await digest([
    1,
    unsupportedRecord.generation,
    unsupportedRecord.payload,
  ]);
  files.data.set(unsupportedPath, JSON.stringify(unsupportedRecord));
  files.data.set(`chapters/${corrupt.cacheKey}.0.json`, '{');
  const before = new Map(files.data);

  const result = await migrateLegacyData({
    cacheKeys: [unfinished.cacheKey, corrupt.cacheKey, unsupported.cacheKey],
    legacy: legacyStore,
    library: createLibraryStore(files),
  });

  expect(result).toMatchObject({ migrated: 0, skipped: 3 });
  expect(result.warnings).toEqual([
    { cacheKey: unfinished.cacheKey, reason: 'unfinished' },
    { cacheKey: corrupt.cacheKey, reason: 'unreadable' },
    { cacheKey: unsupported.cacheKey, reason: 'unreadable' },
  ]);
  expect(files.data).toEqual(before);
});

function preferences() {
  const data = new Map<string, string>();
  return {
    async get({ key }: { key: string }) {
      return { value: data.get(key) ?? null };
    },
    async set({ key, value }: { key: string; value: string }) {
      data.set(key, value);
    },
  };
}

it('imports all private v1 journals, deduplicates slots and preserves v1 bytes and the cached TOC', async () => {
  const files = Object.assign(new Files(), {
    async list() {
      return [...files.data.keys()]
        .filter((path) => path.startsWith('chapters/'))
        .map((path) => path.slice(9));
    },
  });
  const old = createReaderStore(files),
    settings = preferences(),
    library = createLibraryStore(files);
  const first = await fixture(),
    second = await fixture({ canonicalUrl: 'https://ncode.syosetu.com/n1234ab/2/' });
  await old.commitChapter(first);
  await old.commitChapter(second);
  await old.savePosition({ chapterId: first.source.chapterId, paragraphId: 'p2', offset: 19 });
  files.data.set(
    `chapters/${first.cacheKey}.1.json`,
    files.data.get(`chapters/${first.cacheKey}.0.json`)!,
  );
  files.data.set('chapters/../../outside.0.json', 'must not be read');
  files.data.set(`chapters/${first.cacheKey}.2.json`, 'must not be read');
  await createLastChapterRepository(settings).save(second.cacheKey);
  const original = new Map(files.data);
  const toc = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: 'original work title',
    chapters: [first, second].map((v, index) => ({
      workId: v.source.workId,
      chapterId: v.source.chapterId,
      canonicalUrl: v.source.canonicalUrl,
      title: v.source.title,
      ordinal: index + 1,
    })),
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
  };
  await library.saveWorkPage(toc);
  await createV1Migration(files, settings, library)();
  const importedFirst = (await library.listVersions(first.source.chapterId))[0]!;
  expect(importedFirst.text).toBe('번역 하나\n\n번역 둘');
  expect(await library.readPosition(importedFirst.versionId)).toMatchObject({ offset: 19 });
  expect(await library.listVersions(second.source.chapterId)).toHaveLength(1);
  expect(await library.readWork('n1234ab')).toEqual([toc]);
  for (const [path, content] of original) expect(files.data.get(path)).toBe(content);
  await createV1Migration(files, settings, library)();
  expect(await library.listVersions(first.source.chapterId)).toHaveLength(1);
  expect(await library.listVersions(second.source.chapterId)).toHaveLength(1);
});

it('discovers completed journals without a last-chapter pointer and leaves unfinished/corrupt records intact', async () => {
  const files = Object.assign(new Files(), {
    async list() {
      return [...files.data.keys()].map((path) => path.slice(9));
    },
  });
  const complete = await fixture(),
    unfinished = await fixture({ sourceHash: 'unfinished' });
  const corrupt = await fixture({ sourceHash: 'corrupt' });
  const old = createReaderStore(files),
    library = createLibraryStore(files);
  await old.commitChapter(complete);
  await old.saveCheckpoint({
    schemaVersion: 1,
    cacheKey: unfinished.cacheKey,
    identity: unfinished.identity,
    chapter: unfinished.source,
    token: { jobId: 'job', chapterId: unfinished.source.chapterId, settingsRevision: 1 },
    chunks: [],
  });
  files.data.set(`chapters/${corrupt.cacheKey}.0.json`, '{');
  const before = new Map(files.data);
  await createV1Migration(files, preferences(), library)();
  expect(await library.listVersions(complete.source.chapterId)).toHaveLength(1);
  for (const [path, content] of before) expect(files.data.get(path)).toBe(content);
});

it('retains pointer-based import when an adapter cannot enumerate files', async () => {
  const files = new Files(),
    settings = preferences(),
    legacy = await fixture();
  await createReaderStore(files).commitChapter(legacy);
  await createLastChapterRepository(settings).save(legacy.cacheKey);
  const library = createLibraryStore(files);
  await createV1Migration(files, settings, library)();
  expect(await library.listVersions(legacy.source.chapterId)).toHaveLength(1);
});
