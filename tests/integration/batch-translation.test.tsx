// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { createRenewalApplication } from '../../src/app/compose';
import { Application } from '../../src/app/Application';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';
import { createBatchRepository } from '../../src/translation/batch';
import type { NativeHttpRequest } from '../../src/contracts';
import { createGuidanceRepository, guidanceContext } from '../../src/translation/guidance';

afterEach(cleanup);
const workUrl = 'https://ncode.syosetu.com/n1234ab/';
function fixture() {
  const bytes = new Map<string, string>();
  const preferences = new Map<string, string>();
  const requests: NativeHttpRequest[] = [];
  let failSave = false;
  let failSecond = false;
  let holdFirst = false;
  let badPage = false;
  let failQueueAdvance = false;
  let active = 0;
  let maximumActive = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const files = {
    read: async (path: string) => bytes.get(path) ?? null,
    write: async (path: string, value: string) => {
      if (failQueueAdvance && path.startsWith('batches/') && JSON.parse(value).payload.cursor > 0)
        throw Error('synthetic queue write rejection');
      if (failSave && path.startsWith('versions/')) throw Error('synthetic disk rejection');
      bytes.set(path, value);
    },
  };
  const client = {
    request: async (request: NativeHttpRequest) => {
      requests.push(request);
      let data: string;
      if (request.method === 'POST') {
        active++;
        maximumActive = Math.max(maximumActive, active);
        if (holdFirst && requests.filter((value) => value.method === 'POST').length === 1)
          await gate;
        const ordinal = Number(JSON.stringify(request.data).match(/合成(\d+)/)?.[1]);
        active--;
        data = JSON.stringify({
          choices: [
            {
              finish_reason: failSecond && ordinal === 2 ? 'length' : 'stop',
              message: { content: `번역 ${ordinal}` },
            },
          ],
        });
      } else if (request.url.endsWith('/models')) {
        data = JSON.stringify({ data: [{ id: 'synthetic-model', meta: { n_ctx: 8192 } }] });
      } else if (request.url === workUrl || request.url === workUrl + '?p=2') {
        const ordinals = request.url === workUrl ? [1, 2] : [3, 4];
        if (badPage && request.url.endsWith('?p=2')) ordinals.splice(0, 1);
        data =
          '<h1 class="p-novel__title">합성 작품</h1>' +
          ordinals
            .map(
              (ordinal) =>
                `<div class="p-eplist__sublist"><a href="/n1234ab/${ordinal}/">합성 ${ordinal}화</a></div>`,
            )
            .join('') +
          (request.url === workUrl ? '<a rel="next" href="?p=2">다음</a>' : '');
      } else {
        const ordinal = Number(new URL(request.url).pathname.split('/')[2]);
        data = `<h1 class="p-novel__title">합성 ${ordinal}화</h1><div class="p-novel__body"><div class="p-novel__text"><p>合成${ordinal}。</p></div></div>`;
      }
      return { status: 200, url: request.url, headers: { 'Content-Type': 'text/html' }, data };
    },
  };
  let activeListener: (active: boolean) => void = () => {};
  const adapters = {
    files,
    preferences: {
      get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        preferences.set(key, value);
      },
    },
    secrets: { get: async () => null, set: async () => {}, remove: async () => {} },
    lifecycle: {
      isActive: async () => true,
      subscribe: async (listener: (active: boolean) => void) => {
        activeListener = listener;
        return async () => {};
      },
    },
    sourceTransport: createSourceTransport(client),
    modelTransport: createModelTransport(client),
  };
  const app = createRenewalApplication(adapters);
  const library = createLibraryStore(files);
  const posts = () => requests.filter((request) => request.method === 'POST');
  async function setup(): Promise<void> {
    await app.initialize();
    app.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://localhost:8080' });
    await app.checkConnection();
    app.chooseModel('synthetic-model');
    await app.openWork(workUrl);
  }
  return {
    app,
    adapters,
    library,
    guidance: createGuidanceRepository(files),
    bytes,
    requests,
    posts,
    setup,
    release,
    get maximumActive() {
      return maximumActive;
    },
    set failSave(value: boolean) {
      failSave = value;
    },
    set failSecond(value: boolean) {
      failSecond = value;
    },
    set holdFirst(value: boolean) {
      holdFirst = value;
    },
    set badPage(value: boolean) {
      badPage = value;
    },
    set failQueueAdvance(value: boolean) {
      failQueueAdvance = value;
    },
    background: () => activeListener(false),
  };
}

test('range preview resolves every TOC page without generation; explicit start stores chapters in order without reader navigation', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch({ first: 2, last: 4 }, false);
  expect(harness.posts()).toHaveLength(0);
  expect(harness.app.getSnapshot().work?.complete).toBe(true);
  expect(
    harness.app.getSnapshot().batch?.record?.chapters.map((chapter) => chapter.ordinal),
  ).toEqual([2, 3, 4]);
  await harness.app.runBatch();
  expect(
    harness.posts().map((request) => JSON.stringify(request.data).match(/合成(\d+)/)?.[1]),
  ).toEqual(['2', '3', '4']);
  expect(harness.maximumActive).toBe(1);
  expect(harness.app.getSnapshot().route.kind).toBe('work');
  expect(harness.app.getSnapshot().batch?.record).toMatchObject({
    phase: 'complete',
    completed: 3,
    skipped: 0,
  });
  expect(await harness.library.listVersions('n1234ab/4')).toHaveLength(1);
  harness.app.dispose();
});
test('all chapters share the queue, skip same-model completion and require explicit retranslation while preserving old versions', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await harness.app.runBatch();
  const original = (await harness.library.listVersions('n1234ab/1'))[0]!;
  await harness.app.prepareBatch(null, false);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(1);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(4);
  expect(harness.app.getSnapshot().batch?.record).toMatchObject({
    phase: 'complete',
    completed: 3,
    skipped: 1,
  });
  await harness.app.prepareBatch({ first: 1, last: 1 }, true);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(5);
  const versions = await harness.library.listVersions('n1234ab/1');
  expect(versions).toHaveLength(2);
  expect(versions).toContainEqual(original);
  harness.app.dispose();
});
test('bad ranges and gaps never dispatch generation or claim a full TOC', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch({ first: 4, last: 2 }, false);
  expect(harness.app.getSnapshot().batch?.record).toBeNull();
  harness.badPage = true;
  await harness.app.prepareBatch(null, false);
  expect(harness.app.getSnapshot().batch?.record).toBeNull();
  expect(harness.app.getSnapshot().work?.complete).toBe(false);
  expect(harness.posts()).toHaveLength(0);
  harness.app.dispose();
});
test('a later output failure preserves earlier completion and explicit resume handles only remaining chapters', async () => {
  const harness = fixture();
  await harness.setup();
  harness.failSecond = true;
  await harness.app.prepareBatch(null, false);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(2);
  expect(harness.app.getSnapshot().batch?.record).toMatchObject({
    phase: 'paused',
    cursor: 1,
    completed: 1,
  });
  expect(await harness.library.listVersions('n1234ab/1')).toHaveLength(1);
  expect(await harness.library.listVersions('n1234ab/2')).toHaveLength(0);
  expect(harness.app.getSnapshot().batch?.error).toContain('길이 제한');
  harness.failSecond = false;
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(5);
  expect(harness.app.getSnapshot().batch?.record?.phase).toBe('complete');
  harness.app.dispose();
});
test('batch storage retry sends no generation and pauses before later chapters', async () => {
  const harness = fixture();
  await harness.setup();
  harness.failSave = true;
  await harness.app.prepareBatch({ first: 1, last: 2 }, false);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(1);
  expect(harness.app.getSnapshot().batch?.record?.phase).toBe('saving');
  harness.failSave = false;
  await harness.app.retryBatchSave();
  expect(harness.posts()).toHaveLength(1);
  expect(harness.app.getSnapshot().batch?.record).toMatchObject({
    phase: 'paused',
    cursor: 1,
    completed: 1,
  });
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(2);
  harness.app.dispose();
});
test('cancel blocks duplicate starts, individual requests and later dispatch; restart requires uncertainty confirmation', async () => {
  const harness = fixture();
  await harness.setup();
  harness.holdFirst = true;
  await harness.app.prepareBatch(null, false);
  const running = harness.app.runBatch();
  await waitFor(() => expect(harness.posts()).toHaveLength(1));
  await harness.app.runBatch();
  await harness.app.selectChapter(harness.app.getSnapshot().work!.chapters[1]!);
  await harness.app.translate();
  expect(harness.posts()).toHaveLength(1);
  harness.app.cancelBatch();
  harness.release();
  await running;
  expect(harness.app.getSnapshot().batch?.record?.phase).toBe('unknown');
  harness.app.dispose();
  const restarted = createRenewalApplication(harness.adapters);
  await restarted.initialize();
  expect(harness.posts()).toHaveLength(1);
  await restarted.checkConnection();
  await restarted.runBatch();
  expect(harness.posts()).toHaveLength(1);
  await restarted.runBatch(true);
  expect(harness.posts()).toHaveLength(5);
  expect(restarted.getSnapshot().batch?.record?.phase).toBe('complete');
  restarted.dispose();
});
test('UI offers range and all preview with a separate explicit start action', async () => {
  const harness = fixture();
  await harness.setup();
  render(<Application controller={harness.app} />);
  fireEvent.change(screen.getByLabelText('끝 회차'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '범위 확인' }));
  await screen.findByText('확정 범위: 1–2화 · 총 2화');
  expect(harness.posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '전체 회차 확인' }));
  await screen.findByText('확정 범위: 1–4화 · 총 4화');
  expect(harness.posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '확인한 회차 번역 시작' }));
  await screen.findByText('일괄 번역 처리를 마쳤습니다. 목차에서 저장된 회차를 열어 읽으세요.');
  expect(harness.posts()).toHaveLength(4);
  expect(screen.getByRole('heading', { name: '합성 작품' })).toBeInTheDocument();
  harness.app.dispose();
});
test('restart recovers a durable unsent boundary without automatically sending or marking it uncertain', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch(null, false);
  const repository = createBatchRepository(harness.adapters.files);
  const record = (await repository.read())!;
  await repository.write({ ...record, phase: 'running' });
  harness.app.dispose();
  const restarted = createRenewalApplication(harness.adapters);
  await restarted.initialize();
  expect(restarted.getSnapshot().batch?.record?.phase).toBe('paused');
  expect(harness.posts()).toHaveLength(0);
  restarted.dispose();
});
test('background interruption stops later dispatch and connection settings remain frozen while active', async () => {
  const harness = fixture();
  await harness.setup();
  harness.holdFirst = true;
  await harness.app.prepareBatch(null, false);
  const running = harness.app.runBatch();
  await waitFor(() => expect(harness.posts()).toHaveLength(1));
  const connection = harness.app.getSnapshot().connection;
  harness.app.changeConnection({
    provider: 'openai-compatible',
    baseUrl: 'http://different.invalid:8080',
  });
  expect(harness.app.getSnapshot().connection).toEqual(connection);
  harness.background();
  harness.release();
  await running;
  expect(harness.posts()).toHaveLength(1);
  expect(harness.app.getSnapshot().batch?.record?.phase).toBe('unknown');
  await harness.app.runBatch(true);
  expect(harness.posts()).toHaveLength(1);
  harness.app.dispose();
});
test('a saved chapter survives queue metadata failure and explicit restart recovery does not regenerate it', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch({ first: 1, last: 1 }, true);
  harness.failQueueAdvance = true;
  await harness.app.runBatch();
  expect(await harness.library.listVersions('n1234ab/1')).toHaveLength(1);
  expect(harness.app.getSnapshot().batch?.record?.phase).toBe('unknown');
  harness.app.dispose();
  harness.failQueueAdvance = false;
  const restarted = createRenewalApplication(harness.adapters);
  await restarted.initialize();
  await restarted.checkConnection();
  await restarted.runBatch(true);
  expect(harness.posts()).toHaveLength(1);
  expect(restarted.getSnapshot().batch?.record).toMatchObject({
    phase: 'complete',
    completed: 1,
    skipped: 0,
  });
  restarted.dispose();
});
test('corrupt queue metadata blocks generation after restart', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch(null, false);
  harness.app.dispose();
  harness.bytes.set('batches/current.0.json', '{');
  harness.bytes.set('batches/current.1.json', '{');
  const restarted = createRenewalApplication(harness.adapters);
  await restarted.initialize();
  expect(restarted.getSnapshot().error).toContain('새 번역을 차단');
  await restarted.checkConnection();
  await restarted.runBatch(true);
  expect(harness.posts()).toHaveLength(0);
  restarted.dispose();
});

const approved = {
  terms: [{ source: '合成', target: '가온', aliases: ['合成君'], category: '인명', note: '' }],
  voices: [{ name: '合成', aliases: [], instruction: '화자가 합성일 때 존댓말을 유지한다.' }],
};
test('approved work context survives restart, is included in requests and changes cache identity without deleting versions', async () => {
  const harness = fixture();
  await harness.setup();
  const first = await harness.app.saveGuidance('n1234ab', approved);
  expect(await harness.app.readGuidance('n9999zz')).toBeNull();
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(1);
  const body = harness.posts()[0]!.data as { messages: { content: string }[] };
  expect(body.messages[0]!.content).toContain('가온');
  expect(body.messages[0]!.content).toContain('never invent a speaker');
  expect((await harness.library.listVersions('n1234ab/1'))[0]!.provenance.guidanceHash).toBe(
    first.hash,
  );
  const second = await harness.app.saveGuidance('n1234ab', {
    ...approved,
    terms: [{ ...approved.terms[0]!, target: '다온' }],
  });
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(0);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(2);
  expect(await harness.library.listVersions('n1234ab/1')).toHaveLength(2);
  harness.app.dispose();
  const restarted = createRenewalApplication(harness.adapters);
  await restarted.initialize();
  expect((await restarted.readGuidance('n1234ab'))?.hash).toBe(second.hash);
  expect(harness.posts()).toHaveLength(2);
  restarted.dispose();
});
test('editing context after a batch preview requires a fresh preview and makes no generation request', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.saveGuidance('n1234ab', approved);
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await harness.app.saveGuidance('n1234ab', { terms: [], voices: [] });
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(0);
  expect(harness.app.getSnapshot().batch?.error).toContain('용어집·말투가 바뀌었습니다');
  harness.app.dispose();
});
test('oversized approved context fails before generation without silently dropping terms', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.saveGuidance('n1234ab', {
    terms: [{ ...approved.terms[0]!, note: '한'.repeat(300) }],
    voices: [{ ...approved.voices[0]!, instruction: '한'.repeat(400) }],
  });
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(0);
  expect(harness.app.getSnapshot().batch?.error).toContain('입력 한도');
  expect(await harness.library.listVersions('n1234ab/1')).toHaveLength(0);
  harness.app.dispose();
});
test('the work editor only applies explicitly saved terms and supports multiple aliases and deletion', async () => {
  const harness = fixture();
  await harness.setup();
  render(<Application controller={harness.app} />);
  fireEvent.click(screen.getByText('작품 용어집·캐릭터 말투'));
  await waitFor(() => expect(screen.getByRole('button', { name: '용어 추가' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '용어 추가' }));
  fireEvent.change(screen.getByLabelText('용어 1 원문'), { target: { value: '合成' } });
  fireEvent.change(screen.getByLabelText('용어 1 한국어 표기'), { target: { value: '가온' } });
  fireEvent.change(screen.getByLabelText('용어 1 별칭'), { target: { value: '合成君, 先生' } });
  expect(await harness.app.readGuidance('n1234ab')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '용어집·말투 저장' }));
  await screen.findByText(/저장했습니다. 다음 번역에 적용/);
  expect((await harness.app.readGuidance('n1234ab'))?.terms[0]?.aliases).toEqual([
    '合成君',
    '先生',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '용어 1 삭제' }));
  fireEvent.click(screen.getByRole('button', { name: '용어집·말투 저장' }));
  await waitFor(async () => expect((await harness.app.readGuidance('n1234ab'))?.terms).toEqual([]));
  harness.app.dispose();
});
test('reference matching includes aliases and excludes unrelated entries and never changes source text', async () => {
  const harness = fixture();
  await harness.setup();
  const value = await harness.app.saveGuidance('n1234ab', {
    terms: [
      ...approved.terms,
      { source: '未登場', target: '스포일러', aliases: [], category: '', note: '' },
    ],
    voices: approved.voices,
  });
  const context = guidanceContext(value, 'n1234ab', '合成君は来なかった。');
  expect(context).toContain('가온');
  expect(context).not.toContain('스포일러');
  expect(() => guidanceContext(value, 'n9999zz', '合成')).toThrow();
  harness.app.dispose();
});
