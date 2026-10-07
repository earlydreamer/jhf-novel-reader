// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import { createRenewalApplication } from '../../src/app/compose';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';
import type { NativeHttpRequest } from '../../src/contracts';
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
function harness(fault = false) {
  const bytes = new Map<string, string>(),
    preferences = new Map<string, string>();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const requests: NativeHttpRequest[] = [];
  let failSave = false;
  const client = {
    request: async (options: NativeHttpRequest) => {
      requests.push(options);
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
      onData(delta('<main><p id="A">빠르게 읽는 문단</p><p id="B">뒤를 이어'));
      await gate;
      const data =
        delta(
          '<main><p id="A">빠르게 읽는 문단</p><p id="B">' +
            (fault ? 'まだ日本語' : '뒤를 이어 읽는 문단') +
            '</p></main>',
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
    release: () => release(),
    requests,
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
  fireEvent.click(screen.getByRole('button', { name: '이 화 번역' }));
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
  expect(screen.getByRole('article', { name: '번역 미리보기' })).toBe(preview);
  expect(preview.scrollTop).toBe(325);
  const saved = h.app.getSnapshot().version!;
  expect(saved.provenance.generation?.mode).toBe('colomo-local-v1');
  await waitFor(async () =>
    expect(await createLibraryStore(h.adapters.files).readPosition(saved.versionId)).toMatchObject({
      blockId: saved.blocks[2]!.id,
      offset: 25,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '저장본으로 읽기' }));
  await screen.findByRole('article', { name: '번역 본문' });
  expect(screen.getByText('뒤를 이어 읽는 문단')).toBeVisible();
  expect(h.app.getSnapshot().position).toMatchObject({ blockId: saved.blocks[2]!.id, offset: 25 });
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
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
  expect(screen.getByRole('article', { name: '번역 미리보기' })).toBe(article);
  expect(h.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  h.app.dispose();
});
