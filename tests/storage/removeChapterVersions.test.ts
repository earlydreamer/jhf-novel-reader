import { expect, test } from 'vitest';
import type { CompletedTranslation, WorkPage } from '../../src/contracts';
import { createLibraryStore } from '../../src/storage/library';
import { digest, type PrivateFiles } from '../../src/storage/journal';
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

test('그 회차의 미완료 요청이 있어도 그 회차 저장본을 지우고 attempt 기록은 남긴다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const a = work('n1111aa');
  const a1a = version(a, 1, 'a'),
    a2a = version(a, 2, 'a');
  await library.saveWorkPage(a);
  await library.commitVersion(a1a);
  await library.commitVersion(a2a);
  const pending = { requestId: 'pending-1', chapterId: 'n1111aa/1', settingsRevision: 1 };
  await createAttemptRepository(state.files).write({ token: pending, phase: 'dispatching' });

  const removed = await library.removeChapterVersions!('n1111aa/1');

  expect(removed).toMatchObject({ removed: true, cleanupComplete: true });
  expect(await library.listVersions('n1111aa/1')).toHaveLength(0);
  expect(await createAttemptRepository(state.files).readUnfinished()).toEqual([pending]);
  expect(await library.listVersions('n1111aa/2')).toHaveLength(1);
});

test('런타임 batch owner가 있으면 막고, 저장된 batch 기록만으로는 막지 않는다', async () => {
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
  expect(await library.listVersions('n1111aa/1')).toHaveLength(1);

  await createBatchRepository(state.files).write(batchRecord(a, 'running'));

  const running = await library.removeChapterVersions!('n1111aa/1');

  expect(running).toMatchObject({ removed: true, cleanupComplete: true });
  expect(await library.listVersions('n1111aa/1')).toHaveLength(0);
  expect(await createBatchRepository(state.files).read()).toMatchObject({ phase: 'running' });
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

test.each([false, true])(
  '파일 삭제 실패 뒤 %s 새 저장소에서 재시도하면 실제 잔여 파일을 지운다',
  async (reopen) => {
    const state = fixture();
    let fail = true;
    const files: PrivateFiles = {
      ...state.files,
      remove: async (path) => {
        if (fail && path.startsWith('versions/')) throw new Error('remove interrupted');
        await state.files.remove!(path);
      },
    };
    const library = createLibraryStore(files);
    const value = version(work('n1111aa'), 1);
    await library.commitVersion(value);
    await position(library, value);
    expect(await library.removeChapterVersions!(value.source.chapterId)).toMatchObject({
      removed: true,
      cleanupComplete: false,
    });
    fail = false;
    const retry = reopen ? createLibraryStore(files) : library;
    expect(await retry.removeChapterVersions!(value.source.chapterId)).toMatchObject({
      removed: true,
      cleanupComplete: true,
    });
    expect([...state.memory.keys()].filter((path) => /^(versions|reading)\//.test(path))).toEqual(
      [],
    );
  },
);

test.each([1, 2])('index 저장 %i번째 중단 후 재시작이 삭제 대상을 잊지 않는다', async (failAt) => {
  const state = fixture();
  let armed = false,
    writes = 0;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, text) => {
      if (armed && path.startsWith('library/index.') && ++writes === failAt)
        throw new Error('index interrupted');
      await state.files.write(path, text);
    },
  };
  const library = createLibraryStore(files);
  const value = version(work('n1111aa'), 1);
  await library.commitVersion(value);
  armed = true;
  expect((await library.removeChapterVersions!(value.source.chapterId)).cleanupComplete).toBe(
    false,
  );
  expect(state.removed).toEqual([]);
  armed = false;
  await createLibraryStore(files).removeChapterVersions!(value.source.chapterId);
  expect(state.memory.has(`versions/${value.versionId}.0.json`)).toBe(false);
});

test('보존한 외부·손상 슬롯을 재시도와 작품 삭제가 완료로 숨기거나 지우지 않는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const value = version(work('n1111aa'), 1);
  const foreign = version(work('n2222bb'), 1);
  await library.commitVersion(value);
  await library.commitVersion(foreign);
  const foreignRaw = state.memory.get(`versions/${foreign.versionId}.0.json`)!;
  const foreignPath = `versions/${value.versionId}.1.json`;
  const corruptPath = `reading/${value.versionId}.0.json`;
  state.memory.set(foreignPath, foreignRaw);
  state.memory.set(corruptPath, 'broken');
  await library.removeChapterVersions!(value.source.chapterId);
  const reopened = createLibraryStore(state.files, { preferences: state.preferences });
  expect(await reopened.removeChapterVersions!(value.source.chapterId)).toMatchObject({
    cleanupComplete: false,
    remainingInventory: expect.arrayContaining([foreignPath, corruptPath]),
  });
  await reopened.removeWork!(value.source.workId);
  expect(state.memory.get(foreignPath)).toBe(foreignRaw);
  expect(state.memory.get(corruptPath)).toBe('broken');
});

test('재시도는 기존 inventory만 정리하고 새 UUID 본문·위치·recent를 보존한다', async () => {
  const state = fixture();
  let fail = true;
  const files: PrivateFiles = {
    ...state.files,
    remove: async (path) => {
      if (fail) throw new Error('remove interrupted');
      await state.files.remove!(path);
    },
  };
  const library = createLibraryStore(files);
  const old = version(work('n1111aa'), 1);
  const fresh = version(work('n1111aa'), 1, 'fresh');
  await library.commitVersion(old);
  await position(library, old);
  await library.removeChapterVersions!(old.source.chapterId);
  await expect(library.commitVersion(old)).rejects.toThrow();
  await expect(position(library, old)).rejects.toThrow();
  await library.commitVersion(fresh);
  await position(library, fresh, 19);
  const recent = await library.listRecent();
  fail = false;
  const reopened = createLibraryStore(files);
  expect(await reopened.retryChapterRemoval!(old.source.chapterId)).toMatchObject({
    cleanupComplete: true,
    versionIds: [old.versionId],
  });
  expect(await reopened.listVersions(old.source.chapterId)).toEqual([fresh]);
  expect(await reopened.readPosition(fresh.versionId)).toMatchObject({ offset: 19 });
  expect(await reopened.listRecent()).toEqual(recent);
  expect(await reopened.readChapterRemovalInventory!()).toEqual([]);
  await reopened.removeChapterVersions!(old.source.chapterId);
  expect(await reopened.listVersions(old.source.chapterId)).toEqual([]);
});

test.each([3, 4])(
  'inventory 퇴역 %i번째 저장 실패 후 다른 색인 쓰기와 재시도도 복구한다',
  async (failAt) => {
    const state = fixture();
    let armed = false,
      writes = 0;
    const files: PrivateFiles = {
      ...state.files,
      write: async (path, text) => {
        if (armed && path.startsWith('library/index.') && ++writes === failAt)
          throw new Error('retire interrupted');
        await state.files.write(path, text);
      },
    };
    const library = createLibraryStore(files);
    const old = version(work('n1111aa'), 1);
    await library.commitVersion(old);
    armed = true;
    expect(await library.removeChapterVersions!(old.source.chapterId)).toMatchObject({
      cleanupComplete: false,
    });
    armed = false;
    const reopened = createLibraryStore(files);
    await reopened.saveWorkPage(work('n2222bb'));
    await reopened.saveWorkPage(work('n2222bb'));
    expect((await reopened.readChapterRemovalInventory!()).map((row) => row.chapterId)).toEqual([
      old.source.chapterId,
    ]);
    expect(await reopened.retryChapterRemoval!(old.source.chapterId)).toMatchObject({
      cleanupComplete: true,
    });
    expect(await reopened.readChapterRemovalInventory!()).toEqual([]);
  },
);

test.each([1, 2])(
  'index %i번째 부분 쓰기 뒤에는 파일을 보존하고 재시작에서 복구한다',
  async (failAt) => {
    const state = fixture();
    let armed = false,
      writes = 0;
    const files: PrivateFiles = {
      ...state.files,
      write: async (path, text) => {
        if (armed && path.startsWith('library/index.') && ++writes === failAt) {
          state.memory.set(path, text.slice(0, 20));
          return;
        }
        await state.files.write(path, text);
      },
    };
    const library = createLibraryStore(files);
    const value = version(work('n1111aa'), 1);
    await library.commitVersion(value);
    armed = true;
    expect((await library.removeChapterVersions!(value.source.chapterId)).cleanupComplete).toBe(
      false,
    );
    expect(state.removed).toEqual([]);
    armed = false;
    expect(
      await createLibraryStore(files).removeChapterVersions!(value.source.chapterId),
    ).toMatchObject({ cleanupComplete: true });
    expect(state.memory.has(`versions/${value.versionId}.0.json`)).toBe(false);
  },
);

test('파일은 삭제됐지만 확인 읽기가 실패하면 다음 재시작이 부재를 확인해 퇴역한다', async () => {
  const state = fixture();
  let unreadable: string | null = null;
  const files: PrivateFiles = {
    ...state.files,
    read: async (path) => {
      if (path === unreadable) throw new Error('readback interrupted');
      return state.files.read(path);
    },
    remove: async (path) => {
      await state.files.remove!(path);
      unreadable = path;
    },
  };
  const library = createLibraryStore(files);
  const value = version(work('n1111aa'), 1);
  await library.commitVersion(value);
  const result = await library.removeChapterVersions!(value.source.chapterId);
  expect(result).toMatchObject({ cleanupComplete: false });
  expect(await library.readChapterRemovalInventory!()).toHaveLength(1);
  expect(state.memory.has(`versions/${value.versionId}.0.json`)).toBe(false);
  unreadable = null;
  expect(
    await createLibraryStore(files).retryChapterRemoval!(value.source.chapterId),
  ).toMatchObject({ cleanupComplete: true });
});

test('유효한 형제 슬롯으로 손상·미지원 슬롯 삭제를 허가하지 않고 경로가 사라진 뒤만 퇴역한다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files);
  const value = version(work('n1111aa'), 1);
  await library.commitVersion(value);
  await position(library, value);
  const future = `versions/${value.versionId}.1.json`;
  const corrupt = `reading/${value.versionId}.1.json`;
  state.memory.set(future, JSON.stringify({ format: 99 }));
  state.memory.set(corrupt, '{');
  const result = await library.removeChapterVersions!(value.source.chapterId);
  expect(result.remainingInventory).toEqual(expect.arrayContaining([future, corrupt]));
  expect(state.removed).not.toContain(future);
  expect(state.removed).not.toContain(corrupt);
  expect(state.memory.has(`versions/${value.versionId}.0.json`)).toBe(false);
  state.memory.delete(future);
  state.memory.delete(corrupt);
  expect(
    await createLibraryStore(state.files).retryChapterRemoval!(value.source.chapterId),
  ).toMatchObject({ cleanupComplete: true });
});

test('작품 정리로 넘긴 뒤에도 파일 소유권을 재확인하고 변경된 외부 파일은 보존한다', async () => {
  const state = fixture();
  let fail = true;
  const files: PrivateFiles = {
    ...state.files,
    remove: async (path) => {
      if (fail) throw new Error('remove interrupted');
      await state.files.remove!(path);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const value = version(work('n1111aa'), 1);
  const other = version(work('n2222bb'), 1);
  await library.commitVersion(value);
  await library.commitVersion(other);
  await library.removeChapterVersions!(value.source.chapterId);
  await library.removeWork!(value.source.workId);
  const path = `versions/${value.versionId}.0.json`;
  const foreign = state.memory.get(`versions/${other.versionId}.0.json`)!;
  state.memory.set(path, foreign);
  fail = false;
  const result = await createLibraryStore(files, { preferences: state.preferences }).removeWork!(
    value.source.workId,
  );
  expect(result).toMatchObject({
    cleanupComplete: false,
    remainingInventory: expect.arrayContaining([path]),
  });
  expect(state.memory.get(path)).toBe(foreign);
  expect(await library.readChapterRemovalInventory!()).toEqual([]);
});

test('이전 슬롯의 inventory가 다른 회차의 현재 ID를 가리켜도 살아 있는 색인과 recent는 지우지 않는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files);
  const live = version(work('n1111aa'), 1);
  await library.commitVersion(live);
  const current = JSON.parse(state.memory.get('library/index.0.json')!).payload;
  const put = async (slot: number, generation: number, payload: unknown) => {
    state.memory.set(
      `library/index.${slot}.json`,
      JSON.stringify({
        format: 1,
        generation,
        payload,
        checksum: await digest([1, generation, payload]),
      }),
    );
  };
  await put(0, 3, current);
  await put(1, 2, {
    versions: [],
    workIds: [],
    recent: [],
    chapterRemovalInventory: [
      {
        workId: 'n9999zz',
        chapterId: 'n9999zz/1',
        versionIds: [live.versionId],
        paths: [`versions/${live.versionId}.0.json`],
        createdAt: live.createdAt,
      },
    ],
  });
  const before = [...state.memory];
  const result = await library.retryChapterRemoval!('n9999zz/1');
  expect(result.cleanupComplete).toBe(false);
  expect(await library.listVersions(live.source.chapterId)).toEqual([live]);
  expect((await library.listRecent())[0]?.versionId).toBe(live.versionId);
  expect([...state.memory]).toEqual(before);
});
