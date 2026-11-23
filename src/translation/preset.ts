import type { SelectedModel } from '../contracts/reading';
import type { GuidanceRepository, GuidanceTerm } from './guidance';

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

// These are editable initial values. Saving the list replaces the defaults, including removed entries.
export const DEFAULT_SHARED_TERMS: readonly GuidanceTerm[] = [
  ...UNIVERSAL_PRESET,
  entry('異世界', '이세계', '이세계'),
  entry('冒険者ギルド', '모험가 길드', '조직'),
  entry('魔法陣', '마법진', '마법'),
  { ...entry('魔道具', '마도구', '마법'), aliases: ['魔導具'] },
  entry('魔導書', '마도서', '마법'),
  entry('召喚獣', '소환수', '마법'),
  entry('錬金術', '연금술', '마법'),
  entry('治癒魔法', '치유 마법', '마법'),
];

/**
 * 공용 목록 이전의 규칙이다. 내장 프리셋은 로컬 구간 번역에서만 썼다. 공용 목록 없이 준비한
 * 일괄 번역 기록은 저장본을 비교할 때 준비 당시와 같은 결과를 내도록 이 규칙을 계속 쓴다.
 */
export function referencePreset(selection: SelectedModel): readonly GuidanceTerm[] {
  return selection.connection.provider === 'openai-compatible' && selection.limits
    ? UNIVERSAL_PRESET
    : [];
}

/**
 * 참고 용어를 번역 요청에 넣을 수 있는 경로인지 판정한다. Gemini는 일반·스트리밍 모두 문단 번역으로 받는다.
 * 로컬 서버의 일반 텍스트 전체 회차 번역은 참고 데이터를 받지 못한다. 공용 용어 때문에 번역이 막히지 않도록 제외한다.
 */
function acceptsReferenceTerms(selection: SelectedModel): boolean {
  if (selection.connection.provider === 'gemini') return true;
  return Boolean(selection.limits) || selection.translationMode === 'stream';
}

export async function readReferenceTerms(
  selection: SelectedModel,
  guidance?: GuidanceRepository,
): Promise<readonly GuidanceTerm[]> {
  if (!guidance?.readShared) return referencePreset(selection);
  if (!acceptsReferenceTerms(selection)) return [];
  return (await guidance.readShared())?.terms ?? DEFAULT_SHARED_TERMS;
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
