import { expect, test } from 'vitest';
import { createLibraryStore } from '../../src/storage/library';
import type { CompletedTranslation } from '../../src/contracts';
import { source } from '../providers/wholeChapterFixture';
const value: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'version-1',
  source,
  text: '번역',
  blocks: [{ id: 'b1', text: '번역' }],
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
test('independent_saved_lookup', async () => {
  const memory = new Map<string, string>();
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, t);
    },
  });
  await store.commitVersion(value);
  expect(await store.readVersion(value.versionId)).toEqual(value);
  expect(await store.listVersions(source.chapterId)).toEqual([value]);
});
test('작품 ID 조회는 전체 등록 순서를 복사본으로 반환한다', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const store = createLibraryStore(files);
  expect(await store.listWorkIds()).toEqual([]);
  const first = {
    workId: 'n1234aa',
    canonicalUrl: 'https://ncode.syosetu.com/n1234aa/',
    title: '첫 작품',
    chapters: [
      {
        workId: 'n1234aa',
        chapterId: 'n1234aa/1',
        canonicalUrl: 'https://ncode.syosetu.com/n1234aa/1/',
        title: '1화',
        ordinal: 1,
      },
    ],
    pageUrl: 'https://ncode.syosetu.com/n1234aa/',
    nextPageUrl: null,
    complete: true,
  };
  const second = {
    ...first,
    workId: 'n5678bb',
    canonicalUrl: 'https://ncode.syosetu.com/n5678bb/',
    title: '둘째 작품',
    chapters: [
      {
        workId: 'n5678bb',
        chapterId: 'n5678bb/1',
        canonicalUrl: 'https://ncode.syosetu.com/n5678bb/1/',
        title: '1화',
        ordinal: 1,
      },
    ],
    pageUrl: 'https://ncode.syosetu.com/n5678bb/',
  };
  await store.saveWorkPage(first);
  await store.saveWorkPage(second);
  expect(await store.listWorkIds()).toEqual(['n1234aa', 'n5678bb']);
  const ids = await store.listWorkIds();
  (ids as string[]).reverse();
  expect(await store.listWorkIds()).toEqual(['n1234aa', 'n5678bb']);
  expect(await createLibraryStore(files).listWorkIds()).toEqual(['n1234aa', 'n5678bb']);
});
test('quality survives reopening; legacy versions remain readable and invalid block references are rejected', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const store = createLibraryStore(files);
  const reviewed: CompletedTranslation = {
    ...value,
    quality: {
      ruleVersion: 'deterministic-v1',
      japaneseBlocks: [0],
      missingTerms: [{ source: 'アル', target: '알' }],
    },
  };
  await store.commitVersion(reviewed);
  expect(await createLibraryStore(files).readVersion(value.versionId)).toEqual(reviewed);
  await store.commitVersion({ ...value, versionId: 'old-without-quality' });
  expect((await store.readVersion('old-without-quality'))?.quality).toBeUndefined();
  await expect(
    store.commitVersion({
      ...reviewed,
      versionId: 'bad-quality',
      quality: { ...reviewed.quality!, japaneseBlocks: [1] },
    }),
  ).rejects.toThrow();
  await expect(
    store.commitVersion({
      ...reviewed,
      versionId: 'duplicate-quality',
      quality: { ...reviewed.quality!, japaneseBlocks: [0, 0] },
    }),
  ).rejects.toThrow();
});

test('이전 생성 기록과 새 추정기 기록을 모두 재열고 알 수 없는 추정기는 거부한다', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const store = createLibraryStore(files);
  for (const estimator of [undefined, 'utf8-v1', 'gemma-e4b-v1'] as const) {
    const version: CompletedTranslation = {
      ...value,
      versionId: estimator ?? 'legacy-lines',
      provenance: {
        ...value.provenance,
        promptVersion: 'lines-v1',
        generation: {
          mode: 'lines-v1',
          contextTokens: 16384,
          inputBudgetTokens: 5290,
          maxOutputTokens: 10582,
          segments: 3,
          continuations: 0,
          ...(estimator ? { estimator } : {}),
        },
      },
    };
    await store.commitVersion(version);
    expect(await createLibraryStore(files).readVersion(version.versionId)).toEqual(version);
  }
  const unknown: CompletedTranslation = {
    ...value,
    versionId: 'unknown-estimator',
    provenance: {
      ...value.provenance,
      promptVersion: 'lines-v1',
      generation: {
        mode: 'lines-v1',
        contextTokens: 8192,
        inputBudgetTokens: 2048,
        maxOutputTokens: 4096,
        segments: 1,
        estimator: 'unknown' as 'utf8-v1',
      },
    },
  };
  await expect(store.commitVersion(unknown)).rejects.toThrow();
});
test('save_retry_is_idempotent', async () => {
  const memory = new Map<string, string>();
  let fail = true;
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      if (fail && p.startsWith('library/')) throw Error();
      memory.set(p, t);
    },
  });
  await expect(store.commitVersion(value)).rejects.toThrow();
  fail = false;
  await store.commitVersion(value);
  await store.commitVersion(value);
  expect(await store.listVersions(source.chapterId)).toHaveLength(1);
  await expect(
    store.commitVersion({ ...value, text: '다른', blocks: [{ id: 'b1', text: '다른' }] }),
  ).rejects.toThrow();
  expect(await store.readVersion(value.versionId)).toEqual(value);
});

test('positions and recent pointer persist across independent factories', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const first = createLibraryStore(files);
  await first.commitVersion(value);
  await first.savePosition({
    workId: source.workId,
    chapterId: source.chapterId,
    versionId: value.versionId,
    blockId: 'b1',
    offset: 1,
  });
  const reopened = createLibraryStore(files);
  expect(await reopened.readPosition(value.versionId)).toMatchObject({ blockId: 'b1', offset: 1 });
  expect(await reopened.listRecent()).toEqual([
    {
      workId: source.workId,
      chapterId: source.chapterId,
      versionId: value.versionId,
      updatedAt: expect.any(String),
    },
  ]);
  await expect(
    reopened.savePosition({
      workId: 'other',
      chapterId: source.chapterId,
      versionId: value.versionId,
      blockId: 'b1',
      offset: 1,
    }),
  ).rejects.toThrow();
});
test('partial durable write cannot publish a ready version', async () => {
  const memory = new Map<string, string>();
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, t.slice(0, 20));
    },
  });
  await expect(store.commitVersion(value)).rejects.toMatchObject({ reason: 'io' });
  expect(memory.has('library/index.0.json')).toBe(false);
});
test('work pages and independent translation structures roundtrip', async () => {
  const memory = new Map<string, string>();
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      memory.set(p, t);
    },
  });
  const page = {
    workId: source.workId,
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: 'work',
    chapters: [
      {
        workId: source.workId,
        chapterId: source.chapterId,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        ordinal: 1,
      },
    ],
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
  };
  await store.saveWorkPage(page);
  expect(await store.readWork(source.workId)).toEqual([page]);
  await store.commitVersion(value);
  expect((await store.readVersion(value.versionId))?.source.rawHtml).toBe(source.rawHtml);
});

test('reading an older saved version moves the durable recent pointer', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const store = createLibraryStore(files);
  await store.commitVersion(value);
  await store.commitVersion({
    ...value,
    versionId: 'version-2',
    createdAt: '2026-10-05T00:00:00Z',
  });
  await store.savePosition({
    workId: source.workId,
    chapterId: source.chapterId,
    versionId: value.versionId,
    blockId: 'b1',
    offset: 1,
  });
  expect((await createLibraryStore(files).listRecent())[0]?.versionId).toBe(value.versionId);
  expect((await store.listVersions(source.chapterId))[0]?.versionId).toBe('version-2');
});

test('부분 인덱스 손상은 pending 삭제 여부가 불명확하므로 재등록을 차단한다', async () => {
  const memory = new Map<string, string>();
  let partial = true;
  const writes: string[] = [];
  const store = createLibraryStore({
    read: async (p) => memory.get(p) ?? null,
    write: async (p, t) => {
      writes.push(p);
      memory.set(p, partial && p.startsWith('library/') ? t.slice(0, 10) : t);
    },
  });
  await expect(store.commitVersion(value)).rejects.toMatchObject({ reason: 'io' });
  partial = false;
  await expect(store.commitVersion(value)).rejects.toMatchObject({ reason: 'corrupt' });
  expect(await store.readVersion(value.versionId)).toEqual(value);
  expect(writes.filter((p) => p.startsWith('versions/'))).toHaveLength(1);
});

test('termDecision 기록은 이름 80자·50개·정수 ms·judged 형식을 지키고 기록이 없는 저장본은 그대로 통과한다', async () => {
  const memory = new Map<string, string>();
  const files = {
    read: async (p: string) => memory.get(p) ?? null,
    write: async (p: string, t: string) => {
      memory.set(p, t);
    },
  };
  const store = createLibraryStore(files);
  const withDecision = (termDecision: unknown, versionId = 'term-decision') =>
    ({
      ...value,
      versionId,
      provenance: { ...value.provenance, termDecision },
    }) as unknown as CompletedTranslation;
  const valid = {
    confirmed: ['ルシア', 'ケイ'],
    rejected: [],
    ms: 0,
  };
  // judged가 없는 기록은 이전 버전(#241)이 남긴 저장본이라 계속 읽혀야 한다.
  const accepted = withDecision(valid);
  await store.commitVersion(accepted);
  expect(await createLibraryStore(files).readVersion('term-decision')).toEqual(accepted);

  const counted = withDecision({ ...valid, judged: 2 }, 'term-decision-judged');
  await store.commitVersion(counted);
  expect(await createLibraryStore(files).readVersion('term-decision-judged')).toEqual(counted);

  const rejected = [
    { ...valid, confirmed: ['가'.repeat(81)] },
    { ...valid, rejected: Array.from({ length: 51 }, (_, i) => `n${i}`) },
    { ...valid, ms: -1 },
    { ...valid, ms: 1.5 },
    { ...valid, judged: -1 },
    { ...valid, judged: 1.5 },
    { ...valid, confirmed: [''] },
    { ...valid, extra: true },
    { confirmed: ['ルシア'], ms: 3 },
  ];
  for (const termDecision of rejected) {
    await expect(store.commitVersion(withDecision(termDecision))).rejects.toThrow();
  }
  await store.commitVersion(value);
  expect(await store.readVersion(value.versionId)).toEqual(value);
});
