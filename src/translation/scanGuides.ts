import type { ScanCandidate } from './termScan';

/** 분류별 짧은 판정 지침(Skill형 모듈, #199). 후보에 맞는 것만 프롬프트에 넣어 작은 모델의 맥락을 아낀다. */
export type ScanGuide = { id: string; when(candidate: ScanCandidate): boolean; text: string };

export const SCAN_GUIDES: readonly ScanGuide[] = [
  {
    id: 'ruby',
    when: (candidate) => candidate.ruby !== undefined,
    text: "The author's ruby reading is authoritative for pronunciation. Base the Korean rendering on it.",
  },
  {
    id: 'historical',
    when: (candidate) => candidate.script === 'kanji' || candidate.script === 'mixed',
    text: 'If the name is a real Japanese historical person, place, era or work, use its established Korean rendering (for example 織田信長 → 오다 노부나가, 美濃 → 미노).',
  },
  {
    id: 'epithet',
    when: (candidate) => candidate.source.includes('の') || candidate.script === 'mixed',
    text: 'Epithets and nicknames are translated by meaning, not by sound. Use the provided kanji meanings; keep place names transliterated (for example 甲斐の虎 → 가이의 호랑이).',
  },
  {
    id: 'sino',
    when: (candidate) =>
      candidate.script === 'kanji' &&
      [...candidate.source].length <= 3 &&
      (candidate.kanji?.length ?? 0) > 0,
    text: 'Ranks, titles, institutions and common setting words written in kanji use the Sino-Korean reading from the provided Korean readings (for example 公爵 → 공작, 王都 → 왕도, 魔石 → 마석), unless the term is a Japanese personal or place name.',
  },
  {
    id: 'fantasy',
    when: (candidate) => candidate.script === 'katakana',
    text: 'Katakana names in fantasy settings are usually of Western origin. Guess the original spelling and render it as a Korean loanword (for example カミラ → 카밀라 for Camilla). Keep an existing rendering if it is a plausible reading of the same name.',
  },
];

/** 묶음 후보들에 맞는 지침(중복 없이, SCAN_GUIDES 순서). */
export function guidesFor(candidates: readonly ScanCandidate[]): ScanGuide[] {
  return SCAN_GUIDES.filter((guide) => candidates.some((candidate) => guide.when(candidate)));
}
