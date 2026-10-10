import { expect, test } from 'vitest';
import { ReaderError, type LookupTransport } from '../../src/contracts';
import type {
  CompletedTranslation,
  ProviderSession,
  SelectedModel,
} from '../../src/contracts/reading';
import type { Kanjidic } from '../../src/translation/kanjidic';
import type { ScanChapter } from '../../src/translation/termScan';
import type {
  GuidanceDraft,
  GuidanceRepository,
  GuidanceTerm,
  WorkGuidance,
} from '../../src/translation/guidance';
import type { JudgeKind } from '../../src/translation/termJudge';
import {
  applySuggestion,
  createRangeJudge,
  createTermScan,
  revertScanChange,
  type TermScanChange,
  type TermScanProgress,
} from '../../src/translation/termScanRun';

type Answer = { kind?: JudgeKind; category?: string; target: string; reason?: string };
type ProviderHooks = {
  onCall?: (call: number) => void;
  fail?: (call: number) => boolean;
  /** 요청 하나를 잡아 두는 대기. 동시에 나간 요청 수를 재는 데 쓴다. */
  wait?: (call: number) => Promise<void>;
};
type Request = { system: string; user: string; temperature?: number };

const NOW = '2026-10-03T00:00:00Z';
const selection = { modelId: 'fake-model' } as SelectedModel;

const term = (source: string, target: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source,
  target,
  aliases: [],
  category: '',
  note: '',
  ...extra,
});
const change = (
  extra: Partial<TermScanChange> & Pick<TermScanChange, 'source' | 'role' | 'after'>,
): TermScanChange => ({
  kind: 'work',
  category: '인명',
  confidence: 'high',
  reason: '',
  evidence: [],
  ...extra,
});
const workGuidance = (terms: GuidanceTerm[]): WorkGuidance => ({
  schemaVersion: 1,
  workId: 'w1',
  hash: 'h0',
  terms,
  voices: [],
});
const version = (
  createdAt: string,
  paragraphs: { text: string; ruby?: { start: number; end: number; reading: string }[] }[],
) =>
  ({
    versionId: createdAt,
    createdAt,
    source: {
      paragraphs: paragraphs.map((paragraph, index) => ({
        id: `p${index}`,
        text: paragraph.text,
        ruby: paragraph.ruby ?? [],
      })),
    },
  }) as unknown as CompletedTranslation;
const oneVersion = (text: string, ruby?: { start: number; end: number; reading: string }[]) => [
  version(NOW, [{ text, ruby }]),
];
const kanjidic = (): Kanjidic => {
  const entries: Record<string, { ko: string[]; en: string[] }> = {
    王: { ko: ['왕'], en: ['king'] },
    都: { ko: ['도'], en: ['city'] },
    美: { ko: ['미'], en: ['beautiful'] },
    濃: { ko: ['농'], en: ['thick'] },
    蝮: { ko: ['복'], en: ['viper'] },
  };
  return { version: 'test', lookup: (char) => entries[char] ?? null };
};

function fakeProvider(answers: Record<string, Answer>, hooks: ProviderHooks) {
  const requests: Request[] = [];
  const session = {
    listModels: async () => [],
    translateChapter: async () => {
      throw new Error('unused');
    },
    completeJson: async (request: Request) => {
      requests.push(request);
      const call = requests.length;
      hooks.onCall?.(call);
      await hooks.wait?.(call);
      if (hooks.fail?.(call)) throw new Error('boom');
      const items = [...request.user.matchAll(/^\[(c\d+)\] (.+)$/gm)].flatMap(([, id, source]) => {
        const answer = answers[source ?? ''];
        return answer
          ? [
              {
                id,
                kind: answer.kind ?? 'work',
                category: answer.category ?? '인명',
                target: answer.target,
                reason: answer.reason ?? `근거 ${answer.target}`,
              },
            ]
          : [];
      });
      return { items };
    },
  };
  return { session: session as unknown as ProviderSession, requests };
}

function fakeGuidance(terms: GuidanceTerm[]) {
  const state: { value: WorkGuidance | null } = { value: workGuidance(terms) };
  const saves: GuidanceDraft[] = [];
  const repository: GuidanceRepository = {
    read: async () => state.value,
    save: async (workId, draft) => {
      saves.push(draft);
      state.value = { ...draft, schemaVersion: 1, workId, hash: 'h1', voices: draft.voices };
      return state.value;
    },
  };
  return { state, saves, repository };
}

function fakeLibrary(versions: Record<string, CompletedTranslation[]>) {
  return { listVersions: async (chapterId: string) => versions[chapterId] ?? [] };
}

type Entry = {
  wiki?: string;
  wikidata?: { id: string; ko: string };
  namu?: string;
  /** 위키백과 전문 검색 1위 제목 */
  search?: string;
};
/**
 * 가짜 조회 통로. 입력(ja)별 표를 보고 응답하며, 호출은 `출처:입력` 꼴로 calls에 남긴다.
 * fail에 든 출처 접두어의 호출은 connection 오류로 던진다.
 */
function fakeLookup(
  table: Record<string, Entry>,
  options: { fail?: string[]; onCall?(call: string): void } = {},
) {
  const calls: string[] = [];
  const transport: LookupTransport = {
    get: async (url) => {
      const { hostname, searchParams } = new URL(url);
      const call =
        hostname === 'ja.wikipedia.org'
          ? searchParams.has('srsearch')
            ? `wikipedia-search:${(searchParams.get('srsearch') ?? '').replace(/"/g, '')}`
            : `wikipedia:${searchParams.get('titles')}`
          : hostname === 'namu.wiki'
            ? `namu:${searchParams.get('q')}`
            : searchParams.has('search')
              ? `wikidata:${searchParams.get('search')}`
              : `wikidata-entity:${searchParams.get('ids')}`;
      calls.push(call);
      const kind = call.slice(0, call.indexOf(':'));
      if (options.fail?.some((prefix) => kind.startsWith(prefix)))
        throw new ReaderError('connection');
      options.onCall?.(call);
      let data: unknown;
      if (kind === 'wikipedia-search') {
        const ja = (searchParams.get('srsearch') ?? '').replace(/"/g, '');
        const title = table[ja]?.search;
        data = { query: { search: title === undefined ? [] : [{ title }] } };
      } else if (kind === 'wikipedia') {
        const ja = searchParams.get('titles') ?? '';
        const ko = table[ja]?.wiki;
        data = {
          query: {
            pages: [
              ko === undefined
                ? { title: ja, missing: true }
                : { title: ja, langlinks: [{ lang: 'ko', title: ko }] },
            ],
          },
        };
      } else if (kind === 'namu') {
        const ja = searchParams.get('q') ?? '';
        const ko = table[ja]?.namu;
        data = ko === undefined ? '<p>검색 결과가 없습니다</p>' : `<p>${ko} (${ja})</p>`;
      } else if (kind === 'wikidata') {
        const ja = searchParams.get('search') ?? '';
        const entry = table[ja]?.wikidata;
        data = { search: entry ? [{ id: entry.id, label: ja }] : [] };
      } else {
        const id = searchParams.get('ids') ?? '';
        const ko = Object.values(table).find((item) => item.wikidata?.id === id)?.wikidata?.ko;
        data = { entities: { [id]: { labels: { ko: { value: ko ?? '' } } } } };
      }
      return { status: 200, headers: {}, data, url };
    },
  };
  return { transport, calls };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * fakeLookup을 감싼다. manual이면 각 호출이 release()로 풀릴 때까지 기다리고, 아니면 잠깐 뒤에 응답한다.
 * stats.peak는 동시에 나간 조회 호출의 최대 수다.
 */
function trackedLookup(table: Record<string, Entry>, options: { manual?: boolean } = {}) {
  const inner = fakeLookup(table);
  const gates: (() => void)[] = [];
  const stats = { active: 0, peak: 0 };
  const transport: LookupTransport = {
    get: async (url, responseType, signal) => {
      stats.active += 1;
      stats.peak = Math.max(stats.peak, stats.active);
      try {
        if (options.manual) await new Promise<void>((resolve) => gates.push(resolve));
        else await settle();
        return await inner.transport.get(url, responseType, signal);
      } finally {
        stats.active -= 1;
      }
    },
  };
  const release = () => gates.shift()?.();
  return { transport, calls: inner.calls, gates, release, stats };
}
type TrackedLookup = ReturnType<typeof trackedLookup>;

/** 후보 아홉 개. 묶음은 8개와 1개로 나뉘고, 조회는 위키백과 정확 연결 한 번으로 끝난다. */
const NINE_NAMES = [
  'アルフ',
  'ベルナ',
  'カルロ',
  'ダリア',
  'エルザ',
  'フレイ',
  'ゴルド',
  'ハンナ',
  'イリス',
];
const NINE_TEXT = NINE_NAMES.map((name) => `${name}が${name}に会う。`).join('');
const NINE_TABLE: Record<string, Entry> = Object.fromEntries(
  NINE_NAMES.map((name): [string, Entry] => [name, { wiki: `${name}-위키` }]),
);
const NINE_ANSWERS: Record<string, Answer> = Object.fromEntries(
  NINE_NAMES.map((name): [string, Answer] => [name, { target: '이름' }]),
);

/** 풀려 있는 조회 호출을 하나씩 풀고, 더 기다리는 호출이 없을 때까지 돈다. */
async function releaseEach(lookup: TrackedLookup) {
  while (lookup.gates.length) {
    lookup.release();
    await settle();
  }
}

const LOOKUP_TABLE: Record<string, Entry> = {
  カミラ: { wiki: '카미라', wikidata: { id: 'Q1', ko: '카미라-위키데이터' }, namu: '카미라' },
  ハンナ: { wikidata: { id: 'Q2', ko: '한나' } },
};

const EPITHET_TABLE: Record<string, Entry> = {
  ...LOOKUP_TABLE,
  美濃の蝮: { search: '斎藤道三' },
  斎藤道三: { wiki: '사이토 도산' },
  王都: { search: '斎藤道三' },
};
const EPITHET_TEXT = '美濃の蝮が笑う。美濃の蝮は去った。';
const EPITHET_RUBY = [{ start: 0, end: 4, reading: 'みののまむし' }];

function harness(input: {
  versions: Record<string, CompletedTranslation[]>;
  terms?: GuidanceTerm[];
  answers?: Record<string, Answer>;
  loadKanjidic?: () => Promise<Kanjidic>;
  lookup?: { transport: LookupTransport };
}) {
  const hooks: ProviderHooks = {};
  const provider = fakeProvider(input.answers ?? {}, hooks);
  const guidance = fakeGuidance(input.terms ?? []);
  const scan = createTermScan({
    createProvider: () => provider.session,
    guidance: guidance.repository,
    library: fakeLibrary(input.versions),
    loadKanjidic: input.loadKanjidic ?? (async () => kanjidic()),
    ...(input.lookup ? { lookup: input.lookup.transport } : {}),
  });
  return { hooks, scan, requests: provider.requests, ...guidance };
}
type Harness = ReturnType<typeof harness>;

const run = (
  h: Harness,
  chapterIds = ['c1'],
  onProgress?: (progress: TermScanProgress) => void,
  signal = new AbortController().signal,
  sources?: { wikipedia?: boolean; namuwiki?: boolean },
) => h.scan({ workId: 'w1', chapterIds, selection, signal, onProgress, sources });

test('최신 저장본의 원문만 쓰고 저장본이 없는 회차는 건너뛴다', async () => {
  const h = harness({
    versions: {
      c1: [
        version('2026-10-01T00:00:00Z', [{ text: 'アルベルトが笑う。アルベルトは去った。' }]),
        version(NOW, [{ text: 'カミラが笑う。カミラは去った。' }]),
      ],
      c2: [],
    },
    answers: { カミラ: { target: '카미라' } },
  });
  const result = await run(h, ['c1', 'c2']);
  const users = h.requests.map((request) => request.user).join('\n');
  expect(users).toContain('カミラ');
  expect(users).not.toContain('アルベルト');
  expect(result.applied.map((item) => item.source)).toEqual(['カミラ']);
});

test('후보를 8개씩 묶고 묶음마다 3회 요청하며 온도는 0, 0.7, 0.7이다', async () => {
  const names = [
    'アルフ',
    'ベルナ',
    'カルロ',
    'ダリア',
    'エルザ',
    'フレイ',
    'ゴルド',
    'ハンナ',
    'イリス',
  ];
  const h = harness({
    versions: { c1: oneVersion(names.map((name) => `${name}が${name}に会う。`).join('')) },
  });
  const progress: TermScanProgress[] = [];
  await run(h, ['c1'], (item) => progress.push(item));
  expect(h.requests.map((request) => request.temperature)).toEqual([0, 0.7, 0.7, 0, 0.7, 0.7]);
  expect(h.requests.map((request) => (request.user.match(/^\[c\d+\]/gm) ?? []).length)).toEqual([
    8, 8, 8, 1, 1, 1,
  ]);
  expect(progress.filter((item) => item.stage === 'judge').map((item) => item.total)).toEqual([
    6, 6, 6, 6, 6, 6,
  ]);
});

test('새 항목은 origin scan과 ruby·kanjidic·model 근거를 가지며 common은 추가하지 않는다', async () => {
  const h = harness({
    versions: {
      c1: [
        version(NOW, [
          { text: '王都へ行く。', ruby: [{ start: 0, end: 2, reading: 'おうと' }] },
          { text: 'ハンナが笑う。ハンナは去った。' },
        ]),
      ],
    },
    answers: {
      王都: { kind: 'real', category: '지명', target: '왕도', reason: '왕도 표기' },
      ハンナ: { kind: 'common', category: '기타', target: '한나', reason: '일반 명사' },
    },
  });
  const result = await run(h);
  const evidence = [
    { kind: 'ruby', note: '루비: おうと' },
    { kind: 'kanjidic', note: '王=왕 都=도' },
    { kind: 'model', note: '판정 3/3 · 왕도 표기' },
  ];
  expect(result.applied).toEqual([
    {
      source: '王都',
      role: 'new',
      after: '왕도',
      kind: 'real',
      category: '지명',
      confidence: 'high',
      reason: '왕도 표기',
      evidence,
    },
  ]);
  expect(h.saves).toHaveLength(1);
  expect(h.saves[0]!.terms).toEqual([
    {
      source: '王都',
      target: '왕도',
      aliases: [],
      category: '지명',
      note: '',
      origin: 'scan',
      evidence,
    },
  ]);
});

test('사전을 불러오지 못해도 kanjidic 근거 없이 계속한다', async () => {
  const h = harness({
    versions: {
      c1: oneVersion('王都へ行く。', [{ start: 0, end: 2, reading: 'おうと' }]),
    },
    answers: { 王都: { kind: 'real', category: '지명', target: '왕도' } },
    loadKanjidic: async () => {
      throw new Error('missing');
    },
  });
  const result = await run(h);
  expect(result.applied[0]?.evidence.map((item) => item.kind)).toEqual(['ruby', 'model']);
});

test('recheck는 표기가 바뀌면 교체하고, 같으면 근거만 붙이며, 사람 항목은 제안으로만 남긴다', async () => {
  const h = harness({
    terms: [
      term('カミラ', '카밀라', { aliases: ['カミラ姫'], note: '메모', origin: 'model' }),
      term('ダリア', '다리아', { origin: 'auto' }),
      term('エルザ', '엘자'),
    ],
    versions: {
      c1: oneVersion(
        'カミラが笑う。カミラは去った。ダリアが来た。ダリアは帰った。エルザが立つ。エルザは座る。',
      ),
    },
    answers: {
      カミラ: { target: '카미라', reason: '근거 카미라' },
      ダリア: { target: '다리아', reason: '근거 다리아' },
      エルザ: { target: '엘사', reason: '근거 엘사' },
    },
  });
  const result = await run(h);
  expect(result.applied.map((item) => [item.source, item.role, item.before, item.after])).toEqual([
    ['カミラ', 'recheck', '카밀라', '카미라'],
  ]);
  expect(result.confirmed).toBe(1);
  expect(
    result.suggestions.map((item) => [item.source, item.role, item.before, item.after]),
  ).toEqual([['エルザ', 'suggest', '엘자', '엘사']]);
  expect(result.partial).toBe(false);
  const saved = h.saves[0]!.terms;
  expect(saved.find((item) => item.source === 'カミラ')).toEqual({
    source: 'カミラ',
    target: '카미라',
    aliases: ['カミラ姫'],
    category: '인명',
    note: '메모',
    origin: 'scan',
    evidence: [{ kind: 'model', note: '판정 3/3 · 근거 카미라' }],
  });
  expect(saved.find((item) => item.source === 'ダリア')).toMatchObject({
    target: '다리아',
    origin: 'scan',
    evidence: [{ kind: 'model', note: '판정 3/3 · 근거 다리아' }],
  });
  expect(saved.find((item) => item.source === 'エルザ')).toEqual(term('エルザ', '엘자'));
});

test('저장 직전에 사람이 고친 기계 항목은 덮어쓰지 않고 제안으로 옮긴다', async () => {
  const h = harness({
    terms: [term('カミラ', '카밀라', { origin: 'model' })],
    versions: { c1: oneVersion('カミラが笑う。カミラは去った。') },
    answers: { カミラ: { target: '카미라' } },
  });
  h.hooks.onCall = (call) => {
    if (call === 1) h.state.value = workGuidance([term('カミラ', '카밀라-사람')]);
  };
  const result = await run(h);
  expect(result.applied).toEqual([]);
  expect(
    result.suggestions.map((item) => [item.source, item.role, item.before, item.after]),
  ).toEqual([['カミラ', 'suggest', '카밀라-사람', '카미라']]);
  expect(h.saves).toEqual([]);
});

test('저장 직전에 같은 이름의 사람 항목이 생기면 새 항목을 추가하지 않는다', async () => {
  const h = harness({
    versions: { c1: oneVersion('ゴルドが笑う。ゴルドは去った。') },
    answers: { ゴルド: { target: '고르드' } },
  });
  h.hooks.onCall = (call) => {
    if (call === 1) h.state.value = workGuidance([term('ゴルド', '골드')]);
  };
  const result = await run(h);
  expect(result.applied).toEqual([]);
  expect(result.suggestions).toEqual([]);
  expect(h.saves).toEqual([]);
});

test('요청 하나가 실패하면 partial이 되고 나머지 판정으로 계속한다', async () => {
  const h = harness({
    versions: { c1: oneVersion('ルークが笑う。ルークは去った。') },
    answers: { ルーク: { target: '루크' } },
  });
  h.hooks.fail = (call) => call === 2;
  const result = await run(h);
  expect(h.requests).toHaveLength(3);
  expect(result.partial).toBe(true);
  expect(result.applied).toMatchObject([
    {
      source: 'ルーク',
      role: 'new',
      after: '루크',
      confidence: 'medium',
      evidence: [{ kind: 'model', note: '판정 2/3 · 근거 루크' }],
    },
  ]);
});

test('취소되면 cancelled로 끝나고 저장하지 않는다', async () => {
  const controller = new AbortController();
  const h = harness({
    versions: { c1: oneVersion('カミラが笑う。カミラは去った。') },
    answers: { カミラ: { target: '카미라' } },
  });
  h.hooks.onCall = (call) => {
    if (call === 2) controller.abort();
  };
  const error = await run(h, ['c1'], undefined, controller.signal).catch((item: unknown) => item);
  expect(error).toBeInstanceOf(ReaderError);
  expect((error as ReaderError).code).toBe('cancelled');
  expect(h.saves).toEqual([]);
});

test('가나 불일치 변경은 confidence를 low로 내리고 low가 먼저 정렬된다', async () => {
  const h = harness({
    versions: {
      c1: oneVersion('ルークが笑う。ルークは去った。ルークが来た。カミラが笑う。カミラは去った。'),
    },
    answers: { ルーク: { target: '루크' }, カミラ: { target: '소피아' } },
  });
  const result = await run(h);
  expect(result.applied.map((item) => [item.source, item.confidence, item.kanaFlag])).toEqual([
    ['カミラ', 'low', true],
    ['ルーク', 'high', false],
  ]);
});

test('진행 단계는 수집, 판정, 저장 순서로 보고된다', async () => {
  const progress: TermScanProgress[] = [];
  const h = harness({
    versions: {
      c1: oneVersion('カミラが笑う。'),
      c2: oneVersion('カミラは去った。'),
    },
    answers: { カミラ: { target: '카미라' } },
  });
  await run(h, ['c1', 'c2'], (item) => progress.push(item));
  expect(progress).toEqual([
    { stage: 'collect', done: 1, total: 2 },
    { stage: 'collect', done: 2, total: 2 },
    { stage: 'judge', done: 1, total: 3 },
    { stage: 'judge', done: 2, total: 3 },
    { stage: 'judge', done: 3, total: 3 },
    { stage: 'save', done: 1, total: 1 },
  ]);
});

test('후보가 없으면 판정 요청과 저장 없이 빈 결과와 0 집계를 낸다', async () => {
  const h = harness({ versions: { c1: oneVersion('ただの文章です。') } });
  const result = await run(h);
  expect(result).toEqual({
    applied: [],
    confirmed: 0,
    suggestions: [],
    partial: false,
    counts: { candidates: 0, common: 0, unchanged: 0, unanswered: 0 },
  });
  expect(h.requests).toEqual([]);
  expect(h.saves).toEqual([]);
});

test('살펴본 이름을 일반어·답 없음·같은 표기·바뀐 용어로 나눠 센다', async () => {
  const h = harness({
    terms: [term('エルザ', '엘자'), term('カミラ', '카밀라', { origin: 'model' })],
    versions: {
      c1: oneVersion(
        'ハンナが笑う。ハンナは去った。ルークが笑う。ルークは去った。エルザが立つ。エルザは座る。カミラが笑う。カミラは去った。',
      ),
    },
    answers: {
      ハンナ: { kind: 'common', category: '기타', target: '한나' },
      エルザ: { target: '엘자' },
      カミラ: { target: '카미라' },
    },
  });
  const result = await run(h);
  expect(result.counts).toEqual({ candidates: 4, common: 1, unchanged: 1, unanswered: 1 });
  expect(result.applied.map((item) => item.source)).toEqual(['カミラ']);
  expect(result.suggestions).toEqual([]);
});

test('저장 직전에 같은 이름이 생겨 건너뛴 새 후보는 같은 표기로 센다', async () => {
  const h = harness({
    versions: { c1: oneVersion('ゴルドが笑う。ゴルドは去った。') },
    answers: { ゴルド: { target: '고르드' } },
  });
  h.hooks.onCall = (call) => {
    if (call === 1) h.state.value = workGuidance([term('ゴルド', '골드')]);
  };
  const result = await run(h);
  expect(result.counts).toEqual({ candidates: 1, common: 0, unchanged: 1, unanswered: 0 });
});

test('completeJson이 없는 제공자는 model_missing으로 거부한다', async () => {
  const scan = createTermScan({
    createProvider: () =>
      ({
        listModels: async () => [],
        translateChapter: async () => {
          throw new Error('unused');
        },
      }) as unknown as ProviderSession,
    guidance: fakeGuidance([]).repository,
    library: fakeLibrary({ c1: oneVersion('カミラが笑う。カミラは去った。') }),
    loadKanjidic: async () => kanjidic(),
  });
  const error = await scan({
    workId: 'w1',
    chapterIds: ['c1'],
    selection,
    signal: new AbortController().signal,
  }).catch((item: unknown) => item);
  expect((error as ReaderError).code).toBe('model_missing');
});

test('되돌리기: 새로 추가한 기계 항목은 제거하고 사람이 고친 항목은 건드리지 않는다', () => {
  const human = term('ミナ', '미나');
  const added = term('カミラ', '카미라', {
    origin: 'scan',
    evidence: [{ kind: 'model', note: 'n' }],
  });
  const addedChange = change({ source: 'カミラ', role: 'new', after: '카미라' });
  expect(revertScanChange([human, added], addedChange, undefined)).toEqual([human]);
  const edited = term('カミラ', '카미라-사람');
  expect(revertScanChange([edited], addedChange, undefined)).toEqual([edited]);
});

test('되돌리기: 표기를 바꾼 기계 항목은 원래 항목으로 돌아간다', () => {
  const original = term('カミラ', '카밀라', { origin: 'model', aliases: ['カミラ姫'] });
  const current = term('カミラ', '카미라', {
    origin: 'scan',
    evidence: [{ kind: 'model', note: 'n' }],
  });
  const recheck = change({ source: 'カミラ', role: 'recheck', before: '카밀라', after: '카미라' });
  expect(revertScanChange([current], recheck, original)).toEqual([original]);
});

test('제안 적용: 사람 항목은 표기만 바꾸고 나머지와 다른 항목은 그대로 둔다', () => {
  const other = term('ミナ', '미나', { origin: 'model' });
  const human = term('エルザ', '엘자', { note: '메모', aliases: ['エルザ様'] });
  const suggestion = change({ source: 'エルザ', role: 'suggest', before: '엘자', after: '엘사' });
  expect(applySuggestion([other, human], suggestion)).toEqual([
    other,
    { ...human, target: '엘사' },
  ]);
  expect(applySuggestion([other, human], suggestion)[1]!.origin).toBeUndefined();
});

test('제안 적용: 정밀스캔 항목에 적용하면 표기만 바뀌고 사람 항목이 된다', () => {
  const scanned = term('ルーク', '루크-이전', {
    origin: 'scan',
    aliases: ['ルーク君'],
    note: '메모',
    evidence: [{ kind: 'model', note: '근거' }],
  });
  const suggestion = change({
    source: 'ルーク',
    role: 'suggest',
    before: '루크-이전',
    after: '루크',
  });
  const [result] = applySuggestion([scanned], suggestion);
  expect(result).toEqual({
    source: 'ルーク',
    target: '루크',
    aliases: ['ルーク君'],
    category: '',
    note: '메모',
  });
  expect(result).not.toHaveProperty('origin');
  expect(result).not.toHaveProperty('evidence');
});

test('기존 정밀스캔 항목은 신뢰도 높음일 때만 바꾸고, 그 밖에는 제안으로 남긴다', async () => {
  const scanned = term('ルーク', '루크-이전', {
    origin: 'scan',
    evidence: [{ kind: 'model', note: '근거' }],
  });
  const text = 'ルークが笑う。ルークは去った。';
  const medium = harness({
    terms: [scanned],
    versions: { c1: oneVersion(text) },
    answers: { ルーク: { target: '루크' } },
  });
  medium.hooks.fail = (call) => call === 2;
  const mediumResult = await run(medium);
  expect(mediumResult.applied).toEqual([]);
  expect(mediumResult.suggestions).toMatchObject([
    { source: 'ルーク', role: 'suggest', before: '루크-이전', after: '루크', confidence: 'medium' },
  ]);
  expect(medium.saves).toEqual([]);

  const high = harness({
    terms: [scanned],
    versions: { c1: oneVersion(text) },
    answers: { ルーク: { target: '루크' } },
  });
  const highResult = await run(high);
  expect(highResult.applied.map((item) => [item.source, item.confidence])).toEqual([
    ['ルーク', 'high'],
  ]);
  expect(high.saves[0]!.terms[0]).toMatchObject({
    source: 'ルーク',
    target: '루크',
    origin: 'scan',
  });
});

const KATAKANA_TEXT = 'カミラが笑う。カミラは去った。ハンナが笑う。ハンナは去った。';

test('출처를 끄거나 조회 통로가 없으면 조회하지 않고 진행 단계에 lookup이 없다', async () => {
  const text = 'カミラが笑う。カミラは去った。';
  const answers = { カミラ: { target: '카미라' } };
  const off = fakeLookup(LOOKUP_TABLE);
  const none = harness({ versions: { c1: oneVersion(text) }, answers, lookup: off });
  const noneProgress: TermScanProgress[] = [];
  await run(none, ['c1'], (item) => noneProgress.push(item));
  const disabled = harness({ versions: { c1: oneVersion(text) }, answers, lookup: off });
  const disabledProgress: TermScanProgress[] = [];
  await run(disabled, ['c1'], (item) => disabledProgress.push(item), undefined, {
    wikipedia: false,
    namuwiki: false,
  });
  const noPort = harness({ versions: { c1: oneVersion(text) }, answers });
  const noPortProgress: TermScanProgress[] = [];
  await run(noPort, ['c1'], (item) => noPortProgress.push(item), undefined, {
    wikipedia: true,
    namuwiki: true,
  });

  expect(off.calls).toEqual([]);
  for (const progress of [noneProgress, disabledProgress, noPortProgress]) {
    expect(progress.map((item) => item.stage)).toEqual([
      'collect',
      'judge',
      'judge',
      'judge',
      'save',
    ]);
  }
  expect(none.requests[0]!.user).not.toContain('lookup:');
  expect(none.requests[0]!.system).not.toContain('Lookup lines come from');
});

test('위키백과만 켜면 위키백과 표기가 있을 때 위키데이터를 묻지 않고, 없을 때만 묻는다', async () => {
  const lookup = fakeLookup(LOOKUP_TABLE);
  const h = harness({
    versions: { c1: oneVersion(KATAKANA_TEXT) },
    answers: { カミラ: { target: '카미라' }, ハンナ: { target: '한나' } },
    lookup,
  });
  const result = await run(h, ['c1'], undefined, undefined, { wikipedia: true });
  expect(lookup.calls).toEqual(
    expect.arrayContaining(['wikipedia:カミラ', 'wikipedia:ハンナ', 'wikidata:ハンナ']),
  );
  expect(lookup.calls).not.toContain('wikidata:カミラ');
  expect(lookup.calls.some((call) => call.startsWith('namu'))).toBe(false);
  expect(result).not.toHaveProperty('lookupFailed');
});

test('나무위키만 켜면 나무위키만 묻는다', async () => {
  const lookup = fakeLookup(LOOKUP_TABLE);
  const h = harness({
    versions: { c1: oneVersion(KATAKANA_TEXT) },
    answers: { カミラ: { target: '카미라' }, ハンナ: { target: '한나' } },
    lookup,
  });
  await run(h, ['c1'], undefined, undefined, { namuwiki: true });
  expect([...lookup.calls].sort()).toEqual(['namu:カミラ', 'namu:ハンナ']);
});

test('판정 요청에는 조회 줄과 고정 문장이 들어간다', async () => {
  const h = harness({
    versions: { c1: oneVersion('カミラが笑う。カミラは去った。') },
    answers: { カミラ: { target: '카미라' } },
    lookup: fakeLookup(LOOKUP_TABLE),
  });
  await run(h, ['c1'], undefined, undefined, { wikipedia: true });
  expect(h.requests[0]!.user).toContain('lookup: 카미라 (wikipedia, exact link)');
  expect(h.requests[0]!.system).toContain('Lookup lines come from Korean Wikipedia');
});

test('새 항목 근거에는 조회 hit의 kind·url·note가 model 앞에 들어가고 6개를 넘지 않는다', async () => {
  const h = harness({
    versions: {
      c1: [
        version(NOW, [
          { text: 'カミラが笑う。', ruby: [{ start: 0, end: 3, reading: 'かみら' }] },
          { text: 'カミラは去った。' },
        ]),
      ],
    },
    answers: {
      カミラ: { kind: 'work', category: '인명', target: '카미라', reason: '카미라 표기' },
    },
    lookup: fakeLookup(LOOKUP_TABLE),
  });
  const result = await run(h, ['c1'], undefined, undefined, { wikipedia: true, namuwiki: true });
  const evidence = result.applied[0]!.evidence;
  expect(evidence).toEqual([
    { kind: 'ruby', note: '루비: かみら' },
    {
      kind: 'wikipedia',
      url: `https://ko.wikipedia.org/wiki/${encodeURIComponent('카미라')}`,
      note: '위키백과: カミラ → 카미라',
    },
    {
      kind: 'namuwiki',
      url: `https://namu.wiki/Search?q=${encodeURIComponent('カミラ')}`,
      note: '나무위키(CC BY-NC-SA 2.0 KR) 검색: 카미라 (カミラ) 1회',
    },
    { kind: 'model', note: '판정 3/3 · 카미라 표기' },
  ]);
  expect(evidence.length).toBeLessThanOrEqual(6);
});

test('표기가 위키백과 정확 연결과 다르면 confidence를 low로 내리고, 위키데이터 hit는 신뢰도를 바꾸지 않는다', async () => {
  const h = harness({
    versions: { c1: oneVersion(KATAKANA_TEXT) },
    answers: { カミラ: { target: '카밀라' }, ハンナ: { target: '하나' } },
    lookup: fakeLookup(LOOKUP_TABLE),
  });
  const result = await run(h, ['c1'], undefined, undefined, { wikipedia: true });
  expect(result.applied.map((item) => [item.source, item.confidence, item.kanaFlag])).toEqual([
    ['カミラ', 'low', false],
    ['ハンナ', 'high', false],
  ]);
});

test('한 출처가 오류나면 lookupFailed에 넣고 그 출처는 더 묻지 않으며 판정은 계속한다', async () => {
  const lookup = fakeLookup(LOOKUP_TABLE, { fail: ['wikipedia'] });
  const h = harness({
    versions: { c1: oneVersion(KATAKANA_TEXT) },
    answers: { カミラ: { target: '카미라' }, ハンナ: { target: '한나' } },
    lookup,
  });
  const result = await run(h, ['c1'], undefined, undefined, { wikipedia: true, namuwiki: true });
  expect(result.lookupFailed).toEqual(['wikipedia']);
  expect(lookup.calls.filter((call) => call.startsWith('wikipedia'))).toHaveLength(1);
  expect(lookup.calls.some((call) => call.startsWith('wikidata'))).toBe(false);
  expect(lookup.calls.filter((call) => call.startsWith('namu'))).toHaveLength(2);
  expect(h.requests).toHaveLength(3);
  expect(result.partial).toBe(false);
  expect(result.applied.map((item) => item.source)).toEqual(['カミラ', 'ハンナ']);
});

test('조회 중 취소되면 cancelled로 끝나고 판정과 저장을 하지 않는다', async () => {
  const controller = new AbortController();
  const h = harness({
    versions: { c1: oneVersion('カミラが笑う。カミラは去った。') },
    answers: { カミラ: { target: '카미라' } },
    lookup: fakeLookup(LOOKUP_TABLE, { onCall: () => controller.abort() }),
  });
  const error = await run(h, ['c1'], undefined, controller.signal, { wikipedia: true }).catch(
    (item: unknown) => item,
  );
  expect(error).toBeInstanceOf(ReaderError);
  expect((error as ReaderError).code).toBe('cancelled');
  expect(h.requests).toEqual([]);
  expect(h.saves).toEqual([]);
});

test('진행 단계는 수집, 조회, 판정, 저장 순서이고 조회는 후보마다 한 번씩 보고된다', async () => {
  const progress: TermScanProgress[] = [];
  const h = harness({
    versions: { c1: oneVersion(KATAKANA_TEXT) },
    answers: { カミラ: { target: '카미라' }, ハンナ: { target: '한나' } },
    lookup: fakeLookup(LOOKUP_TABLE),
  });
  await run(h, ['c1'], (item) => progress.push(item), undefined, { wikipedia: true });
  expect(progress).toEqual([
    { stage: 'collect', done: 1, total: 1 },
    { stage: 'lookup', done: 1, total: 2 },
    { stage: 'lookup', done: 2, total: 2 },
    { stage: 'judge', done: 1, total: 3 },
    { stage: 'judge', done: 2, total: 3 },
    { stage: 'judge', done: 3, total: 3 },
    { stage: 'save', done: 1, total: 1 },
  ]);
});

test('첫 묶음 조회가 끝나면 둘째 묶음 조회를 기다리지 않고 첫 묶음을 판정한다', async () => {
  const lookup = trackedLookup(NINE_TABLE, { manual: true });
  const h = harness({ versions: { c1: oneVersion(NINE_TEXT) }, answers: NINE_ANSWERS, lookup });
  const finished = run(h, ['c1'], undefined, undefined, { wikipedia: true });
  await settle();
  for (let index = 0; index < 8; index += 1) {
    lookup.release();
    await settle();
  }
  // 첫 묶음 8개 조회가 끝났고, 둘째 묶음(1개) 조회는 아직 대기 중이다.
  expect(lookup.calls).toHaveLength(8);
  expect(lookup.gates).toHaveLength(1);
  expect(h.requests).toHaveLength(3);
  for (const call of lookup.calls) {
    expect(h.requests[0]!.user).toContain(
      `lookup: ${call.slice('wikipedia:'.length)}-위키 (wikipedia, exact link)`,
    );
  }
  await releaseEach(lookup);
  const result = await finished;
  expect(result.applied).toHaveLength(NINE_NAMES.length);
  expect(lookup.stats.peak).toBe(1);
});

test('판정이 조회와 겹치면 판정 진행에 외부 사전 진행을 붙이고, 조회가 끝나면 그 줄을 뺀다', async () => {
  const lookup = trackedLookup(NINE_TABLE, { manual: true });
  const h = harness({ versions: { c1: oneVersion(NINE_TEXT) }, answers: NINE_ANSWERS, lookup });
  const progress: TermScanProgress[] = [];
  const finished = run(h, ['c1'], (item) => progress.push(item), undefined, { wikipedia: true });
  await settle();
  for (let index = 0; index < 8; index += 1) {
    lookup.release();
    await settle();
  }
  await releaseEach(lookup);
  await finished;
  const lookupSteps = Array.from({ length: 8 }, (_, index) => ({
    stage: 'lookup',
    done: index + 1,
    total: 9,
  }));
  expect(progress).toEqual([
    { stage: 'collect', done: 1, total: 1 },
    ...lookupSteps,
    { stage: 'judge', done: 1, total: 6, lookup: { done: 8, total: 9 } },
    { stage: 'judge', done: 2, total: 6, lookup: { done: 8, total: 9 } },
    { stage: 'judge', done: 3, total: 6, lookup: { done: 8, total: 9 } },
    { stage: 'judge', done: 3, total: 6 },
    { stage: 'judge', done: 4, total: 6 },
    { stage: 'judge', done: 5, total: 6 },
    { stage: 'judge', done: 6, total: 6 },
    { stage: 'save', done: 1, total: 1 },
  ]);
});

test('모델 요청과 외부 조회 요청은 동시에 두 개 이상 나가지 않는다', async () => {
  const lookup = trackedLookup(NINE_TABLE);
  const h = harness({ versions: { c1: oneVersion(NINE_TEXT) }, answers: NINE_ANSWERS, lookup });
  let modelActive = 0;
  let modelPeak = 0;
  h.hooks.wait = async () => {
    modelActive += 1;
    modelPeak = Math.max(modelPeak, modelActive);
    await settle();
    modelActive -= 1;
  };
  await run(h, ['c1'], undefined, undefined, { wikipedia: true });
  expect(modelPeak).toBe(1);
  expect(lookup.stats.peak).toBe(1);
  expect(lookup.calls).toHaveLength(NINE_NAMES.length);
  expect(h.requests).toHaveLength(6);
});

test('판정 중 취소되면 cancelled로 끝나고 저장하지 않으며, 뒤의 조회 거부는 처리되지 않은 채 남지 않는다', async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    const controller = new AbortController();
    const lookup = trackedLookup(NINE_TABLE, { manual: true });
    const h = harness({ versions: { c1: oneVersion(NINE_TEXT) }, answers: NINE_ANSWERS, lookup });
    h.hooks.onCall = (call) => {
      if (call === 2) controller.abort();
    };
    const finished = run(h, ['c1'], undefined, controller.signal, { wikipedia: true }).catch(
      (item: unknown) => item,
    );
    await settle();
    for (let index = 0; index < 8; index += 1) {
      lookup.release();
      await settle();
    }
    const error = await finished;
    expect(error).toBeInstanceOf(ReaderError);
    expect((error as ReaderError).code).toBe('cancelled');
    expect(h.saves).toEqual([]);
    // 취소 뒤에 둘째 묶음 조회를 풀면 그 조회는 취소로 거부된다. 그 거부도 처리되어야 한다.
    await releaseEach(lookup);
    await settle();
    expect(unhandled).toEqual([]);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('별명 후보는 위키백과·위키데이터가 없으면 위키백과 검색으로 대상을 찾고, 판정 요청에 refers 줄을 넣는다', async () => {
  const lookup = fakeLookup(EPITHET_TABLE);
  const h = harness({
    versions: { c1: oneVersion(EPITHET_TEXT, EPITHET_RUBY) },
    answers: { 美濃の蝮: { kind: 'work', category: '별명', target: '미노의 살무사' } },
    lookup,
  });
  const result = await run(h, ['c1'], undefined, undefined, { wikipedia: true });
  expect(lookup.calls).toContain('wikipedia-search:美濃の蝮');
  expect(lookup.calls).toContain('wikipedia:斎藤道三');
  expect(h.requests[0]!.user).toContain('lookup: refers to 사이토 도산 (wikipedia search)');
  expect(result.applied.map((item) => [item.source, item.after, item.confidence])).toEqual([
    ['美濃の蝮', '미노의 살무사', 'high'],
  ]);
});

test('별명이 아닌 후보는 위키백과 검색으로 부르지 않는다', async () => {
  const lookup = fakeLookup(EPITHET_TABLE);
  const h = harness({
    versions: {
      c1: oneVersion('王都へ行く。王都は遠い。', [{ start: 0, end: 2, reading: 'おうと' }]),
    },
    answers: { 王都: { target: '왕도' } },
    lookup,
  });
  await run(h, ['c1'], undefined, undefined, { wikipedia: true });
  expect(lookup.calls).toContain('wikipedia:王都');
  expect(lookup.calls.some((call) => call.startsWith('wikipedia-search'))).toBe(false);
});

test('위키백과 출처가 꺼져 있으면 별명이어도 위키백과 검색으로 부르지 않는다', async () => {
  const lookup = fakeLookup(EPITHET_TABLE);
  const h = harness({
    versions: { c1: oneVersion(EPITHET_TEXT, EPITHET_RUBY) },
    answers: { 美濃の蝮: { kind: 'work', category: '별명', target: '미노의 살무사' } },
    lookup,
  });
  await run(h, ['c1'], undefined, undefined, { namuwiki: true });
  expect(lookup.calls.some((call) => call.startsWith('wikipedia'))).toBe(false);
});

test('음독 의심 별명(蝮=복, 미노의 복)은 low로 내리고, 뜻 번역(미노의 살무사)은 투표 신뢰도를 그대로 쓴다', async () => {
  const sound = harness({
    versions: { c1: oneVersion(EPITHET_TEXT, EPITHET_RUBY) },
    answers: { 美濃の蝮: { kind: 'work', category: '별명', target: '미노의 복' } },
  });
  const soundResult = await run(sound);
  expect(soundResult.applied.map((item) => [item.source, item.confidence])).toEqual([
    ['美濃の蝮', 'low'],
  ]);

  const meaning = harness({
    versions: { c1: oneVersion(EPITHET_TEXT, EPITHET_RUBY) },
    answers: { 美濃の蝮: { kind: 'work', category: '별명', target: '미노의 살무사' } },
  });
  const meaningResult = await run(meaning);
  expect(meaningResult.applied.map((item) => [item.source, item.confidence])).toEqual([
    ['美濃の蝮', 'high'],
  ]);
});

test('별명이 아닌 후보는 마지막 어절이 한자음과 같아도 음독 규칙을 적용하지 않는다', async () => {
  const h = harness({
    versions: {
      c1: oneVersion('王都へ行く。王都は遠い。', [{ start: 0, end: 2, reading: 'おうと' }]),
    },
    answers: { 王都: { target: '왕 도' } },
  });
  const result = await run(h);
  expect(result.applied.map((item) => [item.source, item.confidence])).toEqual([['王都', 'high']]);
});

const scanChapter = (chapterId: string, text: string): ScanChapter => ({
  chapterId,
  paragraphs: [{ text, ruby: [] }],
});

function rangeHarness(input: {
  terms?: GuidanceTerm[];
  answers?: Record<string, Answer>;
  lookup?: { transport: LookupTransport };
}) {
  const hooks: ProviderHooks = {};
  const provider = fakeProvider(input.answers ?? {}, hooks);
  const guidance = fakeGuidance(input.terms ?? []);
  const judge = createRangeJudge({
    createProvider: () => provider.session,
    guidance: guidance.repository,
    loadKanjidic: async () => kanjidic(),
    ...(input.lookup ? { lookup: input.lookup.transport } : {}),
  });
  return { judge, requests: provider.requests, ...guidance };
}
type RangeHarness = ReturnType<typeof rangeHarness>;

const rangeRun = (
  h: RangeHarness,
  chapters: ScanChapter[],
  names: string[],
  options: {
    sources?: { wikipedia?: boolean; namuwiki?: boolean };
    onProgress?(progress: TermScanProgress): void;
    signal?: AbortSignal;
  } = {},
) =>
  h.judge({
    workId: 'w1',
    chapters,
    names,
    selection,
    signal: options.signal ?? new AbortController().signal,
    ...(options.sources ? { sources: options.sources } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

test('범위 판정은 일반어와 답 없음을 세고, 제안만 new로 내며, 용어집에 저장하지 않는다', async () => {
  const h = rangeHarness({
    terms: [term('カミラ', '카밀라')],
    answers: {
      カミラ: { target: '카미라' },
      ハンナ: { kind: 'common', category: '기타', target: '한나' },
    },
  });
  const result = await rangeRun(
    h,
    [scanChapter('c1', 'カミラが笑う。カミラは去った。ハンナが笑う。ベルナが笑う。')],
    ['カミラ', 'ハンナ', 'ベルナ', 'ミナ'],
  );
  expect(result.suggestions).toHaveLength(1);
  expect(result.suggestions[0]).toMatchObject({ source: 'カミラ', role: 'new', after: '카미라' });
  expect(result.suggestions[0]).not.toHaveProperty('before');
  expect(result.common).toEqual(['ハンナ']);
  expect(result.counts).toEqual({ candidates: 3, common: 1, unchanged: 0, unanswered: 1 });
  expect(result.skipped).toBe(1);
  expect(result.skipped).toBe(1);
  expect(result.partial).toBe(false);
  expect(result).not.toHaveProperty('lookupFailed');
  expect(h.saves).toEqual([]);
});

test('제안은 신뢰도 낮은 순으로 정렬하고, 가나 불일치 항목은 low다', async () => {
  const h = rangeHarness({
    answers: { ルーク: { target: '소피아' }, カミラ: { target: '카미라' } },
  });
  const result = await rangeRun(
    h,
    [scanChapter('c1', 'ルークが笑う。カミラが笑う。')],
    ['カミラ', 'ルーク'],
  );
  expect(result.suggestions.map((item) => [item.source, item.confidence, item.kanaFlag])).toEqual([
    ['ルーク', 'low', true],
    ['カミラ', 'high', false],
  ]);
});

test('외부 조회를 켜면 제안 근거에 조회 hit이 model 앞에 붙고, 조회와 모델 요청은 하나씩 나간다', async () => {
  const lookup = fakeLookup(LOOKUP_TABLE);
  const h = rangeHarness({
    answers: { カミラ: { target: '카미라' } },
    lookup: { transport: lookup.transport },
  });
  const progress: TermScanProgress[] = [];
  const result = await rangeRun(
    h,
    [scanChapter('c1', 'カミラが笑う。カミラは去った。')],
    ['カミラ'],
    {
      sources: { wikipedia: true },
      onProgress: (item) => progress.push(item),
    },
  );
  expect(lookup.calls).toEqual(['wikipedia:カミラ']);
  expect(h.requests).toHaveLength(3);
  expect(result.suggestions[0]?.evidence.map((item) => item.kind)).toEqual(['wikipedia', 'model']);
  expect(progress.map((item) => item.stage)).toEqual(['lookup', 'judge', 'judge', 'judge']);
});

test('후보가 없으면 판정 요청 없이 0 집계의 빈 결과를 낸다', async () => {
  const h = rangeHarness({ answers: { カミラ: { target: '카미라' } } });
  const result = await rangeRun(h, [scanChapter('c1', 'カミラが笑う。')], ['ミナ']);
  expect(result).toEqual({
    suggestions: [],
    common: [],
    partial: false,
    counts: { candidates: 0, common: 0, unchanged: 0, unanswered: 0 },
    skipped: 1,
  });
  expect(h.requests).toEqual([]);
});

test('이미 취소된 신호로 부르면 cancelled로 끝나고 판정하지 않는다', async () => {
  const h = rangeHarness({ answers: { カミラ: { target: '카미라' } } });
  const controller = new AbortController();
  controller.abort();
  await expect(
    rangeRun(h, [scanChapter('c1', 'カミラが笑う。カミラは去った。')], ['カミラ'], {
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(h.requests).toEqual([]);
  expect(h.saves).toEqual([]);
});

test('이름 목록이 200개를 넘으면 앞 200개만 판정하고 나머지는 skipped로 센다', async () => {
  const syllables = 'アイウエオカキクケコサシスセソタチツテト';
  const names = Array.from(
    { length: 205 },
    (_, index) => syllables[Math.floor(index / 20)]! + syllables[index % 20]!,
  );
  const h = rangeHarness({});
  const result = await rangeRun(h, [scanChapter('c1', names.join('。'))], names);
  expect(result.counts.candidates).toBe(200);
  expect(result.skipped).toBe(5);
});

test('원문에서 찾지 못한 이름은 skipped로 센다', async () => {
  const h = rangeHarness({ answers: { カミラ: { target: '카미라' } } });
  const result = await rangeRun(h, [scanChapter('c1', 'カミラが笑う。')], ['カミラ', 'ミナ']);
  expect(result.counts.candidates).toBe(1);
  expect(result.skipped).toBe(1);
});
