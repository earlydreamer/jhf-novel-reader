import { beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ android: true, ios: false, open: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.android || native.ios,
    getPlatform: () => (native.ios ? 'ios' : native.android ? 'android' : 'web'),
  },
  registerPlugin: () => ({ open: native.open }),
}));
import { openSourceBrowser } from '../../src/platform/browse';

describe('trusted native browse boundary', () => {
  beforeEach(() => {
    native.android = true;
    native.ios = false;
    native.open.mockReset();
  });
  it('opens the site and canonicalizes only a supported selected work', async () => {
    native.open.mockResolvedValue({ selectedUrl: 'https://ncode.syosetu.com/N1234AB/2#p1' });
    expect(await openSourceBrowser('https://syosetu.com/')).toEqual({
      selectedUrl: 'https://ncode.syosetu.com/n1234ab/2/',
    });
    expect(native.open).toHaveBeenCalledExactlyOnceWith({ startUrl: 'https://syosetu.com/' });
  });
  it('opens the native browser on iOS with the same selection contract', async () => {
    native.android = false;
    native.ios = true;
    native.open.mockResolvedValue({ selectedUrl: 'https://ncode.syosetu.com/n1234ab/' });
    expect(await openSourceBrowser()).toEqual({
      selectedUrl: 'https://ncode.syosetu.com/n1234ab/',
    });
  });
  it('returns null for trusted native cancellation', async () => {
    native.open.mockResolvedValue({ selectedUrl: null });
    expect(await openSourceBrowser('https://syosetu.com/')).toBeNull();
  });
  it('forwards a work canonical URL as the browser start URL', async () => {
    native.open.mockResolvedValue({ selectedUrl: null });
    await openSourceBrowser('https://ncode.syosetu.com/n1234ab/');
    expect(native.open).toHaveBeenCalledExactlyOnceWith({
      startUrl: 'https://ncode.syosetu.com/n1234ab/',
    });
  });
  it.each([
    'http://syosetu.com/',
    'https://127.0.0.1/',
    'https://syosetu.com.evil.test/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://u:p@syosetu.com/',
    'https://syosetu.com:8443/',
    'https://syosetu.com:443/',
    'https://syosetu.com/%2fsecret',
  ])('rejects start %s before native launch', async (url) => {
    await expect(openSourceBrowser(url)).rejects.toMatchObject({ code: 'source_access' });
    expect(native.open).not.toHaveBeenCalled();
  });
  it.each([
    { selectedUrl: 'https://evil.test/n1234ab/' },
    { selectedUrl: 'https://ncode.syosetu.com/n1234ab/2/?p=2' },
    { selectedUrl: 42 },
    {},
    null,
  ])('rejects malformed native selection %j', async (result) => {
    native.open.mockResolvedValue(result);
    await expect(openSourceBrowser('https://syosetu.com/')).rejects.toMatchObject({
      code: 'source_access',
    });
  });
  it('does not use the web browser as a native substitute', async () => {
    native.android = false;
    await expect(openSourceBrowser('https://syosetu.com/')).rejects.toMatchObject({
      code: 'source_access',
    });
    expect(native.open).not.toHaveBeenCalled();
  });
});
