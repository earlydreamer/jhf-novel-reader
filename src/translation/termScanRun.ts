import { ReaderError } from '../contracts';
import type {
  CompletedTranslation,
  LibraryStore,
  ProviderSession,
  SelectedModel,
} from '../contracts/reading';
import { kanaMismatch } from './kanaCheck';
import type { GuidanceEvidence, GuidanceRepository, GuidanceTerm } from './guidance';
import type { Kanjidic } from './kanjidic';
import {
  judgeRequest,
  parseJudge,
  voteJudgements,
  type JudgeAnswer,
  type JudgeKind,
  type VotedAnswer,
} from './termJudge';
import { collectScanCandidates, type ScanCandidate, type ScanChapter } from './termScan';

export type TermScanProgress = { stage: 'collect' | 'judge' | 'save'; done: number; total: number };
export type TermScanChange = {
  source: string;
  role: 'new' | 'recheck' | 'suggest';
  before?: string; // 기존 표기(new면 없음)
  after: string;
  kind: JudgeKind;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  kanaFlag?: boolean; // after가 kanaMismatch로 어긋남(가타카나일 때)
  evidence: GuidanceEvidence[];
};
export type TermScanResult = {
  applied: TermScanChange[]; // 저장한 변경(new 추가, recheck 표기 변경)
  confirmed: number; // recheck인데 표기가 같아 근거만 붙인 수
  suggestions: TermScanChange[]; // 사람 항목과 다른 제안(저장 안 함)
  partial: boolean; // 일부 묶음이 실패함
};

const BATCH_SIZE = 8;
const RUNS = 3;
const TEMPERATURES = [0, 0.7, 0.7] as const;
const NOTE_LIMIT = 200;
const CONFIDENCE_RANK: Record<TermScanChange['confidence'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const nameKey = (name: string) => name.normalize('NFKC');
const compact = (value: string) => value.replace(/\s+/g, '');

/** 근거 문구를 저장 제한(200 UTF-16 단위) 안으로 줄이고 제어문자는 공백으로 바꾼다. */
function clip(text: string): string {
  let out = '';
  for (const char of text.replace(/[\u0000-\u001f\u007f]/g, ' ')) {
    if (out.length + char.length > NOTE_LIMIT) break;
    out += char;
  }
  return out;
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ReaderError('cancelled');
}

function newestVersion(
  versions: readonly CompletedTranslation[],
): CompletedTranslation | undefined {
  return versions.reduce<CompletedTranslation | undefined>(
    (best, item) =>
      !best || Date.parse(item.createdAt) > Date.parse(best.createdAt) ? item : best,
    undefined,
  );
}

function evidenceOf(candidate: ScanCandidate, answer: VotedAnswer): GuidanceEvidence[] {
  const evidence: GuidanceEvidence[] = [];
  if (candidate.ruby !== undefined) {
    evidence.push({ kind: 'ruby', note: clip(`루비: ${candidate.ruby}`) });
  }
  if (candidate.kanji?.length) {
    const hints = candidate.kanji.map(({ char, ko }) => `${char}=${ko.join('/') || '?'}`);
    evidence.push({ kind: 'kanjidic', note: clip(hints.join(' ')) });
  }
  const reason = answer.reason ? ` · ${answer.reason}` : '';
  evidence.push({ kind: 'model', note: clip(`판정 ${answer.votes}/${answer.total}${reason}`) });
  return evidence;
}

function sortChanges(items: TermScanChange[]): void {
  items.sort(
    (left, right) =>
      CONFIDENCE_RANK[left.confidence] - CONFIDENCE_RANK[right.confidence] ||
      (left.source < right.source ? -1 : left.source > right.source ? 1 : 0),
  );
}

/**
 * 정밀스캔 실행기: 저장본 원문 → 후보 수집 → 묶음별 3회 판정·다수결 → 변경 만들기 → 저장 직전
 * 재확인 후 반영. 실패한 요청은 그 run을 빈 답으로 치고 partial로 표시한다. 취소는 저장 없이 던진다.
 */
export function createTermScan(deps: {
  createProvider(selection: SelectedModel): ProviderSession;
  guidance: GuidanceRepository;
  library: Pick<LibraryStore, 'listVersions'>;
  loadKanjidic(): Promise<Kanjidic>;
}): (input: {
  workId: string;
  chapterIds: readonly string[];
  selection: SelectedModel;
  signal: AbortSignal;
  onProgress?(progress: TermScanProgress): void;
}) => Promise<TermScanResult> {
  return async ({ workId, chapterIds, selection, signal, onProgress }) => {
    const session = deps.createProvider(selection);
    const complete = session.completeJson?.bind(session);
    if (!complete) throw new ReaderError('model_missing');
    cancelled(signal);

    // 1. 회차마다 가장 늦은 저장본의 원문. 저장본이 없는 회차는 건너뛴다.
    const chapters: ScanChapter[] = [];
    for (const [index, chapterId] of chapterIds.entries()) {
      cancelled(signal);
      const latest = newestVersion(await deps.library.listVersions(chapterId));
      if (latest) {
        chapters.push({
          chapterId,
          paragraphs: latest.source.paragraphs.map(({ text, ruby }) => ({ text, ruby })),
        });
      }
      onProgress?.({ stage: 'collect', done: index + 1, total: chapterIds.length });
    }

    // 2. 후보 수집. 사전을 못 불러와도 계속한다(한자 힌트만 빠진다).
    const dic = await deps.loadKanjidic().catch(() => null);
    cancelled(signal);
    const terms = (await deps.guidance.read(workId))?.terms ?? [];
    const candidates = collectScanCandidates(chapters, terms, dic);
    if (!candidates.length) return { applied: [], confirmed: 0, suggestions: [], partial: false };

    // 3. 묶음별 3회 판정. 1회차는 온도 0, 나머지는 0.7이다.
    const batches: ScanCandidate[][] = [];
    for (let index = 0; index < candidates.length; index += BATCH_SIZE) {
      batches.push(candidates.slice(index, index + BATCH_SIZE));
    }
    const judgeTotal = batches.length * RUNS;
    let judgeDone = 0;
    let partial = false;
    const voted = new Map<string, VotedAnswer>();
    for (const batch of batches) {
      const request = judgeRequest(batch);
      const runs: Map<string, JudgeAnswer>[] = [];
      for (const temperature of TEMPERATURES) {
        let run = new Map<string, JudgeAnswer>();
        try {
          const value = await complete(
            {
              system: request.system,
              user: request.user,
              schema: request.schema,
              maxTokens: request.maxTokens,
              temperature,
            },
            signal,
          );
          run = parseJudge(value, batch);
        } catch (error) {
          if (error instanceof ReaderError && error.code === 'cancelled') throw error;
          cancelled(signal);
          partial = true;
        }
        cancelled(signal);
        runs.push(run);
        judgeDone += 1;
        onProgress?.({ stage: 'judge', done: judgeDone, total: judgeTotal });
      }
      for (const [source, answer] of voteJudgements(runs, batch)) voted.set(source, answer);
    }

    // 4. 변경 만들기. 저장 직전 재확인이 필요한 계획(planned)과 바로 제안(suggestions)으로 나눈다.
    const planned: { change: TermScanChange; confirmed: boolean }[] = [];
    const suggestions: TermScanChange[] = [];
    for (const candidate of candidates) {
      const answer = voted.get(candidate.source);
      if (!answer || answer.kind === 'common') continue;
      const before = candidate.existing?.target;
      const kanaFlag =
        candidate.script === 'katakana'
          ? kanaMismatch(nameKey(candidate.source), answer.target)
          : undefined;
      const change: TermScanChange = {
        source: candidate.source,
        role: candidate.role,
        ...(before !== undefined ? { before } : {}),
        after: answer.target,
        kind: answer.kind,
        category: answer.category,
        confidence: kanaFlag ? 'low' : answer.confidence,
        reason: answer.reason,
        ...(kanaFlag !== undefined ? { kanaFlag } : {}),
        evidence: evidenceOf(candidate, answer),
      };
      if (candidate.role === 'suggest') {
        if (before !== undefined && compact(before) !== compact(answer.target)) {
          suggestions.push(change);
        }
        continue;
      }
      const same = before !== undefined && compact(before) === compact(answer.target);
      planned.push({ change, confirmed: candidate.role === 'recheck' && same });
    }

    // 5. 저장 직전 재확인. 그사이 사람이 고친 내용은 보존하고 제안으로 옮긴다.
    const applied: TermScanChange[] = [];
    const moved: TermScanChange[] = [];
    let confirmed = 0;
    if (planned.length) {
      cancelled(signal);
      const latest = await deps.guidance.read(workId);
      const latestTerms = latest?.terms ?? [];
      const next = [...latestTerms];
      const names = new Set(
        latestTerms.flatMap((item) => [item.source, ...item.aliases]).map(nameKey),
      );
      for (const { change, confirmed: isConfirmed } of planned) {
        if (change.role === 'new') {
          if (names.has(nameKey(change.source))) continue;
          names.add(nameKey(change.source));
          next.push({
            source: change.source,
            target: change.after,
            aliases: [],
            category: change.category,
            note: '',
            origin: 'scan',
            evidence: change.evidence,
          });
          applied.push(change);
          continue;
        }
        const index = next.findIndex((item) => nameKey(item.source) === nameKey(change.source));
        const current = next[index];
        if (!current) continue;
        if (current.origin === undefined) {
          // 사람이 항목을 가져갔다. 표기가 다를 때만 제안으로 남긴다.
          if (compact(current.target) !== compact(change.after)) {
            moved.push({ ...change, role: 'suggest', before: current.target });
          }
          continue;
        }
        // 기존 정밀스캔 항목은 더 강한 근거(신뢰도 높음)일 때만 바꾼다(설계 §3). 그 밖에는 제안으로 남겨 재스캔마다 표기가 뒤집히지 않게 한다.
        if (
          current.origin === 'scan' &&
          !isConfirmed &&
          change.confidence !== 'high' &&
          compact(current.target) !== compact(change.after)
        ) {
          moved.push({ ...change, role: 'suggest', before: current.target });
          continue;
        }
        next[index] = {
          source: current.source,
          target: isConfirmed ? current.target : change.after,
          aliases: [...current.aliases],
          category: change.category,
          note: current.note,
          origin: 'scan',
          evidence: change.evidence,
        };
        if (isConfirmed) confirmed += 1;
        else applied.push(change);
      }
      const changed =
        next.length !== latestTerms.length ||
        next.some((item, index) => item !== latestTerms[index]);
      if (changed) {
        cancelled(signal);
        await deps.guidance.save(workId, {
          terms: next,
          voices: latest?.voices ?? [],
          ...(latest?.plotSummary !== undefined ? { plotSummary: latest.plotSummary } : {}),
        });
      }
      onProgress?.({ stage: 'save', done: 1, total: 1 });
    }

    const result = {
      applied,
      confirmed,
      suggestions: [...suggestions, ...moved],
      partial,
    };
    sortChanges(result.applied);
    sortChanges(result.suggestions);
    return result;
  };
}

/** 결과 화면의 항목별 되돌리기. 새 항목은 제거하고, 표기를 바꾼 항목은 original로 돌린다. 사람이 고친 뒤의 항목은 건드리지 않는다. */
export function revertScanChange(
  terms: readonly GuidanceTerm[],
  change: TermScanChange,
  original: GuidanceTerm | undefined,
): GuidanceTerm[] {
  const index = terms.findIndex((item) => nameKey(item.source) === nameKey(change.source));
  const current = terms[index];
  if (!current || current.origin !== 'scan') return [...terms];
  if (change.role === 'new') return terms.filter((_, position) => position !== index);
  if (!original) return [...terms];
  return terms.map((item, position) => (position === index ? original : item));
}

/**
 * 제안 적용. 사람 항목은 표기만 after로 바꾸고 그대로 둔다. 정밀스캔 항목은 표기를 after로 바꾸고
 * 사람이 고른 결정으로 보아 사람 항목으로 만든다(origin·evidence 제거). 그 밖의 기계 항목은 그대로 둔다.
 */
export function applySuggestion(
  terms: readonly GuidanceTerm[],
  change: TermScanChange,
): GuidanceTerm[] {
  return terms.map((item) => {
    if (nameKey(item.source) !== nameKey(change.source)) return item;
    if (item.origin === undefined) return { ...item, target: change.after };
    if (item.origin === 'scan') {
      return {
        source: item.source,
        target: change.after,
        aliases: [...item.aliases],
        category: item.category,
        note: item.note,
      };
    }
    return item;
  });
}
