// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import * as controllers from '../../src/app/controller';
import type { RenewalDependencies } from '../../src/app/renewalController';
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
function fixture(hasSaved = false) {
  const generate = vi.fn(async () => ({ text: '새 한국어', finishReason: 'complete' as const }));
  const dependencies: RenewalDependencies = {
    library: {
      saveWorkPage: vi.fn(async () => {}),
      readWork: vi.fn(async () => [page]),
      listRecent: vi.fn(async () => []),
      listVersions: vi.fn(async (chapterId) =>
        hasSaved && chapterId === saved.source.chapterId ? [saved] : [],
      ),
      readVersion: vi.fn(async (id) => (id === saved.versionId ? saved : null)),
      commitVersion: vi.fn(async () => {}),
      savePosition: vi.fn(async () => {}),
      readPosition: vi.fn(async () => null),
    },
    source: { getWorkPage: vi.fn(async () => page), getChapter: vi.fn(async () => saved.source) },
    connect: vi.fn(async () => ({
      listModels: vi.fn(async () => [
        { id: 'fixture-hymt2', displayName: 'HyMT2 synthetic', supportsGeneration: true },
      ]),
      translateChapter: generate,
    })),
  };
  return { dependencies, generate };
}
async function setup(hasSaved = false, translationAvailable = false) {
  expect(controllers).toHaveProperty('createRenewalController');
  const value = fixture(hasSaved);
  if (translationAvailable) {
    Object.assign(value.dependencies, {
      startTranslation: async (
        chapter: Parameters<NonNullable<RenewalDependencies['startTranslation']>>[0],
        model: Parameters<NonNullable<RenewalDependencies['startTranslation']>>[1],
        session: Parameters<NonNullable<RenewalDependencies['startTranslation']>>[2],
      ) => {
        await session.translateChapter(
          {
            token: {
              requestId: 'fixture-request',
              chapterId: chapter.chapterId,
              settingsRevision: model.connection.revision,
            },
            source: saved.source,
            languageDirection: 'ja-ko',
            contractVersion: 'plain-v1',
            promptVersion: 'hymt2-ko-v1',
          },
          new AbortController().signal,
        );
      },
    });
  }
  const controller = controllers.createRenewalController(value.dependencies);
  render(<Application controller={controller} />);
  await screen.findByRole('heading', { name: '이어 읽기' });
  fireEvent.change(screen.getByLabelText('작품 또는 회차 URL'), {
    target: { value: page.canonicalUrl },
  });
  fireEvent.click(screen.getByRole('button', { name: '작품 열기' }));
  await screen.findByRole('heading', { name: page.title });
  return { ...value, controller };
}
afterEach(cleanup);
describe('renewal first reading screens', () => {
  it('open_work_does_not_translate', async () => {
    const value = await setup();
    expect(value.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByRole('heading', { name: '1화 제목' });
    expect(value.generate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '이 화 번역' })).toBeDisabled();
  });
  it('saved_chapter_opens_without_settings', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    expect(value.dependencies.connect).not.toHaveBeenCalled();
    expect(value.generate).not.toHaveBeenCalled();
  });
  it('settings_returns_to_selected_chapter', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: '2화 제목' }));
    await screen.findByRole('heading', { name: '2화 제목' });
    fireEvent.click(screen.getByRole('button', { name: '연결 설정' }));
    await screen.findByRole('heading', { name: '연결 설정' });
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByRole('heading', { name: '2화 제목' })).toBeVisible();
  });
  it('reader_has_no_settings_panel', async () => {
    await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    expect(screen.queryByLabelText('API 기본 주소')).toBeNull();
    expect(screen.getByRole('button', { name: '목차' })).toBeVisible();
  });
  it('no_budget_or_prefetch_controls', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.queryByText(/예산|미리 번역/)).toBeNull();
    expect(screen.queryByLabelText('모델 이름')).toBeNull();
    expect(screen.getByLabelText('모델 선택')).toHaveValue('');
  });
  it('uses_real_catalog_selection_and_explicit_translation_action', async () => {
    const value = await setup(false, true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByRole('heading', { name: '1화 제목' });
    fireEvent.click(screen.getByRole('button', { name: '연결 설정' }));
    fireEvent.change(screen.getByLabelText('API 기본 주소'), {
      target: { value: 'http://192.168.1.2:1234/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인' }));
    await screen.findByRole('option', { name: 'HyMT2 synthetic' });
    fireEvent.change(screen.getByLabelText('모델 선택'), { target: { value: 'fixture-hymt2' } });
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    fireEvent.click(screen.getByRole('button', { name: '이 화 번역' }));
    await waitFor(() => expect(value.generate).toHaveBeenCalledTimes(1));
  });
});

describe('renewal controller boundaries', () => {
  it('ignores model list responses from a superseded endpoint', async () => {
    const value = fixture();
    let release:
      | ((
          value: readonly { id: string; displayName: string; supportsGeneration: boolean }[],
        ) => void)
      | undefined;
    const listing = new Promise<
      readonly { id: string; displayName: string; supportsGeneration: boolean }[]
    >((resolve) => {
      release = resolve;
    });
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      connect: async () => ({ listModels: async () => listing, translateChapter: value.generate }),
    });
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    const pending = controller.checkConnection();
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.3:1234/v1',
    });
    release?.([{ id: 'stale', displayName: 'Stale', supportsGeneration: true }]);
    await pending;
    expect(controller.getSnapshot().models).toEqual([]);
    expect(controller.getSnapshot().selectedModelId).toBeNull();
  });
  it('does not replace a missing selected model on catalog refresh', async () => {
    const value = fixture();
    let models = [{ id: 'first', displayName: 'First', supportsGeneration: true }];
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      connect: async () => ({ listModels: async () => models, translateChapter: value.generate }),
    });
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection();
    controller.chooseModel('first');
    models = [{ id: 'different', displayName: 'Different', supportsGeneration: true }];
    await controller.checkConnection();
    expect(controller.getSnapshot().selectedModelId).toBeNull();
    expect(controller.getSnapshot().catalogStatus).toBe('model_missing');
  });
  it('navigation prevents a late work response from replacing the current screen', async () => {
    const value = fixture();
    let release: ((value: WorkPage) => void) | undefined;
    const loading = new Promise<WorkPage>((resolve) => {
      release = resolve;
    });
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      source: { getWorkPage: async () => loading, getChapter: async () => saved.source },
    });
    const pending = controller.openWork(page.canonicalUrl);
    controller.navigate({ kind: 'settings' });
    release?.(page);
    await pending;
    expect(controller.getSnapshot().route).toEqual({ kind: 'settings' });
    expect(controller.getSnapshot().busy).toBe(false);
  });
  it('same chapter selection repeated while loading pushes one route', async () => {
    const value = fixture();
    const controller = controllers.createRenewalController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    const first = controller.selectChapter(chapters[0]!);
    const second = controller.selectChapter(chapters[0]!);
    await Promise.all([first, second]);
    controller.back();
    expect(controller.getSnapshot().route.kind).toBe('work');
  });
  it('production is unavailable rather than fabricated source or catalog data', async () => {
    const controller = controllers.createRenewalController();
    render(<Application controller={controller} />);
    expect(screen.getByRole('button', { name: '작품 열기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('button', { name: '연결 확인' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('아직 사용할 수 없습니다');
    expect(controller.getSnapshot().models).toEqual([]);
  });
});

describe('renewal reading affordances', () => {
  it('shows saved status in the work contents before choosing a chapter', async () => {
    await setup(true);
    expect(screen.getByText('번역 저장됨')).toBeVisible();
  });
  it('reader defaults to 18px and clamps font controls to 10 through 48px', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    const article = await screen.findByRole('article', { name: '번역 본문' });
    expect(article).toHaveStyle({ fontSize: '18px' });
    expect(screen.getByLabelText('글자 크기')).toHaveAttribute('min', '10');
    expect(screen.getByLabelText('글자 크기')).toHaveAttribute('max', '48');
    value.controller.changeFontSize(49);
    expect(value.controller.getSnapshot().fontSize).toBe(18);
    fireEvent.change(screen.getByLabelText('글자 크기'), { target: { value: '24' } });
    expect(article).toHaveStyle({ fontSize: '24px' });
  });
  it('next unsaved chapter enters a waiting screen without a model request', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    fireEvent.click(screen.getByRole('button', { name: '다음 화' }));
    await screen.findByRole('heading', { name: '2화 제목' });
    expect(screen.getByRole('button', { name: '이 화 번역' })).toBeDisabled();
    expect(value.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByText('저장된 한국어 본문')).toBeVisible();
  });
});

describe('renewal connection failures', () => {
  it.each([
    ['auth', 'auth'],
    ['connection', 'connection'],
    ['model_list', 'model_list'],
  ] as const)('distinguishes %s without exposing server errors', async (code, status) => {
    const { ReaderError } = await import('../../src/contracts');
    const value = fixture();
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      connect: async () => {
        throw new ReaderError(code);
      },
    });
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection('secret-not-in-snapshot');
    expect(controller.getSnapshot().catalogStatus).toBe(status);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret-not-in-snapshot');
  });
  it('invalid endpoint is a connection error rather than a model catalog error', async () => {
    const value = fixture();
    const controller = controllers.createRenewalController(value.dependencies);
    controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'not-a-url' });
    await controller.checkConnection();
    expect(controller.getSnapshot().catalogStatus).toBe('connection');
    expect(value.dependencies.connect).not.toHaveBeenCalled();
  });
  it('refreshing a model list prevents translation through the stale session', async () => {
    const value = fixture();
    let release: (() => void) | undefined;
    let calls = 0;
    const start = vi.fn(async () => {});
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      startTranslation: start,
      connect: async () => {
        calls++;
        if (calls > 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return {
          listModels: async () => [{ id: 'model', displayName: 'Model', supportsGeneration: true }],
          translateChapter: value.generate,
        };
      },
    });
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection();
    controller.chooseModel('model');
    const refreshing = controller.checkConnection();
    await controller.translate();
    expect(start).not.toHaveBeenCalled();
    release?.();
    await refreshing;
  });
});

describe('route restoration across works', () => {
  it('restores the original reader contents after visiting another work', async () => {
    const value = fixture(true);
    const otherPage: WorkPage = {
      ...page,
      workId: 'n9999ab',
      title: '다른 작품',
      canonicalUrl: 'https://ncode.syosetu.com/n9999ab/',
      chapters: [],
    };
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      source: {
        getWorkPage: async (url) => (url === otherPage.canonicalUrl ? otherPage : page),
        getChapter: async () => saved.source,
      },
    });
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);
    controller.navigate({ kind: 'home' });
    await controller.openWork(otherPage.canonicalUrl);
    controller.back();
    controller.back();
    expect(controller.getSnapshot().route).toEqual({ kind: 'reader', versionId: saved.versionId });
    expect(controller.getSnapshot().work?.workId).toBe(page.workId);
    expect(controller.getSnapshot().chapter?.chapterId).toBe(saved.source.chapterId);
  });
});

describe('review P1: translation ownership survives navigation', () => {
  function deferredRequest() {
    let resolve: (() => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {
      promise,
      resolve: () => resolve?.(),
      reject: () => reject?.(new Error('Synthetic late failure')),
    };
  }
  async function activeFixture() {
    const value = fixture();
    const request = deferredRequest();
    const start = vi.fn(async () => request.promise);
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      startTranslation: start,
    });
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection();
    controller.chooseModel('fixture-hymt2');
    const pending = controller.translate();
    return { controller, request, pending, start };
  }
  it.each([0, 1])(
    'prevents a second dispatch after selecting chapter index %s while the first request is unresolved',
    async (index) => {
      const value = await activeFixture();
      value.controller.back();
      await value.controller.selectChapter(chapters[index]!);
      const second = value.controller.translate();
      const dispatchCount = value.start.mock.calls.length;
      expect(value.controller.getSnapshot().translationActive).toBe(true);
      value.request.resolve();
      await Promise.all([value.pending, second]);
      expect(dispatchCount).toBe(1);
      expect(value.controller.getSnapshot().translationActive).toBe(false);
    },
  );
  it('ignores a late failure from the previous chapter', async () => {
    const value = await activeFixture();
    value.controller.back();
    await value.controller.selectChapter(chapters[1]!);
    value.request.reject();
    await value.pending;
    expect(value.controller.getSnapshot().chapter?.chapterId).toBe(chapters[1]!.chapterId);
    expect(value.controller.getSnapshot().translation.phase).toBe('idle');
    expect(value.controller.getSnapshot().translation.error).toBeUndefined();
  });
  it('ignores a late failure after settings changed and the chapter was reselected', async () => {
    const value = await activeFixture();
    value.controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.3:1234/v1',
    });
    value.controller.back();
    await value.controller.selectChapter(chapters[0]!);
    value.request.reject();
    await value.pending;
    expect(value.controller.getSnapshot().translation.phase).toBe('idle');
    expect(value.controller.getSnapshot().translation.error).toBeUndefined();
  });
  it('reports a failure for the currently owned request and releases the latch', async () => {
    const value = await activeFixture();
    value.request.reject();
    await value.pending;
    expect(value.controller.getSnapshot().translation.phase).toBe('failed');
    expect(value.controller.getSnapshot().translationActive).toBe(false);
  });
  it('releases the global latch only after settlement so the next explicit action can run', async () => {
    const value = await activeFixture();
    value.controller.back();
    await value.controller.selectChapter(chapters[1]!);
    value.request.resolve();
    await value.pending;
    await value.controller.translate();
    expect(value.start).toHaveBeenCalledTimes(2);
  });
});

describe('review P2: library-only continuation restores saved metadata', () => {
  it('shows the saved marker after cold-start offline continue reading and contents navigation', async () => {
    const value = fixture(true);
    const controller = controllers.createRenewalController({ library: value.dependencies.library });
    render(<Application controller={controller} />);
    await controller.continueReading(saved.versionId);
    await screen.findByText(saved.text);
    fireEvent.click(screen.getByRole('button', { name: '목차' }));
    expect(screen.getByRole('heading', { name: page.title })).toBeVisible();
    expect(screen.getByText('번역 저장됨')).toBeVisible();
    expect(controller.getSnapshot().savedChapterIds).toEqual([saved.source.chapterId]);
    expect(value.dependencies.connect).not.toHaveBeenCalled();
    expect(value.dependencies.source?.getWorkPage).not.toHaveBeenCalled();
  });
});
