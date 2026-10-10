import { describe, expect, it } from 'vitest';
import { charClass, findTermMatches } from '../../src/translation/termMatch';

describe('charClass', () => {
  it('글자 종류', () => {
    expect(charClass('ア')).toBe('katakana');
    expect(charClass('ー')).toBe('katakana');
    expect(charClass('・')).toBe('katakana');
    expect(charClass('魔')).toBe('kanji');
    expect(charClass('々')).toBe('kanji');
    expect(charClass('の')).toBe('hiragana');
    expect(charClass('「')).toBe('other');
    expect(charClass('A')).toBe('other');
  });
});

describe('findTermMatches', () => {
  const hit = (input: string, names: string[]) =>
    findTermMatches(input, names).map(({ name, confirmed }) => `${name}:${confirmed ? 'O' : '?'}`);

  it('가타카나 덩어리 전체와 일치하면 확정', () => {
    expect(hit('ルシアナは笑った', ['ルシアナ'])).toEqual(['ルシアナ:O']);
    expect(hit('「ルシアナ様」', ['ルシアナ'])).toEqual(['ルシアナ:O']);
  });
  it('덩어리 일부면 후보', () => {
    expect(hit('クリストファーが来た', ['リスト'])).toEqual(['リスト:?']);
    expect(hit('アルベルト・フォン', ['アルベルト'])).toEqual(['アルベルト:?']);
  });
  it('한자 이름 뒤 흔한 접미(様·殿·家 등)는 경계로 본다', () => {
    expect(hit('斎藤道三様が', ['斎藤道三'])).toEqual(['斎藤道三:O']);
    expect(hit('魔王城へ', ['魔王'])).toEqual(['魔王:?']);
    expect(hit('魔王が', ['魔王'])).toEqual(['魔王:O']);
  });
  it('짧은 이름(isUnsafeTermName)은 아예 찾지 않는다', () => {
    expect(hit('ちょっと待って', ['ち'])).toEqual([]);
    expect(hit('希望がある', ['希'])).toEqual([]);
  });
  it('긴 이름이 먼저 잡히고 그 구간 안의 짧은 이름은 따로 잡히지 않는다', () => {
    expect(hit('ルシアナ・ルトルバーグが', ['ルシアナ', 'ルシアナ・ルトルバーグ'])).toEqual([
      'ルシアナ・ルトルバーグ:O',
    ]);
  });
  it('같은 이름이 여러 번 나오면 각각 판정한다', () => {
    expect(hit('リストを見たクリストファー', ['リスト'])).toEqual(['リスト:O', 'リスト:?']);
  });
  it('전각·반각을 같은 글자로 보지 않는다(원문 그대로 비교)', () => {
    expect(hit('ﾙｼｱﾅが', ['ルシアナ'])).toEqual([]);
  });
});
