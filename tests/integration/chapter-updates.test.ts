import { afterEach, expect, test, vi } from 'vitest';
import { createChapterUpdates, type ChapterUpdatesSnapshot } from '../../src/app/chapterUpdates';
import { chapterCheckDate, nextChapterCheckAt } from '../../src/app/chapterUpdateSchedule';
import { NEW_CHAPTER_WINDOW_MS } from '../../src/app/chapterPublication';
import type { LibraryStore, WorkPage, WorkUpdate } from '../../src/contracts/reading';

import { recentToc as toc } from '../fixtures/chapterUpdates';

function harness(initial = [toc()]) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20, 9));
  const pages = new Map(initial.map((page) => [page.workId, [page]]));
  const records = new Map<string, WorkUpdate>();
  const readIds = new Map<string, string[]>();
  const library: LibraryStore = {
    listWorkIds: vi.fn(async () => [...pages.keys()]),
    readWork: vi.fn(async (id) => structuredClone(pages.get(id) ?? [])),
    readWorkUpdates: vi.fn(async () => structuredClone([...records.values()])),
    listReadChapterIds: vi.fn(async (id) => readIds.get(id) ?? []),
    saveWorkUpdate: vi.fn(async (record, values) => {
      records.set(record.workId, structuredClone(record));
      if (values) pages.set(record.workId, structuredClone([...values]));
    }),
    saveWorkPage: vi.fn(),
    listRecent: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    readVersion: vi.fn(async () => null),
    commitVersion: vi.fn(),
    savePosition: vi.fn(),
    readPosition: vi.fn(async () => null),
  };
  const getWorkPage = vi.fn(async (url: string): Promise<WorkPage> =>
    structuredClone([...pages.values()].flat().find((page) => page.pageUrl === url)!),
  );
  let state: ChapterUpdatesSnapshot = { works: {}, checkingAll: false, message: null };
  const removed = new Set<string>();
  const updated = vi.fn();
  const create = () =>
    createChapterUpdates({
      library,
      source: { getWorkPage, getChapter: vi.fn() },
      changed: (value) => {
        state = value;
      },
      updated,
      write: async (_id, action) => action(),
      removed: (id) => removed.has(id),
    });
  const checks = create();
  return {
    checks,
    create,
    library,
    records,
    readIds,
    pages,
    getWorkPage,
    updated,
    removed,
    state: () => state,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

test('등록 시각 없는 과거 누적 배지는 복원하지 않고 전체 성공 토스트는 한 번만 발행한다', async () => {
  const h = harness([toc(), toc('n5678bb')]);
  const now = Date.now();
  h.records.set('n1234aa', {
    workId: 'n1234aa',
    lastCheckDate: chapterCheckDate(now),
    attemptedAt: now,
    checkedAt: now,
    knownChapterIds: ['n1234aa/1'],
    newChapterIds: ['n1234aa/1'],
    failed: false,
  });
  await h.checks.initialize();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  h.checks.setForeground(true);
  await h.checks.checkAll();
  expect(h.state().notice).toEqual({ id: 1, text: '회차 목록을 갱신했어요.' });
  h.checks.dispose();
});

test('전체 검사 목록을 읽지 못하면 성공 토스트 대신 실패 안내를 발행한다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setForeground(true);
  vi.mocked(h.library.listWorkIds).mockRejectedValue(new Error('storage'));
  await h.checks.checkAll();
  expect(h.state().notice?.text).toBe('서재를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  h.checks.dispose();
});

test('48시간 이내여도 실제 읽기 기록이 있으면 제외하며 기록 전후·재검사·재시작을 구분한다', async () => {
  const h = harness();
  h.getWorkPage.mockResolvedValue(toc('n1234aa', [1, 2, 3]));
  h.readIds.set('n1234aa', ['n1234aa/2']);
  await h.checks.initialize();
  h.checks.setForeground(true);
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/3']);
  h.readIds.set('n1234aa', ['n1234aa/2', 'n1234aa/3']);
  h.checks.readRecorded('n1234aa', 'n1234aa/3');
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  h.checks.dispose();
  const restarted = h.create();
  await restarted.initialize();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  restarted.dispose();
});

test('48시간 경계와 만료는 시각 기준이며 원문 재요청 없이 배지가 사라지고 재시작에도 복원된다', async () => {
  const h = harness();
  const now = Date.now();
  const page = toc('n1234aa', [1, 2, 3, 4, 5]);
  page.chapters = page.chapters.map((chapter, index) => {
    const dates = [
      now - NEW_CHAPTER_WINDOW_MS,
      now - NEW_CHAPTER_WINDOW_MS - 1,
      now + 100 * 3_600_000,
      undefined,
      now - 3_600_000,
    ];
    const { publishedAt: _old, ...ref } = chapter;
    return dates[index] === undefined
      ? ref
      : { ...ref, publishedAt: new Date(dates[index]!).toISOString() };
  });
  h.getWorkPage.mockResolvedValue(page);
  await h.checks.initialize();
  h.checks.setIntervalDays(365);
  h.checks.setForeground(true);
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/1', 'n1234aa/5']);
  expect(h.state().notice?.text).toBe('회차 목록을 갱신했어요.');
  h.getWorkPage.mockClear();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/5']);
  await vi.advanceTimersByTimeAsync(NEW_CHAPTER_WINDOW_MS - 3_600_000);
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  h.checks.dispose();
  const restarted = h.create();
  await restarted.initialize();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  restarted.dispose();
});

test('백그라운드에서 만료된 배지는 복귀 때 지우고 오래된 회차만 갱신해도 완료를 알린다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setIntervalDays(365);
  h.checks.setForeground(true);
  h.getWorkPage.mockResolvedValue(toc('n1234aa', [1, 2]));
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/2']);
  h.checks.setForeground(false);
  h.getWorkPage.mockClear();
  await vi.advanceTimersByTimeAsync(49 * 3_600_000);
  h.checks.setForeground(true);
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  const old = toc('n1234aa', [1, 2, 3]);
  old.chapters = old.chapters.map((chapter) => ({
    ...chapter,
    publishedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
  }));
  h.getWorkPage.mockResolvedValue(old);
  const before = h.state().notice?.id;
  await h.checks.checkWork('n1234aa');
  expect(h.pages.get('n1234aa')?.[0]?.chapters).toHaveLength(3);
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([]);
  expect(h.state().notice?.text).toBe('회차 목록을 갱신했어요.');
  expect(h.state().notice?.id).toBeGreaterThan(before!);
  h.checks.dispose();
});

test('전체 목차의 등록 시각으로 배지를 계산하고 재검사와 재시작에도 복원한다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setForeground(true);
  h.getWorkPage.mockImplementation(async (url) =>
    url.includes('?p=2') ? toc('n1234aa', [3, 4], 2) : toc('n1234aa', [1, 2], 1, true),
  );
  await h.checks.checkWork('n1234aa');
  expect(h.getWorkPage.mock.calls.map(([url]) => url)).toEqual([
    'https://ncode.syosetu.com/n1234aa/',
    'https://ncode.syosetu.com/n1234aa/?p=2',
  ]);
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/2', 'n1234aa/3', 'n1234aa/4']);
  const checkedAt = h.state().works.n1234aa?.checkedAt;
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/2', 'n1234aa/3', 'n1234aa/4']);
  h.checks.dispose();
  const restarted = h.create();
  await restarted.initialize();
  expect(h.state().works.n1234aa?.checkedAt).toBe(checkedAt);
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/2', 'n1234aa/3', 'n1234aa/4']);
  restarted.dispose();
});

test('일부 목차만 가진 작품도 첫 전체 조회부터 실제 등록 시각으로 배지를 표시한다', async () => {
  const h = harness([toc('n1234aa', [1, 2], 1, true)]);
  await h.checks.initialize();
  h.checks.setForeground(true);
  let last = [3, 4];
  h.getWorkPage.mockImplementation(async (url) =>
    url.includes('?p=2') ? toc('n1234aa', last, 2) : toc('n1234aa', [1, 2], 1, true),
  );
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/2', 'n1234aa/3', 'n1234aa/4']);
  last = [3, 4, 5];
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual([
    'n1234aa/2',
    'n1234aa/3',
    'n1234aa/4',
    'n1234aa/5',
  ]);
  h.checks.dispose();
});

test('같은 날짜의 복귀와 재시작은 조회하지 않고 다음날 0시에 자동 검사한다', async () => {
  const h = harness();
  vi.setSystemTime(new Date(2026, 9, 20, 23, 59, 59, 900));
  await h.checks.initialize();
  h.checks.setForeground(true);
  await h.checks.checkAll();
  h.getWorkPage.mockClear();
  h.checks.setForeground(false);
  await vi.advanceTimersByTimeAsync(99);
  h.checks.setForeground(true);
  await h.checks.checkAll(false);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  h.checks.dispose();
  const restarted = h.create();
  await restarted.initialize();
  restarted.setForeground(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  await restarted.checkAll(false);
  restarted.dispose();
});

test('수동 확인은 주기를 건너뛰고 전체/개별 중복 요청은 합친다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setForeground(true);
  let release!: (page: WorkPage) => void;
  h.getWorkPage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = h.checks.checkWork('n1234aa');
  const second = h.checks.checkAll();
  await vi.advanceTimersByTimeAsync(0);
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  release(toc('n1234aa', [1, 2]));
  await Promise.all([first, second]);
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  await h.checks.checkAll();
  expect(h.getWorkPage).toHaveBeenCalledTimes(2);
  h.checks.dispose();
});

test('한 작품 실패는 다른 작품을 막지 않고 기존 목차/배지를 보존하며 15분 자동 재시도는 없다', async () => {
  const h = harness([toc(), toc('n5678bb')]);
  await h.checks.initialize();
  h.checks.setForeground(true);
  h.getWorkPage.mockImplementation(async (url) =>
    toc(url.includes('n5678bb') ? 'n5678bb' : 'n1234aa', [1, 2]),
  );
  await h.checks.checkAll();
  const lastSuccess = h.state().works.n1234aa?.checkedAt;
  h.getWorkPage.mockImplementation(async (url) => {
    if (url.includes('n1234aa')) throw new Error('offline');
    return toc('n5678bb', [1, 2, 3]);
  });
  await h.checks.checkAll();
  expect(h.state().works.n1234aa?.newChapterIds).toEqual(['n1234aa/2']);
  expect(h.pages.get('n1234aa')?.[0]?.chapters).toHaveLength(2);
  expect(h.state().works.n5678bb?.newChapterIds).toEqual(['n5678bb/2', 'n5678bb/3']);
  expect(h.state().message).toContain('2개 작품 중 1개');
  expect(h.state().works.n1234aa?.lastCheckDate).toBe('2026-10-20');
  expect(h.state().works.n1234aa?.checkedAt).toBe(lastSuccess);
  h.getWorkPage.mockClear();
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  await h.checks.checkWork('n1234aa');
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  h.getWorkPage.mockClear();
  await vi.advanceTimersByTimeAsync(nextChapterCheckAt('2026-10-20', 1) - Date.now());
  expect(h.getWorkPage).toHaveBeenCalledTimes(2);
  h.checks.dispose();
});

test.each(['background', 'remove', 'dispose'] as const)(
  '늦은 응답은 %s 뒤 목차를 덮거나 작품을 되살리지 않는다',
  async (reason) => {
    const h = harness();
    await h.checks.initialize();
    h.checks.setForeground(true);
    let release!: (page: WorkPage) => void;
    h.getWorkPage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const job = h.checks.checkWork('n1234aa');
    await vi.advanceTimersByTimeAsync(0);
    if (reason === 'background') h.checks.setForeground(false);
    if (reason === 'remove') {
      h.removed.add('n1234aa');
      h.checks.remove('n1234aa');
    }
    if (reason === 'dispose') h.checks.dispose();
    release(toc('n1234aa', [1, 2]));
    await job;
    expect(h.updated).not.toHaveBeenCalled();
    expect(h.pages.get('n1234aa')?.[0]?.chapters).toHaveLength(1);
    h.checks.dispose();
  },
);

test('잘못된 페이지 순환/작품 변경은 저장하지 않는다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setForeground(true);
  h.getWorkPage.mockResolvedValueOnce({ ...toc(), nextPageUrl: toc().canonicalUrl });
  await h.checks.checkAll();
  expect(h.updated).not.toHaveBeenCalled();
  expect(h.state().works.n1234aa?.error).toBeTruthy();
  h.getWorkPage.mockResolvedValueOnce(toc('n5678bb'));
  await h.checks.checkAll();
  expect(h.updated).not.toHaveBeenCalled();
  h.getWorkPage.mockResolvedValueOnce(toc('n1234aa', [1, 3]));
  await h.checks.checkAll();
  expect(h.updated).not.toHaveBeenCalled();
  h.checks.dispose();
});

test('N일 설정은 마지막 검사일에서 달력 날짜를 더하고 설정 변경도 즉시 반영한다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setIntervalDays(3);
  h.checks.setForeground(true);
  await h.checks.checkAll();
  h.getWorkPage.mockClear();
  await vi.advanceTimersByTimeAsync(new Date(2026, 9, 22, 23, 59, 59, 999).getTime() - Date.now());
  expect(h.getWorkPage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  expect(h.state().works.n1234aa?.lastCheckDate).toBe('2026-10-23');
  h.getWorkPage.mockClear();
  h.checks.setIntervalDays(1);
  await vi.advanceTimersByTimeAsync(new Date(2026, 9, 24).getTime() - Date.now());
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  h.checks.dispose();
});

test('수동 개별 검사는 해당 작품의 검사일만 갱신한다', async () => {
  const h = harness([toc(), toc('n5678bb')]);
  await h.checks.initialize();
  h.checks.setForeground(true);
  await h.checks.checkAll();
  h.checks.setForeground(false);
  vi.setSystemTime(new Date(2026, 9, 21, 10));
  h.checks.setForeground(true);
  await h.checks.checkWork('n5678bb');
  expect(h.state().works.n1234aa?.lastCheckDate).toBe('2026-10-20');
  expect(h.state().works.n5678bb?.lastCheckDate).toBe('2026-10-21');
  h.getWorkPage.mockClear();
  await h.checks.checkAll(false);
  expect(h.getWorkPage.mock.calls.map(([url]) => url)).toEqual([toc().canonicalUrl]);
  h.checks.dispose();
});

test('여러 날 뒤 복귀해도 밀린 검사는 한 번만 하고 같은 날 재복귀는 건너뛴다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setForeground(true);
  await h.checks.checkAll();
  h.getWorkPage.mockClear();
  h.checks.setForeground(false);
  await vi.advanceTimersByTimeAsync(4 * 24 * 60 * 60 * 1000);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  h.checks.setForeground(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  h.checks.setForeground(false);
  h.checks.setForeground(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(h.getWorkPage).toHaveBeenCalledTimes(1);
  h.checks.dispose();
});

test.each([false, true])(
  '자정을 넘긴 검사(실패=%s)는 끝난 날짜를 기록해 즉시 다시 검사하지 않는다',
  async (fail) => {
    const h = harness();
    vi.setSystemTime(new Date(2026, 9, 20, 23, 59, 59, 900));
    await h.checks.initialize();
    h.checks.setForeground(true);
    let release!: () => void;
    h.getWorkPage.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          release = () => (fail ? reject(new Error('offline')) : resolve(toc('n1234aa', [1, 2])));
        }),
    );
    const job = h.checks.checkWork('n1234aa');
    await vi.advanceTimersByTimeAsync(200);
    release();
    await job;
    expect(h.state().works.n1234aa?.lastCheckDate).toBe('2026-10-21');
    expect(h.records.get('n1234aa')?.lastCheckDate).toBe('2026-10-21');
    await h.checks.checkAll(false);
    expect(h.getWorkPage).toHaveBeenCalledTimes(1);
    h.checks.dispose();
  },
);

test('목차 저장소 읽기 실패도 같은 날 자동 검사를 반복하지 않는다', async () => {
  const h = harness();
  vi.mocked(h.library.readWork).mockRejectedValue(new Error('storage'));
  await h.checks.initialize();
  h.checks.setForeground(true);
  await h.checks.checkAll(false);
  await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
  await h.checks.checkAll(false);
  expect(h.library.readWork).toHaveBeenCalledTimes(1);
  expect(h.state().works.n1234aa?.lastCheckDate).toBe('2026-10-20');
  expect(h.state().works.n1234aa?.error).toBeTruthy();
  h.checks.dispose();
});

test('긴 주기의 타이머가 정수 상한을 넘어 즉시 검사로 바뀌지 않는다', async () => {
  const h = harness();
  await h.checks.initialize();
  h.checks.setIntervalDays(365);
  h.checks.setForeground(true);
  await h.checks.checkAll();
  h.getWorkPage.mockClear();
  await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);
  expect(h.getWorkPage).not.toHaveBeenCalled();
  h.checks.dispose();
});

test('달력 일수 계산은 월말과 연말 및 윤년을 따른다', () => {
  expect(chapterCheckDate(nextChapterCheckAt('2026-12-31', 1))).toBe('2027-01-01');
  expect(chapterCheckDate(nextChapterCheckAt('2028-02-28', 1))).toBe('2028-02-29');
  expect(chapterCheckDate(nextChapterCheckAt('2028-02-28', 2))).toBe('2028-03-01');
  expect(new Date(nextChapterCheckAt('2026-10-20', 3)).getHours()).toBe(0);
});
