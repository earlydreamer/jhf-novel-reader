import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { ResolvedTheme } from '../ui/theme/theme';

export interface ShellPlatform {
  onBackButton(listener: () => void): () => void;
  exitApp(): void;
  setSystemBarsTheme(theme: ResolvedTheme): void;
}

export const noopShell: ShellPlatform = {
  onBackButton: () => () => {},
  exitApp: () => {},
  setSystemBarsTheme: () => {},
};

export const capacitorShell: ShellPlatform = {
  onBackButton(listener) {
    if (!Capacitor.isNativePlatform()) return () => {};
    const handle = App.addListener('backButton', () => listener());
    return () => {
      void handle.then((value) => value.remove()).catch(() => {});
    };
  },
  exitApp() {
    if (Capacitor.isNativePlatform()) void App.exitApp();
  },
  setSystemBarsTheme(theme) {
    if (!Capacitor.isNativePlatform()) return;
    // Dark = 어두운 배경 위 밝은 아이콘.
    void SystemBars.setStyle({
      style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  },
};
