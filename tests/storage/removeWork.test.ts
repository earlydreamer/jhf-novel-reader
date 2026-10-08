import { expect, test } from 'vitest';
import type { CompletedTranslation, WorkPage } from '../../src/contracts';
import { createLibraryStore } from '../../src/storage/library';
import type { PrivateFiles } from '../../src/storage/journal';
import { createReaderStore } from '../../src/storage/store';
import { createV1Migration } from '../../src/storage/migration';
import { createCacheKey, type CacheIdentity } from '../../src/contracts/legacy';
import { createAttemptRepository } from '../../src/translation/attempts';
import { createBatchRepository, type BatchRecord } from '../../src/translation/batch';
import { createGuidanceRepository } from '../../src/translation/guidance';
import { createTitleRepository } from '../../src/translation/titles';
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
    chapters: [
      {
        workId,
        chapterId: `${workId}/1`,
        canonicalUrl: `https://ncode.syosetu.com/${workId}/1/`,
        title: '1화',
        ordinal: 1,
      },
    ],
    pageUrl: `https://ncode.syosetu.com/${workId}/`,
    nextPageUrl: null,
    complete: true,
  };
}

function version(workId: string): CompletedTranslation {
  const ref = work(workId).chapters[0]!;
  return {
    schemaVersion: 2,
    versionId: `version-${workId}`,
    source: {
      ...source,
      canonicalUrl: ref.canonicalUrl,
      workId: ref.workId,
      chapterId: ref.chapterId,
      title: ref.title,
      sourceHash: `source-${workId}`,
      paragraphs: [{ id: `paragraph-${workId}`, text: '원문', ruby: [] }],
      prevUrl: null,
      nextUrl: null,
      rawHtml: '<p>원문</p>',
      captureKind: 'fetched',
      fetchedAt: '2026-10-08T00:00:00Z',
    },
    text: '번역',
    blocks: [{ id: `block-${workId}`, text: '번역' }],
    createdAt: '2026-10-08T00:00:00Z',
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

test('작품을 지우면 저장본과 위치를 없애고 다른 작품을 보존한다', async () => {
  const { files, preferences, memory, removed } = fixture();
  const library = createLibraryStore(files, { preferences });
  const attempts = createAttemptRepository(files);
  const titles = createTitleRepository(files);
  const guidance = createGuidanceRepository(files);
  const a = work('n1111aa'),
    b = work('n2222bb'),
    versionA = version(a.workId),
    versionB = version(b.workId);
  await library.saveWorkPage(a);
  await library.saveWorkPage(b);
  await library.commitVersion(versionA);
  await library.commitVersion(versionB);
  await titles.save(a.workId, [
    {
      key: a.workId,
      source: a.title,
      target: '작품 제목 A',
      origin: 'user',
      updatedAt: '2026-10-08T00:00:00Z',
    },
  ]);
  await guidance.save(a.workId, {
    terms: [{ source: 'A', target: '에이', aliases: [], category: '', note: '' }],
    voices: [],
  });
  await library.savePosition({
    workId: a.workId,
    chapterId: a.chapters[0]!.chapterId,
    versionId: versionA.versionId,
    blockId: versionA.blocks[0]!.id,
    offset: 3,
  });
  await library.savePosition({
    workId: b.workId,
    chapterId: b.chapters[0]!.chapterId,
    versionId: versionB.versionId,
    blockId: versionB.blocks[0]!.id,
    offset: 8,
  });
  await titles.save(b.workId, [
    {
      key: b.workId,
      source: b.title,
      target: '작품 제목 B',
      origin: 'user',
      updatedAt: '2026-10-08T00:00:00Z',
    },
  ]);
  await guidance.save(b.workId, {
    terms: [{ source: 'B', target: '비', aliases: [], category: '', note: '' }],
    voices: [],
  });
  await attempts.write({
    token: { requestId: 'attempt-a', chapterId: a.chapters[0]!.chapterId, settingsRevision: 1 },
    phase: 'complete',
  });
  await attempts.write({
    token: { requestId: 'attempt-b', chapterId: b.chapters[0]!.chapterId, settingsRevision: 1 },
    phase: 'complete',
  });
  const lastChapter = (await import('../../src/app/lastChapter')).createLastChapterRepository(
    preferences,
  );
  const otherPointer = `v1-${'b'.repeat(64)}`;
  await lastChapter.save(otherPointer);
  const preservedPrefixes = [
    `versions/${versionB.versionId}.`,
    `reading/${versionB.versionId}.`,
    `titles/${b.workId}.`,
    `guidance/${b.workId}.`,
  ];
  const preservedBFiles = [...memory.entries()].filter(([path]) =>
    preservedPrefixes.some((prefix) => path.startsWith(prefix)),
  );

  const result = await library.removeWork!(a.workId);

  expect(result).toEqual({ removed: true, cleanupComplete: true, remainingInventory: [] });
  expect(await library.listWorkIds()).toEqual([b.workId]);
  expect(await library.readWork(a.workId)).toEqual([]);
  expect(await library.readWork(b.workId)).toEqual([b]);
  expect(await library.readVersion(versionA.versionId)).toBeNull();
  expect(await titles.read(a.workId)).toEqual([]);
  expect(await guidance.read(a.workId)).toBeNull();
  expect(await library.readVersion(versionB.versionId)).toEqual(versionB);
  expect(await library.readPosition(versionA.versionId)).toBeNull();
  expect(await library.readPosition(versionB.versionId)).toMatchObject({ offset: 8 });
  expect(await titles.read(b.workId)).toEqual([
    expect.objectContaining({ target: '작품 제목 B', key: b.workId }),
  ]);
  expect(await guidance.read(b.workId)).toMatchObject({
    workId: b.workId,
    terms: [{ source: 'B' }],
  });
  expect(await lastChapter.read()).toBe(otherPointer);
  expect(
    JSON.parse(memory.get('attempts/index.0.json')!).payload.map(
      (entry: { token: { chapterId: string } }) => entry.token.chapterId,
    ),
  ).toEqual([b.chapters[0]!.chapterId]);
  for (const [path, bytes] of preservedBFiles) expect(memory.get(path)).toBe(bytes);
  expect(await library.listRecent()).toEqual([
    expect.objectContaining({ workId: b.workId, versionId: versionB.versionId }),
  ]);
  expect(removed).toContain(`versions/${versionA.versionId}.0.json`);
  expect(removed).toContain(`reading/${versionA.versionId}.0.json`);
  expect([...memory.keys()].some((path) => path.includes(a.workId))).toBe(false);
  expect([...memory.keys()].some((path) => path.includes(b.workId))).toBe(true);
});

test('두 번째 인덱스 슬롯 쓰기가 실패하면 논리 제거만 남기고 파일을 지우지 않는다', async () => {
  const state = fixture();
  let rejectOldSlot = false;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, text) => {
      if (rejectOldSlot && path === 'library/index.1.json') throw new Error('write failure');
      await state.files.write(path, text);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const a = work('n3333cc'),
    versionA = version(a.workId);
  await library.saveWorkPage(a);
  await library.commitVersion(versionA);
  rejectOldSlot = true;

  const result = await library.removeWork!(a.workId);

  expect(result.removed).toBe(true);
  expect(result.cleanupComplete).toBe(false);
  expect(state.removed).toEqual([]);
  expect(await library.listWorkIds()).not.toContain(a.workId);
  expect((await library.readRemovalInventory!()).some((entry) => entry.workId === a.workId)).toBe(
    true,
  );
});

test('attempts 두 슬롯 정규화가 실패하면 저장 파일을 지우지 않는다', async () => {
  const state = fixture();
  let armed = false;
  let attemptWrites = 0;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, text) => {
      if (armed && path.startsWith('attempts/index.')) {
        attemptWrites++;
        if (attemptWrites === 2) throw new Error('second attempts slot unavailable');
      }
      await state.files.write(path, text);
    },
  };
  const attempts = createAttemptRepository(state.files);
  await attempts.write({
    token: { requestId: 'attempt-target', chapterId: 'n3333zz/1', settingsRevision: 1 },
    phase: 'complete',
  });
  const library = createLibraryStore(files, { preferences: state.preferences });
  const target = work('n3333zz');
  const targetVersion = version(target.workId);
  await library.saveWorkPage(target);
  await library.commitVersion(targetVersion);
  armed = true;

  const result = await library.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: false });
  expect(attemptWrites).toBe(2);
  expect(state.removed).toEqual([]);
  expect(await library.listWorkIds()).not.toContain(target.workId);
  expect(await library.readVersion(targetVersion.versionId)).toEqual(targetVersion);
});

test('첫 index write 검증 실패 뒤 유효한 이전 슬롯로 removed=false를 판정한다', async () => {
  const state = fixture();
  let corruptLibraryWrite = false;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, text) => {
      if (corruptLibraryWrite && path.startsWith('library/index.')) {
        corruptLibraryWrite = false;
        state.memory.set(path, text.slice(0, 12));
        return;
      }
      await state.files.write(path, text);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const target = work('n2222uu');
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  corruptLibraryWrite = true;

  const result = await library.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: false, cleanupComplete: false });
  expect(state.removed).toEqual([]);
  expect(await library.listWorkIds()).toContain(target.workId);
});

test('첫 index write는 저장됐지만 검증만 실패하면 재조회로 removed=true를 판정하고 파일은 보존한다', async () => {
  const state = fixture();
  let verificationPath: string | null = null;
  let failVerification = false;
  const files: PrivateFiles = {
    ...state.files,
    read: async (path) => {
      if (failVerification && path === verificationPath) {
        failVerification = false;
        return null;
      }
      return state.files.read(path);
    },
    write: async (path, raw) => {
      await state.files.write(path, raw);
      if (path.startsWith('library/index.')) {
        verificationPath = path;
        failVerification = true;
      }
    },
  };
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const target = work('n2222ww');
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  verificationPath = null;
  failVerification = false;
  const remover = createLibraryStore(files, { preferences: state.preferences });

  const result = await remover.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: false });
  expect(state.removed).toEqual([]);
  expect(await remover.listWorkIds()).not.toContain(target.workId);
  expect(
    (await remover.readRemovalInventory!()).some((entry) => entry.workId === target.workId),
  ).toBe(true);
});

test('첫 index write 검증 뒤 authoritative 재조회도 실패하면 removed=null로 보고한다', async () => {
  const state = fixture();
  let verificationPath: string | null = null;
  let recoveryReadFailed = false;
  const files: PrivateFiles = {
    ...state.files,
    read: async (path) => {
      if (path === verificationPath) {
        verificationPath = null;
        recoveryReadFailed = true;
        return null;
      }
      if (recoveryReadFailed && path.startsWith('library/index.'))
        throw new Error('authoritative read unavailable');
      return state.files.read(path);
    },
    write: async (path, text) => {
      await state.files.write(path, text);
      if (path.startsWith('library/index.')) verificationPath = path;
    },
  };
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const target = work('n2323vv');
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  verificationPath = null;
  let arm = true;
  const wrappedFiles: PrivateFiles = {
    ...files,
    write: async (path, text) => {
      if (arm && path.startsWith('library/index.')) {
        arm = false;
        await state.files.write(path, text);
        verificationPath = path;
      } else await state.files.write(path, text);
    },
  };
  const remover = createLibraryStore(wrappedFiles, { preferences: state.preferences });

  const result = await remover.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: null, cleanupComplete: false });
  expect(state.removed).toEqual([]);
});

test('inventory retire의 두 번째 슬롯 실패 뒤 유효 슬롯 fallback에 pending 정보가 남는다', async () => {
  const state = fixture();
  const target = work('n2424ww');
  let retireWrites = 0;
  let watchRetirement = false;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, raw) => {
      if (watchRetirement && path.startsWith('library/index.')) {
        const payload = JSON.parse(raw).payload as { removalInventory?: { workId: string }[] };
        if (!payload.removalInventory?.some((entry) => entry.workId === target.workId)) {
          retireWrites++;
          if (retireWrites === 2) throw new Error('second retirement slot unavailable');
        }
      }
      await state.files.write(path, raw);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  watchRetirement = true;

  const result = await library.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: false });
  expect(retireWrites).toBe(2);
  expect((await library.readRemovalInventory!()).map((entry) => entry.workId)).toContain(
    target.workId,
  );
  const reopened = createLibraryStore(files, { preferences: state.preferences });
  expect((await reopened.readRemovalInventory!()).map((entry) => entry.workId)).toContain(
    target.workId,
  );
  await expect(reopened.saveWorkPage(target)).rejects.toThrow();
});

test('삭제 재시도도 갱신된 inventory를 양 슬롯 검증하기 전에는 파일을 지우지 않는다', async () => {
  const state = fixture();
  let failFileRemove = true;
  let failSecondRetryIndexWrite = false;
  let retryIndexWrites = 0;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, text) => {
      if (failSecondRetryIndexWrite && path.startsWith('library/index.')) {
        retryIndexWrites++;
        if (retryIndexWrites === 2) throw new Error('second slot unavailable');
      }
      await state.files.write(path, text);
    },
    remove: async (path) => {
      if (failFileRemove) throw new Error('temporary filesystem failure');
      await state.files.remove!(path);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const target = work('n1313ll');
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  const first = await library.removeWork!(target.workId);
  expect(first).toMatchObject({ removed: true, cleanupComplete: false });
  state.removed.length = 0;

  failFileRemove = false;
  failSecondRetryIndexWrite = true;
  const retry = await library.removeWork!(target.workId);

  expect(retry).toMatchObject({ removed: true, cleanupComplete: false });
  expect(retryIndexWrites).toBe(2);
  expect(state.removed).toEqual([]);
  expect(
    (await library.readRemovalInventory!()).some((entry) => entry.workId === target.workId),
  ).toBe(true);
});

test('물리 삭제가 실패한 작품은 재시도 성공 후 inventory를 비우고 반복 호출에도 제거 상태를 유지한다', async () => {
  const state = fixture();
  let failRemove = true;
  const files: PrivateFiles = {
    ...state.files,
    remove: async (path) => {
      if (failRemove) throw new Error('temporary filesystem failure');
      await state.files.remove!(path);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const target = work('n2727zz');
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  expect(await library.removeWork!(target.workId)).toMatchObject({
    removed: true,
    cleanupComplete: false,
  });
  expect((await library.readRemovalInventory!()).map((entry) => entry.workId)).toContain(
    target.workId,
  );

  failRemove = false;
  expect(await library.removeWork!(target.workId)).toMatchObject({
    removed: true,
    cleanupComplete: true,
  });
  expect(await library.readRemovalInventory!()).toEqual([]);
  expect(await library.listWorkIds()).not.toContain(target.workId);
  expect(await library.readVersion(version(target.workId).versionId)).toBeNull();
  expect(await library.removeWork!(target.workId)).toMatchObject({
    removed: true,
    cleanupComplete: true,
  });
});

test('손상된 양 index 슬롯은 pending 여부를 빈 목록으로 바꾸지 않는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const target = work('n1414mm');
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  let failRemove = true;
  const removeStore = createLibraryStore(
    {
      ...state.files,
      remove: async () => {
        if (failRemove) throw new Error('keep removal pending');
      },
    },
    { preferences: state.preferences },
  );
  await removeStore.removeWork!(target.workId);
  state.memory.set('library/index.0.json', '{');
  state.memory.set('library/index.1.json', '{');

  await expect(removeStore.readRemovalInventory!()).rejects.toThrow();
  await expect(removeStore.saveWorkPage(target)).rejects.toThrow();
  failRemove = false;
});

test('최신 index 슬롯이 손상돼도 유효한 fallback 슬롯의 pending inventory를 읽는다', async () => {
  const state = fixture();
  const target = work('n1919rr');
  const library = createLibraryStore(
    {
      ...state.files,
      remove: async () => {
        throw new Error('keep one cleanup path pending');
      },
    },
    { preferences: state.preferences },
  );
  await library.saveWorkPage(target);
  await library.commitVersion(version(target.workId));
  expect(await library.removeWork!(target.workId)).toMatchObject({
    removed: true,
    cleanupComplete: false,
  });
  const slots = [...state.memory.entries()]
    .filter(([path]) => path.startsWith('library/index.'))
    .map(([path, raw]) => ({ path, generation: JSON.parse(raw).generation as number }));
  const newest = slots.sort((left, right) => right.generation - left.generation)[0]!;
  state.memory.set(newest.path, '{');

  const reopened = createLibraryStore(state.files, { preferences: state.preferences });
  expect((await reopened.readRemovalInventory!()).map((entry) => entry.workId)).toContain(
    target.workId,
  );
  await expect(reopened.saveWorkPage(target)).rejects.toThrow();
});

test('v1 완료본·checkpoint·위치와 대상 pointer를 지우고 재시작 migration에서도 부활하지 않는다', async () => {
  const state = fixture(),
    library = createLibraryStore(state.files, { preferences: state.preferences }),
    identity = (canonicalUrl: string, sourceHash: string): CacheIdentity => ({
      canonicalUrl,
      sourceHash,
      provider: 'openai-compatible',
      normalizedEndpoint: 'http://localhost:1234/v1',
      model: 'fixture',
      promptVersion: 'fixture-v1',
      languageDirection: 'ja-ko',
    });
  const completeIdentity = identity('https://ncode.syosetu.com/n4444dd/1/', 'complete'),
    completeKey = await createCacheKey(completeIdentity),
    completed = {
      schemaVersion: 1 as const,
      cacheKey: completeKey,
      identity: completeIdentity,
      source: {
        canonicalUrl: completeIdentity.canonicalUrl,
        sourceHash: completeIdentity.sourceHash,
        workId: 'n4444dd',
        chapterId: 'n4444dd/1',
        title: '1화',
        prevUrl: null,
        nextUrl: null,
        paragraphs: [{ id: 'p1', text: '원문', ruby: [] }],
      },
      paragraphs: [{ id: 'p1', text: '번역' }],
      completedAt: '2026-10-08T00:00:00.000Z',
    },
    checkpointIdentity = identity('https://ncode.syosetu.com/n4444dd/2/', 'checkpoint'),
    checkpointKey = await createCacheKey(checkpointIdentity),
    legacy = createReaderStore(state.files);
  await legacy.commitChapter(completed);
  await legacy.savePosition({ chapterId: 'n4444dd/1', paragraphId: 'p1', offset: 1 });
  await legacy.saveCheckpoint({
    schemaVersion: 1,
    cacheKey: checkpointKey,
    identity: checkpointIdentity,
    chapter: {
      canonicalUrl: checkpointIdentity.canonicalUrl,
      sourceHash: checkpointIdentity.sourceHash,
      workId: 'n4444dd',
      chapterId: 'n4444dd/2',
      title: '2화',
      prevUrl: null,
      nextUrl: null,
      paragraphs: [{ id: 'p2', text: '원문 둘', ruby: [] }],
    },
    token: { jobId: 'fixture-job', chapterId: 'n4444dd/2', settingsRevision: 1 },
    chunks: [],
  });
  const pointer = (await import('../../src/app/lastChapter')).createLastChapterRepository(
    state.preferences,
  );
  await pointer.save(completeKey);
  await createV1Migration(state.files, state.preferences, library)();
  expect(await library.listWorkIds()).toContain('n4444dd');
  const pathsBefore = [...state.memory.keys()].filter(
    (path) =>
      path.startsWith(`chapters/${completeKey}`) ||
      path.startsWith(`chapters/${checkpointKey}`) ||
      path.startsWith('positions/'),
  );

  const result = await library.removeWork!('n4444dd');

  expect(result).toMatchObject({ removed: true, cleanupComplete: true });
  expect(state.pointer).toBeNull();
  expect(pathsBefore.every((path) => !state.memory.has(path))).toBe(true);
  const reopened = createLibraryStore(state.files, { preferences: state.preferences });
  await createV1Migration(state.files, state.preferences, reopened)();
  expect(await reopened.listWorkIds()).not.toContain('n4444dd');
});

test('목록에 빠진 legacy pointer로만 발견한 회차의 position도 제거한다', async () => {
  const state = fixture();
  const legacy = createReaderStore(state.files);
  const identity: CacheIdentity = {
    canonicalUrl: 'https://ncode.syosetu.com/n1515nn/9/',
    sourceHash: 'pointer-only',
    provider: 'openai-compatible',
    normalizedEndpoint: 'http://localhost:1234/v1',
    model: 'fixture',
    promptVersion: 'fixture-v1',
    languageDirection: 'ja-ko',
  };
  const key = await createCacheKey(identity);
  await legacy.commitChapter({
    schemaVersion: 1,
    cacheKey: key,
    identity,
    source: {
      canonicalUrl: identity.canonicalUrl,
      sourceHash: identity.sourceHash,
      workId: 'n1515nn',
      chapterId: 'n1515nn/9',
      title: '목록 밖 회차',
      prevUrl: null,
      nextUrl: null,
      paragraphs: [{ id: 'pointer-paragraph', text: '원문', ruby: [] }],
    },
    paragraphs: [{ id: 'pointer-paragraph', text: '번역' }],
    completedAt: '2026-10-08T00:00:00.000Z',
  });
  await legacy.savePosition({
    chapterId: 'n1515nn/9',
    paragraphId: 'pointer-paragraph',
    offset: 4,
  });
  await (
    await import('../../src/app/lastChapter')
  )
    .createLastChapterRepository(state.preferences)
    .save(key);
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  await library.saveWorkPage(work('n1515nn'));
  const files: PrivateFiles = { ...state.files, list: async () => [] };
  const remover = createLibraryStore(files, { preferences: state.preferences });

  const result = await remover.removeWork!('n1515nn');

  expect(result).toMatchObject({ removed: true, cleanupComplete: true });
  const positionPaths = [...state.memory.keys()].filter((path) => path.startsWith('positions/'));
  expect(positionPaths).toEqual([]);
  expect(state.pointer).toBeNull();
});

test('인덱스 밖 A 저장본과 위치를 payload owner로 찾아 지우고 정상 B를 보존한다', async () => {
  const state = fixture();
  let corruptIndexWrite = false;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, raw) => {
      if (corruptIndexWrite && path.startsWith('library/index.')) {
        corruptIndexWrite = false;
        state.memory.set(path, raw.slice(0, 20));
        return;
      }
      await state.files.write(path, raw);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const a = work('n2525xx');
  const b = work('n2626yy');
  const versionA = version(a.workId);
  const versionB = version(b.workId);
  await library.saveWorkPage(a);
  await library.saveWorkPage(b);
  await library.commitVersion(versionB);
  await library.savePosition({
    workId: b.workId,
    chapterId: b.chapters[0]!.chapterId,
    versionId: versionB.versionId,
    blockId: versionB.blocks[0]!.id,
    offset: 8,
  });
  corruptIndexWrite = true;
  await expect(library.commitVersion(versionA)).rejects.toThrow();
  corruptIndexWrite = false;
  await expect(
    library.savePosition({
      workId: a.workId,
      chapterId: a.chapters[0]!.chapterId,
      versionId: versionA.versionId,
      blockId: versionA.blocks[0]!.id,
      offset: 5,
    }),
  ).rejects.toThrow();

  const result = await library.removeWork!(a.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: true });
  expect(await library.listWorkIds()).toEqual([b.workId]);
  expect(await library.readVersion(versionA.versionId)).toBeNull();
  expect(await library.readVersion(versionB.versionId)).toEqual(versionB);
  expect(await library.readPosition(versionA.versionId)).toBeNull();
  expect(await library.readPosition(versionB.versionId)).toMatchObject({ offset: 8 });
  expect(
    [...state.memory.keys()].some((path) => path.startsWith(`versions/${versionA.versionId}.`)),
  ).toBe(false);
  expect(
    [...state.memory.keys()].some((path) => path.startsWith(`versions/${versionB.versionId}.`)),
  ).toBe(true);
});

test('색인 밖 저장본 목록 조회 실패는 cleanupComplete로 가장하지 않는다', async () => {
  const state = fixture();
  let corruptIndexWrite = false;
  const files: PrivateFiles = {
    ...state.files,
    write: async (path, raw) => {
      if (corruptIndexWrite && path.startsWith('library/index.')) {
        corruptIndexWrite = false;
        state.memory.set(path, raw.slice(0, 20));
        return;
      }
      await state.files.write(path, raw);
    },
  };
  const library = createLibraryStore(files, { preferences: state.preferences });
  const target = work('n3030cc');
  const orphanVersion = version(target.workId);
  await library.saveWorkPage(target);
  corruptIndexWrite = true;
  await expect(library.commitVersion(orphanVersion)).rejects.toThrow();
  const listedFiles: PrivateFiles = {
    ...files,
    list: async (directory) => {
      if (directory === 'versions') throw new Error('version listing unavailable');
      return state.files.list!(directory);
    },
  };
  const remover = createLibraryStore(listedFiles, { preferences: state.preferences });

  const result = await remover.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: false });
  expect(result.remainingInventory.some((entry) => entry.includes('목록을 읽지 못했어요'))).toBe(
    true,
  );
  expect(await remover.readVersion(orphanVersion.versionId)).toEqual(orphanVersion);
});

test('최신 complete와 이전 unknown은 허용하고 양 슬롯을 정규화해 fallback에서도 제거한다', async () => {
  const state = fixture(),
    attempts = createAttemptRepository(state.files),
    chapterId = 'n5555ee/1',
    token = { requestId: 'request-a', chapterId, settingsRevision: 1 };
  await attempts.write({ token, phase: 'unknown' });
  await attempts.write({ token, phase: 'complete' });
  const library = createLibraryStore(state.files, { preferences: state.preferences });

  const result = await library.removeWork!('n5555ee');

  expect(result.cleanupComplete).toBe(true);
  const attemptsPaths = [...state.memory.keys()].filter((path) =>
    path.startsWith('attempts/index.'),
  );
  expect(attemptsPaths).toHaveLength(2);
  state.memory.set('attempts/index.1.json', '{');
  expect(await createAttemptRepository(state.files).readUnfinished()).toEqual([]);
});

test.each(['unknown', 'fallback-unknown'] as const)(
  'authoritative unfinished %s가 있으면 작품 제거를 막는다',
  async (caseName) => {
    const state = fixture(),
      attempts = createAttemptRepository(state.files),
      chapterId = 'n6666ff/1',
      token = { requestId: `request-${caseName}`, chapterId, settingsRevision: 1 };
    await attempts.write({ token, phase: 'unknown' });
    if (caseName === 'fallback-unknown') {
      await attempts.write({ token, phase: 'complete' });
      state.memory.set('attempts/index.1.json', '{');
    }
    const library = createLibraryStore(state.files, { preferences: state.preferences });

    const result = await library.removeWork!('n6666ff');

    expect(result).toMatchObject({
      removed: false,
      cleanupComplete: false,
      blockedBy: 'unfinished_attempt',
    });
    expect(state.removed).toEqual([]);
  },
);

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

test('최신 다른 작품 batch는 보존하고 이전 슬롯의 대상 batch 참조는 제거한다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const batches = createBatchRepository(state.files);
  const target = work('n7777gg');
  const current = work('n8888hh');
  await library.saveWorkPage(target);
  await library.saveWorkPage(current);
  await batches.write(batchRecord(target, 'paused'));
  await batches.write(batchRecord(current, 'paused'));

  const result = await library.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: true });
  expect(await batches.read()).toMatchObject({ work: { workId: current.workId }, phase: 'paused' });
  const rawSlots = [...state.memory.entries()]
    .filter(([path]) => path.startsWith('batches/current.'))
    .map(([, raw]) => JSON.parse(raw).payload as BatchRecord | null);
  expect(rawSlots).toHaveLength(2);
  expect(rawSlots.every((record) => record?.work.workId !== target.workId)).toBe(true);
});

test('최신 대상 완료 batch 제거 시 이전 작품 batch가 되살아나지 않도록 tombstone을 양 슬롯에 쓴다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const batches = createBatchRepository(state.files);
  const target = work('n9999ii');
  const previous = work('n1010jj');
  await library.saveWorkPage(target);
  await batches.write(batchRecord(previous, 'paused'));
  await batches.write(batchRecord(target, 'complete'));

  const result = await library.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: true, cleanupComplete: true });
  expect(await batches.read()).toBeNull();
  const rawSlots = [...state.memory.entries()]
    .filter(([path]) => path.startsWith('batches/current.'))
    .map(([, raw]) => JSON.parse(raw).payload);
  expect(rawSlots).toEqual([null, null]);
});

test('최신 대상 진행 중 batch는 이전 슬롯 phase와 무관하게 제거를 막는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const batches = createBatchRepository(state.files);
  const target = work('n1212kk');
  await library.saveWorkPage(target);
  await batches.write(batchRecord(target, 'paused'));
  await batches.write(batchRecord(target, 'running'));

  const result = await library.removeWork!(target.workId);

  expect(result).toMatchObject({ removed: false, cleanupComplete: false, blockedBy: 'batch' });
  expect(state.removed).toEqual([]);
  expect(await batches.read()).toMatchObject({ phase: 'running', work: { workId: target.workId } });
});

test('완료된 이전 대상 batch라도 실제 준비 owner가 그 작품이면 제거를 막는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const batches = createBatchRepository(state.files);
  const target = work('n1717pp');
  const previous = work('n1818qq');
  await library.saveWorkPage(target);
  await batches.write(batchRecord(previous, 'paused'));
  await batches.write(batchRecord(target, 'complete'));

  const result = await library.removeWork!(target.workId, { activeBatchWorkId: target.workId });

  expect(result).toMatchObject({ removed: false, cleanupComplete: false, blockedBy: 'batch' });
  expect(state.removed).toEqual([]);
  expect(await batches.read()).toMatchObject({
    work: { workId: target.workId },
    phase: 'complete',
  });
});

test('실제 prepare owner는 latest persistent batch가 다른 작품이어도 제거를 막는다', async () => {
  const state = fixture();
  const library = createLibraryStore(state.files, { preferences: state.preferences });
  const batches = createBatchRepository(state.files);
  const target = work('n2020ss');
  const previous = work('n2121tt');
  await library.saveWorkPage(target);
  await batches.write(batchRecord(previous, 'paused'));

  const result = await library.removeWork!(target.workId, { activeBatchWorkId: target.workId });

  expect(result).toMatchObject({ removed: false, cleanupComplete: false, blockedBy: 'batch' });
  expect(state.removed).toEqual([]);
  expect(await batches.read()).toMatchObject({
    work: { workId: previous.workId },
    phase: 'paused',
  });
});
