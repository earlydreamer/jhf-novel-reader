import type { SelectedModel } from '../contracts/reading';
import type { GuidanceTerm } from './guidance';

const entry = (source: string, target: string, category: string, note = ''): GuidanceTerm => ({
  source,
  target,
  aliases: [],
  category,
  note,
});

/**
 * 나로우계 공통 관례 프리셋 v0. 일반 어휘가 아니라 모델이 실제로 틀린 항목만 담는다.
 * 근거: 2026-10-07 합성 예문 실측(Gemma 4 E4B·Index-Translate-9B, 프리셋 없이 번역)에서 한 모델 이상이
 * 틀린 고정 표기(#80). 한 글자 항목, 작가가 다른 뜻으로 쓰기 쉬운 어휘(姑息·役不足)는 넣지 않는다.
 * 표기는 2026-10-08 사용자가 확정했다(転生은 이세계물 관례인 "전생" 유지).
 */
export const UNIVERSAL_PRESET: readonly GuidanceTerm[] = [
  entry('乳母日傘', '응석받이로 귀하게 자람', '관용구', '유모·양산을 직역하지 않는다'),
  entry('猫の手も借りたい', '눈코 뜰 새 없이 바쁘다', '관용구'),
  entry('猫に小判', '돼지 목에 진주', '관용구'),
  entry('情けは人のためならず', '남에게 베푼 정은 결국 자신에게 돌아온다', '속담'),
  entry('自主稽古', '자율 훈련', '어휘'),
  entry('転生', '전생', '이세계', '이세계물 관례 표기'),
  entry('転移', '전이', '이세계', '이세계물 관례 표기'),
  entry('スギ', '삼나무', '식물'),
  entry('ブタクサ', '돼지풀', '식물'),
  entry('カブトムシ', '장수풍뎅이', '곤충'),
];

/**
 * 프리셋은 구간 번역(로컬 모델) 경로에서만 쓴다. 사용자가 승인한 작품 용어집과 달리
 * 지원하지 않는 제공자에서 번역을 막을 이유가 없으므로 조용히 생략한다.
 */
export function referencePreset(selection: SelectedModel): readonly GuidanceTerm[] {
  return selection.connection.provider === 'openai-compatible' && selection.limits
    ? UNIVERSAL_PRESET
    : [];
}

/** 숫자로 쓴 「N月」 뒤에 기간 표현이 오면 달력의 월이 아니라 N개월이다. */
const DURATION_MONTH = /[0-9０-９]+月(?=もすれば|もしないうちに|もたたないうちに|ほどで|ぶり)/g;
/**
 * 문형으로 잡히는 오역을 그 구간에 등장할 때만 짚어 준다. 실측에서 E4B의 「1月もすれば」→"1월"
 * 회차 오역이 3/3에서 0/3으로 줄었다(일반 지침 문장만으로는 줄지 않았다).
 */
export function contextHints(input: string): string {
  return [...new Set(input.match(DURATION_MONTH) ?? [])]
    .map(
      (month) =>
        `Note: in this text, 「${month}」 counts a length of time in months (N月 = N개월), not a calendar month.\n`,
    )
    .join('');
}
