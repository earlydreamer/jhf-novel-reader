import { selected } from './readingValidation';
import type { PreferencesPlugin } from '@capacitor/preferences';
import { DEFAULT_PREFERENCES, type ProviderConfig, type ReaderPreferences } from '../contracts';
import { StorageError, storageError } from './errors';
import { check, integer, object, record, text, url, snapshot as cloneInput } from './validation';
import { secretRef } from './secrets';
export type PreferenceBackend = Pick<PreferencesPlugin, 'get' | 'set'>;
export interface SavedSettings {
  config: ProviderConfig | null;
  preferences: ReaderPreferences;
}
const KEY = 'narou-reader.settings.v1';
const queues = new WeakMap<PreferenceBackend, Promise<unknown>>();
function validate(value: unknown): SavedSettings {
  object(value, ['config', 'preferences']);
  object(value.preferences, ['fontSize', 'prefetchEnabled']);
  integer(value.preferences.fontSize, 10);
  check(value.preferences.fontSize <= 48);
  check(typeof value.preferences.prefetchEnabled === 'boolean');
  if (value.config !== null) {
    object(value.config, [
      'provider',
      'baseUrl',
      'model',
      'authRef',
      'contextBudget',
      'outputBudget',
      'settingsRevision',
    ]);
    const c = value.config;
    check(c.provider === 'openai-compatible' || c.provider === 'gemini');
    url(c.baseUrl);
    text(c.model);
    check(c.model.length <= 256);
    if (c.authRef !== undefined) secretRef(c.authRef);
    integer(c.contextBudget, 1);
    integer(c.outputBudget, 1);
    integer(c.settingsRevision);
    check(c.outputBudget < c.contextBudget);
  }
  return value as unknown as SavedSettings;
}
function decode(raw: string): SavedSettings {
  try {
    const data: unknown = JSON.parse(raw);
    record(data);
    if (typeof data.schemaVersion === 'number' && data.schemaVersion !== 1)
      throw new StorageError('unsupported_schema');
    object(data, ['schemaVersion', 'settings']);
    check(data.schemaVersion === 1);
    return validate(data.settings);
  } catch (error) {
    if (error instanceof StorageError && error.reason === 'unsupported_schema') throw error;
    throw new StorageError('corrupt');
  }
}
export function createSettingsRepository(backend: PreferenceBackend) {
  function run<T>(action: () => Promise<T>): Promise<T> {
    const next = (queues.get(backend) ?? Promise.resolve()).then(action);
    queues.set(
      backend,
      next.catch(() => {}),
    );
    return next;
  }
  async function read(): Promise<SavedSettings> {
    let raw: string | null;
    try {
      raw = (await backend.get({ key: KEY })).value;
    } catch (error) {
      throw storageError(error);
    }
    return raw === null ? { config: null, preferences: { ...DEFAULT_PREFERENCES } } : decode(raw);
  }
  return {
    read: () => run(read),
    save: async (input: SavedSettings) => {
      const snapshot = cloneInput(input);
      return run(async () => {
        const settings = validate(snapshot);
        await read();
        try {
          await backend.set({
            key: KEY,
            value: JSON.stringify({ schemaVersion: 1, settings }),
          });
        } catch (error) {
          throw storageError(error);
        }
      });
    },
  };
}

export type ReadingSettings = {
  schemaVersion: 2;
  selection: import('../contracts').SelectedModel | null;
  fontSize: number;
};
function readingSettings(value: unknown): ReadingSettings {
  object(value, ['schemaVersion', 'selection', 'fontSize']);
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== 2)
    throw new StorageError('unsupported_schema');
  check(value.schemaVersion === 2);
  integer(value.fontSize, 10);
  check(value.fontSize <= 48);
  if (value.selection !== null) selected(value.selection);
  return value as unknown as ReadingSettings;
}
export function createReadingSettingsRepository(backend: PreferenceBackend) {
  const key = 'narou-reader.reading-settings.v2';
  function run<T>(action: () => Promise<T>): Promise<T> {
    const task = (queues.get(backend) ?? Promise.resolve()).then(action);
    queues.set(
      backend,
      task.catch(() => {}),
    );
    return task;
  }
  async function read(): Promise<ReadingSettings> {
    let raw;
    try {
      raw = (await backend.get({ key })).value;
    } catch (error) {
      throw storageError(error);
    }
    if (raw === null) return { schemaVersion: 2, selection: null, fontSize: 18 };
    let value;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new StorageError('corrupt');
    }
    try {
      return readingSettings(value);
    } catch (error) {
      if (error instanceof StorageError && error.reason === 'unsupported_schema') throw error;
      throw new StorageError('corrupt');
    }
  }
  return {
    readReadingSettings: () => run(read),
    saveReadingSettings: (input: ReadingSettings) => {
      const value = cloneInput(input);
      return run(async () => {
        readingSettings(value);
        await read();
        const raw = JSON.stringify(value);
        try {
          await backend.set({ key, value: raw });
          check((await backend.get({ key })).value === raw);
        } catch (error) {
          throw storageError(error);
        }
      });
    },
  };
}
