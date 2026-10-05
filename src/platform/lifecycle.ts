import { App } from '@capacitor/app';
import type { AppLifecycle } from '../contracts';
export const capacitorLifecycle: AppLifecycle = {
  async isActive() {
    return (await App.getState()).isActive;
  },
  async subscribe(listener) {
    const handle = await App.addListener('appStateChange', (state) => listener(state.isActive));
    return () => handle.remove();
  },
};
