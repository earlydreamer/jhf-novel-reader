// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { createRenewalApplication } from '../../src/app/compose';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';
import { createLastChapterRepository } from '../../src/app/lastChapter';
import { createReaderStore } from '../../src/storage/store';
import { createAttemptRepository } from '../../src/translation/attempts';
import type { NativeHttpRequest, HttpResponse, AppLifecycle } from '../../src/contracts';
import { createCacheKey, type CompletedChapter } from '../../src/contracts/legacy';

const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const chapterUrl = workUrl + '2/';
const toc = `<h1 class="p-novel__title">合成作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">第一話</a></div><div class="p-eplist__sublist"><a href="/n1234ab/2/">第二話</a></div>`;
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
  const bytes = new Map<string, string>(),
    preferences = new Map<string, string>(),
    secrets = new Map<string, string>();
  let chapterHtml = html;
  const requests: NativeHttpRequest[] = [];
  let failSave = false,
    holdSave = false;
  const saveGate = deferred<void>();
  const response = deferred<HttpResponse>();
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
      url: posts()[0]!.url,
      headers: {},
      data: JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '처음\r\n\r\n\r\n\r\n끝' } }],
      }),
    });
  return {
    app,
    adapters,
    bytes,
    requests,
    posts,
    settle,
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
  await h.app.browse();
  expect(h.app.getSnapshot().route).toMatchObject({ kind: 'work', selectedChapterId: 'n1234ab/2' });
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[1]!);
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://100.64.0.8:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('hymt2-7b');
}
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
async function dispatched(h: ReturnType<typeof harness>) {
  await expect.poll(() => h.posts().length).toBe(1);
}
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
  expect(body).not.toHaveProperty('max_tokens');
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
it('reopening detects a changed source without generation and refresh creates a new version', async () => {
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
  const next = h.app.getSnapshot().version!.versionId;
  expect(next).not.toBe(previous);
  expect(h.posts()).toHaveLength(postCount + 1);
  expect(await h.store.listVersions('n1234ab/2')).toHaveLength(2);
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
  const browse = screen.getByRole('button', { name: '나로우에서 작품 찾기' });
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

  expect(screen.getByRole('button', { name: '이 화 번역' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: '저장 대기 중인 번역으로 돌아가기' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '홈' }));
  expect(h.app.getSnapshot().route.kind).toBe('home');
  fireEvent.click(screen.getByRole('button', { name: '저장 대기 중인 번역으로 돌아가기' }));
  expect(h.app.getSnapshot().chapter?.chapterId).toBe(pending.source.chapterId);
  expect(h.app.getSnapshot().translation.pendingSave).toEqual(pending);
  h.setFailSave(false);
  fireEvent.click(screen.getByRole('button', { name: '모델 요청 없이 저장 다시 시도' }));
  await expect.poll(() => h.app.getSnapshot().route.kind).toBe('reader');
  expect(await h.store.readVersion(pending.versionId)).toEqual(pending);
  expect(h.posts()).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '저장 대기 중인 번역으로 돌아가기' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '목차' }));
  fireEvent.click(screen.getByRole('button', { name: '第一話' }));
  await expect.poll(() => h.app.getSnapshot().route.kind).toBe('translation');
  expect(screen.getByRole('button', { name: '이 화 번역' }).hasAttribute('disabled')).toBe(false);
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
