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
    },
    fontSize: 20,
  };
  await repository.saveReadingSettings(settings);
  expect(await repository.readReadingSettings()).toEqual(settings);
  expect(memory.get('narou-reader.settings.v1')).toBe('legacy');
  await expect(repository.saveReadingSettings({ ...settings, fontSize: 1 })).rejects.toThrow();
});
