import type { GuidanceTerm } from '../translation/guidance';
import { findTermMatches } from '../translation/termMatch';

/** 표시 문자열 안의 강조 자리. start·end는 UTF-16 인덱스다. */
export type HighlightRange = { start: number; end: number; term: GuidanceTerm };
export type Segment = { text: string; term?: GuidanceTerm };

/** 이름(원문·별칭)마다 처음 나온 용어. 번역 적용과 같게 'auto'는 뺀다. */
function owners(terms: readonly GuidanceTerm[]): Map<string, GuidanceTerm> {
  const owner = new Map<string, GuidanceTerm>();
  for (const item of terms) {
    if (item.origin === 'auto') continue;
    for (const name of [item.source, ...item.aliases]) if (!owner.has(name)) owner.set(name, item);
  }
  return owner;
}

/** 원문 문단에 경계 매칭(확정)으로 나온 용어. 처음 나온 순서이고 중복은 없다. */
export function paragraphTerms(source: string, terms: readonly GuidanceTerm[]): GuidanceTerm[] {
  const owner = owners(terms);
  const found: GuidanceTerm[] = [];
  const matches = findTermMatches(source, [...owner.keys()])
    .filter((match) => match.confirmed)
    .sort((left, right) => left.start - right.start);
  for (const match of matches) {
    const item = owner.get(match.name)!;
    if (!found.includes(item)) found.push(item);
  }
  return found;
}

/**
 * 원문 문단에 나온 용어의 표기를 번역 문단에서 찾는다. 원문에 없는 용어는 같은 글자가 있어도
 * 표시하지 않는다(일반어 오탐 방지). 두 글자 미만 표기는 빼고, 긴 표기부터 겹치지 않게 잡는다.
 */
export function translatedRanges(
  source: string,
  translated: string,
  terms: readonly GuidanceTerm[],
): HighlightRange[] {
  const candidates = paragraphTerms(source, terms)
    .filter((item) => [...item.target].length >= 2)
    .sort((left, right) => right.target.length - left.target.length);
  const taken = new Array<boolean>(translated.length).fill(false);
  const ranges: HighlightRange[] = [];
  for (const item of candidates) {
    for (
      let at = translated.indexOf(item.target);
      at >= 0;
      at = translated.indexOf(item.target, at + 1)
    ) {
      const end = at + item.target.length;
      if (taken.slice(at, end).some(Boolean)) continue;
      for (let k = at; k < end; k++) taken[k] = true;
      ranges.push({ start: at, end, term: item });
    }
  }
  return ranges.sort((left, right) => left.start - right.start);
}

/** 원문 보기의 강조 자리. 확정 매칭 위치(코드포인트)를 UTF-16 인덱스로 바꾼다. */
export function sourceRanges(source: string, terms: readonly GuidanceTerm[]): HighlightRange[] {
  const owner = owners(terms);
  const chars = [...source];
  const offsets: number[] = [0];
  for (const char of chars) offsets.push(offsets[offsets.length - 1]! + char.length);
  return findTermMatches(source, [...owner.keys()])
    .filter((match) => match.confirmed)
    .map((match) => ({
      start: offsets[match.start]!,
      end: offsets[match.end]!,
      term: owner.get(match.name)!,
    }))
    .sort((left, right) => left.start - right.start);
}

/** 겹치지 않는 범위로 문자열을 나눈다. 범위는 start 순이어야 한다. */
export function splitByRanges(text: string, ranges: readonly HighlightRange[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start) });
    segments.push({ text: text.slice(range.start, range.end), term: range.term });
    cursor = range.end;
  }
  if (cursor < text.length || !segments.length) segments.push({ text: text.slice(cursor) });
  return segments;
}
