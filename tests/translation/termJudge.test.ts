import { expect, test } from 'vitest';
import type { LookupHit } from '../../src/translation/lookup';
import type { ScanCandidate } from '../../src/translation/termScan';
import {
  judgeRequest,
  parseJudge,
  voteJudgements,
  type JudgeAnswer,
} from '../../src/translation/termJudge';

const candidate = (source: string, extra: Partial<ScanCandidate> = {}): ScanCandidate => ({
  source,
  role: 'new',
  count: 1,
  chapterIds: ['c1'],
  contexts: [],
  script: 'other',
  ...extra,
});
const batch = [
  candidate('公爵', {
    script: 'kanji',
    existing: {
      source: '公爵',
      target: '공작',
      aliases: [],
      category: '',
      note: '',
      origin: 'model',
    },
    kanji: [
      { char: '公', ko: ['공'], en: ['public', 'duke'] },
      { char: '爵', ko: [], en: ['baron'] },
    ],
    contexts: ['彼は公爵だ。', '公爵が来た。'],
  }),
  candidate('カミラ', {
    script: 'katakana',
    ruby: 'かみら',
    contexts: ['カミラが笑う。'],
  }),
  candidate('王都', { script: 'kanji', contexts: ['王都へ行く。'] }),
];
const answer = (target: string, extra: Partial<JudgeAnswer> = {}): JudgeAnswer => ({
  kind: 'common',
  category: '기타',
  target,
  reason: `reason ${target}`,
  ...extra,
});
const run = (entries: Record<string, JudgeAnswer | undefined>) =>
  new Map(
    Object.entries(entries).filter(
      (entry): entry is [string, JudgeAnswer] => entry[1] !== undefined,
    ),
  );
const parsed = (items: unknown[]) => parseJudge({ items }, batch);

test('요청 본문에는 후보마다 id 블록이 있고 존재하는 항목만 들어간다', () => {
  const { user } = judgeRequest(batch);
  expect(user).toContain(
    [
      '[c1] 公爵',
      'existing: 공작 (machine)',
      'kanji: 公=공(public) 爵=?(baron)',
      'contexts:',
      '- 彼は公爵だ。',
      '- 公爵が来た。',
    ].join('\n'),
  );
  expect(user).toContain(
    ['[c2] カミラ', 'ruby: かみら', 'contexts:', '- カミラが笑う。'].join('\n'),
  );
  expect(user).toContain(['[c3] 王都', 'contexts:', '- 王都へ行く。'].join('\n'));
  expect(user).not.toContain('existing: undefined');
  expect(user).not.toContain('ruby: undefined');
});

test('사람이 입력한 기존 항목은 (human)으로 표시한다', () => {
  const human = [
    candidate('王都', {
      role: 'suggest',
      existing: { source: '王都', target: '왕도', aliases: [], category: '', note: '' },
      contexts: ['王都へ行く。'],
    }),
  ];
  expect(judgeRequest(human).user).toContain('existing: 왕도 (human)');
});

test('시스템 지침은 고정 문장과 묶음에 맞는 지침 줄을 담는다', () => {
  const { system } = judgeRequest(batch);
  expect(system).toContain(
    'You decide Korean renderings for names in a Japanese web novel glossary. For each candidate decide: kind ("real" for real-world people, places and works; "work" for names invented in this story; "common" for ordinary words that are not names), category, and the Korean rendering. Use the contexts to understand what the name refers to. Return only JSON that matches the schema. Every target must be written in Hangul without kana. Write each reason as one short sentence in Korean.',
  );
  expect(system).toContain('\nGuides:\n');
  expect(system).toContain("\n- The author's ruby reading is authoritative");
  expect(system).toContain('\n- Katakana names in fantasy settings');
  expect(system).toContain('\n- Ranks, titles, institutions');
});

test('응답 스키마는 항목 배열과 kind·category 열거값을 강제한다', () => {
  const { schema } = judgeRequest(batch);
  expect(schema).toMatchObject({
    type: 'object',
    required: ['items'],
    additionalProperties: false,
  });
  const item = (schema.properties as Record<string, any>).items.items;
  expect(item.required).toEqual(['id', 'kind', 'category', 'target', 'reason']);
  expect(item.additionalProperties).toBe(false);
  expect(item.properties.kind.enum).toEqual(['real', 'work', 'common']);
  expect(item.properties.category.enum).toEqual([
    '인명',
    '지명',
    '조직',
    '작품명',
    '별명',
    '호칭',
    '기타',
  ]);
});

test('최대 출력 토큰은 묶음 크기 곱하기 120에 200을 더한다', () => {
  expect(judgeRequest(batch).maxTokens).toBe(3 * 120 + 200);
  expect(judgeRequest([batch[0]!]).maxTokens).toBe(320);
});

test('묶음 응답은 {items} 또는 맨 배열 모두 받고, 키는 후보의 source다', () => {
  const item = { id: 'c1', kind: 'common', category: '기타', target: '공작', reason: '근거' };
  const wrapped = parseJudge({ items: [item] }, batch);
  const bare = parseJudge([item], batch);
  expect([...wrapped.keys()]).toEqual(['公爵']);
  expect(bare.get('公爵')).toEqual({
    kind: 'common',
    category: '기타',
    target: '공작',
    reason: '근거',
  });
});

test('가나·한글 없는 목표, 제어문자, 빈 목표, 80자 초과는 그 항목만 뺀다', () => {
  const result = parsed([
    { id: 'c1', kind: 'common', category: '기타', target: '공작', reason: 'ok' },
    { id: 'c2', kind: 'real', category: '인명', target: 'カミラ', reason: 'x' },
    { id: 'c3', kind: 'real', category: '지명', target: 'Osaka', reason: 'x' },
    { id: 'c3', kind: 'real', category: '지명', target: '왕\u0007도', reason: 'x' },
    { id: 'c3', kind: 'real', category: '지명', target: '  ', reason: 'x' },
    { id: 'c3', kind: 'real', category: '지명', target: '가'.repeat(81), reason: 'x' },
  ]);
  expect([...result.keys()]).toEqual(['公爵']);
});

test('묶음에 없는 id와 enum 밖의 kind는 그 항목을 뺀다', () => {
  const result = parsed([
    { id: 'c9', kind: 'real', category: '인명', target: '미지', reason: 'x' },
    { id: 'c2', kind: 'maybe', category: '인명', target: '카밀라', reason: 'x' },
    { id: 'c3', kind: 'work', category: '지명', target: '왕도', reason: 'x' },
  ]);
  expect([...result.keys()]).toEqual(['王都']);
});

test('category가 enum 밖이면 기타로 바꾸고 항목은 남긴다', () => {
  const result = parsed([
    { id: 'c2', kind: 'real', category: '마법사', target: '카밀라', reason: 'x' },
  ]);
  expect(result.get('カミラ')).toMatchObject({ kind: 'real', category: '기타', target: '카밀라' });
});

test('같은 id가 여러 번 오면 처음 것만 쓴다', () => {
  const result = parsed([
    { id: 'c3', kind: 'work', category: '지명', target: '왕도', reason: '처음' },
    { id: 'c3', kind: 'common', category: '기타', target: '왕국', reason: '나중' },
  ]);
  expect(result.get('王都')).toMatchObject({ target: '왕도', reason: '처음' });
});

test('목표 앞뒤 공백을 자르고, 근거는 200자로 줄인다', () => {
  const result = parsed([
    { id: 'c1', kind: 'common', category: '기타', target: ' 공작 ', reason: 'r'.repeat(250) },
  ]);
  expect(result.get('公爵')?.target).toBe('공작');
  expect(result.get('公爵')?.reason).toHaveLength(200);
});

test('형식이 아닌 응답은 빈 결과다', () => {
  expect(parseJudge('garbage', batch).size).toBe(0);
  expect(parseJudge(null, batch).size).toBe(0);
});

test('3회 모두 같은 목표면 high', () => {
  const votes = voteJudgements(
    [run({ 公爵: answer('공작') }), run({ 公爵: answer('공작') }), run({ 公爵: answer('공작') })],
    batch,
  );
  expect(votes.get('公爵')).toMatchObject({
    target: '공작',
    votes: 3,
    total: 3,
    confidence: 'high',
  });
});

test('3회 중 2회가 같으면 medium', () => {
  const votes = voteJudgements(
    [run({ 公爵: answer('공작') }), run({ 公爵: answer('작') }), run({ 公爵: answer('공작') })],
    batch,
  );
  expect(votes.get('公爵')).toMatchObject({
    target: '공작',
    votes: 2,
    total: 3,
    confidence: 'medium',
  });
});

test('3회가 모두 다르면 low이고 처음 run의 목표를 낸다', () => {
  const votes = voteJudgements(
    [run({ 公爵: answer('공작') }), run({ 公爵: answer('공 작가') }), run({ 公爵: answer('작') })],
    batch,
  );
  expect(votes.get('公爵')).toMatchObject({ votes: 1, total: 3, confidence: 'low' });
});

test('공백만 다른 목표는 같은 표로 세고 처음 표기를 낸다', () => {
  const votes = voteJudgements(
    [run({ 公爵: answer('공 작') }), run({ 公爵: answer('공작') }), run({ 公爵: answer('공작 ') })],
    batch,
  );
  expect(votes.get('公爵')).toMatchObject({ target: '공 작', votes: 3, confidence: 'high' });
});

test('동률이면 run 순서상 먼저 나온 목표와 종류를 고른다', () => {
  const votes = voteJudgements(
    [
      run({ 公爵: answer('B', { kind: 'work' }) }),
      run({ 公爵: answer('A', { kind: 'common' }) }),
      run({ 公爵: answer('A', { kind: 'common' }) }),
      run({ 公爵: answer('B', { kind: 'work' }) }),
    ],
    batch,
  );
  expect(votes.get('公爵')).toMatchObject({ target: 'B', votes: 2, confidence: 'medium' });
  const kindTie = voteJudgements(
    [
      run({ 公爵: answer('공작', { kind: 'work' }) }),
      run({ 公爵: answer('공작', { kind: 'common' }) }),
    ],
    batch,
  );
  expect(kindTie.get('公爵')?.kind).toBe('work');
});

test('근거는 최다 목표를 처음 낸 run의 reason이다', () => {
  const votes = voteJudgements(
    [
      run({ 公爵: answer('B', { reason: 'r1' }) }),
      run({ 公爵: answer('A', { reason: 'r2' }) }),
      run({ 公爵: answer('A', { reason: 'r3' }) }),
    ],
    batch,
  );
  expect(votes.get('公爵')?.reason).toBe('r2');
});

test('답이 없는 run은 total에만 세고, 답이 하나도 없는 후보는 뺀다', () => {
  const votes = voteJudgements(
    [run({ 公爵: answer('공작') }), run({}), run({ 公爵: answer('공작') })],
    batch,
  );
  expect(votes.get('公爵')).toMatchObject({ votes: 2, total: 3, confidence: 'medium' });
  expect(votes.has('カミラ')).toBe(false);
  expect(votes.has('王都')).toBe(false);
});

const hit = (extra: Pick<LookupHit, 'kind' | 'ko'> & Partial<LookupHit>): LookupHit => ({
  url: 'https://example.test/hit',
  note: '',
  exact: false,
  ...extra,
});
const LOOKUP_SENTENCE =
  'Lookup lines come from Korean Wikipedia, Wikidata or Namuwiki. Prefer a lookup rendering when the contexts refer to the same person, place or work, and ignore it when it clearly refers to something else. For names invented in this story, an author ruby reading still comes first. A "refers to" line only tells who or what the name points to; it is context, not the rendering.';

test('조회 근거는 후보 블록에서 kanji 줄 뒤, contexts 앞에 kind와 exact 표시로 들어간다', () => {
  const lookups = new Map([
    ['公爵', [hit({ kind: 'wikidata', ko: '공작' })]],
    [
      '王都',
      [
        hit({ kind: 'wikipedia', ko: '왕도', exact: true }),
        hit({ kind: 'namuwiki', ko: '왕도시' }),
      ],
    ],
  ]);
  const { user } = judgeRequest(batch, lookups);
  expect(user).toContain(
    [
      '[c1] 公爵',
      'existing: 공작 (machine)',
      'kanji: 公=공(public) 爵=?(baron)',
      'lookup: 공작 (wikidata)',
      'contexts:',
      '- 彼は公爵だ。',
      '- 公爵が来た。',
    ].join('\n'),
  );
  expect(user).toContain(
    [
      '[c3] 王都',
      'lookup: 왕도 (wikipedia, exact link)',
      'lookup: 왕도시 (namuwiki)',
      'contexts:',
      '- 王都へ行く。',
    ].join('\n'),
  );
});

test('조회 줄이 하나라도 있는 묶음의 시스템 지침은 고정 문장을 Guides 앞에 담는다', () => {
  const lookups = new Map([['王都', [hit({ kind: 'wikidata', ko: '왕도' })]]]);
  const { system } = judgeRequest(batch, lookups);
  expect(system).toContain(`\n${LOOKUP_SENTENCE}\nGuides:\n`);
});

test('조회가 없는 묶음의 요청은 조회 인자가 없을 때와 같고 고정 문장을 넣지 않는다', () => {
  const plain = judgeRequest(batch);
  expect(judgeRequest(batch, new Map())).toEqual(plain);
  expect(
    judgeRequest(batch, new Map([['없는 이름', [hit({ kind: 'namuwiki', ko: '없음' })]]])),
  ).toEqual(plain);
  expect(plain.user).not.toContain('lookup:');
  expect(plain.system).not.toContain('Lookup lines come from');
});

test('refers 조회 줄은 가리키는 대상으로 적고, 고정 문장은 표기가 아니라는 설명을 담는다', () => {
  const epithet = [candidate('美濃の蝮', { script: 'mixed', contexts: ['美濃の蝮が笑う。'] })];
  const lookups = new Map([
    ['美濃の蝮', [hit({ kind: 'wikipedia', ko: '사이토 도산', refers: true })]],
  ]);
  const { user, system } = judgeRequest(epithet, lookups);
  expect(user).toContain('lookup: refers to 사이토 도산 (wikipedia search)');
  expect(user).not.toContain('lookup: 사이토 도산');
  expect(system).toContain(
    'A "refers to" line only tells who or what the name points to; it is context, not the rendering.',
  );
});

test('시스템 지침은 판정 이유를 한국어 한 문장으로 쓰라고 말한다', () => {
  expect(judgeRequest(batch).system).toContain(
    'Write each reason as one short sentence in Korean.\nGuides:\n',
  );
});
