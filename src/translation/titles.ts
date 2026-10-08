import { ReaderError } from '../contracts';
import type {
  ProviderSession,
  SelectedModel,
  SourceSnapshot,
  WorkPage,
} from '../contracts/reading';
import { digest, Journal, serial, type PrivateFiles } from '../storage/journal';
import { check, object } from '../storage/validation';
import { chapterIdentity, identifier } from '../storage/readingValidation';
import { appliedGuidance, streamingGuidanceContext, type GuidanceRepository } from './guidance';

export type TitleInput = { key: string; source: string };
export type SavedTitle = TitleInput & {
  target: string;
  origin: 'model' | 'user';
  updatedAt: string;
  modelId?: string;
};
export interface TitleRepository {
  read(workId: string): Promise<readonly SavedTitle[]>;
  readAttempts(workId: string): Promise<readonly TitleInput[]>;
  recordAttempt(workId: string, inputs: readonly TitleInput[]): Promise<void>;
  save(workId: string, entries: readonly SavedTitle[]): Promise<readonly SavedTitle[]>;
}
export type TitleTranslation = (
  selection: SelectedModel,
  workId: string,
  inputs: readonly TitleInput[],
  signal: AbortSignal,
) => Promise<readonly (string | null)[]>;
function titleText(value: unknown): asserts value is string {
  check(typeof value === 'string' && !!value.trim() && value.length <= 4096);
  check(!/[\u0000-\u001f\u007f]/.test(value));
}
export type TitleRecord = {
  schemaVersion: 1;
  workId: string;
  entries: SavedTitle[];
  attempted: TitleInput[];
};
export async function validateTitleRecord(value: unknown): Promise<TitleRecord> {
  object(value, ['schemaVersion', 'workId', 'entries', 'attempted']);
  check(value.schemaVersion === 1);
  identifier(value.workId);
  check(Array.isArray(value.attempted));
  const attemptedKeys = new Set<string>();
  for (const input of value.attempted) {
    object(input, ['key', 'source']);
    if (input.key !== value.workId) chapterIdentity(input.key);
    check(
      typeof input.key === 'string' &&
        (input.key === value.workId || input.key.startsWith(value.workId + '/')) &&
        !attemptedKeys.has(input.key),
    );
    attemptedKeys.add(input.key);
    titleText(input.source);
  }
  check(Array.isArray(value.entries));
  const seen = new Set<string>();
  for (const entry of value.entries) {
    object(entry, ['key', 'source', 'target', 'origin', 'updatedAt', 'modelId']);
    if (entry.key !== value.workId) chapterIdentity(entry.key);
    check(
      typeof entry.key === 'string' &&
        (entry.key === value.workId || entry.key.startsWith(value.workId + '/')),
    );
    check(!seen.has(entry.key));
    seen.add(entry.key);
    titleText(entry.source);
    titleText(entry.target);
    check(entry.origin === 'model' || entry.origin === 'user');
    check(typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt)));
    check(
      entry.modelId === undefined || (typeof entry.modelId === 'string' && !!entry.modelId.trim()),
    );
  }
  return value as unknown as TitleRecord;
}
export function createTitleRepository(files: PrivateFiles): TitleRepository {
  const journal = new Journal(files);
  return {
    readAttempts(workId) {
      identifier(workId);
      return serial(files, async () => {
        const record = (await journal.load(`titles/${workId}`, validateTitleRecord))?.value;
        check(!record || record.workId === workId);
        return record?.attempted ?? [];
      });
    },
    recordAttempt(workId, inputs) {
      identifier(workId);
      const frozen = structuredClone(inputs);
      return serial(files, async () => {
        const old = (await journal.load(`titles/${workId}`, validateTitleRecord))?.value;
        check(!old || old.workId === workId);
        const attempted = new Map((old?.attempted ?? []).map((input) => [input.key, input]));
        frozen.forEach((input) => attempted.set(input.key, input));
        await journal.save(
          `titles/${workId}`,
          {
            schemaVersion: 1,
            workId,
            entries: old?.entries ?? [],
            attempted: [...attempted.values()],
          },
          validateTitleRecord,
        );
      });
    },
    read(workId) {
      identifier(workId);
      return serial(files, async () => {
        const record = (await journal.load(`titles/${workId}`, validateTitleRecord))?.value;
        check(!record || record.workId === workId);
        return record?.entries ?? [];
      });
    },
    save(workId, entries) {
      identifier(workId);
      const frozen = structuredClone(entries);
      return serial(files, async () => {
        const old = (await journal.load(`titles/${workId}`, validateTitleRecord))?.value;
        check(!old || old.workId === workId);
        const merged = new Map((old?.entries ?? []).map((entry) => [entry.key, entry]));
        frozen.forEach((entry) => merged.set(entry.key, entry));
        const value = {
          schemaVersion: 1 as const,
          workId,
          entries: [...merged.values()],
          attempted: old?.attempted ?? [],
        };
        await journal.save(`titles/${workId}`, value, validateTitleRecord);
        return value.entries;
      });
    },
  };
}
export function workTitleInputs(work: WorkPage): TitleInput[] {
  return [
    { key: work.workId, source: work.title },
    ...work.chapters.map((chapter) => ({ key: chapter.chapterId, source: chapter.title })),
  ];
}
export function displayedTitle(
  entries: readonly SavedTitle[],
  key: string,
  source: string,
): string {
  return entries.find((entry) => entry.key === key && entry.source === source)?.target ?? source;
}
/** Titles use the same provider, paragraph ID contract, limits and locked terms as the body. */
export function createTitleTranslation(
  createProvider: (selection: SelectedModel) => ProviderSession,
  guidance: GuidanceRepository,
  streaming: boolean,
): TitleTranslation {
  return async (selection, workId, inputs, signal) => {
    if (!inputs.length || inputs.length > 8) throw new ReaderError('invalid_output', 'not_sent');
    const selected = {
      ...structuredClone(selection),
      translationMode:
        streaming && selection.connection.provider === 'openai-compatible'
          ? ('stream' as const)
          : ('legacy' as const),
    };
    const source: SourceSnapshot = {
      workId,
      chapterId: `${workId}/short`,
      canonicalUrl: `https://ncode.syosetu.com/${workId}/`,
      title: inputs[0]!.source,
      paragraphs: inputs.map((entry, index) => ({
        id: `title-${index}`,
        text: entry.source,
        ruby: [],
      })),
      sourceHash: await digest(inputs),
      prevUrl: null,
      nextUrl: null,
      captureKind: 'legacy-import',
      fetchedAt: null,
      rawHtml: null,
    };
    const terms = await guidance.read(workId);
    const local = selected.connection.provider === 'openai-compatible';
    const result = await createProvider(selected).translateChapter(
      {
        token: {
          chapterId: source.chapterId,
          requestId: crypto.randomUUID(),
          settingsRevision: selected.connection.revision,
        },
        source,
        languageDirection: 'ja-ko',
        contractVersion: 'plain-v1',
        promptVersion:
          selected.translationMode === 'stream'
            ? 'colomo-local-v1'
            : local && selected.limits
              ? 'lines-v1'
              : 'hymt2-ko-v1',
        ...(local
          ? {
              reference: (input: string) => streamingGuidanceContext(terms, workId, input, []),
              lockedTerms: (input: string) =>
                (appliedGuidance(terms, workId, input, [])?.terms ?? []).flatMap(
                  ({ term, names }) => names.map((name) => ({ source: name, target: term.target })),
                ),
            }
          : {}),
      },
      signal,
    );
    if (signal.aborted) throw new ReaderError('cancelled');
    if (result.finishReason !== 'complete') throw new ReaderError('invalid_output', 'received');
    const rows = result.text.trim().split('\n\n');
    if (rows.length !== inputs.length) throw new ReaderError('invalid_output', 'received');
    return rows.map((row, index) => {
      const target = row.trim();
      if (
        result.failedParagraphs?.includes(index) ||
        !target ||
        target.length > 4096 ||
        /[\u0000-\u001f\u007f\p{Script=Hiragana}\p{Script=Katakana}]/u.test(target)
      )
        return null;
      if (
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(inputs[index]!.source) &&
        !/\p{Script=Hangul}/u.test(target)
      )
        return null;
      return target;
    });
  };
}
