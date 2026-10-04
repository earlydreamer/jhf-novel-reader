import type {
  Chapter,
  Checkpoint,
  CompletedChapter,
  ReadPosition,
  ReaderStore,
  StoredReaderData,
} from "../contracts";
import { StorageError } from "./errors";
import { Journal, digest, serial, type PrivateFiles } from "./journal";
import {
  cacheKey,
  check,
  checkpoint,
  completed,
  integer,
  object,
  position,
  snapshot as cloneInput,
} from "./validation";
export type { PrivateFiles } from "./journal";
type Body = { chapter: CompletedChapter | null; checkpoint: Checkpoint | null };
type PositionRecord = { position: ReadPosition; ordinal: number };
async function body(value: unknown): Promise<Body> {
  object(value, ["chapter", "checkpoint"]);
  check(
    value.chapter !== undefined &&
      value.checkpoint !== undefined &&
      (value.chapter !== null || value.checkpoint !== null),
  );
  check(!(value.chapter !== null && value.checkpoint !== null));
  for (const record of [value.chapter, value.checkpoint]) {
    if (
      record &&
      typeof record === "object" &&
      "schemaVersion" in record &&
      typeof record.schemaVersion === "number" &&
      record.schemaVersion !== 1
    )
      throw new StorageError("unsupported_schema");
  }
  if (value.chapter !== null) await completed(value.chapter);
  if (value.checkpoint !== null) await checkpoint(value.checkpoint);
  return value as unknown as Body;
}
async function positionRecord(value: unknown): Promise<PositionRecord> {
  object(value, ["position", "ordinal"]);
  position(value.position);
  integer(value.ordinal);
  return value as unknown as PositionRecord;
}
/** Create once per app, sharing the native adapter. No network dependency. */
export function createReaderStore(files: PrivateFiles): ReaderStore {
  const journal = new Journal(files),
    known = new Map<string, Chapter>();
  function validator(key: string) {
    return async (value: unknown) => {
      const result = await body(value);
      check((result.chapter ?? result.checkpoint)?.cacheKey === key);
      return result;
    };
  }
  async function positionName(id: string) {
    return `positions/${await digest(id)}`;
  }
  return {
    read(key: string): Promise<StoredReaderData | null> {
      return serial(files, async () => {
        cacheKey(key);
        const entry = await journal.load(`chapters/${key}`, validator(key));
        if (!entry) return null;
        const source =
          entry.value.chapter?.source ?? entry.value.checkpoint!.chapter;
        known.set(source.chapterId, source);
        const saved = await journal.load(
          await positionName(source.chapterId),
          positionRecord,
        );
        let restored: ReadPosition | null = null;
        if (saved) {
          const pos = saved.value.position;
          check(pos.chapterId === source.chapterId);
          const paragraphs =
            entry.value.chapter?.paragraphs ?? source.paragraphs;
          let index = paragraphs.findIndex((p) => p.id === pos.paragraphId);
          const exists = index >= 0;
          if (!exists)
            index = Math.min(saved.value.ordinal, paragraphs.length - 1);
          const paragraph = paragraphs[index]!;
          restored = {
            chapterId: source.chapterId,
            paragraphId: paragraph.id,
            offset: exists ? pos.offset : 0,
          };
        }
        return { ...entry.value, position: restored };
      });
    },
    async saveCheckpoint(input: Checkpoint): Promise<void> {
      const snapshot = cloneInput(input);
      return serial(files, async () => {
        const cp = await checkpoint(snapshot);
        const name = `chapters/${cp.cacheKey}`,
          validate = validator(cp.cacheKey);
        const existing = await journal.loadForWrite(name, validate);
        if (existing?.value.chapter) return;
        await journal.save(name, { chapter: null, checkpoint: cp }, validate);
        known.set(cp.chapter.chapterId, cp.chapter);
      });
    },
    async commitChapter(input: CompletedChapter): Promise<void> {
      const snapshot = cloneInput(input);
      return serial(files, async () => {
        const c = await completed(snapshot);
        await journal.save(
          `chapters/${c.cacheKey}`,
          { chapter: c, checkpoint: null },
          validator(c.cacheKey),
        );
        known.set(c.source.chapterId, c.source);
      });
    },
    async savePosition(input: ReadPosition): Promise<void> {
      const snapshot = cloneInput(input);
      return serial(files, async () => {
        position(snapshot);
        const source = known.get(snapshot.chapterId);
        const ordinal =
          source?.paragraphs.findIndex((p) => p.id === snapshot.paragraphId) ??
          0;
        await journal.save(
          await positionName(snapshot.chapterId),
          { position: snapshot, ordinal: Math.max(ordinal, 0) },
          positionRecord,
        );
      });
    },
  };
}
