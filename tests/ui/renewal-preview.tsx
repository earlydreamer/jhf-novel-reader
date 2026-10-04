import { createRoot } from 'react-dom/client';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { CompletedTranslation, WorkPage } from '../../src/contracts/reading';
const chapters = [1, 2].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
}));
const page: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters,
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};
const saved: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'saved-v1',
  source: {
    ...chapters[0]!,
    sourceHash: 'hash',
    paragraphs: [{ id: 'source-1', text: '原文', ruby: [] }],
    prevUrl: null,
    nextUrl: chapters[1]!.canonicalUrl,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>原文</p>',
  },
  text: '저장된 한국어 본문',
  blocks: [{ id: 'translated-1', text: '저장된 한국어 본문' }],
  createdAt: '2026-10-04T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'connection',
    modelId: 'fixture-hymt2',
    contractVersion: 'plain-v1',
    promptVersion: 'hymt2-ko-v1',
    languageDirection: 'ja-ko',
  },
};

const controller = createRenewalController({
  source: { getWorkPage: async () => page, getChapter: async () => saved.source },
  library: {
    saveWorkPage: async () => {},
    readWork: async () => [page],
    listRecent: async () => [
      {
        workId: saved.source.workId,
        chapterId: saved.source.chapterId,
        versionId: saved.versionId,
        updatedAt: saved.createdAt,
      },
    ],
    listVersions: async (chapterId) => (chapterId === saved.source.chapterId ? [saved] : []),
    readVersion: async (versionId) => (versionId === saved.versionId ? saved : null),
    commitVersion: async () => {
      throw new Error('Synthetic preview does not translate');
    },
    savePosition: async () => {},
    readPosition: async () => null,
  },
  connect: async () => ({
    listModels: async () => [
      { id: 'fixture-hymt2', displayName: 'HyMT2 synthetic', supportsGeneration: true },
    ],
    translateChapter: async () => {
      throw new Error('Synthetic preview does not translate');
    },
  }),
});
const root = document.getElementById('root');
if (root) createRoot(root).render(<Application controller={controller} />);
