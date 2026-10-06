// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import { createReadingSettingsRepository } from '../../src/storage/settings';

afterEach(cleanup);
test('segmented settings are explicitly enabled, validated, persisted and restored without generation', async () => {
  const memory = new Map<string, string>();
  const settings = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  const generate = vi.fn();
  const dependencies = {
    settings,
    connect: async () => ({
      listModels: async () => [{ id: 'hy-mt2', displayName: 'Hy-MT2', supportsGeneration: true }],
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
  fireEvent.click(screen.getByRole('checkbox', { name: '컨텍스트에 맞춰 나누어 번역' }));
  expect(screen.getByLabelText('컨텍스트 크기 (토큰)')).toHaveValue(8192);
  fireEvent.change(screen.getByLabelText('구간 입력 예산 (추정 토큰)'), {
    target: { value: '1536' },
  });
  fireEvent.click(screen.getByRole('button', { name: '번역 크기 설정 저장' }));
  await waitFor(async () =>
    expect((await settings.readReadingSettings()).selection?.limits?.inputBudgetTokens).toBe(1536),
  );
  fireEvent.change(screen.getByLabelText('컨텍스트 크기 (토큰)'), { target: { value: '2048' } });
  fireEvent.click(screen.getByRole('button', { name: '번역 크기 설정 저장' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('컨텍스트 안에');
  expect(controller.getSnapshot().localLimits?.contextTokens).toBe(8192);
  const restarted = createRenewalController(dependencies);
  await restarted.initialize();
  expect(restarted.getSnapshot().localLimits).toEqual({
    contextTokens: 8192,
    inputBudgetTokens: 1536,
    maxOutputTokens: 4096,
  });
  expect(generate).not.toHaveBeenCalled();
  controller.dispose();
  restarted.dispose();
});
