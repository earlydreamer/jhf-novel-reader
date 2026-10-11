import { expect, it } from 'vitest';
import { migrateLegacyData } from '../../src/storage/legacyMigration';
import { createLibraryStore } from '../../src/storage/library';
import { validateBackupSnapshot } from '../../src/storage/backupValidation';
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

it('keeps every imported chapter reachable through a partial TOC, including already imported versions', async () => {
  const files = Object.assign(new Files(), {
    async list() {
      return [...files.data.keys()]
        .filter((path) => path.startsWith('chapters/'))
        .map((path) => path.slice(9));
    },
  });
  const first = await fixture(),
    second = await fixture({ canonicalUrl: 'https://ncode.syosetu.com/n1234ab/2/' });
  const legacy = createReaderStore(files),
    library = createLibraryStore(files);
  await legacy.commitChapter(first);
  await legacy.commitChapter(second);
  await migrateLegacyData({ cacheKeys: [second.cacheKey], legacy, library });
  await createV1Migration(files, preferences(), library)();
  const pages = await library.readWork('n1234ab');
  expect(pages[0]?.chapters.map((ref) => ref.chapterId)).toEqual(['n1234ab/1', 'n1234ab/2']);
  expect(pages[0]?.complete).toBe(false);
  await createV1Migration(files, preferences(), library)();
  expect(await library.readWork('n1234ab')).toEqual(pages);
  expect(await library.listVersions(second.source.chapterId)).toHaveLength(1);
});

type InterruptedStep = 'version-index' | 'partial-version-index' | 'position' | 'position-index';

class InterruptedFiles extends Files {
  interrupt: InterruptedStep | null = null;
  readonly writes: string[] = [];
  private versionWritten = false;
  private positionWritten = false;

  override async write(path: string, text: string): Promise<void> {
    this.writes.push(path);
    const interrupted =
      ((this.interrupt === 'version-index' || this.interrupt === 'partial-version-index') &&
        this.versionWritten &&
        path.startsWith('library/')) ||
      (this.interrupt === 'position' && path.startsWith('reading/')) ||
      (this.interrupt === 'position-index' && this.positionWritten && path.startsWith('library/'));
    if (interrupted) {
      if (this.interrupt === 'partial-version-index') this.data.set(path, '{');
      this.interrupt = null;
      throw new Error('synthetic interrupted migration write');
    }
    await super.write(path, text);
    if (path.startsWith('versions/')) this.versionWritten = true;
    if (path.startsWith('reading/')) this.positionWritten = true;
  }
}

it.each<InterruptedStep>(['version-index', 'partial-version-index', 'position', 'position-index'])(
  'recovers an import interrupted at %s without duplicating or rewriting legacy data',
  async (step) => {
    const files = new InterruptedFiles();
    const legacy = await fixture();
    const old = createReaderStore(files);
    await old.commitChapter(legacy);
    await old.savePosition({ chapterId: legacy.source.chapterId, paragraphId: 'p2', offset: 27 });
    const legacyBytes = new Map(files.data);
    files.interrupt = step;
    await expect(
      migrateLegacyData({
        cacheKeys: [legacy.cacheKey],
        legacy: old,
        library: createLibraryStore(files),
      }),
    ).rejects.toThrow();

    const restarted = createLibraryStore(files);
    const input = {
      cacheKeys: [legacy.cacheKey],
      legacy: createReaderStore(files),
      library: restarted,
    };
    const result = await migrateLegacyData(input);
    const versions = await restarted.listVersions(legacy.source.chapterId);
    expect(versions).toHaveLength(1);
    expect(await restarted.readPosition(versions[0]!.versionId)).toMatchObject({
      blockId: versions[0]!.blocks[1]!.id,
      offset: 27,
    });
    expect(result).toMatchObject({
      migrated: step === 'position-index' ? 0 : 1,
      skipped: step === 'position-index' ? 1 : 0,
      warnings: [],
    });
    for (const [path, text] of legacyBytes) expect(files.data.get(path)).toBe(text);

    const writesAfterRecovery = files.writes.length;
    expect(await migrateLegacyData(input)).toEqual({ migrated: 0, skipped: 1, warnings: [] });
    expect(files.writes).toHaveLength(writesAfterRecovery);
    expect(await restarted.listVersions(legacy.source.chapterId)).toHaveLength(1);
  },
);

it('does not reset a newer v2 position or recent chapter when revisiting imported data', async () => {
  const files = new InterruptedFiles();
  const first = await fixture();
  const second = await fixture({ canonicalUrl: 'https://ncode.syosetu.com/n1234ab/2/' });
  const old = createReaderStore(files);
  await old.commitChapter(first);
  await old.commitChapter(second);
  await old.savePosition({ chapterId: first.source.chapterId, paragraphId: 'p2', offset: 27 });
  const library = createLibraryStore(files);
  const input = { cacheKeys: [first.cacheKey, second.cacheKey], legacy: old, library };
  await migrateLegacyData(input);
  const [firstVersion] = await library.listVersions(first.source.chapterId);
  const [secondVersion] = await library.listVersions(second.source.chapterId);
  const currentPosition = {
    workId: first.source.workId,
    chapterId: first.source.chapterId,
    versionId: firstVersion!.versionId,
    blockId: firstVersion!.blocks[0]!.id,
    offset: 123,
  };
  await library.savePosition(currentPosition);
  await library.savePosition({
    workId: second.source.workId,
    chapterId: second.source.chapterId,
    versionId: secondVersion!.versionId,
    blockId: secondVersion!.blocks[1]!.id,
    offset: 456,
  });
  const before = new Map(files.data);
  const writesBefore = files.writes.length;

  await migrateLegacyData({ ...input, library: createLibraryStore(files) });

  expect(await library.readPosition(firstVersion!.versionId)).toEqual(currentPosition);
  expect((await library.listRecent())[0]?.chapterId).toBe(second.source.chapterId);
  expect(files.data).toEqual(before);
  expect(files.writes).toHaveLength(writesBefore);
});

it('retains recovery of a missing imported body that is still present in the index', async () => {
  const files = new Files();
  const legacy = await fixture();
  const old = createReaderStore(files);
  await old.commitChapter(legacy);
  const library = createLibraryStore(files);
  const input = { cacheKeys: [legacy.cacheKey], legacy: old, library };
  await migrateLegacyData(input);
  const [version] = await library.listVersions(legacy.source.chapterId);
  const indexBefore = [...files.data].filter(([path]) => path.startsWith('library/'));
  files.data.delete(`versions/${version!.versionId}.0.json`);
  files.data.delete(`versions/${version!.versionId}.1.json`);

  await migrateLegacyData({ ...input, library: createLibraryStore(files) });

  expect(await library.listVersions(legacy.source.chapterId)).toEqual([version]);
  for (const [path, text] of indexBefore) expect(files.data.get(path)).toBe(text);
});

it('repairs a missing sibling imported version after an intact version of the same chapter', async () => {
  const files = new Files();
  const first = await fixture();
  const second = await fixture({ model: 'other-local-model' });
  const old = createReaderStore(files);
  await old.commitChapter(first);
  await old.commitChapter(second);
  const library = createLibraryStore(files);
  const input = { cacheKeys: [first.cacheKey, second.cacheKey], legacy: old, library };
  await migrateLegacyData(input);
  const versions = await library.listVersions(first.source.chapterId);
  const missing = versions.find((version) => version.provenance.modelId === second.identity.model)!;
  files.data.delete(`versions/${missing.versionId}.0.json`);
  files.data.delete(`versions/${missing.versionId}.1.json`);

  await expect(
    migrateLegacyData({ ...input, library: createLibraryStore(files) }),
  ).resolves.toEqual({ migrated: 1, skipped: 1, warnings: [] });

  expect(await library.listVersions(first.source.chapterId)).toEqual(versions);
});

it.each([false, true])(
  'startup retries pending chapter cleanup once and skips its v1 import even if cleanup completes (%s)',
  async (failAgain) => {
    const files = new Files();
    const completed = await fixture();
    const legacy = createReaderStore(files);
    await legacy.commitChapter(completed);
    const preferences = {
      get: async () => ({
        value: JSON.stringify({ schemaVersion: 1, cacheKey: completed.cacheKey }),
      }),
      set: async () => {},
      remove: async () => {},
    };
    let failing = true,
      removes = 0;
    const adapter: PrivateFiles = {
      read: files.read.bind(files),
      write: files.write.bind(files),
      remove: async (path) => {
        removes++;
        if (failing) throw new Error('interrupted');
        files.data.delete(path);
      },
    };
    const library = createLibraryStore(adapter);
    await migrateLegacyData({ cacheKeys: [completed.cacheKey], legacy, library });
    const value = (await library.listVersions(completed.source.chapterId))[0]!;
    await library.removeChapterVersions!(completed.source.chapterId);
    removes = 0;
    failing = failAgain;
    const restarted = createLibraryStore(adapter);
    expect(await createV1Migration(adapter, preferences, restarted)()).toEqual({
      migrated: 0,
      skipped: 1,
      warnings: [],
    });
    expect(removes).toBe(1);
    expect(await restarted.listVersions(completed.source.chapterId)).toEqual([]);
    expect(files.data.has(`versions/${value.versionId}.0.json`)).toBe(failAgain);
    expect(await legacy.read(completed.cacheKey)).not.toBeNull();
  },
);

async function deletedLegacyFixture() {
  const memory = new Files();
  const files: PrivateFiles = {
    read: memory.read.bind(memory),
    write: memory.write.bind(memory),
    remove: async (path) => {
      memory.data.delete(path);
    },
    list: async (directory) =>
      [...memory.data.keys()]
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => path.slice(directory.length + 1)),
  };
  const originals = [
    await fixture(),
    await fixture({ model: 'second-model' }),
    await fixture({ canonicalUrl: 'https://ncode.syosetu.com/n1234ab/2/' }),
  ];
  const legacy = createReaderStore(files);
  for (const original of originals) {
    await legacy.commitChapter(original);
    memory.data.set(
      `chapters/${original.cacheKey}.1.json`,
      memory.data.get(`chapters/${original.cacheKey}.0.json`)!,
    );
  }
  const prefs = preferences();
  const library = createLibraryStore(files, { preferences: prefs });
  await createV1Migration(files, prefs, library)();
  return {
    memory,
    files,
    prefs,
    library,
    originals,
    originalBytes: [...memory.data].filter(([path]) => path.startsWith('chapters/')),
  };
}

it('does not resurrect a deleted chapter from both v1 slots or another model on later startups', async () => {
  const f = await deletedLegacyFixture();
  expect(await f.library.listVersions('n1234ab/1')).toHaveLength(2);
  expect(await f.library.removeChapterVersions!('n1234ab/1')).toMatchObject({
    cleanupComplete: true,
  });
  expect(await f.library.readChapterRemovalInventory!()).toEqual([]);
  for (let restart = 0; restart < 3; restart++) {
    const library = createLibraryStore(f.files, { preferences: f.prefs });
    await createV1Migration(f.files, f.prefs, library)();
    expect(await library.listVersions('n1234ab/1')).toEqual([]);
    expect(await library.listVersions('n1234ab/2')).toHaveLength(1);
  }
  expect([...f.memory.data].filter(([path]) => path.startsWith('chapters/'))).toEqual(
    f.originalBytes,
  );
});

it('allows a new UUID translation and position without reimporting deleted legacy versions', async () => {
  const f = await deletedLegacyFixture();
  const old = (await f.library.listVersions('n1234ab/1'))[0]!;
  await f.library.removeChapterVersions!('n1234ab/1');
  const fresh = { ...old, versionId: 'explicit-new-version', createdAt: '2026-10-11T00:00:00Z' };
  await f.library.commitVersion(fresh);
  const position = {
    workId: fresh.source.workId,
    chapterId: fresh.source.chapterId,
    versionId: fresh.versionId,
    blockId: fresh.blocks[0]!.id,
    offset: 17,
  };
  await f.library.savePosition(position);
  const recent = await f.library.listRecent();
  for (let restart = 0; restart < 2; restart++) {
    const library = createLibraryStore(f.files);
    await createV1Migration(f.files, f.prefs, library)();
    expect(await library.listVersions('n1234ab/1')).toEqual([fresh]);
    expect(await library.readPosition(fresh.versionId)).toEqual(position);
    expect(await library.listRecent()).toEqual(recent);
  }
});

it.each([1, 2, 3, 4])(
  'preserves the committed deletion intent after index write %i fails',
  async (failAt) => {
    const f = await deletedLegacyFixture();
    let writes = 0,
      armed = true;
    const files: PrivateFiles = {
      ...f.files,
      write: async (path, text) => {
        if (armed && path.startsWith('library/index.') && ++writes === failAt)
          throw new Error('interrupted index write');
        await f.files.write(path, text);
      },
    };
    const result = await createLibraryStore(files).removeChapterVersions!('n1234ab/1');
    expect(result.removed).toBe(failAt !== 1);
    armed = false;
    for (let restart = 0; restart < 2; restart++) {
      const library = createLibraryStore(files);
      await createV1Migration(files, f.prefs, library)();
      expect(await library.listVersions('n1234ab/1')).toHaveLength(failAt === 1 ? 2 : 0);
      expect(await library.listVersions('n1234ab/2')).toHaveLength(1);
    }
  },
);

it.each([1, 2])(
  'handles partial index write %i without reviving a logically deleted chapter',
  async (failAt) => {
    const f = await deletedLegacyFixture();
    let writes = 0,
      armed = true;
    const files: PrivateFiles = {
      ...f.files,
      write: async (path, text) => {
        if (armed && path.startsWith('library/index.') && ++writes === failAt) {
          f.memory.data.set(path, text.slice(0, 20));
          return;
        }
        await f.files.write(path, text);
      },
    };
    const result = await createLibraryStore(files).removeChapterVersions!('n1234ab/1');
    expect(result.removed).toBe(failAt !== 1);
    armed = false;
    for (let restart = 0; restart < 2; restart++) {
      const library = createLibraryStore(files);
      await createV1Migration(files, f.prefs, library)();
      expect(await library.listVersions('n1234ab/1')).toHaveLength(failAt === 1 ? 2 : 0);
    }
  },
);

it.each(['page-write', 'work-removal'])(
  'keeps an older-slot deletion marker during unrelated %s',
  async (action) => {
    const f = await deletedLegacyFixture();
    await f.library.removeChapterVersions!('n1234ab/1');
    const payload = JSON.parse(f.memory.data.get('library/index.0.json')!).payload;
    const put = async (slot: number, generation: number, value: unknown) =>
      f.memory.data.set(
        `library/index.${slot}.json`,
        JSON.stringify({
          format: 1,
          generation,
          payload: value,
          checksum: await digest([1, generation, value]),
        }),
      );
    await put(0, 101, { ...payload, legacyRemovedChapterIds: [] });
    await put(1, 100, { ...payload, legacyRemovedChapterIds: ['n1234ab/1'] });
    const reopened = createLibraryStore(f.files, { preferences: f.prefs });
    if (action === 'page-write') {
      const page = (await reopened.readWork('n1234ab'))[0]!;
      await reopened.saveWorkPage(page);
      await reopened.saveWorkPage(page);
    } else {
      await reopened.removeWork!('n5678cd');
    }
    await createV1Migration(f.files, f.prefs, createLibraryStore(f.files))();
    expect(await reopened.listVersions('n1234ab/1')).toEqual([]);
    expect(await reopened.listVersions('n1234ab/2')).toHaveLength(1);
  },
);

it('retains deletion markers through a validated backup snapshot and a corrupt newer index slot', async () => {
  const f = await deletedLegacyFixture();
  await f.library.removeChapterVersions!('n1234ab/1');
  await validateBackupSnapshot({
    read: f.files.read,
    paths: [...f.memory.data.keys()],
    settings: null,
  });
  const restored = new Map(f.memory.data);
  const newest = [0, 1].sort(
    (a, b) =>
      JSON.parse(restored.get(`library/index.${b}.json`)!).generation -
      JSON.parse(restored.get(`library/index.${a}.json`)!).generation,
  )[0]!;
  restored.set(`library/index.${newest}.json`, '{');
  const files: PrivateFiles = {
    read: async (path) => restored.get(path) ?? null,
    write: async (path, text) => {
      restored.set(path, text);
    },
    list: async (directory) =>
      [...restored.keys()]
        .filter((path) => path.startsWith(`${directory}/`))
        .map((path) => path.slice(directory.length + 1)),
  };
  const library = createLibraryStore(files);
  await createV1Migration(files, f.prefs, library)();
  expect(await library.listVersions('n1234ab/1')).toEqual([]);
  expect(await library.listVersions('n1234ab/2')).toHaveLength(1);
  expect(await library.readLegacyRemovedChapterIds!()).toEqual(['n1234ab/1']);
});

it('upgrades an older pending cleanup inventory into a permanent legacy deletion marker', async () => {
  const f = await deletedLegacyFixture();
  const blocked = {
    ...f.files,
    remove: async () => {
      throw new Error('temporary delete failure');
    },
  };
  await createLibraryStore(blocked).removeChapterVersions!('n1234ab/1');
  for (const slot of [0, 1]) {
    const path = `library/index.${slot}.json`;
    const envelope = JSON.parse(f.memory.data.get(path)!);
    delete envelope.payload.legacyRemovedChapterIds;
    envelope.checksum = await digest([1, envelope.generation, envelope.payload]);
    f.memory.data.set(path, JSON.stringify(envelope));
  }
  for (let restart = 0; restart < 3; restart++) {
    const library = createLibraryStore(f.files);
    await createV1Migration(f.files, f.prefs, library)();
    expect(await library.listVersions('n1234ab/1')).toEqual([]);
    expect(await library.readChapterRemovalInventory!()).toEqual([]);
    expect(await library.readLegacyRemovedChapterIds!()).toEqual(['n1234ab/1']);
  }
});

it('retains the chapter marker after the containing work is deleted', async () => {
  const f = await deletedLegacyFixture();
  await f.library.removeChapterVersions!('n1234ab/1');
  expect(await f.library.removeWork!('n1234ab')).toMatchObject({ cleanupComplete: true });
  const library = createLibraryStore(f.files);
  expect(await library.readLegacyRemovedChapterIds!()).toEqual(['n1234ab/1', 'n1234ab/2']);
  await createV1Migration(f.files, f.prefs, library)();
  expect(await library.listWorkIds()).toEqual([]);
  expect([...f.memory.data.keys()].filter((path) => path.startsWith('chapters/'))).toEqual([]);
});

it.each(['work', 'version', 'position'])(
  'concurrent deletion wins over automatic legacy import at the %s stage',
  async (stage) => {
    const f = await deletedLegacyFixture();
    const old = (await f.library.listVersions('n1234ab/1'))[0]!;
    await createReaderStore(f.files).savePosition({
      chapterId: 'n1234ab/1',
      paragraphId: 'p1',
      offset: 8,
    });
    let armed = true;
    let removal: ReturnType<NonNullable<typeof f.library.removeChapterVersions>> | undefined;
    const files: PrivateFiles = {
      ...f.files,
      read: async (path) => {
        const raw = await f.files.read(path);
        const prefix =
          stage === 'work'
            ? 'works/n1234ab.'
            : `${stage === 'version' ? 'versions' : 'reading'}/${old.versionId}.`;
        if (armed && path.startsWith(prefix)) {
          armed = false;
          removal = library.removeChapterVersions!('n1234ab/1');
        }
        return raw;
      },
    };
    const library = createLibraryStore(files);
    await expect(createV1Migration(files, f.prefs, library)()).resolves.toMatchObject({
      warnings: [],
    });
    expect(armed).toBe(false);
    expect(await removal).toMatchObject({ removed: true, cleanupComplete: true });
    expect(await library.listVersions('n1234ab/1')).toEqual([]);
    expect(await library.readPosition(old.versionId)).toBeNull();
    expect(await library.listVersions('n1234ab/2')).toHaveLength(1);
    await createV1Migration(files, f.prefs, library)();
    expect(await library.listVersions('n1234ab/1')).toEqual([]);
    const fresh = { ...old, versionId: `explicit-${stage}`, createdAt: '2026-10-11T00:00:00Z' };
    await library.commitVersion(fresh);
    await library.savePosition({
      workId: fresh.source.workId,
      chapterId: fresh.source.chapterId,
      versionId: fresh.versionId,
      blockId: fresh.blocks[0]!.id,
      offset: 19,
    });
    expect(await library.listVersions('n1234ab/1')).toEqual([fresh]);
  },
);

it('does not restore an already-loaded v1 chapter after concurrent whole-work deletion', async () => {
  const f = await deletedLegacyFixture();
  let armed = true;
  let removal: ReturnType<NonNullable<typeof f.library.removeWork>> | undefined;
  const files: PrivateFiles = {
    ...f.files,
    read: async (path) => {
      const raw = await f.files.read(path);
      if (armed && path.startsWith('works/n1234ab.')) {
        armed = false;
        removal = library.removeWork!('n1234ab');
      }
      return raw;
    },
  };
  const library = createLibraryStore(files, { preferences: f.prefs });
  await createV1Migration(files, f.prefs, library)();
  expect(await removal).toMatchObject({ removed: true, cleanupComplete: true });
  expect(await library.listVersions('n1234ab/1')).toEqual([]);
  expect(await library.listVersions('n1234ab/2')).toEqual([]);
  expect(await library.listRecent()).toEqual([]);
  expect(await library.listWorkIds()).toEqual([]);
});

it('does not mark another work from an inconsistent live ref during work deletion', async () => {
  const f = await deletedLegacyFixture();
  const old = (await f.library.listVersions('n1234ab/1'))[0]!;
  await f.library.commitVersion({
    ...old,
    versionId: 'inconsistent-owner',
    source: { ...old.source, chapterId: 'n9999zz/1' },
  });
  const candidate = await fixture({ canonicalUrl: 'https://ncode.syosetu.com/n9999zz/1/' });
  const foreign = { ...candidate, source: { ...candidate.source, workId: 'n9999zz' } };
  await createReaderStore(f.files).commitChapter(foreign);
  await f.library.removeWork!('n1234ab');
  expect(await f.library.readLegacyRemovedChapterIds!()).toEqual(['n1234ab/1', 'n1234ab/2']);
  await createV1Migration(f.files, f.prefs, f.library)();
  expect(await f.library.listVersions('n9999zz/1')).toHaveLength(1);
  expect(await f.library.listVersions('n1234ab/1')).toEqual([]);
});
