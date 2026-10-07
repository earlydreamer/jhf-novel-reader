import { expect, it, vi } from 'vitest';
import { createRenewalController } from '../../src/app/renewalController';
import type { CompletedTranslation, WorkPage } from '../../src/contracts/reading';

const chapters = [1, 2, 3].map((ordinal) => ({
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
function version(index: number): CompletedTranslation {
  const chapter = chapters[index]!;
  return {
    schemaVersion: 2,
    versionId: `saved-${index + 1}`,
    source: {
      ...chapter,
      sourceHash: `hash-${index}`,
      paragraphs: [{ id: `source-${index}`, text: '原文', ruby: [] }],
      prevUrl: null,
      nextUrl: null,
      captureKind: 'fetched',
      fetchedAt: '2026-10-04T00:00:00Z',
      rawHtml: '<p>原文</p>',
    },
    text: '저장된 한국어 본문',
    blocks: [{ id: `translated-${index}`, text: '저장된 한국어 본문' }],
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
}
const versions = chapters.map((_, index) => version(index));
// 다른 작품의 회차: 작품이 달라지는 이동은 스택에 쌓여야 한다.
const otherPage: WorkPage = {
  ...page,
  workId: 'n5678cd',
  canonicalUrl: 'https://ncode.syosetu.com/n5678cd/',
  title: '다른 작품',
  chapters: [
    {
      workId: 'n5678cd',
      chapterId: 'n5678cd/1',
      canonicalUrl: 'https://ncode.syosetu.com/n5678cd/1/',
      title: '1화 제목',
      ordinal: 1,
    },
  ],
  pageUrl: 'https://ncode.syosetu.com/n5678cd/',
};

function controller() {
  const app = createRenewalController({
    library: {
      saveWorkPage: vi.fn(async () => {}),
      readWork: vi.fn(async () => [page]),
      listRecent: vi.fn(async () => []),
      listVersions: vi.fn(async (chapterId: string) =>
        versions.filter((value) => value.source.chapterId === chapterId),
      ),
      readVersion: vi.fn(async (id: string) => versions.find((v) => v.versionId === id) ?? null),
      commitVersion: vi.fn(async () => {}),
      savePosition: vi.fn(async () => {}),
      readPosition: vi.fn(async () => null),
    } as never,
    source: {
      getWorkPage: async (url: string) => (url === otherPage.canonicalUrl ? otherPage : page),
      getChapter: async () => versions[0]!.source,
    } as never,
  });
  app.changeAutoTranslate(false);
  return app;
}

it('moving between chapters replaces the top entry so back returns to the contents', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[0]!);
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.adjacentChapter(1);
  await vi.waitFor(() =>
    expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-2' }),
  );
  app.adjacentChapter(1);
  await vi.waitFor(() =>
    expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-3' }),
  );
  app.back();
  expect(app.getSnapshot().route.kind).toBe('work');
  app.back();
  expect(app.getSnapshot().route.kind).toBe('home');
  expect(app.canGoBack()).toBe(false);
  app.dispose();
});

it('moving to a chapter of another work pushes so back returns to the reader', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.openWork(otherPage.canonicalUrl);
  app.back();
  await app.selectChapter(chapters[0]!);
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.navigate({ kind: 'translation', chapterId: 'n5678cd/1' });
  expect(app.getSnapshot().route).toEqual({ kind: 'translation', chapterId: 'n5678cd/1' });
  app.back();
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.dispose();
});

it('contents returns to the existing contents entry instead of stacking another one', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[1]!);
  app.showContents();
  expect(app.getSnapshot().route).toEqual({
    kind: 'work',
    workId: 'n1234ab',
    selectedChapterId: 'n1234ab/2',
  });
  app.back();
  expect(app.getSnapshot().route.kind).toBe('home');
  app.dispose();
});

it('contents pushes a contents entry when the reader was opened from home', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  app.navigate({ kind: 'home' });
  await app.selectChapter(chapters[0]!);
  app.showContents();
  expect(app.getSnapshot().route.kind).toBe('work');
  app.back();
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.dispose();
});

it('goHome clears the stack', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[0]!);
  expect(app.canGoBack()).toBe(true);
  app.goHome();
  expect(app.getSnapshot().route).toEqual({ kind: 'home' });
  expect(app.canGoBack()).toBe(false);
  app.dispose();
});

it('settings opened from a chapter returns to that chapter', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[0]!);
  app.navigate({ kind: 'settings' });
  app.back();
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.dispose();
});
