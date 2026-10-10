# 용어 처리 재설계(치환 제거) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 용어집 이름을 부분 문자열로 찾아 자리표시로 단순 치환하는 구조를 없애고, 글자 종류 경계로 확정 매칭과 후보 매칭을 가린 뒤 참고 목록 주입 + 문단별 표기 검사·재시도로 용어를 적용한다.

**Architecture:** 새 모듈 `termMatch.ts`가 이름 매칭(확정/후보)을 맡고, `appliedGuidance`가 이를 써서 확정 이름(`names`)과 후보 이름(`candidateNames`)을 나눠 돌려준다. 읽으며 번역(`localStreaming`)과 제목 번역은 자리표시 치환 대신, 확정 이름의 표기가 그 문단 번역에 있는지 검사해 없으면 '필수 표기' 안내를 붙여 한 번 더 요청하고, 그래도 없으면 실패가 아니라 그대로 받아들인다(표기 누락은 기존 `quality.missingTerms`로 남는다). 후보 이름은 "이름으로 쓰였을 때만" 조건을 붙여 참고 목록에만 넣는다.

**Tech Stack:** TypeScript, Vitest(jsdom/node), 기존 OpenAI 호환 스트리밍 경로.

**Spec:** `docs/superpowers/specs/2026-10-10-term-pipeline-review.md` (§3 A·B). C(기기 임베딩)는 별도 계획 `docs/superpowers/plans/2026-10-10-on-device-embedding.md`.

## Global Constraints

- 기존 저장본의 `provenance.guidanceHash`가 **바뀌면 안 된다**: `appliedGuidanceHash`는 지금처럼 `{ term, names }` 배열을 해시하고, `names`는 확정+후보 이름을 원래 순서(`[term.source, ...term.aliases]` 순)로 합친 값이다.
- 한 글자·짧은 히라가나 이름 제외(`isUnsafeTermName`, #235)는 유지한다.
- 말투(voices) 매칭은 바꾸지 않는다(`matchedNames` 그대로).
- 코드 주석·커밋은 한국어, 커밋 제목은 conventional 타입 + 한국어 + `(#이슈)`.
- 새 npm·Gradle 의존성 없음.
- 실제 모델 서버·외부 사이트에 요청하는 테스트 금지.
- 각 태스크 끝에 전체 `npx vitest run`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.

## File Structure

- Create `src/translation/termMatch.ts` — 글자 종류 판정, 경계 규칙, `findTermMatches`.
- Modify `src/translation/guidance.ts` — `appliedGuidance`가 `findTermMatches` 사용, 참고 문구 두 형식에 후보 조건, 해시 호환.
- Modify `src/translation/quality.ts` — `missingTerms`는 확정 이름이 있는 항목만.
- Modify `src/contracts/reading.ts` — `lockedTerms` 제거, `requiredTerms` 추가.
- Modify `src/providers/localStreaming.ts` — 마스킹 제거, 표기 검사·재시도·대체 수용.
- Modify `src/translation/wholeChapter.ts`, `src/translation/titles.ts` — `requiredTerms` 전달.
- Modify `src/translation/scan.ts`, `src/translation/termScan.ts` — 짧은 후보 제외.
- Tests: `tests/translation/termMatch.test.ts`(신규), `tests/translation/guidance*.test.ts`, `tests/translation/quality*.test.ts`, `tests/providers/local-streaming.test.ts`, `tests/integration/title-provider.test.tsx`, `tests/translation/scan*.test.ts`, `tests/translation/termScan.test.ts`.

---

### Task 1: 경계 매칭과 확정/후보 분리

**Files:**
- Create: `src/translation/termMatch.ts`
- Modify: `src/translation/guidance.ts` (`matchedNames` 아래 `appliedGuidance`·`guidanceContext`·`streamingGuidanceContext`·`appliedGuidanceHash`)
- Modify: `src/translation/quality.ts`
- Test: `tests/translation/termMatch.test.ts`, 기존 guidance·quality 테스트

**Interfaces:**
- Produces:
  - `export type CharClass = 'katakana' | 'kanji' | 'hiragana' | 'other'`
  - `export function charClass(char: string): CharClass`
  - `export type TermMatch = { name: string; start: number; end: number; confirmed: boolean }`
  - `export function findTermMatches(input: string, names: readonly string[]): TermMatch[]`
  - `appliedGuidance(...)`의 `terms` 원소가 `{ term: GuidanceTerm; names: string[]; candidateNames: string[] }`가 된다(`names` = 확정만).

- [ ] **Step 1: termMatch 테스트 작성**

```ts
import { describe, expect, it } from 'vitest';
import { charClass, findTermMatches } from '../../src/translation/termMatch';

describe('charClass', () => {
  it('글자 종류', () => {
    expect(charClass('ア')).toBe('katakana');
    expect(charClass('ー')).toBe('katakana');
    expect(charClass('・')).toBe('katakana');
    expect(charClass('魔')).toBe('kanji');
    expect(charClass('々')).toBe('kanji');
    expect(charClass('の')).toBe('hiragana');
    expect(charClass('「')).toBe('other');
    expect(charClass('A')).toBe('other');
  });
});

describe('findTermMatches', () => {
  const hit = (input: string, names: string[]) =>
    findTermMatches(input, names).map(({ name, confirmed }) => `${name}:${confirmed ? 'O' : '?'}`);

  it('가타카나 덩어리 전체와 일치하면 확정', () => {
    expect(hit('ルシアナは笑った', ['ルシアナ'])).toEqual(['ルシアナ:O']);
    expect(hit('「ルシアナ様」', ['ルシアナ'])).toEqual(['ルシアナ:O']);
  });
  it('덩어리 일부면 후보', () => {
    expect(hit('クリストファーが来た', ['リスト'])).toEqual(['リスト:?']);
    expect(hit('アルベルト・フォン', ['アルベルト'])).toEqual(['アルベルト:?']);
  });
  it('한자 이름 뒤 흔한 접미(様·殿·家 등)는 경계로 본다', () => {
    expect(hit('斎藤道三様が', ['斎藤道三'])).toEqual(['斎藤道三:O']);
    expect(hit('魔王城へ', ['魔王'])).toEqual(['魔王:?']);
    expect(hit('魔王が', ['魔王'])).toEqual(['魔王:O']);
  });
  it('짧은 이름(isUnsafeTermName)은 아예 찾지 않는다', () => {
    expect(hit('ちょっと待って', ['ち'])).toEqual([]);
    expect(hit('希望がある', ['希'])).toEqual([]);
  });
  it('긴 이름이 먼저 잡히고 그 구간 안의 짧은 이름은 따로 잡히지 않는다', () => {
    expect(hit('ルシアナ・ルトルバーグが', ['ルシアナ', 'ルシアナ・ルトルバーグ'])).toEqual([
      'ルシアナ・ルトルバーグ:O',
    ]);
  });
  it('같은 이름이 여러 번 나오면 각각 판정한다', () => {
    expect(hit('リストを見たクリストファー', ['リスト'])).toEqual(['リスト:O', 'リスト:?']);
  });
  it('NFKC 기준으로 찾는다', () => {
    expect(hit('ﾙｼｱﾅが', ['ルシアナ'])).toEqual(['ルシアナ:O']);
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/translation/termMatch.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: termMatch 구현**

```ts
import { isUnsafeTermName } from './guidance';

export type CharClass = 'katakana' | 'kanji' | 'hiragana' | 'other';
export type TermMatch = { name: string; start: number; end: number; confirmed: boolean };

/** 한자 이름 뒤에 붙어도 이름의 경계로 보는 흔한 접미(경칭·가문). */
const KANJI_SUFFIXES = new Set(['様', '殿', '家', '君', '氏', '卿', '嬢', '達']);

export function charClass(char: string): CharClass {
  if (/[\p{Script=Katakana}ー・]/u.test(char)) return 'katakana';
  if (/[\p{Script=Han}々〆ヶ]/u.test(char)) return 'kanji';
  if (/\p{Script=Hiragana}/u.test(char)) return 'hiragana';
  return 'other';
}

/**
 * 입력에서 이름을 찾는다. 긴 이름부터, 이미 잡힌 구간과 겹치지 않게 찾는다.
 * 이름의 첫 글자와 같은 종류의 글자가 바로 앞에, 마지막 글자와 같은 종류가 바로 뒤에 붙어 있으면
 * 더 긴 단어의 일부일 수 있으므로 후보(confirmed=false)로 둔다. 한자 이름 뒤의 흔한 접미는 경계로 본다.
 * 짧은 이름(isUnsafeTermName)은 찾지 않는다.
 */
export function findTermMatches(input: string, names: readonly string[]): TermMatch[] {
  const text = input.normalize('NFKC');
  const chars = [...text];
  const taken = new Array<boolean>(chars.length).fill(false);
  const result: TermMatch[] = [];
  const unique = [...new Set(names.map((name) => name.normalize('NFKC')))]
    .filter((name) => name && !isUnsafeTermName(name))
    .sort((left, right) => [...right].length - [...left].length);
  const original = new Map(names.map((name) => [name.normalize('NFKC'), name]));
  for (const name of unique) {
    const target = [...name];
    for (let start = 0; start + target.length <= chars.length; start++) {
      let same = true;
      for (let k = 0; k < target.length; k++) {
        if (taken[start + k] || chars[start + k] !== target[k]) {
          same = false;
          break;
        }
      }
      if (!same) continue;
      const end = start + target.length;
      const before = start > 0 ? chars[start - 1]! : '';
      const after = end < chars.length ? chars[end]! : '';
      const first = charClass(target[0]!);
      const last = charClass(target[target.length - 1]!);
      const joinedBefore = before !== '' && first !== 'other' && charClass(before) === first;
      const joinedAfter =
        after !== '' &&
        last !== 'other' &&
        charClass(after) === last &&
        !(last === 'kanji' && KANJI_SUFFIXES.has(after));
      for (let k = start; k < end; k++) taken[k] = true;
      result.push({
        name: original.get(name) ?? name,
        start,
        end,
        confirmed: !joinedBefore && !joinedAfter,
      });
      start = end - 1;
    }
  }
  return result.sort((left, right) => left.start - right.start);
}
```

(`start`/`end`는 코드포인트 기준. `guidance.ts`가 `termMatch.ts`를 import하고 `termMatch.ts`가 `isUnsafeTermName`을 import하는 순환을 피하려면 `isUnsafeTermName`을 `termMatch.ts`로 옮기고 `guidance.ts`에서 다시 export한다.)

- [ ] **Step 4: termMatch 테스트 통과 확인** — `npx vitest run tests/translation/termMatch.test.ts` → PASS.

- [ ] **Step 5: appliedGuidance 테스트 추가(기존 guidance 테스트 파일)**

```ts
it('확정 이름과 후보 이름을 나눈다', () => {
  const guidance = makeGuidance([
    { source: 'リスト', target: '크리스토퍼', aliases: [] },
    { source: 'ルシアナ', target: '루시아나', aliases: [] },
  ]);
  const applied = appliedGuidance(guidance, 'w1', 'クリストファーとルシアナ', [])!;
  expect(applied.terms.map((t) => [t.term.source, t.names, t.candidateNames])).toEqual([
    ['リスト', [], ['リスト']],
    ['ルシアナ', ['ルシアナ'], []],
  ]);
});
it('참고 문구: 후보에는 이름으로 쓰였을 때만 조건이 붙는다', () => {
  const text = guidanceContext(guidance, 'w1', 'クリストファーとルシアナ', []);
  expect(text).toContain('ルシアナ translates to 루시아나');
  expect(text).toContain('リスト translates to 크리스토퍼 (only where リスト is used as this name)');
});
it('적용 해시는 확정·후보를 합친 이름으로 계산해 예전과 같다', async () => {
  // 예전 구현(부분 문자열 매칭)과 같은 입력에서 같은 해시
  expect(await appliedGuidanceHash(guidance, 'w1', 'クリストファーとルシアナ', [])).toBe(
    await digest(['w1', [
      { term: guidance.terms[0], names: ['リスト'] },
      { term: guidance.terms[1], names: ['ルシアナ'] },
    ], []]),
  );
});
```
(`makeGuidance`·`digest`는 기존 테스트 파일의 헬퍼·`src/storage/journal.ts`의 `digest`를 쓴다. 헬퍼 이름이 다르면 그 파일의 것을 쓴다.)

- [ ] **Step 6: 실패 확인** — `npx vitest run tests/translation` → 새 테스트 FAIL.

- [ ] **Step 7: guidance.ts 구현**
  - `appliedGuidance`: 용어 이름 매칭을 `findTermMatches(input, candidates.flatMap(t => [t.source, ...t.aliases]))`로 바꾼다. 매치 결과에서 이름별로 `confirmed`가 하나라도 true면 확정 이름, 전부 false면 후보 이름. 항목마다
    ```ts
    names: [term.source, ...term.aliases].filter((name) => confirmedNames.has(name)),
    candidateNames: [term.source, ...term.aliases].filter((name) => candidateOnly.has(name)),
    ```
    둘 다 비면 제외.
  - `guidanceContext`: 확정 이름은 지금 문구 그대로. 후보 이름은 `${name} translates to ${term.target} (only where ${name} is used as this name)`.
  - `streamingGuidanceContext`: 확정 `${name}->${target}${tags}`, 후보 `${name}->${target}${tags} (only if used as a name here)`.
  - `appliedGuidanceHash`: `applied.terms.map(({ term, names, candidateNames }) => ({ term, names: [term.source, ...term.aliases].filter((n) => names.includes(n) || candidateNames.includes(n)) }))`를 해시한다(예전과 같은 모양).
- [ ] **Step 8: quality.ts** — `missingTerms`는 `names.length > 0`(확정)인 항목만 검사한다.
- [ ] **Step 9: 전체 검사** — `npx vitest run`(기존 테스트 기대값 중 후보 문구·`candidateNames` 필드 때문에 바뀌는 것만 고친다), typecheck, lint, format:check, build.
- [ ] **Step 10: Commit** — `git add src/translation/termMatch.ts src/translation/guidance.ts src/translation/quality.ts tests/translation/...` / `refactor: 용어 매칭을 글자 종류 경계로 확정·후보 분리 (#이슈)`

### Task 2: 읽으며 번역·제목 번역에서 자리표시 치환 제거

**Files:**
- Modify: `src/contracts/reading.ts:70` (`lockedTerms` → `requiredTerms`)
- Modify: `src/providers/localStreaming.ts` (마스킹 코드 56~70행, `INSTRUCTION`, `validateLine` 129~145행, 수락 루프 150~230행)
- Modify: `src/translation/wholeChapter.ts:233-240`, `src/translation/titles.ts:203-209`
- Test: `tests/providers/local-streaming.test.ts`, `tests/integration/title-provider.test.tsx`

**Interfaces:**
- Consumes: Task 1의 `appliedGuidance(...).terms[].names`(확정 이름).
- Produces: `WholeChapterRequest.requiredTerms?: (input: string) => readonly { source: string; target: string }[]` — 그 입력(한 문단)에서 확정 매칭된 이름과 표기.

- [ ] **Step 1: 테스트 작성(local-streaming)** — 가짜 스트림 transport로:
  1. 용어 `ルシアナ → 루시아나`가 있을 때 모델 요청 본문에 `__ENT_`가 없고 원문 `ルシアナ`가 그대로 들어간다.
  2. 첫 응답이 `루시아나` 없이 `르시아나는 웃었다`면, 두 번째 요청을 보내고 그 요청에 `Required renderings` 줄과 `ルシアナ → 루시아나`가 들어간다. 두 번째 응답이 `루시아나는 웃었다`면 그 값을 쓴다.
  3. 두 번째 응답에도 없으면 실패가 아니라 마지막 응답 값을 쓰고 `failedParagraphs`에 넣지 않는다.
  4. `autoRetryFailed: false`면 요청은 한 번이고 표기가 없어도 그 값을 쓴다.
  5. 가나가 남은 응답은 지금처럼 실패 처리된다(기존 테스트 유지).
  - 기존 `__ENT_` 관련 테스트(자리표시 복원·개수 검증)는 삭제하고 위 테스트로 대체한다.
- [ ] **Step 2: 실패 확인** — `npx vitest run tests/providers/local-streaming.test.ts`.
- [ ] **Step 3: 구현**
  - `INSTRUCTION`에서 `Copy __ENT placeholders exactly; never translate or remove them. ` 문장을 지운다.
  - `names`·`prefix`·`entities`·`mask`·`restore`를 지우고, 원문은 그대로 보낸다(`taggedLines(batch)`).
  - 단위별 필수 표기: `const required = (unit: LineUnit) => request.requiredTerms?.(unit.text) ?? []`.
  - `validateLine(unit, body)` → `{ value: string; missing: { source: string; target: string }[] } | null`:
    ```ts
    const value = clean(body);
    if (!value || kana.test(value)) return null;
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(unit.text) && !/\p{Script=Hangul}/u.test(value)) return null;
    const output = value.normalize('NFKC');
    const missing = required(unit).filter((t) => !output.includes(t.target.normalize('NFKC')));
    return { value, missing };
    ```
  - 수락 루프: `missing.length && attempt + 1 < attempts`면 `fallback.set(id, value)`만 하고 수락하지 않는다(다음 시도 대상). 그 밖은 수락. 시도가 끝난 뒤 수락되지 않았지만 `fallback`이 있는 단위는 `done.set(id, fallback.get(id)!)`(실패 아님). `historyRows`는 수락된 값만.
  - 재시도 메시지: `pending` 중 직전 시도에서 `missing`이 있던 단위의 필수 표기를 모아 `current(pending)`의 note 앞에 붙인다:
    ```ts
    'Required renderings for this passage (use exactly):\n' + lines.map((t) => `${t.source} → ${t.target}`).join('\n') + '\n'
    ```
  - 미리보기 파서는 `validateLine(...)?.value`를 쓴다.
- [ ] **Step 4: wholeChapter·titles** — `lockedTerms` 대신
  ```ts
  requiredTerms: (input: string) =>
    (appliedGuidance(guidance, chapter.workId, input, [])?.terms ?? []).flatMap(({ term, names }) =>
      names.map((source) => ({ source, target: term.target })),
    ),
  ```
  (titles는 `terms`, `workId` 변수 이름 그대로.)
- [ ] **Step 5: 제목 테스트 갱신** — `tests/integration/title-provider.test.tsx`에서 `__ENT_` 기대를 지우고, 제목 요청 본문에 원문 이름이 그대로 있고 표기가 없으면 한 번 더 요청하는지 확인한다.
- [ ] **Step 6: 전체 검사** 후 **Commit** — `fix: 읽으며 번역에서 자리표시 치환을 없애고 표기 검사로 재시도 (#이슈)`

### Task 3: 후보 수집에서 짧은 이름 제외

**Files:**
- Modify: `src/translation/scan.ts` (`createNameCandidateScan`의 후보 추가 지점), `src/translation/termScan.ts` (`collectScanCandidates`의 규칙 후보·`only` 그룹 추가 지점)
- Test: 기존 scan·termScan 테스트

**Interfaces:**
- Consumes: `isUnsafeTermName`(Task 1에서 `termMatch.ts`로 이동, `guidance.ts`에서 재export).

- [ ] **Step 1: 테스트** — 루비 기반 후보 `ち《…》`·가타카나 반복 후보 중 `isUnsafeTermName`인 이름이 범위 후보 스캔 결과와 정밀스캔 후보에 나오지 않는다. 용어집에 이미 있는 짧은 항목도 정밀스캔 후보(recheck/suggest)로 올리지 않는다.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 두 수집 함수에서 이름을 후보에 넣기 직전에 `if (isUnsafeTermName(name)) skip`.
- [ ] **Step 4: 전체 검사** 후 **Commit** — `fix: 범위·정밀스캔 후보에서 짧은 이름 제외 (#이슈)`

### Task 4(컨트롤러 담당 직접): 실측 비교

- 0.1.21 빌드로 Fold7에서 n0421du 1~3화를 다시 번역(사용자 확인 후, 기존 저장본은 남는다)하고 다음을 잰다: 실패 문단 수, 원문에 없는 용어 표기 삽입 수(예: 원문에 ルシアナ 없이 '루시아나'), 확정 이름 표기 일치율(`missingTerms` 수), 회차당 추가 요청 수(`generation.continuations`).
- 0.1.19(치환) 저장본과 비교해 기록한다(원문·번역문 자체는 공개 기록에 남기지 않는다).
