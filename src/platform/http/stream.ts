import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import {
  ReaderError,
  type NativeStreamingClient,
  type NativeHttpRequest,
  type HttpResponse,
} from '../../contracts';
interface StreamPlugin {
  start(options: NativeHttpRequest & { id: string }): Promise<HttpResponse & { sse: boolean }>;
  cancel(options: { id: string }): Promise<void>;
  addListener(
    event: 'data',
    listener: (event: { id: string; data: string }) => void,
  ): Promise<PluginListenerHandle>;
}
const native = registerPlugin<StreamPlugin>('ModelStream');
export function createNativeStreamingClient(plugin: StreamPlugin = native): NativeStreamingClient {
  return {
    async requestStream(options, signal, onData) {
      if (
        plugin === native &&
        (!Capacitor.isNativePlatform() || !['android', 'ios'].includes(Capacitor.getPlatform()))
      )
        throw new ReaderError('connection');
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
        const response = await plugin.start({ ...options, id });
        if (signal.aborted) throw new ReaderError('cancelled', 'unknown');
        if (callbackError) throw callbackError;
        if (response.status >= 200 && response.status < 300 && !response.sse)
          throw new ReaderError('invalid_output', 'received', response.status);
        return response;
      } catch (error) {
        if (error instanceof ReaderError) throw error;
        const message = (error as { message?: string })?.message;
        if (message === 'connection_not_sent' || message === 'auth_not_sent')
          throw new ReaderError(message === 'auth_not_sent' ? 'auth' : 'connection', 'not_sent');
        throw new ReaderError(
          signal.aborted || message === 'cancelled_unknown' ? 'cancelled' : 'timeout_unknown',
          'unknown',
        );
      } finally {
        signal.removeEventListener('abort', cancel);
        await listener.remove();
      }
    },
  };
}
