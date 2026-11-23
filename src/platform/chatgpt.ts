import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  ReaderError,
  type ChatGptAccount,
  type ChatGptAccountState,
  type ChatGptConnectOutcome,
  type HttpResponse,
} from '../contracts';

export interface ChatGptPlugin {
  status(): Promise<{ state: string }>;
  connect(): Promise<{ outcome: string }>;
  cancelConnect(): Promise<void>;
  disconnect(): Promise<{ revoked: boolean; hadSession: boolean }>;
  models(): Promise<{ status: number; data: unknown }>;
  respond(options: { id: string; body: Readonly<Record<string, unknown>> }): Promise<{
    status: number;
    data: string;
  }>;
  cancel(options: { id: string }): Promise<void>;
  addListener(
    event: 'data',
    listener: (event: { id: string; data: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const native = registerPlugin<ChatGptPlugin>('ChatGpt');
const STATES: readonly ChatGptAccountState[] = ['disconnected', 'connected', 'reconnect'];
const OUTCOMES: readonly ChatGptConnectOutcome[] = [
  'connected',
  'cancelled',
  'denied',
  'timeout',
  'not_eligible',
  'account_mismatch',
  'already_connected',
  'no_browser',
  'failed',
];
const ENDPOINT = 'https://api.openai.com/v1';

/** 네이티브가 요청 전에 막은 오류와 결과를 알 수 없는 오류를 ReaderError로 옮긴다. */
function failure(error: unknown, signal: AbortSignal, sent: boolean): ReaderError {
  if (error instanceof ReaderError) return error;
  const message = (error as { message?: string })?.message;
  switch (message) {
    case 'reconnect_required':
      return new ReaderError('reconnect_required', 'not_sent');
    case 'not_eligible':
      return new ReaderError('plan_not_eligible', 'not_sent');
    case 'temporary':
      return new ReaderError('connection', 'received', 503);
    case 'invalid_output':
      return new ReaderError('model_list', 'received');
    case 'connection':
    case 'connection_not_sent':
      return new ReaderError('connection', 'not_sent');
    case 'cancelled_unknown':
      return new ReaderError('cancelled', 'unknown');
    default:
      if (!sent) return new ReaderError(signal.aborted ? 'cancelled' : 'connection', 'not_sent');
      return new ReaderError(signal.aborted ? 'cancelled' : 'timeout_unknown', 'unknown');
  }
}

export function createChatGptAccount(plugin: ChatGptPlugin = native): ChatGptAccount {
  return {
    async status() {
      const { state } = await plugin.status();
      return STATES.includes(state as ChatGptAccountState)
        ? (state as ChatGptAccountState)
        : 'disconnected';
    },
    async connect() {
      const { outcome } = await plugin.connect();
      return OUTCOMES.includes(outcome as ChatGptConnectOutcome)
        ? (outcome as ChatGptConnectOutcome)
        : 'failed';
    },
    cancelConnect: () => plugin.cancelConnect(),
    async disconnect() {
      const { revoked, hadSession } = await plugin.disconnect();
      return { revoked: revoked === true, hadSession: hadSession === true };
    },
    async models(signal) {
      if (signal.aborted) throw new ReaderError('cancelled', 'not_sent');
      try {
        const response = await plugin.models();
        if (signal.aborted) throw new ReaderError('cancelled', 'unknown');
        return {
          status: response.status,
          headers: {},
          url: `${ENDPOINT}/models`,
          data: response.data,
        };
      } catch (error) {
        throw failure(error, signal, false);
      }
    },
    async respond(body, signal, onData) {
      if (signal.aborted) throw new ReaderError('cancelled', 'not_sent');
      const id = crypto.randomUUID();
      let callbackError: unknown;
      const listener = await plugin.addListener('data', (event) => {
        if (event.id !== id || signal.aborted || callbackError) return;
        try {
          onData(event.data);
        } catch (error) {
          callbackError = error;
          void plugin.cancel({ id }).catch(() => undefined);
        }
      });
      const cancel = () => {
        void plugin.cancel({ id }).catch(() => undefined);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        if (signal.aborted) throw new ReaderError('cancelled', 'not_sent');
        const response: HttpResponse = {
          ...(await plugin.respond({ id, body })),
          headers: {},
          url: `${ENDPOINT}/responses`,
        };
        if (signal.aborted) throw new ReaderError('cancelled', 'unknown');
        if (callbackError) throw callbackError;
        return response;
      } catch (error) {
        throw failure(error, signal, true);
      } finally {
        signal.removeEventListener('abort', cancel);
        await listener.remove();
      }
    },
  };
}

/** Android 앱에서만 계정 연결을 제공한다. 웹 미리보기에는 토큰을 보관할 곳이 없다. */
export function nativeChatGptAccount(): ChatGptAccount | undefined {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
    ? createChatGptAccount()
    : undefined;
}
