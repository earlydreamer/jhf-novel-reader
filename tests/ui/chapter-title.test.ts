import { describe, expect, it } from 'vitest';
import { withoutOrdinalPrefix } from '../../src/ui/chapterTitle';

describe('withoutOrdinalPrefix', () => {
  it.each([
    ['제1화 불과 강철의 노래 (1)', 1, '불과 강철의 노래 (1)'],
    ['第12話　出会い', 12, '出会い'],
    ['第１２話 出会い', 12, '出会い'],
    ['제2화 A', 1, '제2화 A'],
    ['제3화', 3, '제3화'],
    ['프롤로그', 1, '프롤로그'],
    ['3화: 시작', 3, '시작'],
  ])('%s (%i화) -> %s', (title, ordinal, expected) => {
    expect(withoutOrdinalPrefix(title, ordinal)).toBe(expected);
  });
});
