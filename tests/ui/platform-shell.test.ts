import { App } from '@capacitor/app';
import { SystemBars } from '@capacitor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capacitorShell } from '../../src/platform/shell';

// vi.fn으로 감싸면 spy가 반환된 Promise를 먼저 구독해 거부가 unhandled rejection으로 보이지 않는다.
// 그래서 addListener는 테스트마다 구현을 바꿀 수 있는 평범한 함수로 둔다.
const app = vi.hoisted(() => ({
  registered: [] as string[],
  addListener: (_event: string, _listener: () => void): Promise<{ remove(): Promise<void> }> =>
    Promise.resolve({ remove: async () => {} }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  SystemBars: { setStyle: vi.fn(async () => {}) },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event: string, listener: () => void) => {
      app.registered.push(event);
      return app.addListener(event, listener);
    },
    exitApp: vi.fn(async () => {}),
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

  it('sets the system bar style for the resolved theme', () => {
    capacitorShell.setSystemBarsTheme('dark');
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });
    capacitorShell.setSystemBarsTheme('light');
    expect(SystemBars.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });
  });
});
