import { describe, expect, it, vi } from 'vitest';
import type { GuidanceTerm } from '../../src/translation/guidance';
import {
  decideCandidates,
  DECISION_HIGH,
  DECISION_LOW,
  type EmbedTexts,
} from '../../src/translation/termDecision';

const PAD = '。'.repeat(50);
const EMPTY = { confirmed: new Set<string>(), rejected: new Set<string>() };
// 'ルシア'는 'ルシアナ'의 별칭이다. 첫 자리는 확정, 'クルシアーノ'의 자리는 후보(뒤에 'ー')다.
const input = `ルシアナが笑った。${PAD}クルシアーノが来た。`;
const terms: GuidanceTerm[] = [
  { source: 'ルシアナ', target: '루시아나', aliases: ['ルシア'], category: '', note: '' },
];

/** 'ルシアナ'가 든 문맥(기준)은 [1,0], 나머지(후보 문맥)는 기준과 코사인이 score인 벡터를 돌려준다. */
function fakeEmbed(score: number) {
  return vi.fn<EmbedTexts>(async (texts) =>
    texts.map((text) =>
      /ルシアナ|ミランダ/.test(text) ? [1, 0] : [score, Math.sqrt(1 - score * score)],
    ),
  );
}

describe('decideCandidates', () => {
  it('경계값 상수는 지시대로 0.85와 0.6이다', () => {
    expect(DECISION_HIGH).toBe(0.85);
    expect(DECISION_LOW).toBe(0.6);
  });

  it('후보가 없으면 embed를 부르지 않는다', async () => {
    const embed = fakeEmbed(0.9);
    expect(await decideCandidates('ルシアナが笑った。', terms, embed)).toEqual(EMPTY);
    expect(embed).not.toHaveBeenCalled();
  });

  it('같은 용어의 확정 문맥이 없으면 판정하지 않는다(보류)', async () => {
    const embed = fakeEmbed(0.99);
    expect(await decideCandidates('クルシアーノが来た。', terms, embed)).toEqual(EMPTY);
    expect(embed).not.toHaveBeenCalled();
  });

  it('유사도가 높으면 확정, 낮으면 제외, 사이는 보류한다', async () => {
    expect(await decideCandidates(input, terms, fakeEmbed(0.9))).toEqual({
      confirmed: new Set(['ルシア']),
      rejected: new Set(),
    });
    expect(await decideCandidates(input, terms, fakeEmbed(0.3))).toEqual({
      confirmed: new Set(),
      rejected: new Set(['ルシア']),
    });
    expect(await decideCandidates(input, terms, fakeEmbed(0.7))).toEqual(EMPTY);
  });

  it('경계값 0.85는 확정, 0.6은 제외에 든다', async () => {
    expect(
      (await decideCandidates(input, terms, fakeEmbed(DECISION_HIGH))).confirmed.has('ルシア'),
    ).toBe(true);
    expect(
      (await decideCandidates(input, terms, fakeEmbed(DECISION_LOW))).rejected.has('ルシア'),
    ).toBe(true);
  });

  it('maxTexts를 넘는 이름은 보류하고 embed는 한 번만 부른다', async () => {
    const two: GuidanceTerm[] = [
      ...terms,
      { source: 'ミランダ', target: '미란다', aliases: ['ミラ'], category: '', note: '' },
    ];
    const long = `ルシアナが笑った。${PAD}クルシアーノが来た。${PAD}ミランダが来た。${PAD}ミラーが来た。`;
    const embed = fakeEmbed(0.9);
    const result = await decideCandidates(long, two, embed, { maxTexts: 3 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]![0]).toHaveLength(2);
    expect(result.confirmed).toEqual(new Set(['ルシア']));
    expect(result.rejected.has('ミラ')).toBe(false);
    expect(result.confirmed.has('ミラ')).toBe(false);
  });

  it('시간 초과면 던지지 않고 빈 결과를 돌려준다', async () => {
    const never: EmbedTexts = () => new Promise(() => {});
    expect(await decideCandidates(input, terms, never, { timeoutMs: 5 })).toEqual(EMPTY);
  });

  it('embed가 실패하거나 벡터 수가 맞지 않으면 빈 결과를 돌려준다', async () => {
    const broken: EmbedTexts = async () => {
      throw new Error('model down');
    };
    const short: EmbedTexts = async () => [];
    expect(await decideCandidates(input, terms, broken)).toEqual(EMPTY);
    expect(await decideCandidates(input, terms, short)).toEqual(EMPTY);
  });
});
