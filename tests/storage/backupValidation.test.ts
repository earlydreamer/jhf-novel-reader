import { describe, expect, it } from 'vitest';
import { validateBackupSnapshot } from '../../src/storage/backupValidation';
import { createLibraryStore } from '../../src/storage/library';
import { createReaderStore } from '../../src/storage/store';
import { createCacheKey } from '../../src/contracts/legacy';
import { digest } from '../../src/storage/journal';
import { source } from '../providers/wholeChapterFixture';
import type { CompletedTranslation } from '../../src/contracts';

const settings = JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 18 });
const version: CompletedTranslation = {
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
async function fixture() {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, text: string) => {
      memory.set(p, text);
    },
  };
  const library = createLibraryStore(files);
  await library.commitVersion(version);
  const validate = (rawSettings: string | null = settings) =>
    validateBackupSnapshot({
      read: files.read,
      paths: [...memory.keys()],
      settings: rawSettings,
    });
  return { memory, files, library, validate };
}
async function put(memory: Map<string, string>, name: string, payload: unknown, generation = 2) {
  memory.set(
    name,
    JSON.stringify({
      format: 1,
      generation,
      payload,
      checksum: await digest([1, generation, payload]),
    }),
  );
}

describe('read-only backup preflight', () => {
  it('accepts a valid independent saved version without requiring a work TOC', async () => {
    const f = await fixture(),
      before = [...f.memory];
    await expect(f.validate()).resolves.toBeUndefined();
    expect([...f.memory]).toEqual(before);
  });
  it('accepts empty and legacy backups with absent reading settings', async () => {
    await expect(
      validateBackupSnapshot({ read: async () => null, paths: [], settings: null }),
    ).resolves.toBeUndefined();
    const f = await fixture();
    f.memory.clear();
    const identity = {
      canonicalUrl: source.canonicalUrl,
      sourceHash: source.sourceHash,
      provider: 'openai-compatible' as const,
      normalizedEndpoint: 'http://localhost:1234/v1',
      model: 'local',
      promptVersion: '1',
      languageDirection: 'ja-ko' as const,
    };
    const cacheKey = await createCacheKey(identity);
    const { captureKind: _capture, rawHtml: _raw, fetchedAt: _fetched, ...legacySource } = source;
    await createReaderStore(f.files).commitChapter({
      schemaVersion: 1,
      cacheKey,
      identity,
      source: legacySource,
      paragraphs: source.paragraphs.map((p) => ({
        id: p.id,
        text: p.text.trim() ? '번역' : p.text,
      })),
      completedAt: version.createdAt,
    });
    await expect(f.validate(null)).resolves.toBeUndefined();
  });
  it.each(['{}', 'not JSON', '{"schemaVersion":3,"selection":null,"fontSize":18,"future":true}'])(
    'rejects invalid settings %s',
    async (raw) => {
      const f = await fixture();
      await expect(f.validate(raw)).rejects.toThrow();
    },
  );
  it('rejects an all-invalid index without modifying any stored bytes', async () => {
    const f = await fixture();
    f.memory.set('library/index.0.json', 'not JSON');
    const before = [...f.memory];
    await expect(f.validate()).rejects.toThrow();
    expect([...f.memory]).toEqual(before);
  });
  it('accepts corrupt newer index and version slots using canonical fallback', async () => {
    const f = await fixture();
    f.memory.set('library/index.1.json', '{"generation":999}');
    f.memory.set('versions/version-1.1.json', 'not JSON');
    await expect(f.validate()).resolves.toBeUndefined();
  });
  it('rejects missing indexed bodies', async () => {
    const f = await fixture();
    f.memory.delete('versions/version-1.0.json');
    await expect(f.validate()).rejects.toThrow();
  });
  it.each(['versionId', 'workId', 'chapterId'])(
    'rejects a body with mismatched %s',
    async (field) => {
      const f = await fixture();
      const body = {
        ...version,
        ...(field === 'versionId'
          ? { versionId: 'other-version' }
          : {
              source: {
                ...version.source,
                ...(field === 'workId' ? { workId: 'n5678zz' } : { chapterId: 'n5678zz/2' }),
              },
            }),
      };
      await put(f.memory, 'versions/version-1.1.json', body);
      await expect(f.validate()).rejects.toThrow();
    },
  );
  it('validates only the selected index graph, not stale historical references', async () => {
    const f = await fixture();
    await put(f.memory, 'library/index.1.json', { versions: [], workIds: [], recent: [] });
    f.memory.delete('versions/version-1.0.json');
    await expect(f.validate()).resolves.toBeUndefined();
  });
  it('rejects a future version schema even alongside an older valid slot', async () => {
    const f = await fixture();
    await put(f.memory, 'versions/version-1.1.json', {
      ...version,
      schemaVersion: 3,
      future: true,
    });
    await expect(f.validate()).rejects.toMatchObject({ reason: 'unsupported_schema' });
  });
  it('rejects a future envelope even alongside an older valid slot', async () => {
    const f = await fixture();
    f.memory.set('library/index.1.json', JSON.stringify({ format: 2, future: true }));
    await expect(f.validate()).rejects.toMatchObject({ reason: 'unsupported_schema' });
  });
  it('requires present indexed reading positions to match body identity and blocks', async () => {
    const f = await fixture();
    await put(f.memory, 'reading/version-1.0.json', {
      workId: source.workId,
      chapterId: source.chapterId,
      versionId: version.versionId,
      blockId: 'missing',
      offset: 0,
    });
    await expect(f.validate()).rejects.toThrow();
  });
  it('does not require unindexed cleanup leftovers to have live body references', async () => {
    const f = await fixture();
    await put(f.memory, 'reading/orphan.0.json', {
      workId: source.workId,
      chapterId: source.chapterId,
      versionId: 'orphan',
      blockId: 'old',
      offset: 0,
    });
    await expect(f.validate()).resolves.toBeUndefined();
  });
  it('preserves an unreadable orphan journal that deletion deliberately left behind', async () => {
    const f = await fixture();
    f.memory.set('versions/orphan.0.json', 'corrupt');
    const before = [...f.memory];
    await expect(f.validate()).resolves.toBeUndefined();
    expect([...f.memory]).toEqual(before);
  });
  it('recognizes disposable scan cache separately from durable journals', async () => {
    const f = await fixture();
    f.memory.set('batches/scan-00000000-0000-0000-0000-000000000001-0.json', 'corrupt cache');
    await expect(f.validate()).resolves.toBeUndefined();
  });
  it('preserves inert allowlisted filenames without treating them as journals', async () => {
    const f = await fixture();
    f.memory.set('library/unknown.json', '{}');
    await expect(f.validate()).resolves.toBeUndefined();
  });
  it('treats a vanished inventoried file as I/O failure rather than an empty backup', async () => {
    await expect(
      validateBackupSnapshot({ read: async () => null, paths: ['library/index.0.json'], settings }),
    ).rejects.toMatchObject({ reason: 'io' });
  });
  it.each([
    'chapters/v1-' + 'a'.repeat(64) + '.0.json',
    'versions/orphan.0.json',
    'library/unknown.json',
  ])('rejects a nonempty archive without a recoverable application root: %s', async (path) => {
    await expect(
      validateBackupSnapshot({
        read: async (p) => (p === path ? 'corrupt' : null),
        paths: [path],
        settings,
      }),
    ).rejects.toThrow();
  });
  it.each(['guidance', 'titles'])(
    'rejects a future %s slot even beside a valid old slot',
    async (folder) => {
      const f = await fixture();
      const payload =
        folder === 'guidance'
          ? {
              schemaVersion: 1,
              workId: source.workId,
              terms: [],
              voices: [],
              hash: await digest([source.workId, [], []]),
            }
          : { schemaVersion: 1, workId: source.workId, entries: [], attempted: [] };
      await put(f.memory, `${folder}/${source.workId}.0.json`, payload, 1);
      await put(f.memory, `${folder}/${source.workId}.1.json`, {
        ...payload,
        schemaVersion: 2,
        future: true,
      });
      await expect(f.validate()).rejects.toMatchObject({ reason: 'unsupported_schema' });
    },
  );
  it('rejects an explicitly indexed work whose page journal is empty', async () => {
    const f = await fixture();
    await put(f.memory, 'library/index.1.json', {
      versions: [],
      workIds: [source.workId],
      recent: [],
    });
    await put(f.memory, `works/${source.workId}.0.json`, []);
    await expect(f.validate()).rejects.toThrow();
  });
});

it('accepts pending chapter cleanup with absent bodies and preserves its inventory for restart', async () => {
  const f = await fixture();
  const inventory = {
    workId: source.workId,
    chapterId: source.chapterId,
    versionIds: [version.versionId],
    paths: [`versions/${version.versionId}.0.json`, `reading/${version.versionId}.1.json`],
    createdAt: version.createdAt,
  };
  await put(f.memory, 'library/index.1.json', {
    versions: [],
    workIds: [],
    recent: [],
    chapterRemovalInventory: [inventory],
  });
  f.memory.delete('versions/version-1.0.json');
  const before = [...f.memory];
  await expect(f.validate()).resolves.toBeUndefined();
  expect([...f.memory]).toEqual(before);
  expect(await f.library.readChapterRemovalInventory!()).toEqual([inventory]);
});

it.each([
  { paths: ['settings/private.0.json'] },
  { paths: ['versions/../version-1.0.json'] },
  { paths: ['versions/other-version.0.json'] },
  { paths: ['versions/version-1.2.json'] },
  { versionIds: ['version-1', 'version-1'] },
  { paths: ['versions/version-1.0.json', 'versions/version-1.0.json'] },
  { workId: 'n9999zz' },
])('rejects unsafe chapter cleanup inventory %j', async (override) => {
  const f = await fixture();
  const inventory = {
    workId: source.workId,
    chapterId: source.chapterId,
    versionIds: [version.versionId],
    paths: ['versions/version-1.0.json'],
    createdAt: version.createdAt,
    ...override,
  };
  f.memory.clear();
  await put(f.memory, 'library/index.0.json', {
    versions: [],
    workIds: [],
    recent: [],
    chapterRemovalInventory: [inventory],
  });
  await expect(f.validate()).rejects.toThrow();
});

it.each([source.chapterId, 'n9999zz/1'])(
  'rejects a live version reused in pending inventory for %s',
  async (chapterId) => {
    const f = await fixture();
    const current = JSON.parse(f.memory.get('library/index.0.json')!).payload;
    const inventory = {
      workId: chapterId.split('/')[0],
      chapterId,
      versionIds: [version.versionId],
      paths: [`versions/${version.versionId}.0.json`],
      createdAt: version.createdAt,
    };
    await put(f.memory, 'library/index.0.json', {
      ...current,
      chapterRemovalInventory: [inventory],
    });
    await expect(f.validate()).rejects.toThrow();
  },
);
