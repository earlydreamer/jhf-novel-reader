import { expect, test } from 'vitest';
import { checkTranslationQuality, japaneseBlockIndexes } from '../../src/translation/quality';
import type { WorkGuidance } from '../../src/translation/guidance';
const guidance: WorkGuidance = {
  schemaVersion: 1,
  workId: 'n1234ab',
  hash: 'unused',
  terms: [
    { source: 'アルベルト', target: '알베르트', aliases: ['アル'], category: '', note: '' },
    { source: 'アルベルト王', target: '알베르트 왕', aliases: [], category: '', note: '' },
    { source: '未登場', target: '미등장', aliases: [], category: '', note: '' },
    { source: 'レベル', target: '단계', aliases: [], category: '', note: '', origin: 'auto' },
  ],
  voices: [],
};
test('flags kana including halfwidth, but not Han, punctuation or Korean', () => {
  expect(
    japaneseBlockIndexes(
      ['한국어 漢字 ー 「」', 'ふと 멈췄다', '', 'ｱﾙベルト'].map((text) => ({ text })),
    ),
  ).toEqual([1, 3]);
});
test('uses the injection matcher: aliases, longest names, manual preset override and auto exclusion', () => {
  const preset = [
    { source: 'アルベルト', target: '다른 이름', aliases: [], category: '', note: '' },
  ];
  expect(
    checkTranslationQuality(
      'n1234ab',
      'アルベルト王とレベル。',
      [{ text: '왕이 ふと 멈췄다.' }],
      guidance,
      preset,
    ),
  ).toEqual({
    ruleVersion: 'deterministic-v1',
    japaneseBlocks: [0],
    missingTerms: [{ source: 'アルベルト王', target: '알베르트 왕' }],
  });
  expect(
    checkTranslationQuality('n1234ab', 'アル。', [{ text: '알베르트가 웃었다.' }], guidance, preset)
      .missingTerms,
  ).toEqual([]);
});
test('후보로만 잡힌 이름은 표기 누락 검사에서 빠진다', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [{ source: 'リスト', target: '크리스토퍼', aliases: [], category: '', note: '' }],
  };
  expect(
    checkTranslationQuality('n1234ab', 'クリストファーが来た。', [{ text: '웃었다.' }], value)
      .missingTerms,
  ).toEqual([]);
});
test('looks for fixed spelling across the whole output and never mutates source or blocks', () => {
  const blocks = Object.freeze([
    Object.freeze({ text: '알베르트가 웃었다.' }),
    Object.freeze({ text: '다른 표기의 알버트도 웃었다.' }),
  ]);
  expect(
    checkTranslationQuality('n1234ab', 'アルベルト。アルベルト。', blocks, guidance).missingTerms,
  ).toEqual([]);
  expect(blocks[1]?.text).toContain('알버트');
  expect(() => checkTranslationQuality('n9999zz', 'アル', blocks, guidance)).toThrow();
});
