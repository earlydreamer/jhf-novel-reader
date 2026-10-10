// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController, type RenewalSnapshot } from '../../src/app/renewalController';
import type { ShellPlatform } from '../../src/platform/shell';
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

function platform() {
  let back: (() => void) | null = null;
  const value: ShellPlatform & { pressBack(): void } = {
    onBackButton: (listener) => {
      back = listener;
      return () => {
        back = null;
      };
    },
    moveToBackground: vi.fn(),
    setSystemBarsTheme: vi.fn(),
    setKeepAwake: vi.fn(),
    markReady: vi.fn(),
    pressBack: () => back?.(),
  };
  return value;
}

// 긴 작업 상태만 바꿔 보려고 실제 컨트롤러의 스냅샷을 덮어쓸 수 있게 감싼다.
function overridableController() {
  const base = createRenewalController();
  const listeners = new Set<() => void>();
  let snapshot: RenewalSnapshot = base.getSnapshot();
  return {
    ...base,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    override(patch: Partial<RenewalSnapshot>) {
      snapshot = { ...snapshot, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}

const idle: Partial<RenewalSnapshot> = {
  batch: null,
  termScan: null,
  batchFill: null,
  translationActive: false,
};

describe('application shell', () => {
  it('shows the library app bar with settings and applies the resolved theme', async () => {
    const shell = platform();
    const controller = createRenewalController();
    render(<Application controller={controller} platform={shell} />);
    expect(screen.getByRole('banner')).toHaveTextContent('서재');
    expect(screen.getByRole('button', { name: '설정' })).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(shell.setSystemBarsTheme).toHaveBeenCalledWith('light');
    act(() => controller.changeTheme('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(shell.setSystemBarsTheme).toHaveBeenLastCalledWith('dark');
    controller.dispose();
  });

  it('settings screen has back and the overflow menu, and system back returns', () => {
    const shell = platform();
    const controller = createRenewalController();
    render(<Application controller={controller} platform={shell} />);
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('banner')).toHaveTextContent('설정');
    expect(screen.getByRole('button', { name: '뒤로 가기' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '더보기' }));
    expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: '설정' })).toBeNull();
    act(() => shell.pressBack());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(controller.getSnapshot().route.kind).toBe('settings');
    act(() => shell.pressBack());
    expect(controller.getSnapshot().route.kind).toBe('home');
    act(() => shell.pressBack());
    expect(shell.moveToBackground).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('moves focus to the new screen heading after navigation', () => {
    const controller = createRenewalController();
    render(<Application controller={controller} platform={platform()} />);
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('heading', { level: 1, name: '설정' })).toHaveFocus();
    controller.dispose();
  });
});

describe('keep awake during long work', () => {
  it.each<[string, Partial<RenewalSnapshot>]>([
    ['미리 번역', { batch: { active: true } as unknown as RenewalSnapshot['batch'] }],
    ['정밀스캔', { termScan: { workId: 'n1234ab', phase: 'running', handled: [] } }],
    ['채우기', { batchFill: { recordId: 'record-1', phase: 'running' } }],
    ['번역', { translationActive: true }],
  ])('keeps the screen awake while %s runs and releases it after', (_name, busy) => {
    const shell = platform();
    const controller = overridableController();
    render(<Application controller={controller} platform={shell} />);
    expect(shell.setKeepAwake).toHaveBeenLastCalledWith(false);
    act(() => controller.override(busy));
    expect(shell.setKeepAwake).toHaveBeenLastCalledWith(true);
    act(() => controller.override(idle));
    expect(shell.setKeepAwake).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });

  it('releases the screen when the application unmounts during a long task', () => {
    const shell = platform();
    const controller = overridableController();
    const view = render(<Application controller={controller} platform={shell} />);
    act(() => controller.override({ translationActive: true }));
    expect(shell.setKeepAwake).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(shell.setKeepAwake).toHaveBeenLastCalledWith(false);
    controller.dispose();
  });
});
