import { ReaderError } from '../contracts';

export type RequestPriority = 'current' | 'prefetch';
export interface RequestScheduler {
  schedule<T>(priority: RequestPriority, signal: AbortSignal, request: () => Promise<T>): Promise<T>;
}
interface PendingRequest {
  signal: AbortSignal;
  cancel(): void;
  run(): Promise<void>;
}
/** Share once per application. Abort never releases a native request's slot early. */
export function createRequestScheduler(): RequestScheduler {
  const queues: Record<RequestPriority, PendingRequest[]> = { current: [], prefetch: [] };
  let active = false;
  async function dispatch() {
    if (active) return;
    const next = queues.current.shift() ?? queues.prefetch.shift();
    if (!next) return;
    next.signal.removeEventListener('abort', next.cancel);
    active = true;
    try { await next.run(); }
    finally { active = false; void dispatch(); }
  }
  return {
    schedule<T>(priority: RequestPriority, signal: AbortSignal, request: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal.aborted) { reject(new ReaderError('cancelled')); return; }
        const pending: PendingRequest = {
          signal,
          cancel() {
            const index = queues[priority].indexOf(pending);
            if (index >= 0) queues[priority].splice(index, 1);
            signal.removeEventListener('abort', pending.cancel);
            reject(new ReaderError('cancelled'));
          },
          async run() {
            if (signal.aborted) { reject(new ReaderError('cancelled')); return; }
            try { resolve(await request()); }
            catch (error) { reject(error); }
          },
        };
        queues[priority].push(pending);
        signal.addEventListener('abort', pending.cancel, { once: true });
        // Batch same-turn dispatches so a current request wins over queued prefetch.
        queueMicrotask(() => { void dispatch(); });
      });
    },
  };
}
