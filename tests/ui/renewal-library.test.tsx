// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type { CompletedTranslation, WorkPage } from '../../src/contracts/reading';
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
