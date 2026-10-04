import { ReaderError } from '../contracts';
import type { PreferenceBackend } from '../storage/settings';
import type { LastChapterRepository } from './controller';
const KEY = 'narou-reader.last-chapter.v1';
const queues = new WeakMap<PreferenceBackend, Promise<unknown>>();
function validKey(value: unknown): value is string { return typeof value === 'string' && /^v1-[a-f0-9]{64}$/.test(value); }
/** A small pointer only. Chapter bodies and positions belong in the private ReaderStore. */
export function createLastChapterRepository(backend: PreferenceBackend): LastChapterRepository {
  function run<T>(action: () => Promise<T>): Promise<T> {
    const task = (queues.get(backend) ?? Promise.resolve()).then(action).catch(() => { throw new ReaderError('storage'); });
    queues.set(backend, task.catch(() => {}));
    return task;
  }
  return {
    read: () => run(async () => {
      const { value } = await backend.get({ key: KEY });
      if (value === null) return null;
      if (value.length > 160) throw new ReaderError('storage');
      const record: unknown = JSON.parse(value);
      if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).sort().join(',') !== 'cacheKey,schemaVersion' ||
          !('schemaVersion' in record) || record.schemaVersion !== 1 || !('cacheKey' in record) || !validKey(record.cacheKey)) throw new ReaderError('storage');
      return record.cacheKey;
    }),
    save: key => run(async () => {
      if (!validKey(key)) throw new ReaderError('storage');
      await backend.set({ key: KEY, value: JSON.stringify({ schemaVersion: 1, cacheKey: key }) });
    }),
  };
}
