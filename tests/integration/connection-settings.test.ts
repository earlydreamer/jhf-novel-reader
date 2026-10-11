import { afterEach, expect, it } from 'vitest';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type { ConnectionConfig, ModelChoice, SelectedModel } from '../../src/contracts/reading';
import { createReadingSettingsRepository } from '../../src/storage/settings';

const connection: ConnectionConfig = {
  provider: 'openai-compatible',
  baseUrl: 'http://synthetic.example.test:1234/v1',
  authRef: 'provider.synthetic',
  revision: 7,
};
const model: ModelChoice = {
  id: 'synthetic-model',
  displayName: 'Synthetic model',
  supportsGeneration: true,
  contextTokens: 8192,
};
const selection = { connection, modelId: model.id, translationMode: 'legacy' as const };
type CatalogResult = Awaited<ReturnType<NonNullable<RenewalDependencies['catalog']>>>;
type PendingCheck = {
  connection: ConnectionConfig;
  signal: AbortSignal;
  resolve(value: CatalogResult): void;
  reject(error: unknown): void;
};
const controllers: ReturnType<typeof createRenewalController>[] = [];
afterEach(() => {
  for (const app of controllers.splice(0)) app.dispose();
});

async function harness(dependencies: Partial<RenewalDependencies> = {}) {
  const values = new Map<string, string>();
  const settings = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: values.get(key) ?? null }),
    set: async ({ key, value }) => {
      values.set(key, value);
    },
  });
  await settings.saveReadingSettings({ schemaVersion: 2, selection, fontSize: 18 });
  const checks: PendingCheck[] = [];
  function createApp() {
    const app = createRenewalController({
      ...dependencies,
      settings,
      // 취소를 무시하고 늦게 끝나는 응답도 컨트롤러가 버리는지 검증한다.
      catalog: (config, _secret, signal) =>
        new Promise<CatalogResult>((resolve, reject) => {
          checks.push({ connection: config, signal, resolve, reject });
        }),
    });
    controllers.push(app);
    return app;
  }
  const app = createApp();
  await app.initialize();
  async function restart() {
    app.dispose();
    const restarted = createApp();
    await restarted.initialize();
    return restarted;
  }
  return { app, checks, settings, restart };
}

it('기존 모델을 보존해도 재확인이 끝나기 전에는 본문 번역을 실행하지 않는다', async () => {
  const generated: SelectedModel[] = [];
  const h = await harness({
    startTranslation: async (_chapter, selected) => {
      generated.push(selected);
    },
  });
  h.app.changeAutoTranslate(false);
  const checking = h.app.checkConnection();
  await h.app.selectChapter({
    workId: 'n1234ab',
    chapterId: 'n1234ab/1',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
    title: '합성 회차',
    ordinal: 1,
  });
  expect(h.app.getSnapshot()).toMatchObject({
    catalogStatus: 'checking',
    selectedModelId: model.id,
  });
  await h.app.translate();
  expect(generated).toEqual([]);

  h.checks[0]!.resolve({ connection: h.checks[0]!.connection, models: [model] });
  await checking;
  await h.app.translate();
  expect(generated).toHaveLength(1);
  expect(generated[0]).toMatchObject({ connection: h.checks[0]!.connection, modelId: model.id });
});

it.each([
  [
    '테마',
    (app: ReturnType<typeof createRenewalController>) => app.changeTheme('dark'),
    { theme: 'dark' },
  ],
  [
    '글자 크기',
    (app: ReturnType<typeof createRenewalController>) => app.changeFontSize(24),
    { fontSize: 24 },
  ],
] as const)(
  '재확인 중 %s 저장 뒤 연결이 실패해도 재시작할 선택을 보존한다',
  async (_name, change, expected) => {
    const h = await harness();
    const checking = h.app.checkConnection();
    change(h.app);
    await expect.poll(() => h.settings.readReadingSettings()).toMatchObject(expected);
    const duringCheck = await h.settings.readReadingSettings();
    h.checks[0]!.reject(new ReaderError('connection'));
    await checking;

    expect(duringCheck.selection).toMatchObject({
      ...selection,
      connection: { ...connection, revision: connection.revision + 1 },
    });
    expect(h.app.getSnapshot()).toMatchObject({
      catalogStatus: 'connection',
      selectedModelId: model.id,
    });
    const restarted = await h.restart();
    expect(restarted.getSnapshot()).toMatchObject({
      ...expected,
      connection: { ...connection, revision: connection.revision + 1 },
      selectedModelId: model.id,
      catalogStatus: 'idle',
    });
  },
);

it('재확인이 성공하면 보존한 모델과 새 연결 정보를 함께 저장한다', async () => {
  const h = await harness();
  const checking = h.app.checkConnection();
  h.app.changeTheme('dark');
  h.app.changeFontSize(24);
  await expect
    .poll(() => h.settings.readReadingSettings())
    .toMatchObject({ theme: 'dark', fontSize: 24 });
  const duringCheck = await h.settings.readReadingSettings();
  const accepted = { ...h.checks[0]!.connection, authRef: 'provider.synthetic-replacement' };
  h.checks[0]!.resolve({ connection: accepted, models: [model] });
  await checking;
  await expect
    .poll(() => h.settings.readReadingSettings())
    .toMatchObject({
      selection: { connection: accepted, modelId: model.id },
    });

  expect(duringCheck.selection?.connection.authRef).toBe(connection.authRef);
  const restarted = await h.restart();
  expect(restarted.getSnapshot()).toMatchObject({
    theme: 'dark',
    fontSize: 24,
    connection: accepted,
    selectedModelId: model.id,
  });
});

it('재확인이 끝나기 전에 앱을 닫아도 다른 설정과 기존 선택을 함께 복원한다', async () => {
  const h = await harness();
  const checking = h.app.checkConnection();
  h.app.changeTheme('dark');
  await expect.poll(() => h.settings.readReadingSettings()).toMatchObject({ theme: 'dark' });
  const restarted = await h.restart();
  expect(h.checks[0]!.signal.aborted).toBe(true);
  h.checks[0]!.resolve({ connection: h.checks[0]!.connection, models: [] });
  await expect(checking).resolves.toEqual({ kind: 'superseded' });

  expect(restarted.getSnapshot()).toMatchObject({
    theme: 'dark',
    selectedModelId: model.id,
    connection: { ...connection, revision: connection.revision + 1 },
  });
  expect((await h.settings.readReadingSettings()).selection?.modelId).toBe(model.id);
});

it('겹친 재확인이 앞선 확인을 취소해도 마지막 선택을 잃지 않는다', async () => {
  const h = await harness();
  const first = h.app.checkConnection();
  const second = h.app.checkConnection();
  expect(h.checks[0]!.signal.aborted).toBe(true);
  h.app.changeFontSize(24);
  h.checks[1]!.resolve({ connection: h.checks[1]!.connection, models: [model] });
  await second;
  h.checks[0]!.resolve({ connection: h.checks[0]!.connection, models: [] });
  await expect(first).resolves.toEqual({ kind: 'superseded' });
  await expect.poll(() => h.settings.readReadingSettings()).toMatchObject({ fontSize: 24 });

  expect(h.app.getSnapshot()).toMatchObject({
    catalogStatus: 'connected',
    selectedModelId: model.id,
  });
  expect((await h.restart()).getSnapshot()).toMatchObject({
    fontSize: 24,
    selectedModelId: model.id,
  });
});

it.each(['http://other.example.test:8080/v1', ''])(
  '재확인 중 실제 주소를 %s로 바꾸면 기존 선택을 지운다',
  async (baseUrl) => {
    const h = await harness();
    const checking = h.app.checkConnection();
    h.app.changeTheme('dark');
    h.app.changeConnection({ provider: 'openai-compatible', baseUrl });
    h.app.changeFontSize(24);
    h.checks[0]!.resolve({ connection: h.checks[0]!.connection, models: [model] });
    await expect(checking).resolves.toEqual({ kind: 'superseded' });
    await expect
      .poll(() => h.settings.readReadingSettings())
      .toMatchObject({ fontSize: 24, selection: null });

    expect(h.checks[0]!.signal.aborted).toBe(true);
    expect(h.app.getSnapshot()).toMatchObject({ connection: { baseUrl }, selectedModelId: null });
    expect(h.app.getSnapshot().connection.authRef).toBeUndefined();
    const restarted = await h.restart();
    expect(restarted.getSnapshot().selectedModelId).toBeNull();
    expect(restarted.getSnapshot().connection.authRef).toBeUndefined();
  },
);

it.each([
  ['model_missing', [{ ...model, id: 'other-model' }]],
  ['empty', []],
  ['empty', [{ ...model, supportsGeneration: false }]],
] as const)(
  '재확인 응답이 %s이면 더 이상 쓸 수 없는 모델 선택은 지운다',
  async (status, models) => {
    const h = await harness();
    const checking = h.app.checkConnection();
    h.app.changeFontSize(24);
    h.checks[0]!.resolve({ connection: h.checks[0]!.connection, models });
    await checking;
    await expect
      .poll(() => h.settings.readReadingSettings())
      .toMatchObject({ fontSize: 24, selection: null });

    expect(h.app.getSnapshot()).toMatchObject({ catalogStatus: status, selectedModelId: null });
    expect((await h.restart()).getSnapshot().selectedModelId).toBeNull();
  },
);
