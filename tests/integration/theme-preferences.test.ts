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

it('시스템 테마와 기본 읽기 화면으로 시작한다', async () => {
  const { controller } = controllerWith({ schemaVersion: 2, selection: null, fontSize: 18 });
  await controller.initialize();
  expect(controller.getSnapshot()).toMatchObject({
    theme: 'system',
    readingBackground: 'theme',
    lineHeight: 1.8,
  });
  controller.dispose();
});

it('저장한 테마를 복원하고 기본값 키는 생략한다', async () => {
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

it('허용하지 않은 테마 값은 적용하거나 저장하지 않는다', async () => {
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

it('테마 저장에 실패하면 다시 시도하라는 오류를 보여 준다', async () => {
  const controller = createRenewalController({
    settings: {
      readReadingSettings: async () => ({ schemaVersion: 2, selection: null, fontSize: 18 }),
      saveReadingSettings: async () => {
        throw new Error('synthetic save failure');
      },
    },
  });
  await controller.initialize();

  controller.changeTheme('dark');

  await vi.waitFor(() =>
    expect(controller.getSnapshot().error).toBe('설정을 저장하지 못했어요. 다시 시도해 주세요.'),
  );
  controller.dispose();
});

it('기존 홀수 글자 크기를 보존하고 명시한 2픽셀 조정만 저장한다', async () => {
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
