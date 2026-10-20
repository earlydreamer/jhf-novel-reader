// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { createRenewalController } from '../../src/app/renewalController';
import { Application } from '../../src/app/Application';
import { createLibraryStore } from '../../src/storage/library';
import { createReadingSettingsRepository } from '../../src/storage/settings';
import { recentToc as toc } from '../fixtures/chapterUpdates';
import { runTopBackHandler } from '../../src/ui/shell/backStack';
import { source } from '../providers/wholeChapterFixture';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function fixture() {
  const memory = new Map<string, string>();
  const preferences = new Map<string, string>();
  const settings = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: preferences.get(key) ?? null }),
    set: async ({ key, value }) => {
      preferences.set(key, value);
    },
  });
  const library = createLibraryStore({
    read: async (path) => memory.get(path) ?? null,
    write: async (path, text) => {
      memory.set(path, text);
    },
  });
  await library.saveWorkPage(toc());
  let latest = [1, 2];
  const getWorkPage = vi.fn(async () => toc('n1234aa', latest));
  const controller = createRenewalController({
    library,
    settings,
    source: { getWorkPage, getChapter: vi.fn() },
  });
  await controller.initialize();
  // 자동 예약은 수동 확인과 같은 대기열에서 실행된다.
  await controller.checkChapterUpdates();
  return {
    library,
    settings,
    controller,
    getWorkPage,
    setLatest: (value: number[]) => {
      latest = value;
    },
  };
}

test('상단 아이콘과 확인 모달로 갱신하고 회차를 열어도 등록 후 48시간 배지는 유지한다', async () => {
  const h = await fixture();
  const view = render(<Application controller={h.controller} />);
  const refresh = within(document.querySelector<HTMLElement>('.nr-top-app-bar')!).getByRole(
    'button',
    {
      name: '서재 전체 새 회차 확인',
    },
  );
  expect(refresh).toBeEnabled();
  expect(refresh.querySelector('[data-icon="refresh"]')).toBeInTheDocument();
  expect(document.querySelector('.nr-library__updates')).toBeNull();
  expect(screen.getByText('새 회차 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'n1234aa 작품 메뉴' }));
  h.setLatest([1, 2, 3]);
  const beforeMenu = h.getWorkPage.mock.calls.length;
  fireEvent.click(screen.getByRole('menuitem', { name: '새 회차 확인' }));
  expect(screen.getByRole('dialog', { name: '이 작품의 새 회차를 확인할까요?' })).toHaveTextContent(
    '이 작품의 목차를 최신화해요.',
  );
  expect(h.getWorkPage).toHaveBeenCalledTimes(beforeMenu);
  fireEvent.click(screen.getByRole('button', { name: '확인하기' }));
  await screen.findByText('새 회차 2');
  const requests = h.getWorkPage.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /n1234aa 작품.*새 회차 2/ }));
  await screen.findByRole('heading', { name: 'n1234aa 작품' });
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  expect(
    within(document.querySelector<HTMLElement>('.nr-top-app-bar')!).getByRole('button', {
      name: '새 회차 확인',
    }),
  ).toBeEnabled();
  expect(document.querySelector('.nr-work-screen .nr-chapter-update-control')).toBeNull();
  expect(within(screen.getByRole('list')).getAllByText('새 회차', { exact: true })).toHaveLength(2);
  expect(within(screen.getByRole('list')).queryByText('새 회차 1')).toBeNull();
  await act(async () => {
    await h.controller.selectChapter(toc('n1234aa', [2]).chapters[0]!);
  });
  await act(async () => {
    h.controller.back();
  });
  await waitFor(() =>
    expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
      'n1234aa/2',
      'n1234aa/3',
    ]),
  );
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  h.setLatest([1, 2, 3, 4]);
  fireEvent.click(screen.getByRole('button', { name: '새 회차 확인' }));
  expect(screen.getByRole('dialog').querySelectorAll('p')).toHaveLength(1);
  expect(screen.getByRole('dialog')).toHaveTextContent('이 작품의 목차를 최신화해요.');
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  fireEvent.click(screen.getByRole('button', { name: '확인하기' }));
  await screen.findByRole('button', { name: '4화 4화' });
  expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
    'n1234aa/2',
    'n1234aa/3',
    'n1234aa/4',
  ]);
  view.unmount();
  h.controller.dispose();
});

test('화면 왕복과 앱 재시작은 주기 안에 목차를 다시 요청하지 않고 배지를 복원한다', async () => {
  const h = await fixture();
  await h.controller.openLibraryWork('n1234aa');
  h.controller.back();
  await h.controller.openLibraryWork('n1234aa');
  h.controller.back();
  const requests = h.getWorkPage.mock.calls.length;
  h.controller.dispose();
  const restarted = createRenewalController({
    library: h.library,
    source: { getWorkPage: h.getWorkPage, getChapter: vi.fn() },
  });
  await restarted.initialize();
  expect(restarted.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
    'n1234aa/2',
  ]);
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  restarted.dispose();
});

test('번역/목차 진입은 유지하고 실제 읽기 위치 저장 후에는 48시간 이내 배지도 숨긴다', async () => {
  const h = await fixture();
  const chapter = toc('n1234aa', [2]).chapters[0]!;
  await h.library.commitVersion({
    schemaVersion: 2,
    versionId: 'read-v1',
    source: {
      ...source,
      workId: chapter.workId,
      chapterId: chapter.chapterId,
      canonicalUrl: chapter.canonicalUrl,
      title: chapter.title,
    },
    text: '합성 번역',
    blocks: [{ id: 'b1', text: '합성 번역' }],
    createdAt: new Date().toISOString(),
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'test',
      modelId: 'test',
      contractVersion: 'plain-v1',
      promptVersion: 'test',
      languageDirection: 'ja-ko',
    },
  });
  await h.controller.openLibraryWork('n1234aa');
  await h.controller.selectChapter(chapter);
  expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
    'n1234aa/2',
  ]);
  vi.spyOn(h.library, 'savePosition').mockRejectedValueOnce(new Error('disk full'));
  await h.controller.savePosition('b1', 0);
  expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
    'n1234aa/2',
  ]);
  await h.controller.savePosition('b1', 0);
  expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([]);
  await h.controller.checkChapterUpdates('n1234aa');
  expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([]);
  h.controller.dispose();
  const restarted = createRenewalController({
    library: h.library,
    source: { getWorkPage: h.getWorkPage, getChapter: vi.fn() },
  });
  await restarted.initialize();
  expect(restarted.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([]);
  restarted.dispose();
});

test('48시간 지난 회차는 목록만 갱신하고 완료 토스트를 표시한다', async () => {
  const h = await fixture();
  render(<Application controller={h.controller} />);
  const old = toc('n1234aa', [1, 2, 3]);
  old.chapters = old.chapters.map((chapter) => ({
    ...chapter,
    publishedAt: new Date(Date.now() - 72 * 3_600_000).toISOString(),
  }));
  h.getWorkPage.mockResolvedValueOnce(old);
  const before = h.controller.getSnapshot().chapterUpdates.notice?.id ?? 0;
  fireEvent.click(screen.getByRole('button', { name: '서재 전체 새 회차 확인' }));
  fireEvent.click(screen.getByRole('button', { name: '확인하기' }));
  await waitFor(() =>
    expect(h.controller.getSnapshot().chapterUpdates.notice?.id).toBeGreaterThan(before),
  );
  await waitFor(() =>
    expect(document.querySelector('.nr-snackbar__text')).toHaveTextContent(
      '회차 목록을 갱신했어요.',
    ),
  );
  expect(document.querySelectorAll('.nr-new-chapter-badge')).toHaveLength(0);
  await act(async () => h.controller.openLibraryWork('n1234aa'));
  expect(document.querySelectorAll('.nr-work-screen ol > li')).toHaveLength(3);
  h.controller.dispose();
});

test('실제 lifecycle 복귀도 주기 안에는 네트워크 확인을 반복하지 않는다', async () => {
  const h = await fixture();
  h.controller.dispose();
  let listener!: (active: boolean) => void;
  const restarted = createRenewalController({
    library: h.library,
    source: { getWorkPage: h.getWorkPage, getChapter: vi.fn() },
    lifecycle: {
      isActive: async () => true,
      subscribe: async (value) => {
        listener = value;
        return async () => {};
      },
    },
  });
  await restarted.initialize();
  const requests = h.getWorkPage.mock.calls.length;
  listener(false);
  listener(true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  restarted.dispose();
});

test('서재 상단 아이콘은 확인 후 같은 날에도 전체를 갱신하고 배지를 표시한다', async () => {
  const h = await fixture();
  const view = render(<Application controller={h.controller} />);
  const requests = h.getWorkPage.mock.calls.length;
  h.setLatest([1, 2, 3]);
  fireEvent.click(screen.getByRole('button', { name: '서재 전체 새 회차 확인' }));
  expect(screen.getByRole('dialog', { name: '서재 전체 새 회차를 확인할까요?' })).toHaveTextContent(
    '서재에 있는 모든 작품의 목차를 최신화해요.',
  );
  expect(screen.getByRole('dialog').querySelectorAll('p')).toHaveLength(1);
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  fireEvent.click(screen.getByRole('button', { name: '확인하기' }));
  await screen.findByText('새 회차 2');
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests + 1);
  expect(h.controller.getSnapshot().route.kind).toBe('home');
  view.unmount();
  h.controller.dispose();
});

test('취소·Escape·뒤로 가기는 모달만 닫고 수동 요청을 보내지 않는다', async () => {
  const h = await fixture();
  render(<Application controller={h.controller} />);
  const requests = h.getWorkPage.mock.calls.length;
  const refresh = screen.getByRole('button', { name: '서재 전체 새 회차 확인' });
  fireEvent.click(refresh);
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(refresh);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(refresh);
  act(() => {
    expect(runTopBackHandler()).toBe(true);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  h.controller.dispose();
});

test('확인 직후 모달을 닫고 검사 중 아이콘을 비활성화해 요청을 반복하지 않는다', async () => {
  const h = await fixture();
  render(<Application controller={h.controller} />);
  const requests = h.getWorkPage.mock.calls.length;
  let release!: () => void;
  h.getWorkPage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve(toc('n1234aa', [1, 2, 3]));
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: '서재 전체 새 회차 확인' }));
  fireEvent.click(screen.getByRole('button', { name: '확인하기' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  const busy = await screen.findByRole('button', { name: '서재 새 회차 확인 중…' });
  expect(busy).toBeDisabled();
  await waitFor(() => expect(h.getWorkPage).toHaveBeenCalledTimes(requests + 1));
  fireEvent.click(busy);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests + 1);
  await act(async () => {
    release();
  });
  await screen.findByText('새 회차 2');
  expect(screen.getByRole('button', { name: '서재 전체 새 회차 확인' })).toBeEnabled();
  h.controller.dispose();
});

test('작품 검사 실패는 모달을 닫은 뒤에도 스낵바로 알려 준다', async () => {
  const h = await fixture();
  await h.controller.openLibraryWork('n1234aa');
  render(<Application controller={h.controller} />);
  h.getWorkPage.mockRejectedValueOnce(new Error('network unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '새 회차 확인' }));
  fireEvent.click(screen.getByRole('button', { name: '확인하기' }));
  await waitFor(() =>
    expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.error).toBeTruthy(),
  );
  await waitFor(() =>
    expect(document.querySelector('.nr-snackbar__text')).toHaveTextContent(
      h.controller.getSnapshot().chapterUpdates.works.n1234aa!.error!,
    ),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  h.controller.dispose();
});

test('설정의 기본 주기는 1일이고 유효한 N일만 저장하며 재시작에도 복원한다', async () => {
  const h = await fixture();
  h.controller.navigate({ kind: 'settings' });
  const view = render(<Application controller={h.controller} />);
  const input = screen.getByRole('spinbutton', { name: '자동 검사 주기 (일)' });
  expect(input).toHaveValue(1);
  const save = screen.getByRole('button', { name: '주기 저장' });
  expect(save).toBeDisabled();
  for (const invalid of ['0', '2.5', '366', '']) {
    fireEvent.change(input, { target: { value: invalid } });
    expect(save).toBeDisabled();
    expect(h.controller.getSnapshot().chapterUpdateDays).toBe(1);
  }
  fireEvent.change(input, { target: { value: '3' } });
  fireEvent.click(save);
  await waitFor(async () =>
    expect((await h.settings.readReadingSettings()).chapterUpdateDays).toBe(3),
  );
  expect(h.controller.getSnapshot().chapterUpdateDays).toBe(3);
  const requests = h.getWorkPage.mock.calls.length;
  view.unmount();
  h.controller.dispose();
  const restarted = createRenewalController({
    library: h.library,
    settings: h.settings,
    source: { getWorkPage: h.getWorkPage, getChapter: vi.fn() },
  });
  await restarted.initialize();
  expect(restarted.getSnapshot().chapterUpdateDays).toBe(3);
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  restarted.dispose();
});
