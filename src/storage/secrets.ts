import { Capacitor } from '@capacitor/core';
import {
  KeychainAccess,
  SecureStorage,
  type SecureStoragePlugin,
} from '@aparajita/capacitor-secure-storage';
import type { SecretStore } from '../contracts';
import { StorageError } from './errors';
import { check, text } from './validation';
export type SecureBackend = Pick<
  SecureStoragePlugin,
  | 'setKeyPrefix'
  | 'setSynchronize'
  | 'setDefaultKeychainAccess'
  | 'getItem'
  | 'setItem'
  | 'removeItem'
>;
export function secretRef(ref: unknown): asserts ref is string {
  check(typeof ref === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(ref));
}
const queues = new WeakMap<SecureBackend, Promise<unknown>>();
/** Fail closed: Capacitor's web implementation is plaintext and must never be called. */
export function createNativeSecretStore(
  backend: SecureBackend = SecureStorage,
  platform: () => string = () => (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web'),
): SecretStore {
  function operation<T>(ref: string, action: () => Promise<T>): Promise<T> {
    const task = (queues.get(backend) ?? Promise.resolve()).then(async () => {
      secretRef(ref);
      const native = platform();
      if (native !== 'android' && native !== 'ios') throw new StorageError('unsupported_platform');
      try {
        await backend.setKeyPrefix('narou-reader.credentials.');
        await backend.setSynchronize(false);
        await backend.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
        return await action();
      } catch {
        throw new StorageError('secure');
      }
    });
    queues.set(
      backend,
      task.catch(() => {}),
    );
    return task;
  }
  return {
    get: (ref) => operation(ref, () => backend.getItem(ref)),
    set: async (ref, secret) => {
      text(secret);
      await operation(ref, () => backend.setItem(ref, secret));
    },
    remove: (ref) => operation(ref, () => backend.removeItem(ref)),
  };
}
/** Deliberate ephemeral mode, never an error fallback. Create one instance per session. */
export function createSessionSecretStore(): SecretStore {
  const values = new Map<string, string>();
  return {
    async get(ref) {
      secretRef(ref);
      return values.get(ref) ?? null;
    },
    async set(ref, secret) {
      secretRef(ref);
      text(secret);
      values.set(ref, secret);
    },
    async remove(ref) {
      secretRef(ref);
      values.delete(ref);
    },
  };
}
/** Native-app credential lifecycle: explicit opt-in, removal scoped to one authRef. */
export function createProviderSecrets(native: SecretStore) {
  const session = createSessionSecretStore();
  let queue: Promise<unknown> = Promise.resolve();
  function run<T>(action: () => Promise<T>) {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  }
  return {
    get: (ref: string) => run(async () => (await session.get(ref)) ?? (await native.get(ref))),
    save: (ref: string, secret: string, persist = false) =>
      run(async () => {
        secretRef(ref);
        text(secret);
        if (persist) {
          await native.set(ref, secret);
          await session.remove(ref);
        } else {
          await native.remove(ref);
          await session.set(ref, secret);
        }
      }),
    remove: (ref: string) =>
      run(async () => {
        await session.remove(ref);
        await native.remove(ref);
      }),
  };
}
