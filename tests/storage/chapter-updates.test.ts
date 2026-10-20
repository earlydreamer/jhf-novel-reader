import { expect, test } from 'vitest';
import { createLibraryStore, validateLibraryIndex } from '../../src/storage/library';
import { validateBackupSnapshot } from '../../src/storage/backupValidation';
import type { WorkUpdate } from '../../src/contracts/reading';
import { toc } from '../fixtures/chapterUpdates';

const update: WorkUpdate = {
  workId: 'n1234aa',
  lastCheckDate: '2026-10-21',
  attemptedAt: 1000,
  checkedAt: 1000,
  knownChapterIds: ['n1234aa/1', 'n1234aa/2'],
  newChapterIds: ['n1234aa/2'],
  failed: false,
};
function fixture() {
  const memory = new Map<string, string>();
  const files = {
    read: async (path: string) => memory.get(path) ?? null,
    write: async (path: string, text: string) => {
      memory.set(path, text);
    },
    remove: async (path: string) => {
      memory.delete(path);
    },
  };
  return {
    memory,
    files,
    library: createLibraryStore(files, {
      preferences: {
        get: async () => ({ value: null }),
        set: async () => {},
        remove: async () => {},
      },
    }),
  };
}

test('확인 시각과 신규 회차 상태는 재시작과 백업 복원 검증 뒤에도 유지된다', async () => {
  const h = fixture();
  await h.library.saveWorkPage(toc());
  expect(await h.library.readWorkUpdates!()).toEqual([]);
  await h.library.saveWorkUpdate!(update, [toc('n1234aa', [1, 2])]);
  const restarted = createLibraryStore(h.files);
  expect(await restarted.readWorkUpdates!()).toEqual([update]);
  expect((await restarted.readWork('n1234aa'))[0]?.chapters).toHaveLength(2);
  await validateBackupSnapshot({ paths: [...h.memory.keys()], read: h.files.read, settings: null });
  expect((await createLibraryStore(h.files).readWorkUpdates!())[0]?.newChapterIds).toEqual([
    'n1234aa/2',
  ]);
});

test('등록 시각이 있는 목차는 저장·백업 검증·재시작 후 보존하고 잘못된 시각은 거부한다', async () => {
  const h = fixture();
  const page = toc();
  page.chapters = page.chapters.map((chapter) => ({
    ...chapter,
    publishedAt: '2026-10-20T10:20:00.000Z',
  }));
  await h.library.saveWorkPage(page);
  expect((await createLibraryStore(h.files).readWork(page.workId))[0]).toEqual(page);
  await validateBackupSnapshot({ paths: [...h.memory.keys()], read: h.files.read, settings: null });
  for (const publishedAt of ['yesterday', '2026-02-30T10:20:00.000Z']) {
    await expect(
      h.library.saveWorkPage({
        ...page,
        chapters: page.chapters.map((chapter) => ({ ...chapter, publishedAt })),
      }),
    ).rejects.toThrow();
  }
});

test('작품 제거는 확인 상태도 함께 제거하고 늦은 확인 결과가 작품을 재등록하지 못한다', async () => {
  const h = fixture();
  await h.library.saveWorkPage(toc());
  await h.library.saveWorkUpdate!(update);
  expect((await h.library.removeWork!('n1234aa')).removed).toBe(true);
  expect(await h.library.readWorkUpdates!()).toEqual([]);
  await expect(h.library.saveWorkUpdate!(update, [toc('n1234aa', [1, 2])])).rejects.toThrow();
  expect(await h.library.listWorkIds()).toEqual([]);
});

test('다른 작품 회차, 기준에 없는 신규 회차, 잘못된 시각과 중복 소유자는 거부한다', async () => {
  for (const value of [
    { ...update, newChapterIds: ['n5678bb/2'] },
    { ...update, knownChapterIds: ['n1234aa/1'] },
    { ...update, attemptedAt: -1 },
    { ...update, lastCheckDate: '2026-02-30' },
    { ...update, lastCheckDate: '2026-1-01' },
  ]) {
    await expect(
      validateLibraryIndex({
        workIds: ['n1234aa'],
        versions: [],
        recent: [],
        workUpdates: [value],
      }),
    ).rejects.toThrow();
  }
  await expect(
    validateLibraryIndex({
      workIds: ['n1234aa'],
      versions: [],
      recent: [],
      workUpdates: [update, update],
    }),
  ).rejects.toThrow();
});

test('목차 저장 뒤 상태 저장이 실패해도 이전 비교 기준을 보존해 재시도에서 새 회차를 잃지 않는다', async () => {
  const h = fixture();
  await h.library.saveWorkPage(toc());
  const baseline = { ...update, knownChapterIds: ['n1234aa/1'], newChapterIds: [] };
  await h.library.saveWorkUpdate!(baseline);
  const failing = createLibraryStore({
    ...h.files,
    write: async (path, text) => {
      if (path.startsWith('library/')) throw new Error('disk full');
      await h.files.write(path, text);
    },
  });
  await expect(failing.saveWorkUpdate!(update, [toc('n1234aa', [1, 2])])).rejects.toThrow();
  expect((await h.library.readWorkUpdates!())[0]?.knownChapterIds).toEqual(['n1234aa/1']);
  await h.library.saveWorkUpdate!(update, [toc('n1234aa', [1, 2])]);
  expect((await h.library.readWorkUpdates!())[0]?.newChapterIds).toEqual(['n1234aa/2']);
});
