import type { WorkPage } from '../../src/contracts/reading';

export function toc(workId = 'n1234aa', ordinals = [1], pageNumber = 1, next = false): WorkPage {
  const canonicalUrl = `https://ncode.syosetu.com/${workId}/`;
  return {
    workId,
    canonicalUrl,
    pageUrl: canonicalUrl + (pageNumber > 1 ? `?p=${pageNumber}` : ''),
    title: `${workId} 작품`,
    complete: pageNumber === 1 && !next,
    nextPageUrl: next ? `${canonicalUrl}?p=${pageNumber + 1}` : null,
    chapters: ordinals.map((ordinal) => ({
      workId,
      chapterId: `${workId}/${ordinal}`,
      ordinal,
      canonicalUrl: `${canonicalUrl}${ordinal}/`,
      title: `${ordinal}화`,
    })),
  };
}

/** 1화는 오래된 회차, 이후 회차는 한 시간 전에 등록된 합성 목차. */
export function recentToc(...args: Parameters<typeof toc>): WorkPage {
  const page = toc(...args);
  const publishedAt = new Date(
    Math.floor(Date.now() / 3_600_000) * 3_600_000 - 3_600_000,
  ).toISOString();
  return {
    ...page,
    chapters: page.chapters.map((chapter) =>
      chapter.ordinal === 1 ? chapter : { ...chapter, publishedAt },
    ),
  };
}
