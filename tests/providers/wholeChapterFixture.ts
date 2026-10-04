import type { SourceSnapshot } from '../../src/contracts';
export const source: SourceSnapshot = {
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
  workId: 'n1234ab',
  chapterId: 'n1234ab/1',
  title: 'chapter',
  prevUrl: null,
  nextUrl: null,
  sourceHash: 'hash',
  paragraphs: [
    { id: 'p1', text: '基底\r\n一', ruby: [{ start: 0, end: 2, reading: 'よみ' }] },
    { id: 'p2', text: '', ruby: [] },
    { id: 'p3', text: '二', ruby: [] },
  ],
  captureKind: 'fetched',
  rawHtml: '<p>原文</p>',
  fetchedAt: '2026-10-04T00:00:00Z',
};
