import { describe, expect, it } from 'vitest';
import type { GuidanceTerm } from '../../src/translation/guidance';
import {
  paragraphTerms,
  sourceRanges,
  splitByRanges,
  translatedRanges,
} from '../../src/ui/termHighlight';

const term = (source: string, target: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source,
  target,
  aliases: [],
  category: '',
  note: '',
  ...extra,
});
const lucia = term('ルシアナ', '루시아나', { aliases: ['ルシア'] });
const duke = term('公爵', '공작', { origin: 'model' });

describe('termHighlight', () => {
  it('원문에 확정 매칭된 용어만 고르고 auto 항목은 뺀다', () => {
    const auto = term('メイド', '메이드', { origin: 'auto' });
    expect(paragraphTerms('ルシアナはメイドを呼んだ。', [lucia, duke, auto])).toEqual([lucia]);
    // 'クルシアーノ' 안의 'ルシア'는 후보(경계 아님)라 고르지 않는다.
    expect(paragraphTerms('クルシアーノが来た。', [lucia])).toEqual([]);
  });

  it('원문에 있는 용어의 표기만 번역문에서 찾는다', () => {
    const ranges = translatedRanges('ルシアナが笑った。', '루시아나가 웃자 공작이 왔다.', [
      lucia,
      duke,
    ]);
    expect(ranges.map((r) => [r.start, r.end, r.term.source])).toEqual([[0, 4, 'ルシアナ']]);
  });

  it('번역문의 같은 표기는 모두 표시하고, 긴 표기부터 겹치지 않게 잡는다', () => {
    const full = term('セレスティ・マクマーデン', '셀레스티 맥마던');
    const short = term('セレスティ', '셀레스티');
    const ranges = translatedRanges(
      'セレスティ・マクマーデン。セレスティは笑う。',
      '셀레스티 맥마던. 셀레스티는 웃는다.',
      [short, full],
    );
    expect(ranges.map((r) => [r.start, r.end, r.term.source])).toEqual([
      [0, 8, 'セレスティ・マクマーデン'],
      [10, 14, 'セレスティ'],
    ]);
  });

  it('두 글자 미만 표기는 표시하지 않는다', () => {
    expect(translatedRanges('王が来た。', '왕이 왔다.', [term('王', '왕')])).toEqual([]);
  });

  it('원문 보기 위치는 UTF-16 인덱스로 돌려준다', () => {
    const ranges = sourceRanges('𠮷はルシアナを見た。', [lucia]);
    expect(ranges.map((r) => [r.start, r.end])).toEqual([[3, 7]]);
  });

  it('범위로 문자열을 나눈다', () => {
    const ranges = translatedRanges('ルシアナが笑った。', '그때 루시아나가 웃었다.', [lucia]);
    expect(splitByRanges('그때 루시아나가 웃었다.', ranges)).toEqual([
      { text: '그때 ' },
      { text: '루시아나', term: lucia },
      { text: '가 웃었다.' },
    ]);
    expect(splitByRanges('없음', [])).toEqual([{ text: '없음' }]);
  });
});
