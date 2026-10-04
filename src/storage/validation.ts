import {
  createCacheKey,
  type Chapter,
  type Checkpoint,
  type CompletedChapter,
  type ReadPosition,
} from "../contracts";
import { StorageError } from "./errors";
export function check(condition: unknown): asserts condition {
  if (!condition) throw new StorageError("invalid");
}
export function record(
  value: unknown,
): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value));
}
export function object(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  record(value);
  check(Object.keys(value).every((key) => keys.includes(key)));
}
export function text(value: unknown): asserts value is string {
  check(typeof value === "string" && value.trim().length > 0);
}
export function integer(value: unknown, minimum = 0): asserts value is number {
  check(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum,
  );
}
export function url(value: unknown, httpsOnly = false): void {
  text(value);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new StorageError("invalid");
  }
  check(
    (parsed.protocol === "https:" ||
      (!httpsOnly && parsed.protocol === "http:")) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash,
  );
}
export function cacheKey(value: unknown): asserts value is string {
  check(typeof value === "string" && /^v1-[a-f0-9]{64}$/.test(value));
}
function translations(
  value: unknown,
  source: Chapter,
): asserts value is { id: string; text: string }[] {
  check(Array.isArray(value) && value.length > 0);
  const ids = new Set<string>();
  for (const item of value) {
    object(item, ["id", "text"]);
    text(item.id);
    check(typeof item.text === "string");
    const original = source.paragraphs.find((p) => p.id === item.id);
    if (original && !original.text.trim()) check(item.text === original.text);
    else text(item.text);
    check(!ids.has(item.id));
    ids.add(item.id);
  }
}
function chapter(value: unknown): asserts value is Chapter {
  object(value, [
    "canonicalUrl",
    "workId",
    "chapterId",
    "title",
    "prevUrl",
    "nextUrl",
    "sourceHash",
    "paragraphs",
  ]);
  url(value.canonicalUrl, true);
  text(value.workId);
  text(value.chapterId);
  text(value.title);
  text(value.sourceHash);
  for (const neighbor of [value.prevUrl, value.nextUrl])
    if (neighbor !== null) url(neighbor, true);
  check(Array.isArray(value.paragraphs) && value.paragraphs.length > 0);
  const ids = new Set<string>();
  for (const p of value.paragraphs) {
    object(p, ["id", "text", "ruby"]);
    text(p.id);
    check(typeof p.text === "string");
    check(!ids.has(p.id));
    ids.add(p.id);
    check(Array.isArray(p.ruby));
    for (const r of p.ruby) {
      object(r, ["start", "end", "reading"]);
      integer(r.start);
      integer(r.end, 1);
      text(r.reading);
      check(r.start < r.end && r.end <= p.text.length);
    }
  }
}
async function common(
  value: Record<string, unknown>,
  source: unknown,
): Promise<void> {
  check(value.schemaVersion === 1);
  cacheKey(value.cacheKey);
  object(value.identity, [
    "canonicalUrl",
    "sourceHash",
    "provider",
    "normalizedEndpoint",
    "model",
    "promptVersion",
    "languageDirection",
  ]);
  const id = value.identity;
  url(id.canonicalUrl, true);
  text(id.sourceHash);
  check(id.provider === "openai-compatible" || id.provider === "gemini");
  url(id.normalizedEndpoint);
  text(id.model);
  text(id.promptVersion);
  check(id.languageDirection === "ja-ko");
  chapter(source);
  check(
    source.canonicalUrl === id.canonicalUrl &&
      source.sourceHash === id.sourceHash,
  );
  check(
    (await createCacheKey(id as unknown as CompletedChapter["identity"])) ===
      value.cacheKey,
  );
}
export async function completed(value: unknown): Promise<CompletedChapter> {
  object(value, [
    "schemaVersion",
    "cacheKey",
    "identity",
    "source",
    "paragraphs",
    "completedAt",
  ]);
  await common(value, value.source);
  translations(value.paragraphs, value.source as Chapter);
  text(value.completedAt);
  check(Number.isFinite(Date.parse(value.completedAt)));
  const source = value.source as Chapter;
  check(value.paragraphs.length === source.paragraphs.length);
  check(value.paragraphs.every((p, i) => p.id === source.paragraphs[i]?.id));
  return value as unknown as CompletedChapter;
}
export async function checkpoint(value: unknown): Promise<Checkpoint> {
  object(value, [
    "schemaVersion",
    "cacheKey",
    "identity",
    "chapter",
    "token",
    "chunks",
  ]);
  await common(value, value.chapter);
  object(value.token, ["jobId", "chapterId", "settingsRevision"]);
  text(value.token.jobId);
  integer(value.token.settingsRevision);
  check(value.token.chapterId === (value.chapter as Chapter).chapterId);
  check(Array.isArray(value.chunks));
  const ids = new Set<string>(),
    paragraphs = new Set<string>();
  for (const chunk of value.chunks) {
    object(chunk, ["chunkId", "paragraphs", "validated"]);
    text(chunk.chunkId);
    check(chunk.validated === true && !ids.has(chunk.chunkId));
    ids.add(chunk.chunkId);
    translations(chunk.paragraphs, value.chapter as Chapter);
    for (const p of chunk.paragraphs) {
      check(!paragraphs.has(p.id));
      paragraphs.add(p.id);
    }
  }
  return value as unknown as Checkpoint;
}
export function position(value: unknown): asserts value is ReadPosition {
  object(value, ["chapterId", "paragraphId", "offset"]);
  text(value.chapterId);
  text(value.paragraphId);
  integer(value.offset);
}

export function snapshot<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    throw new StorageError("invalid");
  }
}
