import { expect, test, vi } from 'vitest';
import { ReaderError } from '../../src/contracts';
import {
  collectNicknameMeanings,
  nicknameMeaningRequest,
  parseNicknameMeaning,
} from '../../src/translation/nicknameMeaning';
import {
  runNicknameComparison,
  summarizeNicknameComparison,
  type NicknameCase,
  type Trial,
} from '../../src/translation/nicknameExperiment';
import { judgeRequest } from '../../src/translation/termJudge';
import type { ScanCandidate } from '../../src/translation/termScan';

const candidate: ScanCandidate = {
  source: '美濃の蝮',
  role: 'new',
  count: 1,
  chapterIds: ['synthetic'],
  contexts: ['美濃の蝮は異名だ。'],
  script: 'mixed',
};
const answer = {
  id: 'nickname',
  nickname: true,
  parts: [{ source: '蝮', meaning: '살무사' }],
  referent: '사이토 도산',
  rendering: '미노의 살무사',
};
const signal = () => new AbortController().signal;

test('뜻 분해는 strict JSON을 사용하고 후보·길이·문자·추가 필드를 검증한다', () => {
  expect(nicknameMeaningRequest(candidate).schema.additionalProperties).toBe(false);
  expect(parseNicknameMeaning(answer, candidate)).toMatchObject({ rendering: '미노의 살무사' });
  for (const invalid of [
    { ...answer, id: 'other' },
    { ...answer, nickname: false },
    { ...answer, extra: 'x' },
    { ...answer, rendering: 'ミノ' },
    { ...answer, rendering: '가'.repeat(81) },
    { ...answer, referent: '원시\n지시' },
    { ...answer, parts: [{ source: '虎', meaning: '호랑이' }] },
    { ...answer, parts: [{ source: '蝮', meaning: '살무사', extra: 'x' }] },
    { ...answer, parts: [] },
  ])
    expect(parseNicknameMeaning(invalid, candidate)).toBeNull();
});

test('대상이 아닌 이름·작가 루비는 제외하고 중복 후보에도 한 번만 요청한다', async () => {
  const complete = vi.fn(async () => answer);
  const input = [
    candidate,
    candidate,
    { ...candidate, source: 'アルベルト' },
    { ...candidate, ruby: 'まむし' },
  ];
  const before = structuredClone(input);
  const result = await collectNicknameMeanings(input, new Map(), complete, signal());
  expect(complete).toHaveBeenCalledTimes(1);
  expect(result.size).toBe(1);
  expect(input).toEqual(before);
  const baseline = judgeRequest([candidate]);
  expect(baseline.user).not.toContain('meaning:');
  const experiment = judgeRequest([candidate], undefined, result);
  expect(experiment.user).toContain('meaning:');
  expect(experiment.user).toContain('unverified model suggestion, not lookup evidence');
});

test('부적합 응답은 기존 판정으로 진행하며 취소·결과 불명·인증 오류는 재요청 없이 중단한다', async () => {
  const complete = vi
    .fn()
    .mockResolvedValueOnce({ unexpected: true })
    .mockRejectedValueOnce(new ReaderError('invalid_output', 'received'));
  expect(
    (
      await collectNicknameMeanings(
        [candidate, { ...candidate, source: '甲斐の虎' }],
        new Map(),
        complete,
        signal(),
      )
    ).size,
  ).toBe(0);
  expect(complete).toHaveBeenCalledTimes(2);
  for (const error of [
    new ReaderError('cancelled'),
    new ReaderError('timeout_unknown', 'unknown'),
    new ReaderError('auth', 'received'),
  ]) {
    const failure = vi.fn().mockRejectedValue(error);
    await expect(
      collectNicknameMeanings(
        [candidate, { ...candidate, source: '甲斐の虎' }],
        new Map(),
        failure,
        signal(),
      ),
    ).rejects.toBe(error);
    expect(failure).toHaveBeenCalledTimes(1);
  }
});

test('전송 전과 응답 뒤 취소에서는 추가 후보를 실행하지 않는다', async () => {
  const before = new AbortController();
  before.abort();
  const complete = vi.fn(async () => answer);
  await expect(
    collectNicknameMeanings([candidate], new Map(), complete, before.signal),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(complete).not.toHaveBeenCalled();
  const after = new AbortController();
  const aborting = vi.fn(async () => {
    after.abort();
    return answer;
  });
  await expect(
    collectNicknameMeanings([candidate], new Map(), aborting, after.signal),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(aborting).toHaveBeenCalledTimes(1);
});

const fixture: NicknameCase = {
  id: 'mino-viper',
  source: candidate.source,
  contexts: candidate.contexts,
  expected: ['미노의 살무사'],
  kind: 'real',
  categories: ['별명'],
  nickname: true,
};
test('비교는 기존의 세 번 판정·온도를 보존하고 추가 요청과 저장을 분리한다', async () => {
  const complete = vi.fn(async (request: { user: string }) =>
    request.user.startsWith('{')
      ? answer
      : {
          items: [
            {
              id: 'c1',
              kind: 'real',
              category: '별명',
              target: '미노의 살무사',
              reason: '합성 근거',
            },
          ],
        },
  );
  const trials = await runNicknameComparison([fixture], complete, {
    signal: signal(),
    dic: { version: 'synthetic', lookup: () => null },
    repetitions: 1,
  });
  expect(trials.map((trial) => [trial.arm, trial.requests, trial.meanings])).toEqual([
    ['baseline', 3, 0],
    ['meaning', 4, 1],
  ]);
  expect(
    complete.mock.calls.map((call) => (call[0] as { temperature?: number }).temperature),
  ).toEqual([0, 0.7, 0.7, 0, 0, 0.7, 0.7]);
  expect(trials.every((trial) => trial.cases[0]!.correct)).toBe(true);
  expect(summarizeNicknameComparison([fixture], trials).decision).toBe('incomplete');
});

test('판정 요청 중 실패하면 나머지 투표와 다음 실험군으로 넘어가지 않는다', async () => {
  const complete = vi.fn().mockRejectedValue(new ReaderError('timeout_unknown', 'unknown'));
  await expect(
    runNicknameComparison([fixture], complete, {
      signal: signal(),
      dic: { version: 'synthetic', lookup: () => null },
    }),
  ).rejects.toMatchObject({ outcome: 'unknown' });
  expect(complete).toHaveBeenCalledTimes(1);
});

test('품질 개선이 있어도 반례 악화·지연 초과·미완료는 기본 적용 후보로 채택하지 않는다', () => {
  const cases = Array.from({ length: 20 }, (_, i) => ({
    ...fixture,
    id: i === 0 ? 'mino-viper' : String(i),
    source: String(i),
    nickname: i < 12,
  }));
  const trials: Trial[] = [];
  for (let repetition = 0; repetition < 3; repetition++)
    for (const arm of ['baseline', 'meaning'] as const)
      trials.push({
        arm,
        repetition,
        durationMs: arm === 'baseline' ? 100 : 120,
        requests: 9,
        meanings: 0,
        cases: cases.map((item, i) => ({
          id: item.id,
          primary: i === 0,
          correct: arm === 'meaning' || i !== 0,
          nicknameFalsePositive: false,
        })),
      });
  expect(summarizeNicknameComparison(cases, trials).decision).toBe('candidate_for_product_review');
  expect(
    summarizeNicknameComparison(
      cases,
      trials.map((trial) => ({ ...trial, durationMs: trial.arm === 'meaning' ? 200 : 100 })),
    ).decision,
  ).toBe('defer_latency');
  const worse = structuredClone(trials);
  worse[1]!.cases[15]!.nicknameFalsePositive = true;
  expect(summarizeNicknameComparison(cases, worse).decision).toBe('reject');
  expect(summarizeNicknameComparison(cases, trials.slice(1)).decision).toBe('incomplete');
  expect(summarizeNicknameComparison(cases, trials).defaultEnabled).toBe(false);
});
