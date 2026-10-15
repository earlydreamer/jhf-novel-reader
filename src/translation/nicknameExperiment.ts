import { ReaderError } from '../contracts';
import type { ProviderSession } from '../contracts/reading';
import type { Kanjidic } from './kanjidic';
import type { LookupHit } from './lookup';
import { collectNicknameMeanings } from './nicknameMeaning';
import { judgeRequest, parseJudge, voteJudgements, type JudgeKind } from './termJudge';
import { collectScanCandidates } from './termScan';

export type NicknameCase = {
  id: string;
  source: string;
  contexts: string[];
  expected: string[];
  kind: JudgeKind;
  categories: string[];
  nickname: boolean;
  refers?: string;
};
export type Trial = {
  arm: 'baseline' | 'meaning';
  repetition: number;
  durationMs: number;
  requests: number;
  meanings: number;
  cases: {
    id: string;
    correct: boolean;
    nicknameFalsePositive: boolean;
    primary: boolean;
    target?: string;
    kind?: JudgeKind;
    category?: string;
  }[];
};
export type ExperimentProgress = {
  arm: Trial['arm'];
  repetition: number;
  stage: 'meaning' | 'judge';
  batch: number;
  vote: number;
};
type Complete = NonNullable<ProviderSession['completeJson']>;
const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/g, '');

/** 앱의 판정 요청·파서·3회 다수결을 그대로 비교한다. 저장소나 앱 기본 설정은 변경하지 않는다. */
export async function runNicknameComparison(
  cases: readonly NicknameCase[],
  complete: Complete,
  options: {
    signal: AbortSignal;
    dic: Kanjidic;
    repetitions?: number;
    onProgress?(progress: ExperimentProgress): void;
    onTrial?(trial: Trial): void | Promise<void>;
  },
): Promise<Trial[]> {
  const repetitions = options.repetitions ?? 3;
  if (
    !Number.isSafeInteger(repetitions) ||
    repetitions < 1 ||
    repetitions > 3 ||
    !cases.length ||
    cases.length > 20 ||
    new Set(cases.map((item) => item.id)).size !== cases.length ||
    new Set(cases.map((item) => item.source)).size !== cases.length
  )
    throw new Error('invalid_experiment');
  const candidates = cases.map((item) => {
    const found = collectScanCandidates(
      [{ chapterId: 'synthetic', paragraphs: item.contexts.map((text) => ({ text, ruby: [] })) }],
      [],
      options.dic,
      20,
      [item.source],
    );
    if (found.length !== 1) throw new Error('invalid_fixture');
    return found[0]!;
  });
  // 고정된 합성 조회 응답으로 A/B의 외부 조회 변동을 제거한다. 실제 위키 조회가 아니다.
  const lookups = new Map<string, LookupHit[]>(
    cases
      .filter((item) => item.refers)
      .map((item) => [
        item.source,
        [
          {
            kind: 'wikipedia',
            ko: item.refers!,
            url: 'https://example.test/synthetic',
            note: '합성 고정 참고',
            refers: true,
            exact: false,
          },
        ],
      ]),
  );
  const trials: Trial[] = [];
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const order: Trial['arm'][] =
      repetition % 2 === 0 ? ['baseline', 'meaning'] : ['meaning', 'baseline'];
    for (const arm of order) {
      const started = performance.now();
      let requests = 0;
      const call: Complete = async (request, signal) => {
        requests++;
        return complete(request, signal);
      };
      options.onProgress?.({ arm, repetition, stage: 'meaning', batch: 0, vote: 0 });
      const meanings =
        arm === 'meaning'
          ? await collectNicknameMeanings(candidates, lookups, call, options.signal)
          : undefined;
      const decisions = new Map();
      for (let index = 0; index < candidates.length; index += 8) {
        const batch = candidates.slice(index, index + 8);
        const request = judgeRequest(batch, lookups, meanings);
        const runs = [];
        for (const [vote, temperature] of [0, 0.7, 0.7].entries()) {
          if (options.signal.aborted) throw new ReaderError('cancelled');
          options.onProgress?.({ arm, repetition, stage: 'judge', batch: index / 8, vote });
          const value = await call({ ...request, temperature }, options.signal);
          if (options.signal.aborted) throw new ReaderError('cancelled');
          runs.push(parseJudge(value, batch));
        }
        for (const [source, answer] of voteJudgements(runs, batch)) decisions.set(source, answer);
      }
      const trial: Trial = {
        arm,
        repetition,
        durationMs: performance.now() - started,
        requests,
        meanings: meanings?.size ?? 0,
        cases: cases.map((item) => {
          const answer = decisions.get(item.source);
          return {
            id: item.id,
            primary: item.id === 'mino-viper',
            ...(answer
              ? { target: answer.target, kind: answer.kind, category: answer.category }
              : {}),
            correct:
              !!answer &&
              item.expected.some((target) => normalized(target) === normalized(answer.target)) &&
              item.kind === answer.kind &&
              item.categories.includes(answer.category),
            nicknameFalsePositive: !item.nickname && answer?.category === '별명',
          };
        }),
      };
      trials.push(trial);
      await options.onTrial?.(trial);
    }
  }
  return trials;
}

export function summarizeNicknameComparison(
  cases: readonly NicknameCase[],
  trials: readonly Trial[],
) {
  const summaries = (['baseline', 'meaning'] as const).map((arm) => {
    const selected = trials.filter((trial) => trial.arm === arm);
    const times = selected.map((trial) => trial.durationMs).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)]! : 0;
    const nicknameIds = new Set(cases.filter((item) => item.nickname).map((item) => item.id));
    return {
      arm,
      trials: selected.length,
      nicknameCorrect: selected
        .flatMap((item) => item.cases)
        .filter((item) => nicknameIds.has(item.id) && item.correct).length,
      controlCorrect: selected
        .flatMap((item) => item.cases)
        .filter((item) => !nicknameIds.has(item.id) && item.correct).length,
      falsePositives: selected
        .flatMap((item) => item.cases)
        .filter((item) => item.nicknameFalsePositive).length,
      primaryCorrect: selected
        .flatMap((item) => item.cases)
        .filter((item) => item.primary && item.correct).length,
      requests: selected.reduce((sum, item) => sum + item.requests, 0),
      medianMs: median,
    };
  });
  const [baseline, meaning] = summaries;
  const complete =
    cases.length === 20 &&
    cases.filter((item) => item.nickname).length === 12 &&
    new Set(cases.map((item) => item.id)).size === 20 &&
    cases.some((item) => item.id === 'mino-viper' && item.nickname) &&
    (['baseline', 'meaning'] as const).every(
      (arm) =>
        trials
          .filter((trial) => trial.arm === arm)
          .map((trial) => trial.repetition)
          .sort()
          .join(',') === '0,1,2',
    ) &&
    trials.every(
      (trial) =>
        trial.cases.length === 20 &&
        new Set(trial.cases.map((item) => item.id)).size === 20 &&
        trial.cases.every((item) => cases.some((fixture) => fixture.id === item.id)),
    ) &&
    baseline!.trials === 3 &&
    meaning!.trials === 3;
  const qualityImproved =
    meaning!.nicknameCorrect > baseline!.nicknameCorrect &&
    meaning!.falsePositives <= baseline!.falsePositives &&
    meaning!.controlCorrect >= baseline!.controlCorrect &&
    meaning!.primaryCorrect === 3;
  const timeRatio = baseline!.medianMs > 0 ? meaning!.medianMs / baseline!.medianMs : null;
  return {
    summaries,
    timeRatio,
    decision: !complete
      ? 'incomplete'
      : !qualityImproved
        ? 'reject'
        : timeRatio !== null && timeRatio <= 1.5
          ? 'candidate_for_product_review'
          : 'defer_latency',
    defaultEnabled: false,
  };
}
