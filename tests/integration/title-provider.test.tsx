// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { FilesystemPlugin } from '@capacitor/filesystem';
import { createRenewalApplication } from '../../src/app/compose';
import { Application } from '../../src/app/Application';
import { ReaderError, type ModelRequest, type SelectedModel } from '../../src/contracts';
import { createProviderSession } from '../../src/providers/plainText';
import { createGuidanceRepository } from '../../src/translation/guidance';
import { createTitleTranslation, createTitleRepository } from '../../src/translation/titles';
import { DEFAULT_LOCAL_LIMITS } from '../../src/translation/segments';
import { createNativePrivateFiles } from '../../src/storage/native';

const url = 'https://ncode.syosetu.com/n1234ab/';
const toc =
  '<h1 class="p-novel__title">夏の物語</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">夏の朝</a></div>';
const body =
  '<h1 class="p-novel__title">夏の朝</h1><div class="p-novel__body"><div class="p-novel__text"><p>扉を開けた。</p></div></div>';
function sse(text: string) {
  return (
    'data: ' +
    JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] }) +
    '\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
  );
}
function harness(automatic = true) {
  const bytes = new Map<string, string>();
  const backend: Pick<FilesystemPlugin, 'readFile' | 'writeFile' | 'readdir'> = {
    async readFile({ path }) {
      const data = bytes.get(path);
      if (data === undefined) throw { code: 'OS-PLUG-FILE-0008' };
      return { data };
    },
    async writeFile({ path, data }) {
      if (typeof data !== 'string') throw new Error('Expected UTF-8 private data');
      bytes.set(path, data);
      return { uri: 'private' };
    },
    async readdir() {
      return { files: [] };
    },
  };
  const files = createNativePrivateFiles(backend, () => 'android');
  let bad = false;
  const requests: ModelRequest[] = [];
  const streamPost = vi.fn(
    async (request: ModelRequest, _signal: AbortSignal, onData: (data: string) => void) => {
      requests.push(request);
      const content = (request.body.messages as { content: string }[]).at(-1)!.content;
      const rows = [...content.matchAll(/<p id="([A-Za-z]+)">([^]*?)<\/p>/g)];
      const text =
        '<main>' +
        rows
          .map(
            (row) =>
              `<p id="${row[1]}">${bad ? 'まだ日本語' : row[2]!.includes('__ENT_') ? '앨리스의 아침 ' + row[2]!.match(/__ENT_[0-9]+__/)![0] : row[2] === '夏の物語' ? '여름 이야기' : row[2] === '夏の朝' ? '여름 아침' : '문을 열었다.'}</p>`,
          )
          .join('') +
        '</main>';
      const data = sse(text);
      onData(data);
      return { status: 200, headers: {}, url: request.url, data };
    },
  );
  const adapters = {
    files,
    sourceTransport: {
      get: async (target: string) => ({
        status: 200,
        headers: { 'Content-Type': 'text/html' },
        url: target,
        data: target === url ? toc : body,
      }),
    },
    modelTransport: {
      get: async () => ({
        status: 200,
        headers: {},
        url: 'http://localhost:1234/v1/models',
        data: { data: [{ id: 'test-model', meta: { n_ctx: 8192 } }] },
      }),
      post: vi.fn(),
      streamPost,
    },
    secrets: { get: async () => null, set: async () => {}, remove: async () => {} },
    lifecycle: { isActive: async () => true, subscribe: async () => async () => {} },
    preferences: {
      get: async ({ key }: { key: string }) => ({
        value:
          key === 'narou-reader.reading-settings.v2'
            ? JSON.stringify({
                schemaVersion: 2,
                fontSize: 18,
                selection: null,
                autoTranslate: automatic,
              })
            : null,
      }),
      set: async () => {},
    },
  };
  return {
    adapters,
    requests,
    files,
    streamPost,
    setBad(value: boolean) {
      bad = value;
    },
  };
}
afterEach(cleanup);
test('real compose translates titles, reads the same chapter heading, edits it and returns the edit to the TOC', async () => {
  const h = harness();
  const app = createRenewalApplication(h.adapters);
  await app.initialize();
  app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await app.checkConnection();
  app.chooseModel('test-model');
  await app.openWork(url);
  render(<Application controller={app} />);
  await screen.findByRole('heading', { name: '여름 이야기' });
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(h.requests).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '여름 아침' }));
  await screen.findByRole('article', { name: '번역 본문' });
  await waitFor(() => expect(app.getSnapshot().titlesBusy).toBe(false));
  expect(h.requests).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '회차 제목 수정' }));
  fireEvent.change(screen.getByLabelText('회차 제목 번역문'), { target: { value: '수정한 아침' } });
  fireEvent.click(screen.getByRole('button', { name: '제목 저장' }));
  await screen.findByRole('heading', { name: '수정한 아침' });
  fireEvent.click(screen.getByRole('button', { name: '원문 확인' }));
  await screen.findByRole('heading', { name: '夏の朝' });
  fireEvent.click(screen.getByRole('button', { name: '목차' }));
  await screen.findByRole('button', { name: '수정한 아침' });
  expect(h.requests).toHaveLength(2);
  expect(
    (await createTitleRepository(h.files).read('n1234ab')).find(
      (title) => title.key === 'n1234ab/1',
    )!.origin,
  ).toBe('user');
  app.dispose();
});
test('manual body translation with automatic off also fills only the work and current chapter title', async () => {
  const h = harness(false);
  const app = createRenewalApplication(h.adapters);
  await app.initialize();
  app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:1234' });
  await app.checkConnection();
  app.chooseModel('test-model');
  await app.openWork(url);
  expect(h.requests).toHaveLength(0);
  await app.selectChapter(app.getSnapshot().work!.chapters[0]!);
  await app.translate();
  await waitFor(() => expect(app.getSnapshot().titles).toHaveLength(2));
  expect(h.requests).toHaveLength(2);
  app.dispose();
});
test('locked names are masked/restored in title translation and Japanese residuals are rejected', async () => {
  const h = harness();
  const guidance = createGuidanceRepository(h.files);
  await guidance.save('n1234ab', {
    terms: [{ source: 'アリス', target: '앨리스', aliases: [], category: '인명', note: '' }],
    voices: [],
  });
  const translate = createTitleTranslation(
    (selection) => createProviderSession(selection, h.adapters.modelTransport, h.adapters.secrets),
    guidance,
    true,
  );
  const selection: SelectedModel = {
    connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 1 },
    modelId: 'test-model',
    limits: DEFAULT_LOCAL_LIMITS,
    autoRetryFailed: false,
  };
  expect(
    await translate(
      selection,
      'n1234ab',
      [{ key: 'n1234ab/1', source: 'アリスの朝' }],
      new AbortController().signal,
    ),
  ).toEqual(['앨리스의 아침 앨리스']);
  const messages = JSON.stringify(h.requests[0]!.body.messages);
  expect(messages).toContain('__ENT_0__の朝');
  h.setBad(true);
  expect(
    await translate(
      selection,
      'n1234ab',
      [{ key: 'n1234ab/1', source: '夏の朝' }],
      new AbortController().signal,
    ),
  ).toEqual([null]);
});
test('unknown title transport outcomes are propagated without a native replay', async () => {
  const h = harness();
  h.streamPost.mockRejectedValueOnce(new ReaderError('timeout_unknown', 'unknown'));
  const translate = createTitleTranslation(
    (selection) => createProviderSession(selection, h.adapters.modelTransport, h.adapters.secrets),
    createGuidanceRepository(h.files),
    true,
  );
  await expect(
    translate(
      {
        connection: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:1234',
          revision: 1,
        },
        modelId: 'test-model',
        limits: DEFAULT_LOCAL_LIMITS,
      },
      'n1234ab',
      [{ key: 'n1234ab', source: '夏の物語' }],
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: 'timeout_unknown' });
  expect(h.streamPost).toHaveBeenCalledTimes(1);
});
