export type CharClass = 'katakana' | 'kanji' | 'hiragana' | 'other';
export type TermMatch = { name: string; start: number; end: number; confirmed: boolean };

/** 한자 이름 뒤에 붙어도 이름의 경계로 보는 흔한 접미(경칭·가문). */
const KANJI_SUFFIXES = new Set(['様', '殿', '家', '君', '氏', '卿', '嬢', '達']);
const shortHiragana = /^[\p{Script=Hiragana}ー]{1,2}$/u;

export function charClass(char: string): CharClass {
  if (/[\p{Script=Katakana}ー・]/u.test(char)) return 'katakana';
  if (/[\p{Script=Han}々〆ヶ]/u.test(char)) return 'kanji';
  if (/\p{Script=Hiragana}/u.test(char)) return 'hiragana';
  return 'other';
}

/** 다른 단어 안에도 흔히 들어 있어 이름으로 찾으면 안 되는 원문: 한 글자, 또는 두 글자 이하 히라가나(장음 포함)만. */
export function isUnsafeTermName(name: string): boolean {
  const compact = name.normalize('NFKC').replace(/\s/g, '');
  return [...compact].length <= 1 || shortHiragana.test(compact);
}

/**
 * 입력에서 이름을 찾는다. 긴 이름부터, 이미 잡힌 구간과 겹치지 않게 찾는다.
 * 원문 글자 그대로 비교한다(전각·반각을 같게 보지 않는다). 예전 말투 매칭과 같은 기준이라 적용 해시가 유지된다.
 * 이름의 첫 글자와 같은 종류의 글자가 바로 앞에, 마지막 글자와 같은 종류가 바로 뒤에 붙어 있으면
 * 더 긴 단어의 일부일 수 있으므로 후보(confirmed=false)로 둔다. 한자 이름 뒤의 흔한 접미는 경계로 본다.
 * 짧은 이름(isUnsafeTermName)은 찾지 않는다.
 */
export function findTermMatches(input: string, names: readonly string[]): TermMatch[] {
  const chars = [...input];
  const taken = new Array<boolean>(chars.length).fill(false);
  const result: TermMatch[] = [];
  // 정렬은 예전 matchedNames와 같게 UTF-16 길이 기준이다.
  const unique = [...new Set(names)]
    .filter((name) => name && !isUnsafeTermName(name))
    .sort((left, right) => right.length - left.length);
  for (const name of unique) {
    const target = [...name];
    for (let start = 0; start + target.length <= chars.length; start++) {
      let same = true;
      for (let k = 0; k < target.length; k++) {
        if (taken[start + k] || chars[start + k] !== target[k]) {
          same = false;
          break;
        }
      }
      if (!same) continue;
      const end = start + target.length;
      const before = start > 0 ? chars[start - 1]! : '';
      const after = end < chars.length ? chars[end]! : '';
      const first = charClass(target[0]!);
      const last = charClass(target[target.length - 1]!);
      const joinedBefore = before !== '' && first !== 'other' && charClass(before) === first;
      const joinedAfter =
        after !== '' &&
        last !== 'other' &&
        charClass(after) === last &&
        !(last === 'kanji' && KANJI_SUFFIXES.has(after));
      for (let k = start; k < end; k++) taken[k] = true;
      result.push({
        name,
        start,
        end,
        confirmed: !joinedBefore && !joinedAfter,
      });
      start = end - 1;
    }
  }
  return result.sort((left, right) => left.start - right.start);
}
