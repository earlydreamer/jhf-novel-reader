import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { ResolvedTheme } from '../ui/theme/theme';

interface ReaderThemePlugin {
  applyResolvedTheme(options: { theme: ResolvedTheme }): Promise<void>;
}

const ReaderTheme = registerPlugin<ReaderThemePlugin>('ReaderTheme', {
  web: () => ({ applyResolvedTheme: async () => {} }),
});
let systemBarsThemeQueue: Promise<void> = Promise.resolve();
let systemBarsThemeOperation = 0;

export interface ShellPlatform {
  onBackButton(listener: () => void): () => void;
  moveToBackground(): void;
  setSystemBarsTheme(theme: ResolvedTheme): void;
}

export const noopShell: ShellPlatform = {
  onBackButton: () => () => {},
  moveToBackground: () => {},
  setSystemBarsTheme: () => {},
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
};
