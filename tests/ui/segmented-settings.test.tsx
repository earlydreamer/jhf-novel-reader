// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import { createReadingSettingsRepository } from '../../src/storage/settings';

afterEach(cleanup);
test('model selection derives internal budgets and refresh replaces stale capacity without token controls or generation', async () => {
  const memory = new Map<string, string>();
  const settings = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  const generate = vi.fn();
  let contextTokens = 16384;
  const dependencies = {
    settings,
    connect: async () => ({
      listModels: async () => [
        { id: 'hy-mt2', displayName: 'Hy-MT2', supportsGeneration: true, contextTokens },
      ],
      translateChapter: generate,
    }),
  };
  const controller = createRenewalController(dependencies);
  await controller.initialize();
  controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await controller.checkConnection();
  controller.chooseModel('hy-mt2');
  controller.navigate({ kind: 'settings' });
  render(<Application controller={controller} />);
  expect(screen.getAllByRole('switch')).toHaveLength(4);
  expect(screen.getByRole('switch', { name: '번역 전 용어집 자동 생성' })).toBeVisible();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/컨텍스트|입력 예산|출력 상한/)).not.toBeInTheDocument();
  await waitFor(async () =>
    expect((await settings.readReadingSettings()).selection?.limits).toEqual({
      contextTokens: 8192,
      inputBudgetTokens: 2048,
      maxOutputTokens: 4096,
    }),
  );
  const restarted = createRenewalController(dependencies);
  await restarted.initialize();
  expect(restarted.getSnapshot().localLimits).toBeUndefined();
  contextTokens = 4096;
  await restarted.checkConnection();
  expect(restarted.getSnapshot().localLimits).toEqual({
    contextTokens: 4096,
    inputBudgetTokens: 1024,
    maxOutputTokens: 2560,
  });
  expect(generate).not.toHaveBeenCalled();
  controller.dispose();
  restarted.dispose();
});
