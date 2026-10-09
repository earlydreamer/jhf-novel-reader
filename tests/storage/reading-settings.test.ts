import { expect, test } from 'vitest';
import { createReadingSettingsRepository } from '../../src/storage/settings';
test('v2 settings are separate and contain references only', async () => {
  const memory = new Map<string, string>([['narou-reader.settings.v1', 'legacy']]);
  const repository = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  expect(await repository.readReadingSettings()).toEqual({
    schemaVersion: 2,
    selection: null,
    fontSize: 18,
  });
  const settings = {
    schemaVersion: 2 as const,
    selection: {
      connection: {
        provider: 'openai-compatible' as const,
        baseUrl: 'http://localhost:1234',
        authRef: 'secret-ref',
        revision: 1,
      },
      modelId: 'actual',
      limits: { contextTokens: 8192, inputBudgetTokens: 2048, maxOutputTokens: 4096 },
    },
    fontSize: 20,
  };
  await repository.saveReadingSettings(settings);
  expect(await repository.readReadingSettings()).toEqual(settings);
  expect(memory.get('narou-reader.settings.v1')).toBe('legacy');
  await expect(repository.saveReadingSettings({ ...settings, fontSize: 1 })).rejects.toThrow();
});
test('v2 settings keep optional theme and reading view preferences', async () => {
  const memory = new Map<string, string>();
  const repository = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  const settings = {
    schemaVersion: 2 as const,
    selection: null,
    fontSize: 18,
    theme: 'dark' as const,
    readingBackground: 'sepia' as const,
    lineHeight: 2 as const,
  };
  await repository.saveReadingSettings(settings);
  expect(await repository.readReadingSettings()).toEqual(settings);
  await expect(
    repository.saveReadingSettings({ ...settings, theme: 'neon' as never }),
  ).rejects.toThrow();
  await expect(
    repository.saveReadingSettings({ ...settings, readingBackground: 'blue' as never }),
  ).rejects.toThrow();
  await expect(
    repository.saveReadingSettings({ ...settings, lineHeight: 1.7 as never }),
  ).rejects.toThrow();
});
test('v2 settings saved before theme preferences still read unchanged', async () => {
  const stored = JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 22 });
  const repository = createReadingSettingsRepository({
    get: async () => ({ value: stored }),
    set: async () => {},
  });
  expect(await repository.readReadingSettings()).toEqual({
    schemaVersion: 2,
    selection: null,
    fontSize: 22,
  });
});

test('v2 settings keep the automatic glossary preference and reject non-boolean values', async () => {
  const memory = new Map<string, string>();
  const repository = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  const settings = {
    schemaVersion: 2 as const,
    selection: null,
    fontSize: 18,
    autoGlossary: false,
  };
  await repository.saveReadingSettings(settings);
  expect(await repository.readReadingSettings()).toEqual(settings);
  await expect(
    repository.saveReadingSettings({ ...settings, autoGlossary: 'off' as never }),
  ).rejects.toThrow();
});

test('v2 settings keep the term scan lookup preferences and reject non-boolean values', async () => {
  const memory = new Map<string, string>();
  const repository = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  const settings = {
    schemaVersion: 2 as const,
    selection: null,
    fontSize: 18,
    lookupWikipedia: true,
    lookupNamuwiki: false,
  };
  await repository.saveReadingSettings(settings);
  expect(await repository.readReadingSettings()).toEqual(settings);
  await expect(
    repository.saveReadingSettings({ ...settings, lookupWikipedia: 'on' as never }),
  ).rejects.toThrow();
  await expect(
    repository.saveReadingSettings({ ...settings, lookupNamuwiki: 1 as never }),
  ).rejects.toThrow();
});
