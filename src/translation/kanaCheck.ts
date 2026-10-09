/** 자음 계열. 가타카나 모라와 한글 초성을 이 계열로 맞춰 본다. */
type Series = 'k' | 's' | 't' | 'n' | 'h' | 'b' | 'm' | 'y' | 'r' | 'w' | 'v';

/** 가타카나 한 글자가 나타내는 계열들. 빈 배열은 판단에서 건너뛴다(작은 모음·촉음·장음 등). */
const KANA: Record<string, Series[]> = {};
const assign = (chars: string, series: Series[]) => {
  for (const char of chars) KANA[char] = series;
};
assign('カキクケコガギグゲゴヵヶ', ['k']);
assign('サシスセソザジズゼゾ', ['s']);
assign('ツヅ', ['s']);
assign('チヂ', ['t', 's']);
assign('タテトダデド', ['t']);
assign('ナニヌネノ', ['n']);
assign('ハヒヘホ', ['h']);
assign('フ', ['h', 'b']);
assign('バビブベボパピプペポヴヷヸヹヺ', ['b']);
assign('マミムメモ', ['m']);
assign('ヤユヨ', ['y']);
assign('ラリルレロ', ['r']);
assign('ワヰヱ', ['w']);
assign('アイウエオヲ', ['v']);
const SKIP = 'ッンー・ャュョァィゥェォヮ';

const KATAKANA_ONLY = /^[ァ-ヺー・]+$/;
const HANGUL_SYLLABLE = /[가-힣]/;

/** 가타카나 이름의 모라마다 계열 집합을 낸다. 작은 글자와 촉음·장음·가운뎃점은 건너뛴다. */
function katakanaMoras(source: string): Series[][] {
  const moras: Series[][] = [];
  for (const char of source) {
    if (SKIP.includes(char)) continue;
    const series = KANA[char];
    if (series) moras.push(series);
  }
  return moras;
}

/** 한글 음절마다 초성의 계열 하나를 낸다. ㅇ 초성은 가운뎃소리에 따라 y·w·v로 나눈다. */
function hangulSeries(target: string): Series[] {
  const series: Series[] = [];
  for (const char of target) {
    if (!HANGUL_SYLLABLE.test(char)) continue;
    const index = char.codePointAt(0)! - 0xac00;
    const initial = Math.floor(index / 588);
    const medial = Math.floor((index % 588) / 28);
    const value = INITIAL_SERIES[initial];
    if (value) series.push(value);
    else series.push(vowelSeries(medial));
  }
  return series;
}
/** 초성 순서: ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ */
const INITIAL_SERIES: (Series | undefined)[] = [
  'k',
  'k',
  'n',
  't',
  't',
  'r',
  'm',
  'b',
  'b',
  's',
  's',
  undefined,
  's',
  's',
  't',
  'k',
  't',
  'b',
  'h',
];
/** ㅇ 초성의 가운뎃소리: ㅑㅒㅕㅖㅛㅠ는 y, ㅘㅙㅚㅝㅞㅟ는 w, 그 밖은 v. */
function vowelSeries(medial: number): Series {
  if ([2, 3, 6, 7, 12, 17].includes(medial)) return 'y';
  if ([9, 10, 11, 14, 15, 16].includes(medial)) return 'w';
  return 'v';
}

/**
 * 가타카나 이름과 한국어 표기의 자음 뼈대가 크게 어긋나는지(#198). 표기를 정하지 않고 표시만 한다.
 * 가타카나만으로는 원어를 알 수 없으므로(カミラ: 가미라·카밀라 모두 가능) 관대하게 판단한다.
 */
export function kanaMismatch(source: string, target: string): boolean {
  if (!KATAKANA_ONLY.test(source)) return false;
  const kana = katakanaMoras(source);
  const hangul = hangulSeries(target);
  if (kana.length === 0 || hangul.length === 0) return false;
  const common = lcs(kana, hangul);
  return common / Math.max(kana.length, hangul.length) < 0.5;
}

/** 가타카나 모라(계열 집합)와 한글 계열의 최장 공통 부분열 길이. 한쪽이 집합이면 포함 여부로 맞춘다. */
function lcs(kana: Series[][], hangul: Series[]): number {
  const table = Array.from({ length: kana.length + 1 }, () =>
    new Array<number>(hangul.length + 1).fill(0),
  );
  for (let i = 1; i <= kana.length; i++) {
    for (let j = 1; j <= hangul.length; j++) {
      const matched = kana[i - 1]!.includes(hangul[j - 1]!);
      table[i]![j] = matched
        ? table[i - 1]![j - 1]! + 1
        : Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
    }
  }
  return table[kana.length]![hangul.length]!;
}
