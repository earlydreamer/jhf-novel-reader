import type { Chapter } from '../contracts';
import type { GuidanceTerm } from './guidance';

export type NameCandidate = {
  source: string;
  reading?: string;
  kind: 'ruby' | 'katakana';
  count: number;
  chapterIds: string[];
};
/** 가운뎃점으로 이어진 이름(アルベルト・フォン)은 하나로 본다. 장음만 있는 연속은 제외한다. */
const KATAKANA_NAME = /[ァ-ヴ][ァ-ヴー]{2,}(?:・[ァ-ヴ][ァ-ヴー]+)*/g;
const nameKey = (name: string) => name.normalize('NFKC');

/**
 * 이미 가져온 회차 원문에서 용어집에 없는 고유명사 후보를 규칙으로 뽑는다(네트워크 요청 없음).
 * 루비 쌍은 작가가 읽기를 지정한 표기라 한 번만 나와도 후보로 둔다. 카타카나 연속은 일반
 * 외래어가 섞이므로 minCount 이상 반복될 때만 후보로 둔다. 확정과 한국어 표기는 사용자가 정한다.
 */
export function scanNameCandidates(
  chapters: readonly Pick<Chapter, 'chapterId' | 'paragraphs'>[],
  known: readonly GuidanceTerm[],
  preset: readonly GuidanceTerm[] = [],
  minCount = 2,
): NameCandidate[] {
  const knownKeys = new Set(
    [...known, ...preset].flatMap((term) => [term.source, ...term.aliases]).map(nameKey),
  );
  const found = new Map<string, NameCandidate>();
  const add = (
    source: string,
    kind: NameCandidate['kind'],
    chapterId: string,
    reading?: string,
  ) => {
    if (knownKeys.has(nameKey(source))) return;
    const entry = found.get(source) ?? {
      source,
      ...(reading ? { reading } : {}),
      kind,
      count: 0,
      chapterIds: [],
    };
    entry.count++;
    if (!entry.chapterIds.includes(chapterId)) entry.chapterIds.push(chapterId);
    found.set(source, entry);
  };
  for (const { chapterId, paragraphs } of chapters)
    for (const paragraph of paragraphs) {
      for (const ruby of paragraph.ruby)
        add(paragraph.text.slice(ruby.start, ruby.end), 'ruby', chapterId, ruby.reading);
      for (const match of paragraph.text.matchAll(KATAKANA_NAME))
        add(match[0], 'katakana', chapterId);
    }
  return [...found.values()]
    .filter((entry) => entry.kind === 'ruby' || entry.count >= minCount)
    .sort((left, right) => right.count - left.count);
}
