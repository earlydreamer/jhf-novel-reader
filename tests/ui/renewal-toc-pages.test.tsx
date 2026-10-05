// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { ChapterRef, WorkPage } from '../../src/contracts/reading';

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
      readWork: vi.fn(async () => [firstPage, secondPage]),
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
