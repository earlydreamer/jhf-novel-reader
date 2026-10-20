// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { ChapterRef, WorkPage } from '../../src/contracts/reading';
import { createLibraryStore } from '../../src/storage/library';
import { recentToc } from '../fixtures/chapterUpdates';
import { source as sourceFixture } from '../providers/wholeChapterFixture';
import { chapterCheckDate } from '../../src/app/chapterUpdateSchedule';

function chapter(ordinal: number): ChapterRef {
  return {
    workId: 'n1234ab',
    chapterId: `n1234ab/${ordinal}`,
    canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
    ordinal,
    title: `${ordinal}화 제목`,
  };
}

const firstPage: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters: [chapter(1), chapter(2)],
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
  complete: false,
};

const secondPage: WorkPage = {
  ...firstPage,
  chapters: [chapter(2), chapter(3)],
  pageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
  nextPageUrl: null,
  complete: true,
};

afterEach(cleanup);

it('최근 읽은 250화를 포함한 페이지만 처음 열고 갱신과 앞뒤 이동이 선택 페이지를 보존한다', async () => {
  const memory = new Map<string, string>();
  const library = createLibraryStore({
    read: async (path) => memory.get(path) ?? null,
    write: async (path, text) => {
      memory.set(path, text);
    },
  });
  const pages = [
    recentToc(
      'n1234ab',
      Array.from({ length: 100 }, (_, i) => i + 1),
      1,
      true,
    ),
    recentToc(
      'n1234ab',
      Array.from({ length: 100 }, (_, i) => i + 101),
      2,
      true,
    ),
    recentToc(
      'n1234ab',
      Array.from({ length: 100 }, (_, i) => i + 201),
      3,
      true,
    ),
    recentToc('n1234ab', [301, 302], 4),
  ];
  for (const page of pages) await library.saveWorkPage(page);
  await library.saveWorkUpdate!({
    workId: 'n1234ab',
    lastCheckDate: chapterCheckDate(Date.now()),
    attemptedAt: Date.now(),
    checkedAt: Date.now(),
    knownChapterIds: pages.flatMap((page) => page.chapters.map((chapter) => chapter.chapterId)),
    newChapterIds: [],
    failed: false,
  });
  await library.commitVersion({
    schemaVersion: 2,
    versionId: 'recent-page',
    source: {
      ...sourceFixture,
      chapterId: 'n1234ab/250',
      canonicalUrl: 'https://ncode.syosetu.com/n1234ab/250/',
    },
    text: '합성 번역',
    blocks: [{ id: 'b1', text: '합성 번역' }],
    createdAt: '2026-10-20T00:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'fixture',
      modelId: 'fixture',
      contractVersion: 'plain-v1',
      promptVersion: 'fixture-v1',
      languageDirection: 'ja-ko',
    },
  });
  await library.savePosition({
    workId: 'n1234ab',
    chapterId: 'n1234ab/250',
    versionId: 'recent-page',
    blockId: 'b1',
    offset: 0,
  });
  const getWorkPage = vi.fn(async (url: string) => pages.find((page) => page.pageUrl === url)!);
  const scroll = vi.fn();
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  const controller = createRenewalController({
    library,
    source: { getWorkPage, getChapter: vi.fn() },
  });
  try {
    await controller.initialize();
    render(<Application controller={controller} />);
    await act(async () => {
      await controller.openLibraryWork('n1234ab');
    });
    await waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('verified'));
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(201);
    expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(100);
    expect(screen.getByText('전체 302화 · 1화 저장됨')).toBeInTheDocument();
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(getWorkPage).not.toHaveBeenCalled();
    await act(async () => {
      await controller.loadPreviousWorkPage();
    });
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(101);
    await act(async () => {
      await controller.checkChapterUpdates('n1234ab');
    });
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(101);
    expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(100);
    getWorkPage.mockClear();
    await act(async () => {
      await controller.loadMoreWorkPage();
    });
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(201);
    await act(async () => {
      controller.back();
      await controller.openLibraryWork('n1234ab');
    });
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(201);
    expect(getWorkPage).not.toHaveBeenCalled();
  } finally {
    controller.dispose();
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

it('loads another TOC page and navigates chapters across its boundary', async () => {
  const getWorkPage = vi.fn(async (url: string) =>
    url === firstPage.pageUrl ? firstPage : secondPage,
  );
  const controller = createRenewalController({
    source: { getWorkPage, getChapter: vi.fn() },
    library: {
      saveWorkPage: vi.fn(async () => {}),
      listWorkIds: vi.fn(async () => [firstPage.workId]),
      readWork: vi.fn(async () => [firstPage]),
      listRecent: vi.fn(async () => []),
      listVersions: vi.fn(async () => []),
      readVersion: vi.fn(async () => null),
      commitVersion: vi.fn(async () => {}),
      savePosition: vi.fn(async () => {}),
      readPosition: vi.fn(async () => null),
    },
  });

  render(<Application controller={controller} />);
  await controller.openWork(firstPage.pageUrl);

  fireEvent.click(screen.getByRole('button', { name: '다음 목차 페이지 불러오기' }));
  await waitFor(() => expect(controller.getSnapshot().work?.chapters).toHaveLength(3));

  expect(controller.getSnapshot().work).toMatchObject({
    nextPageUrl: null,
    complete: true,
  });
  expect(controller.getSnapshot().work?.chapters.map((value) => value.ordinal)).toEqual([1, 2, 3]);
  expect(getWorkPage).toHaveBeenCalledWith(secondPage.pageUrl, expect.any(AbortSignal));

  await controller.selectChapter(chapter(2));
  controller.adjacentChapter(1);
  await waitFor(() =>
    expect(controller.getSnapshot().chapter?.chapterId).toBe(chapter(3).chapterId),
  );

  controller.adjacentChapter(-1);
  await waitFor(() =>
    expect(controller.getSnapshot().chapter?.chapterId).toBe(chapter(2).chapterId),
  );

  controller.back();
  expect(controller.getSnapshot().work?.chapters.map((value) => value.chapterId)).toEqual([
    chapter(1).chapterId,
    chapter(2).chapterId,
    chapter(3).chapterId,
  ]);
});

it('읽기 기록이 없으면 첫 페이지를 열고 앞뒤 이동에서도 한 페이지만 표시하며 캐시를 재사용한다', async () => {
  const memory = new Map<string, string>();
  const library = createLibraryStore({
    read: async (path) => memory.get(path) ?? null,
    write: async (path, text) => {
      memory.set(path, text);
    },
  });
  const pages = [
    recentToc(
      'n1234aa',
      Array.from({ length: 200 }, (_, i) => i + 1),
      1,
      true,
    ),
    recentToc(
      'n1234aa',
      Array.from({ length: 200 }, (_, i) => i + 201),
      2,
      true,
    ),
    recentToc('n1234aa', [401, 402, 403, 404, 405], 3),
  ];
  await library.saveWorkPage(pages[0]!);
  const getWorkPage = vi.fn(async (url: string) => pages.find((page) => page.pageUrl === url)!);
  const versions = vi.spyOn(library, 'listVersions');
  const savedIds = vi.spyOn(library, 'listSavedChapterIds');
  const controller = createRenewalController({
    library,
    source: { getWorkPage, getChapter: vi.fn() },
  });
  await controller.initialize();
  await controller.checkChapterUpdates();
  expect((await library.readWork('n1234aa')).flatMap((page) => page.chapters)).toHaveLength(405);
  render(<Application controller={controller} />);
  versions.mockClear();
  savedIds.mockClear();
  getWorkPage.mockClear();
  await act(async () => {
    await controller.openLibraryWork('n1234aa');
  });
  expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200);
  expect(screen.getByText('전체 405화 · 0화 저장됨')).toBeInTheDocument();
  expect(screen.queryByText(/화까지 확인했어요/)).toBeNull();
  expect(versions).not.toHaveBeenCalled();
  expect(savedIds).toHaveBeenCalledExactlyOnceWith(
    'n1234aa',
    pages[0]!.chapters.map((chapter) => chapter.chapterId),
  );
  expect(controller.getSnapshot().workViewport).toMatchObject({
    complete: false,
    nextPageUrl: pages[1]!.pageUrl,
  });

  // 화면을 열어 둔 상태의 전체 검사도 펼친 범위를 늘리지 않는다.
  await act(async () => {
    await controller.checkChapterUpdates('n1234aa');
  });
  expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200);
  expect(controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toHaveLength(404);
  getWorkPage.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '다음 목차 페이지 불러오기' }));
  await waitFor(() =>
    expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200),
  );
  await waitFor(() =>
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(201),
  );
  expect(getWorkPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '다음 목차 페이지 불러오기' }));
  await waitFor(() => expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(5));
  expect(controller.getSnapshot().workViewport).toMatchObject({
    complete: true,
    nextPageUrl: null,
  });
  expect(getWorkPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '이전 목차 페이지 불러오기' }));
  await waitFor(() =>
    expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(201),
  );
  expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200);
  fireEvent.click(screen.getByRole('button', { name: '이전 목차 페이지 불러오기' }));
  await waitFor(() => expect(controller.getSnapshot().workViewport?.chapters[0]?.ordinal).toBe(1));
  expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200);
  expect(getWorkPage).not.toHaveBeenCalled();
  await act(async () => {
    controller.back();
    await controller.openLibraryWork('n1234aa');
  });
  expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200);
  expect(getWorkPage).not.toHaveBeenCalled();
  controller.dispose();
});
