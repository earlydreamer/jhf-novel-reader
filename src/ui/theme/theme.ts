import { useSyncExternalStore } from 'react';
import type { ThemePreference } from '../../storage/settings';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

function query(): MediaQueryList | null {
  // jsdom과 일부 WebView에는 matchMedia가 없을 수 있다.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}
function subscribe(listener: () => void): () => void {
  const media = query();
  if (!media) return () => {};
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const systemDark = () => query()?.matches ?? false;

export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  return resolveTheme(
    preference,
    useSyncExternalStore(subscribe, systemDark, () => false),
  );
}
