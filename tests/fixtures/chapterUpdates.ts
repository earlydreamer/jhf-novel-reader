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
