import { describe, expect, it, vi } from 'vitest';
import { ReaderError } from '../../src/contracts';
import { createChatGptAccount, type ChatGptPlugin } from '../../src/platform/chatgpt';
import { chatGptHttpError, listChatGptModels } from '../../src/providers/chatgpt';

function plugin(overrides: Partial<ChatGptPlugin> = {}) {
  const listeners: ((event: { id: string; data: string }) => void)[] = [];
  const value: ChatGptPlugin = {
    status: async () => ({ state: 'connected' }),
    connect: async () => ({ outcome: 'connected' }),
    cancelConnect: async () => {},
    disconnect: async () => ({ revoked: true, hadSession: true }),
    models: async () => ({ status: 200, data: { models: [] } }),
    respond: async ({ id }) => {
      listeners.forEach((listener) => listener({ id: 'other', data: 'ignored\n' }));
      listeners.forEach((listener) => listener({ id, data: 'data: {}\n' }));
      return { status: 200, data: 'data: {}\n' };
    },
    cancel: vi.fn(async () => {}),
    addListener: async (_event, listener) => {
      listeners.push(listener);
      return {
        remove: async () => {
          listeners.splice(listeners.indexOf(listener), 1);
        },
      };
    },
    ...overrides,
  };
  return { value, listeners };
}

describe('ChatGPT 네이티브 연결 래퍼', () => {
  it('모르는 상태와 결과는 안전한 값으로 바꾼다', async () => {
    const account = createChatGptAccount(
      plugin({
        status: async () => ({ state: 'weird' }),
        connect: async () => ({ outcome: 'weird' }),
      }).value,
    );
    expect(await account.status()).toBe('disconnected');
    expect(await account.connect()).toBe('failed');
  });

  it('요청 전 거절과 결과 불명을 구분한다', async () => {
    const signal = new AbortController().signal;
    for (const [message, code, outcome] of [
      ['reconnect_required', 'reconnect_required', 'not_sent'],
      ['not_eligible', 'plan_not_eligible', 'not_sent'],
      ['connection_not_sent', 'connection', 'not_sent'],
      ['timeout_unknown', 'timeout_unknown', 'unknown'],
      ['cancelled_unknown', 'cancelled', 'unknown'],
    ] as const) {
      const account = createChatGptAccount(
        plugin({ respond: async () => Promise.reject(new Error(message)) }).value,
      );
      await expect(account.respond({}, signal, () => {})).rejects.toMatchObject({
        code,
        outcome,
      });
    }
  });

  it('자기 요청의 스트림만 넘기고 끝나면 듣기를 멈춘다', async () => {
    const native = plugin();
    const account = createChatGptAccount(native.value);
    const lines: string[] = [];
    const response = await account.respond({}, new AbortController().signal, (data) =>
      lines.push(data),
    );
    expect(lines).toEqual(['data: {}\n']);
    expect(response).toMatchObject({ status: 200, url: 'https://api.openai.com/v1/responses' });
    expect(native.listeners).toHaveLength(0);
  });

  it('취소하면 네이티브 요청도 끊는다', async () => {
    const control = new AbortController();
    const native = plugin({
      respond: async () => {
        control.abort();
        return { status: 200, data: '' };
      },
    });
    const account = createChatGptAccount(native.value);
    await expect(account.respond({}, control.signal, () => {})).rejects.toMatchObject({
      code: 'cancelled',
      outcome: 'unknown',
    });
    expect(native.value.cancel).toHaveBeenCalled();
  });
});

describe('ChatGPT 오류와 모델 목록', () => {
  it('공식 오류 코드를 다시 보내지 않을 오류로 나눈다', () => {
    const cases: [number, string | undefined, string][] = [
      [403, 'subscription_sharing_user_not_eligible', 'plan_not_eligible'],
      [429, 'subscription_sharing_usage_limit_exceeded', 'usage_limit'],
      [401, 'subscription_sharing_invalid_user', 'reconnect_required'],
      [400, 'context_length_exceeded', 'input_limit'],
      [401, undefined, 'auth'],
      [503, 'subscription_sharing_usage_unavailable', 'connection'],
    ];
    for (const [status, code, expected] of cases)
      expect(chatGptHttpError(status, code ? { error: { code } } : {})).toMatchObject({
        code: expected,
        outcome: 'received',
        status,
      });
    // 문자열 본문도 같은 규칙으로 읽는다.
    expect(chatGptHttpError(429, JSON.stringify({ error: { code: 'x' } })).code).toBe(
      'usage_limit',
    );
  });

  it('표시 모델을 서버 순서대로 생성 모델로 돌려주고 중복은 거절한다', async () => {
    const models = (data: unknown) =>
      listChatGptModels(
        {
          ...createChatGptAccount(plugin().value),
          models: async () => ({ status: 200, headers: {}, url: '', data }),
        },
        new AbortController().signal,
      );
    await expect(
      models({
        models: [
          { slug: 'gpt-b', displayName: 'B' },
          { slug: 'gpt-a', displayName: 'A' },
        ],
      }),
    ).resolves.toEqual([
      { id: 'gpt-b', displayName: 'B', supportsGeneration: true },
      { id: 'gpt-a', displayName: 'A', supportsGeneration: true },
    ]);
    await expect(
      models({
        models: [
          { slug: 'gpt-a', displayName: 'A' },
          { slug: 'gpt-a', displayName: 'A' },
        ],
      }),
    ).rejects.toBeInstanceOf(ReaderError);
  });
});
