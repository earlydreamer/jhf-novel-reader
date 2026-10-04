import { describe, expect, it } from "vitest";
import {
  createCacheKey,
  type CacheIdentity,
  type CompletedChapter,
  type Checkpoint,
} from "../../src/contracts";
import { createReaderStore, type PrivateFiles } from "../../src/storage/store";
export class Files implements PrivateFiles {
  data = new Map<string, string>();
  fail: "full" | "partial" | "read" | null = null;
  async read(path: string) {
    if (this.fail === "read") throw new Error("permission");
    return this.data.get(path) ?? null;
  }
  async write(path: string, text: string) {
    if (this.fail === "full")
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    if (this.fail === "partial") {
      this.data.set(path, text.slice(0, 20));
      throw new Error("interrupted");
    }
    this.data.set(path, text);
  }
}
export async function fixture(
  overrides: Partial<CacheIdentity> = {},
): Promise<CompletedChapter> {
  const identity: CacheIdentity = {
    canonicalUrl: "https://ncode.syosetu.com/n1234ab/1/",
    sourceHash: "source-1",
    provider: "openai-compatible",
    normalizedEndpoint: "http://192.0.2.1:1234/v1",
    model: "local",
    promptVersion: "1",
    languageDirection: "ja-ko",
    ...overrides,
  };
  return {
    schemaVersion: 1,
    cacheKey: await createCacheKey(identity),
    identity,
    source: {
      canonicalUrl: identity.canonicalUrl,
      sourceHash: identity.sourceHash,
      workId: "n1234ab",
      chapterId: "n1234ab/1",
      title: "test",
      prevUrl: null,
      nextUrl: null,
      paragraphs: [
        { id: "p1", text: "原文一", ruby: [] },
        { id: "p2", text: "原文二", ruby: [] },
      ],
    },
    paragraphs: [
      { id: "p1", text: "번역 하나" },
      { id: "p2", text: "번역 둘" },
    ],
    completedAt: "2026-10-04T00:00:00.000Z",
  };
}
function checkpoint(c: CompletedChapter): Checkpoint {
  return {
    schemaVersion: 1,
    cacheKey: c.cacheKey,
    identity: c.identity,
    chapter: c.source,
    token: { jobId: "j1", chapterId: c.source.chapterId, settingsRevision: 1 },
    chunks: [
      { chunkId: "c1", validated: true, paragraphs: [c.paragraphs[0]!] },
    ],
  };
}
describe("private reader repository", () => {
  it("restores completed source and translation offline across instances", async () => {
    const files = new Files(),
      c = await fixture();
    await createReaderStore(files).commitChapter(c);
    expect((await createReaderStore(files).read(c.cacheKey))?.chapter).toEqual(
      c,
    );
  });
  it("keeps checkpoints separate and removes them only after complete commit", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture(),
      cp = checkpoint(c);
    await store.saveCheckpoint(cp);
    expect(await store.read(c.cacheKey)).toEqual({
      chapter: null,
      checkpoint: cp,
      position: null,
    });
    await store.commitChapter(c);
    expect((await store.read(c.cacheKey))?.checkpoint).toBeNull();
  });
  it.each(["full", "partial"] as const)(
    "preserves last valid commit on %s writes",
    async (fail) => {
      const files = new Files(),
        c = await fixture(),
        store = createReaderStore(files);
      await store.commitChapter(c);
      files.fail = fail;
      await expect(
        store.commitChapter({ ...c, completedAt: "2026-10-05T00:00:00Z" }),
      ).rejects.toMatchObject({
        code: "storage",
        reason: fail === "full" ? "disk_full" : "io",
      });
      files.fail = null;
      expect(
        (await createReaderStore(files).read(c.cacheKey))?.chapter,
      ).toEqual(c);
    },
  );
  it("recovers from corrupt latest journal slot without showing partial completion", async () => {
    const files = new Files(),
      c = await fixture(),
      store = createReaderStore(files);
    await store.saveCheckpoint(checkpoint(c));
    await store.commitChapter(c);
    const latest = [...files.data.keys()].at(-1)!;
    files.data.set(latest, "broken");
    const value = await createReaderStore(files).read(c.cacheKey);
    expect(value?.chapter).toBeNull();
    expect(value?.checkpoint).toEqual(checkpoint(c));
  });
  it("reports corruption instead of missing when neither slot is valid", async () => {
    const files = new Files(),
      c = await fixture(),
      store = createReaderStore(files);
    await store.commitChapter(c);
    for (const key of files.data.keys()) files.data.set(key, "{");
    await expect(store.read(c.cacheKey)).rejects.toMatchObject({
      reason: "corrupt",
    });
  });
  it("does not turn I/O permission failures into a cache miss", async () => {
    const files = new Files();
    files.fail = "read";
    await expect(
      createReaderStore(files).read((await fixture()).cacheKey),
    ).rejects.toMatchObject({ reason: "io" });
  });
  it.each([
    "sourceHash",
    "model",
    "promptVersion",
    "normalizedEndpoint",
  ] as const)("misses changed %s identity", async (field) => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await store.commitChapter(c);
    const next = await fixture({
      [field]:
        field === "normalizedEndpoint" ? "http://192.0.2.2:1234/v1" : "changed",
    });
    expect(await store.read(next.cacheKey)).toBeNull();
  });
  it("rejects forged fingerprints and incomplete or duplicate completions", async () => {
    const store = createReaderStore(new Files()),
      c = await fixture();
    for (const bad of [
      { ...c, cacheKey: "v1-" + "0".repeat(64) },
      { ...c, paragraphs: c.paragraphs.slice(0, 1) },
      { ...c, paragraphs: [c.paragraphs[0]!, c.paragraphs[0]!] },
    ])
      await expect(store.commitChapter(bad)).rejects.toMatchObject({
        reason: "invalid",
      });
  });
  it("rejects unvalidated/duplicate chunks and chapter token mismatch", async () => {
    const store = createReaderStore(new Files()),
      cp = checkpoint(await fixture());
    for (const bad of [
      { ...cp, chunks: [{ ...cp.chunks[0]!, validated: false }] },
      { ...cp, chunks: [cp.chunks[0]!, cp.chunks[0]!] },
      { ...cp, token: { ...cp.token, chapterId: "wrong" } },
    ])
      await expect(
        store.saveCheckpoint(bad as Checkpoint),
      ).rejects.toMatchObject({ reason: "invalid" });
  });
  it("restores and clamps position and corrects removed paragraph by saved ordinal", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await store.commitChapter(c);
    await store.savePosition({
      chapterId: c.source.chapterId,
      paragraphId: "p2",
      offset: 999,
    });
    expect((await createReaderStore(files).read(c.cacheKey))?.position).toEqual(
      { chapterId: c.source.chapterId, paragraphId: "p2", offset: 4 },
    );
    const next = await fixture({ sourceHash: "source-2" });
    const changed = {
      ...next,
      source: {
        ...next.source,
        paragraphs: [
          next.source.paragraphs[0]!,
          { ...next.source.paragraphs[1]!, id: "p3" },
        ],
      },
      paragraphs: [next.paragraphs[0]!, { id: "p3", text: "새 번역" }],
    };
    await store.commitChapter(changed);
    expect((await store.read(changed.cacheKey))?.position).toEqual({
      chapterId: c.source.chapterId,
      paragraphId: "p3",
      offset: 0,
    });
  });
  it("serializes overlapping checkpoint and commit without downgrading completion", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await Promise.all([
      store.saveCheckpoint(checkpoint(c)),
      store.commitChapter(c),
      store.saveCheckpoint(checkpoint(c)),
    ]);
    expect((await store.read(c.cacheKey))?.chapter).toEqual(c);
    expect((await store.read(c.cacheKey))?.checkpoint).toBeNull();
  });
  it("rejects unsafe keys and refuses unsupported schema without overwriting", async () => {
    const files = new Files(),
      store = createReaderStore(files);
    await expect(store.read("../secret")).rejects.toMatchObject({
      reason: "invalid",
    });
    const c = await fixture();
    await expect(
      store.commitChapter({
        ...c,
        schemaVersion: 2,
      } as unknown as CompletedChapter),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(files.data.size).toBe(0);
  });
});

describe("recovery and trust boundaries", () => {
  it("allows explicit retry after an interrupted first save without marking corrupt data complete", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    files.fail = "partial";
    await expect(store.commitChapter(c)).rejects.toMatchObject({
      reason: "io",
    });
    files.fail = null;
    await expect(store.read(c.cacheKey)).rejects.toMatchObject({
      reason: "corrupt",
    });
    await store.commitChapter(c);
    expect((await store.read(c.cacheKey))?.chapter).toEqual(c);
  });
  it("allows an explicit new checkpoint to replace unrecoverable corrupt records", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await store.commitChapter(c);
    for (const key of files.data.keys()) files.data.set(key, "{");
    await store.saveCheckpoint(checkpoint(c));
    expect((await store.read(c.cacheKey))?.checkpoint).toEqual(checkpoint(c));
  });
  it("detects valid JSON tampering by checksum and falls back to the previous valid slot", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await store.commitChapter(c);
    await store.commitChapter({ ...c, completedAt: "2026-10-05T00:00:00Z" });
    const key = [...files.data.keys()].at(-1)!,
      record = JSON.parse(files.data.get(key)!);
    record.payload.chapter.paragraphs[0].text = "tampered";
    files.data.set(key, JSON.stringify(record));
    expect((await store.read(c.cacheKey))?.chapter).toEqual(c);
  });
  it("preserves future envelopes during read and new writes", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await store.commitChapter(c);
    const key = [...files.data.keys()][0]!,
      record = JSON.parse(files.data.get(key)!);
    record.format = 2;
    const raw = JSON.stringify(record);
    files.data.set(key, raw);
    await expect(store.read(c.cacheKey)).rejects.toMatchObject({
      reason: "unsupported_schema",
    });
    await expect(store.commitChapter(c)).rejects.toMatchObject({
      reason: "unsupported_schema",
    });
    expect(files.data.get(key)).toBe(raw);
  });
  it("snapshots caller-owned inputs before asynchronous writes", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture(),
      expected = structuredClone(c);
    const writing = store.commitChapter(c);
    (c.paragraphs[0] as { text: string }).text = "changed later";
    await writing;
    expect((await store.read(c.cacheKey))?.chapter).toEqual(expected);
  });
  it("rejects extra secret fields rather than writing them to private body files", async () => {
    const files = new Files(),
      store = createReaderStore(files),
      c = await fixture();
    await expect(
      store.commitChapter({ ...c, secret: "fake-secret" } as CompletedChapter),
    ).rejects.toMatchObject({ reason: "invalid" });
    expect(files.data.size).toBe(0);
  });
});

it("protects a newer payload schema with an otherwise valid journal checksum", async () => {
  const { digest } = await import("../../src/storage/journal");
  const files = new Files(),
    store = createReaderStore(files),
    c = await fixture();
  await store.commitChapter(c);
  const key = [...files.data.keys()][0]!,
    record = JSON.parse(files.data.get(key)!);
  record.payload.chapter.schemaVersion = 2;
  record.checksum = await digest([1, record.generation, record.payload]);
  const raw = JSON.stringify(record);
  files.data.set(key, raw);
  await expect(store.read(c.cacheKey)).rejects.toMatchObject({
    reason: "unsupported_schema",
  });
  await expect(store.commitChapter(c)).rejects.toMatchObject({
    reason: "unsupported_schema",
  });
  expect(files.data.get(key)).toBe(raw);
});

it("returns a sanitized rejected promise for non-cloneable inputs", async () => {
  const store = createReaderStore(new Files()),
    c = await fixture();
  const invalid = { ...c, unexpected: () => "fake-secret" } as CompletedChapter;
  let pending: Promise<void> | undefined;
  expect(() => {
    pending = store.commitChapter(invalid);
  }).not.toThrow();
  await expect(pending).rejects.toMatchObject({
    code: "storage",
    reason: "invalid",
    message: "storage",
  });
});
