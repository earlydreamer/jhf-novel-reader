// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { ChapterRef, CompletedTranslation, WorkPage } from '../../src/contracts/reading';
import { createBatchTranslation } from '../../src/translation/batch';

afterEach(cleanup);

const chapters: ChapterRef[] = [1, 2].map((ordinal) => ({
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
const version: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'saved-1',
  source: {
    ...chapters[0]!,
    sourceHash: 'hash-0',
    paragraphs: [{ id: 'source-0', text: '原文', ruby: [] }],
    prevUrl: null,
    nextUrl: null,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>原文</p>',
  },
  text: '저장된 한국어 본문',
  blocks: [{ id: 'translated-0', text: '저장된 한국어 본문' }],
  createdAt: '2026-10-04T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'connection',
    modelId: 'fixture',
    contractVersion: 'plain-v1',
    promptVersion: 'fixture',
    languageDirection: 'ja-ko',
  },
};

const GUIDE = '연결 설정에서 서버와 모델을 확인하면 번역 대상을 준비할 수 있어요.';

it('앱을 켠 직후(연결 확인 전, 모델 선택됨)에는 미리 번역 연결 안내 없이 범위 확인이 열려 있다', async () => {
  const library = {
    saveWorkPage: vi.fn(async () => {}),
    listWorkIds: vi.fn(async () => [page.workId]),
    readWork: vi.fn(async () => [page]),
    listRecent: vi.fn(async () => []),
    listVersions: vi.fn(async () => []),
    readVersion: vi.fn(async () => version),
    commitVersion: vi.fn(async () => {}),
    savePosition: vi.fn(async () => {}),
    readPosition: vi.fn(async () => null),
    removeWork: vi.fn(async () => ({
      removed: false,
      cleanupComplete: false,
      remainingInventory: [],
    })),
  };
  const batch = createBatchTranslation({
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    library: library as never,
    flow: {
      active: false,
      getSnapshot: () => ({ pendingSave: null }),
      getUnfinished: () => [],
      getCompleted: () => undefined,
      subscribe: () => () => {},
      cancel() {},
      dispose() {},
      start: vi.fn(),
      retrySave: vi.fn(),
    } as never,
    repository: { read: async () => null, write: async () => {} } as never,
  });
  const app = createRenewalController({
    library: library as never,
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    batch,
    connect: async () => ({
      listModels: async () => [
        { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
      ],
      translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
    }),
    settings: {
      readReadingSettings: async () => ({
        schemaVersion: 2,
        selection: {
          connection: {
            provider: 'openai-compatible',
            baseUrl: 'http://localhost:1234',
            revision: 1,
          },
          modelId: 'local',
        },
        fontSize: 18,
      }),
      saveReadingSettings: async () => {},
    } as never,
  } as never);
  await app.initialize();
  await app.openWork(page.canonicalUrl);
  expect(app.getSnapshot()).toMatchObject({ catalogStatus: 'idle', selectedModelId: 'local' });

  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '미리 번역하기' }));
  expect(screen.queryByText(GUIDE)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '범위 확인' })).toBeEnabled();
  app.dispose();
});
