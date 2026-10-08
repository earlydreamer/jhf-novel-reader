import { App } from '@capacitor/app';
import { SystemBars } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capacitorShell } from '../../src/platform/shell';

// vi.fn으로 감싸면 spy가 반환된 Promise를 먼저 구독해 거부가 unhandled rejection으로 보이지 않는다.
// 그래서 addListener는 테스트마다 구현을 바꿀 수 있는 평범한 함수로 둔다.
const app = vi.hoisted(() => ({
  registered: [] as string[],
  order: [] as string[],
  theme: {
    applyResolvedTheme: vi.fn(async ({ theme }: { theme: string }) => {
      app.order.push(`theme:${theme}`);
    }),
  },
  addListener: (_event: string, _listener: () => void): Promise<{ remove(): Promise<void> }> =>
    Promise.resolve({ remove: async () => {} }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: vi.fn(() => app.theme),
  SystemBars: {
    setStyle: vi.fn(async ({ style }: { style: string }) => {
      app.order.push(`bars:${style}`);
    }),
  },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, listener: () => void) => {
      app.registered.push(event);
      return app.addListener(event, listener);
    },
    minimizeApp: vi.fn(async () => {}),
  },
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function expectNoUnhandledRejection(run: () => void): Promise<void> {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    run();
    await flush();
    await flush();
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
}

beforeEach(() => {
  app.registered.length = 0;
  app.order.length = 0;
  app.addListener = () => Promise.resolve({ remove: async () => {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('capacitorShell native branches', () => {
  it('registers backButton and removes it on unsubscribe', async () => {
    const remove = vi.fn(async () => {});
    app.addListener = () => Promise.resolve({ remove });
    const off = capacitorShell.onBackButton(() => {});
    expect(app.registered).toEqual(['backButton']);
    off();
    await flush();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('does not raise an unhandled rejection when addListener rejects and unsubscribe is called', async () => {
    await expectNoUnhandledRejection(() => {
      app.addListener = () => Promise.reject(new Error('listener failed'));
      capacitorShell.onBackButton(() => {})();
    });
  });

  it('does not raise an unhandled rejection when addListener rejects and unsubscribe is never called', async () => {
    await expectNoUnhandledRejection(() => {
      app.addListener = () => Promise.reject(new Error('listener failed'));
      capacitorShell.onBackButton(() => {});
    });
  });

  it('does not raise an unhandled rejection when remove rejects', async () => {
    const remove = vi.fn(async () => {
      throw new Error('remove failed');
    });
    await expectNoUnhandledRejection(() => {
      app.addListener = () => Promise.resolve({ remove });
      capacitorShell.onBackButton(() => {})();
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('moves the app to the background instead of finishing it', () => {
    capacitorShell.moveToBackground();
    expect(App.minimizeApp).toHaveBeenCalledTimes(1);
  });

  it('applies the resolved window theme before setting system bar icons', async () => {
    capacitorShell.setSystemBarsTheme('dark');
    await flush();
    expect(app.theme.applyResolvedTheme).toHaveBeenLastCalledWith({ theme: 'dark' });
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
    capacitorShell.setSystemBarsTheme('light');
    await flush();
    expect(app.theme.applyResolvedTheme).toHaveBeenLastCalledWith({ theme: 'light' });
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    expect(app.order).toEqual(['theme:dark', 'bars:DARK', 'theme:light', 'bars:LIGHT']);
  });

  it('skips stale theme requests that have not started yet', async () => {
    capacitorShell.setSystemBarsTheme('light');
    capacitorShell.setSystemBarsTheme('dark');
    capacitorShell.setSystemBarsTheme('light');
    await flush();
    await flush();
    expect(app.theme.applyResolvedTheme).toHaveBeenCalledTimes(1);
    expect(app.theme.applyResolvedTheme).toHaveBeenCalledWith({ theme: 'light' });
    expect(SystemBars.setStyle).toHaveBeenCalledTimes(1);
    expect(SystemBars.setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('does not let an in-flight stale theme update overwrite the latest icon style', async () => {
    let finishFirst: (() => void) | undefined;
    app.theme.applyResolvedTheme.mockImplementationOnce(({ theme }) => {
      app.order.push(`theme-start:${theme}`);
      return new Promise<void>((resolve) => {
        finishFirst = () => {
          app.order.push(`theme-finish:${theme}`);
          resolve();
        };
      });
    });

    capacitorShell.setSystemBarsTheme('dark');
    await flush();
    capacitorShell.setSystemBarsTheme('light');
    capacitorShell.setSystemBarsTheme('dark');
    finishFirst?.();
    await flush();
    await flush();

    expect(app.order).toEqual([
      'theme-start:dark',
      'theme-finish:dark',
      'bars:DARK',
      'theme:dark',
      'bars:DARK',
    ]);
    expect(SystemBars.setStyle).toHaveBeenCalledTimes(2);
    expect(SystemBars.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
  });

  it('does not change icon style when the background bridge rejects and recovers for the next theme', async () => {
    app.theme.applyResolvedTheme.mockRejectedValueOnce(new Error('bridge unavailable'));
    capacitorShell.setSystemBarsTheme('dark');
    await flush();
    capacitorShell.setSystemBarsTheme('light');
    await flush();
    await flush();

    expect(SystemBars.setStyle).toHaveBeenCalledTimes(1);
    expect(SystemBars.setStyle).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(app.order).toEqual(['theme:light', 'bars:LIGHT']);
  });

  it('recovers the theme queue when SystemBars rejects', async () => {
    vi.mocked(SystemBars.setStyle).mockRejectedValueOnce(new Error('SystemBars unavailable'));
    capacitorShell.setSystemBarsTheme('dark');
    await flush();
    capacitorShell.setSystemBarsTheme('light');
    await flush();
    await flush();

    expect(app.theme.applyResolvedTheme).toHaveBeenCalledTimes(2);
    expect(SystemBars.setStyle).toHaveBeenCalledTimes(2);
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
  });
});
