import { beforeEach, expect, test, vi } from 'vitest';
const native = vi.hoisted(() => ({ platform: 'ios', ios: vi.fn(), android: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.platform !== 'web',
    getPlatform: () => native.platform,
  },
  CapacitorHttp: { request: native.android },
  registerPlugin: () => ({ request: native.ios }),
}));
import { capacitorHttpClient } from '../../src/platform/http/capacitor';
const options = {
  url: 'http://localhost:1234/v1/models',
  method: 'GET' as const,
  headers: {},
  responseType: 'json' as const,
  disableRedirects: true as const,
  connectTimeout: 15000,
  readTimeout: 30000,
};
beforeEach(() => {
  native.platform = 'ios';
  vi.clearAllMocks();
});
test('iOS dispatches to the ephemeral client instead of the shared cookie session', async () => {
  native.ios.mockResolvedValue({ status: 200, data: { data: [] }, url: options.url, headers: {} });
  expect(await capacitorHttpClient.request(options)).toMatchObject({ status: 200 });
  expect(native.ios).toHaveBeenCalledWith(options);
  expect(native.android).not.toHaveBeenCalled();
});
test('Android keeps its existing native HTTP implementation', async () => {
  native.platform = 'android';
  await capacitorHttpClient.request(options);
  expect(native.android).toHaveBeenCalledWith(options);
  expect(native.ios).not.toHaveBeenCalled();
});
test('the web cannot invoke either native client', async () => {
  native.platform = 'web';
  await expect(capacitorHttpClient.request(options)).rejects.toMatchObject({ code: 'connection' });
  expect(native.ios).not.toHaveBeenCalled();
  expect(native.android).not.toHaveBeenCalled();
});
