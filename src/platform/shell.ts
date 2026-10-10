import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { ResolvedTheme } from '../ui/theme/theme';

interface ReaderThemePlugin {
  applyResolvedTheme(options: { theme: ResolvedTheme }): Promise<void>;
}

const ReaderTheme = registerPlugin<ReaderThemePlugin>('ReaderTheme', {
  web: () => ({ applyResolvedTheme: async () => {} }),
});
interface ScreenAwakePlugin {
  setKeepAwake(options: { enabled: boolean }): Promise<void>;
}

const ScreenAwake = registerPlugin<ScreenAwakePlugin>('ScreenAwake', {
  web: () => ({ setKeepAwake: async () => {} }),
});
interface AppReadyPlugin {
  ready(): Promise<void>;
}

const AppReady = registerPlugin<AppReadyPlugin>('AppReady', {
  web: () => ({ ready: async () => {} }),
});
let systemBarsThemeQueue: Promise<void> = Promise.resolve();
let systemBarsThemeOperation = 0;
// 네이티브에 마지막으로 보낸 값. 같은 값이 반복되면 플러그인을 다시 부르지 않는다.
let keepAwake = false;
let readySent = false;

export interface ShellPlatform {
  onBackButton(listener: () => void): () => void;
  moveToBackground(): void;
  setSystemBarsTheme(theme: ResolvedTheme): void;
  setKeepAwake(enabled: boolean): void;
  markReady(): void;
}

export const noopShell: ShellPlatform = {
  onBackButton: () => () => {},
  moveToBackground: () => {},
  setSystemBarsTheme: () => {},
  setKeepAwake: () => {},
  markReady: () => {},
};

export const capacitorShell: ShellPlatform = {
  onBackButton(listener) {
    if (!Capacitor.isNativePlatform()) return () => {};
    const handle = App.addListener('backButton', () => listener());
    // 등록이 실패해도 해제 전에 unhandled rejection이 나지 않도록 즉시 처리한다.
    handle.catch(() => {});
    return () => {
      void handle.then((value) => value.remove()).catch(() => {});
    };
  },
  moveToBackground() {
    // 루트에서 뒤로 가기는 앱을 끝내지 않고 백그라운드로 보낸다(Android 12+ 관례).
    if (Capacitor.isNativePlatform()) void App.minimizeApp().catch(() => {});
  },
  setSystemBarsTheme(theme) {
    if (!Capacitor.isNativePlatform()) return;
    const operation = ++systemBarsThemeOperation;
    systemBarsThemeQueue = systemBarsThemeQueue
      .catch(() => {})
      .then(async () => {
        if (operation !== systemBarsThemeOperation) return;
        await ReaderTheme.applyResolvedTheme({ theme });
        // Dark = 어두운 배경 위 밝은 아이콘. Keep Capacitor's style and lifecycle handling.
        await SystemBars.setStyle({
          style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
        });
      })
      .catch(() => {});
  },
  setKeepAwake(enabled) {
    if (!Capacitor.isNativePlatform() || enabled === keepAwake) return;
    keepAwake = enabled;
    // 화면 켜짐 유지는 부가 기능이라 실패해도 긴 작업 자체를 막지 않는다.
    void ScreenAwake.setKeepAwake({ enabled }).catch(() => {});
  },
  markReady() {
    if (readySent) return;
    readySent = true;
    // 스플래시는 네이티브 제한 시간으로도 내려가므로 실패해도 무시한다.
    void AppReady.ready().catch(() => {});
  },
};
