// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
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
    exitApp: vi.fn(),
    setSystemBarsTheme: vi.fn(),
    pressBack: () => back?.(),
  };
  return value;
}

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
    expect(shell.exitApp).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('moves focus to the new screen heading after navigation', () => {
    const controller = createRenewalController();
    render(<Application controller={controller} platform={platform()} />);
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('heading', { level: 1, name: '연결 설정' })).toHaveFocus();
    controller.dispose();
  });
});
