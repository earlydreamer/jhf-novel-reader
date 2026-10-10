import type { LookupHit } from './lookup';
import { guidesFor } from './scanGuides';
import type { ScanCandidate } from './termScan';

export type JudgeKind = 'real' | 'work' | 'common';
export type JudgeAnswer = { kind: JudgeKind; category: string; target: string; reason: string };
export type VotedAnswer = JudgeAnswer & {
  votes: number;
  total: number;
  confidence: 'high' | 'medium' | 'low';
};

const KINDS: readonly JudgeKind[] = ['real', 'work', 'common'];
const CATEGORIES: readonly string[] = ['인명', '지명', '조직', '작품명', '별명', '호칭', '기타'];
const SYSTEM =
  'You decide Korean renderings for names in a Japanese web novel glossary. For each candidate decide: kind ("real" for real-world people, places and works; "work" for names invented in this story; "common" for ordinary words that are not names), category, and the Korean rendering. Use the contexts to understand what the name refers to. Return only JSON that matches the schema. Render every part of the source name (title, epithet, given name, family name) and add no family name, title or other part that the source does not contain, even for well-known real people. Every target must be written in Hangul without kana. Write each reason as one short sentence in Korean.';
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          category: { type: 'string', enum: CATEGORIES },
          target: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['id', 'kind', 'category', 'target', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};
const LOOKUP_GUIDE =
  'Lookup lines come from Korean Wikipedia, Wikidata or Namuwiki. Prefer a lookup rendering when the contexts refer to the same person, place or work, and ignore it when it clearly refers to something else. For names invented in this story, an author ruby reading still comes first. A "refers to" line only tells who or what the name points to; it is context, not the rendering.';
const HANGUL = /\p{Script=Hangul}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const CONTROL = /\p{Cc}/u;
const REASON_LIMIT = 200;
const TARGET_LIMIT = 80;

const idOf = (index: number) => `c${index + 1}`;

/**
 * 묶음 후보로 판정 요청(system·user·스키마·출력 상한)을 만든다. 모델은 부르지 않는다.
 * lookups는 후보 source별 외부 조회 근거이며, 묶음에 조회 줄이 하나라도 있을 때만 지침 문장을 더한다.
 */
export function judgeRequest(
  batch: readonly ScanCandidate[],
  lookups?: ReadonlyMap<string, readonly LookupHit[]>,
): {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
} {
  const guides = guidesFor(batch).map((guide) => `- ${guide.text}`);
  const hasLookup = batch.some((candidate) => (lookups?.get(candidate.source)?.length ?? 0) > 0);
  return {
    system: [SYSTEM, ...(hasLookup ? [LOOKUP_GUIDE] : []), 'Guides:', ...guides].join('\n'),
    user: batch
      .map((candidate, index) =>
        candidateBlock(idOf(index), candidate, lookups?.get(candidate.source) ?? []),
      )
      .join('\n\n'),
    schema: SCHEMA,
    maxTokens: batch.length * 120 + 200,
  };
}

function candidateBlock(id: string, candidate: ScanCandidate, hits: readonly LookupHit[]): string {
  const lines = [`[${id}] ${candidate.source}`];
  if (candidate.existing) {
    const origin = candidate.existing.origin === undefined ? 'human' : 'machine';
    lines.push(`existing: ${candidate.existing.target} (${origin})`);
  }
  if (candidate.ruby !== undefined) lines.push(`ruby: ${candidate.ruby}`);
  if (candidate.kanji?.length) {
    const hints = candidate.kanji.map(({ char, ko, en }) => {
      const reading = ko.length ? ko.join('/') : '?';
      return en[0] ? `${char}=${reading}(${en[0]})` : `${char}=${reading}`;
    });
    lines.push(`kanji: ${hints.join(' ')}`);
  }
  for (const hit of hits) {
    lines.push(
      hit.refers
        ? `lookup: refers to ${hit.ko} (${hit.kind} search)`
        : `lookup: ${hit.ko} (${hit.kind}${hit.exact ? ', exact link' : ''})`,
    );
  }
  lines.push('contexts:', ...candidate.contexts.map((context) => `- ${context}`));
  return lines.join('\n');
}

/**
 * 모델 응답을 묶음 후보에 맞춰 검증한다. {items} 또는 맨 배열을 받고, 모르는 id·enum 밖 kind·
 * 가나/한글 없음/제어문자/길이 위반 목표는 그 항목만 뺀다. 같은 id는 처음 것만 쓴다.
 */
export function parseJudge(
  value: unknown,
  batch: readonly ScanCandidate[],
): Map<string, JudgeAnswer> {
  const items: unknown[] = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : [];
  const sourceById = new Map(batch.map((candidate, index) => [idOf(index), candidate.source]));
  const result = new Map<string, JudgeAnswer>();
  const seen = new Set<unknown>();
  for (const item of items) {
    if (!isRecord(item) || seen.has(item.id)) continue;
    seen.add(item.id);
    const source = typeof item.id === 'string' ? sourceById.get(item.id) : undefined;
    if (source === undefined) continue;
    const kind = KINDS.find((value) => value === item.kind);
    if (!kind) continue;
    const target = typeof item.target === 'string' ? item.target.trim() : '';
    if (!validTarget(target)) continue;
    const category = CATEGORIES.find((value) => value === item.category) ?? '기타';
    const reason =
      typeof item.reason === 'string' ? [...item.reason].slice(0, REASON_LIMIT).join('') : '';
    result.set(source, { kind, category, target, reason });
  }
  return result;
}

/**
 * 여러 회차의 판정을 후보별로 다수결한다. 목표는 공백을 뺀 기준으로 세고, 동률이면 run 순서상
 * 먼저 나온 것을 고른다. 답이 없는 run은 total에만 센다.
 */
export function voteJudgements(
  runs: readonly Map<string, JudgeAnswer>[],
  batch: readonly ScanCandidate[],
): Map<string, VotedAnswer> {
  const result = new Map<string, VotedAnswer>();
  for (const candidate of batch) {
    const answers = runs.flatMap((run) => {
      const answer = run.get(candidate.source);
      return answer ? [answer] : [];
    });
    const target = majority(answers, (answer) => answer.target.replace(/\s+/g, ''));
    const kind = majority(answers, (answer) => answer.kind);
    const category = majority(answers, (answer) => answer.category);
    if (!target || !kind || !category) continue;
    const total = runs.length;
    const votes = target.votes;
    result.set(candidate.source, {
      kind: kind.item.kind,
      category: category.item.category,
      target: target.item.target,
      reason: target.item.reason,
      votes,
      total,
      confidence: votes === total && total >= 3 ? 'high' : votes >= 2 ? 'medium' : 'low',
    });
  }
  return result;
}

/** 최다 표 항목과 표 수. 동률이면 처음 나온 항목이다. 항목이 없으면 undefined. */
function majority<T>(
  items: readonly T[],
  key: (item: T) => string,
): { item: T; votes: number } | undefined {
  const tally = new Map<string, { item: T; votes: number }>();
  for (const item of items) {
    const entry = tally.get(key(item));
    if (entry) entry.votes += 1;
    else tally.set(key(item), { item, votes: 1 });
  }
  let best: { item: T; votes: number } | undefined;
  for (const entry of tally.values()) if (!best || entry.votes > best.votes) best = entry;
  return best;
}

function validTarget(target: string): boolean {
  const length = [...target].length;
  return (
    length >= 1 &&
    length <= TARGET_LIMIT &&
    HANGUL.test(target) &&
    !KANA.test(target) &&
    !CONTROL.test(target)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
