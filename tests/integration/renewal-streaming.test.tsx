// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalApplication } from '../../src/app/compose';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';
import { ReaderError, type NativeHttpRequest } from '../../src/contracts';
const url = 'https://ncode.syosetu.com/n1234ab/';
const toc =
  '<h1 class="p-novel__title">합성 작품</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">1화</a></div>';
const html =
  '<h1 class="p-novel__title">1화</h1><div class="p-novel__body"><div class="p-novel__text"><p>夏の朝。</p><p></p><p>扉を開けた。</p></div></div>';
const delta = (text: string) =>
  'data: ' +
  JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) +
  '\n\n';
const ending =
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
function harness(fault = false, automatic = false) {
  const bytes = new Map<string, string>(),
    preferences = new Map<string, string>();
  preferences.set(
    'narou-reader.reading-settings.v2',
    JSON.stringify({
      schemaVersion: 2,
      selection: null,
      fontSize: 18,
      autoTranslate: automatic,
    }),
  );
  let releaseStream!: () => void;
  let streamGate: Promise<void>;
  const holdNextStream = () => {
    streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
  };
  holdNextStream();
  let streamCalls = 0;
  const requests: NativeHttpRequest[] = [];
  let failSave = false;
  let failNextChapter = false;
  let broken = fault,
    unknown = false;
  const client = {
    request: async (options: NativeHttpRequest) => {
      requests.push(options);
      if (failNextChapter && options.url !== url && !options.url.endsWith('/models')) {
        failNextChapter = false;
        throw new ReaderError('source_access');
      }
      return {
        status: 200,
        url: options.url,
        headers: { 'Content-Type': 'text/html' },
        data: options.url.endsWith('/models')
          ? JSON.stringify({ data: [{ id: 'gemma-4-E4B', meta: { n_ctx: 16384 } }] })
          : options.url === url
            ? toc
            : html,
      };
    },
  };
  const streaming = {
    requestStream: async (
      options: NativeHttpRequest,
      _signal: AbortSignal,
      onData: (text: string) => void,
    ) => {
      requests.push(options);
      if (unknown) throw new ReaderError('timeout_unknown', 'unknown');
      const input = (options.data!.messages as { content: string }[]).at(-1)!.content;
      const streamIndex = streamCalls++;
      if (streamIndex === 0) {
        onData(delta('<main><p id="A">빠르게 읽는 문단</p><p id="B">뒤를 이어'));
      } else {
        const paragraphId = [...input.matchAll(/<p id="([A-Za-z]+)">([^]*?)<\/p>/g)]
          .map((match) => match[1])
          .at(-1);
        onData(delta(`<main><p id="${paragraphId ?? 'C'}">재번역 중인 합성 미리보기`));
      }
      await streamGate;
      const lines = [...input.matchAll(/<p id="([A-Za-z]+)">([^]*?)<\/p>/g)];
      const data =
        delta(
          '<main>' +
            lines
              .map(
                (m) =>
                  `<p id="${m[1]}">${
                    m[2]!.includes('夏')
                      ? '빠르게 읽는 문단'
                      : broken
                        ? 'まだ日本語'
                        : '뒤를 이어 읽는 문단'
                  }</p>`,
              )
              .join('') +
            '</main>',
        ) + ending;
      return { status: 200, url: options.url, headers: {}, data };
    },
  };
  const adapters = {
    sourceTransport: createSourceTransport(client),
    modelTransport: createModelTransport(client, streaming),
    files: {
      read: async (path: string) => bytes.get(path) ?? null,
      write: async (path: string, value: string) => {
        if (failSave && path.startsWith('versions/')) throw new Error('synthetic storage failure');
        bytes.set(path, value);
      },
    },
    preferences: {
      get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        preferences.set(key, value);
      },
    },
    secrets: { get: async () => null, set: async () => {}, remove: async () => {} },
    lifecycle: { isActive: async () => true, subscribe: async () => async () => {} },
  };
  return {
    adapters,
    app: createRenewalApplication(adapters),
    release: () => releaseStream(),
    holdNextStream,
    requests,
    setBroken: (value: boolean) => {
      broken = value;
    },
    failNextChapter: () => {
      failNextChapter = true;
    },
    setUnknown: (value: boolean) => {
      unknown = value;
    },
    failSave: (value: boolean) => {
      failSave = value;
    },
  };
}
afterEach(cleanup);
test('live reader updates before model settlement, keeps position on save and opens the same saved text', async () => {
  const h = harness();
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('gemma-4-E4B');
  expect(h.app.getSnapshot().translationMode).toBe('stream');
  await h.app.openWork(url);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  render(<Application controller={h.app} />);
  fireEvent.click(screen.getByRole('button', { name: '이 화 번역하기' }));
  const preview = await screen.findByRole('article', { name: '번역 미리보기' });
  await screen.findByText('빠르게 읽는 문단');
  expect(h.app.getSnapshot().translation.phase).toBe('translating');
  expect(await createLibraryStore(h.adapters.files).listVersions('n1234ab/1')).toHaveLength(0);
  const last = preview.querySelector<HTMLElement>('[data-preview-index="2"]')!;
  Object.defineProperty(last, 'offsetTop', { value: 300 });
  preview.scrollTop = 325;
  fireEvent.scroll(preview);
  h.app.changeTranslationMode('legacy');
  expect(h.app.getSnapshot().translationMode).toBe('stream');
  h.release();
  await waitFor(() => expect(h.app.getSnapshot().translation.phase).toBe('ready'));
  await waitFor(() => expect(h.app.getSnapshot().version).not.toBeNull());
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(screen.getByRole('article', { name: '번역 본문' })).toBe(preview);
  expect(preview.scrollTop).toBe(325);
  const saved = h.app.getSnapshot().version!;
  expect(saved.provenance.generation?.mode).toBe('colomo-local-v1');
  await waitFor(async () =>
    expect(await createLibraryStore(h.adapters.files).readPosition(saved.versionId)).toMatchObject({
      blockId: saved.blocks[2]!.id,
      offset: 25,
    }),
  );
  expect(screen.queryByRole('button', { name: '저장본으로 읽기' })).not.toBeInTheDocument();
  await screen.findByRole('article', { name: '번역 본문' });
  expect(screen.getByText('뒤를 이어 읽는 문단')).toBeVisible();
  expect(h.app.getSnapshot().position).toMatchObject({ blockId: saved.blocks[2]!.id, offset: 25 });
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});

test('source-access retry refetches the chapter and sends no model request before the explicit action', async () => {
  const h = harness();
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('gemma-4-E4B');
  await h.app.openWork(url);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  render(<Application controller={h.app} />);
  const chapterFetchesBeforeTranslation = h.requests.filter(
    (request) => request.method === 'GET' && request.url !== url,
  ).length;
  h.failNextChapter();

  fireEvent.click(screen.getByRole('button', { name: '이 화 번역하기' }));
  await waitFor(() =>
    expect(h.app.getSnapshot().translation).toMatchObject({
      phase: 'failed',
      error: { code: 'source_access' },
    }),
  );
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  expect(
    h.requests.filter((request) => request.method === 'GET' && request.url !== url),
  ).toHaveLength(chapterFetchesBeforeTranslation + 1);

  fireEvent.click(screen.getByRole('button', { name: '원문 다시 확인하고 번역하기' }));
  await screen.findByText('빠르게 읽는 문단');
  expect(
    h.requests.filter((request) => request.method === 'GET' && request.url !== url),
  ).toHaveLength(chapterFetchesBeforeTranslation + 2);
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  h.release();
  await waitFor(() => expect(h.app.getSnapshot().translation.phase).toBe('ready'));
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});

test('first-translation pending save keeps its owned body and retrying storage adds no model request', async () => {
  const h = harness();
  await prepareStreaming(h);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  render(<Application controller={h.app} />);
  h.failSave(true);

  fireEvent.click(screen.getByRole('button', { name: '이 화 번역하기' }));
  await screen.findByText('빠르게 읽는 문단');
  h.release();
  await waitFor(() =>
    expect(h.app.getSnapshot().translation).toMatchObject({
      phase: 'failed',
      pendingSave: { source: { chapterId: 'n1234ab/1' } },
    }),
  );
  const pendingSave = h.app.getSnapshot().translation.pendingSave!;
  expect(h.app.getSnapshot().version).toBeNull();
  const article = screen.getByRole('article', { name: '번역 미리보기' });
  await waitFor(() => {
    const rows = article.querySelectorAll<HTMLElement>('[data-reader-index]');
    expect(rows).toHaveLength(pendingSave.blocks.length);
    pendingSave.blocks.forEach((block, index) => expect(rows[index]).toHaveTextContent(block.text));
  });
  const modelPosts = h.requests.filter((request) => request.method === 'POST').length;
  expect(modelPosts).toBe(1);

  h.failSave(false);
  fireEvent.click(screen.getByRole('button', { name: '저장 다시 하기' }));
  await waitFor(() => expect(h.app.getSnapshot().version?.versionId).toBe(pendingSave.versionId));
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(modelPosts);
  h.app.dispose();
});

test('paragraph repair keeps the owned live preview on the same article and adopts the saved position', async () => {
  const h = harness(true);
  await prepareStreaming(h);
  const chapter = h.app.getSnapshot().work!.chapters[0]!;
  await h.app.selectChapter(chapter);
  const initial = h.app.translate();
  await waitFor(() => expect(h.app.getSnapshot().translation.phase).toBe('translating'));
  h.release();
  await initial;
  const base = h.app.getSnapshot().version!;
  expect(base.failedParagraphs).toEqual([2]);
  await h.app.savePosition(base.blocks[0]!.id, 17);
  render(<Application controller={h.app} />);
  const article = screen.getByRole('article', { name: '번역 본문' });
  expect(article).toHaveTextContent(base.blocks[2]!.text);

  h.setBroken(false);
  h.holdNextStream();
  const postsBeforeRepair = h.requests.filter((request) => request.method === 'POST').length;
  fireEvent.click(screen.getByRole('button', { name: '실패한 문단 다시 번역하기' }));
  await waitFor(() => {
    expect(h.app.getSnapshot()).toMatchObject({
      paragraphRepair: true,
      translationActive: true,
      translation: { phase: 'translating' },
    });
    expect(h.app.getSnapshot().translation.preview).toContain('재번역 중인 합성 미리보기');
  });
  expect(h.app.getSnapshot().version?.versionId).toBe(base.versionId);
  expect(screen.getByRole('article', { name: '번역 본문' })).toBe(article);
  expect(article).toHaveTextContent('재번역 중인 합성 미리보기');
  expect(article).not.toHaveTextContent(base.blocks[2]!.text);
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(
    postsBeforeRepair + 1,
  );

  h.failSave(true);
  h.release();
  await waitFor(() =>
    expect(h.app.getSnapshot()).toMatchObject({
      paragraphRepair: true,
      translationActive: false,
      translation: { phase: 'failed', pendingSave: { source: { chapterId: chapter.chapterId } } },
    }),
  );
  const pendingSave = h.app.getSnapshot().translation.pendingSave!;
  expect(pendingSave.source.workId).toBe(chapter.workId);
  expect(pendingSave.source.chapterId).toBe(chapter.chapterId);
  expect(pendingSave.provenance.repair?.baseVersionId).toBe(base.versionId);
  expect(h.app.getSnapshot().route).toMatchObject({
    kind: 'translation',
    chapterId: chapter.chapterId,
  });
  expect(h.app.getSnapshot().translation.token?.chapterId).toBe(chapter.chapterId);
  expect(h.app.getSnapshot().version?.versionId).toBe(base.versionId);
  await waitFor(() => {
    const rows = article.querySelectorAll<HTMLElement>('[data-reader-index]');
    expect(rows).toHaveLength(pendingSave.blocks.length);
    pendingSave.blocks.forEach((block, index) => expect(rows[index]).toHaveTextContent(block.text));
  });
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(
    postsBeforeRepair + 1,
  );

  h.failSave(false);
  fireEvent.click(screen.getByRole('button', { name: '저장 다시 하기' }));
  await waitFor(() => expect(h.app.getSnapshot().version?.versionId).not.toBe(base.versionId));
  const repaired = h.app.getSnapshot().version!;
  expect(repaired.provenance.repair?.paragraphIndexes).toEqual([2]);
  expect(h.app.getSnapshot().position).toMatchObject({
    versionId: repaired.versionId,
    blockId: repaired.blocks[0]!.id,
    offset: 17,
  });
  expect(screen.getByRole('article', { name: '번역 본문' })).toBe(article);
  expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(
    postsBeforeRepair + 1,
  );
  h.app.dispose();
});

async function prepareStreaming(h: ReturnType<typeof harness>) {
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('gemma-4-E4B');
  await h.app.openWork(url);
}
test('automatic start is opt-out, dispatches once and leaves completed reading immediately usable', async () => {
  const h = harness(false, true);
  await prepareStreaming(h);
  const chapter = h.app.getSnapshot().work!.chapters[0]!;
  await h.app.selectChapter(chapter);
  await vi.waitFor(() => expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1));
  await h.app.translate();
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  render(<Application controller={h.app} />);
  const article = screen.getByRole('article', { name: '번역 미리보기' });
  h.release();
  await waitFor(() => expect(h.app.getSnapshot().version).not.toBeNull());
  expect(screen.getByRole('article', { name: '번역 본문' })).toBe(article);
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  expect(screen.getByRole('button', { name: /^목차$/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '저장본으로 읽기' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '원문 보기' }));
  expect(screen.getByRole('article', { name: '원문 본문' })).toHaveTextContent('夏の朝');
  fireEvent.click(screen.getByRole('button', { name: '번역 보기' }));
  fireEvent.click(screen.getByRole('button', { name: /^목차$/ }));
  await h.app.selectChapter(chapter);
  expect(h.app.getSnapshot().route.kind).toBe('reader');
  expect(document.querySelector('.nr-immersive-appbar')).toHaveAttribute('inert');
  expect(document.querySelector('.nr-toolbar')).toHaveAttribute('inert');
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});
test('both options survive restart, and automatic start off keeps a manual start available', async () => {
  const h = harness(false, true);
  await prepareStreaming(h);
  h.app.navigate({ kind: 'settings' });
  render(<Application controller={h.app} />);
  fireEvent.click(screen.getByRole('checkbox', { name: /저장본이 없으면 자동 번역 시작/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /실패 문단 자동 재시도/ }));
  await vi.waitFor(async () => {
    const restored = createRenewalApplication(h.adapters);
    await restored.initialize();
    expect(restored.getSnapshot()).toMatchObject({ autoTranslate: false, autoRetryFailed: false });
    expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
    restored.dispose();
  });
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  expect(h.app.getSnapshot().translation.phase).toBe('idle');
  fireEvent.click(screen.getByRole('button', { name: '이 화 번역하기' }));
  h.release();
  await waitFor(() => expect(h.app.getSnapshot().version).not.toBeNull());
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});
test('manual paragraph repair sends only the requested source and preserves the original saved version', async () => {
  const h = harness(true);
  await prepareStreaming(h);
  h.app.changeAutoRetryFailed(false);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  h.release();
  await h.app.translate();
  const original = structuredClone(h.app.getSnapshot().version!);
  expect(original.failedParagraphs).toEqual([2]);
  h.setBroken(false);
  h.app.changeTranslationMode('legacy');
  await h.app.retryParagraphs([2]);
  expect(h.app.getSnapshot().translationMode).toBe('legacy');
  const repaired = h.app.getSnapshot().version!;
  expect(repaired.failedParagraphs).toBeUndefined();
  expect(repaired.blocks[0]!.text).toBe(original.blocks[0]!.text);
  expect(repaired.blocks[1]!.text).toBe('');
  expect(repaired.blocks[2]!.text).toBe('뒤를 이어 읽는 문단');
  expect(repaired.provenance.repair).toEqual({
    baseVersionId: original.versionId,
    paragraphIndexes: [2],
  });
  const body = (
    h.requests.filter((r) => r.method === 'POST').at(-1)!.data!.messages as { content: string }[]
  ).at(-1)!.content;
  expect(body).toContain('扉を開けた');
  expect(body).not.toContain('夏の朝');
  const store = createLibraryStore(h.adapters.files);
  expect(await store.readVersion(original.versionId)).toEqual(original);
  expect((await store.readVersion(repaired.versionId))?.provenance.repair).toEqual(
    repaired.provenance.repair,
  );
  expect(await store.listVersions(original.source.chapterId)).toHaveLength(2);
  h.app.dispose();
});
test('repair with an unknown network outcome keeps the saved version and does not replay automatically', async () => {
  const h = harness(false, true);
  await prepareStreaming(h);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  h.release();
  await vi.waitFor(() => expect(h.app.getSnapshot().version).not.toBeNull());
  const original = h.app.getSnapshot().version!;
  h.setUnknown(true);
  await h.app.retryParagraphs([2]);
  expect(h.app.getSnapshot().translation.phase).toBe('unknown');
  const count = h.requests.filter((r) => r.method === 'POST').length;
  h.app.showContents();
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  expect(h.app.getSnapshot().version?.versionId).toBe(original.versionId);
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(count);
  expect(
    await createLibraryStore(h.adapters.files).listVersions(original.source.chapterId),
  ).toHaveLength(1);
  h.app.dispose();
});
test('automatic start does not repeat an unfinished chapter request when reselected', async () => {
  const h = harness(false, true);
  await prepareStreaming(h);
  h.setUnknown(true);
  const chapter = h.app.getSnapshot().work!.chapters[0]!;
  await h.app.selectChapter(chapter);
  await vi.waitFor(() => expect(h.app.getSnapshot().translation.phase).toBe('unknown'));
  h.app.showContents();
  await h.app.selectChapter(chapter);
  expect(h.app.getSnapshot().translation.phase).toBe('unknown');
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});
test('explicit retry after an unknown paragraph repair retains the requested paragraph scope', async () => {
  const h = harness();
  await prepareStreaming(h);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  h.release();
  await h.app.translate();
  const original = h.app.getSnapshot().version!;
  h.setUnknown(true);
  await h.app.retryParagraphs([2]);
  expect(h.app.getSnapshot().translation.phase).toBe('unknown');
  h.setUnknown(false);
  await h.app.retryTranslation();
  const latest = h.app.getSnapshot().version!;
  expect(latest.provenance.repair).toEqual({
    baseVersionId: original.versionId,
    paragraphIndexes: [2],
  });
  const input = (
    h.requests.filter((r) => r.method === 'POST').at(-1)!.data!.messages as { content: string }[]
  ).at(-1)!.content;
  expect(input).toContain('扉を開けた');
  expect(input).not.toContain('夏の朝');
  expect(latest.blocks[0]!.text).toBe(original.blocks[0]!.text);
  h.app.dispose();
});
test('legacy mode is selectable and survives restart without changing stored versions', async () => {
  const h = harness();
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('gemma-4-E4B');
  h.app.navigate({ kind: 'settings' });
  render(<Application controller={h.app} />);
  fireEvent.change(screen.getByLabelText('로컬 번역 방식'), { target: { value: 'legacy' } });
  expect(h.app.getSnapshot().translationMode).toBe('legacy');
  await vi.waitFor(async () => {
    const restored = createRenewalApplication(h.adapters);
    await restored.initialize();
    expect(restored.getSnapshot().translationMode).toBe('legacy');
    restored.dispose();
  });
  h.app.dispose();
});
test('unresolved validation rows are stored as marked source with durable failure metadata', async () => {
  const h = harness(true);
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('gemma-4-E4B');
  await h.app.openWork(url);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  h.release();
  await h.app.translate();
  const value = h.app.getSnapshot().version!;
  expect(value.failedParagraphs).toEqual([2]);
  expect(value.quality?.japaneseBlocks).toEqual([2]);
  expect(value.text).toContain('[번역 실패 · 원문]');
  expect(
    (await createLibraryStore(h.adapters.files).readVersion(value.versionId))?.failedParagraphs,
  ).toEqual([2]);
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(2);
  h.app.dispose();
});
test('storage-only retry keeps the live article and never invokes the model again', async () => {
  const h = harness();
  await h.app.initialize();
  h.app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await h.app.checkConnection();
  h.app.chooseModel('gemma-4-E4B');
  await h.app.openWork(url);
  await h.app.selectChapter(h.app.getSnapshot().work!.chapters[0]!);
  render(<Application controller={h.app} />);
  const article = screen.getByRole('article', { name: '번역 미리보기' });
  h.failSave(true);
  h.release();
  await h.app.translate();
  expect(h.app.getSnapshot().translation.pendingSave).toBeTruthy();
  h.failSave(false);
  await h.app.retrySave();
  expect(h.app.getSnapshot().translation.phase).toBe('ready');
  expect(h.app.getSnapshot().route.kind).toBe('translation');
  expect(screen.getByRole('article', { name: '번역 본문' })).toBe(article);
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});
