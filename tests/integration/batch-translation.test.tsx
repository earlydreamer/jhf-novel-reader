// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { createRenewalApplication } from '../../src/app/compose';
import { Application } from '../../src/app/Application';
import { runTopBackHandler } from '../../src/ui/shell/backStack';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';
import { createBatchRepository } from '../../src/translation/batch';
import type { NativeHttpRequest } from '../../src/contracts';
import {
  appliedGuidanceHash,
  createGuidanceRepository,
  guidanceContext,
} from '../../src/translation/guidance';
import { normalizeChapterInput } from '../../src/providers/plainText';
import type { RenewalController } from '../../src/app/renewalController';

async function finishScan(app: RenewalController): Promise<void> {
  if (app.getSnapshot().batch?.record?.scan?.status === 'pending') await app.scanBatch();
  if (app.getSnapshot().batch?.record?.scan?.status === 'review')
    await app.confirmBatchCandidates([]);
}

afterEach(cleanup);
const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const otherWorkUrl = 'https://ncode.syosetu.com/n9999zz/';
function fixture() {
  const bytes = new Map<string, string>();
  const preferences = new Map<string, string>();
  const requests: NativeHttpRequest[] = [];
  let failSave = false;
  let failGuidance = false;
  let failSecond = false;
  let holdFirst = false;
  let badPage = false;
  let failOtherWorkPage = false;
  let failQueueAdvance = false;
  let chapterExtra = '';
  let failScanChapter = 0;
  let holdSource = false;
  let active = 0;
  let maximumActive = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const files = {
    read: async (path: string) => bytes.get(path) ?? null,
    write: async (path: string, value: string) => {
      if (failGuidance && path.startsWith('guidance/')) throw Error('synthetic guidance rejection');
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
              // 줄 ID 응답. 출력 한도 시나리오는 닫는 태그 없이 잘린 응답이다.
              message: {
                content:
                  failSecond && ordinal === 2
                    ? `<p id="A">번역 ${ordinal}`
                    : `<p id="A">번역 ${ordinal}</p>`,
              },
            },
          ],
        });
      } else if (request.url.endsWith('/models')) {
        data = JSON.stringify({ data: [{ id: 'synthetic-model', meta: { n_ctx: 8192 } }] });
      } else if (
        request.url === workUrl ||
        request.url === workUrl + '?p=2' ||
        request.url === otherWorkUrl ||
        request.url === otherWorkUrl + '?p=2'
      ) {
        const workId = new URL(request.url).pathname.split('/')[1]!;
        if (failOtherWorkPage && workId === 'n9999zz') throw Error('synthetic work page failure');
        const isFirstPage = !request.url.endsWith('?p=2');
        const ordinals = isFirstPage ? [1, 2] : [3, 4];
        if (badPage && request.url.endsWith('?p=2')) ordinals.splice(0, 1);
        data =
          '<h1 class="p-novel__title">합성 작품</h1>' +
          ordinals
            .map(
              (ordinal) =>
                `<div class="p-eplist__sublist"><a href="/${workId}/${ordinal}/">합성 ${ordinal}화</a></div>`,
            )
            .join('') +
          (isFirstPage
            ? '<a rel="next" href="?p=2">다음</a>'
            : '<span class="c-pager__item c-pager__item--next">다음</span>');
      } else {
        const ordinal = Number(new URL(request.url).pathname.split('/')[2]);
        if (holdSource) await gate;
        if (ordinal === failScanChapter) throw Error('synthetic source failure');
        data = `<h1 class="p-novel__title">합성 ${ordinal}화</h1><div class="p-novel__body"><div class="p-novel__text"><p>合成${ordinal}。${chapterExtra}</p></div></div>`;
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
    set failGuidance(value: boolean) {
      failGuidance = value;
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
    set failOtherWorkPage(value: boolean) {
      failOtherWorkPage = value;
    },
    set failQueueAdvance(value: boolean) {
      failQueueAdvance = value;
    },
    set chapterExtra(value: string) {
      chapterExtra = value;
    },
    set failScanChapter(value: number) {
      failScanChapter = value;
    },
    set holdSource(value: boolean) {
      holdSource = value;
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
  await finishScan(harness.app);
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
  await finishScan(harness.app);
  await harness.app.runBatch();
  const original = (await harness.library.listVersions('n1234ab/1'))[0]!;
  await harness.app.prepareBatch(null, false);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(1);
  await finishScan(harness.app);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(4);
  expect(harness.app.getSnapshot().batch?.record).toMatchObject({
    phase: 'complete',
    completed: 3,
    skipped: 1,
  });
  await harness.app.prepareBatch({ first: 1, last: 1 }, true);
  await finishScan(harness.app);
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
  await finishScan(harness.app);
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
  await finishScan(harness.app);
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
  await finishScan(harness.app);
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
  await finishScan(harness.app);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(2);
  harness.app.dispose();
});
test('cancel blocks duplicate starts, individual requests and later dispatch; restart requires uncertainty confirmation', async () => {
  const harness = fixture();
  await harness.setup();
  harness.holdFirst = true;
  await harness.app.prepareBatch(null, false);
  await finishScan(harness.app);
  const running = harness.app.runBatch();
  await waitFor(() => expect(harness.posts()).toHaveLength(1));
  await finishScan(harness.app);
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
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '미리 번역하기' }));
  fireEvent.change(screen.getByLabelText('끝 회차'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '범위 확인' }));
  await screen.findByText('확정 범위: 1–2화 · 총 2화');
  expect(harness.posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '전체 회차 확인' }));
  await screen.findByText('확정 범위: 1–4화 · 총 4화');
  expect(harness.posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: '범위 고유명사 후보 스캔' }));
  await waitFor(
    () => expect(harness.app.getSnapshot().batch?.record?.scan?.status).toBe('review'),
    { timeout: 10_000 },
  );
  const confirmCandidates = await screen.findByRole('button', { name: /확인 완료/ });
  fireEvent.click(confirmCandidates);
  await screen.findByRole('button', { name: '확인한 회차 번역 시작' });
  fireEvent.click(screen.getByRole('button', { name: '확인한 회차 번역 시작' }));
  await waitFor(() => expect(harness.app.getSnapshot().batch?.record?.phase).toBe('complete'), {
    timeout: 10_000,
  });
  await screen.findByText(
    '일괄 번역을 마쳤어요. 목차에서 저장된 회차를 열어 읽을 수 있어요.',
    {},
    { timeout: 10_000 },
  );
  expect(harness.posts()).toHaveLength(4);
  expect(screen.getByRole('heading', { name: '합성 작품' })).toBeInTheDocument();
  harness.app.dispose();
});

test('keeps a failed preparation error on B while preserving A as the latest record owner', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  expect(harness.app.getSnapshot().batch?.record?.work.workId).toBe('n1234ab');
  await harness.app.openWork(otherWorkUrl);
  expect(harness.app.getSnapshot().work?.workId).toBe('n9999zz');
  harness.failOtherWorkPage = true;
  await harness.app.prepareBatch(null, false);
  expect(harness.app.getSnapshot().batch).toMatchObject({
    preparing: false,
    active: false,
    preparingWorkId: undefined,
    errorWorkId: 'n9999zz',
    record: { work: { workId: 'n1234ab' } },
  });
  expect(harness.posts()).toHaveLength(0);

  render(<Application controller={harness.app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '미리 번역하기' }));
  expect(await screen.findByText(/전체 목차와 고른 범위를 확인하지 못했어요/)).toBeInTheDocument();
  expect(screen.queryByText('확정 범위: 1–1화 · 총 1화')).toBeNull();

  harness.app.back();
  await waitFor(() => expect(harness.app.getSnapshot().work?.workId).toBe('n1234ab'));
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '미리 번역하기' }));
  expect(await screen.findByText('확정 범위: 1–1화 · 총 1화')).toBeInTheDocument();
  expect(screen.queryByText(/전체 목차와 고른 범위를 확인하지 못했어요/)).toBeNull();
  expect(harness.posts()).toHaveLength(0);
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
  await finishScan(harness.app);
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
  await finishScan(harness.app);
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
  expect(restarted.getSnapshot().error).toContain('새 번역을 막았어요');
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
  await finishScan(harness.app);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(1);
  const body = harness.posts()[0]!.data as { messages: { content: string }[] };
  expect(body.messages[0]!.content).toMatch(
    /^Reference the following translations:\n.* translates to 가온\n/,
  );
  expect(body.messages[0]!.content).toContain('합성일 때 존댓말');
  expect(body.messages[0]!.content).toContain(
    'only when the source clearly identifies the speaker',
  );
  const saved = (await harness.library.listVersions('n1234ab/1'))[0]!;
  expect(saved.provenance.guidanceHash).toBe(
    await appliedGuidanceHash(first, 'n1234ab', normalizeChapterInput(saved.source)),
  );
  expect(saved.provenance.guidanceHash).not.toBe(first.hash);
  // 이 회차에 등장하지 않는 항목을 추가해도 기존 완성본은 같은 선택으로 남는다.
  await harness.app.saveGuidance('n1234ab', {
    ...approved,
    terms: [
      ...approved.terms,
      { source: '未登場', target: '미등장', aliases: [], category: '', note: '' },
    ],
  });
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(1);
  await finishScan(harness.app);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(1);
  const second = await harness.app.saveGuidance('n1234ab', {
    ...approved,
    terms: [{ ...approved.terms[0]!, target: '다온' }],
  });
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(0);
  await finishScan(harness.app);
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
test('the work glossary has no entry-count cap but rejects normalized duplicate names', async () => {
  const harness = fixture();
  await harness.setup();
  const terms = Array.from({ length: 60 }, (_, index) => ({
    source: `用語${index}`,
    target: `용어${index}`,
    aliases: [],
    category: '',
    note: '',
  }));
  expect((await harness.app.saveGuidance('n1234ab', { terms, voices: [] })).terms).toHaveLength(60);
  await expect(
    harness.app.saveGuidance('n1234ab', {
      terms: [
        { source: 'アルベルト', target: '알베르트', aliases: [], category: '', note: '' },
        { source: 'ｱﾙﾍﾞﾙﾄ', target: '알버트', aliases: [], category: '', note: '' },
      ],
      voices: [],
    }),
  ).rejects.toThrow();
  expect((await harness.app.readGuidance('n1234ab'))?.terms).toHaveLength(60);
  harness.app.dispose();
});
test('editing context after a batch preview requires a fresh preview and makes no generation request', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.saveGuidance('n1234ab', approved);
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await finishScan(harness.app);
  await harness.app.saveGuidance('n1234ab', { terms: [], voices: [] });
  await finishScan(harness.app);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(0);
  expect(harness.app.getSnapshot().batch?.error).toContain('용어집이나 말투가 바뀌었어요');
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
  await finishScan(harness.app);
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
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어집 편집하기' }));
  fireEvent.click(screen.getByText('작품 용어집·캐릭터 말투'));
  await waitFor(() => expect(screen.getByRole('button', { name: '용어 추가' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: '용어 추가' }));
  fireEvent.change(screen.getByLabelText('용어 1 원문'), { target: { value: '合成' } });
  fireEvent.change(screen.getByLabelText('용어 1 한국어 표기'), { target: { value: '가온' } });
  fireEvent.change(screen.getByLabelText('용어 1 별칭'), { target: { value: '合成君, 先生' } });
  expect(await harness.app.readGuidance('n1234ab')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '용어집·말투 저장' }));
  await screen.findByText(/저장했어요. 다음 번역부터 적용/);
  expect((await harness.app.readGuidance('n1234ab'))?.terms[0]?.aliases).toEqual([
    '合成君',
    '先生',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '용어 1 삭제' }));
  fireEvent.click(screen.getByRole('button', { name: '용어집·말투 저장' }));
  await waitFor(async () => expect((await harness.app.readGuidance('n1234ab'))?.terms).toEqual([]));
  harness.app.dispose();
});
test('the work glossary keeps a failed draft across Back and resets it for another work', async () => {
  const harness = fixture();
  await harness.setup();
  render(<Application controller={harness.app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어집 편집하기' }));
  fireEvent.click(screen.getByText('작품 용어집·캐릭터 말투'));
  const sourceField = await screen.findByLabelText('이전 이야기 요약 (선택, 이름 없이 400자 이내)');
  fireEvent.change(sourceField, { target: { value: '초안은 저장 실패 뒤에도 남아야 해요.' } });
  harness.failGuidance = true;
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  await screen.findByText(/저장하지 못했어요/);
  expect(sourceField).toHaveValue('초안은 저장 실패 뒤에도 남아야 해요.');
  let handled = false;
  act(() => {
    handled = runTopBackHandler();
  });
  expect(handled).toBe(true);
  expect(screen.queryByRole('dialog', { name: '작품 용어집' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어집 편집하기' }));
  fireEvent.click(screen.getByText('작품 용어집·캐릭터 말투'));
  expect(await screen.findByLabelText('이전 이야기 요약 (선택, 이름 없이 400자 이내)')).toHaveValue(
    '초안은 저장 실패 뒤에도 남아야 해요.',
  );

  await harness.app.openWork(otherWorkUrl);
  await waitFor(() => expect(harness.app.getSnapshot().work?.workId).toBe('n9999zz'));
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어집 편집하기' }));
  fireEvent.click(screen.getByText('작품 용어집·캐릭터 말투'));
  expect(await screen.findByLabelText('이전 이야기 요약 (선택, 이름 없이 400자 이내)')).toHaveValue(
    '',
  );
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

test('scope scanning and explicit confirmation make no POST; selected targets are frozen once and cached source is reused', async () => {
  const harness = fixture();
  await harness.setup();
  harness.chapterExtra = 'アルベルトとアルベルト。ミカエルとミカエル。';
  await harness.app.prepareBatch({ first: 2, last: 3 }, false);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(0);
  expect(harness.app.getSnapshot().batch?.error).toContain('후보');
  await harness.app.scanBatch();
  expect(harness.app.getSnapshot().batch?.record?.scan).toMatchObject({
    status: 'review',
    candidates: [
      { source: 'アルベルト', count: 4, chapterIds: ['n1234ab/2', 'n1234ab/3'] },
      { source: 'ミカエル', count: 4 },
    ],
  });
  const gets = harness.requests.filter((request) =>
    /^https:\/\/ncode\.syosetu\.com\/n1234ab\/\d+\/$/.test(request.url),
  );
  expect(gets.map((request) => request.url)).toEqual([workUrl + '2/', workUrl + '3/']);
  expect(await harness.app.readGuidance('n1234ab')).toBeNull();
  await harness.app.confirmBatchCandidates([{ source: 'アルベルト', target: '알베르트' }]);
  expect(harness.posts()).toHaveLength(0);
  expect((await harness.app.readGuidance('n1234ab'))?.terms).toEqual([
    { source: 'アルベルト', target: '알베르트', aliases: [], category: '고유명사', note: '' },
  ]);
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(2);
  expect(
    harness.requests.filter((request) => gets.some((get) => get.url === request.url)),
  ).toHaveLength(2);
  const request = harness.posts()[0]!.data as { messages: { content: string }[] };
  expect(request.messages[0]!.content).toContain('アルベルト translates to 알베르트');
  expect(request.messages[0]!.content).not.toContain('ミカエル translates to');
  expect((await harness.library.listVersions('n1234ab/2'))[0]?.quality?.missingTerms).toEqual([
    { source: 'アルベルト', target: '알베르트' },
  ]);
  harness.app.dispose();
});
test('a partial failed scan cannot be confirmed; retry scans the full scope and rejected choices keep review pending', async () => {
  const harness = fixture();
  await harness.setup();
  harness.chapterExtra = 'アルベルトとアルベルト。';
  harness.failScanChapter = 2;
  await harness.app.prepareBatch({ first: 1, last: 2 }, false);
  await harness.app.scanBatch();
  expect(harness.app.getSnapshot().batch?.record?.scan).toEqual({
    status: 'pending',
    candidates: [],
  });
  await harness.app.confirmBatchCandidates([{ source: 'アルベルト', target: '알베르트' }]);
  expect(await harness.app.readGuidance('n1234ab')).toBeNull();
  harness.failScanChapter = 0;
  await harness.app.scanBatch();
  await harness.app.confirmBatchCandidates([{ source: '없는 후보', target: '표기' }]);
  expect(harness.app.getSnapshot().batch?.record?.scan?.status).toBe('review');
  expect(harness.posts()).toHaveLength(0);
  await harness.app.confirmBatchCandidates([{ source: 'アルベルト', target: ' ' }]);
  expect(harness.app.getSnapshot().batch?.record?.scan?.status).toBe('review');
  await harness.app.confirmBatchCandidates([]);
  expect(harness.app.getSnapshot().batch?.record?.scan?.status).toBe('confirmed');
  expect(await harness.app.readGuidance('n1234ab')).toBeNull();
  harness.app.dispose();
});
test('review candidates survive restart, do not auto-confirm and preserve a manual target saved after scanning', async () => {
  const harness = fixture();
  await harness.setup();
  harness.chapterExtra = 'アルベルトとアルベルト。';
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await harness.app.scanBatch();
  harness.app.dispose();
  const restarted = createRenewalApplication(harness.adapters);
  await restarted.initialize();
  await restarted.checkConnection();
  expect(restarted.getSnapshot().batch?.record?.scan?.status).toBe('review');
  await restarted.runBatch();
  expect(harness.posts()).toHaveLength(0);
  restarted.openBatch();
  await restarted.saveGuidance('n1234ab', {
    terms: [{ source: 'アルベルト', target: '알버트', aliases: [], category: '', note: '' }],
    voices: [],
  });
  await restarted.confirmBatchCandidates([{ source: 'アルベルト', target: '알베르트' }]);
  expect((await restarted.readGuidance('n1234ab'))?.terms[0]?.target).toBe('알버트');
  await restarted.runBatch();
  expect(harness.posts()).toHaveLength(1);
  restarted.dispose();
});
test('candidate UI requires a checked item and spelling, refreshes the editor after confirmation and shows saved QA', async () => {
  const harness = fixture();
  await harness.setup();
  harness.chapterExtra = 'アルベルトとアルベルト。';
  render(<Application controller={harness.app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '미리 번역하기' }));
  fireEvent.change(screen.getByLabelText('끝 회차'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '범위 확인' }));
  fireEvent.click(await screen.findByRole('button', { name: '범위 고유명사 후보 스캔' }));
  await screen.findByRole('heading', { name: '고유명사 후보 1개' });
  expect(screen.queryByRole('button', { name: '확인한 회차 번역 시작' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('アルベルト 사용'));
  expect(screen.getByRole('button', { name: '선택한 1개 표기 확정' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('アルベルト 한국어 표기'), {
    target: { value: '알베르트' },
  });
  fireEvent.click(screen.getByRole('button', { name: '선택한 1개 표기 확정' }));
  const start = await screen.findByRole('button', { name: '확인한 회차 번역 시작' });
  await waitFor(() => expect(screen.getByLabelText('용어 1 한국어 표기')).toHaveValue('알베르트'));
  expect(harness.posts()).toHaveLength(0);
  fireEvent.click(start);
  await screen.findByText('일괄 번역을 마쳤어요. 목차에서 저장된 회차를 열어 읽을 수 있어요.');
  await harness.app.continueReading(
    (await harness.library.listVersions('n1234ab/1'))[0]!.versionId,
  );
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '번역 확인 결과 보기' }));
  await screen.findByRole('heading', { name: '번역 확인 결과' });
  expect(screen.getByText('가나가 남은 문단 0개 · 확정 표기 미발견 1개')).toBeVisible();
  expect(
    screen.getByRole('article', { name: '번역 본문' }).querySelector('[data-reader-index="0"]'),
  ).toHaveTextContent('번역 1');
  expect(harness.posts()).toHaveLength(1);
  harness.app.dispose();
});
test('canceling a running scan discards partial candidates and cannot start any generation', async () => {
  const harness = fixture();
  await harness.setup();
  await harness.app.prepareBatch({ first: 1, last: 2 }, false);
  harness.holdSource = true;
  const scanning = harness.app.scanBatch();
  await waitFor(() =>
    expect(harness.requests.some((request) => request.url === workUrl + '1/')).toBe(true),
  );
  await harness.app.scanBatch();
  expect(harness.requests.filter((request) => request.url === workUrl + '1/')).toHaveLength(1);
  harness.app.cancelBatch();
  harness.release();
  await scanning;
  expect(harness.app.getSnapshot().batch?.record?.scan).toEqual({
    status: 'pending',
    candidates: [],
  });
  await harness.app.runBatch();
  expect(harness.posts()).toHaveLength(0);
  harness.app.dispose();
});
test('confirming a newly found term updates saved-skip counts and old queues remain compatible', async () => {
  const harness = fixture();
  await harness.setup();
  harness.chapterExtra = 'アルベルトとアルベルト。';
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  await finishScan(harness.app);
  await harness.app.runBatch();
  await harness.app.prepareBatch({ first: 1, last: 1 }, false);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(1);
  await harness.app.scanBatch();
  await harness.app.confirmBatchCandidates([{ source: 'アルベルト', target: '알베르트' }]);
  expect(harness.app.getSnapshot().batch?.record?.alreadySaved).toBe(0);
  const repository = createBatchRepository(harness.adapters.files);
  const record = (await repository.read())!;
  await expect(
    repository.write({
      ...record,
      scan: {
        status: 'review',
        candidates: [{ source: '候補', kind: 'ruby', count: 1, chapterIds: ['n1234ab/4'] }],
      },
    }),
  ).rejects.toThrow();
  const { scan: _scan, ...legacy } = record;
  await repository.write(legacy);
  expect((await repository.read())?.scan).toBeUndefined();
  harness.app.dispose();
});
