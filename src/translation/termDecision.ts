import type { GuidanceTerm } from './guidance';
import { findTermMatches, type TermMatch } from './termMatch';

/** 정규화된 벡터를 돌려주는 임베딩 함수. 기기 모델 연결은 주입받는 쪽이 맡는다. */
export type EmbedTexts = (texts: readonly string[]) => Promise<number[][]>;
export type CandidateDecision = {
  confirmed: ReadonlySet<string>;
  rejected: ReadonlySet<string>;
  /** 점수를 낸 이름 수(보류 포함). 기준 없음·상한 초과로 건너뛴 이름은 세지 않는다. */
  judged: number;
};

/** 기준 문맥과의 유사도가 이 값 이상이면 확정한다. */
export const DECISION_HIGH = 0.85;
/** 기준 문맥과의 유사도가 이 값 이하이면 제외한다. */
export const DECISION_LOW = 0.6;

const CONTEXT_CHARS = 40;
const CONTEXT_LIMIT = 3;
/** 한 번에 embed할 문맥 수. 느린 기기에서 시간이 다 되어도 앞 묶음 판정은 남긴다. */
const CHUNK_SIZE = 4;
const PREFIX = 'task: clustering | query: ';
/** 경계값 비교에서 부동소수점 오차로 0.85·0.6을 놓치지 않도록 두는 여유. */
const EPSILON = 1e-9;

type Judgment = { name: string; baseline: string[]; candidate: string[] };

const emptyDecision = (): CandidateDecision => ({
  confirmed: new Set(),
  rejected: new Set(),
  judged: 0,
});

/** 자리 앞뒤 40자(코드포인트)를 잘라 임베딩 입력 한 줄로 만든다. 줄바꿈은 공백으로 바꾼다. */
function contextAt(chars: readonly string[], start: number, end: number): string {
  return chars
    .slice(Math.max(0, start - CONTEXT_CHARS), Math.min(chars.length, end + CONTEXT_CHARS))
    .join('')
    .replace(/\r?\n|\r/g, ' ');
}

/**
 * 판정 대상을 고른다. 후보 자리가 있는 이름이면 확정 자리 유무와 상관없이 본다.
 * 기준은 같은 용어(그 이름 포함)의 확정 자리이고, 확정 문맥이 없으면 기준이 없으므로 뺀다.
 * 새로 필요한 문장 수가 maxTexts를 넘는 이름도 뺀다. 같은 문장은 한 번만 세므로 같은 용어의 기준 문맥은 여러 후보가 공유한다.
 */
function plan(
  input: string,
  terms: readonly GuidanceTerm[],
  maxTexts: number,
): { judgments: Judgment[]; texts: string[] } {
  const chars = [...input];
  const owner = new Map<string, GuidanceTerm>();
  for (const term of terms) {
    if (term.origin === 'auto') continue;
    for (const name of [term.source, ...term.aliases]) if (!owner.has(name)) owner.set(name, term);
  }
  const matches = findTermMatches(input, [...owner.keys()]);
  const confirmedByTerm = new Map<GuidanceTerm, TermMatch[]>();
  const candidateByName = new Map<string, TermMatch[]>();
  for (const match of matches) {
    const term = owner.get(match.name)!;
    if (match.confirmed) {
      confirmedByTerm.set(term, [...(confirmedByTerm.get(term) ?? []), match]);
    } else {
      candidateByName.set(match.name, [...(candidateByName.get(match.name) ?? []), match]);
    }
  }
  const judgments: Judgment[] = [];
  const texts = new Set<string>();
  // 후보 이름은 입력에서 먼저 나온 순서대로 판정한다.
  for (const name of candidateByName.keys()) {
    const term = owner.get(name)!;
    const baselineMatches = (confirmedByTerm.get(term) ?? []).slice(0, CONTEXT_LIMIT);
    // 같은 용어의 확정 문맥이 없으면 기준이 없으므로 보류한다.
    if (!baselineMatches.length) continue;
    const baseline = baselineMatches.map((m) => PREFIX + contextAt(chars, m.start, m.end));
    const candidate = candidateByName
      .get(name)!
      .slice(0, CONTEXT_LIMIT)
      .map((m) => PREFIX + contextAt(chars, m.start, m.end));
    const fresh = new Set([...baseline, ...candidate].filter((text) => !texts.has(text)));
    if (texts.size + fresh.size > maxTexts) continue;
    fresh.forEach((text) => texts.add(text));
    judgments.push({ name, baseline, candidate });
  }
  return { judgments, texts: [...texts] };
}

function cosine(left: readonly number[], right: readonly number[]): number {
  if (!left || !right || left.length !== right.length || !left.length) {
    throw new Error('embedding dimension mismatch');
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('invalid embedding');
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

/**
 * 후보 매칭이 그 용어를 가리키는지 문맥 임베딩으로 확정·제외한다. 보류한 이름은 결과에 넣지 않는다.
 * 판정 실패(embed 오류·벡터 불일치)는 던지지 않는다. 문맥은 작은 묶음으로 계산하고, 시간이 다 되거나 embed가 실패하면 그때까지 계산한 이름만 판정한다.
 */
export async function decideCandidates(
  input: string,
  terms: readonly GuidanceTerm[],
  embed: EmbedTexts,
  options: { timeoutMs?: number; maxTexts?: number; chunkSize?: number } = {},
): Promise<CandidateDecision> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxTexts = options.maxTexts ?? 24;
  const chunkSize = Math.max(1, options.chunkSize ?? CHUNK_SIZE);
  const { judgments, texts } = plan(input, terms, maxTexts);
  // 판정할 후보가 없으면 임베딩을 부르지 않는다.
  if (!judgments.length) return emptyDecision();
  const deadline = Date.now() + timeoutMs;
  const vectorOf = new Map<string, number[]>();
  // 작은 묶음으로 차례로 계산한다. 시간이 다 되거나 embed가 실패하면 멈추고, 그때까지 계산한 문맥으로만 판정한다.
  for (let index = 0; index < texts.length; index += chunkSize) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const part = texts.slice(index, index + chunkSize);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), remaining);
    });
    let vectors: number[][];
    try {
      vectors = await Promise.race([Promise.resolve().then(() => embed(part)), timeout]);
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }
    // 벡터 수가 다르면 어느 문맥의 벡터인지 알 수 없으므로 판정하지 않는다.
    if (vectors.length !== part.length) return emptyDecision();
    part.forEach((text, offset) => vectorOf.set(text, vectors[offset]!));
  }
  try {
    const confirmed = new Set<string>();
    const rejected = new Set<string>();
    let judged = 0;
    for (const { name, baseline, candidate } of judgments) {
      // 문맥이 다 계산되지 않은 이름은 판정하지 않는다(시간 초과로 남은 묶음).
      if (![...baseline, ...candidate].every((text) => vectorOf.has(text))) continue;
      const base = baseline.map((text) => vectorOf.get(text)!);
      const scores = candidate.map((text) => {
        const vector = vectorOf.get(text)!;
        return Math.max(...base.map((reference) => cosine(vector, reference)));
      });
      const score = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      judged += 1;
      if (score >= DECISION_HIGH - EPSILON) confirmed.add(name);
      else if (score <= DECISION_LOW + EPSILON) rejected.add(name);
    }
    return judged ? { confirmed, rejected, judged } : emptyDecision();
  } catch {
    return emptyDecision();
  }
}
