import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { ReaderError } from '../../contracts';
import type { NativeHttpClient } from '../../contracts';
/** Web Capacitor HTTP does not have the same redirect/isolation guarantees. No web fallback. */
export const capacitorHttpClient: NativeHttpClient = {
 async request(options) {
  if (!Capacitor.isNativePlatform()) throw new ReaderError('connection');
  return CapacitorHttp.request({ ...options });
 }
};
