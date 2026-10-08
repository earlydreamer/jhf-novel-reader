import { expect, test } from 'vitest';
import type { CompletedTranslation, WorkPage } from '../../src/contracts';
import { createLibraryStore } from '../../src/storage/library';
import type { PrivateFiles } from '../../src/storage/journal';
import { createAttemptRepository } from '../../src/translation/attempts';
import { createBatchRepository, type BatchRecord } from '../../src/translation/batch';
import { source } from '../providers/wholeChapterFixture';

function fixture() {
  const memory = new Map<string, string>(),
    writes: string[] = [],
    removed: string[] = [];
  let pointer: string | null = null;
  const files: PrivateFiles = {
    read: async (path) => memory.get(path) ?? null,
    write: async (path, text) => {
      writes.push(path);
      memory.set(path, text);
    },
    remove: async (path) => {
      removed.push(path);
      memory.delete(path);
    },
    list: async (directory) =>
      [...memory.keys()]
        .filter((path) => path.startsWith(`${directory}/`) && path.endsWith('.json'))
        .map((path) => path.slice(`${directory}/`.length)),
  };
  const preferences = {
    get: async () => ({ value: pointer }),
    set: async ({ value }: { key: string; value: string }) => {
      pointer = value;
    },
    remove: async () => {
      pointer = null;
    },
  };
  return {
    memory,
    writes,
    removed,
    files,
    preferences,
    get pointer() {
      return pointer;
    },
  };
}

function work(workId: string): WorkPage {
  return {
    workId,
    canonicalUrl: `https://ncode.syosetu.com/${workId}/`,
    title: `작품 ${workId}`,
    chapters: [1, 2].map((ordinal) => ({
      workId,
      chapterId: `${workId}/${ordinal}`,
      canonicalUrl: `https://ncode.syosetu.com/${workId}/${ordinal}/`,
      title: `${ordinal}화`,
      ordinal,
    })),
    pageUrl: `https://ncode.syosetu.com/${workId}/`,
    nextPageUrl: null,
    complete: true,
  };
}

function version(page: WorkPage, ordinal: number, suffix = 'a'): CompletedTranslation {
  const ref = page.chapters[ordinal - 1]!;
  const id = `${page.workId}-${ordinal}-${suffix}`;
  return {
    schemaVersion: 2,
    versionId: `version-${id}`,
    source: {
      ...source,
      canonicalUrl: ref.canonicalUrl,
      workId: ref.workId,
      chapterId: ref.chapterId,
      title: ref.title,
      sourceHash: `source-${id}`,
      paragraphs: [{ id: `paragraph-${id}`, text: '원문', ruby: [] }],
      prevUrl: null,
      nextUrl: null,
      rawHtml: '<p>원문</p>',
      captureKind: 'fetched',
      fetchedAt: '2026-10-08T00:00:00Z',
    },
    text: '번역',
    blocks: [{ id: `block-${id}`, text: '번역' }],
    createdAt: suffix === 'a' ? '2026-10-08T00:00:00Z' : '2026-10-08T01:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'fixture',
      modelId: 'fixture',
      contractVersion: 'plain-v1',
      promptVersion: 'fixture-v1',
      languageDirection: 'ja-ko',
    },
  };
}

async function position(
  library: ReturnType<typeof createLibraryStore>,
  value: CompletedTranslation,
  offset = 3,
) {
  await library.savePosition({
    workId: value.source.workId,
    chapterId: value.source.chapterId,
    versionId: value.versionId,
    blockId: value.blocks[0]!.id,
    offset,
  });
}

function batchRecord(page: WorkPage, phase: BatchRecord['phase']): BatchRecord {
  return {
    schemaVersion: 1,
    id: `batch-${page.workId}`,
    createdAt: '2026-10-08T00:00:00Z',
    work: page,
    selection: {
      connection: { provider: 'openai-compatible', baseUrl: 'https://example.com/v1', revision: 0 },
      modelId: 'fixture-model',
      translationMode: 'legacy',
    },
    chapters: page.chapters,
    retranslate: false,
    alreadySaved: 0,
    cursor: phase === 'complete' ? page.chapters.length : 0,
    completed: phase === 'complete' ? page.chapters.length : 0,
    skipped: 0,
    phase,
  };
}

test('그 회차 저장본과 위치만 지우고 다른 회차·다른 작품은 보존한다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa'),
    b = work('n2222bb');
  const a1a = version(a, 1, 'a'),
    a1b = version(a, 1, 'b'),
    a2a = version(a, 2, 'a'),
    b1a = version(b, 1, 'a');
  await library.saveWorkPage(a);
  await library.saveWorkPage(b);
  await library.commitVersion(a1a);
  await library.commitVersion(a1b);
  await library.commitVersion(a2a);
  await library.commitVersion(b1a);
  await position(library, a1a);
  await position(library, a1b);
  await position(library, b1a);
  await position(library, a2a);

  const result = await library.removeChapterVersions!('n1111aa/1');

  expect(result).toMatchObject({ removed: true, cleanupComplete: true, remainingInventory: [] });
  expect([...result.versionIds].sort()).toEqual([a1a.versionId, a1b.versionId].sort());
  expect(await library.listVersions('n1111aa/1')).toEqual([]);
  expect(await library.listVersions('n1111aa/2')).toHaveLength(1);
  expect(await library.listVersions('n2222bb/1')).toHaveLength(1);
  expect([...state.memory.keys()].filter((key) => key.includes('n1111aa-1-'))).toEqual([]);
  expect(state.memory.has(`versions/${a2a.versionId}.0.json`)).toBe(true);
  expect(state.memory.has(`reading/${a2a.versionId}.0.json`)).toBe(true);
  expect(state.memory.has(`versions/${b1a.versionId}.0.json`)).toBe(true);
  expect(state.memory.has(`reading/${b1a.versionId}.0.json`)).toBe(true);
  const recent = await library.listRecent();
  expect(recent.map((entry) => entry.chapterId).sort()).toEqual(['n1111aa/2', 'n2222bb/1']);
});

test('읽는 중 저장본을 지우면 그 작품의 recent만 뺀다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa'),
    b = work('n2222bb');
  const a1a = version(a, 1, 'a'),
    b1a = version(b, 1, 'a');
  await library.saveWorkPage(a);
  await library.saveWorkPage(b);
  await library.commitVersion(a1a);
  await library.commitVersion(b1a);
  await position(library, a1a);
  await position(library, b1a);

  expect((await library.listRecent()).map((entry) => entry.workId)).toEqual(
    expect.arrayContaining(['n1111aa', 'n2222bb']),
  );
  await library.removeChapterVersions!('n1111aa/1');

  const recent = await library.listRecent();
  expect(recent.map((entry) => entry.workId)).toEqual(['n2222bb']);
  expect(await library.listWorkIds()).toEqual(['n1111aa', 'n2222bb']);
});

test('두 index 슬롯 모두 같은 결과를 담는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a'),
    a1b = version(a, 1, 'b'),
    a2a = version(a, 2, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);
  await library.commitVersion(a1b);
  await library.commitVersion(a2a);
  await position(library, a1a);

  await library.removeChapterVersions!('n1111aa/1');

  for (const slot of [0, 1]) {
    const envelope = JSON.parse(state.memory.get(`library/index.${slot}.json`)!) as {
      payload: { versions: { chapterId: string }[] };
    };
    expect(envelope.payload.versions.some((entry) => entry.chapterId === 'n1111aa/1')).toBe(false);
    expect(envelope.payload.versions.some((entry) => entry.chapterId === 'n1111aa/2')).toBe(true);
  }
});

test('저장본이 없는 회차는 아무것도 쓰지 않고 성공으로 끝난다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  await library.saveWorkPage(work('n1111aa'));

  const before = state.writes.length;
  const result = await library.removeChapterVersions!('n1111aa/1');

  expect(result).toEqual({
    removed: true,
    cleanupComplete: true,
    remainingInventory: [],
    versionIds: [],
  });
  expect(state.writes.length).toBe(before);
});

test('그 회차의 미완료 요청이 있으면 막고 다른 회차의 미완료 요청은 막지 않는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a'),
    a2a = version(a, 2, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);
  await library.commitVersion(a2a);
  await createAttemptRepository(state.files).write({
    token: { requestId: 'pending-1', chapterId: 'n1111aa/1', settingsRevision: 1 },
    phase: 'dispatching',
  });

  const blocked = await library.removeChapterVersions!('n1111aa/1');

  expect(blocked).toMatchObject({ removed: false, blockedBy: 'unfinished_attempt' });
  expect(state.removed).toEqual([]);
  expect(await library.listVersions('n1111aa/1')).toHaveLength(1);

  const other = await library.removeChapterVersions!('n1111aa/2');

  expect(other).toMatchObject({ removed: true, cleanupComplete: true });
});

test('그 작품의 진행 중 batch나 런타임 owner가 있으면 막는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);

  const owned = await library.removeChapterVersions!('n1111aa/1', {
    activeBatchWorkId: 'n1111aa',
  });

  expect(owned).toMatchObject({ removed: false, blockedBy: 'batch' });
  expect(state.removed).toEqual([]);

  await createBatchRepository(state.files).write(batchRecord(a, 'running'));

  const running = await library.removeChapterVersions!('n1111aa/1');

  expect(running).toMatchObject({ removed: false, blockedBy: 'batch' });
  expect(state.removed).toEqual([]);
  expect(await library.listVersions('n1111aa/1')).toHaveLength(1);
});

test('작품 제거가 남아 있는 작품은 회차 삭제를 하지 않는다', async () => {
  const state = fixture();
  let failRemove = false;
  const files: PrivateFiles = {
    ...state.files,
    remove: async (path) => {
      if (failRemove) throw new Error('temporary filesystem failure');
      await state.files.remove!(path);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);
  await position(library, a1a);
  failRemove = true;
  await library.removeWork!('n1111aa');
  expect(await library.isWorkRemovalPending!('n1111aa')).toBe(true);
  const before = state.removed.length;

  const result = await library.removeChapterVersions!('n1111aa/1');

  expect(result.versionIds).toEqual([]);
  expect(state.removed.length).toBe(before);
});

test('두 번째 index 슬롯 저장이 실패하면 논리 삭제만 하고 파일을 지우지 않는다', async () => {
  const state = fixture();
  let failSecond = false;
  let indexWrites = 0;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, text) => {
      if (failSecond && path.startsWith('library/index.') && ++indexWrites === 2)
        throw new Error('write failure');
      await state.files.write(path, text);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);
  failSecond = true;

  const result = await library.removeChapterVersions!('n1111aa/1');

  expect(result).toMatchObject({
    removed: true,
    cleanupComplete: false,
    remainingInventory: ['library/index'],
  });
  expect(state.removed).toEqual([]);
  expect(await library.listVersions('n1111aa/1')).toEqual([]);
});

test('파일 삭제가 실패하면 남은 경로를 보고한다', async () => {
  const state = fixture();
  const files: PrivateFiles = {
    ...state.files,
    remove: async (path) => {
      if (path.startsWith('versions/')) throw new Error('temporary filesystem failure');
      await state.files.remove!(path);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);
  await position(library, a1a);

  const result = await library.removeChapterVersions!('n1111aa/1');

  expect(result).toMatchObject({ removed: true, cleanupComplete: false });
  expect(result.remainingInventory).toContain(`versions/${a1a.versionId}.0.json`);
  expect(await library.listVersions('n1111aa/1')).toEqual([]);
  expect(state.memory.has(`reading/${a1a.versionId}.0.json`)).toBe(false);
});

test('소유권이 다른 저장본 슬롯은 지우지 않고 보고한다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa'),
    b = work('n2222bb');
  const a1a = version(a, 1, 'a'),
    b1a = version(b, 1, 'a');
  await library.saveWorkPage(a);
  await library.saveWorkPage(b);
  await library.commitVersion(a1a);
  await library.commitVersion(b1a);
  // A 저장본의 빈 슬롯(.1)에 B 저장본의 유효한 원본을 복사해 소유권이 다른 슬롯을 만든다.
  const foreign = state.memory.get(`versions/${b1a.versionId}.0.json`)!;
  state.memory.set(`versions/${a1a.versionId}.1.json`, foreign);

  const result = await library.removeChapterVersions!('n1111aa/1');

  expect(result).toMatchObject({ removed: true, cleanupComplete: false });
  expect(result.remainingInventory).toContain(`versions/${a1a.versionId}.1.json`);
  expect(state.memory.has(`versions/${a1a.versionId}.1.json`)).toBe(true);
  expect(state.memory.has(`versions/${a1a.versionId}.0.json`)).toBe(false);
});
