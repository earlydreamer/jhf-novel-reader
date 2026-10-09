import { expect, test } from 'vitest';
import { kanaMismatch } from '../../src/translation/kanaCheck';

test.each([
  ['カミラ', '카밀라', false],
  ['カミラ', '카미라', false],
  ['グレイルン', '그레이른', false],
  ['グレイルン', '그레이런', false],
  ['シルヴェロス', '실베로스', false],
  ['カミラ', '마무', true],
  ['アーケン', '아켄', false],
  ['アーケン', '실베로스', true],
])('kanaMismatch(%s, %s) is %s', (source, target, expected) => {
  expect(kanaMismatch(source, target)).toBe(expected);
});

test('판단하지 않는 입력은 어긋남이 아니다', () => {
  expect(kanaMismatch('王都', '왕도')).toBe(false);
  expect(kanaMismatch('カミラ', 'Camilla')).toBe(false);
  expect(kanaMismatch('カミラ', '')).toBe(false);
  expect(kanaMismatch('カミラ・', '카미라')).toBe(false);
});
