// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { createRenewalController } from '../../src/app/renewalController';
import { Application } from '../../src/app/Application';
import { createLibraryStore } from '../../src/storage/library';
import { createReadingSettingsRepository } from '../../src/storage/settings';
import { toc } from '../fixtures/chapterUpdates';

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

test('서재 전체/작품 메뉴/목차 버튼으로 갱신하고 회차를 열면 해당 배지만 해제한다', async () => {
  const h = await fixture();
  const view = render(<Application controller={h.controller} />);
  expect(screen.getByRole('button', { name: '서재 전체 새 회차 확인' })).toBeEnabled();
  expect(screen.getByText('새 회차 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'n1234aa 작품 메뉴' }));
  h.setLatest([1, 2, 3]);
  fireEvent.click(screen.getByRole('menuitem', { name: '새 회차 확인' }));
  await screen.findByText('새 회차 2');
  const requests = h.getWorkPage.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: /n1234aa 작품.*새 회차 2/ }));
  await screen.findByRole('heading', { name: 'n1234aa 작품' });
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  expect(screen.getByRole('button', { name: '새 회차 확인' })).toBeEnabled();
  expect(within(screen.getByRole('list')).getAllByText('새 회차 1')).toHaveLength(2);
  await act(async () => {
    await h.controller.selectChapter(toc('n1234aa', [2]).chapters[0]!);
  });
  await act(async () => {
    h.controller.back();
  });
  await waitFor(() =>
    expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
      'n1234aa/3',
    ]),
  );
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests);
  h.setLatest([1, 2, 3, 4]);
  fireEvent.click(screen.getByRole('button', { name: '새 회차 확인' }));
  await screen.findByRole('button', { name: '4화 4화' });
  expect(h.controller.getSnapshot().chapterUpdates.works.n1234aa?.newChapterIds).toEqual([
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

test('서재 전체 검사 버튼은 같은 날에도 명시적으로 갱신하고 배지를 표시한다', async () => {
  const h = await fixture();
  const view = render(<Application controller={h.controller} />);
  const requests = h.getWorkPage.mock.calls.length;
  h.setLatest([1, 2, 3]);
  fireEvent.click(screen.getByRole('button', { name: '서재 전체 새 회차 확인' }));
  await screen.findByText('새 회차 2');
  expect(h.getWorkPage).toHaveBeenCalledTimes(requests + 1);
  expect(h.controller.getSnapshot().route.kind).toBe('home');
  view.unmount();
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
