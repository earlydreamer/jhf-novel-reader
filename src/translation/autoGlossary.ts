import type { ProviderSession, SelectedModel, SourceSnapshot } from '../contracts/reading';
import { isUnsafeTermName, type GuidanceRepository, type GuidanceTerm } from './guidance';
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

/**
 * 이 회차 원문에서 용어집에 아직 없는 규칙 후보(루비, 회차 안에서 2번 이상 나온 가타카나 이름).
 * 용어집의 모든 항목(출처 무관)의 source·aliases에 있는 이름은 뺀다. 미확정('auto') 이름도 제외해야
 * 회차마다 같은 후보로 생성 요청이 반복되지 않는다.
 */
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
  const knownNames = new Set(known.flatMap((term) => [term.source, ...term.aliases]).map(nameKey));
  return scan
    .result()
    .map((candidate) => candidate.source)
    .filter((source) => !knownNames.has(nameKey(source)));
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
 * 응답 검증: 배열 아님·형식 오류는 []. 각 항목은 원문에 실제로 나오고, 한 글자·짧은 히라가나 원문이 아니고,
 * 표기에 한글이 있고 가나가 없고, 80자 이하. 최대 40개, NFKC 기준 중복 제거. 분류가 목록에 없으면 '기타'로 둔다.
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
      isUnsafeTermName(source) ||
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
 * 병합: 사람·'scan'·'model' 항목과 같은 이름(source·aliases, NFKC)은 건드리지 않는다.
 * 'auto' 항목과 같은 이름이면 그 항목을 제자리에서 'model'로 바꾼다(표기·분류는 제안 값, 이름·별칭·메모는 기존 값).
 * 나머지 새 항목만 origin 'model'로 뒤에 추가한다.
 */
export function mergeGlossaryProposals(
  terms: readonly GuidanceTerm[],
  proposals: readonly GlossaryProposal[],
): GuidanceTerm[] {
  const names = new Set(terms.flatMap((term) => [term.source, ...term.aliases]).map(nameKey));
  const autoAt = new Map<string, number>();
  terms.forEach((term, index) => {
    if (term.origin !== 'auto') return;
    for (const name of [term.source, ...term.aliases]) autoAt.set(nameKey(name), index);
  });
  const merged = [...terms];
  const added: GuidanceTerm[] = [];
  for (const proposal of proposals) {
    const key = nameKey(proposal.source);
    const index = autoAt.get(key);
    if (index !== undefined) {
      const auto = terms[index]!;
      merged[index] = {
        source: auto.source,
        target: proposal.target,
        aliases: [...auto.aliases],
        category: proposal.category,
        note: auto.note,
        origin: 'model',
      };
      for (const name of [auto.source, ...auto.aliases]) autoAt.delete(nameKey(name));
      continue;
    }
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
  return [...merged, ...added];
}

export type AutoGlossaryResult = 'skipped' | 'added';

/** 번역 직전 자동 용어집. 후보가 없으면 건너뛰고, 새 항목만 'model'로 저장한다. 실패는 throw. */
export function createAutoGlossary(
  createProvider: (selection: SelectedModel) => ProviderSession,
  guidance: GuidanceRepository,
): (input: {
  workId: string;
  source: SourceSnapshot;
  selection: SelectedModel;
  signal: AbortSignal;
}) => Promise<AutoGlossaryResult> {
  return async ({ workId, source, selection, signal }) => {
    const session = createProvider(selection);
    if (!session.completeJson) return 'skipped';
    const current = await guidance.read(workId);
    const known = current?.terms ?? [];
    const candidates = autoGlossaryCandidates(source.paragraphs, known);
    if (!shouldGenerateGlossary(candidates, known)) return 'skipped';
    // 작은 모델의 맥락 한도 대비. 이름은 보통 회차 앞부분에 나온다.
    const text = source.paragraphs
      .filter((paragraph) => paragraph.text.trim())
      .map((paragraph) => paragraph.text)
      .join('\n')
      .slice(0, 12000);
    const value = await session.completeJson(glossaryRequest(text, candidates), signal);
    const proposals = parseGlossaryProposals(value, text);
    if (!proposals.length) return 'skipped';
    // 생성 요청 동안 사람이 고친 내용을 보존하려고 저장 직전에 다시 읽는다.
    const latest = await guidance.read(workId);
    const latestTerms = latest?.terms ?? [];
    const terms = mergeGlossaryProposals(latestTerms, proposals);
    const changed =
      terms.length !== latestTerms.length ||
      terms.some((term, index) => term !== latestTerms[index]);
    if (!changed) return 'skipped';
    await guidance.save(workId, {
      terms,
      voices: latest?.voices ?? [],
      ...(latest?.plotSummary !== undefined ? { plotSummary: latest.plotSummary } : {}),
    });
    return 'added';
  };
}
