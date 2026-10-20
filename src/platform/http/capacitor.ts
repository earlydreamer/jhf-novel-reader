import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import { ReaderError } from '../../contracts';
import type { NativeHttpClient } from '../../contracts';
const iosHttp = registerPlugin<NativeHttpClient>('ReaderHttp');
/** Web Capacitor HTTP does not have the same redirect/isolation guarantees. No web fallback. */
export const capacitorHttpClient: NativeHttpClient = {
  async request(options) {
    if (!Capacitor.isNativePlatform()) throw new ReaderError('connection');
    return Capacitor.getPlatform() === 'ios'
      ? iosHttp.request({ ...options })
      : CapacitorHttp.request({ ...options });
  },
};
