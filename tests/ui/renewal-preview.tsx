import { createRoot } from 'react-dom/client';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { CompletedTranslation, WorkPage, WorkUpdate } from '../../src/contracts/reading';
import { chapterCheckDate } from '../../src/app/chapterUpdateSchedule';
import { createReadingSettingsRepository } from '../../src/storage/settings';
import { noopShell } from '../../src/platform/shell';
const chapters = [1, 2].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
  ...(ordinal === 2 ? { publishedAt: new Date(Date.now() - 3_600_000).toISOString() } : {}),
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

let update: WorkUpdate = {
  workId: page.workId,
  lastCheckDate: chapterCheckDate(Date.now()),
  attemptedAt: Date.now(),
  checkedAt: Date.now(),
  knownChapterIds: chapters.map((chapter) => chapter.chapterId),
  newChapterIds: [chapters[1]!.chapterId],
  failed: false,
};
let settings: string | null = null;
const controller = createRenewalController({
  settings: createReadingSettingsRepository({
    get: async () => ({ value: settings }),
    set: async ({ value }) => {
      settings = value;
    },
  }),
  source: { getWorkPage: async () => page, getChapter: async () => saved.source },
  library: {
    readWorkUpdates: async () => [structuredClone(update)],
    saveWorkUpdate: async (value) => {
      update = structuredClone(value);
    },
    saveWorkPage: async () => {},
    listWorkIds: async () => [page.workId],
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
if (root) createRoot(root).render(<Application controller={controller} platform={noopShell} />);
