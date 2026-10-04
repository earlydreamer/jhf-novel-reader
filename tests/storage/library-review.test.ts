// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { parseChapter } from '../../src/source';
import { createLibraryStore } from '../../src/storage/library';
import type { CompletedTranslation, SourceSnapshot, WorkPage } from '../../src/contracts';
const html =
  '<h1 class="p-novel__title">合成</h1><div class="p-novel__body"><div class="p-novel__text"><p>本文</p></div></div>';
function setup() {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  return { memory, files, store: createLibraryStore(files) };
}
async function translated(url: string): Promise<CompletedTranslation> {
  const chapter = await parseChapter(html, url);
  const source: SourceSnapshot = {
    ...chapter,
    captureKind: 'fetched',
    rawHtml: html,
    fetchedAt: '2026-10-04T00:00:00Z',
  };
  return {
    schemaVersion: 2,
    versionId: 'version-1',
    source,
    text: '번역',
    blocks: [{ id: 'block-1', text: '번역' }],
    createdAt: '2026-10-04T00:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'local',
      modelId: 'actual',
      contractVersion: 'plain-v1',
      promptVersion: 'hymt2-ko-v1',
      languageDirection: 'ja-ko',
    },
  };
}
function page(chapterId = 'n1234ab/2'): WorkPage {
  return {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '作品',
    chapters: [
      {
        workId: 'n1234ab',
        chapterId,
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/2/',
        title: 'chapter',
        ordinal: 2,
      },
    ],
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
  };
}
test.each(['https://ncode.syosetu.com/n1234ab/2/', 'https://ncode.syosetu.com/n1234ab/'])(
  'real parser chapter identity survives library and positions: %s',
  async (url) => {
    const { store, memory } = setup();
    const value = await translated(url);
    await store.commitVersion(value);
    await store.saveWorkPage({
      ...page(value.source.chapterId),
      chapters: [
        {
          workId: value.source.workId,
          chapterId: value.source.chapterId,
          canonicalUrl: value.source.canonicalUrl,
          title: value.source.title,
          ordinal: url.endsWith('/2/') ? 2 : 1,
        },
      ],
    });
    expect(await store.listVersions(value.source.chapterId)).toEqual([value]);
    await store.savePosition({
      workId: value.source.workId,
      chapterId: value.source.chapterId,
      versionId: value.versionId,
      blockId: 'block-1',
      offset: 1,
    });
    expect((await store.readPosition(value.versionId))?.chapterId).toBe(value.source.chapterId);
    expect((await store.readWork(value.source.workId))[0]?.chapters[0]?.chapterId).toBe(
      value.source.chapterId,
    );
    expect([...memory.keys()].some((p) => p.includes('/2/') || p.includes('/short/'))).toBe(false);
  },
);
test('valid TOC page queries persist without broadening canonical URLs', async () => {
  const { store } = setup();
  const first = {
    ...page('temporary-safe'),
    chapters: [],
    nextPageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
    complete: false,
  };
  await store.saveWorkPage(first);
  await store.saveWorkPage({
    ...first,
    pageUrl: first.nextPageUrl,
    nextPageUrl: null,
    complete: true,
  });
  expect((await store.readWork('n1234ab')).map((p) => p.pageUrl)).toEqual([
    first.pageUrl,
    first.nextPageUrl,
  ]);
  await expect(store.saveWorkPage({ ...first, canonicalUrl: first.nextPageUrl })).rejects.toThrow();
});
test.each([
  'https://ncode.syosetu.com/n1234ab/?p=0',
  'https://ncode.syosetu.com/n1234ab/?p=2&key=x',
  'https://ncode.syosetu.com/n1234ab/?p=2#x',
  'https://evil.test/n1234ab/?p=2',
  'https://ncode.syosetu.com/n5678ab/?p=2',
  'https://ncode.syosetu.com/n1234ab/2/?p=2',
])('invalid work page query stays rejected: %s', async (pageUrl) => {
  await expect(setup().store.saveWorkPage({ ...page(), chapters: [], pageUrl })).rejects.toThrow();
});
test('save-only retry repairs a partial first body slot and refuses different valid content', async () => {
  const value = await translated('https://ncode.syosetu.com/n1234ab/2/');
  const safeValue = value;
  const { memory } = setup();
  let partial = true;
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, partial && p.startsWith('versions/') ? t.slice(0, 10) : t);
    },
  });
  await expect(store.commitVersion(safeValue)).rejects.toMatchObject({ reason: 'io' });
  partial = false;
  await store.commitVersion(safeValue);
  expect(await store.readVersion(safeValue.versionId)).toEqual(safeValue);
  await expect(
    store.commitVersion({ ...safeValue, text: '다름', blocks: [{ id: 'block-1', text: '다름' }] }),
  ).rejects.toThrow();
});

test.each(['unchanged fields', 'added future field', 'changed future field', 'removed v2 field'])(
  'same UUID recovery protects unknown version schemas: %s',
  async (shape) => {
    const { memory, store } = setup();
    const value = await translated('https://ncode.syosetu.com/n1234ab/2/');
    await store.commitVersion(value);
    const key = 'versions/version-1.0.json';
    const envelope = JSON.parse(memory.get(key)!) as {
      format: number;
      generation: number;
      payload: Record<string, unknown>;
      checksum: string;
    };
    envelope.payload.schemaVersion = 3;
    if (shape === 'added future field') envelope.payload.future = { segments: ['new schema'] };
    if (shape === 'changed future field') envelope.payload.text = { segments: ['new schema'] };
    if (shape === 'removed v2 field') delete envelope.payload.source;
    const { digest } = await import('../../src/storage/journal');
    envelope.checksum = await digest([1, envelope.generation, envelope.payload]);
    const raw = JSON.stringify(envelope);
    memory.set(key, raw);
    const before = [...memory.entries()];
    await expect(store.commitVersion(value)).rejects.toMatchObject({
      reason: 'unsupported_schema',
    });
    expect(memory.get(key)).toBe(raw);
    expect([...memory.entries()]).toEqual(before);
  },
);
