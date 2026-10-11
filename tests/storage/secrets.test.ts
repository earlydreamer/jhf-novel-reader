import { describe, expect, it, vi } from 'vitest';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import {
  createNativeSecretStore,
  createSessionSecretStore,
  createProviderSecrets,
  type SecureBackend,
} from '../../src/storage/secrets';
function backend() {
  const data = new Map<string, string>(),
    calls: unknown[][] = [];
  const api: SecureBackend = {
    async setKeyPrefix(p) {
      calls.push(['prefix', p]);
    },
    async setSynchronize(s) {
      calls.push(['sync', s]);
    },
    async setDefaultKeychainAccess(a) {
      calls.push(['access', a]);
    },
    async getItem(k) {
      calls.push(['get', k]);
      return data.get(k) ?? null;
    },
    async setItem(k, v) {
      calls.push(['set', k]);
      data.set(k, v);
    },
    async removeItem(k) {
      calls.push(['remove', k]);
      data.delete(k);
    },
  };
  return { api, data, calls };
}
describe('credentials', () => {
  it.each(['web', 'electron', 'unknown'])(
    'rejects %s before any backend access',
    async (platform) => {
      const b = backend(),
        s = createNativeSecretStore(b.api, () => platform);
      for (const operation of [
        () => s.get('provider.a'),
        () => s.set('provider.a', 'fake-only'),
        () => s.remove('provider.a'),
      ])
        await expect(operation()).rejects.toMatchObject({
          reason: 'unsupported_platform',
        });
      expect(b.calls).toEqual([]);
    },
  );
  it('uses fixed namespace, raw strings and device-only non-sync setup before writing', async () => {
    const b = backend(),
      s = createNativeSecretStore(b.api, () => 'ios');
    await s.set('provider.a', 'fake-only');
    expect(b.calls.slice(0, 4)).toEqual([
      ['prefix', 'narou-reader.credentials.'],
      ['sync', false],
      ['access', KeychainAccess.whenUnlockedThisDeviceOnly],
      ['set', 'provider.a'],
    ]);
    expect(await s.get('provider.a')).toBe('fake-only');
    await s.remove('provider.a');
    expect(await s.get('provider.a')).toBeNull();
  });
  it('fails closed on setup and backend errors without leaking secrets or logging', async () => {
    const b = backend(),
      log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = createNativeSecretStore(b.api, () => 'android');
    b.api.setItem = async () => {
      throw new Error('fake-only authorization body');
    };
    try {
      await s.set('provider.a', 'fake-only');
      throw new Error('expected error');
    } catch (error) {
      expect(error).toMatchObject({ code: 'storage', reason: 'secure' });
      expect(JSON.stringify(error)).not.toContain('fake-only');
      expect(String(error)).not.toContain('authorization');
    }
    b.api.setSynchronize = async () => {
      throw new Error('setup');
    };
    await expect(s.get('provider.a')).rejects.toMatchObject({
      reason: 'secure',
    });
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it('isolates session-only credentials and explicitly opts into persistence', async () => {
    const a = createSessionSecretStore(),
      b = createSessionSecretStore();
    await a.set('provider.a', 'fake-only');
    expect(await a.get('provider.a')).toBe('fake-only');
    expect(await b.get('provider.a')).toBeNull();
    await a.remove('provider.a');
    expect(await a.get('provider.a')).toBeNull();
  });
  it('switching to session mode removes old persisted credential and scoped logout preserves other refs', async () => {
    const b = backend(),
      native = createNativeSecretStore(b.api, () => 'android'),
      s = createProviderSecrets(native);
    await s.save('provider.a', 'fake-persist', true);
    await s.save('provider.b', 'fake-other', true);
    await s.save('provider.a', 'fake-session', false);
    expect(b.data.has('provider.a')).toBe(false);
    expect(await s.get('provider.a')).toBe('fake-session');
    await s.remove('provider.a');
    expect(await s.get('provider.a')).toBeNull();
    expect(await s.get('provider.b')).toBe('fake-other');
  });
  it('does not claim successful switch or removal if native deletion fails', async () => {
    const b = backend(),
      s = createProviderSecrets(createNativeSecretStore(b.api, () => 'android'));
    await s.save('provider.a', 'fake-persist', true);
    b.api.removeItem = async () => {
      throw new Error('locked');
    };
    await expect(s.save('provider.a', 'fake-session', false)).rejects.toMatchObject({
      reason: 'secure',
    });
    await expect(s.remove('provider.a')).rejects.toMatchObject({
      reason: 'secure',
    });
    expect(await s.get('provider.a')).toBe('fake-persist');
  });
  it('rejects invalid refs before calling native and never clears a whole backend', async () => {
    const b = backend(),
      s = createNativeSecretStore(b.api, () => 'android');
    await expect(s.remove('../other')).rejects.toMatchObject({
      reason: 'invalid',
    });
    expect(b.calls).toEqual([]);
  });
});

it('enumerates references only inside the fixed non-sync namespace without reading values', async () => {
  const b = backend();
  const api = {
    ...b.api,
    keys: vi.fn(async (sync?: boolean) => {
      b.calls.push(['keys', sync]);
      return ['provider.synthetic'];
    }),
  };
  const store = createNativeSecretStore(api, () => 'android');
  expect(await store.keys()).toEqual(['provider.synthetic']);
  expect(b.calls).toEqual([
    ['prefix', 'narou-reader.credentials.'],
    ['sync', false],
    ['access', KeychainAccess.whenUnlockedThisDeviceOnly],
    ['keys', false],
  ]);
});
it('rejects enumeration on web before calling the secure backend', async () => {
  const b = backend();
  const api = { ...b.api, keys: vi.fn(async () => []) };
  await expect(createNativeSecretStore(api, () => 'web').keys()).rejects.toMatchObject({
    reason: 'unsupported_platform',
  });
  expect(b.calls).toEqual([]);
  expect(api.keys).not.toHaveBeenCalled();
});
