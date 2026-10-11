// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, expect, it } from 'vitest';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import type { ConnectionConfig, ModelChoice } from '../../src/contracts/reading';
import { createReadingSettingsRepository } from '../../src/storage/settings';
import type { BatchState, BatchTranslation } from '../../src/translation/batch';
import { SettingsScreen } from '../../src/ui/SettingsScreen';
import { SnackbarProvider } from '../../src/ui/components/Snackbar';

const baseUrl = 'http://synthetic.example.test:1234/v1';
const models: readonly ModelChoice[] = [
  {
    id: 'synthetic-model',
    displayName: 'Synthetic model',
    supportsGeneration: true,
    contextTokens: 8192,
  },
];
const controllers: ReturnType<typeof createRenewalController>[] = [];
afterEach(() => {
  cleanup();
  for (const app of controllers.splice(0)) app.dispose();
});

async function harness(address = baseUrl, dependencies: Partial<RenewalDependencies> = {}) {
  const values = new Map<string, string>();
  let writes = 0;
  const settings = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: values.get(key) ?? null }),
    set: async ({ key, value }) => {
      writes++;
      values.set(key, value);
    },
  });
  await settings.saveReadingSettings({
    schemaVersion: 2,
    fontSize: 18,
    selection: {
      connection: {
        provider: 'openai-compatible',
        baseUrl: address,
        authRef: 'provider.synthetic',
        revision: 7,
      },
      modelId: models[0]!.id,
      translationMode: 'legacy',
    },
  });
  const requests: { connection: ConnectionConfig; signal: AbortSignal }[] = [];
  let nextListing: Promise<readonly ModelChoice[]> | undefined;
  const app = createRenewalController({
    ...dependencies,
    settings,
    catalog: async (connection, _secret, signal) => {
      requests.push({ connection, signal });
      const listing = nextListing;
      nextListing = undefined;
      // 취소를 무시하는 늦은 응답도 컨트롤러가 폐기해야 한다.
      return { connection, models: listing ? await listing : models };
    },
  });
  controllers.push(app);
  await app.initialize();
  await app.checkConnection();
  await expect
    .poll(() => settings.readReadingSettings())
    .toMatchObject({
      selection: { connection: { revision: app.getSnapshot().connection.revision } },
    });
  function holdNextCheck() {
    let resolve!: (value: readonly ModelChoice[]) => void;
    nextListing = new Promise((done) => {
      resolve = done;
    });
    return () => resolve(models);
  }
  return { app, requests, settings, holdNextCheck, writes: () => writes };
}

function LiveSettings({ app }: { app: ReturnType<typeof createRenewalController> }) {
  const state = useSyncExternalStore(app.subscribe, app.getSnapshot);
  return (
    <SnackbarProvider>
      <SettingsScreen
        state={state}
        onChange={app.changeConnection}
        onCheck={app.checkConnection}
        onSelect={app.chooseModel}
      />
    </SnackbarProvider>
  );
}

it('전체 주소에 같은 목적지인 슬래시를 적은 뒤 새 API 경로를 계속 입력할 수 있다', async () => {
  const address = 'http://synthetic.example.test:1234';
  const h = await harness(address);
  const before = h.app.getSnapshot();
  const writes = h.writes();
  render(<LiveSettings app={h.app} />);
  const input = screen.getByLabelText('API 기본 주소');
  const user = userEvent.setup();

  await user.type(input, '/');
  expect(input).toHaveValue(address + '/');
  expect(h.app.getSnapshot()).toBe(before);
  expect(h.writes()).toBe(writes);

  await user.type(input, 'proxy/v1');
  expect(input).toHaveValue(address + '/proxy/v1');
  expect(h.app.getSnapshot().connection.baseUrl).toBe(address + '/proxy/v1');
  expect(h.app.getSnapshot().connection.authRef).toBeUndefined();
  expect(h.app.getSnapshot().selectedModelId).toBeNull();
  expect(h.requests).toHaveLength(1);
});

it('전체 주소 초안이 있어도 외부에서 실제 연결을 바꾸면 새 주소를 표시한다', async () => {
  const address = 'http://synthetic.example.test:1234';
  const h = await harness(address);
  render(<LiveSettings app={h.app} />);
  const input = screen.getByLabelText('API 기본 주소');
  await userEvent.setup().type(input, '/');
  expect(input).toHaveValue(address + '/');

  act(() => h.app.changeConnection({ provider: 'openai-compatible', baseUrl }));
  // 같은 서버의 /v1 재선택은 초안을 지우지 않는다.
  expect(input).toHaveValue(address + '/');
  const other = 'http://other.example.test:8080/v1';
  act(() => h.app.changeConnection({ provider: 'openai-compatible', baseUrl: other }));
  expect(input).toHaveValue(other);
  act(() => h.app.changeConnection({ provider: 'openai-compatible', baseUrl: address }));
  expect(input).toHaveValue(address);
});

it('미리 번역 중 거절된 전체 주소 편집이 종료 뒤에도 표시와 실제 연결을 어긋나게 하지 않는다', async () => {
  let state: BatchState = { record: null, active: false, preparing: false, error: null };
  let notify = (_state: BatchState) => {};
  const noWork = async () => {};
  const batch: BatchTranslation = {
    get active() {
      return state.active;
    },
    getSnapshot: () => state,
    subscribe: (listener) => {
      notify = listener;
      return () => {};
    },
    initialize: noWork,
    prepare: noWork,
    run: noWork,
    scan: noWork,
    scanChapters: async () => [],
    confirmCandidates: noWork,
    retrySave: noWork,
    cancel() {},
    clearWork: () => false,
    dismissNotice() {},
    setForeground() {},
    dispose() {},
  };
  const address = 'http://synthetic.example.test:1234';
  const h = await harness(address, { batch });
  render(<LiveSettings app={h.app} />);
  const input = screen.getByLabelText('API 기본 주소');
  act(() => {
    state = { ...state, active: true };
    notify(state);
  });
  fireEvent.change(input, { target: { value: 'http://other.example.test:8080/v1' } });
  expect(input).toBeDisabled();
  expect(input).toHaveValue(address);

  act(() => {
    state = { ...state, active: false };
    notify(state);
  });
  expect(input).not.toBeDisabled();
  expect(input).toHaveValue(address);
  await act(async () => {
    await h.app.checkConnection();
  });
  expect(h.requests[1]!.connection).toMatchObject({
    baseUrl: address,
    authRef: 'provider.synthetic',
  });
  expect(h.app.getSnapshot().selectedModelId).toBe(models[0]!.id);
});

it.each([
  ['LM Studio 1234', '1234'],
  ['Ollama 11434', '11434'],
  ['llama.cpp 8080', '8080'],
])('이미 선택한 %s 칩을 다시 눌러도 연결과 저장값을 유지한다', async (label, port) => {
  const h = await harness(`http://synthetic.example.test:${port}/v1`);
  const before = h.app.getSnapshot();
  const saved = await h.settings.readReadingSettings();
  const writes = h.writes();
  render(
    <SnackbarProvider>
      <SettingsScreen
        state={before}
        onChange={h.app.changeConnection}
        onCheck={h.app.checkConnection}
        onSelect={h.app.chooseModel}
      />
    </SnackbarProvider>,
  );
  const chip = screen.getByRole('button', { name: label });
  expect(chip).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(chip);

  expect(h.app.getSnapshot()).toBe(before);
  expect(await h.settings.readReadingSettings()).toEqual(saved);
  expect(h.writes()).toBe(writes);
  expect(h.requests).toHaveLength(1);
});

it.each([
  ['http://synthetic.example.test/v1', 'http://synthetic.example.test'],
  ['http://synthetic.example.test/v1', ' HTTP://SYNTHETIC.EXAMPLE.TEST:80/ '],
  ['http://synthetic.example.test/v1', 'http://synthetic.example.test/v1///'],
  ['https://synthetic.example.test/v1', 'https://SYNTHETIC.EXAMPLE.TEST:443/v1/'],
  ['http://synthetic.example.test/proxy/v1', 'http://synthetic.example.test/proxy/v1/'],
  ['http://[::1]/v1', 'http://[0:0:0:0:0:0:0:1]:80/'],
])('같은 목적지인 %s → %s는 인증·모델·revision·저장값을 그대로 둔다', async (current, next) => {
  const h = await harness(current);
  const before = h.app.getSnapshot();
  const saved = await h.settings.readReadingSettings();
  const writes = h.writes();

  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: next });

  expect(h.app.getSnapshot()).toBe(before);
  expect(await h.settings.readReadingSettings()).toEqual(saved);
  expect(h.writes()).toBe(writes);
  expect(h.requests).toHaveLength(1);
});

it('재확인 중 같은 주소를 다시 고르면 확인을 취소하거나 임시 상태를 저장하지 않는다', async () => {
  const h = await harness();
  const release = h.holdNextCheck();
  const checking = h.app.checkConnection();
  const before = h.app.getSnapshot();
  const saved = await h.settings.readReadingSettings();
  const writes = h.writes();

  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: baseUrl + '/' });
  const after = h.app.getSnapshot();
  const aborted = h.requests[1]!.signal.aborted;
  const savedDuringCheck = await h.settings.readReadingSettings();
  const writesDuringCheck = h.writes();
  release();
  const result = await checking;

  expect(after).toBe(before);
  expect(aborted).toBe(false);
  expect(savedDuringCheck).toEqual(saved);
  expect(writesDuringCheck).toBe(writes);
  expect(result).toMatchObject({ kind: 'done', status: 'connected' });
  expect(h.app.getSnapshot().selectedModelId).toBe(models[0]!.id);
});

it.each([
  { provider: 'openai-compatible' as const, baseUrl: 'http://other.example.test:1234/v1' },
  { provider: 'openai-compatible' as const, baseUrl: 'http://synthetic.example.test:8080/v1' },
  { provider: 'openai-compatible' as const, baseUrl: 'https://synthetic.example.test:1234/v1' },
  {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://synthetic.example.test:1234/proxy/v1',
  },
  { provider: 'openai-compatible' as const, baseUrl: baseUrl + '?mode=1' },
  { provider: 'openai-compatible' as const, baseUrl: baseUrl + '?' },
  { provider: 'openai-compatible' as const, baseUrl: baseUrl + '#part' },
  { provider: 'openai-compatible' as const, baseUrl: baseUrl + '#' },
  { provider: 'openai-compatible' as const, baseUrl: 'http://user@synthetic.example.test:1234/v1' },
  { provider: 'openai-compatible' as const, baseUrl: baseUrl + '/chat/completions' },
  { provider: 'openai-compatible' as const, baseUrl: '' },
  { provider: 'gemini' as const, baseUrl },
])('실제 목적지·제공자 변경 또는 잘못된 입력 $baseUrl 은 기존 선택을 지운다', async (input) => {
  const h = await harness();
  const revision = h.app.getSnapshot().connection.revision;

  h.app.changeConnection(input);

  expect(h.app.getSnapshot()).toMatchObject({
    connection: { ...input, revision: revision + 1 },
    selectedModelId: null,
    models: [],
    catalogStatus: 'idle',
  });
  expect(h.app.getSnapshot().connection.authRef).toBeUndefined();
  expect(h.app.getSnapshot().localLimits).toBeUndefined();
  await expect.poll(() => h.settings.readReadingSettings()).toMatchObject({ selection: null });
  expect(h.requests).toHaveLength(1);
});

it('실제 주소를 바꾼 뒤 늦게 끝난 이전 확인은 인증과 모델을 되살리지 못한다', async () => {
  const h = await harness();
  const release = h.holdNextCheck();
  const checking = h.app.checkConnection();
  const changed = {
    provider: 'openai-compatible' as const,
    baseUrl: 'http://other.example.test:8080/v1',
  };

  h.app.changeConnection(changed);
  release();

  await expect(checking).resolves.toEqual({ kind: 'superseded' });
  expect(h.requests[1]!.signal.aborted).toBe(true);
  expect(h.app.getSnapshot()).toMatchObject({
    connection: changed,
    selectedModelId: null,
    models: [],
  });
  expect(h.app.getSnapshot().connection.authRef).toBeUndefined();
  await expect.poll(() => h.settings.readReadingSettings()).toMatchObject({ selection: null });
});
