import type { GuidanceTerm } from './guidance';
import type { Kanjidic } from './kanjidic';
import { kanaMismatch } from './kanaCheck';
import { createNameCandidateScan } from './scan';
import { isUnsafeTermName } from './termMatch';

export type ScanParagraph = {
  text: string;
  ruby: readonly { start: number; end: number; reading: string }[];
};
export type ScanChapter = { chapterId: string; paragraphs: readonly ScanParagraph[] };
export type ScanCandidate = {
  source: string;
  /** new=용어집에 없음, recheck=기계 항목(model·auto·scan) 재검증, suggest=사람 항목(제안만) */
  role: 'new' | 'recheck' | 'suggest';
  existing?: GuidanceTerm;
  count: number;
  chapterIds: string[];
  /** 앞뒤 40자 발췌, 최대 3개(가능하면 서로 다른 회차), 줄바꿈은 공백으로 */
  contexts: string[];
  /** 이 이름 구간에 정확히 붙은 루비 읽기(작가 지정) */
  ruby?: string;
  script: 'katakana' | 'kanji' | 'mixed' | 'other';
  /** 한자별 KANJIDIC2 힌트(사전이 주어졌을 때). 사전에 없는 한자는 뺀다. 한국어 음이 없으면 ko는 []. */
  kanji?: { char: string; ko: string[]; en: string[] }[];
  /** existing의 표기가 kanaMismatch로 어긋남(가타카나 이름일 때만) */
  kanaFlag?: boolean;
};

const CONTEXT_RADIUS = 40;
const CONTEXT_LIMIT = 3;
const HAN = /\p{Script=Han}/u;
const KANA_CHAR = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const KATAKANA_NAME = /^[ァ-ヺー・]+$/;

const nameKey = (name: string) => name.normalize('NFKC');

type Paragraph = { chapterId: string; text: string; norm: string; ruby: ScanParagraph['ruby'] };
type Hit = { order: number; paragraph: Paragraph; index: number; length: number };
type Group = { source: string; existing?: GuidanceTerm; aliasKeys: string[] };

/**
 * 회차 원문에서 정밀스캔 후보를 모은다(모델·네트워크 없음). 규칙 후보와 용어집 항목을 한 이름으로
 * 합치고, 원문에서 직접 세서 근거(발췌·루비·한자 힌트·발음 대조)를 붙인다.
 * only가 있으면 그 이름 목록으로 후보를 좁힌다. 목록 이름은 규칙에 안 잡혀도 원문에 있으면 후보가 되고,
 * 상한은 목록 길이(최대 200)이며 limit은 무시한다.
 */
export function collectScanCandidates(
  chapters: readonly ScanChapter[],
  terms: readonly GuidanceTerm[],
  dic?: Kanjidic | null,
  limit = 60,
  only?: readonly string[],
): ScanCandidate[] {
  const paragraphs: Paragraph[] = chapters.flatMap((chapter) =>
    chapter.paragraphs.map((paragraph) => ({
      chapterId: chapter.chapterId,
      text: paragraph.text,
      norm: paragraph.text.normalize('NFKC'),
      ruby: paragraph.ruby,
    })),
  );

  const groups: Group[] = [];
  const groupByKey = new Map<string, Group>();
  const addGroup = (source: string, existing?: GuidanceTerm) => {
    const group: Group = { source, ...(existing ? { existing } : {}), aliasKeys: [] };
    groups.push(group);
    return group;
  };
  // 용어집: 원문 이름을 먼저 등록하고 별칭은 비어 있는 키에만 건다(같은 키는 한 항목으로 본다).
  for (const term of terms) {
    const key = nameKey(term.source);
    if (!groupByKey.has(key)) groupByKey.set(key, addGroup(term.source, term));
  }
  for (const term of terms) {
    const group = groupByKey.get(nameKey(term.source));
    if (!group || group.existing !== term) continue;
    for (const alias of term.aliases) {
      const key = nameKey(alias);
      if (groupByKey.has(key)) continue;
      groupByKey.set(key, group);
      group.aliasKeys.push(key);
    }
  }
  // 규칙 후보: 용어집과 같은 이름이면 그 항목으로 합치고, 아니면 새 후보가 된다.
  const rules = createNameCandidateScan([], [], 2);
  for (const chapter of chapters) {
    rules.add({
      chapterId: chapter.chapterId,
      paragraphs: chapter.paragraphs.map((paragraph, index) => ({
        id: `${chapter.chapterId}#${index}`,
        text: paragraph.text,
        ruby: paragraph.ruby,
      })),
    });
  }
  for (const rule of rules.result()) {
    const key = nameKey(rule.source);
    if (!groupByKey.has(key)) groupByKey.set(key, addGroup(rule.source));
  }
  // 이름 목록: 규칙·용어집에 없는 목록 이름도 그룹으로 더해, 원문에 있으면 후보가 되게 한다.
  if (only) {
    for (const name of only) {
      const key = nameKey(name);
      if (!groupByKey.has(key)) groupByKey.set(key, addGroup(name));
    }
  }

  const candidates: ScanCandidate[] = [];
  for (const group of groups) {
    // 용어집·규칙·이름 목록 모두 한 글자·짧은 히라가나 이름은 후보로 올리지 않는다(#235).
    if (isUnsafeTermName(group.source)) continue;
    // 원문 근거: source를 직접 세고, source가 없으면 별칭으로 맞은 출현을 센다.
    const sourceKey = nameKey(group.source);
    let keys = [sourceKey];
    let hits = findHits(paragraphs, sourceKey);
    if (hits.length === 0) {
      keys = group.aliasKeys.filter((key) => findHits(paragraphs, key).length > 0);
      hits = keys
        .flatMap((key) => findHits(paragraphs, key))
        .sort((left, right) => left.order - right.order || left.index - right.index);
    }
    if (hits.length === 0) continue;

    const script = scriptOf(sourceKey);
    const ruby = rubyOf(paragraphs, keys);
    const kanji = dic && HAN.test(group.source) ? kanjiHints(group.source, dic) : undefined;
    const kanaFlag =
      script === 'katakana' && group.existing
        ? kanaMismatch(sourceKey, group.existing.target)
        : undefined;
    candidates.push({
      source: group.source,
      role: !group.existing ? 'new' : group.existing.origin === undefined ? 'suggest' : 'recheck',
      ...(group.existing ? { existing: group.existing } : {}),
      count: hits.length,
      chapterIds: [...new Set(hits.map((hit) => hit.paragraph.chapterId))],
      contexts: pickContexts(hits),
      ...(ruby !== undefined ? { ruby } : {}),
      script,
      ...(kanji ? { kanji } : {}),
      ...(kanaFlag !== undefined ? { kanaFlag } : {}),
    });
  }

  // 이름 목록이 있으면 목록에 든 이름(NFKC 키)만 남기고 상한은 목록 길이로 정한다.
  const onlyKeys = only ? new Set(only.map(nameKey)) : undefined;
  const picked = onlyKeys
    ? candidates.filter((candidate) => onlyKeys.has(nameKey(candidate.source)))
    : candidates;
  // 사람·기계 항목을 먼저, 그다음 새 후보. 같은 그룹 안에서는 등장 횟수, 이후 코드포인트 순.
  const rank = (candidate: ScanCandidate) => (candidate.role === 'new' ? 1 : 0);
  return picked
    .sort(
      (left, right) =>
        rank(left) - rank(right) ||
        right.count - left.count ||
        compareCodePoints(left.source, right.source),
    )
    .slice(0, only ? Math.min(only.length, 200) : limit);
}

function findHits(paragraphs: readonly Paragraph[], key: string): Hit[] {
  const hits: Hit[] = [];
  if (!key) return hits;
  paragraphs.forEach((paragraph, order) => {
    let index = paragraph.norm.indexOf(key);
    while (index !== -1) {
      hits.push({ order, paragraph, index, length: key.length });
      index = paragraph.norm.indexOf(key, index + key.length);
    }
  });
  return hits;
}

/** 서로 다른 회차의 첫 출현을 먼저 고르고, 고른 발췌는 원문 순서로 낸다. */
function pickContexts(hits: readonly Hit[]): string[] {
  const seen = new Set<string>();
  const firstPerChapter: Hit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.paragraph.chapterId)) continue;
    seen.add(hit.paragraph.chapterId);
    firstPerChapter.push(hit);
  }
  const chosen = new Set([...firstPerChapter, ...hits].slice(0, CONTEXT_LIMIT));
  return hits
    .filter((hit) => chosen.has(hit))
    .map(({ paragraph, index, length }) =>
      paragraph.norm
        .slice(Math.max(0, index - CONTEXT_RADIUS), index + length + CONTEXT_RADIUS)
        .replace(/[\r\n]+/g, ' '),
    );
}

/** 이름 구간의 루비 텍스트가 이름과 같으면 그 읽기를 낸다(처음 것). */
function rubyOf(paragraphs: readonly Paragraph[], keys: readonly string[]): string | undefined {
  for (const paragraph of paragraphs) {
    for (const ruby of paragraph.ruby) {
      const segment = nameKey(paragraph.text.slice(ruby.start, ruby.end));
      if (keys.includes(segment)) return ruby.reading;
    }
  }
  return undefined;
}

function scriptOf(source: string): ScanCandidate['script'] {
  const han = HAN.test(source);
  if (!han && KATAKANA_NAME.test(source) && /[ァ-ヺ]/.test(source)) return 'katakana';
  if (han && KANA_CHAR.test(source)) return 'mixed';
  if (han) return 'kanji';
  return 'other';
}

function kanjiHints(source: string, dic: Kanjidic): NonNullable<ScanCandidate['kanji']> {
  const chars = [...new Set(Array.from(source).filter((char) => HAN.test(char)))];
  const hints: NonNullable<ScanCandidate['kanji']> = [];
  for (const char of chars) {
    const info = dic.lookup(char);
    if (info) hints.push({ char, ko: info.ko, en: info.en.slice(0, 3) });
  }
  return hints;
}

function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (char) => char.codePointAt(0) ?? 0);
  const b = Array.from(right, (char) => char.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}
