import { expect, it, vi } from 'vitest';
import { createRenewalController } from '../../src/app/renewalController';
import type { ReadingSettings } from '../../src/storage/settings';

function controllerWith(saved: ReadingSettings) {
  const saveReadingSettings = vi.fn(async (_value: ReadingSettings) => {});
  const controller = createRenewalController({
    settings: { readReadingSettings: async () => saved, saveReadingSettings },
  });
  return { controller, saveReadingSettings };
}

it('defaults to the system theme and default reading view', async () => {
  const { controller } = controllerWith({ schemaVersion: 2, selection: null, fontSize: 18 });
  await controller.initialize();
  expect(controller.getSnapshot()).toMatchObject({
    theme: 'system',
    readingBackground: 'theme',
    lineHeight: 1.8,
  });
  controller.dispose();
});

it('restores saved preferences and persists changes without default keys', async () => {
  const { controller, saveReadingSettings } = controllerWith({
    schemaVersion: 2,
    selection: null,
    fontSize: 18,
    theme: 'dark',
  });
  await controller.initialize();
  expect(controller.getSnapshot().theme).toBe('dark');
  controller.changeReadingBackground('sepia');
  controller.changeLineHeight(2);
  controller.changeTheme('system');
  await vi.waitFor(() => expect(saveReadingSettings).toHaveBeenCalledTimes(3));
  const last = saveReadingSettings.mock.calls.at(-1)![0];
  expect(last).toMatchObject({ readingBackground: 'sepia', lineHeight: 2 });
  expect(last).not.toHaveProperty('theme');
  controller.dispose();
});

it('ignores values outside the allowed preferences', async () => {
  const { controller, saveReadingSettings } = controllerWith({
    schemaVersion: 2,
    selection: null,
    fontSize: 18,
  });
  await controller.initialize();
  controller.changeTheme('neon' as never);
  controller.changeLineHeight(3 as never);
  controller.changeReadingBackground('blue' as never);
  expect(controller.getSnapshot()).toMatchObject({
    theme: 'system',
    lineHeight: 1.8,
    readingBackground: 'theme',
  });
  expect(saveReadingSettings).not.toHaveBeenCalled();
  controller.dispose();
});

it('preserves an odd legacy reading size on restore and persists only the explicit two-pixel adjustment', async () => {
  let persisted: ReadingSettings = { schemaVersion: 2, selection: null, fontSize: 19 };
  const saveReadingSettings = vi.fn(async (value: ReadingSettings) => {
    persisted = value;
  });
  const create = () =>
    createRenewalController({
      settings: {
        readReadingSettings: async () => persisted,
        saveReadingSettings,
      },
    });

  const first = create();
  await first.initialize();
  expect(first.getSnapshot().fontSize).toBe(19);
  expect(saveReadingSettings).not.toHaveBeenCalled();
  first.changeFontSize(21);
  await vi.waitFor(() => expect(saveReadingSettings).toHaveBeenCalledTimes(1));
  expect(persisted.fontSize).toBe(21);
  first.dispose();

  const restored = create();
  await restored.initialize();
  expect(restored.getSnapshot().fontSize).toBe(21);
  restored.dispose();
});
