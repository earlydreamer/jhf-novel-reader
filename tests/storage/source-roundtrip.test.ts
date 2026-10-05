// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseChapter } from "../../src/source";
import { createCacheKey, type Checkpoint, type CompletedChapter } from '../../src/contracts/legacy';
import { createReaderStore, type PrivateFiles } from "../../src/storage/store";
async function fixture(): Promise<CompletedChapter> {
  const source = await parseChapter(
    '<h1 class="p-novel__title">合成</h1><div class="p-novel__body"><div class="p-novel__text"><p>最初</p><p><br></p><p>　 </p><p>最後</p></div></div>',
    "https://ncode.syosetu.com/n1234ab/1/",
  );
  const identity = {
    canonicalUrl: source.canonicalUrl,
    sourceHash: source.sourceHash,
    provider: "openai-compatible" as const,
    normalizedEndpoint: "http://192.0.2.1:1234/v1",
    model: "local",
    promptVersion: "1",
    languageDirection: "ja-ko" as const,
  };
  return {
    schemaVersion: 1,
    cacheKey: await createCacheKey(identity),
    identity,
    source,
    paragraphs: source.paragraphs.map((p) => ({
      id: p.id,
      text: p.text.trim() ? "번역" : p.text,
    })),
    completedAt: "2026-10-04T00:00:00Z",
  };
}
function files(): PrivateFiles {
  const values = new Map<string, string>();
  return {
    async read(k) {
      return values.get(k) ?? null;
    },
    async write(k, v) {
      values.set(k, v);
    },
  };
}
function checkpoint(c: CompletedChapter): Checkpoint {
  return {
    schemaVersion: 1,
    cacheKey: c.cacheKey,
    identity: c.identity,
    chapter: c.source,
    token: { chapterId: c.source.chapterId, jobId: "j", settingsRevision: 1 },
    chunks: [
      { chunkId: "blank-safe", validated: true, paragraphs: c.paragraphs },
    ],
  };
}
describe("parser to private storage", () => {
  it("preserves empty and whitespace-only source/translation paragraphs across checkpoint and completion reload", async () => {
    const c = await fixture(),
      disk = files(),
      store = createReaderStore(disk);
    expect(c.source.paragraphs.some((p) => p.text === "")).toBe(true);
    expect(
      c.source.paragraphs.some((p) => p.text.length > 0 && !p.text.trim()),
    ).toBe(true);
    await store.saveCheckpoint(checkpoint(c));
    expect(
      (await createReaderStore(disk).read(c.cacheKey))?.checkpoint,
    ).toEqual(checkpoint(c));
    await store.commitChapter(c);
    expect((await createReaderStore(disk).read(c.cacheKey))?.chapter).toEqual(
      c,
    );
  });
  it.each(["", " ", "\n"])(
    "rejects empty translation of a nonblank source: %j",
    async (text) => {
      const c = await fixture(),
        store = createReaderStore(files());
      const bad = {
        ...c,
        paragraphs: c.paragraphs.map((p, i) => (i === 0 ? { ...p, text } : p)),
      };
      await expect(store.commitChapter(bad)).rejects.toMatchObject({
        reason: "invalid",
      });
      await expect(store.saveCheckpoint(checkpoint(bad))).rejects.toMatchObject(
        { reason: "invalid" },
      );
    },
  );
  it("requires unchanged whitespace for blank source IDs in both completion and checkpoints", async () => {
    const c = await fixture(),
      store = createReaderStore(files());
    const bad = {
      ...c,
      paragraphs: c.paragraphs.map((p, i) =>
        i === 1 ? { ...p, text: "invented content" } : p,
      ),
    };
    await expect(store.commitChapter(bad)).rejects.toMatchObject({
      reason: "invalid",
    });
    await expect(store.saveCheckpoint(checkpoint(bad))).rejects.toMatchObject({
      reason: "invalid",
    });
  });
});
