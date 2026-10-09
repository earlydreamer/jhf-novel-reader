import { selected } from './readingValidation';
import type { PreferencesPlugin } from '@capacitor/preferences';
import { StorageError, storageError } from './errors';
import { check, integer, object, snapshot as cloneInput } from './validation';
export type PreferenceBackend = Pick<PreferencesPlugin, 'get' | 'set'> &
  Partial<Pick<PreferencesPlugin, 'remove'>>;
const queues = new WeakMap<PreferenceBackend, Promise<unknown>>();
export type ThemePreference = 'system' | 'light' | 'dark';
export type ReadingBackground = 'theme' | 'sepia' | 'black';
export type LineHeight = 1.6 | 1.8 | 2;
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const READING_BACKGROUNDS: readonly ReadingBackground[] = ['theme', 'sepia', 'black'];
export const LINE_HEIGHTS: readonly LineHeight[] = [1.6, 1.8, 2];
export type ReadingSettings = {
  schemaVersion: 2;
  selection: import('../contracts').SelectedModel | null;
  fontSize: number;
  autoTranslate?: boolean;
  autoRetryFailed?: boolean;
  autoGlossary?: boolean;
  lookupWikipedia?: boolean;
  lookupNamuwiki?: boolean;
  theme?: ThemePreference;
  readingBackground?: ReadingBackground;
  lineHeight?: LineHeight;
};
function readingSettings(value: unknown): ReadingSettings {
  object(value, [
    'schemaVersion',
    'selection',
    'fontSize',
    'autoTranslate',
    'autoRetryFailed',
    'autoGlossary',
    'lookupWikipedia',
    'lookupNamuwiki',
    'theme',
    'readingBackground',
    'lineHeight',
  ]);
  check(value.autoTranslate === undefined || typeof value.autoTranslate === 'boolean');
  check(value.autoRetryFailed === undefined || typeof value.autoRetryFailed === 'boolean');
  check(value.autoGlossary === undefined || typeof value.autoGlossary === 'boolean');
  check(value.lookupWikipedia === undefined || typeof value.lookupWikipedia === 'boolean');
  check(value.lookupNamuwiki === undefined || typeof value.lookupNamuwiki === 'boolean');
  check(value.theme === undefined || THEME_PREFERENCES.includes(value.theme as ThemePreference));
  check(
    value.readingBackground === undefined ||
      READING_BACKGROUNDS.includes(value.readingBackground as ReadingBackground),
  );
  check(value.lineHeight === undefined || LINE_HEIGHTS.includes(value.lineHeight as LineHeight));
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
