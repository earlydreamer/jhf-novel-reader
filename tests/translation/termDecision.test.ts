import { describe, expect, it, vi } from 'vitest';
import type { GuidanceTerm } from '../../src/translation/guidance';
import {
  decideCandidates,
  DECISION_HIGH,
  DECISION_LOW,
  type EmbedTexts,
} from '../../src/translation/termDecision';

const PAD = '。'.repeat(50);
const EMPTY = { confirmed: new Set<string>(), rejected: new Set<string>(), judged: 0 };
// 'ルシア'는 'ルシアナ'의 별칭이다. 첫 자리는 확정, 'クルシアーノ'의 자리는 후보(뒤에 'ー')다.
const input = `ルシアナが笑った。${PAD}クルシアーノが来た。`;
const terms: GuidanceTerm[] = [
  { source: 'ルシアナ', target: '루시아나', aliases: ['ルシア'], category: '', note: '' },
];
const two: GuidanceTerm[] = [
  ...terms,
  { source: 'ミランダ', target: '미란다', aliases: ['ミラ'], category: '', note: '' },
];
const long = `ルシアナが笑った。${PAD}クルシアーノが来た。${PAD}ミランダが来た。${PAD}ミラーが来た。`;

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
      judged: 1,
    });
    expect(await decideCandidates(input, terms, fakeEmbed(0.3))).toEqual({
      confirmed: new Set(),
      rejected: new Set(['ルシア']),
      judged: 1,
    });
    // 보류도 점수를 낸 판정이므로 judged에 든다.
    expect(await decideCandidates(input, terms, fakeEmbed(0.7))).toEqual({
      confirmed: new Set(),
      rejected: new Set(),
      judged: 1,
    });
  });

  it('같은 회차에 확정 자리와 후보 자리가 함께 있는 이름도 판정하고, 기준은 확정 자리 문맥이다', async () => {
    const melody = `メロディは笑った。${PAD}メロディーを聞いた。`;
    const melodyTerms: GuidanceTerm[] = [
      { source: 'メロディ', target: '멜로디', aliases: [], category: '', note: '' },
    ];
    /** 'メロディは'가 든 문맥(기준)은 [1,0], 나머지(후보 문맥)는 기준과 코사인이 score인 벡터를 돌려준다. */
    const melodyEmbed = (score: number) =>
      vi.fn<EmbedTexts>(async (texts) =>
        texts.map((text) =>
          text.includes('メロディは') ? [1, 0] : [score, Math.sqrt(1 - score * score)],
        ),
      );
    const high = melodyEmbed(0.9);
    expect(await decideCandidates(melody, melodyTerms, high)).toEqual({
      confirmed: new Set(['メロディ']),
      rejected: new Set(),
      judged: 1,
    });
    const sent = high.mock.calls[0]![0];
    expect(sent.some((text) => text.includes('メロディは'))).toBe(true);
    expect(sent.some((text) => text.includes('メロディーを'))).toBe(true);
    expect(await decideCandidates(melody, melodyTerms, melodyEmbed(0.3))).toEqual({
      confirmed: new Set(),
      rejected: new Set(['メロディ']),
      judged: 1,
    });
  });

  it('기준 문맥이 없는 이름은 judged에 세지 않는다', async () => {
    const withBob: GuidanceTerm[] = [
      ...terms,
      { source: 'ボブ', target: '밥', aliases: [], category: '', note: '' },
    ];
    const text = `ルシアナが笑った。${PAD}クルシアーノが来た。${PAD}ボブーが来た。`;
    expect((await decideCandidates(text, withBob, fakeEmbed(0.9))).judged).toBe(1);
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
    const embed = fakeEmbed(0.9);
    const result = await decideCandidates(long, two, embed, { maxTexts: 3 });
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]![0]).toHaveLength(2);
    expect(result.judged).toBe(1);
    expect(result.confirmed).toEqual(new Set(['ルシア']));
    expect(result.rejected.has('ミラ')).toBe(false);
    expect(result.confirmed.has('ミラ')).toBe(false);
  });

  it('묶음마다 나눠 embed하고 모든 이름을 판정한다', async () => {
    const embed = fakeEmbed(0.9);
    const result = await decideCandidates(long, two, embed, { chunkSize: 2 });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(result.judged).toBe(2);
  });

  it('시간이 다 되면 앞 묶음으로 판정한 이름만 결과에 남긴다', async () => {
    const answer = fakeEmbed(0.9);
    let calls = 0;
    const embed = vi.fn<EmbedTexts>((texts) => {
      calls += 1;
      return calls === 1 ? answer(texts) : new Promise<number[][]>(() => {});
    });
    const result = await decideCandidates(long, two, embed, { chunkSize: 2, timeoutMs: 50 });
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[0]![0]).toHaveLength(2);
    expect(result.judged).toBe(1);
    expect(result.confirmed).toEqual(new Set(['ルシア']));
    expect(result.confirmed.has('ミラ')).toBe(false);
    expect(result.rejected.has('ミラ')).toBe(false);
  });

  it('두 번째 묶음에서 embed가 실패해도 앞 판정은 남긴다', async () => {
    const answer = fakeEmbed(0.9);
    let calls = 0;
    const embed = vi.fn<EmbedTexts>(async (texts) => {
      calls += 1;
      if (calls > 1) throw new Error('model down');
      return answer(texts);
    });
    const result = await decideCandidates(long, two, embed, { chunkSize: 2 });
    expect(result.judged).toBe(1);
    expect(result.confirmed).toEqual(new Set(['ルシア']));
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
