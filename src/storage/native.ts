import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem, type FilesystemPlugin } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { StorageError, storageError } from './errors';
import { check } from './validation';
import { createLibraryStore } from './library';
import { createReadingSettingsRepository, type PreferenceBackend } from './settings';
import type { PrivateFiles } from './journal';
const platform = () => (Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web');
function native(getPlatform: () => string) {
  const name = getPlatform();
  if (name !== 'android' && name !== 'ios') throw new StorageError('unsupported_platform');
}
function privatePath(path: string): string {
  check(
    /^(chapters|positions|library|versions|reading|works|attempts)\/[a-zA-Z0-9.-]+$/.test(path) &&
      !path.includes('..'),
  );
  return `narou-reader/${path}`;
}
export function createNativePrivateFiles(
  backend: Pick<FilesystemPlugin, 'readFile' | 'writeFile'> = Filesystem,
  getPlatform: () => string = platform,
): PrivateFiles {
  return {
    async read(path) {
      native(getPlatform);
      const options = {
        path: privatePath(path),
        directory: Directory.LibraryNoCloud,
        encoding: Encoding.UTF8,
      };
      try {
        const result = await backend.readFile(options);
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
        await backend.writeFile(options);
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
  };
}
export function createNativePreferences(
  backend: PreferenceBackend = Preferences,
  getPlatform: () => string = platform,
): PreferenceBackend {
  return {
    async get(options) {
      native(getPlatform);
      try {
        return await backend.get(options);
      } catch (error) {
        throw storageError(error);
      }
    },
    async set(options) {
      native(getPlatform);
      try {
        await backend.set(options);
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
