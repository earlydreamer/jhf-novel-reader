// @vitest-environment jsdom
// 번역 제공자별 기능 지원 표(docs/providers.md)를 실제 앱 조립으로 검사한다(#420).
// 모든 제공자에 같은 단언을 쓰고, 표가 "지원"이면 동작해야 하고 "미지원"이면 막혀야 한다.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createRenewalApplication } from '../../src/app/compose';
import type {
  ChatGptAccount,
  HttpResponse,
  NativeHttpClient,
  NativeHttpRequest,
  NativeStreamingClient,
} from '../../src/contracts';
import { GEMINI_BASE_URL } from '../../src/providers/gemini';
import { CHATGPT_BASE_URL } from '../../src/providers/chatgpt';
import { createModelTransport, createSourceTransport } from '../../src/platform/http';
import { createLibraryStore } from '../../src/storage/library';

type ProviderId = 'openai-compatible' | 'gemini' | 'chatgpt';
type Support = 'supported' | { readonly issue: number };

const FEATURES = {
  chapter: '회차 번역과 저장',
  workTerms: '작품 용어집 적용',
  voices: '말투 적용',
  plotSummary: '이야기 요약 적용',
  sharedTerms: '공용 용어집 적용',
  repair: '문단 재번역',
  autoRetry: '실패 문단 자동 재번역',
  autoChapter: '읽는 회차 자동 번역',
  titleManual: '제목 직접 번역',
  titleAuto: '제목 자동 번역',
  titleGuidance: '제목 번역의 용어집 적용',
  autoGlossary: '자동 용어집',
  termScan: '용어 정밀스캔',
  termFill: '미리 번역 후보의 표기 채우기',
  batch: '구간 일괄 번역',
} as const;
type Feature = keyof typeof FEATURES;

const PROVIDER_LABELS: Record<ProviderId, string> = {
  'openai-compatible': '로컬 서버',
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
};

/** docs/providers.md의 "제공자별 기능 지원" 표와 같아야 한다. 새 제공자는 열을 추가한다. */
const SUPPORT: Record<Feature, Record<ProviderId, Support>> = {
  chapter: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  workTerms: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  voices: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  plotSummary: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  sharedTerms: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  repair: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  autoRetry: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  autoChapter: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  titleManual: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  titleAuto: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  titleGuidance: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
  autoGlossary: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: { issue: 424 } },
  termScan: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: { issue: 424 } },
  termFill: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: { issue: 424 } },
  batch: { 'openai-compatible': 'supported', gemini: 'supported', chatgpt: 'supported' },
};
const PROVIDERS = Object.keys(PROVIDER_LABELS) as ProviderId[];

const workUrl = 'https://ncode.syosetu.com/n1234ab/';
const chapterUrls = [`${workUrl}1/`, `${workUrl}2/`];
const toc =
  '<h1 class="p-novel__title">アリスの物語</h1>' +
  '<div class="p-eplist__sublist"><a href="/n1234ab/1/">夏の朝</a></div>' +
  '<div class="p-eplist__sublist"><a href="/n1234ab/2/">夏の夜</a></div>';
const chapterHtml = (title: string, first: string) =>
  `<h1 class="p-novel__title">${title}</h1><div class="p-novel__body"><div class="p-novel__text">` +
  `<p>${first}</p><p>扉を閉めた。</p></div></div>`;
const LOCAL_BASE = 'http://localhost:1234';
const SECRET = 'synthetic-key';
const SUMMARY = '여름 방학의 짧은 여행 이야기';
const VOICE = '짧은 반말로 말한다';
const PAGE_ROW = /<p id="([^"]+)">([^]*?)<\/p>/g;
// 참고 표기(`원문->표기`)와 표기 보강 줄(`원문 → 표기`)을 모두 읽는다.
const TERM_PAIR = /([^\s"\\>|:,]+) ?(?:->|→) ?([^\\"|\n]+)/g;
const LETTERS = '가나다라마바사아자차';

const apps: ReturnType<typeof createRenewalApplication>[] = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.dispose());
});

/**
 * 실제 앱 조립에 원문 사이트와 제공자를 흉내 내는 전송을 붙인다.
 * `first`는 각 회차의 첫 문단이며, 기본값은 공용 용어가 없는 문장이다.
 */
function harness(
  provider: ProviderId,
  options: {
    first?: string;
    automatic?: boolean;
    untranslatedOnce?: boolean;
    /** ChatGPT 응답을 오류로 바꾼다. midStream이면 일부 delta 뒤 response.failed로 끝난다. */
    chatgptFailure?: { status: number; code: string; midStream?: boolean };
  } = {},
) {
  const first = options.first ?? '扉を開けた。';
  const bytes = new Map<string, string>();
  const preferences = new Map<string, string>([
    [
      'narou-reader.reading-settings.v2',
      JSON.stringify({
        schemaVersion: 2,
        selection: null,
        fontSize: 18,
        autoTranslate: options.automatic ?? false,
        autoGlossary: false,
      }),
    ],
  ]);
  const secrets = new Map<string, string>();
  const posts: NativeHttpRequest[] = [];
  /** 첫 문단 단위 응답에서 마지막 문단만 일본어로 남긴다(실패 문단 재번역 검사). */
  let untranslatedOnce = options.untranslatedOnce ?? false;

  const promptOf = (data: unknown): string => {
    if (provider === 'chatgpt')
      return (data as { input: { content: string }[] }).input.at(-1)!.content;
    if (provider === 'gemini') {
      const body = data as { contents: { parts: { text: string }[] }[] };
      return body.contents
        .at(-1)!
        .parts.map((part) => part.text)
        .join('');
    }
    return (data as { messages: { content: string }[] }).messages.at(-1)!.content;
  };
  const isJson = (data: unknown) =>
    provider === 'chatgpt'
      ? String((data as { instructions?: string }).instructions).includes('JSON')
      : provider === 'gemini'
        ? (data as { generationConfig?: { responseMimeType?: string } }).generationConfig
            ?.responseMimeType === 'application/json'
        : 'response_format' in (data as object);
  /** 요청에 실린 `원문->표기` 쌍을 원문 문단에 맞춰 넣는 합성 모델. */
  const translate = (data: unknown, text: string, index: number) => {
    // JSON 문자열의 `\n`을 줄바꿈으로 되돌려 표기 줄의 앞 글자가 섞이지 않게 한다.
    const pairs = [...JSON.stringify(data).replaceAll('\\n', '\n').matchAll(TERM_PAIR)];
    const targets = pairs.filter(([, from]) => text.includes(from!)).map(([, , to]) => to);
    return [...new Set(targets), `번역 ${LETTERS[index % LETTERS.length]}`].join(' ');
  };
  const reply = (data: unknown): string => {
    if (isJson(data)) return '{}';
    const prompt = promptOf(data);
    // 지시문의 `<p id="...">` 예시를 빼고 마지막 원문 블록만 읽는다.
    const rows = [...prompt.slice(Math.max(0, prompt.lastIndexOf('<main>'))).matchAll(PAGE_ROW)];
    if (!rows.length)
      return prompt
        .split('\n\n')
        .map((text, index) => translate(data, text, index))
        .join('\n\n');
    const result =
      '<main>' +
      rows
        .map(([, id, text], index) => {
          const fail = untranslatedOnce && index === rows.length - 1;
          return `<p id="${id}">${fail ? 'まだ日本語' : translate(data, text!, index)}</p>`;
        })
        .join('') +
      '</main>';
    untranslatedOnce = false;
    return result;
  };
  const frame = (text: string) =>
    provider === 'gemini'
      ? `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\r\n\r\n` +
        `data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}\r\n\r\n`
      : `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n` +
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const completion = (text: string) =>
    provider === 'gemini'
      ? JSON.stringify({
          candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text }] } }],
        })
      : JSON.stringify({
          choices: [
            { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
          ],
        });

  const client: NativeHttpClient = {
    async request(input): Promise<HttpResponse> {
      if (input.method === 'POST') {
        posts.push(input);
        return { status: 200, headers: {}, url: input.url, data: completion(reply(input.data)) };
      }
      if (input.url === `${GEMINI_BASE_URL}/models`)
        return {
          status: 200,
          headers: {},
          url: input.url,
          data: JSON.stringify({
            models: [
              {
                name: 'models/gemini-3.6-flash',
                displayName: 'Gemini 3.6 Flash',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
        };
      if (input.url === `${LOCAL_BASE}/v1/models`)
        return {
          status: 200,
          headers: {},
          url: input.url,
          data: JSON.stringify({ data: [{ id: 'gemma-4-E4B', meta: { n_ctx: 16384 } }] }),
        };
      const html =
        input.url === workUrl
          ? toc
          : input.url === chapterUrls[0]
            ? chapterHtml('夏の朝', first)
            : input.url === chapterUrls[1]
              ? chapterHtml('夏の夜', first)
              : null;
      if (html === null) throw new Error(`Unexpected test request: ${input.url}`);
      return { status: 200, headers: { 'Content-Type': 'text/html' }, url: input.url, data: html };
    },
  };
  const streaming: NativeStreamingClient = {
    async requestStream(input, _signal, onData) {
      posts.push(input);
      const data = frame(reply(input.data));
      onData(data);
      return { status: 200, headers: {}, url: input.url, data };
    },
  };
  /** ChatGPT 계정 연결. Responses SSE로 같은 합성 응답을 돌려준다. */
  const chatgpt: ChatGptAccount = {
    status: async () => 'connected',
    connect: async () => 'connected',
    cancelConnect: async () => {},
    disconnect: async () => ({ revoked: true, hadSession: true }),
    models: async () => ({
      status: 200,
      headers: {},
      url: `${CHATGPT_BASE_URL}/models`,
      data: { models: [{ slug: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' }] },
    }),
    async respond(body, _signal, onData) {
      const input = { url: `${CHATGPT_BASE_URL}/responses`, data: body } as NativeHttpRequest;
      posts.push(input);
      const failure = options.chatgptFailure;
      if (failure && !failure.midStream)
        return {
          status: failure.status,
          headers: {},
          url: input.url,
          data: JSON.stringify({ error: { code: failure.code } }),
        };
      const text = reply(body);
      const item = { id: 'msg_1', type: 'message', role: 'assistant' };
      const events = [
        { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_text.delta', delta: text },
        failure
          ? {
              type: 'response.failed',
              response: { id: 'resp_1', status: 'failed', error: { code: failure.code } },
            }
          : {
              type: 'response.completed',
              response: {
                id: 'resp_1',
                status: 'completed',
                output: [
                  { ...item, status: 'completed', content: [{ type: 'output_text', text }] },
                ],
              },
            },
      ];
      const data = events
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join('');
      for (const line of data.split('\n')) onData(line + '\n');
      return { status: 200, headers: {}, url: input.url, data };
    },
  };
  const files = {
    read: async (path: string) => bytes.get(path) ?? null,
    write: async (path: string, value: string) => {
      bytes.set(path, value);
    },
  };
  const app = createRenewalApplication({
    files,
    preferences: {
      get: async ({ key }: { key: string }) => ({ value: preferences.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => {
        preferences.set(key, value);
      },
    },
    secrets: {
      get: async (ref: string) => secrets.get(ref) ?? null,
      set: async (ref: string, value: string) => {
        secrets.set(ref, value);
      },
      remove: async (ref: string) => {
        secrets.delete(ref);
      },
    },
    lifecycle: { isActive: async () => true, subscribe: async () => async () => {} },
    sourceTransport: createSourceTransport(client),
    modelTransport: createModelTransport(client, streaming),
    chatgpt,
  });
  apps.push(app);
  const sent = () => posts.map((post) => JSON.stringify(post.data));
  return {
    app,
    posts,
    sent,
    store: createLibraryStore(files),
    async connect() {
      await app.initialize();
      if (provider === 'chatgpt') {
        app.changeConnection({ provider: 'chatgpt', baseUrl: CHATGPT_BASE_URL });
        await expect.poll(() => app.getSnapshot().chatgptAccount).toBe('connected');
        await app.checkConnection();
        app.chooseModel('gpt-6.1-sol');
      } else if (provider === 'gemini') {
        app.changeConnection({ provider: 'gemini', baseUrl: GEMINI_BASE_URL });
        await app.checkConnection(SECRET);
        app.chooseModel('gemini-3.6-flash');
      } else {
        app.changeConnection({ provider: 'openai-compatible', baseUrl: LOCAL_BASE });
        await app.checkConnection();
        app.chooseModel('gemma-4-E4B');
      }
      expect(app.getSnapshot().catalogStatus).toBe('connected');
    },
    async openFirstChapter() {
      await app.openWork(workUrl);
      const chapter = app.getSnapshot().work!.chapters[0]!;
      await app.selectChapter(chapter);
      return chapter;
    },
  };
}
type Harness = ReturnType<typeof harness>;

async function settle(app: Harness['app']) {
  await expect
    .poll(() => {
      const state = app.getSnapshot();
      return (
        !state.translationActive &&
        !state.titlesBusy &&
        !['preparing', 'translating', 'validating', 'saving'].includes(state.translation.phase) &&
        !state.pendingSaveChapter
      );
    })
    .toBe(true);
}

async function withTerm(h: Harness, workId: string, source: string, target: string) {
  await h.app.saveGuidance(workId, {
    terms: [{ source, target, aliases: [], category: '', note: '' }],
    voices: [],
  });
}

async function savedText(h: Harness, chapterId: string) {
  const versions = await h.store.listVersions(chapterId);
  return versions.flatMap((version) => version.blocks.map((block) => block.text)).join(' ');
}

/** 기능이 실제로 동작했는지 관찰한다. 제공자별 분기 없이 같은 관찰을 쓴다. */
const CHECKS: Record<Feature, (provider: ProviderId) => Promise<boolean>> = {
  async chapter(provider) {
    const h = harness(provider);
    await h.connect();
    const chapter = await h.openFirstChapter();
    await h.app.translate();
    await settle(h.app);
    const versions = await h.store.listVersions(chapter.chapterId);
    return versions.length === 1 && versions[0]!.provenance.provider === provider;
  },
  async workTerms(provider) {
    const h = harness(provider, { first: 'アリスが扉を開けた。' });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await withTerm(h, chapter.workId, 'アリス', '앨리스');
    await h.app.translate();
    await settle(h.app);
    return (
      h.sent().some((body) => body.includes('앨리스')) &&
      (await savedText(h, chapter.chapterId)).includes('앨리스')
    );
  },
  async voices(provider) {
    const h = harness(provider, { first: 'アリスが扉を開けた。' });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await h.app.saveGuidance(chapter.workId, {
      terms: [],
      voices: [{ name: 'アリス', aliases: [], instruction: VOICE }],
    });
    await h.app.translate();
    await settle(h.app);
    return h.sent().some((body) => body.includes(VOICE));
  },
  async plotSummary(provider) {
    const h = harness(provider);
    await h.connect();
    const chapter = await h.openFirstChapter();
    await h.app.saveGuidance(chapter.workId, { terms: [], voices: [], plotSummary: SUMMARY });
    await h.app.translate();
    await settle(h.app);
    return h.sent().some((body) => body.includes(SUMMARY));
  },
  async sharedTerms(provider) {
    const h = harness(provider, { first: '冒険者ギルドへ行く。' });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await h.app.translate();
    await settle(h.app);
    return (
      h.sent().some((body) => body.includes('모험가 길드')) &&
      (await savedText(h, chapter.chapterId)).includes('모험가 길드')
    );
  },
  async repair(provider) {
    const h = harness(provider);
    await h.connect();
    const chapter = await h.openFirstChapter();
    await h.app.translate();
    await settle(h.app);
    const before = h.posts.length;
    await h.app.retryParagraphs([0]);
    await settle(h.app);
    const versions = await h.store.listVersions(chapter.chapterId);
    return h.posts.length > before && versions.length === 2;
  },
  async autoRetry(provider) {
    // 용어집이 있어 두 제공자 모두 문단 단위로 요청하는 회차에서 한 문단만 일본어로 돌려준다.
    const h = harness(provider, { first: 'アリスが扉を開けた。', untranslatedOnce: true });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await withTerm(h, chapter.workId, 'アリス', '앨리스');
    h.app.changeAutoRetryFailed(true);
    await h.app.translate();
    await settle(h.app);
    const versions = await h.store.listVersions(chapter.chapterId);
    // 요청 횟수는 제공자의 문단 재시도 방식에 따라 다르다. 다시 요청해 일본어 없이 저장했는지만 본다.
    return (
      h.posts.length >= 2 &&
      versions.length === 1 &&
      versions[0]!.blocks.every((block) => /\p{Script=Hangul}/u.test(block.text)) &&
      !versions[0]!.blocks.some((block) => /まだ|번역 실패/u.test(block.text))
    );
  },
  async autoChapter(provider) {
    const h = harness(provider, { automatic: true });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await settle(h.app);
    await expect.poll(async () => (await h.store.listVersions(chapter.chapterId)).length).toBe(1);
    return true;
  },
  async titleManual(provider) {
    const h = harness(provider);
    await h.connect();
    await h.openFirstChapter();
    await h.app.translateTitles();
    await settle(h.app);
    return h.posts.length > 0 && h.app.getSnapshot().titles.length > 0;
  },
  async titleAuto(provider) {
    const h = harness(provider, { automatic: true });
    await h.connect();
    await h.openFirstChapter();
    await settle(h.app);
    return h.app.getSnapshot().titles.length > 0;
  },
  async titleGuidance(provider) {
    const h = harness(provider);
    await h.connect();
    const chapter = await h.openFirstChapter();
    await withTerm(h, chapter.workId, 'アリス', '앨리스');
    await h.app.translateTitles();
    await settle(h.app);
    return h.posts.length > 0 && h.sent().some((body) => body.includes('앨리스'));
  },
  async autoGlossary(provider) {
    const h = harness(provider);
    await h.connect();
    await h.openFirstChapter();
    h.app.changeAutoGlossary(true);
    await h.app.translate();
    await settle(h.app);
    // 번역 직전에 자동 용어집 요청이 같은 연결로 나가고, 응답과 관계없이 본문 번역을 마친다.
    return (
      h.sent().some((body) => body.includes('translation glossary')) &&
      h.app.getSnapshot().translation.phase === 'ready'
    );
  },
  async termScan(provider) {
    // 두 번 이상 나온 이름이 있는 저장본이어야 정밀스캔이 모델을 부른다.
    const h = harness(provider, { first: 'アリスとアリスが扉を開けた。' });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await h.app.translate();
    await settle(h.app);
    const before = h.posts.length;
    await h.app.startTermScan(chapter.workId);
    // 판정 요청을 보내거나, 정밀스캔이 오류·실패로 끝날 때까지 기다린다.
    await expect
      .poll(
        () =>
          h.posts.length > before ||
          h.app.getSnapshot().error !== null ||
          h.app.getSnapshot().termScan?.phase === 'failed',
      )
      .toBe(true);
    h.app.cancelTermScan();
    return h.posts.length > before;
  },
  async termFill(provider) {
    // 두 번 나온 이름이 미리 번역 후보가 되고, 채우기가 같은 연결로 판정을 요청한 뒤 끝나야 한다.
    const h = harness(provider, { first: 'アリスとアリスが扉を開けた。' });
    await h.connect();
    await h.app.openWork(workUrl);
    await h.app.prepareBatch({ first: 1, last: 2 }, false);
    if (h.app.getSnapshot().batch?.record?.scan?.status === 'pending') await h.app.scanBatch();
    const record = h.app.getSnapshot().batch?.record;
    if (record?.scan?.status !== 'review' || !record.scan.candidates.length) return false;
    const before = h.posts.length;
    await h.app.fillBatchCandidates();
    const fill = h.app.getSnapshot().batchFill;
    return h.app.getSnapshot().error === null && h.posts.length > before && fill?.phase === 'done';
  },
  async batch(provider) {
    const h = harness(provider);
    await h.connect();
    await h.app.openWork(workUrl);
    await h.app.prepareBatch({ first: 1, last: 2 }, false);
    // 일괄 번역은 후보 스캔과 확인을 거친 뒤 실행한다.
    if (h.app.getSnapshot().batch?.record?.scan?.status === 'pending') await h.app.scanBatch();
    if (h.app.getSnapshot().batch?.record?.scan?.status === 'review')
      await h.app.confirmBatchCandidates([]);
    await h.app.runBatch();
    const [first, second] = h.app.getSnapshot().work!.chapters;
    await expect
      .poll(async () =>
        Promise.all(
          [first!, second!].map(async (c) => (await h.store.listVersions(c.chapterId)).length),
        ),
      )
      .toEqual([1, 1]);
    return true;
  },
};

describe.each(PROVIDERS)('%s 제공자', (provider) => {
  it.each(Object.keys(FEATURES) as Feature[])('%s: 기능 표와 실제 동작이 같다', async (feature) => {
    // 미지원 칸도 오류 없이 끝나야 한다. 다른 이유의 실패를 미지원으로 오인하지 않는다.
    expect(await CHECKS[feature](provider)).toBe(SUPPORT[feature][provider] === 'supported');
  });
});

describe('docs/providers.md 기능 표', () => {
  it('테스트의 지원 표와 같다', () => {
    const text = readFileSync('docs/providers.md', 'utf8');
    const section = text.split('## 제공자별 기능 지원')[1]?.split('\n## ')[0] ?? '';
    const rows = section
      .split('\n')
      .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
      .map((line) =>
        line
          .slice(1, -1)
          .split('|')
          .map((cell) => cell.trim()),
      );
    const [header, ...body] = rows;
    expect(header).toEqual(['기능', ...PROVIDERS.map((id) => PROVIDER_LABELS[id])]);
    const cell = (support: Support) =>
      support === 'supported'
        ? '지원'
        : `미지원 [#${support.issue}](https://github.com/earlydreamer/jhf-novel-reader/issues/${support.issue})`;
    expect(body).toEqual(
      (Object.keys(FEATURES) as Feature[]).map((feature) => [
        FEATURES[feature],
        ...PROVIDERS.map((id) => cell(SUPPORT[feature][id])),
      ]),
    );
  });
});

describe('ChatGPT 회차 번역 저장과 실패 처리', () => {
  it('저장본에 ChatGPT 출처와 적용 용어집 해시를 남긴다', async () => {
    const h = harness('chatgpt', { first: 'アリスが扉を開けた。' });
    await h.connect();
    const chapter = await h.openFirstChapter();
    await withTerm(h, chapter.workId, 'アリス', '앨리스');
    await h.app.translate();
    await settle(h.app);
    const [version] = await h.store.listVersions(chapter.chapterId);
    expect(version?.provenance).toMatchObject({
      provider: 'chatgpt',
      modelId: 'gpt-6.1-sol',
      guidanceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(version?.text).toContain('앨리스');
    const body = h.posts[0]!.data as Record<string, unknown>;
    expect(body).toMatchObject({ store: false, stream: true });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_output_tokens');
    expect(body).not.toHaveProperty('previous_response_id');
  });

  for (const midStream of [false, true])
    it(`플랜 한도(${midStream ? '스트림 중간' : '요청 거절'})는 부분 결과를 저장하지 않고 다시 보내지 않는다`, async () => {
      const h = harness('chatgpt', {
        chatgptFailure: {
          status: 429,
          code: 'subscription_sharing_usage_limit_exceeded',
          midStream,
        },
      });
      await h.connect();
      const chapter = await h.openFirstChapter();
      h.app.changeAutoRetryFailed(true);
      await h.app.translate();
      await settle(h.app);
      expect(h.app.getSnapshot().translation).toMatchObject({
        phase: 'failed',
        error: { code: 'usage_limit' },
      });
      await expect(h.store.listVersions(chapter.chapterId)).resolves.toEqual([]);
      expect(h.posts).toHaveLength(1);
    });
});
