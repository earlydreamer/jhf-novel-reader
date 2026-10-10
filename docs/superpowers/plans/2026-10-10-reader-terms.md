# 리더 용어 강조·바로 추가·편집·삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리더에서 용어집 단어를 강조 표시(토글)하고, 길게 눌러 편집·삭제하며, 문단 시트에서 용어를 바로 추가한다(#265).

**Architecture:** 강조 위치 계산과 용어집 수정은 순수 함수(`src/ui/termHighlight.ts`, `src/ui/readerGlossary.ts`)로 두고, 용어집 읽기·저장은 훅 `useReaderGlossary`가 컨트롤러의 `readGuidance`·`saveGuidance`로 한다. 리더(`ImmersiveReader`)는 강조 렌더링·용어 시트·편집 창(`TermEditor`)만 맡는다. 강조 토글은 다른 읽기 설정과 같은 경로(`ReadingSettings` → 컨트롤러 → props)로 저장한다.

**Tech Stack:** React 19 + TypeScript, Vitest + Testing Library(jsdom), Capacitor.

**Spec:** `docs/superpowers/specs/2026-10-10-reader-terms.md`

## Global Constraints

- 문서·주석·커밋은 한국어. 커밋 형식 `feat: <한국어 제목> (#265)` + 줄바꿈 + `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- 사용자 문구는 spec에 적힌 그대로 쓴다(토스 UX 말투, `~해요`).
- `git add .`/`-A` 금지, 명시 경로만 stage. `tsconfig.tsbuildinfo`는 커밋하지 않는다.
- 새 의존성 금지.
- 매 Task 끝 검증: 해당 시험 + `npm run lint` + `npx tsc -b` + `npx vitest run` + 바꾼 파일 `npx prettier --check`.
- origin `auto` 항목은 강조·용어 목록에서 뺀다(번역 적용 규칙과 같다).

---

### Task 1: 강조 위치 계산 (`src/ui/termHighlight.ts`)

**Files:**
- Create: `src/ui/termHighlight.ts`
- Test: `tests/ui/term-highlight.test.ts`

**Interfaces:**
- Consumes: `findTermMatches(input, names)` (`src/translation/termMatch.ts`, 위치는 **코드포인트** 인덱스), `GuidanceTerm`.
- Produces:
  - `export type HighlightRange = { start: number; end: number; term: GuidanceTerm }` — `start`·`end`는 표시 문자열의 **UTF-16** 인덱스.
  - `export function paragraphTerms(source: string, terms: readonly GuidanceTerm[]): GuidanceTerm[]`
  - `export function translatedRanges(source: string, translated: string, terms: readonly GuidanceTerm[]): HighlightRange[]`
  - `export function sourceRanges(source: string, terms: readonly GuidanceTerm[]): HighlightRange[]`
  - `export type Segment = { text: string; term?: GuidanceTerm }`
  - `export function splitByRanges(text: string, ranges: readonly HighlightRange[]): Segment[]`

- [ ] **Step 1: 실패하는 시험 작성** — `tests/ui/term-highlight.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { GuidanceTerm } from '../../src/translation/guidance';
import {
  paragraphTerms,
  sourceRanges,
  splitByRanges,
  translatedRanges,
} from '../../src/ui/termHighlight';

const term = (source: string, target: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source,
  target,
  aliases: [],
  category: '',
  note: '',
  ...extra,
});
const lucia = term('ルシアナ', '루시아나', { aliases: ['ルシア'] });
const duke = term('公爵', '공작', { origin: 'model' });

describe('termHighlight', () => {
  it('원문에 확정 매칭된 용어만 고르고 auto 항목은 뺀다', () => {
    const auto = term('メイド', '메이드', { origin: 'auto' });
    expect(paragraphTerms('ルシアナはメイドを呼んだ。', [lucia, duke, auto])).toEqual([lucia]);
    // 'クルシアーノ' 안의 'ルシア'는 후보(경계 아님)라 고르지 않는다.
    expect(paragraphTerms('クルシアーノが来た。', [lucia])).toEqual([]);
  });

  it('원문에 있는 용어의 표기만 번역문에서 찾는다', () => {
    const ranges = translatedRanges('ルシアナが笑った。', '루시아나가 웃자 공작이 왔다.', [lucia, duke]);
    expect(ranges.map((r) => [r.start, r.end, r.term.source])).toEqual([[0, 4, 'ルシアナ']]);
  });

  it('번역문의 같은 표기는 모두 표시하고, 긴 표기부터 겹치지 않게 잡는다', () => {
    const full = term('セレスティ・マクマーデン', '셀레스티 맥마던');
    const short = term('セレスティ', '셀레스티');
    const ranges = translatedRanges(
      'セレスティ・マクマーデン。セレスティは笑う。',
      '셀레스티 맥마던. 셀레스티는 웃는다.',
      [short, full],
    );
    expect(ranges.map((r) => [r.start, r.end, r.term.source])).toEqual([
      [0, 8, 'セレスティ・マクマーデン'],
      [10, 14, 'セレスティ'],
    ]);
  });

  it('두 글자 미만 표기는 표시하지 않는다', () => {
    expect(translatedRanges('王が来た。', '왕이 왔다.', [term('王', '왕')])).toEqual([]);
  });

  it('원문 보기 위치는 UTF-16 인덱스로 돌려준다', () => {
    const ranges = sourceRanges('𠮷はルシアナを見た。', [lucia]);
    expect(ranges.map((r) => [r.start, r.end])).toEqual([[3, 7]]);
  });

  it('범위로 문자열을 나눈다', () => {
    const ranges = translatedRanges('ルシアナが笑った。', '그때 루시아나가 웃었다.', [lucia]);
    expect(splitByRanges('그때 루시아나가 웃었다.', ranges)).toEqual([
      { text: '그때 ' },
      { text: '루시아나', term: lucia },
      { text: '가 웃었다.' },
    ]);
    expect(splitByRanges('없음', [])).toEqual([{ text: '없음' }]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ui/term-highlight.test.ts` → 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현** — `src/ui/termHighlight.ts`

```ts
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
    for (let at = translated.indexOf(item.target); at >= 0; at = translated.indexOf(item.target, at + 1)) {
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
```

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/ui/term-highlight.test.ts` PASS. 시험 기대 인덱스가 실제와 다르면 **구현이 아니라 계산을 다시 확인**하고, 시험 값이 틀렸을 때만 고친 뒤 보고서에 적는다.

- [ ] **Step 5: 전체 검증 후 커밋** — `feat: 리더 용어 강조 위치 계산 (#265)`

---

### Task 2: 용어 강조 토글 설정

**Files:**
- Modify: `src/storage/settings.ts` (타입 `ReadingSettings`, `readingSettings` 검증)
- Modify: `src/app/renewalController.ts` (스냅숏 필드, 초기값, `persistSettings`, 저장값 복원, `changeTermHighlight`, 인터페이스·반환 객체)
- Modify: `src/app/Application.tsx` (두 `<ImmersiveReader>`에 `termHighlight`·`onTermHighlight`)
- Modify: `src/ui/ImmersiveReader.tsx` (props, 보기 설정 시트의 스위치 — 강조 렌더링은 Task 5)
- Test: `tests/storage/reading-settings.test.ts`, `tests/integration/auto-glossary.test.ts`(같은 `readyController` 도우미 재사용), `tests/ui/immersive-reader.test.tsx`

**Interfaces:**
- Produces: `RenewalSnapshot.termHighlight: boolean`(기본 `true`), `RenewalController.changeTermHighlight(enabled: boolean): void`, `ImmersiveReaderProps.termHighlight: boolean`, `ImmersiveReaderProps.onTermHighlight(value: boolean): void`.

- [ ] **Step 1: 시험**
  - `reading-settings.test.ts`: `termHighlight: false`가 저장·복원되고, `termHighlight: 'yes' as never`는 거부된다.
  - `auto-glossary.test.ts`에 `autoGlossary` 시험과 같은 모양으로: 기본 `true`, `changeTermHighlight(false)` → 저장값 `{ termHighlight: false }`, 다시 `true` → 키 없음. 저장값 `{ termHighlight: false }`로 시작하면 스냅숏이 `false`.
  - `immersive-reader.test.tsx`: 보기 설정 시트를 열면 `용어 강조` 스위치(`role="switch"` 또는 checkbox, 라벨 `용어 강조`)가 `termHighlight` 값대로 보이고, 누르면 `onTermHighlight(!값)`.
- [ ] **Step 2: 구현**
  - `settings.ts`: 타입에 `/** 리더 용어 강조. 끌 때만 false로 저장한다. */ termHighlight?: boolean;`, `object` 키 목록에 `'termHighlight'`, `check(value.termHighlight === undefined || typeof value.termHighlight === 'boolean');`
  - 컨트롤러: 스냅숏 타입 `readonly termHighlight: boolean;`(`autoGlossary` 근처), 초기값 `termHighlight: true,`, `persistSettings`에 `...(snapshot.termHighlight ? {} : { termHighlight: false }),`, 복원에 `termHighlight: saved.termHighlight ?? true,`, 인터페이스 `changeTermHighlight(enabled: boolean): void;`, 구현은 `changeAutoGlossary`와 같은 모양(`publish({ termHighlight: enabled }); persistSettings();`).
  - Application: 두 리더에 `termHighlight={state.termHighlight}` `onTermHighlight={controller.changeTermHighlight}`.
  - 리더: props 두 개 추가. 보기 설정 시트의 `줄 간격` fieldset **다음**에:
    ```tsx
    <label className="nr-reader-switch">
      <span>
        용어 강조
        <small>용어집에 있는 이름을 본문에 표시해요.</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={props.termHighlight}
        onChange={(event) => props.onTermHighlight(event.target.checked)}
      />
    </label>
    ```
    `immersive-reader.css`에 `.nr-reader-switch { display: flex; justify-content: space-between; align-items: center; gap: 12px; } .nr-reader-switch small { display: block; opacity: .7; }` 추가.
  - 기존 리더 시험의 `props()` 도우미에 `termHighlight: true, onTermHighlight: vi.fn()` 기본값을 더한다.
- [ ] **Step 3: 전체 검증 후 커밋** — `feat: 리더 용어 강조 토글 설정 (#265)`

---

### Task 3: 리더 용어집 수정 도우미와 훅 (`src/ui/readerGlossary.ts`)

**Files:**
- Create: `src/ui/readerGlossary.ts`
- Test: `tests/ui/reader-glossary.test.tsx`

**Interfaces:**
- Consumes: `GuidanceTerm`, `GuidanceDraft`, `WorkGuidance`, `isUnsafeTermName` (`src/translation/guidance`).
- Produces:
  - `export function upsertTerm(terms: readonly GuidanceTerm[], term: GuidanceTerm, previousSource?: string): GuidanceTerm[]`
  - `export function removeTerm(terms: readonly GuidanceTerm[], source: string): GuidanceTerm[]`
  - `export function termProblem(terms: readonly GuidanceTerm[], draft: { source: string; target: string }, previousSource?: string): string | null` — spec의 검사 문구 중 하나 또는 `null`.
  - `export function sourceChips(text: string): string[]`
  - `export type ReaderGlossary = { terms: readonly GuidanceTerm[]; saveTerm(term: GuidanceTerm, previousSource?: string): Promise<boolean>; deleteTerm(source: string): Promise<boolean> }`
  - `export function useReaderGlossary(input: { workId: string | null; refreshKey?: string; read?(workId: string): Promise<WorkGuidance | null>; save?(workId: string, draft: GuidanceDraft): Promise<WorkGuidance> }): ReaderGlossary | undefined` — `workId`·`read`·`save` 중 하나라도 없으면 `undefined`.

- [ ] **Step 1: 시험** — `tests/ui/reader-glossary.test.tsx` (`// @vitest-environment jsdom`, `renderHook`·`waitFor`는 `@testing-library/react`)

```ts
// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { GuidanceTerm, WorkGuidance } from '../../src/translation/guidance';
import {
  removeTerm,
  sourceChips,
  termProblem,
  upsertTerm,
  useReaderGlossary,
} from '../../src/ui/readerGlossary';

const term = (source: string, target: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source, target, aliases: [], category: '', note: '', ...extra,
});

describe('readerGlossary', () => {
  it('추가는 끝에 사람 항목으로 넣는다', () => {
    const a = term('アル', '알');
    expect(upsertTerm([a], term('ベル', '벨'))).toEqual([a, term('ベル', '벨')]);
  });
  it('편집은 이전 이름의 항목을 바꾸고 별칭은 유지하며 기계 항목은 사람 항목이 된다', () => {
    const machine = term('ルシア', '루시아', {
      aliases: ['ルシアちゃん'], origin: 'scan', evidence: [{ kind: 'model', note: '근거' }],
    });
    const [edited] = upsertTerm([machine], term('ルシアナ', '루시아나', { category: '인명' }), 'ルシア');
    expect(edited).toEqual({ source: 'ルシアナ', target: '루시아나', aliases: ['ルシアちゃん'], category: '인명', note: '' });
  });
  it('삭제는 그 원문 항목만 뺀다', () => {
    const a = term('アル', '알');
    const b = term('ベル', '벨');
    expect(removeTerm([a, b], 'アル')).toEqual([b]);
  });
  it('검사 문구', () => {
    const terms = [term('ルシアナ', '루시아나', { aliases: ['ルシア'] })];
    expect(termProblem(terms, { source: ' ', target: '가' })).toBe('원문과 번역 표기를 입력해 주세요.');
    expect(termProblem(terms, { source: 'の', target: '가' })).toBe('한 글자나 짧은 히라가나는 용어로 쓸 수 없어요.');
    expect(termProblem(terms, { source: 'ルシア', target: '루시아' })).toBe('이미 용어집에 있는 이름이에요.');
    expect(termProblem(terms, { source: 'ルシアナ', target: '루시아나' }, 'ルシアナ')).toBeNull();
    expect(termProblem(terms, { source: 'ベル', target: '벨' })).toBeNull();
  });
  it('원문 칩은 가타카나·한자 덩어리 2글자 이상을 나온 순서로 최대 12개', () => {
    expect(sourceChips('剣聖オダ・ノブナガは王都で笑った。オダ・ノブナガ')).toEqual(['剣聖', 'オダ・ノブナガ', '王都']);
    expect(sourceChips('あいう')).toEqual([]);
  });
  it('훅은 읽어 오고, 저장은 최신 용어집을 읽어 고친 뒤 저장한다', async () => {
    let stored: WorkGuidance = { schemaVersion: 1, workId: 'w', hash: 'h', terms: [term('アル', '알')], voices: [], plotSummary: '요약' };
    const read = vi.fn(async () => stored);
    const save = vi.fn(async (_workId: string, draft) => (stored = { ...stored, ...draft, hash: 'h2' }));
    const { result } = renderHook(() => useReaderGlossary({ workId: 'w', refreshKey: 'v1', read, save }));
    await waitFor(() => expect(result.current?.terms).toHaveLength(1));
    let ok = false;
    await act(async () => { ok = await result.current!.saveTerm(term('ベル', '벨')); });
    expect(ok).toBe(true);
    expect(save.mock.calls[0]![1]).toEqual({ terms: [term('アル', '알'), term('ベル', '벨')], voices: [], plotSummary: '요약' });
    expect(result.current!.terms).toHaveLength(2);
    await act(async () => { ok = await result.current!.deleteTerm('アル'); });
    expect(result.current!.terms.map((t) => t.source)).toEqual(['ベル']);
  });
  it('저장이 실패하면 false를 돌려주고 목록은 그대로다', async () => {
    const stored: WorkGuidance = { schemaVersion: 1, workId: 'w', hash: 'h', terms: [], voices: [] };
    const { result } = renderHook(() =>
      useReaderGlossary({ workId: 'w', read: async () => stored, save: async () => { throw new Error('locked'); } }),
    );
    await waitFor(() => expect(result.current).toBeDefined());
    let ok = true;
    await act(async () => { ok = await result.current!.saveTerm(term('ベル', '벨')); });
    expect(ok).toBe(false);
    expect(result.current!.terms).toEqual([]);
  });
  it('workId나 read·save가 없으면 undefined', () => {
    const { result } = renderHook(() => useReaderGlossary({ workId: null }));
    expect(result.current).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `src/ui/readerGlossary.ts`

```ts
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
    .some((item) => [item.source, ...item.aliases].some((name) => nameKey(name) === nameKey(source)));
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
```

- [ ] **Step 4: 통과 확인.** (React hook 규칙상 `if` 반환은 훅 호출 **뒤**라 괜찮다. lint가 막으면 같은 동작으로 고치고 보고.)
- [ ] **Step 5: 전체 검증 후 커밋** — `feat: 리더 용어집 추가·편집·삭제 도우미 (#265)`

---

### Task 4: 용어 추가·편집 창 (`src/ui/TermEditor.tsx`)

**Files:**
- Create: `src/ui/TermEditor.tsx`
- Modify: `src/ui/immersive-reader.css` (칩 스타일)
- Test: `tests/ui/term-editor.test.tsx`

**Interfaces:**
- Consumes: `termProblem`, `sourceChips` (Task 3), `Dialog`(`src/ui/components/Modal`, props `open,title,onClose,children,actions`), `Button`(`src/ui/components/Button`, `variant: 'filled'|'tonal'|'outlined'|'text'`).
- Produces:
```ts
export interface TermEditorProps {
  open: boolean;
  mode: 'add' | 'edit';
  /** 편집이면 고칠 항목, 추가면 undefined */
  initial?: GuidanceTerm;
  /** 추가 모드에서 칩을 뽑을 원문 문단 */
  sourceText?: string;
  terms: readonly GuidanceTerm[];
  locked: boolean;
  onCancel(): void;
  onSave(term: GuidanceTerm, previousSource?: string): Promise<void> | void;
}
export function TermEditor(props: TermEditorProps): JSX.Element | null
```

- [ ] **Step 1: 시험** (`// @vitest-environment jsdom`, jest-dom, `render`/`screen`/`fireEvent`)
  1. 추가 모드, `sourceText='剣聖オダ・ノブナガは王都で笑った。'`: 제목 `용어 추가하기`, 안내 `원문 문단에서 이름을 골라 넣을 수 있어요.`, 칩 버튼 `剣聖`·`オダ・ノブナガ`·`王都`. `オダ・ノブナガ` 칩을 누르면 `원문` 입력값이 `オダ・ノブナガ`.
  2. 빈 상태로 `저장` → `원문과 번역 표기를 입력해 주세요.`(role="alert"), `onSave` 안 불림.
  3. 원문 `ベル`, 번역 표기 `벨`, 분류 `인명` 입력 후 `저장` → `onSave({source:'ベル',target:'벨',aliases:[],category:'인명',note:''}, undefined)`.
  4. 편집 모드 `initial=term('ルシア','루시아',{aliases:['ルシアちゃん'],note:'메모'})`: 제목 `용어 편집하기`, 입력값이 채워져 있고 칩 없음. 표기를 `루시아나`로 바꿔 저장 → `onSave({source:'ルシア',target:'루시아나',aliases:['ルシアちゃん'],category:'',note:'메모'}, 'ルシア')`.
  5. `locked` 이면 `번역 중에는 용어집을 고칠 수 없어요.`가 보이고 `저장` 버튼 disabled.
- [ ] **Step 2: 구현**
  - `open`이 false면 `null`. 열릴 때(`open`·`initial`이 바뀔 때) 입력값을 `initial`로(없으면 빈 값) 초기화한다(`useEffect`).
  - `<Dialog open title={mode==='add'?'용어 추가하기':'용어 편집하기'} onClose={onCancel} actions={<><Button variant="text" onClick={onCancel}>취소</Button><Button variant="filled" disabled={locked||saving} onClick={submit}>저장</Button></>}>`
  - 본문: 추가 모드이고 칩이 있으면 `<p>원문 문단에서 이름을 골라 넣을 수 있어요.</p>` + `<div className="nr-term-chips">{chips.map(chip => <button type="button" lang="ja" className="nr-term-chip" onClick={() => setSource(chip)}>{chip}</button>)}</div>`.
  - 입력: `<label>원문<input lang="ja" maxLength={80} .../></label>`, `<label>번역 표기<input maxLength={80} .../></label>`, `<label>분류 (선택)<input maxLength={40} .../></label>`, `<label>메모 (선택)<textarea maxLength={300} .../></label>`.
  - `locked`면 `<p role="status">번역 중에는 용어집을 고칠 수 없어요.</p>`.
  - `submit`: `termProblem(terms, {source, target}, initial?.source)`가 있으면 `<p role="alert">`로 보이고 멈춘다. 없으면 `saving=true`로 `await onSave({ source: source.trim(), target: target.trim(), aliases: [...(initial?.aliases ?? [])], category: category.trim(), note: note.trim() }, initial?.source)` 후 `saving=false`.
  - CSS: `.nr-term-chips { display:flex; flex-wrap:wrap; gap:8px; margin: 8px 0 12px; } .nr-term-chip { border:1px solid currentColor; border-radius:999px; padding:4px 12px; background:transparent; font:inherit; min-height:36px; }`
- [ ] **Step 3: 전체 검증 후 커밋** — `feat: 리더 용어 추가·편집 창 (#265)`

---

### Task 5: 리더 강조·용어 시트·추가 연결

**Files:**
- Modify: `src/ui/ImmersiveReader.tsx`
- Modify: `src/ui/immersive-reader.css`
- Modify: `src/app/Application.tsx`
- Test: `tests/ui/immersive-reader.test.tsx`

**Interfaces:**
- Consumes: Task 1 `paragraphTerms`·`translatedRanges`·`sourceRanges`·`splitByRanges`, Task 2 `termHighlight` prop, Task 3 `ReaderGlossary`·`useReaderGlossary`, Task 4 `TermEditor`.
- Produces: `ImmersiveReaderProps.glossary?: ReaderGlossary & { locked: boolean }`.

- [ ] **Step 1: 시험** (`immersive-reader.test.tsx`, 기존 `props()`·`completed()` 도우미. 원문은 `completed({ source: {...source, paragraphs:[{id:'p1',text:'ルシアナが笑った。',ruby:[]},{id:'p2',text:'公爵が来た。',ruby:[]}]}, blocks:[{id:'b1',text:'루시아나가 웃었다.'},{id:'b2',text:'공작이 왔다.'}] })`, 용어 `ルシアナ→루시아나`(사람), `glossary = { terms, locked:false, saveTerm: vi.fn(async()=>true), deleteTerm: vi.fn(async()=>true) }`)
  1. `termHighlight: true`: 번역 문단에 `mark`(`data-term-source="ルシアナ"`, 텍스트 `루시아나`) 1개. `공작`은 용어가 아니므로 표시 없음. `termHighlight: false`면 `mark` 없음.
  2. `mark`에서 `pointerDown` 후 500ms(`vi.useFakeTimers()` + `act(() => vi.advanceTimersByTime(500))`) → 용어 시트(제목 `ルシアナ`, `표기 루시아나`, 버튼 `편집하기`·`삭제하기`), 문단 시트(`문단 작업`)는 안 열림.
  3. `삭제하기` → 확인 창 `‘ルシアナ’ 용어를 지울까요?` → `지우기` → `deleteTerm('ルシアナ')`, 스낵바 `용어를 지웠어요.`
  4. `편집하기` → `용어 편집하기` 창, 표기를 `루시아나님`으로 바꿔 저장 → `saveTerm({...표기 바뀐 항목}, 'ルシアナ')`, 스낵바 `용어집에 저장했어요. 다음 번역부터 적용돼요.`
  5. 강조 없는 자리(둘째 문단)에서 길게 누르면 문단 시트에 `용어 추가하기`. 누르면 `용어 추가하기` 창에 칩 `公爵`. 첫 문단 시트에는 `이 문단의 용어` 아래 `ルシアナ · 루시아나` 버튼 → 용어 시트.
  6. `glossary.locked: true`면 용어 시트의 `편집하기`·`삭제하기`가 disabled이고 `번역 중에는 용어집을 고칠 수 없어요.`가 보인다.
  7. `saveTerm`이 `false`를 돌려주면 스낵바 `지금은 용어집을 저장하지 못했어요. 번역이 끝난 뒤 다시 시도해 주세요.`
  8. `glossary` 없으면 `mark`도 `용어 추가하기`도 없다.
- [ ] **Step 2: 구현**
  - props에 `glossary?: ReaderGlossary & { locked: boolean };` (import `type ReaderGlossary` from `./readerGlossary`).
  - 상태: `const [termSheet, setTermSheet] = useState<GuidanceTerm | null>(null)`, `const [editor, setEditor] = useState<{ mode: 'add' | 'edit'; initial?: GuidanceTerm; sourceText?: string } | null>(null)`, `const [confirmDelete, setConfirmDelete] = useState<GuidanceTerm | null>(null)`.
  - `overlayOpen` 계산에 `termSheet !== null || editor !== null || confirmDelete !== null` 추가.
  - 강조 가능 조건: `const highlight = props.termHighlight && !!props.glossary && !!version && oneToOneParagraphs && livePreview === undefined;`
  - 문단 렌더링: 실패 문단이 아니고 `highlight`면, `const sourceText = version.source.paragraphs[index]?.text ?? ''`; 원문 보기면 `sourceRanges(sourceText, terms)`, 아니면 `translatedRanges(sourceText, text, terms)`로 범위를 구해 `splitByRanges(text, ranges)`의 조각을 렌더한다: 용어 조각은 `<mark key className="nr-term" data-term-source={segment.term.source}>{segment.text}</mark>`, 나머지는 문자열. 그 밖에는 지금처럼 `{text || ' '}`.
  - 길게 누르기: `startLongPress`의 타이머 콜백에서 `const mark = (event.target as HTMLElement).closest<HTMLElement>('[data-term-source]')`(이벤트에서 미리 읽어 둔 값)을 보고, 있고 `props.glossary`가 있으면 `const found = props.glossary.terms.find(t => t.source === mark.dataset.termSource)`가 있을 때 `setTermSheet(found)`, 아니면 `setParagraphSheet(index)`.
  - 용어 시트(`BottomSheet title={termSheet.source}`): `<p>표기 {target}</p>`, 분류가 있으면 `<p>분류 {category}</p>`, 메모가 있으면 `<p>{note}</p>`, origin `model`이면 `<p>자동 생성</p>`, `scan`이면 `<p>정밀스캔</p>`. 잠금이면 `<p role="status">번역 중에는 용어집을 고칠 수 없어요.</p>`. 버튼 `편집하기`(→ 시트 닫고 `setEditor({mode:'edit', initial: termSheet})`), `삭제하기`(→ 시트 닫고 `setConfirmDelete(termSheet)`), 잠금이면 둘 다 disabled.
  - 삭제 확인 `Dialog title={`‘${confirmDelete.source}’ 용어를 지울까요?`}` 본문 `다음 번역부터 이 표기를 쓰지 않아요. 이미 번역한 회차는 그대로예요.` actions `취소`(text), `지우기`(filled) → `const ok = await props.glossary.deleteTerm(source)`; 닫고 스낵바 `ok ? '용어를 지웠어요.' : '지금은 용어집을 저장하지 못했어요. 번역이 끝난 뒤 다시 시도해 주세요.'`.
  - 편집 창: `<TermEditor open={editor!==null} mode initial sourceText terms={props.glossary.terms} locked={props.glossary.locked} onCancel={() => setEditor(null)} onSave={async (term, previous) => { const ok = await props.glossary!.saveTerm(term, previous); if (ok) setEditor(null); showSnackbar(ok ? '용어집에 저장했어요. 다음 번역부터 적용돼요.' : '지금은 용어집을 저장하지 못했어요. 번역이 끝난 뒤 다시 시도해 주세요.'); }} />` (`props.glossary`가 있을 때만 렌더).
  - 문단 시트(기존 버튼들 **뒤**): `props.glossary && version && oneToOneParagraphs && paragraphSheet !== null`이면
    - `<Button variant="text" disabled={props.glossary.locked} onClick={() => { const sourceText = version.source.paragraphs[paragraphSheet]?.text ?? ''; setParagraphSheet(null); setEditor({ mode: 'add', sourceText }); }}>용어 추가하기</Button>`
    - `paragraphTerms(sourceText, terms)`가 있으면 `<p>이 문단의 용어</p>` + 용어마다 `<Button variant="text" onClick={() => { setParagraphSheet(null); setTermSheet(item); }}>{`${item.source} · ${item.target}`}</Button>`.
  - CSS: `.nr-term { background: color-mix(in srgb, currentColor 10%, transparent); color: inherit; text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; border-radius: 2px; }`
  - Application: 파일 위에서 `useReaderGlossary` import. `RouteScreen` 안에서 `const readerWorkId = state.route.kind === 'translation' ? state.chapter?.workId ?? null : state.route.kind === 'reader' ? state.version?.source.workId ?? null : null;` `const glossary = useReaderGlossary({ workId: state.guidanceAvailable ? readerWorkId : null, refreshKey: state.version?.versionId, read: controller.readGuidance, save: controller.saveGuidance });` 두 `<ImmersiveReader>`에 `glossary={glossary ? { ...glossary, locked: state.busy || state.translationActive } : undefined}`. (훅은 조건문 밖, 컴포넌트 최상단에서 부른다.)
- [ ] **Step 3: 전체 검증 후 커밋** — `feat: 리더에서 용어 강조·길게 눌러 편집·삭제·바로 추가 (#265)`
