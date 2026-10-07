import { expect, test } from 'vitest';
import {
  assembleLines,
  encodeLineId,
  estimatedLineTokens,
  lineUnits,
  parseLines,
  planLineBatches,
  taggedLines,
} from '../../src/translation/lines';
import { source } from '../providers/wholeChapterFixture';

const limits = { contextTokens: 8192, inputBudgetTokens: 2048, maxOutputTokens: 4096 };
const chapter = {
  ...source,
  paragraphs: [
    { id: 'a', text: '北嶋は笑った。', ruby: [{ start: 0, end: 2, reading: 'きたじま' }] },
    { id: 'blank', text: '', ruby: [] },
    { id: 'b', text: '二行目の\n文章。', ruby: [] },
  ],
};

test('ids are short, unique and ordered', () => {
  const ids = Array.from({ length: 3000 }, (_, index) => encodeLineId(index));
  expect(ids.slice(0, 3)).toEqual(['A', 'B', 'C']);
  expect(ids[26]).toBe('a');
  expect(ids[52]).toBe('AA');
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => /^[A-Za-z]{1,3}$/.test(id))).toBe(true);
});
test('only non-blank paragraphs become units and ruby is kept in the unit text', () => {
  const units = lineUnits(chapter);
  expect(units.map((unit) => [unit.id, unit.paragraph, unit.text])).toEqual([
    ['A', 0, '北嶋《きたじま》は笑った。'],
    ['B', 2, '二行目の\n文章。'],
  ]);
  expect(taggedLines(units)).toBe(
    '<p id="A">北嶋《きたじま》は笑った。</p>\n<p id="B">二行目の\n文章。</p>',
  );
});
test('only complete elements for pending ids are taken; a cut last element is dropped', () => {
  const parsed = parseLines(
    'ok\n<p id="A">첫 줄</p>\n<p id="Z">모르는 id</p>\n<p id="A">중복</p>\n<p id="B">잘린 줄',
    new Set(['A', 'B']),
  );
  expect([...parsed]).toEqual([['A', '첫 줄']]);
});
test('multi-line and tag-polluted translations are normalized to one block each', () => {
  const parsed = parseLines('<p id="A">\n 두 줄\n\n짜리 <b>번역</b> \n</p>', new Set(['A']));
  expect(parsed.get('A')).toBe('두 줄\n짜리 번역');
});
test('assembly restores paragraph order and keeps blank paragraphs as empty blocks', () => {
  const units = lineUnits(chapter);
  const text = assembleLines(
    chapter,
    units,
    new Map([
      ['A', '기타지마는 웃었다.'],
      ['B', '두 번째 문장.'],
    ]),
  );
  expect(text).toBe('기타지마는 웃었다.\n\n\n\n두 번째 문장.');
});
test('batches respect the input budget and cover every unit once in order', () => {
  const long = {
    ...source,
    paragraphs: Array.from({ length: 60 }, (_, index) => ({
      id: `p${index}`,
      text: '長い文章です。'.repeat(8),
      ruby: [],
    })),
  };
  const units = lineUnits(long);
  const batches = planLineBatches(units, limits, 'Reference data\n\n');
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.flat().map((unit) => unit.id)).toEqual(units.map((unit) => unit.id));
});
test('a paragraph longer than the budget is split at sentence ends without cutting ruby', () => {
  const small = { contextTokens: 2048, inputBudgetTokens: 1024, maxOutputTokens: 512 };
  const long = {
    ...source,
    paragraphs: [
      {
        id: 'a',
        text: '長い文章。'.repeat(100) + '基底',
        ruby: [{ start: 500, end: 502, reading: 'よみ' }],
      },
      { id: 'b', text: '短い。', ruby: [] },
    ],
  };
  const units = lineUnits(long, small);
  const first = units.filter((unit) => unit.paragraph === 0);
  expect(first.length).toBeGreaterThan(1);
  expect(first.map((unit) => unit.text).join('')).toBe('長い文章。'.repeat(100) + '基底《よみ》');
  expect(units.every((unit) => estimatedLineTokens([unit]) <= small.inputBudgetTokens)).toBe(true);
  const translations = new Map(units.map((unit) => [unit.id, `번역${unit.id}`]));
  const text = assembleLines(long, units, translations);
  expect(text.split('\n\n')).toHaveLength(2);
  expect(text.split('\n\n')[0]).toBe(first.map((unit) => `번역${unit.id}`).join(' '));
});
