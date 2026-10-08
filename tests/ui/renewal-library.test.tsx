// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type {
  CompletedTranslation,
  WorkPage,
  WorkRemovalResult,
} from '../../src/contracts/reading';
import type { BatchState } from '../../src/translation/batch';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function work(workId: string, title: string, ordinal = 1): WorkPage {
  const base = `https://ncode.syosetu.com/${workId}/`;
  return {
    workId,
    canonicalUrl: base,
    title,
    chapters: [
      {
        workId,
        chapterId: `${workId}/${ordinal}`,
        canonicalUrl: `${base}${ordinal}/`,
        title: `${ordinal}화 제목`,
        ordinal,
      },
    ],
    pageUrl: base,
    nextPageUrl: null,
    complete: true,
  };
}

function libraryHarness(initial: readonly WorkPage[] = []) {
  const works = new Map(initial.map((page) => [page.workId, [page]]));
  const versions = new Map<string, CompletedTranslation[]>();
  const ids = [...works.keys()];
  const library = {
    listWorkIds: vi.fn(async () => [...ids]),
    saveWorkPage: vi.fn(async (page: WorkPage) => {
      if (!ids.includes(page.workId)) ids.push(page.workId);
      works.set(page.workId, [
        ...(works.get(page.workId) ?? []).filter((old) => old.pageUrl !== page.pageUrl),
        page,
      ]);
    }),
    readWork: vi.fn(async (workId: string) => works.get(workId) ?? []),
    listRecent: vi.fn(
      async () =>
        [] as { workId: string; chapterId: string; versionId: string; updatedAt: string }[],
    ),
    listVersions: vi.fn(async (chapterId: string) => versions.get(chapterId) ?? []),
    readVersion: vi.fn(
      async (versionId: string) =>
        [...versions.values()].flat().find((version) => version.versionId === versionId) ?? null,
    ),
    commitVersion: vi.fn(async () => {}),
    savePosition: vi.fn(async () => {}),
    readPosition: vi.fn(async () => null),
    removeWork: vi.fn(async (workId: string): Promise<WorkRemovalResult> => {
      const index = ids.indexOf(workId);
      if (index >= 0) ids.splice(index, 1);
      works.delete(workId);
      for (const chapterId of [...versions.keys()])
        if (chapterId.startsWith(`${workId}/`)) versions.delete(chapterId);
      return { removed: true as const, cleanupComplete: true, remainingInventory: [] };
    }),
  };
  return { library, works, versions };
}

function savedVersion(page: WorkPage): CompletedTranslation {
  const chapter = page.chapters[0]!;
  return {
    schemaVersion: 2,
    versionId: `saved-${page.workId}`,
    source: {
      ...chapter,
      sourceHash: 'synthetic-hash',
      paragraphs: [{ id: 'source-1', text: '原文', ruby: [] }],
      prevUrl: null,
      nextUrl: null,
      captureKind: 'fetched',
      fetchedAt: '2026-10-08T00:00:00Z',
      rawHtml: '<p>原文</p>',
    },
    text: '저장된 번역',
    blocks: [{ id: 'translated-1', text: '저장된 번역' }],
    createdAt: '2026-10-08T00:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'fixture',
      modelId: 'fixture-model',
      contractVersion: 'plain-v1',
      promptVersion: 'fixture-v1',
      languageDirection: 'ja-ko',
    },
  };
}

it('재시작 뒤 저장 번역이 없는 작품도 서재에 보이고 source 없이 캐시 목차를 연다', async () => {
  const cached = work('n1234aa', '오프라인 작품');
  const { library } = libraryHarness([cached]);
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);

  const row = (await screen.findByText('오프라인 작품')).closest('button')!;
  expect(row).toHaveTextContent('아직 번역하지 않았어요');
  fireEvent.click(row);
  await screen.findByRole('heading', { name: cached.title });
  expect(controller.getSnapshot().route).toEqual({ kind: 'work', workId: cached.workId });
  expect(library.readWork).toHaveBeenCalledWith(cached.workId);
  expect(controller.getSnapshot().savedChapterIds).toEqual([]);
  expect(controller.getSnapshot().sourceAvailable).toBe(false);
  controller.dispose();
});

it('새 작품을 URL로 열고 서재로 돌아오면 즉시 목록에 등록된다', async () => {
  const added = work('n5678bb', '새 작품');
  const { library } = libraryHarness();
  const controller = createRenewalController({
    library,
    source: { getWorkPage: vi.fn(async () => added), getChapter: vi.fn() },
    normalizeInput: (url) => url,
  });
  render(<Application controller={controller} />);
  await screen.findByRole('heading', { name: '읽고 싶은 작품을 찾아보세요' });
  await controller.openWork(added.canonicalUrl);
  await screen.findByRole('heading', { name: added.title });
  controller.back();
  await screen.findByText('새 작품');
  expect(library.listWorkIds).toHaveBeenCalled();
  controller.dispose();
});

it('서재에 남아 있을 때 번역 저장이 끝나면 저장 화수와 이어읽기 카드를 갱신한다', async () => {
  const cached = work('n1234aa', '완료 대기 작품');
  const version = savedVersion(cached);
  const { library, versions } = libraryHarness([cached]);
  let completed: CompletedTranslation | null = null;
  let emitBatch = (_state: BatchState) => {};
  const flow = {
    initialize: vi.fn(async () => {}),
    setForeground: vi.fn(),
    dispose: vi.fn(),
    getCompleted: () => completed,
    getSnapshot: () => ({ phase: 'idle', elapsedMs: 0 }),
    subscribe: vi.fn(() => () => {}),
  } as unknown as NonNullable<RenewalDependencies['flow']>;
  const batch = {
    initialize: vi.fn(async () => {}),
    setForeground: vi.fn(),
    getSnapshot: () => ({ record: null, active: false, preparing: false, error: null }),
    subscribe: vi.fn((listener: (state: BatchState) => void) => {
      emitBatch = listener;
      return () => {};
    }),
    dispose: vi.fn(),
  } as unknown as NonNullable<RenewalDependencies['batch']>;
  const controller = createRenewalController({ library, flow, batch });
  render(<Application controller={controller} />);
  const row = await screen.findByText('완료 대기 작품');
  expect(row.closest('button')).toHaveTextContent('아직 번역하지 않았어요');

  completed = version;
  versions.set(version.source.chapterId, [version]);
  library.listRecent.mockResolvedValue([
    {
      workId: cached.workId,
      chapterId: version.source.chapterId,
      versionId: version.versionId,
      updatedAt: version.createdAt,
    },
  ]);
  emitBatch?.({
    record: {
      schemaVersion: 1,
      id: 'batch-fixture',
      createdAt: version.createdAt,
      work: cached,
      selection: {
        connection: { provider: 'openai-compatible', baseUrl: '', revision: 0 },
        modelId: 'fixture-model',
        translationMode: 'legacy',
      },
      chapters: cached.chapters,
      retranslate: false,
      alreadySaved: 0,
      cursor: 1,
      completed: 1,
      skipped: 0,
      phase: 'complete',
    },
    active: false,
    preparing: false,
    error: null,
  });

  await waitFor(() => expect(row.closest('button')).toHaveTextContent('1화 저장'));
  expect(screen.getByRole('button', { name: /이어서 읽기/ })).toHaveTextContent('완료 대기 작품');
  controller.dispose();
});

it('작품 메뉴는 canonical URL을 기존 browse 연결의 시작 주소로 전달한다', async () => {
  const cached = work('n1234aa', '메뉴 작품');
  const { library } = libraryHarness([cached]);
  const browse = vi.fn(async () => null);
  const controller = createRenewalController({ library, browse });
  render(<Application controller={controller} />);
  fireEvent.click(await screen.findByRole('button', { name: '메뉴 작품 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '원문 사이트에서 보기' }));
  await waitFor(() => expect(browse).toHaveBeenCalledExactlyOnceWith(cached.canonicalUrl));
  expect(screen.queryByRole('menuitem', { name: '서재에서 제거하기' })).toBeNull();
  controller.dispose();
});

it('URL 입력 실패는 대화상자를 닫은 뒤 snackbar로 알린다', async () => {
  const controller = createRenewalController();
  render(<Application controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: 'URL로 열기' }));
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('작품 또는 회차 URL'), {
    target: { value: 'https://ncode.syosetu.com/n1234aa/' },
  });
  fireEvent.click(screen.getByRole('button', { name: '열기' }));
  const notice = await screen.findByText('원문 탐색 연결이 없어요. URL로 작품을 열어 주세요.');
  expect(notice.closest('.nr-snackbar')).toBeVisible();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  controller.dispose();
});

it('FAB은 source_access 실패 이유를 알리고 서재에서만 snackbar를 FAB 위로 올린다', async () => {
  const browse = vi.fn(async () => {
    throw new ReaderError('source_access');
  });
  const controller = createRenewalController({ browse });
  render(<Application controller={controller} />);
  fireEvent.click(screen.getByRole('button', { name: '작품 찾기' }));
  expect(await screen.findByText('원문 탐색을 사용할 수 없어요. URL로 열어 주세요.')).toBeVisible();
  const region = document.querySelector<HTMLElement>('.nr-snackbar-region')!;
  expect(region.style.getPropertyValue('--nr-snackbar-offset')).toBe('64px');
  fireEvent.click(screen.getByRole('button', { name: '설정' }));
  await screen.findByRole('heading', { name: '연결 설정' });
  expect(region.style.getPropertyValue('--nr-snackbar-offset')).toBe('0px');
  controller.dispose();
});

it('같은 작품 찾기 오류도 스낵바가 사라진 뒤 다시 알려준다', async () => {
  vi.useFakeTimers();
  const controller = createRenewalController();
  render(<Application controller={controller} />);
  const button = screen.getByRole('button', { name: '작품 찾기' });
  const message = '작품 찾기를 아직 사용할 수 없어요. URL로 열어 주세요.';

  fireEvent.click(button);
  expect(screen.getByText(message)).toBeVisible();
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(screen.queryByText(message)).toBeNull();

  fireEvent.click(button);
  expect(screen.getByText(message)).toBeVisible();
  controller.dispose();
});

it('읽기 시각이 있는 작품을 먼저 정렬하고, 저장 회차 수는 중복 chapterId를 한 번만 센다', async () => {
  const first = work('n1234aa', '등록 먼저');
  const second = work('n5678bb', '최근 읽음');
  const { library } = libraryHarness([first, second]);
  library.listRecent.mockResolvedValue([
    {
      workId: second.workId,
      chapterId: second.chapters[0]!.chapterId,
      versionId: 'v2',
      updatedAt: '2026-10-08T00:00:00Z',
    },
  ]);
  library.listVersions.mockResolvedValue([{}, {}] as CompletedTranslation[]);
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);
  await waitFor(() =>
    expect(controller.getSnapshot().libraryWorks.map(({ work: item }) => item.workId)).toEqual([
      second.workId,
      first.workId,
    ]),
  );
  const recentRow = screen
    .getByText('최근 읽음', { selector: '.nr-list-item__headline' })
    .closest('button')!;
  expect(recentRow).toHaveTextContent('1화 저장');
  expect(controller.getSnapshot().libraryWorks[0]?.savedChapterIds).toEqual([
    second.chapters[0]!.chapterId,
  ]);
  controller.dispose();
});

it('다른 작품의 읽기 위치를 저장하고 서재로 돌아오면 최신 작품과 이어읽기 카드가 바뀐다', async () => {
  const first = work('n1234aa', '이전 작품');
  const second = work('n5678bb', '읽던 작품');
  const firstVersion = savedVersion(first);
  const secondVersion = savedVersion(second);
  const { library, versions } = libraryHarness([first, second]);
  versions.set(firstVersion.source.chapterId, [firstVersion]);
  versions.set(secondVersion.source.chapterId, [secondVersion]);
  const firstRecent = {
    workId: first.workId,
    chapterId: firstVersion.source.chapterId,
    versionId: firstVersion.versionId,
    updatedAt: '2026-10-06T00:00:00Z',
  };
  const secondRecent = {
    workId: second.workId,
    chapterId: secondVersion.source.chapterId,
    versionId: secondVersion.versionId,
    updatedAt: '2026-10-07T00:00:00Z',
  };
  let positionSaved = false;
  library.listRecent.mockImplementation(async () =>
    positionSaved ? [firstRecent, secondRecent] : [secondRecent, firstRecent],
  );
  library.savePosition.mockImplementation(async () => {
    positionSaved = true;
  });
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);
  await waitFor(() =>
    expect(controller.getSnapshot().libraryWorks[0]?.work.workId).toBe(second.workId),
  );

  await controller.continueReading(firstVersion.versionId);
  await controller.savePosition(firstVersion.blocks[0]!.id, 17);
  controller.back();

  await waitFor(() =>
    expect(controller.getSnapshot().libraryWorks.map(({ work: item }) => item.workId)).toEqual([
      first.workId,
      second.workId,
    ]),
  );
  expect(screen.getByRole('button', { name: /이어서 읽기/ })).toHaveTextContent('이전 작품');
  controller.dispose();
});

it('손상된 작품 하나가 있어도 다른 작품 행과 최근 저장본을 계속 연다', async () => {
  const healthy = work('n1234aa', '정상 작품');
  const damaged = work('n5678bb', '손상 작품');
  const version = savedVersion(healthy);
  const { library, versions } = libraryHarness([healthy, damaged]);
  versions.set(version.source.chapterId, [version]);
  library.readWork.mockImplementation(async (workId: string) => {
    if (workId === damaged.workId) throw new Error('damaged index entry');
    return [healthy];
  });
  library.listRecent.mockResolvedValue([
    {
      workId: healthy.workId,
      chapterId: version.source.chapterId,
      versionId: version.versionId,
      updatedAt: version.createdAt,
    },
  ]);
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);

  expect(
    await screen.findByText('정상 작품', { selector: '.nr-list-item__headline' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: /이어서 읽기/ })).toBeVisible();
  expect(screen.queryByText('손상 작품')).toBeNull();
  expect(await screen.findByText('일부 작품 정보를 불러오지 못했어요.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /이어서 읽기/ }));
  await waitFor(() => expect(controller.getSnapshot().route.kind).toBe('reader'));
  controller.dispose();
});

it('서재 작품 메뉴는 확인 전에는 삭제하지 않고 확인 뒤 행을 제거한다', async () => {
  const cached = work('n1234aa', '제거할 작품');
  const { library } = libraryHarness([cached]);
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);
  await screen.findByText('제거할 작품', { selector: '.nr-list-item__headline' });

  fireEvent.click(screen.getByRole('button', { name: '제거할 작품 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('번역 0화');
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(library.removeWork).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '제거할 작품 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));
  await waitFor(() =>
    expect(library.removeWork).toHaveBeenCalledExactlyOnceWith(cached.workId, {
      activeBatchWorkId: undefined,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText('제거할 작품', { selector: '.nr-list-item__headline' })).toBeNull(),
  );
  expect(await screen.findByText('서재에서 제거했어요.')).toBeVisible();
  controller.dispose();
});

it.each([
  {
    title: '부분 정리',
    result: {
      removed: true as const,
      cleanupComplete: false,
      remainingInventory: ['library/index.removalInventory'],
    },
    expected: '서재 목록에서는 제거했지만 저장 데이터 정리를 끝내지 못했어요.',
  },
  {
    title: '결과 불명',
    result: { removed: null, cleanupComplete: false, remainingInventory: ['library/index'] },
    expected: '제거 여부를 확인하지 못했어요. 앱을 완전히 종료한 뒤 다시 열어 확인해 주세요.',
  },
])(
  '서재에서 제거의 $title 결과는 확인 대화상자에서 정확히 안내한다',
  async ({ result, expected }) => {
    const target = work('n1313xy', '서재 결과 작품');
    const { library } = libraryHarness([target]);
    library.removeWork.mockResolvedValue(result);
    const controller = createRenewalController({ library });
    render(<Application controller={controller} />);
    await screen.findByText('서재 결과 작품', { selector: '.nr-list-item__headline' });

    fireEvent.click(screen.getByRole('button', { name: '서재 결과 작품 메뉴' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
    fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

    if (result.removed === true) {
      expect(
        await screen.findByRole('dialog', { name: '일부 데이터를 정리하지 못했어요' }),
      ).toHaveTextContent(expected);
      expect(controller.getSnapshot().libraryWorks).toEqual([]);
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent(expected);
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(controller.getSnapshot().libraryWorks).toHaveLength(1);
    }
    controller.dispose();
  },
);

it('새 batch 준비 중에는 이전 완료 기록 대신 preparingWorkId를 실제 guard로 쓴다', async () => {
  const target = work('n1234aa', '완료 기록 작품');
  const preparing = work('n5678bb', '준비 중 작품');
  const { library } = libraryHarness([target]);
  let batchSnapshot: BatchState = {
    record: {
      schemaVersion: 1,
      id: 'old-complete',
      createdAt: '2026-10-08T00:00:00Z',
      work: target,
      selection: {
        connection: { provider: 'openai-compatible', baseUrl: '', revision: 0 },
        modelId: 'fixture-model',
        translationMode: 'legacy',
      },
      chapters: target.chapters,
      retranslate: false,
      alreadySaved: 0,
      cursor: 1,
      completed: 1,
      skipped: 0,
      phase: 'complete' as const,
    },
    active: true,
    preparing: true,
    preparingWorkId: preparing.workId,
    error: null,
  };
  const staleBatchSnapshot = batchSnapshot;
  const batchListeners: ((state: BatchState) => void)[] = [];
  let flowCompleted: CompletedTranslation | null = savedVersion(target);
  const flow = {
    getSnapshot: () => ({ phase: 'idle', elapsedMs: 0 }),
    getUnfinished: () => [],
    getCompleted: () => flowCompleted,
    clearWork: vi.fn(() => {
      flowCompleted = null;
      return true;
    }),
    subscribe: vi.fn(() => () => {}),
    setForeground: vi.fn(),
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(),
    active: false,
  } as unknown as NonNullable<RenewalDependencies['flow']>;
  const batch = {
    initialize: vi.fn(async () => {}),
    setForeground: vi.fn(),
    getSnapshot: () => batchSnapshot,
    clearWork: vi.fn((workId: string) => {
      if (batchSnapshot.record?.work.workId === workId)
        batchSnapshot = { ...batchSnapshot, record: null };
      return true;
    }),
    subscribe: vi.fn((listener: (state: BatchState) => void) => {
      batchListeners.push(listener);
      return () => {};
    }),
    dispose: vi.fn(),
  } as unknown as NonNullable<RenewalDependencies['batch']>;
  const controller = createRenewalController({
    library,
    batch,
    flow,
    source: { getWorkPage: vi.fn(async () => target), getChapter: vi.fn() },
  });
  render(<Application controller={controller} />);
  fireEvent.click(await screen.findByRole('button', { name: '완료 기록 작품 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

  await waitFor(() =>
    expect(library.removeWork).toHaveBeenCalledWith(target.workId, {
      activeBatchWorkId: preparing.workId,
    }),
  );
  expect(batch.clearWork).toHaveBeenCalledWith(target.workId);
  expect(controller.getSnapshot().batch).toMatchObject({
    record: null,
    active: true,
    preparing: true,
    preparingWorkId: preparing.workId,
  });
  act(() => batchListeners.forEach((listener) => listener(staleBatchSnapshot)));
  expect(controller.getSnapshot().libraryWorks).toEqual([]);
  expect(controller.getSnapshot().batch?.record).toBeNull();
  await controller.openWork(target.canonicalUrl);
  expect(controller.getSnapshot().route).toMatchObject({ kind: 'work', workId: target.workId });
  act(() => batchListeners.forEach((listener) => listener(staleBatchSnapshot)));
  expect(controller.getSnapshot().route).toMatchObject({ kind: 'work', workId: target.workId });
  expect(controller.getSnapshot().batch?.record).toBeNull();
  flowCompleted = savedVersion(target);
  const newerOtherWorkState: BatchState = {
    ...staleBatchSnapshot,
    record: {
      ...staleBatchSnapshot.record!,
      id: 'new-other-work',
      work: preparing,
      chapters: preparing.chapters,
    },
  };
  act(() => batchListeners.forEach((listener) => listener(newerOtherWorkState)));
  expect(controller.getSnapshot().libraryWorks).toEqual([]);
  controller.goHome();
  await screen.findByText('완료 기록 작품', { selector: '.nr-list-item__headline' });
  expect(controller.getSnapshot().libraryWorks.map((entry) => entry.work.workId)).toEqual([
    target.workId,
  ]);
  expect(controller.getSnapshot().libraryWorks[0]?.savedChapterIds).toEqual([]);
  expect(controller.getSnapshot().recent).toEqual([]);
  controller.dispose();
});

it('preparingWorkId 대상 제거는 이전 작품 record가 달라도 차단한다', async () => {
  const target = work('n1234aa', '준비 중인 작품');
  const previous = work('n5678bb', '이전 batch 작품');
  const { library } = libraryHarness([target]);
  const batch = {
    initialize: vi.fn(async () => {}),
    setForeground: vi.fn(),
    getSnapshot: () => ({
      record: {
        schemaVersion: 1,
        id: 'old-paused',
        createdAt: '2026-10-08T00:00:00Z',
        work: previous,
        selection: {
          connection: {
            provider: 'openai-compatible',
            baseUrl: 'https://example.com/v1',
            revision: 0,
          },
          modelId: 'fixture-model',
          translationMode: 'legacy',
        },
        chapters: previous.chapters,
        retranslate: false,
        alreadySaved: 0,
        cursor: 0,
        completed: 0,
        skipped: 0,
        phase: 'paused',
      },
      active: true,
      preparing: true,
      preparingWorkId: target.workId,
      error: null,
    }),
    clearWork: vi.fn(() => true),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } as unknown as NonNullable<RenewalDependencies['batch']>;
  const controller = createRenewalController({ library, batch });
  render(<Application controller={controller} />);
  fireEvent.click(await screen.findByRole('button', { name: '준비 중인 작품 메뉴' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '이 작품의 일괄 번역이 끝나지 않았어요. 번역을 마친 뒤 다시 제거해 주세요.',
  );
  expect(library.removeWork).not.toHaveBeenCalled();
  controller.dispose();
});

it('제거보다 늦게 끝난 URL 목차 요청은 작품을 다시 등록하지 않는다', async () => {
  const target = work('n1515nn', '늦게 열린 작품');
  const { library } = libraryHarness([target]);
  let finishFetch!: (page: WorkPage) => void;
  const fetchPending = new Promise<WorkPage>((resolve) => {
    finishFetch = resolve;
  });
  const controller = createRenewalController({
    library,
    source: { getWorkPage: vi.fn(() => fetchPending), getChapter: vi.fn() },
    normalizeInput: (url) => url,
  });
  const opening = controller.openWork(target.canonicalUrl);
  await waitFor(() => expect(controller.getSnapshot().busy).toBe(true));
  const removed = await controller.removeWork(target.workId);
  expect(removed).toMatchObject({ removed: true, cleanupComplete: true });
  finishFetch(target);
  await opening;

  expect(library.saveWorkPage).not.toHaveBeenCalled();
  expect(controller.getSnapshot().route.kind).toBe('home');
  controller.dispose();
});

it('제거보다 늦게 끝난 이어읽기 조회는 삭제된 작품을 다시 열지 않는다', async () => {
  const target = work('n1414xz', '늦게 이어읽는 작품');
  const saved = savedVersion(target);
  const { library } = libraryHarness([target]);
  let finishRead!: (value: CompletedTranslation) => void;
  library.readVersion.mockImplementation(
    () => new Promise<CompletedTranslation>((resolve) => (finishRead = resolve)),
  );
  const controller = createRenewalController({ library });
  const opening = controller.continueReading(saved.versionId);
  expect(await controller.removeWork(target.workId)).toMatchObject({
    removed: true,
    cleanupComplete: true,
  });
  finishRead(saved);
  await opening;

  expect(controller.getSnapshot().route).toEqual({ kind: 'home' });
  expect(controller.getSnapshot().version).toBeNull();
  expect(library.readWork).not.toHaveBeenCalled();
  controller.dispose();
});

it('같은 작품을 다시 등록해도 제거 전 livePosition을 새 번역에 적용하지 않는다', async () => {
  const target = work('n1515xy', '위치 초기화 작품');
  const oldVersion = savedVersion(target);
  const nextVersion: CompletedTranslation = {
    ...oldVersion,
    versionId: 'new-after-removal',
    provenance: {
      ...oldVersion.provenance,
      promptVersion: 'colomo-local-v1',
      generation: {
        mode: 'colomo-local-v1',
        segments: 1,
        contextTokens: 2048,
        inputBudgetTokens: 1024,
        maxOutputTokens: 1024,
      },
    },
  };
  const { library, versions: versionsByChapter } = libraryHarness([target]);
  let removed = false;
  library.listVersions.mockImplementation(async (chapterId: string) =>
    chapterId === oldVersion.source.chapterId && !removed ? [oldVersion] : [],
  );
  library.removeWork.mockImplementation(async (workId: string) => {
    removed = true;
    return { removed: true, cleanupComplete: true, remainingInventory: [] };
  });
  let completed: CompletedTranslation | null = null;
  const flow = {
    initialize: vi.fn(async () => {}),
    setForeground: vi.fn(),
    getSnapshot: () => ({ phase: 'idle', elapsedMs: 0 }),
    getUnfinished: () => [],
    getCompleted: () => completed,
    getTimings: () => ({ sourceMs: 0, modelMs: 0, validationStorageMs: 0 }),
    clearWork: vi.fn(() => {
      completed = null;
      return true;
    }),
    start: vi.fn(async () => {
      completed = nextVersion;
    }),
    subscribe: vi.fn(() => () => {}),
    dispose: vi.fn(),
    active: false,
  } as unknown as NonNullable<RenewalDependencies['flow']>;
  const controller = createRenewalController({
    library,
    flow,
    streamingAvailable: true,
    source: { getWorkPage: vi.fn(async () => target), getChapter: vi.fn() },
    connect: vi.fn(async () => ({
      listModels: vi.fn(async () => [
        { id: 'fixture-hymt2', displayName: 'Fixture', supportsGeneration: true },
      ]),
      translateChapter: vi.fn(async () => ({
        text: 'translated',
        finishReason: 'complete' as const,
      })),
    })),
  });
  versionsByChapter.set(oldVersion.source.chapterId, [oldVersion]);
  await controller.initialize();
  await controller.continueReading(oldVersion.versionId);
  await controller.refreshSource();
  controller.previewPosition(0, 37);
  expect(await controller.removeWork(target.workId)).toMatchObject({
    removed: true,
    cleanupComplete: true,
  });

  await controller.openWork(target.canonicalUrl);
  controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await controller.checkConnection();
  expect(controller.getSnapshot().catalogStatus).toBe('connected');
  controller.chooseModel('fixture-hymt2');
  expect(controller.getSnapshot().selectedModelId).toBe('fixture-hymt2');
  await controller.selectChapter(target.chapters[0]!);
  expect(controller.getSnapshot().route).toMatchObject({ kind: 'translation' });
  await controller.translate();

  expect(flow.start).toHaveBeenCalledOnce();
  expect(library.savePosition).not.toHaveBeenCalled();
  controller.dispose();
});

it('제거는 이미 시작된 대상 작품 제목·용어집 저장이 끝날 때까지 기다린다', async () => {
  const target = work('n1616oo', '용어집 저장 작품');
  const { library } = libraryHarness([target]);
  let finishSave!: () => void;
  const savePending = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const guidance = {
    read: vi.fn(async () => null),
    save: vi.fn(async (workId: string, draft: { terms: []; voices: [] }) => {
      await savePending;
      return { workId, ...draft, updatedAt: '2026-10-08T00:00:00Z' };
    }),
  } as unknown as NonNullable<RenewalDependencies['guidance']>;
  const controller = createRenewalController({ library, guidance });
  await controller.openLibraryWork(target.workId);
  const saving = controller.saveGuidance(target.workId, { terms: [], voices: [] });
  await waitFor(() => expect(guidance.save).toHaveBeenCalledOnce());
  let removalSettled = false;
  const removing = controller.removeWork(target.workId).then((result) => {
    removalSettled = true;
    return result;
  });
  await Promise.resolve();
  expect(removalSettled).toBe(false);
  expect(library.removeWork).not.toHaveBeenCalled();
  finishSave();
  await saving;

  expect(await removing).toMatchObject({ removed: true, cleanupComplete: true });
  expect(library.removeWork).toHaveBeenCalledOnce();
  controller.dispose();
});

it('작품 제목 저장 중에는 대상 제거가 저장 완료를 기다린다', async () => {
  const target = work('n1717pp', '제목 저장 작품');
  const { library } = libraryHarness([target]);
  let finishSave!: () => void;
  const savePending = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const titles = {
    read: vi.fn(async () => []),
    readAttempts: vi.fn(async () => []),
    recordAttempt: vi.fn(async () => {}),
    save: vi.fn(
      async (
        _workId: string,
        entries: readonly {
          key: string;
          source: string;
          target: string;
          origin: 'user';
          updatedAt: string;
        }[],
      ) => {
        await savePending;
        return entries;
      },
    ),
  } as unknown as NonNullable<RenewalDependencies['titles']>;
  const controller = createRenewalController({ library, titles });
  await controller.openLibraryWork(target.workId);
  const saving = controller.saveTitle(target.chapters[0]!.chapterId, '저장 제목');
  await waitFor(() => expect(titles.save).toHaveBeenCalledOnce());
  const removing = controller.removeWork(target.workId);
  await Promise.resolve();
  expect(library.removeWork).not.toHaveBeenCalled();
  finishSave();
  await saving;

  expect(await removing).toMatchObject({ removed: true, cleanupComplete: true });
  expect(library.removeWork).toHaveBeenCalledOnce();
  controller.dispose();
});

it('제목 저장 writer가 실패해도 settle한 뒤 작품 제거를 계속한다', async () => {
  const target = work('n1727pp', '실패한 제목 저장 작품');
  const { library } = libraryHarness([target]);
  const titles = {
    read: vi.fn(async () => []),
    readAttempts: vi.fn(async () => []),
    recordAttempt: vi.fn(async () => {}),
    save: vi.fn(async () => {
      throw new Error('synthetic title I/O failure');
    }),
  } as unknown as NonNullable<RenewalDependencies['titles']>;
  const controller = createRenewalController({ library, titles });
  await controller.openLibraryWork(target.workId);
  const saving = controller.saveTitle(target.chapters[0]!.chapterId, '저장 실패 제목');
  const saveFailed = saving.then(
    () => false,
    () => true,
  );
  await waitFor(() => expect(titles.save).toHaveBeenCalledOnce());

  const removal = controller.removeWork(target.workId);

  expect(await saveFailed).toBe(true);
  await expect(removal).resolves.toMatchObject({ removed: true, cleanupComplete: true });
  expect(library.removeWork).toHaveBeenCalledOnce();
  expect(controller.getSnapshot().libraryWorks).toEqual([]);
  controller.dispose();
});

it('제거 호출이 예기치 않게 reject되면 안내하고 busy를 풀어 재시도할 수 있다', async () => {
  const target = work('n1737pp', '재시도 가능한 제거 작품');
  const { library } = libraryHarness([target]);
  const controller = createRenewalController({ library });
  const removeWork = vi
    .spyOn(controller, 'removeWork')
    .mockRejectedValueOnce(new Error('unexpected removal rejection'))
    .mockResolvedValueOnce({ removed: true, cleanupComplete: true, remainingInventory: [] });
  render(<Application controller={controller} />);
  await screen.findByText(target.title, { selector: '.nr-list-item__headline' });
  fireEvent.click(screen.getByRole('button', { name: `${target.title} 메뉴` }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '제거 여부를 확인하지 못했어요. 앱을 완전히 종료한 뒤 다시 열어 확인해 주세요.',
  );
  expect(screen.getByRole('button', { name: '제거하기' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

  await waitFor(() => expect(removeWork).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('dialog')).toBeNull();
  controller.dispose();
});

it('읽기 위치 저장이 진행 중이면 제거가 저장 writer를 기다린다', async () => {
  const target = work('n1818qq', '위치 저장 작품');
  const saved = savedVersion(target);
  const { library, versions } = libraryHarness([target]);
  versions.set(saved.source.chapterId, [saved]);
  let finishSave!: () => void;
  const savePending = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  library.savePosition.mockImplementation(async () => savePending);
  const controller = createRenewalController({ library });
  await controller.continueReading(saved.versionId);
  const saving = controller.savePosition(saved.blocks[0]!.id, 12);
  await waitFor(() => expect(library.savePosition).toHaveBeenCalledOnce());
  const removing = controller.removeWork(target.workId);
  await Promise.resolve();
  expect(library.removeWork).not.toHaveBeenCalled();
  finishSave();
  await saving;

  expect(await removing).toMatchObject({ removed: true, cleanupComplete: true });
  expect(library.removeWork).toHaveBeenCalledOnce();
  controller.dispose();
});

it('목차 appbar 제거에서 부분 정리 결과를 목록 제거와 별도로 알린다', async () => {
  const target = work('n2828aa', '부분 정리 작품');
  const { library } = libraryHarness([target]);
  library.removeWork.mockResolvedValue({
    removed: true,
    cleanupComplete: false,
    remainingInventory: ['versions/saved-partial.0.json'],
  });
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);
  await controller.openLibraryWork(target.workId);
  await screen.findByRole('heading', { name: target.title });
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

  expect(
    await screen.findByRole('dialog', { name: '일부 데이터를 정리하지 못했어요' }),
  ).toHaveTextContent('서재 목록에서는 제거했지만 저장 데이터 정리를 끝내지 못했어요.');
  expect(controller.getSnapshot().route.kind).toBe('home');
  expect(controller.getSnapshot().libraryWorks).toEqual([]);
  controller.dispose();
});

it('제거 여부가 불명확하면 목차에서 머물며 확인 실패를 대화상자에 알린다', async () => {
  const target = work('n2929bb', '결과 불명 작품');
  const { library } = libraryHarness([target]);
  library.removeWork.mockResolvedValue({
    removed: null,
    cleanupComplete: false,
    remainingInventory: ['library/index'],
  });
  const controller = createRenewalController({ library });
  render(<Application controller={controller} />);
  await controller.openLibraryWork(target.workId);
  await screen.findByRole('heading', { name: target.title });
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '서재에서 제거하기' }));
  fireEvent.click(screen.getByRole('button', { name: '제거하기' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '제거 여부를 확인하지 못했어요. 앱을 완전히 종료한 뒤 다시 열어 확인해 주세요.',
  );
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(controller.getSnapshot().route).toEqual({ kind: 'work', workId: target.workId });
  controller.dispose();
});
