import { expect, test } from 'vitest';
import { contextHints, UNIVERSAL_PRESET } from '../../src/translation/preset';

test('a numeric month followed by a duration phrase gets a duration hint', () => {
  const hints = contextHints('この調子なら1月もすれば終わる。彼女は３月もしないうちに戻った。');
  expect(hints).toContain('「1月」');
  expect(hints).toContain('「３月」');
  expect(hints.split('\n').filter(Boolean)).toHaveLength(2);
});
test('calendar months and kanji months get no hint', () => {
  expect(contextHints('1月に入ると街は静かになった。一月もすれば治る。')).toBe('');
});
test('the preset has unique sources and no single-character entries', () => {
  const sources = UNIVERSAL_PRESET.map((term) => term.source.normalize('NFKC'));
  expect(new Set(sources).size).toBe(sources.length);
  expect(UNIVERSAL_PRESET.every((term) => [...term.source].length > 1 && term.target.trim())).toBe(
    true,
  );
});
