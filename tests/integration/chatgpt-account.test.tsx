// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalApplication } from '../../src/app/compose';
import type { RenewalController } from '../../src/app/renewalController';
import {
  ReaderError,
  type ChatGptAccount,
  type ChatGptAccountState,
  type ChatGptConnectOutcome,
  type HttpResponse,
  type NativeHttpClient,
} from '../../src/contracts';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import type { ShellPlatform } from '../../src/platform/shell';
import { CHATGPT_BASE_URL } from '../../src/providers/chatgpt';

vi.mock('@capacitor/app', () => ({
  App: { getInfo: vi.fn(async () => ({ name: 'JHF', id: 'x', build: '0', version: '0.0.0' })) },
}));

const SETTINGS_KEY = 'narou-reader.reading-settings.v2';
const MODELS = {
  models: [
    { slug: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' },
    { slug: 'gpt-6.1-mini', displayName: 'GPT-6.1 mini' },
  ],
};

function fakeAccount(options: { outcome?: ChatGptConnectOutcome; revoked?: boolean } = {}) {
  let state: ChatGptAccountState = 'disconnected';
  let modelResponse: HttpResponse | ReaderError = {
    status: 200,
    headers: {},
    url: `${CHATGPT_BASE_URL}/models`,
    data: MODELS,
  };
  let release: (() => void) | null = null;
  const account: ChatGptAccount & { calls: string[] } = {
    calls: [],
    async status() {
      return state;
    },
    async connect() {
      account.calls.push('connect');
      // 브라우저 로그인이 끝날 때까지 기다리는 동안 취소할 수 있다.
      await new Promise<void>((resolve) => {
        release = resolve;
        if (options.outcome !== undefined) resolve();
      });
      const outcome = options.outcome ?? 'cancelled';
      if (outcome === 'connected') state = 'connected';
      return outcome;
    },
    async cancelConnect() {
      account.calls.push('cancel');
      release?.();
    },
    async disconnect() {
      account.calls.push('disconnect');
      const hadSession = state !== 'disconnected';
      state = 'disconnected';
      return { revoked: options.revoked ?? true, hadSession };
    },
    async models() {
      account.calls.push('models');
      if (modelResponse instanceof ReaderError) throw modelResponse;
      return modelResponse;
    },
    async respond() {
      throw new ReaderError('connection', 'not_sent');
    },
  };
  return {
    account,
    setState(next: ChatGptAccountState) {
      state = next;
    },
    failModels(error: ReaderError | HttpResponse) {
      modelResponse = error;
    },
  };
}

const unusedClient: NativeHttpClient = {
  async request(input) {
    throw new Error(`Unexpected request: ${input.url}`);
  },
};

const apps: RenewalController[] = [];
function application(
  account: ChatGptAccount | undefined,
  preferences = new Map<string, string>([
    [SETTINGS_KEY, JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 18 })],
  ]),
) {
  const app = createRenewalApplication({
    files: { read: async () => null, write: async () => {} },
    preferences: {
      get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        preferences.set(key, value);
      },
    },
    secrets: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
    },
    lifecycle: { isActive: async () => true, subscribe: async () => async () => {} },
    sourceTransport: createSourceTransport(unusedClient),
    modelTransport: createModelTransport(unusedClient),
    ...(account ? { chatgpt: account } : {}),
  });
  apps.push(app);
  return { app, preferences };
}

function shell(): ShellPlatform {
  return {
    onBackButton: () => () => {},
    moveToBackground: vi.fn(),
    setSystemBarsTheme: vi.fn(),
    setKeepAwake: vi.fn(),
    markReady: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  apps.splice(0).forEach((app) => app.dispose());
});

describe('ChatGPT 계정 연결', () => {
  it('로그인 뒤 모델 목록을 읽고, 선택한 연결을 토큰 없이 저장해 다시 연다', async () => {
    const fake = fakeAccount({ outcome: 'connected' });
    const { app, preferences } = application(fake.account);
    await app.initialize();
    await waitFor(() => expect(app.getSnapshot().chatgptAccount).toBe('disconnected'));

    app.changeConnection({ provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL });
    expect(app.getSnapshot().translationMode).toBe('stream');
    await app.connectChatGpt();
    expect(app.getSnapshot()).toMatchObject({
      chatgptAccount: 'connected',
      chatgptNotice: { kind: 'connect', outcome: 'connected' },
      catalogStatus: 'connected',
    });
    expect(app.getSnapshot().models.map((model) => model.id)).toEqual([
      'gpt-6.1-sol',
      'gpt-6.1-mini',
    ]);
    app.chooseModel('gpt-6.1-sol');
    app.acknowledgeChatGptWelcome();
    await waitFor(() => expect(preferences.get(SETTINGS_KEY)).toContain('gpt-6.1-sol'));
    const saved = JSON.parse(preferences.get(SETTINGS_KEY)!) as {
      selection: { connection: Record<string, unknown> };
      chatgptWelcomed?: boolean;
    };
    expect(saved.selection.connection).toEqual({
      provider: 'chatgpt',
      baseUrl: CHATGPT_BASE_URL,
      revision: expect.any(Number),
    });
    expect(saved.chatgptWelcomed).toBe(true);

    const reopened = application(fake.account, preferences).app;
    await reopened.initialize();
    await waitFor(() => expect(reopened.getSnapshot().chatgptAccount).toBe('connected'));
    expect(reopened.getSnapshot()).toMatchObject({
      connection: { provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL },
      selectedModelId: 'gpt-6.1-sol',
      chatgptWelcomed: true,
    });
  });

  it('취소·거부·플랜 미지원은 연결을 저장하지 않고 다시 시도할 수 있다', async () => {
    for (const outcome of ['cancelled', 'denied', 'timeout', 'not_eligible'] as const) {
      const fake = fakeAccount({ outcome });
      const { app } = application(fake.account);
      await app.initialize();
      app.changeConnection({ provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL });
      await app.connectChatGpt();
      expect(app.getSnapshot()).toMatchObject({
        chatgptAccount: 'disconnected',
        chatgptNotice: { kind: 'connect', outcome },
        models: [],
      });
      expect(fake.account.calls).toEqual(['connect']);
      app.dismissChatGptNotice();
      await app.connectChatGpt();
      expect(fake.account.calls).toEqual(['connect', 'connect']);
    }
  });

  it('갱신 결과를 알 수 없거나 플랜 한도에 걸린 모델 목록은 이유를 나눠 알린다', async () => {
    const fake = fakeAccount({ outcome: 'connected' });
    const { app } = application(fake.account);
    await app.initialize();
    app.changeConnection({ provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL });
    await app.connectChatGpt();

    fake.failModels(new ReaderError('reconnect_required', 'not_sent'));
    await app.checkConnection();
    expect(app.getSnapshot()).toMatchObject({
      catalogStatus: 'auth',
      catalogProblem: { reason: 'account_reconnect' },
    });
    fake.failModels({
      status: 429,
      headers: {},
      url: `${CHATGPT_BASE_URL}/models`,
      data: { error: { code: 'subscription_sharing_usage_limit_exceeded' } },
    });
    await app.checkConnection();
    expect(app.getSnapshot().catalogProblem).toEqual({ reason: 'usage_limit' });
    fake.failModels({
      status: 403,
      headers: {},
      url: `${CHATGPT_BASE_URL}/models`,
      data: { error: { code: 'subscription_sharing_user_not_eligible' } },
    });
    await app.checkConnection();
    expect(app.getSnapshot().catalogProblem).toEqual({ reason: 'plan_not_eligible' });
  });

  it('연결 해제는 원격 철회와 로컬 삭제 결과를 나누고 모델 목록을 비운다', async () => {
    const fake = fakeAccount({ outcome: 'connected', revoked: false });
    const { app } = application(fake.account);
    await app.initialize();
    app.changeConnection({ provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL });
    await app.connectChatGpt();
    await app.disconnectChatGpt();
    expect(app.getSnapshot()).toMatchObject({
      chatgptAccount: 'disconnected',
      chatgptNotice: { kind: 'disconnect', revoked: false, hadSession: true },
      models: [],
      catalogStatus: 'idle',
    });
  });

  it('계정 연결이 없는 환경에서는 ChatGPT를 고를 수 없다', async () => {
    const { app } = application(undefined);
    await app.initialize();
    expect(app.getSnapshot().chatgptAccount).toBe('unavailable');
    render(<Application controller={app} platform={shell()} />);
    act(() => app.navigate({ kind: 'settings' }));
    fireEvent.click(await screen.findByRole('button', { name: /제공자/ }));
    const option = within(screen.getByRole('dialog')).getByRole('radio', { name: /ChatGPT/ });
    expect(option).toBeDisabled();
  });

  it('설정 화면에서 동의 뒤 로그인하고, 첫 연결 안내와 원격 해제 미확인을 알린다', async () => {
    const fake = fakeAccount({ outcome: 'connected', revoked: false });
    const { app } = application(fake.account);
    await app.initialize();
    render(<Application controller={app} platform={shell()} />);
    act(() => app.navigate({ kind: 'settings' }));
    fireEvent.click(await screen.findByRole('button', { name: /제공자/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: /ChatGPT/ }));
    const consent = await screen.findByRole('dialog', { name: 'ChatGPT를 사용할까요?' });
    expect(consent).toHaveTextContent('OpenAI로 직접 보내요');
    expect(consent).toHaveTextContent('플랜 사용량');
    expect(consent).toHaveTextContent('백그라운드에 있을 때는 새 요청을 보내지 않아요');
    expect(within(consent).getByRole('link', { name: '앱 개인정보 처리방침' })).toHaveAttribute(
      'href',
      'https://github.com/earlydreamer/jhf-novel-reader/blob/main/PRIVACY.md',
    );
    expect(within(consent).getByRole('link', { name: 'OpenAI 개인정보 처리방침' })).toBeVisible();
    expect(fake.account.calls).toEqual([]);
    fireEvent.click(within(consent).getByRole('button', { name: 'ChatGPT 사용하기' }));
    expect(app.getSnapshot().connection.provider).toBe('chatgpt');
    expect(screen.queryByLabelText(/인증값|API 키/)).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }));
    const welcome = await screen.findByRole('dialog', { name: 'ChatGPT 플랜을 사용하고 있어요' });
    fireEvent.click(within(welcome).getByRole('button', { name: '확인' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'ChatGPT 플랜을 사용하고 있어요' }),
      ).not.toBeInTheDocument(),
    );
    expect(app.getSnapshot().chatgptWelcomed).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '연결 해제' }));
    const confirm = await screen.findByRole('dialog', { name: 'ChatGPT 연결을 해제할까요?' });
    fireEvent.click(within(confirm).getByRole('button', { name: '연결 해제' }));
    const unconfirmed = await screen.findByRole('dialog', {
      name: '원격 해제를 확인하지 못했어요',
    });
    expect(unconfirmed).toHaveTextContent('Settings > Security and login > Login connections');
    expect(await screen.findByRole('button', { name: 'Continue with ChatGPT' })).toBeVisible();
  });

  it('로그인을 기다리는 동안 취소할 수 있다', async () => {
    const fake = fakeAccount();
    const { app } = application(fake.account);
    await app.initialize();
    app.changeConnection({ provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL });
    const connecting = app.connectChatGpt();
    await waitFor(() => expect(app.getSnapshot().chatgptAccount).toBe('connecting'));
    app.cancelChatGptConnect();
    await connecting;
    expect(fake.account.calls).toEqual(['connect', 'cancel']);
    expect(app.getSnapshot()).toMatchObject({
      chatgptAccount: 'disconnected',
      chatgptNotice: { kind: 'connect', outcome: 'cancelled' },
    });
  });
});
