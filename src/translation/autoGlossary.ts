import type { GuidanceTerm } from './guidance';
import { createNameCandidateScan } from './scan';

export type GlossaryProposal = { source: string; target: string; category: string };

const CATEGORIES = ['인명', '지명', '조직', '작품명', '별명', '호칭', '기타'] as const;
const MAX_PROPOSALS = 40;
const MAX_NAME_LENGTH = 80;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const KANA = /[぀-ヿｦ-ﾟ]/;
const HANGUL = /[가-힣]/;
const nameKey = (name: string) => name.normalize('NFKC');
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 이 회차 원문에서 용어집에 아직 없는 규칙 후보(루비, 회차 안에서 2번 이상 나온 가타카나 이름). */
export function autoGlossaryCandidates(
  paragraphs: readonly {
    text: string;
    ruby: readonly { start: number; end: number; reading: string }[];
  }[],
  known: readonly GuidanceTerm[],
): string[] {
  const scan = createNameCandidateScan(known, [], 2);
  scan.add({
    chapterId: 'chapter',
    paragraphs: paragraphs.map((paragraph, index) => ({ id: `p${index}`, ...paragraph })),
  });
  return scan.result().map((candidate) => candidate.source);
}

/** 생성할지 판단: 규칙 후보가 있거나, 작품 용어집에 적용 항목이 하나도 없을 때(첫 회차, 한자 이름 추출용). */
export function shouldGenerateGlossary(
  candidates: readonly string[],
  known: readonly GuidanceTerm[],
): boolean {
  return candidates.length > 0 || !known.some((term) => term.origin !== 'auto');
}

/** 모델 요청 프롬프트와 JSON 스키마. */
export function glossaryRequest(
  chapterText: string,
  candidates: readonly string[],
): { system: string; user: string; schema: Record<string, unknown>; maxTokens: number } {
  return {
    system:
      'You build a Japanese-to-Korean translation glossary for a web novel. Return only JSON that matches the schema. Include only proper nouns and fixed epithets: people, places, organizations, titles of works, and nicknames. Exclude ordinary loanwords, onomatopoeia, interjections and common nouns. For Japanese names use standard Korean transliteration. Translate epithets and nicknames by meaning, not by sound. Every "source" must appear exactly as written in the chapter text.',
    user: `Candidate names found by a rule-based scan (some may be ordinary words):\n${candidates.join(' ')}\n\nAlso add proper nouns and epithets you find in this chapter.\n\nChapter text:\n${chapterText}`,
    schema: {
      type: 'object',
      properties: {
        terms: {
          type: 'array',
          maxItems: MAX_PROPOSALS,
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              category: { type: 'string', enum: [...CATEGORIES] },
            },
            required: ['source', 'target', 'category'],
            additionalProperties: false,
          },
        },
      },
      required: ['terms'],
      additionalProperties: false,
    },
    maxTokens: 1500,
  };
}

/**
 * 응답 검증: 배열 아님·형식 오류는 []. 각 항목은 원문에 실제로 나오고, 표기에 한글이 있고 가나가 없고,
 * 80자 이하. 최대 40개, NFKC 기준 중복 제거. 분류가 목록에 없으면 '기타'로 둔다.
 */
export function parseGlossaryProposals(value: unknown, chapterText: string): GlossaryProposal[] {
  const list = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.terms)
      ? value.terms
      : null;
  if (!list) return [];
  const seen = new Set<string>();
  const proposals: GlossaryProposal[] = [];
  for (const item of list) {
    if (proposals.length >= MAX_PROPOSALS) break;
    if (!isRecord(item) || typeof item.source !== 'string' || typeof item.target !== 'string')
      continue;
    const source = item.source.trim();
    const target = item.target.trim();
    if (
      !source ||
      source.length > MAX_NAME_LENGTH ||
      CONTROL.test(source) ||
      !chapterText.includes(source)
    )
      continue;
    if (
      !target ||
      target.length > MAX_NAME_LENGTH ||
      CONTROL.test(target) ||
      KANA.test(target) ||
      !HANGUL.test(target)
    )
      continue;
    const key = nameKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    const category =
      typeof item.category === 'string' && (CATEGORIES as readonly string[]).includes(item.category)
        ? item.category
        : '기타';
    proposals.push({ source, target, category });
  }
  return proposals;
}

/**
 * 병합: 이미 있는 이름(source·aliases, NFKC)은 출처와 관계없이 건드리지 않는다. 새 항목만 origin 'model'로 뒤에 추가한다.
 */
export function mergeGlossaryProposals(
  terms: readonly GuidanceTerm[],
  proposals: readonly GlossaryProposal[],
): GuidanceTerm[] {
  const names = new Set(terms.flatMap((term) => [term.source, ...term.aliases]).map(nameKey));
  const added: GuidanceTerm[] = [];
  for (const proposal of proposals) {
    const key = nameKey(proposal.source);
    if (names.has(key)) continue;
    names.add(key);
    added.push({
      source: proposal.source,
      target: proposal.target,
      aliases: [],
      category: proposal.category,
      note: '',
      origin: 'model',
    });
  }
  return [...terms, ...added];
}
