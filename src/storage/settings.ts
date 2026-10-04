import type { PreferencesPlugin } from "@capacitor/preferences";
import {
  DEFAULT_PREFERENCES,
  type ProviderConfig,
  type ReaderPreferences,
} from "../contracts";
import { StorageError, storageError } from "./errors";
import {
  check,
  integer,
  object,
  record,
  text,
  url,
  snapshot as cloneInput,
} from "./validation";
import { secretRef } from "./secrets";
export type PreferenceBackend = Pick<PreferencesPlugin, "get" | "set">;
export interface SavedSettings {
  config: ProviderConfig | null;
  preferences: ReaderPreferences;
}
const KEY = "narou-reader.settings.v1";
const queues = new WeakMap<PreferenceBackend, Promise<unknown>>();
function validate(value: unknown): SavedSettings {
  object(value, ["config", "preferences"]);
  object(value.preferences, ["fontSize", "prefetchEnabled"]);
  integer(value.preferences.fontSize, 10);
  check(value.preferences.fontSize <= 48);
  check(typeof value.preferences.prefetchEnabled === "boolean");
  if (value.config !== null) {
    object(value.config, [
      "provider",
      "baseUrl",
      "model",
      "authRef",
      "contextBudget",
      "outputBudget",
      "settingsRevision",
    ]);
    const c = value.config;
    check(c.provider === "openai-compatible" || c.provider === "gemini");
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
    if (typeof data.schemaVersion === "number" && data.schemaVersion !== 1)
      throw new StorageError("unsupported_schema");
    object(data, ["schemaVersion", "settings"]);
    check(data.schemaVersion === 1);
    return validate(data.settings);
  } catch (error) {
    if (error instanceof StorageError && error.reason === "unsupported_schema")
      throw error;
    throw new StorageError("corrupt");
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
    return raw === null
      ? { config: null, preferences: { ...DEFAULT_PREFERENCES } }
      : decode(raw);
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
