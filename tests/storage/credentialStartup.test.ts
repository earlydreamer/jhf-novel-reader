import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  native: true,
  platform: 'android',
  get: vi.fn<() => Promise<{ value: string | null }>>(),
  keys: vi.fn<() => Promise<string[]>>(),
  remove: vi.fn<(ref: string) => Promise<void>>(),
  files: vi.fn(() => ({ read: async () => null, write: async () => {} })),
}));
vi.mock('@capacitor/core', async (original) => ({
  ...(await original<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => state.native, getPlatform: () => state.platform },
}));
vi.mock('../../src/storage/native', () => ({
  createNativePrivateFiles: state.files,
  createNativePreferences: () => ({ get: state.get, set: async () => {} }),
}));
vi.mock('../../src/storage/secrets', async (original) => ({
  ...(await original<typeof import('../../src/storage/secrets')>()),
  createNativeSecretStore: () => ({ keys: state.keys, remove: state.remove }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  state.native = true;
  state.platform = 'android';
  state.get.mockResolvedValue({ value: null });
  state.keys.mockResolvedValue([]);
  state.remove.mockResolvedValue();
});
it('shares the first cleanup barrier and never sweeps credentials created later in the runtime', async () => {
  let finish!: (value: { value: null }) => void;
  state.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { cleanupNativeCredentialsBeforeStartup: cleanup } =
    await import('../../src/storage/credentialCleanup');
  const first = cleanup();
  const second = cleanup();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(state.get).toHaveBeenCalledOnce());
  expect(state.keys).not.toHaveBeenCalled();
  finish({ value: null });
  await first;
  state.keys.mockResolvedValue(['provider.00000000-0000-4000-8000-000000000001']);
  await cleanup();
  expect(state.keys).toHaveBeenCalledOnce();
  expect(state.remove).not.toHaveBeenCalled();
});
it('does not retry a failed inventory scan while the application may have active requests', async () => {
  state.get.mockRejectedValueOnce(Error('synthetic'));
  const { cleanupNativeCredentialsBeforeStartup: cleanup } =
    await import('../../src/storage/credentialCleanup');
  await cleanup();
  await cleanup();
  expect(state.get).toHaveBeenCalledOnce();
  expect(state.keys).not.toHaveBeenCalled();
});
it.each(['web', 'ios'])('never opens storage for %s startup', async (platform) => {
  state.platform = platform;
  state.native = platform !== 'web';
  const { cleanupNativeCredentialsBeforeStartup: cleanup } =
    await import('../../src/storage/credentialCleanup');
  await cleanup();
  expect(state.files).not.toHaveBeenCalled();
});
