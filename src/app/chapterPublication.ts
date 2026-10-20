import type { WorkPage } from '../contracts/reading';

export const NEW_CHAPTER_WINDOW_MS = 48 * 60 * 60 * 1000;

export function recentChapterIds(pages: readonly WorkPage[], now: number): string[] {
  return pages.flatMap((page) =>
    page.chapters
      .filter((chapter) => {
        const published = Date.parse(chapter.publishedAt ?? '');
        const age = now - published;
        return Number.isFinite(published) && age >= 0 && age <= NEW_CHAPTER_WINDOW_MS;
      })
      .map((chapter) => chapter.chapterId),
  );
}

export function nextChapterBadgeExpiry(pages: readonly WorkPage[], now: number): number {
  let next = Infinity;
  for (const page of pages)
    for (const chapter of page.chapters) {
      const published = Date.parse(chapter.publishedAt ?? '');
      if (published <= now && published + NEW_CHAPTER_WINDOW_MS >= now)
        next = Math.min(next, published + NEW_CHAPTER_WINDOW_MS + 1);
    }
  return next;
}
