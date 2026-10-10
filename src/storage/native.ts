import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { StorageError, storageError } from './errors';
import { check } from './validation';
import { createLibraryStore } from './library';
import { createReadingSettingsRepository, type PreferenceBackend } from './settings';
import type { PrivateFiles } from './journal';
export interface NativeStorageGate {
  run<T>(action: () => Promise<T>): Promise<T>;
  pause(): Promise<() => void>;
}
/** Park old-runtime I/O while a restore validates and replaces its private store. */
export function createNativeStorageGate(): NativeStorageGate {
  let barrier: Promise<void> | null = null;
  let active = 0;
  let idle: (() => void) | null = null;
  return {
    async run<T>(action: () => Promise<T>): Promise<T> {
      // No await on the open path: reserve the call before pause can drain it.
      while (barrier) await barrier;
      active++;
      try {
        return await action();
      } finally {
        if (--active === 0) {
          idle?.();
          idle = null;
        }
      }
    },
    async pause() {
      if (barrier) throw new StorageError('io');
      let open!: () => void;
      barrier = new Promise<void>((resolve) => {
        open = resolve;
      });
      if (active)
        await new Promise<void>((resolve) => {
          idle = resolve;
        });
      let resumed = false;
      return () => {
        if (resumed) return;
        resumed = true;
        barrier = null;
        open();
      };
    },
  };
}
export const nativeStorageGate = createNativeStorageGate();

const platform = () => (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web');
function native(getPlatform: () => string) {
  const name = getPlatform();
  if (name !== 'android' && name !== 'ios') throw new StorageError('unsupported_platform');
}
function privatePath(path: string): string {
  check(
    /^(chapters|positions|library|versions|reading|works|attempts|batches|guidance|titles)\/[a-zA-Z0-9.-]+$/.test(
      path,
    ) && !path.includes('..'),
  );
  return `narou-reader/${path}`;
}
export function createNativePrivateFiles(
  backend: Pick<FilesystemPlugin, 'readFile' | 'writeFile' | 'readdir'> &
    Partial<Pick<FilesystemPlugin, 'deleteFile'>> = Filesystem,
  getPlatform: () => string = platform,
  gate: NativeStorageGate = nativeStorageGate,
): PrivateFiles {
  return {
    async list(directory) {
      native(getPlatform);
      check(directory === 'chapters' || directory === 'versions' || directory === 'reading');
      try {
        const result = await gate.run(() =>
          backend.readdir({
            path: `narou-reader/${directory}`,
            directory: Directory.LibraryNoCloud,
          }),
        );
        return result.files.filter((file) => file.type === 'file').map((file) => file.name);
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'OS-PLUG-FILE-0008'
        )
          return [];
        throw storageError(error);
      }
    },
    async read(path) {
      native(getPlatform);
      const options = {
        path: privatePath(path),
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
      };
      try {
        const result = await gate.run(() => backend.readFile(options));
        check(typeof result.data === 'string');
        return result.data;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'OS-PLUG-FILE-0008'
        )
          return null;
        throw storageError(error);
      }
    },
    async write(path, data) {
      native(getPlatform);
      const options = {
        path: privatePath(path),
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
        data,
        recursive: true,
      };
      try {
        await gate.run(() => backend.writeFile(options));
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'OS-PLUG-FILE-0013' &&
          'message' in error &&
          typeof error.message === 'string' &&
          /\b(?:ENOSPC|EDQUOT)\b/.test(error.message)
        )
          throw new StorageError('disk_full');
        throw storageError(error);
      }
    },
    async remove(path) {
      native(getPlatform);
      if (!backend.deleteFile) throw new StorageError('unsupported_platform');
      try {
        await gate.run(() =>
          backend.deleteFile!({
            path: privatePath(path),
            directory: Directory.LibraryNoCloud,
          }),
        );
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'OS-PLUG-FILE-0008'
        )
          return;
        throw storageError(error);
      }
    },
  };
}
export function createNativePreferences(
  backend: PreferenceBackend = Preferences,
  getPlatform: () => string = platform,
  gate: NativeStorageGate = nativeStorageGate,
): PreferenceBackend {
  return {
    async get(options) {
      native(getPlatform);
      try {
        return await gate.run(() => backend.get(options));
      } catch (error) {
        throw storageError(error);
      }
    },
    async set(options) {
      native(getPlatform);
      try {
        await gate.run(() => backend.set(options));
      } catch (error) {
        throw storageError(error);
      }
    },
    async remove(options) {
      native(getPlatform);
      if (!backend.remove) throw new StorageError('unsupported_platform');
      try {
        await gate.run(() => backend.remove!(options));
      } catch (error) {
        throw storageError(error);
      }
    },
  };
}
const files = createNativePrivateFiles(),
  preferences = createNativePreferences();
export function createNativeLibraryStore() {
  return createLibraryStore(files);
}

export function createNativeReadingSettingsRepository() {
  return createReadingSettingsRepository(preferences);
}
