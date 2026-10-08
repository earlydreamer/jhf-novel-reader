import type { TranslationToken } from '../contracts/reading';
import { Journal, serial, type PrivateFiles } from '../storage/journal';
import { check, integer, object } from '../storage/validation';
import { chapterIdentity, identifier } from '../storage/readingValidation';
export type Attempt = { token: TranslationToken; phase: 'dispatching' | 'unknown' | 'complete' };
export interface AttemptRepository {
  write(value: Attempt): Promise<void>;
  readUnfinished(): Promise<readonly TranslationToken[]>;
}
export async function validateAttempts(value: unknown): Promise<Attempt[]> {
  check(Array.isArray(value));
  const ids = new Set<string>();
  for (const entry of value) {
    object(entry, ['token', 'phase']);
    object(entry.token, ['requestId', 'chapterId', 'settingsRevision']);
    identifier(entry.token.requestId);
    chapterIdentity(entry.token.chapterId);
    integer(entry.token.settingsRevision);
    check(['dispatching', 'unknown', 'complete'].includes(String(entry.phase)));
    check(!ids.has(entry.token.requestId));
    ids.add(entry.token.requestId);
  }
  return value as Attempt[];
}
/** Fail closed on a damaged attempt journal: loss of evidence must never authorize a POST. */
export function createAttemptRepository(files: PrivateFiles): AttemptRepository {
  const journal = new Journal(files);
  const read = async () => (await journal.load('attempts/index', validateAttempts))?.value ?? [];
  return {
    write(input) {
      const value = structuredClone(input);
      return serial(files, async () => {
        const entries = await read();
        const next = entries.filter((entry) => entry.token.requestId !== value.token.requestId);
        next.push(value);
        await journal.save('attempts/index', next, validateAttempts);
      });
    },
    readUnfinished: () =>
      serial(files, async () =>
        (await read()).filter((entry) => entry.phase !== 'complete').map((entry) => entry.token),
      ),
  };
}
