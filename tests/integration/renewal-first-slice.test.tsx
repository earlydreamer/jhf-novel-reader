// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { createRenewalApplication } from '../../src/app/compose';

// 기기 판정 모델은 네이티브 전용이라, 이 파일에서만 사용 가능 여부를 가짜로 바꾼다.
const embeddingPort = vi.hoisted(() => ({ ready: false }));
vi.mock('../../src/platform/embedding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/platform/embedding')>();
  return {
    ...actual,
    capacitorEmbedding: {
      ...actual.noEmbedding,
      available: () => embeddingPort.ready,
      status: async () => ({ installed: true, bytes: 1, loaded: false, downloading: false }),
      embed: async (texts: readonly string[]) => texts.map(() => [1, 0]),
    },
  };
});
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';
import { createLastChapterRepository } from '../../src/app/lastChapter';
import { digest } from '../../src/storage/journal';
import { createReaderStore } from '../../src/storage/store';
import { createAttemptRepository } from '../../src/translation/attempts';
import { createTitleRepository } from '../../src/translation/titles';
import { StorageError } from '../../src/storage/errors';
import type { NativeHttpRequest, HttpResponse, AppLifecycle } from '../../src/contracts';
import { createCacheKey, type CompletedChapter } from '../../src/contracts/legacy';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Application } from '../../src/app/Application';

function chooseShellMenu(item: string) {
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const otherWorkUrl = 'https://ncode.syosetu.com/n5678cd/';
const chapterUrl = workUrl + '2/';
const toc = `<h1 class="p-novel__title">合成作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">第一話</a></div><div class="p-eplist__sublist"><a href="/n1234ab/2/">第二話</a></div>`;
const otherToc = `<h1 class="p-novel__title">別の合成作品</h1><div class="p-eplist__sublist"><a href="/n5678cd/1/">第一話</a></div>`;
const html =
  '<h1 class="p-novel__title">第二話</h1><div class="p-novel__body"><div class="p-novel__text"><p>開始<ruby>漢字<rt>かんじ</rt></ruby></p><p></p><p>終わり</p></div></div>';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}
function harness() {
  // 번역 흐름과 요청 순서를 검증하는 하네스라 자동 용어집(추가 모델 요청)은 끈 상태로 시작한다.
  const bytes = new Map<string, string>(),
    preferences = new Map<string, string>([
      [
        'narou-reader.reading-settings.v2',
        JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 18, autoGlossary: false }),
      ],
    ]),
    secrets = new Map<string, string>();
  let chapterHtml = html;
  const requests: NativeHttpRequest[] = [];
  let failSave = false,
    holdSave = false;
  const saveGate = deferred<void>();
  let response = deferred<HttpResponse>();
  let listener: (active: boolean) => void = () => {};
  const lifecycle: AppLifecycle = {
    async isActive() {
      return true;
    },
    async subscribe(fn) {
      listener = fn;
      return async () => {};
    },
  };
  const files = {
    async read(path: string) {
      return bytes.get(path) ?? null;
    },
    async write(path: string, value: string) {
      if (path.startsWith('versions/')) {
        if (failSave) throw new Error('disk');
        if (holdSave) await saveGate.promise;
      }
      bytes.set(path, value);
    },
  };
  const client = {
    async request(options: NativeHttpRequest) {
      requests.push(options);
      if (options.method === 'POST') return response.promise;
      return {
        status: 200,
        url: options.url,
        headers: { 'Content-Type': 'text/html' },
        data: options.url.endsWith('/models')
          ? JSON.stringify({ data: [{ id: 'hymt2-7b' }] })
          : options.url === workUrl
            ? toc
            : options.url === otherWorkUrl
              ? otherToc
              : chapterHtml,
      };
    },
  };
  const adapters = {
    files,
    preferences: {
      async get({ key }: { key: string }) {
        return { value: preferences.get(key) ?? null };
      },
      async set({ key, value }: { key: string; value: string }) {
        preferences.set(key, value);
      },
    },
    secrets: {
      async get(ref: string) {
        return secrets.get(ref) ?? null;
      },
      async set(ref: string, value: string) {
        secrets.set(ref, value);
      },
      async remove(ref: string) {
        secrets.delete(ref);
      },
    },
    lifecycle,
    sourceTransport: createSourceTransport(client),
    modelTransport: createModelTransport(client),
    browse: async () => ({ selectedUrl: chapterUrl }),
  };
  const app = createRenewalApplication(adapters);
  const posts = () => requests.filter((r) => r.method === 'POST');
  const settle = () =>
    response.resolve({
      status: 200,
      url: posts().at(-1)!.url,
      headers: {},
      data: JSON.stringify({
        choices: [
          { finish_reason: 'stop', message: { content: '<p id="A">처음</p>\r\n<p id="B">끝</p>' } },
        ],
      }),
    });
  return {
    app,
    adapters,
    bytes,
    requests,
    posts,
    settle,
    holdResponse: () => {
      response = deferred<HttpResponse>();
    },
    lifecycle: (active: boolean) => listener(active),
    setFailSave: (value: boolean) => {
      failSave = value;
    },
    holdSave: () => {
      holdSave = true;
    },
    releaseSave: () => saveGate.resolve(),
    setChapterHtml: (value: string) => {
      chapterHtml = value;
    },
    store: createLibraryStore(files),
  };
}
async function prepare(h: ReturnType<typeof harness>) {
  await h.app.initialize();
  h.app.changeAutoTranslate(false);
  // These tests exercise body-request ownership. Titles are already saved independently.
  await createTitleRepository(h.adapters.files).save('n1234ab', [
    {
      key: 'n1234ab',
      source: '合成作品',
      target: '합성 작품',
      origin: 'user',
      updatedAt: '2026-10-08T00:00:00Z',
    },
    {
      key: 'n1234ab/1',
      source: '第一話',
      target: '1화',
      origin: 'user',
      updatedAt: '2026-10-08T00:00:00Z',
    },
    {
      key: 'n1234ab/2',
      source: '第二話',
      target: '2화',
      origin: 'user',
      updatedAt: '2026-10-08T00:00:00Z',
    },
  ]);
  await h.app.browse();
  expect(h.app.getSnapshot().route).toMatchObject({ kind: 'work', selectedChapterId: 'n1234ab/2' });
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[1]!);
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://100.64.0.8:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('hymt2-7b');
}
it.each(['set', 'get'] as const)(
  'secure-store %s failure stops catalog HTTP and preserves the existing credential reference',
  async (method) => {
    const h = harness();
    await prepare(h);
    await h.app.checkConnection('original-synthetic-secret');
    const originalRef = h.app.getSnapshot().connection.authRef;
    const count = h.requests.length;
    const originalGet = h.adapters.secrets.get;
    const originalSet = h.adapters.secrets.set;
    const originalRemove = h.adapters.secrets.remove;
    const removed: string[] = [];
    h.adapters.secrets[method] = async () => {
      throw new StorageError('secure');
    };
    h.adapters.secrets.remove = async (ref) => {
      removed.push(ref);
      throw new StorageError('secure');
    };
    await h.app.checkConnection(method === 'set' ? 'new-synthetic-secret' : '');
    expect(h.app.getSnapshot().catalogStatus).toBe('storage');
    expect(h.app.getSnapshot().connection.authRef).toBe(originalRef);
    expect(h.requests).toHaveLength(count);
    expect(removed).not.toContain(originalRef);
    expect(JSON.stringify(h.app.getSnapshot())).not.toContain('new-synthetic-secret');
    expect(
      await h.adapters.preferences.get({ key: 'narou-reader.reading-settings.v2' }),
    ).not.toMatchObject({
      value: expect.stringContaining('new-synthetic-secret'),
    });
    h.adapters.secrets.get = originalGet;
    h.adapters.secrets.set = originalSet;
    h.adapters.secrets.remove = originalRemove;
    await h.app.checkConnection();
    expect(h.app.getSnapshot().catalogStatus).toBe('connected');
    expect(h.posts()).toHaveLength(0);
    h.app.dispose();
  },
);
it('secure-store read failure during generation is storage failure without a model POST', async () => {
  const h = harness();
  await prepare(h);
  await h.app.checkConnection('synthetic-secret');
  h.adapters.secrets.get = async () => {
    throw new StorageError('secure');
  };
  await h.app.translate();
  expect(h.app.getSnapshot().translation).toMatchObject({
    phase: 'failed',
    error: { code: 'storage', outcome: 'not_sent' },
  });
  expect(h.app.getSnapshot().translation.pendingSave).toBeUndefined();
  expect(h.posts()).toHaveLength(0);
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(0);
  h.app.dispose();
});
it('native catalog TLS rejection is a connection failure without exposing its error', async () => {
  const h = harness();
  const app = createRenewalApplication({
    ...h.adapters,
    modelTransport: createModelTransport({
      async request() {
        throw new Error('SSLHandshakeException private-TLS-error-canary');
      },
    }),
  });
  await app.initialize();
  app.changeConnection({
    provider: 'openai-compatible',
    baseUrl: 'https://chosen.example.test/v1',
  });
  await app.checkConnection();
  expect(app.getSnapshot().catalogStatus).toBe('connection');
  expect(JSON.stringify(app.getSnapshot())).not.toContain('private-TLS-error-canary');
  expect(h.posts()).toHaveLength(0);
  app.dispose();
  h.app.dispose();
});
async function legacyCompleted(): Promise<CompletedChapter> {
  const identity = {
    canonicalUrl: 'https://ncode.syosetu.com/n9999ab/1/',
    sourceHash: 'legacy-source',
    provider: 'openai-compatible' as const,
    normalizedEndpoint: 'http://192.0.2.1:1234/v1',
    model: 'legacy-model',
    promptVersion: 'legacy-prompt',
    languageDirection: 'ja-ko' as const,
  };
  return {
    schemaVersion: 1,
    cacheKey: await createCacheKey(identity),
    identity,
    source: {
      canonicalUrl: identity.canonicalUrl,
      sourceHash: identity.sourceHash,
      workId: 'n9999ab',
      chapterId: 'n9999ab/1',
      title: '레거시 화',
      prevUrl: null,
      nextUrl: null,
      paragraphs: [{ id: 'p1', text: '原文', ruby: [] }],
    },
    paragraphs: [{ id: 'p1', text: '저장된 번역' }],
    completedAt: '2026-10-04T00:00:00.000Z',
  };
}
it('native composition exposes per-item v1 warnings while retaining saved reading without generation', async () => {
  const h = harness();
  const legacy = await legacyCompleted();
  await createReaderStore(h.adapters.files).commitChapter(legacy);
  const corrupt = 'v1-' + (await digest('corrupt-fixture'));
  const unsupported = 'v1-' + (await digest('unsupported-fixture'));
  h.bytes.set('chapters/' + corrupt + '.0.json', '{');
  const envelope = (payload: unknown) => JSON.stringify({ format: 1, generation: 1, payload });
  const checkpoint = {
    schemaVersion: 1,
    cacheKey: legacy.cacheKey,
    identity: legacy.identity,
    chapter: legacy.source,
    token: { jobId: 'fixture', chapterId: legacy.source.chapterId, settingsRevision: 1 },
    chunks: [],
  };
  // Use a valid distinct cache identity for the unfinished entry.
  checkpoint.identity = { ...legacy.identity, model: 'unfinished' };
  checkpoint.cacheKey = await createCacheKey(checkpoint.identity);
  const payload = { chapter: null, checkpoint };
  h.bytes.set(
    'chapters/' + checkpoint.cacheKey + '.0.json',
    JSON.stringify({
      ...JSON.parse(envelope(payload)),
      checksum: await digest([1, 1, payload]),
    }),
  );
  h.bytes.set('chapters/' + unsupported + '.0.json', JSON.stringify({ format: 3 }));
  const before = new Map(h.bytes);
  const files = {
    ...h.adapters.files,
    async list() {
      return [...h.bytes.keys()]
        .filter((path) => path.startsWith('chapters/'))
        .map((path) => path.slice(9));
    },
  };
  const app = createRenewalApplication({ ...h.adapters, files });
  await app.initialize();
  expect(app.getSnapshot().legacyWarnings).toEqual(
    expect.arrayContaining([
      { cacheKey: corrupt, reason: 'unreadable' },
      { cacheKey: unsupported, reason: 'unreadable' },
      { cacheKey: checkpoint.cacheKey, reason: 'unfinished' },
    ]),
  );
  expect(app.getSnapshot().legacyWarnings).toHaveLength(3);
  for (const [path, content] of before) expect(h.bytes.get(path)).toBe(content);
  await app.continueReading(app.getSnapshot().recent[0]!.versionId);
  expect(app.getSnapshot().version?.text).toBe('저장된 번역');
  expect(h.posts()).toHaveLength(0);
  app.dispose();
  h.app.dispose();
});
async function dispatched(h: ReturnType<typeof harness>, expected = 1) {
  await expect.poll(() => h.posts().length).toBe(expected);
}
it.each([
  { direction: 'next', readerIndex: 0, activeIndex: 0 },
  { direction: 'next', readerIndex: 0, activeIndex: 1 },
  { direction: 'previous', readerIndex: 1, activeIndex: 0 },
  { direction: 'previous', readerIndex: 1, activeIndex: 1 },
])(
  'allows $direction saved reading from chapter $readerIndex while chapter $activeIndex is translating (#289)',
  async ({ readerIndex, activeIndex }) => {
    const h = harness();
    let pending: Promise<void> | undefined;
    const loadGate = deferred<void>();
    const read = h.adapters.files.read;
    try {
      await prepare(h);
      const saved = await translateOnce(h);
      const chapters = h.app.getSnapshot().work!.chapters;
      await h.store.commitVersion({
        ...saved,
        versionId: 'saved-first-chapter',
        source: {
          ...saved.source,
          chapterId: chapters[0]!.chapterId,
          canonicalUrl: chapters[0]!.canonicalUrl,
          title: chapters[0]!.title,
        },
      });
      await h.app.selectChapter(chapters[activeIndex]!);
      h.holdResponse();
      pending = h.app.retranslateChapter();
      await dispatched(h, 2);
      h.app.back();
      h.app.showContents();
      await h.app.selectChapter(chapters[readerIndex]!);
      expect(h.app.getSnapshot()).toMatchObject({
        busy: false,
        translationActive: true,
        route: { kind: 'reader' },
        chapter: { chapterId: chapters[readerIndex]!.chapterId },
      });
      render(<Application controller={h.app} />);
      fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
      const navigation = screen.getByRole('button', {
        name: readerIndex === 0 ? '다음 화' : '이전 화',
      });
      expect(navigation.hasAttribute('disabled')).toBe(false);
      expect(screen.queryByText('회차를 불러오고 있어요.')).toBeNull();
      if (readerIndex === 0)
        expect(screen.getByRole('button', { name: '2화 읽기' }).hasAttribute('disabled')).toBe(
          false,
        );
      fireEvent.click(screen.getByRole('button', { name: '더보기' }));
      expect(screen.queryByRole('menuitem', { name: '이 화 다시 번역하기' })).toBeNull();
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

      // 실제 저장본 로딩은 계속 이동을 막고 로딩 안내를 보여야 한다.
      h.adapters.files.read = async (path: string) => {
        if (path.startsWith('versions/')) await loadGate.promise;
        return read(path);
      };
      let loading!: Promise<void>;
      await act(async () => {
        loading = h.app.selectChapter(chapters[readerIndex]!);
      });
      expect(h.app.getSnapshot().busy).toBe(true);
      expect(navigation.hasAttribute('disabled')).toBe(true);
      expect(screen.getByText('회차를 불러오고 있어요.')).toBeDefined();
      fireEvent.click(navigation);
      expect(h.app.getSnapshot().chapter?.chapterId).toBe(chapters[readerIndex]!.chapterId);
      await act(async () => {
        loadGate.resolve();
        await loading;
      });
      expect(navigation.hasAttribute('disabled')).toBe(false);
      expect(screen.queryByText('회차를 불러오고 있어요.')).toBeNull();

      fireEvent.click(navigation);
      await expect
        .poll(() => h.app.getSnapshot().version?.source.chapterId)
        .toBe(chapters[1 - readerIndex]!.chapterId);
      expect(h.app.getSnapshot()).toMatchObject({
        busy: false,
        translationActive: true,
        route: { kind: 'reader' },
      });
      await act(async () => {
        await h.app.translate();
        await h.app.retryTranslation();
      });
      expect(h.posts()).toHaveLength(2);
      await act(async () => {
        h.settle();
        await pending;
      });
      expect(h.app.getSnapshot().translationActive).toBe(false);
      expect(h.app.getSnapshot().version?.source.chapterId).toBe(
        chapters[1 - readerIndex]!.chapterId,
      );
      expect(h.posts()).toHaveLength(2);
    } finally {
      h.adapters.files.read = read;
      loadGate.resolve();
      if (pending) {
        await act(async () => {
          h.settle();
          await pending;
        });
      }
      cleanup();
      h.app.dispose();
    }
  },
);
it('browse_select_translate_save_read uses actual parser, native transport, catalog and library composition', async () => {
  const h = harness();
  await prepare(h);
  h.holdSave();
  const done = h.app.translate();
  await dispatched(h);
  expect(h.app.getSnapshot().version).toBeNull();
  const body = h.posts()[0]!.data!;
  expect(body.model).toBe('hymt2-7b');
  expect(body.stream).toBe(false);
  expect(body.max_tokens).toBe(2560);
  expect(body).not.toHaveProperty('response_format');
  expect(JSON.stringify(body.messages)).toContain('漢字《かんじ》');
  h.settle();
  await expect.poll(() => h.app.getSnapshot().translation.phase).toBe('saving');
  expect(h.app.getSnapshot().version).toBeNull();
  h.releaseSave();
  await done;
  const state = h.app.getSnapshot();
  expect(state.route.kind).toBe('reader');
  expect(state.version!.text).toBe('처음\n\n\n\n끝');
  expect(state.version!.blocks.map((b) => b.text).join('\n\n')).toBe(state.version!.text);
  expect(state.version!.source.rawHtml).toBe(html);
  expect(await h.store.readVersion(state.version!.versionId)).toEqual(state.version);
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('initialization migrates only the v1 chapter reached by its last-chapter pointer', async () => {
  const h = harness();
  const legacy = await legacyCompleted();
  await createReaderStore(h.adapters.files).commitChapter(legacy);
  await createLastChapterRepository(h.adapters.preferences).save(legacy.cacheKey);

  await h.app.initialize();

  const versions = await h.store.listVersions(legacy.source.chapterId);
  expect(versions).toHaveLength(1);
  expect(versions[0]?.source.captureKind).toBe('legacy-import');
  expect(h.app.getSnapshot().recent[0]).toMatchObject({
    versionId: versions[0]?.versionId,
    chapterId: legacy.source.chapterId,
  });
  h.app.dispose();
});
it('open_and_double_tap_generate_once without queued replacement', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  await h.app.translate();
  h.settle();
  await first;
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('late_response_never_retargets after route or settings change', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.app.navigate({ kind: 'home' });
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://100.64.0.9:1234' });
  h.settle();
  await first;
  expect(h.app.getSnapshot().route.kind).toBe('home');
  expect(h.app.getSnapshot().version).toBeNull();
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('cancel_keeps_native_slot until actual native settlement', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.app.cancelTranslation();
  expect(h.app.getSnapshot().translationActive).toBe(true);
  await h.app.translate();
  expect(h.posts()).toHaveLength(1);
  h.settle();
  await first;
  expect(h.app.getSnapshot().translationActive).toBe(false);
  expect(h.app.getSnapshot().version).toBeNull();
  h.app.dispose();
});
it('user cancellation settles without the non-adopting snackbar', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.app.cancelTranslation();
  h.settle();
  await first;
  expect(h.app.getSnapshot().error).not.toBe(
    '이전 요청 결과는 자동으로 열지 않아요. 저장본을 열거나 다시 시도해 주세요.',
  );
  expect(['unknown', 'failed']).toContain(h.app.getSnapshot().translation.phase);
  expect(h.app.getSnapshot().translation.error?.code).toBe('cancelled');
  h.app.dispose();
});
it('settings change keeps the non-adopting snackbar for a result from the old settings', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://100.64.0.9:1234' });
  h.settle();
  await first;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.app.getSnapshot().error).toBe(
    '이전 요청 결과는 자동으로 열지 않아요. 저장본을 열거나 다시 시도해 주세요.',
  );
  h.app.dispose();
});
it('startup_never_reposts and interrupted attempts need explicit retry', async () => {
  const h = harness();
  await createAttemptRepository(h.adapters.files).write({
    token: { requestId: crypto.randomUUID(), chapterId: 'n1234ab/2', settingsRevision: 0 },
    phase: 'dispatching',
  });
  await prepare(h);
  expect(h.app.getSnapshot().translation.phase).toBe('unknown');
  expect(h.posts()).toHaveLength(0);
  expect(h.app.getSnapshot().translation.error?.outcome).toBe('unknown');
  h.app.dispose();
});
it('save_retry_calls_no_model and retains captured result across settings changes', async () => {
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const pending = h.app.getSnapshot().translation.pendingSave!;
  expect(pending).toBeDefined();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://100.64.0.9:1234' });
  h.setFailSave(false);
  await h.app.retrySave();
  expect(h.posts()).toHaveLength(1);
  expect(await h.store.readVersion(pending.versionId)).toEqual(pending);
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.app.getSnapshot().translation.pendingSave).toBeUndefined();
  expect(h.app.getSnapshot().translation.phase).toBe('ready');
  h.app.dispose();
});
it('source_and_catalog_not_generation and saved reading independent of server', async () => {
  const h = harness();
  await prepare(h);
  expect(h.posts()).toHaveLength(0);
  expect(h.requests.filter((r) => r.url === chapterUrl)).toHaveLength(0);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const id = h.app.getSnapshot().version!.versionId;
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: '' });
  await h.app.continueReading(id);
  expect(h.app.getSnapshot().route).toEqual({ kind: 'reader', versionId: id });
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('source refresh requires a separate explicit translation before creating a new version', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const previous = h.app.getSnapshot().version!.versionId;
  const postCount = h.posts().length;
  h.setChapterHtml(html.replace('終わり', '変化'));

  await h.app.continueReading(previous);

  await expect.poll(() => h.app.getSnapshot().sourceChange).toBe('changed');
  expect(h.posts()).toHaveLength(postCount);
  await h.app.refreshSource();
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.app.getSnapshot().translation.phase).toBe('idle');
  expect(h.posts()).toHaveLength(postCount);
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(1);
  await h.app.translate();
  const next = h.app.getSnapshot().version!.versionId;
  expect(next).not.toBe(previous);
  expect(h.posts()).toHaveLength(postCount + 1);
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(2);
  h.app.dispose();
});
it('page chrome changes outside the chapter body do not count as a source change', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const previous = h.app.getSnapshot().version!.versionId;
  h.setChapterHtml(
    `<div class="ad">広告 ${Date.now()}</div>` + html + '<script>var t="x"</script>',
  );

  await h.app.continueReading(previous);

  await expect.poll(() => h.app.getSnapshot().sourceChange).toBe('unchanged');
  expect(h.app.getSnapshot().route.kind).toBe('reader');
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(1);
  h.app.dispose();
});
it('background prevents dispatch and does not restart on foreground', async () => {
  const h = harness();
  await prepare(h);
  h.lifecycle(false);
  await h.app.translate();
  h.lifecycle(true);
  expect(h.posts()).toHaveLength(0);
  h.app.dispose();
});
it.each(['back', 'select'] as const)(
  'returning via %s to the same chapter never adopts an old response',
  async (returnVia) => {
    const h = harness();
    await prepare(h);
    const first = h.app.translate();
    await dispatched(h);
    h.app.navigate({ kind: 'home' });
    if (returnVia === 'back') h.app.back();
    else await h.app.selectChapter(h.app.getSnapshot().chapter!);
    h.settle();
    await first;
    expect(h.app.getSnapshot().route.kind).toBe('translation');
    expect(h.app.getSnapshot().version).toBeNull();
    expect(h.app.getSnapshot().translation.phase).toBe('ready');
    expect(h.posts()).toHaveLength(1);
    expect(await h.store.listVersions('n1234ab/2')).toHaveLength(1);
    await h.app.openSavedTranslation();
    expect(h.app.getSnapshot().route.kind).toBe('reader');
    expect(h.posts()).toHaveLength(1);
    h.app.dispose();
  },
);
it('back restores an earlier chapter without inheriting another chapter request state', async () => {
  const h = harness();
  await prepare(h);
  const [chapterA, chapterB] = h.app.getSnapshot().work!.chapters;
  await h.app.selectChapter(chapterA!);
  h.app.navigate({ kind: 'home' });
  await h.app.browse();
  await h.app.selectChapter(chapterB!);
  const translatingB = h.app.translate();
  await dispatched(h);
  h.app.back();
  h.app.back();
  h.app.back();
  expect(h.app.getSnapshot().chapter?.chapterId).toBe(chapterA!.chapterId);
  expect(h.app.getSnapshot().translation.phase).toBe('idle');
  expect(h.app.getSnapshot().translationActive).toBe(true);
  await h.app.translate();
  expect(h.posts()).toHaveLength(1);
  h.settle();
  await translatingB;
  expect(h.app.getSnapshot().route).toEqual({
    kind: 'translation',
    chapterId: chapterA!.chapterId,
  });
  expect(h.app.getSnapshot().translation.phase).toBe('idle');
  expect(h.app.getSnapshot().translationActive).toBe(false);
  expect(await h.store.listVersions(chapterB!.chapterId)).toHaveLength(1);
  await h.app.translate();
  expect(h.posts()).toHaveLength(2);
  expect(h.app.getSnapshot().version?.source.chapterId).toBe(chapterA!.chapterId);
  h.app.dispose();
});
it('cancel during durable save never opens the reader', async () => {
  const h = harness();
  await prepare(h);
  h.holdSave();
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await expect.poll(() => h.app.getSnapshot().translation.phase).toBe('saving');
  h.app.cancelTranslation();
  h.releaseSave();
  await first;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  h.app.dispose();
});
it('trusted Home opens the native discovery action and exposes explicit cancellation', async () => {
  const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
  const { Application } = await import('../../src/app/Application');
  const h = harness();
  render(<Application controller={h.app} />);
  await expect.poll(() => h.app.getSnapshot().recent.length).toBe(0);
  const browse = screen.getByRole('button', { name: '작품 찾기' });
  expect(browse.hasAttribute('disabled')).toBe(false);
  fireEvent.click(browse);
  await expect.poll(() => h.app.getSnapshot().work?.title).toBe('合成作品');
  cleanup();
  h.app.dispose();
});
it('pendingSave remains available after leaving and returning without another generation', async () => {
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const pending = h.app.getSnapshot().translation.pendingSave!;
  h.app.navigate({ kind: 'home' });
  await h.app.openWork(workUrl);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[1]!);
  expect(h.app.getSnapshot().translation.pendingSave).toEqual(pending);
  h.setFailSave(false);
  await h.app.retrySave();
  expect(h.app.getSnapshot().route.kind).toBe('reader');
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('openPendingSave returns to the pending chapter without stacking a same-work route', async () => {
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const pending = h.app.getSnapshot().translation.pendingSave!;

  h.app.showContents();
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  h.app.openPendingSave();

  expect(h.app.getSnapshot().route).toEqual({ kind: 'translation', chapterId: 'n1234ab/2' });
  expect(h.app.getSnapshot().chapter?.chapterId).toBe(pending.source.chapterId);
  expect(h.app.getSnapshot().translation.pendingSave).toEqual(pending);
  h.app.back();
  expect(h.app.getSnapshot().route).toEqual({
    kind: 'work',
    workId: 'n1234ab',
    selectedChapterId: 'n1234ab/2',
  });
  h.app.dispose();
});
it('openPendingSave restores the other work reader and position on back', async () => {
  const h = harness();
  await prepare(h);
  const firstPostCount = h.posts().length + 1;
  const initial = h.app.translate();
  await dispatched(h, firstPostCount);
  h.settle();
  await initial;
  expect(h.posts()).toHaveLength(1);
  const originalVersion = h.app.getSnapshot().version!;
  await h.app.savePosition(originalVersion.blocks[0]!.id, 47.5);

  await h.store.commitVersion({
    ...originalVersion,
    versionId: 'saved-other-work',
    source: {
      ...originalVersion.source,
      workId: 'n5678cd',
      chapterId: 'n5678cd/1',
      canonicalUrl: `${otherWorkUrl}1/`,
      title: '別作品 第一話',
      sourceHash: 'other-work-source',
    },
  });
  await h.app.openWork(otherWorkUrl);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  const otherVersion = h.app.getSnapshot().version!;
  expect(otherVersion.versionId).toBe('saved-other-work');
  await h.app.savePosition(otherVersion.blocks[0]!.id, 83.25);

  await h.app.openWork(workUrl);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[1]!);
  h.setFailSave(true);
  await h.app.refreshSource();
  const pendingPostCount = h.posts().length + 1;
  const pendingTranslation = h.app.translate();
  await dispatched(h, pendingPostCount);
  h.settle();
  await pendingTranslation;
  const pending = h.app.getSnapshot().translation.pendingSave!;

  await h.app.openWork(otherWorkUrl);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  expect(h.app.getSnapshot().route).toEqual({ kind: 'reader', versionId: otherVersion.versionId });
  h.app.openPendingSave();
  expect(h.app.getSnapshot().route).toEqual({ kind: 'translation', chapterId: 'n1234ab/2' });
  expect(h.app.getSnapshot().chapter?.chapterId).toBe(pending.source.chapterId);

  h.app.back();
  expect(h.app.getSnapshot().route).toEqual({ kind: 'reader', versionId: otherVersion.versionId });
  expect(h.app.getSnapshot().work?.workId).toBe('n5678cd');
  expect(h.app.getSnapshot().chapter?.chapterId).toBe('n5678cd/1');
  expect(h.app.getSnapshot().version?.versionId).toBe(otherVersion.versionId);
  expect(h.app.getSnapshot().position).toMatchObject({
    blockId: otherVersion.blocks[0]!.id,
    offset: 83.25,
  });
  h.app.dispose();
});
it('selecting a chapter with an unsaved new result offers recovery before its older saved version', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const old = h.app.getSnapshot().version!;
  h.setFailSave(true);
  await h.app.refreshSource();
  expect(h.posts()).toHaveLength(1);
  await h.app.translate();
  const pending = h.app.getSnapshot().translation.pendingSave!;
  expect(pending.versionId).not.toBe(old.versionId);
  h.app.showContents();

  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[1]!);

  expect(h.app.getSnapshot().route).toEqual({ kind: 'translation', chapterId: 'n1234ab/2' });
  expect(h.app.getSnapshot().translation.pendingSave).toEqual(pending);
  expect(await h.store.readVersion(old.versionId)).toEqual(old);
  h.setFailSave(false);
  await h.app.retrySave();
  expect(h.app.getSnapshot().version?.versionId).toBe(pending.versionId);
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(2);
  expect(h.posts()).toHaveLength(2);
  h.app.dispose();
});
it('another chapter exposes a route back to save recovery and blocks generation until saved', async () => {
  const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
  const { Application } = await import('../../src/app/Application');
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const pending = h.app.getSnapshot().translation.pendingSave!;
  h.app.showContents();
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  render(<Application controller={h.app} />);

  expect(screen.getByRole('button', { name: '이 화 번역하기' }).hasAttribute('disabled')).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  chooseShellMenu('서재로 가기');
  expect(h.app.getSnapshot().route.kind).toBe('home');
  fireEvent.click(screen.getByRole('button', { name: '저장 화면으로 가기' }));
  expect(h.app.getSnapshot().chapter?.chapterId).toBe(pending.source.chapterId);
  expect(h.app.getSnapshot().translation.pendingSave).toEqual(pending);
  h.setFailSave(false);
  fireEvent.click(screen.getByRole('button', { name: '저장 다시 하기' }));
  await expect.poll(() => h.app.getSnapshot().route.kind).toBe('reader');
  expect(await h.store.readVersion(pending.versionId)).toEqual(pending);
  expect(h.posts()).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '저장 화면으로 가기' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '목차' }));
  fireEvent.click(screen.getByRole('button', { name: '1화 1화' }));
  await expect.poll(() => h.app.getSnapshot().route.kind).toBe('translation');
  expect(screen.getByRole('button', { name: '이 화 번역하기' }).hasAttribute('disabled')).toBe(
    false,
  );
  expect(h.posts()).toHaveLength(1);
  cleanup();
  h.app.dispose();
});
it('credential storage and model headers never leak into source or preferences', async () => {
  const h = harness();
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://100.64.0.8:1234' });
  await h.app.checkConnection('synthetic-only-token');
  h.app.chooseModel('hymt2-7b');
  await h.app.openWork(workUrl);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[1]!);
  const first = h.app.translate();
  await dispatched(h);
  expect(h.posts()[0]!.headers.Authorization).toBe('Bearer synthetic-only-token');
  for (const request of h.requests.filter((r) => r.url.startsWith(workUrl)))
    expect(JSON.stringify(request.headers)).not.toContain('synthetic-only-token');
  expect(JSON.stringify(h.app.getSnapshot())).not.toContain('synthetic-only-token');
  h.settle();
  await first;
  expect(JSON.stringify([...h.bytes.values()])).not.toContain('synthetic-only-token');
  h.app.dispose();
});
it('saved settings restore without startup network or a guessed model', async () => {
  const h = harness();
  await prepare(h);
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.app.dispose();
  const restarted = createRenewalApplication(h.adapters);
  const count = h.requests.length;
  await restarted.initialize();
  expect(restarted.getSnapshot().selectedModelId).toBe('hymt2-7b');
  expect(restarted.getSnapshot().catalogStatus).toBe('idle');
  expect(h.requests).toHaveLength(count);
  await restarted.translate();
  expect(h.posts()).toHaveLength(0);
  restarted.dispose();
});
it('attempt journal write failure blocks generation', async () => {
  const h = harness();
  await prepare(h);
  h.adapters.files.write = async () => {
    throw new Error('storage unavailable');
  };
  await h.app.translate();
  expect(h.posts()).toHaveLength(0);
  expect(h.app.getSnapshot().translation.phase).toBe('unknown');
  h.app.dispose();
});
it('reader visual pixel anchor is independent of translated character length', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const version = h.app.getSnapshot().version!;
  await h.app.savePosition(version.blocks[0]!.id, 140.5);
  expect(h.app.getSnapshot().error).toBeNull();
  expect(await h.store.readPosition(version.versionId)).toMatchObject({ offset: 140.5 });
  h.app.dispose();
});
it('background during save retains the completed file without opening the reader', async () => {
  const h = harness();
  await prepare(h);
  h.holdSave();
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await expect.poll(() => h.app.getSnapshot().translation.phase).toBe('saving');
  h.lifecycle(false);
  h.lifecycle(true);
  h.releaseSave();
  await first;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(1);
  h.app.dispose();
});
it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
  'rejects unsafe reader offsets %s without persisting them',
  async (offset) => {
    const h = harness();
    await prepare(h);
    const first = h.app.translate();
    await dispatched(h);
    h.settle();
    await first;
    const version = h.app.getSnapshot().version!;
    await h.app.savePosition(version.blocks[0]!.id, offset);
    expect(await h.store.readPosition(version.versionId)).toBeNull();
    h.app.dispose();
  },
);
it('refreshing catalog while generation waits invalidates its visible settings ownership', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  await h.app.checkConnection();
  h.settle();
  await first;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.app.getSnapshot().version).toBeNull();
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('reports separate source/model/storage/reader timing without content or endpoint data', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  h.app.readerDisplayed(h.app.getSnapshot().version!.versionId);
  const timing = h.app.getSnapshot().translationTimings!;
  expect(Object.keys(timing).sort()).toEqual([
    'modelMs',
    'readerDisplayMs',
    'sourceMs',
    'validationStorageMs',
  ]);
  for (const value of Object.values(timing)) expect(value).toBeGreaterThanOrEqual(0);
  h.app.dispose();
});
it('a corrupt attempt journal blocks new generation but keeps saved reading discoverable', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const versionId = h.app.getSnapshot().version!.versionId;
  h.app.dispose();
  for (const path of h.bytes.keys()) if (path.startsWith('attempts/')) h.bytes.set(path, 'corrupt');
  const app = createRenewalApplication(h.adapters);
  await app.initialize();
  expect(app.getSnapshot().recent.some((entry) => entry.versionId === versionId)).toBe(true);
  await app.continueReading(versionId);
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId });
  await app.translate();
  expect(h.posts()).toHaveLength(1);
  app.dispose();
});
it('cancel during save-only retry does not reopen the reader or call the model', async () => {
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  h.setFailSave(false);
  h.holdSave();
  const retry = h.app.retrySave();
  await expect.poll(() => h.app.getSnapshot().translation.phase).toBe('saving');
  h.app.cancelTranslation();
  h.releaseSave();
  await retry;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('changed settings leave usable non-adopting terminal controls when returning to the waiting chapter', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.app.navigate({ kind: 'settings' });
  await h.app.checkConnection();
  h.app.back();
  h.settle();
  await first;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.app.getSnapshot().version).toBeNull();
  expect(['ready', 'failed', 'unknown']).toContain(h.app.getSnapshot().translation.phase);
  await h.app.openSavedTranslation();
  expect(h.app.getSnapshot().route.kind).toBe('reader');
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('completed translation immediately marks the matching TOC chapter saved', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  h.app.showContents();
  expect(h.app.getSnapshot().route.kind).toBe('work');
  expect(h.app.getSnapshot().savedChapterIds).toContain('n1234ab/2');
  h.app.dispose();
});
it('background during save-only retry leaves data durable without a reader transition', async () => {
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  h.setFailSave(false);
  h.holdSave();
  const retry = h.app.retrySave();
  await expect.poll(() => h.app.getSnapshot().translation.phase).toBe('saving');
  h.lifecycle(false);
  h.lifecycle(true);
  h.releaseSave();
  await retry;
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(1);
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('save-only retry updates the original chapter badge', async () => {
  const h = harness();
  await prepare(h);
  h.setFailSave(true);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  h.setFailSave(false);
  await h.app.retrySave();
  h.app.showContents();
  expect(h.app.getSnapshot().savedChapterIds).toContain('n1234ab/2');
  expect(h.posts()).toHaveLength(1);
  h.app.dispose();
});
it('late saved metadata never marks a different visible work', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  await h.app.openWork('https://ncode.syosetu.com/n4567cd/');
  h.settle();
  await first;
  expect(h.app.getSnapshot().work!.workId).toBe('n4567cd');
  expect(h.app.getSnapshot().savedChapterIds).toEqual([]);
  expect(h.app.getSnapshot().route).toMatchObject({ kind: 'work', workId: 'n4567cd' });
  h.app.dispose();
});
it('returning after a changed-settings request already settled restores its terminal controls', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.app.navigate({ kind: 'settings' });
  await h.app.checkConnection();
  h.settle();
  await first;
  h.app.back();
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(h.app.getSnapshot().translation.phase).toBe('ready');
  expect(h.app.getSnapshot().version).toBeNull();
  h.app.dispose();
});
it('retranslate chapter from a saved reader adds a new version and keeps the previous one (#197)', async () => {
  const h = harness();
  await prepare(h);
  const first = h.app.translate();
  await dispatched(h);
  h.settle();
  await first;
  const previous = h.app.getSnapshot().version!.versionId;
  await h.app.continueReading(previous);
  expect(h.app.getSnapshot().route).toEqual({ kind: 'reader', versionId: previous });
  const postCount = h.posts().length;

  await h.app.retranslateChapter();

  expect(h.posts()).toHaveLength(postCount + 1);
  expect(h.app.getSnapshot().version!.versionId).not.toBe(previous);
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(2);
  expect(await h.store.listVersions('n1234ab/2')).toEqual(
    expect.arrayContaining([expect.objectContaining({ versionId: previous })]),
  );
  h.app.dispose();
});
async function translateOnce(h: ReturnType<typeof harness>) {
  const done = h.app.translate();
  await dispatched(h);
  h.settle();
  await done;
  return h.app.getSnapshot().version!;
}
it('기기 판정을 켜도 판정할 이름이 없는 회차는 판정 기록을 남기지 않는다', async () => {
  embeddingPort.ready = true;
  try {
    // 이 하네스에는 작품 용어집이 없어 판정할 이름이 없다(judged 0). 기록이 남는 경로는 wholeChapterDecision 테스트가 본다.
    const on = harness();
    await prepare(on);
    await on.app.enableOnDeviceEmbedding();
    expect(on.app.getSnapshot().onDeviceEmbedding).toBe(true);
    const enabled = await translateOnce(on);
    expect(enabled.provenance).not.toHaveProperty('termDecision');
    on.app.dispose();

    const off = harness();
    await prepare(off);
    const disabled = await translateOnce(off);
    expect(disabled.provenance).not.toHaveProperty('termDecision');
    off.app.dispose();
  } finally {
    embeddingPort.ready = false;
  }
});

it('startup finishes failed chapter cleanup after its saved-chapter action disappeared', async () => {
  const h = harness();
  let fail = true;
  Object.assign(h.adapters.files, {
    async remove(path: string) {
      if (fail) throw new Error('temporary cleanup failure');
      h.bytes.delete(path);
    },
  });
  const base = await legacyCompleted();
  const identity = { ...base.identity, canonicalUrl: `${workUrl}1/` };
  const legacy = {
    ...base,
    identity,
    cacheKey: await createCacheKey(identity),
    source: {
      ...base.source,
      canonicalUrl: identity.canonicalUrl,
      workId: 'n1234ab',
      chapterId: 'n1234ab/1',
    },
  };
  await createReaderStore(h.adapters.files).commitChapter(legacy);
  await createLastChapterRepository(h.adapters.preferences).save(legacy.cacheKey);
  await h.app.initialize();
  await h.app.openWork(workUrl);
  const chapter = h.app
    .getSnapshot()
    .work!.chapters.find((ref) => ref.chapterId === legacy.source.chapterId)!;
  const old = (await h.store.listVersions(chapter.chapterId))[0]!;
  expect(h.app.getSnapshot().savedChapterIds).toContain(chapter.chapterId);
  expect(await h.app.removeChapterVersions(chapter)).toMatchObject({
    removed: true,
    cleanupComplete: false,
  });
  expect(h.app.getSnapshot().savedChapterIds).not.toContain(chapter.chapterId);
  h.app.dispose();
  fail = false;
  const restarted = createRenewalApplication(h.adapters);
  await restarted.initialize();
  expect(h.bytes.has(`versions/${old.versionId}.0.json`)).toBe(false);
  expect(await h.store.readChapterRemovalInventory!()).toEqual([]);
  expect(await h.store.listVersions(chapter.chapterId)).toEqual([]);
  expect(h.posts()).toEqual([]);
  restarted.dispose();
  const later = createRenewalApplication(h.adapters);
  await later.initialize();
  expect(await h.store.listVersions(chapter.chapterId)).toEqual([]);
  expect(h.posts()).toEqual([]);
  later.dispose();
});
