import { App } from '@capacitor/app';
import { SystemBars } from '@capacitor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { capacitorShell } from '../../src/platform/shell';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  SystemBars: { setStyle: vi.fn(async () => {}) },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(), exitApp: vi.fn(async () => {}) },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.clearAllMocks();
});

describe('capacitorShell native branches', () => {
  it('registers backButton and removes it on unsubscribe', async () => {
    const remove = vi.fn(async () => {});
    vi.mocked(App.addListener).mockResolvedValueOnce({ remove });
    const off = capacitorShell.onBackButton(() => {});
    expect(App.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    off();
    await flush();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not raise an unhandled rejection when addListener rejects', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      vi.mocked(App.addListener).mockRejectedValueOnce(new Error('listener failed'));
      capacitorShell.onBackButton(() => {})();
      await flush();
      await flush();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does not raise an unhandled rejection when remove rejects', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const remove = vi.fn(async () => {
        throw new Error('remove failed');
      });
      vi.mocked(App.addListener).mockResolvedValueOnce({ remove });
      capacitorShell.onBackButton(() => {})();
      await flush();
      await flush();
      expect(remove).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('sets the system bar style for the resolved theme', () => {
    capacitorShell.setSystemBarsTheme('dark');
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
    capacitorShell.setSystemBarsTheme('light');
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
  });
});
