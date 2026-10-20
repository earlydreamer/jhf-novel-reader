// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { ChapterRef, WorkPage } from '../../src/contracts/reading';
import { createLibraryStore } from '../../src/storage/library';
import { recentToc } from '../fixtures/chapterUpdates';

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

it('전체 검사 캐시가 있어도 첫 페이지만 열고 다음 페이지는 재요청 없이 펼친다', async () => {
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
    expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(400),
  );
  expect(getWorkPage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '다음 목차 페이지 불러오기' }));
  await waitFor(() =>
    expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(405),
  );
  expect(controller.getSnapshot().workViewport).toMatchObject({
    complete: true,
    nextPageUrl: null,
  });
  expect(getWorkPage).not.toHaveBeenCalled();
  await act(async () => {
    controller.back();
    await controller.openLibraryWork('n1234aa');
  });
  expect(document.querySelectorAll('.nr-work-chapters > li')).toHaveLength(200);
  expect(getWorkPage).not.toHaveBeenCalled();
  controller.dispose();
});
