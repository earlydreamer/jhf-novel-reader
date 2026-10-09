import { expect, test } from 'vitest';
import {
  autoGlossaryCandidates,
  glossaryRequest,
  mergeGlossaryProposals,
  parseGlossaryProposals,
  shouldGenerateGlossary,
} from '../../src/translation/autoGlossary';
import type { GuidanceTerm } from '../../src/translation/guidance';

const term = (overrides: Partial<GuidanceTerm> & { source: string }): GuidanceTerm => ({
  target: '번역',
  aliases: [],
  category: '인명',
  note: '',
  ...overrides,
});

const paragraph = (text: string, ruby: { start: number; end: number; reading: string }[] = []) => ({
  text,
  ruby,
});

test('candidates keep ruby pairs and katakana names repeated within the chapter', () => {
  const candidates = autoGlossaryCandidates(
    [
      paragraph('北嶋は笑った。', [{ start: 0, end: 2, reading: 'きたじま' }]),
      paragraph('アルベルトが来た。'),
      paragraph('アルベルトは去った。'),
      paragraph('ヴォルフが一度だけ現れた。'),
    ],
    [],
  );
  expect(candidates).toEqual(expect.arrayContaining(['北嶋', 'アルベルト']));
  expect(candidates).not.toContain('ヴォルフ');
});

test('candidates skip names already in the glossary, including aliases', () => {
  const candidates = autoGlossaryCandidates(
    [
      paragraph('北嶋は笑った。', [{ start: 0, end: 2, reading: 'きたじま' }]),
      paragraph('エリーゼ・ロイが来た。'),
      paragraph('エリーゼ・ロイは去った。'),
      paragraph('アルベルトが来た。'),
      paragraph('アルベルトは去った。'),
    ],
    [
      term({ source: '北嶋' }),
      term({ source: 'エリーゼ・ロイ', origin: 'model' }),
      term({ source: 'ベルナルド', aliases: ['アルベルト'] }),
    ],
  );
  expect(candidates).toEqual([]);
});

test('shouldGenerate is true when rule candidates exist', () => {
  expect(shouldGenerateGlossary(['北嶋'], [term({ source: '北嶋', origin: 'model' })])).toBe(true);
});

test('shouldGenerate is true when no applied term exists, so the first chapter gets a glossary', () => {
  expect(shouldGenerateGlossary([], [])).toBe(true);
  expect(shouldGenerateGlossary([], [term({ source: '北嶋', origin: 'auto' })])).toBe(true);
});

test('shouldGenerate is false when no candidates exist and applied terms are already present', () => {
  expect(shouldGenerateGlossary([], [term({ source: '北嶋', origin: 'scan' })])).toBe(false);
  expect(shouldGenerateGlossary([], [term({ source: '北嶋' })])).toBe(false);
});

const chapterText = '北嶋は笑った。アルベルトが来た。';

test('parse drops sources absent from the chapter, targets with kana, and targets without hangul', () => {
  const result = parseGlossaryProposals(
    {
      terms: [
        { source: '없는이름', target: '없는이름', category: '인명' },
        { source: '北嶋', target: 'きたじま', category: '인명' },
        { source: 'アルベルト', target: 'Albert', category: '인명' },
        { source: '北嶋', target: '기타지마', category: '인명' },
      ],
    },
    chapterText,
  );
  expect(result).toEqual([{ source: '北嶋', target: '기타지마', category: '인명' }]);
});

test('parse removes duplicate sources and keeps the first one', () => {
  const result = parseGlossaryProposals(
    [
      { source: 'アルベルト', target: '알베르트', category: '인명' },
      { source: 'アルベルト', target: '앨버트', category: '인명' },
    ],
    chapterText,
  );
  expect(result).toEqual([{ source: 'アルベルト', target: '알베르트', category: '인명' }]);
});

test('parse caps proposals at forty', () => {
  const names = Array.from(
    { length: 50 },
    (_, index) => `名前${String.fromCharCode(0x4e00 + index)}`,
  );
  const result = parseGlossaryProposals(
    names.map((source, index) => ({ source, target: `이름${index}`, category: '인명' })),
    names.join('。'),
  );
  expect(result).toHaveLength(40);
  expect(result[0]?.source).toBe(names[0]);
});

test('parse keeps a category from the schema and falls back to 기타 for anything else', () => {
  const result = parseGlossaryProposals(
    [
      { source: '北嶋', target: '기타지마', category: '지명' },
      { source: 'アルベルト', target: '알베르트', category: '무엇인지모름' },
    ],
    chapterText,
  );
  expect(result.map((entry) => entry.category)).toEqual(['지명', '기타']);
});

test('parse returns nothing for malformed or non-array responses', () => {
  expect(parseGlossaryProposals(null, chapterText)).toEqual([]);
  expect(parseGlossaryProposals('text', chapterText)).toEqual([]);
  expect(parseGlossaryProposals({ terms: 'x' }, chapterText)).toEqual([]);
  expect(parseGlossaryProposals([{ source: '北嶋' }], chapterText)).toEqual([]);
});

test('glossaryRequest builds the fixed prompt, schema and output limit', () => {
  const request = glossaryRequest(chapterText, ['北嶋', 'アルベルト']);
  expect(request.maxTokens).toBe(1500);
  expect(request.system).toContain('Return only JSON that matches the schema.');
  expect(request.user).toBe(
    'Candidate names found by a rule-based scan (some may be ordinary words):\n北嶋 アルベルト\n\nAlso add proper nouns and epithets you find in this chapter.\n\nChapter text:\n' +
      chapterText,
  );
  expect(request.schema).toMatchObject({
    type: 'object',
    required: ['terms'],
    additionalProperties: false,
  });
});

test('merge leaves names already present in any origin untouched and appends new model terms', () => {
  const existing = [
    term({ source: '北嶋', target: '기타지마', aliases: ['キタジマ'] }),
    term({
      source: 'アルベルト',
      target: '알베르트',
      origin: 'scan',
      evidence: [{ kind: 'ruby', note: '루비' }],
    }),
    term({ source: 'ミナ', target: '미나', origin: 'model' }),
  ];
  const before = structuredClone(existing);
  const result = mergeGlossaryProposals(existing, [
    { source: '北嶋', target: '다른', category: '인명' },
    { source: 'キタジマ', target: '다른', category: '인명' },
    { source: 'アルベルト', target: '다른', category: '인명' },
    { source: 'ミナ', target: '다른', category: '인명' },
    { source: 'リン', target: '린', category: '인명' },
  ]);
  expect(result).toEqual([
    ...before,
    { source: 'リン', target: '린', aliases: [], category: '인명', note: '', origin: 'model' },
  ]);
  expect(existing).toEqual(before);
});
