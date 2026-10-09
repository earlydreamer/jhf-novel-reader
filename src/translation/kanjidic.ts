export type KanjiInfo = { ko: string[]; en: string[] };
export type Kanjidic = { version: string; lookup(char: string): KanjiInfo | null };

// 값은 [한국어 한자음, 영어 뜻]의 '|' 이음이다. JSON 추론이 튜플을 배열로 넓히므로 배열로 받는다.
type KanjidicFile = { version: string; source: string; k: Record<string, string[]> };

const HAN = /\p{Script=Han}/u;

function splitValues(value: string): string[] {
  return value === '' ? [] : value.split('|');
}

/** 정밀스캔·자동 용어집이 쓸 때만 불러온다(별도 청크로 분리, 첫 화면 번들에 넣지 않는다). */
export async function loadKanjidic(): Promise<Kanjidic> {
  // 모듈 최상위에서 정적 import하면 첫 화면 번들에 들어가므로 호출 시점에만 가져온다.
  const module = await import('./kanjidic.json');
  const data = module.default as KanjidicFile;
  const entries = new Map<string, KanjiInfo>();
  for (const [char, [ko = '', en = ''] = []] of Object.entries(data.k)) {
    entries.set(char, { ko: splitValues(ko), en: splitValues(en) });
  }
  return {
    version: data.version,
    lookup: (char) => entries.get(char) ?? null,
  };
}

/** 한자어의 글자별 한국어 한자음 후보. 한자가 아닌 글자는 [그 글자], 사전에 없는 한자는 null. */
export function sinoKoreanReadings(dic: Kanjidic, term: string): (string[] | null)[] {
  return Array.from(term, (char) => {
    if (!HAN.test(char)) return [char];
    return dic.lookup(char)?.ko ?? null;
  });
}
