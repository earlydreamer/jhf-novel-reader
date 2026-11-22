import { connectionConfig, selected } from './readingValidation';
import { validChapterUpdateDays } from '../app/chapterUpdateSchedule';
import type { PreferencesPlugin } from '@capacitor/preferences';
import type { SelectedModel } from '../contracts';
import { StorageError, storageError } from './errors';
import { check, integer, object, snapshot as cloneInput, text } from './validation';
export type PreferenceBackend = Pick<PreferencesPlugin, 'get' | 'set'> &
  Partial<Pick<PreferencesPlugin, 'remove'>>;
const queues = new WeakMap<PreferenceBackend, Promise<unknown>>();
export type ThemePreference = 'system' | 'light' | 'dark';
export type ReadingBackground = 'theme' | 'sepia' | 'black';
export type LineHeight = 1.6 | 1.8 | 2;
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const READING_BACKGROUNDS: readonly ReadingBackground[] = ['theme', 'sepia', 'black'];
export const LINE_HEIGHTS: readonly LineHeight[] = [1.6, 1.8, 2];
export type RememberedConnection = Pick<SelectedModel, 'connection' | 'translationMode'> & {
  modelId?: string;
};
export type ReadingSettings = {
  schemaVersion: 2;
  selection: SelectedModel | null;
  /** 모델 선택을 끝내기 전에도 제공자, 주소, 보안 저장소 참조를 기억한다. */
  configuredConnection?: RememberedConnection;
  inactiveConnection?: RememberedConnection;
  fontSize: number;
  autoTranslate?: boolean;
  autoRetryFailed?: boolean;
  autoGlossary?: boolean;
  chapterUpdateDays?: number;
  /** 리더 용어 강조. 끌 때만 false로 저장한다. */
  termHighlight?: boolean;
  lookupWikipedia?: boolean;
  lookupNamuwiki?: boolean;
  /** 기기 안 용어 판정 모델을 쓸지. 켜졌을 때만 저장한다. */
  onDeviceEmbedding?: boolean;
  theme?: ThemePreference;
  readingBackground?: ReadingBackground;
  lineHeight?: LineHeight;
};
function rememberedConnection(value: unknown): void {
  object(value, ['connection', 'modelId', 'translationMode']);
  connectionConfig(value.connection);
  check(
    value.translationMode === undefined ||
      value.translationMode === 'stream' ||
      value.translationMode === 'legacy',
  );
  if (value.modelId !== undefined) {
    text(value.modelId);
    check(value.modelId.length <= 256);
  }
}

function readingSettings(value: unknown): ReadingSettings {
  object(value, [
    'schemaVersion',
    'selection',
    'configuredConnection',
    'inactiveConnection',
    'fontSize',
    'autoTranslate',
    'autoRetryFailed',
    'autoGlossary',
    'chapterUpdateDays',
    'termHighlight',
    'lookupWikipedia',
    'lookupNamuwiki',
    'onDeviceEmbedding',
    'theme',
    'readingBackground',
    'lineHeight',
  ]);
  check(value.autoTranslate === undefined || typeof value.autoTranslate === 'boolean');
  check(value.autoRetryFailed === undefined || typeof value.autoRetryFailed === 'boolean');
  check(value.autoGlossary === undefined || typeof value.autoGlossary === 'boolean');
  check(
    value.chapterUpdateDays === undefined ||
      (typeof value.chapterUpdateDays === 'number' &&
        validChapterUpdateDays(value.chapterUpdateDays)),
  );
  check(value.termHighlight === undefined || typeof value.termHighlight === 'boolean');
  check(value.lookupWikipedia === undefined || typeof value.lookupWikipedia === 'boolean');
  check(value.lookupNamuwiki === undefined || typeof value.lookupNamuwiki === 'boolean');
  check(value.onDeviceEmbedding === undefined || typeof value.onDeviceEmbedding === 'boolean');
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
  if (value.configuredConnection !== undefined) rememberedConnection(value.configuredConnection);
  if (value.inactiveConnection !== undefined) rememberedConnection(value.inactiveConnection);
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
