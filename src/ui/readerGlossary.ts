import { useCallback, useEffect, useState } from 'react';
import {
  isUnsafeTermName,
  type GuidanceDraft,
  type GuidanceTerm,
  type WorkGuidance,
} from '../translation/guidance';

const nameKey = (name: string) => name.normalize('NFKC');
const CHIP_LIMIT = 12;

/**
 * 추가·편집. previousSource가 있으면 그 항목을 바꾸고 별칭은 유지한다. 리더에서 고친 항목은 사람이
 * 고른 결정으로 보아 origin·evidence를 지운 사람 항목이 된다. 없으면 끝에 사람 항목으로 넣는다.
 */
export function upsertTerm(
  terms: readonly GuidanceTerm[],
  term: GuidanceTerm,
  previousSource?: string,
): GuidanceTerm[] {
  const human = (aliases: string[]): GuidanceTerm => ({
    source: term.source,
    target: term.target,
    aliases,
    category: term.category,
    note: term.note,
  });
  const index =
    previousSource === undefined ? -1 : terms.findIndex((item) => item.source === previousSource);
  if (index < 0) return [...terms, human([...term.aliases])];
  return terms.map((item, position) => (position === index ? human([...item.aliases]) : item));
}

/** 그 원문 항목만 뺀다. */
export function removeTerm(terms: readonly GuidanceTerm[], source: string): GuidanceTerm[] {
  return terms.filter((item) => item.source !== source);
}

/** 저장 전에 보여 줄 문제. 없으면 null. 편집 중인 항목(previousSource)의 이름은 중복으로 보지 않는다. */
export function termProblem(
  terms: readonly GuidanceTerm[],
  draft: { source: string; target: string },
  previousSource?: string,
): string | null {
  const source = draft.source.trim();
  if (!source || !draft.target.trim()) return '원문과 번역 표기를 입력해 주세요.';
  if (isUnsafeTermName(source)) return '한 글자나 짧은 히라가나는 용어로 쓸 수 없어요.';
  const taken = terms
    .filter((item) => item.source !== previousSource)
    .some((item) =>
      [item.source, ...item.aliases].some((name) => nameKey(name) === nameKey(source)),
    );
  return taken ? '이미 용어집에 있는 이름이에요.' : null;
}

/** 원문 문단의 가타카나(ー・ 포함)·한자(々〆ヶ 포함) 덩어리 중 2글자 이상, 나온 순서, 중복 없이 최대 12개. */
export function sourceChips(text: string): string[] {
  const chips: string[] = [];
  for (const match of text.matchAll(/[\p{Script=Katakana}ー・]+|[\p{Script=Han}々〆ヶ]+/gu)) {
    const chip = match[0].replace(/^・+|・+$/g, '');
    if ([...chip].length < 2 || chips.includes(chip)) continue;
    chips.push(chip);
    if (chips.length >= CHIP_LIMIT) break;
  }
  return chips;
}

export type ReaderGlossary = {
  terms: readonly GuidanceTerm[];
  saveTerm(term: GuidanceTerm, previousSource?: string): Promise<boolean>;
  deleteTerm(source: string): Promise<boolean>;
};

/**
 * 리더의 작품 용어집. refreshKey(보통 저장본 id)가 바뀌면 다시 읽는다. 저장은 최신 용어집을 다시 읽어
 * 고친 뒤 저장하므로 그사이 다른 화면에서 바뀐 항목을 덮어쓰지 않는다. 실패하면 false.
 */
export function useReaderGlossary(input: {
  workId: string | null;
  refreshKey?: string;
  read?(workId: string): Promise<WorkGuidance | null>;
  save?(workId: string, draft: GuidanceDraft): Promise<WorkGuidance>;
}): ReaderGlossary | undefined {
  const { workId, refreshKey, read, save } = input;
  const [terms, setTerms] = useState<readonly GuidanceTerm[]>([]);
  useEffect(() => {
    if (!workId || !read) return;
    let live = true;
    void read(workId)
      .then((value) => {
        if (live) setTerms(value?.terms ?? []);
      })
      .catch(() => {
        if (live) setTerms([]);
      });
    return () => {
      live = false;
    };
  }, [workId, refreshKey, read]);
  const edit = useCallback(
    async (change: (terms: readonly GuidanceTerm[]) => GuidanceTerm[]): Promise<boolean> => {
      if (!workId || !read || !save) return false;
      try {
        const latest = await read(workId);
        const saved = await save(workId, {
          terms: change(latest?.terms ?? []),
          voices: latest?.voices ?? [],
          ...(latest?.plotSummary !== undefined ? { plotSummary: latest.plotSummary } : {}),
        });
        setTerms(saved.terms);
        return true;
      } catch {
        return false;
      }
    },
    [workId, read, save],
  );
  const saveTerm = useCallback(
    (term: GuidanceTerm, previousSource?: string) =>
      edit((current) => upsertTerm(current, term, previousSource)),
    [edit],
  );
  const deleteTerm = useCallback(
    (source: string) => edit((current) => removeTerm(current, source)),
    [edit],
  );
  if (!workId || !read || !save) return undefined;
  return { terms, saveTerm, deleteTerm };
}
