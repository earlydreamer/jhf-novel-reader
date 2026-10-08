# 회차 저장본 삭제 (#98) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 목차의 회차 바텀시트에서 그 화의 번역 저장본과 읽던 위치만 지우고, 목차 상태와 이어 읽기를 바로 갱신한다.

**Architecture:** 저장소(`src/storage/library.ts`)에 `removeChapterVersions(chapterId)`를 추가한다. 작품 제거(#94)와 같은 순서 원칙을 따른다: 막는 조건 확인 → 새 색인을 **두 슬롯 모두** 검증 저장 → 그 뒤에만 파일 삭제. 컨트롤러는 실행 중 상태(번역·저장 대기·일괄 번역·미확인 요청)를 먼저 막고, 성공하면 메모리 캐시·기록·스냅샷을 정리한다. 목차 화면은 저장된 회차의 시트에만 삭제 항목을 보여 주고 확인 대화상자를 거친다.

**Tech Stack:** React 19, TypeScript, Vitest 5 + Testing Library(jsdom), 저장소 Journal(두 슬롯 세대 저장).

**Spec:** `docs/superpowers/specs/2026-10-08-ui-design-system-design.md` 6.7절(회차 저장본 삭제), 6.4절(목차 회차 시트), 7절(UX 라이팅). 이슈 #98.

## Global Constraints

- 사용자 문구는 해요체(스펙 7절). 확인 대화상자 왼쪽 버튼은 `닫기`. 파괴 버튼은 `variant="filled" tone="danger"`(작품 제거 대화상자와 같은 형태).
- 토큰 밖 hex 금지. 코드 주석은 한국어.
- 기존 단언을 약하게 바꾸지 않는다. 새 테스트는 구현 전에 실패를 확인한다.
- 새 파일 저장 형식·색인 스키마를 바꾸지 않는다(`removalInventory` 확장 금지).
- 커밋 형식 `feat: 한국어 설명 (#98)` 또는 `test:`/`fix:`, 본문 끝 `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. 경로 명시 stage.

## 판정 (계획 단계에서 내린 결정)

- **삭제 범위**: 색인 `versions` 중 `chapterId`가 같은 모든 저장본의 `versions/<id>.{0,1}.json`과 `reading/<id>.{0,1}.json`. 파일은 payload 소유권(`source.chapterId`, `reading.versionId·chapterId`)이 맞는 슬롯만 지운다. 소유권이 다르거나 손상된 슬롯은 보존하고 `remainingInventory`에 적는다.
- **지우지 않는 것**: 회차 제목 번역(`titles/`), 용어집, 완료(`complete`)된 attempts 기록(요청 토큰만 있고 본문이 없다), v1 레거시 `chapters/`·`positions/`(저장됨 판정에 쓰이지 않는다; 작품 제거가 정리). 틀렸을 때 비용: 해당 레거시 파일이 작품 제거 때까지 남는다.
- **recent**: 지운 저장본을 가리키는 `recent` 항목은 뺀다(색인 검증이 recent의 versionId가 versions에 있어야 한다고 요구하므로 필수). 다른 회차로 대체하지 않는다(스펙 6.7).
- **부분 실패**: 색인을 두 슬롯 모두 저장한 뒤 파일 삭제가 일부 실패하면 `removed: true, cleanupComplete: false`. 색인에 없는 파일은 어떤 읽기 경로에도 보이지 않고, 작품 제거의 색인 밖 검사가 나중에 정리한다. 틀렸을 때 비용: 작품 제거 전까지 사적 파일이 기기에 남는다.
- **저장본이 없는 회차**: 멱등. `removed: true, cleanupComplete: true, versionIds: []`, 아무것도 쓰지 않는다.
- **막는 조건**: 저장소는 작품 제거 대기 중(`removed: false`), 그 회차의 미완료 attempt(`unfinished_attempt`), 그 작품의 진행 중 batch 또는 런타임 owner(`batch`). 컨트롤러는 여기에 그 회차의 저장 대기(`pending_save`)와 번역 중(`translation`)을 더한다. 같은 작품의 **다른 회차** 번역은 막지 않는다.

---

### Task 1: 저장소 `removeChapterVersions`

**Files:**

- Modify: `src/contracts/reading.ts` (LibraryStore, 결과 타입)
- Modify: `src/storage/library.ts`
- Create: `tests/storage/removeChapterVersions.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // src/contracts/reading.ts
  export interface ChapterRemovalResult extends WorkRemovalResult {
    /** 색인에서 뺀 저장본 ID. removed가 true가 아니면 빈 배열이다. */
    versionIds: readonly string[];
  }
  // LibraryStore에 추가(선택 멤버, 기존 테스트 가짜 객체를 깨지 않게)
  removeChapterVersions?(
    chapterId: string,
    runtime?: { activeBatchWorkId?: string },
  ): Promise<ChapterRemovalResult>;
  ```

  `src/contracts/index.ts`가 reading의 타입을 다시 내보내는 방식이면 `ChapterRemovalResult`도 같은 방식으로 내보낸다(`WorkRemovalResult`가 어떻게 export되는지 grep으로 확인).

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/storage/removeChapterVersions.test.ts`

`tests/storage/removeWork.test.ts`의 `fixture()`를 그대로 복사하고, 두 회차짜리 작품과 회차별 저장본을 만드는 도우미를 둔다:

```ts
import { expect, test } from 'vitest';
import type { CompletedTranslation, WorkPage } from '../../src/contracts';
import { createLibraryStore } from '../../src/storage/library';
import type { PrivateFiles } from '../../src/storage/journal';
import { createAttemptRepository } from '../../src/translation/attempts';
import { createBatchRepository } from '../../src/translation/batch';
import { source } from '../providers/wholeChapterFixture';

// fixture()는 removeWork.test.ts에서 그대로 복사

function work(workId: string): WorkPage {
  return {
    workId,
    canonicalUrl: `https://ncode.syosetu.com/${workId}/`,
    title: `작품 ${workId}`,
    chapters: [1, 2].map((ordinal) => ({
      workId,
      chapterId: `${workId}/${ordinal}`,
      canonicalUrl: `https://ncode.syosetu.com/${workId}/${ordinal}/`,
      title: `${ordinal}화`,
      ordinal,
    })),
    pageUrl: `https://ncode.syosetu.com/${workId}/`,
    nextPageUrl: null,
    complete: true,
  };
}

function version(page: WorkPage, ordinal: number, suffix = 'a'): CompletedTranslation {
  const ref = page.chapters[ordinal - 1]!;
  const id = `${page.workId}-${ordinal}-${suffix}`;
  return {
    schemaVersion: 2,
    versionId: `version-${id}`,
    source: {
      ...source,
      canonicalUrl: ref.canonicalUrl,
      workId: ref.workId,
      chapterId: ref.chapterId,
      title: ref.title,
      sourceHash: `source-${id}`,
      paragraphs: [{ id: `paragraph-${id}`, text: '원문', ruby: [] }],
      prevUrl: null,
      nextUrl: null,
      rawHtml: '<p>원문</p>',
      captureKind: 'fetched',
      fetchedAt: '2026-10-08T00:00:00Z',
    },
    text: '번역',
    blocks: [{ id: `block-${id}`, text: '번역' }],
    createdAt: suffix === 'a' ? '2026-10-08T00:00:00Z' : '2026-10-08T01:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'fixture',
      modelId: 'fixture',
      contractVersion: 'plain-v1',
      promptVersion: 'fixture-v1',
      languageDirection: 'ja-ko',
    },
  };
}

async function position(
  library: ReturnType<typeof createLibraryStore>,
  value: CompletedTranslation,
  offset = 3,
) {
  await library.savePosition({
    workId: value.source.workId,
    chapterId: value.source.chapterId,
    versionId: value.versionId,
    blockId: value.blocks[0]!.id,
    offset,
  });
}
```

테스트(각각 별도 `test`):

1. `'그 회차 저장본과 위치만 지우고 다른 회차·다른 작품은 보존한다'`
   - 작품 A(`n1111aa`)의 1화 저장본 2개(`a`,`b`)·2화 저장본 1개, 작품 B(`n2222bb`) 1화 1개를 commit, 각각 `position` 저장. 마지막에 A 2화 위치를 저장해 A의 recent가 2화가 되게 한다.
   - `const result = await library.removeChapterVersions!('n1111aa/1')`
   - 기대: `result`가 `{ removed: true, cleanupComplete: true, remainingInventory: [] }`를 포함하고 `[...result.versionIds].sort()`가 A 1화의 두 versionId. `await library.listVersions('n1111aa/1')`는 `[]`, `listVersions('n1111aa/2')`와 `listVersions('n2222bb/1')`은 각각 1개. `memory`에 `versions/version-n1111aa-1-a.0.json`·`.1.json`, `reading/version-n1111aa-1-a.*`, `-1-b` 쪽 키가 하나도 없다(`[...memory.keys()].filter((key) => key.includes('n1111aa-1-'))`가 `[]`). A 2화와 B의 versions·reading 키는 남아 있다. `listRecent()`에 A(2화)와 B 항목이 그대로 있다.
2. `'읽는 중 저장본을 지우면 그 작품의 recent만 뺀다'`
   - A 1화(`a`)와 B 1화를 commit·position. A의 recent가 1화.
   - 삭제 후 `listRecent()`에 A가 없고 B는 있다. `listWorkIds()`에는 A가 그대로 있다(작품은 서재에 남는다).
3. `'두 index 슬롯 모두 같은 결과를 담는다'`
   - 1번처럼 준비 후 삭제. `memory.get('library/index.0.json')`과 `.1.json`을 각각 `JSON.parse(...).payload`로 읽어 둘 다 `versions`에 `chapterId === 'n1111aa/1'` 항목이 없다.
4. `'저장본이 없는 회차는 아무것도 쓰지 않고 성공으로 끝난다'`
   - A 작품만 저장(`saveWorkPage`). `const before = state.writes.length;` 삭제 → `{ removed: true, cleanupComplete: true, remainingInventory: [], versionIds: [] }` 그리고 `state.writes.length === before`.
5. `'그 회차의 미완료 요청이 있으면 막고 다른 회차의 미완료 요청은 막지 않는다'`
   - A 1화·2화 commit. `createAttemptRepository(files).write({ token: { requestId: 'pending-1', chapterId: 'n1111aa/1', settingsRevision: 1 }, phase: 'dispatching' })`.
   - `removeChapterVersions('n1111aa/1')` → `{ removed: false, blockedBy: 'unfinished_attempt' }`, `state.removed`가 `[]`, `listVersions('n1111aa/1')` 1개.
   - `removeChapterVersions('n1111aa/2')` → `removed: true`.
6. `'그 작품의 진행 중 batch나 런타임 owner가 있으면 막는다'`
   - A 1화 commit. (a) `removeChapterVersions('n1111aa/1', { activeBatchWorkId: 'n1111aa' })` → `blockedBy: 'batch'`. (b) `removeWork.test.ts`의 `batchRecord` 도우미를 복사해 `createBatchRepository(files).write(batchRecord(A, 'running'))` 뒤 호출 → `blockedBy: 'batch'`. 두 경우 모두 `state.removed`는 `[]`.
7. `'작품 제거가 남아 있는 작품은 회차 삭제를 하지 않는다'`
   - A 1화 commit 후 `files.remove`를 잠시 실패시키는 래퍼로 `removeWork!('n1111aa')`를 불러 `removalInventory`를 남긴다(removeWork.test의 물리 삭제 실패 테스트 방식 참고). 그 뒤 `removeChapterVersions('n1111aa/1')`가 `removed: true`(색인에 그 회차 저장본이 이미 없으므로 멱등 경로)이거나 `removed: false` 중 무엇이든 **파일을 지우지 않는다**를 확인한다: 호출 전후 `state.removed` 길이가 같다.
   - 구현 메모: 작품 제거는 색인 `versions`에서 그 작품을 먼저 빼므로 대부분 4번의 멱등 경로로 끝난다. 이 테스트는 "작품 제거 대기 중에 회차 삭제가 파일을 건드리지 않는다"만 고정한다.
8. `'두 번째 index 슬롯 저장이 실패하면 논리 삭제만 하고 파일을 지우지 않는다'`
   - removeWork.test의 `rejectOldSlot` 패턴: A 1화 commit 뒤, 다음에 쓸 슬롯을 알아내 그 **두 번째 쓰기**만 실패시킨다. 간단한 방법: `let indexWrites = 0; let failSecond = false;` 래퍼에서 `if (failSecond && path.startsWith('library/index.') && ++indexWrites === 2) throw new Error('write failure');`.
   - 기대: `{ removed: true, cleanupComplete: false }`, `remainingInventory`에 `'library/index'`, `state.removed`가 `[]`, `listVersions('n1111aa/1')`이 `[]`(최신 슬롯 기준).
9. `'파일 삭제가 실패하면 남은 경로를 보고한다'`
   - `remove`가 `versions/`로 시작하는 경로에서 throw하는 래퍼. 기대: `{ removed: true, cleanupComplete: false }`, `remainingInventory`에 `versions/version-n1111aa-1-a.0.json` 포함, `listVersions('n1111aa/1')`은 `[]`, `reading/...` 경로는 지워졌다.
10. `'소유권이 다른 저장본 슬롯은 지우지 않고 보고한다'`

- A 1화(`a`) commit 뒤 `memory`의 `versions/version-n1111aa-1-a.<사용 중이 아닌 슬롯>.json`이 없으면 이 테스트는 다음처럼 만든다: B 1화 저장본의 원본 JSON 문자열(`memory.get('versions/version-n2222bb-1-a.0.json')`)을 `versions/version-n1111aa-1-a.1.json` 키에 복사한다(체크섬은 유효하지만 payload의 chapterId가 다름).
- 기대: 삭제 결과 `cleanupComplete: false`, `remainingInventory`에 `versions/version-n1111aa-1-a.1.json`, 그 키가 `memory`에 남아 있다. `.0.json`은 지워졌다.
- 메모: Journal의 checksum이 payload와 generation에만 의존하는지 `src/storage/journal.ts`에서 확인한다. 이름이 checksum에 들어가면 복사본은 `invalidSlots`로 분류되고, 그래도 "보존하고 보고"는 같다.

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/storage/removeChapterVersions.test.ts`
Expected: FAIL — `library.removeChapterVersions is not a function`(또는 타입 오류).

- [ ] **Step 3: 계약 타입 추가** — 위 Interfaces 그대로.

- [ ] **Step 4: 구현** — `src/storage/library.ts`

`removeWorkData` 아래에 추가하고, import에 `ChapterRemovalResult`를 더한다.

```ts
async function removeChapterVersionData(
  files: PrivateFiles,
  journal: Journal,
  chapterId: string,
  activeBatchWorkId?: string,
): Promise<ChapterRemovalResult> {
  chapterIdentity(chapterId);
  const kept = (extra: Partial<ChapterRemovalResult> = {}): ChapterRemovalResult => ({
    removed: false,
    cleanupComplete: false,
    remainingInventory: [],
    versionIds: [],
    ...extra,
  });
  const unknown = (): ChapterRemovalResult => ({
    ...kept(),
    removed: null,
    remainingInventory: ['library/index'],
  });
  const indexSlots = await journal.readSlots('library/index', index);
  if (indexSlots.found && !indexSlots.entries.length) return unknown();
  const current = indexSlots.entries[0]?.value ?? {
    versions: [],
    workIds: [],
    recent: [],
    removalInventory: [],
  };
  const targets = current.versions.filter((entry) => entry.chapterId === chapterId);
  if (!targets.length)
    return { removed: true, cleanupComplete: true, remainingInventory: [], versionIds: [] };
  const workId = targets[0]!.workId;
  // 작품 제거 정리가 남아 있으면 그 정리가 먼저다.
  if (
    indexSlots.entries.some((entry) =>
      (entry.value.removalInventory ?? []).some((item) => item.workId === workId),
    )
  )
    return kept();
  const attemptSlots = await journal.readSlots('attempts/index', validateAttempts);
  const latestAttempts = attemptSlots.entries[0];
  if (attemptSlots.found && !latestAttempts)
    return kept({ remainingInventory: ['attempts/index'] });
  if (
    (latestAttempts?.value ?? []).some(
      (entry) => entry.token.chapterId === chapterId && entry.phase !== 'complete',
    )
  )
    return kept({ blockedBy: 'unfinished_attempt' });
  const batchSlots = await journal.readSlots('batches/current', validateBatch);
  const latestBatch = batchSlots.entries[0];
  if (batchSlots.found && !latestBatch) return kept({ remainingInventory: ['batches/current'] });
  if (
    activeBatchWorkId === workId ||
    (latestBatch?.value?.work.workId === workId && latestBatch.value.phase !== 'complete')
  )
    return kept({ blockedBy: 'batch' });

  const versionIds = targets.map((entry) => entry.versionId);
  const paths: string[] = [],
    preserved: string[] = [];
  try {
    for (const versionId of versionIds) {
      const versionSlots = await journal.readSlots(`versions/${versionId}`, completedTranslation);
      for (const entry of versionSlots.entries)
        (entry.value.source.chapterId === chapterId && entry.value.versionId === versionId
          ? paths
          : preserved
        ).push(slotPath(`versions/${versionId}`, entry.slot));
      for (const slot of versionSlots.invalidSlots)
        preserved.push(slotPath(`versions/${versionId}`, slot));
      const readingSlots = await journal.readSlots(`reading/${versionId}`, readingPosition);
      for (const entry of readingSlots.entries)
        (entry.value.chapterId === chapterId && entry.value.versionId === versionId
          ? paths
          : preserved
        ).push(slotPath(`reading/${versionId}`, entry.slot));
      for (const slot of readingSlots.invalidSlots)
        preserved.push(slotPath(`reading/${versionId}`, slot));
    }
  } catch {
    return kept({ remainingInventory: ['versions'] });
  }

  const dropped = new Set(versionIds);
  const next: Index = {
    ...current,
    versions: current.versions.filter((entry) => !dropped.has(entry.versionId)),
    recent: current.recent.filter((entry) => !dropped.has(entry.versionId)),
  };
  try {
    await journal.save('library/index', next, index);
  } catch {
    try {
      const latest = (await journal.readSlots('library/index', index)).entries[0]?.value;
      if (!latest) return unknown();
      const gone = !latest.versions.some((entry) => dropped.has(entry.versionId));
      return {
        removed: gone,
        cleanupComplete: false,
        remainingInventory: ['library/index'],
        versionIds: gone ? versionIds : [],
      };
    } catch {
      return unknown();
    }
  }
  try {
    // 두 슬롯 모두 새 색인이 검증되기 전에는 파일을 지우지 않는다.
    // 최신 슬롯이 나중에 손상돼 이전 슬롯으로 돌아가도 지운 파일을 가리키지 않게 한다.
    await journal.save('library/index', next, index);
  } catch {
    return {
      removed: true,
      cleanupComplete: false,
      remainingInventory: ['library/index'],
      versionIds,
    };
  }
  const remaining: string[] = [...preserved],
    remove = files.remove;
  for (const path of paths) {
    if (!remove) {
      remaining.push(path);
      continue;
    }
    try {
      await remove.call(files, path);
      if ((await files.read(path)) !== null) remaining.push(path);
    } catch {
      remaining.push(path);
    }
  }
  return {
    removed: true,
    cleanupComplete: remaining.length === 0,
    remainingInventory: unique(remaining),
    versionIds,
  };
}
```

`createLibraryStore`의 반환 객체에 `removeWork` 옆으로 추가:

```ts
    removeChapterVersions: (chapterId, runtime) =>
      serial(files, () =>
        removeChapterVersionData(files, journal, chapterId, runtime?.activeBatchWorkId),
      ),
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/storage/removeChapterVersions.test.ts tests/storage/removeWork.test.ts tests/storage/library.test.ts`
Expected: 전부 PASS. 실패하면 테스트를 약하게 바꾸지 말고 구현과 테스트 준비 중 어느 쪽이 사양과 다른지 보고서에 적는다.

- [ ] **Step 6: 커밋**

```bash
git add src/contracts/reading.ts src/storage/library.ts tests/storage/removeChapterVersions.test.ts
# contracts/index.ts를 바꿨다면 그 경로도 명시
git commit -m "feat: 회차 저장본을 지우는 저장소 API (#98)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 컨트롤러 `removeChapterVersions`와 번역 흐름 정리

**Files:**

- Modify: `src/translation/wholeChapter.ts` (`clearChapter`)
- Modify: `src/app/renewalController.ts`
- Create: `tests/integration/chapter-removal.test.tsx` 또는 기존 `tests/ui/renewal-library.test.tsx`에 `describe('회차 저장본 삭제', …)` 추가(아래 Step 1 참고)

**Interfaces:**

- Consumes: Task 1의 `LibraryStore.removeChapterVersions?`와 `ChapterRemovalResult`.
- Produces:

  ```ts
  // RenewalController 인터페이스(renewalController.ts 약 210행 removeWork 옆)
  removeChapterVersions(chapter: ChapterRef): Promise<ChapterRemovalResult>;
  // WholeChapterFlow 구현(wholeChapter.ts clearWork 옆)
  clearChapter(chapterId: string): boolean;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/renewal-library.test.tsx`의 `libraryHarness`·`work`·`savedVersion`을 쓴다. 이 하네스의 가짜 `library`에 `removeChapterVersions`를 추가한다:

```ts
    removeChapterVersions: vi.fn(async (chapterId: string): Promise<ChapterRemovalResult> => {
      const removedVersions = versions.get(chapterId) ?? [];
      versions.delete(chapterId);
      return {
        removed: true,
        cleanupComplete: true,
        remainingInventory: [],
        versionIds: removedVersions.map((version) => version.versionId),
      };
    }),
```

컨트롤러 단위 테스트(같은 파일, `describe('회차 저장본 삭제 컨트롤러', …)`):

1. `'저장된 회차를 지우면 savedChapterIds와 서재 행에서 빠지고 다른 회차는 남는다'`
   - 두 회차 작품(`work(id, title)`가 1회차만 만든다면 이 describe 안에서 2회차짜리 도우미를 만든다)과 1·2화 저장본을 `versions`에 넣고, 서재에서 작품을 연다(기존 테스트의 `openLibraryWork` 흐름을 따름). `controller.getSnapshot().savedChapterIds`가 두 회차를 포함하는지 확인.
   - `await controller.removeChapterVersions(chapter1)` → `removed: true`. `savedChapterIds`가 `[chapter2.chapterId]`, `library.removeChapterVersions`가 `(chapter1.chapterId, { activeBatchWorkId: undefined })`로 정확히 1회.
2. `'읽는 중 회차를 지우면 workRecent가 none으로 다시 확인된다'`
   - `library.listRecent`가 1화 저장본을 가리키게 하고 작품을 연 뒤 `workRecent.status === 'verified'` 대기. 삭제 함수에서 `listRecent`가 빈 배열을 돌려주게 바꾼 뒤 삭제 → `await vi.waitFor(() => expect(controller.getSnapshot().workRecent).toMatchObject({ status: 'none' }))`, `snapshot.recent`에 그 작품 항목이 없다.
3. `'저장 대기·번역 중·미확인 요청·일괄 번역은 막고 저장소를 부르지 않는다'`
   - 기존 removeWork 막힘 테스트(약 760–870행)가 `flow`/`batch` 가짜를 어떻게 만드는지 따라, 각 조건에서 `blockedBy`가 `'pending_save'`·`'translation'`·`'unfinished_attempt'`·`'batch'`이고 `library.removeChapterVersions`가 호출되지 않음을 확인한다. 같은 작품의 **다른 회차**가 번역 중이면 막지 않는다(저장소가 호출된다)도 하나 넣는다.
4. `'지운 저장본으로 가는 reader 기록을 뒤로 가기에서 건너뛴다'`
   - 1화 저장본을 리더로 연 뒤(`continueReading(versionId)` 등 기존 테스트 흐름) 목차로 돌아와 1화 삭제. `controller.canGoBack()`/`back()`을 반복해도 route가 `{ kind: 'reader', versionId: 삭제한 id }`가 되지 않는다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ui/renewal-library.test.tsx` → 새 테스트가 `controller.removeChapterVersions is not a function`으로 FAIL.

- [ ] **Step 3: `clearChapter` 추가** — `src/translation/wholeChapter.ts`의 `clearWork` 바로 아래:

```ts
    clearChapter(chapterId: string): boolean {
      if (slot.occupied && state.token?.chapterId === chapterId) return false;
      if (state.pendingSave?.source.chapterId === chapterId) return false;
      if (unfinished.some((token) => token.chapterId === chapterId)) return false;
      if (completed?.source.chapterId === chapterId) completed = null;
      if (state.token?.chapterId === chapterId) {
        state = { phase: 'idle', elapsedMs: 0 };
        if (!disposed) listeners.forEach((listener) => listener(state));
      }
      return true;
    },
```

`WholeChapterFlow` 타입이 별도 interface로 선언돼 있으면 거기에도 `clearChapter(chapterId: string): boolean;`을 추가한다. 테스트용 가짜 flow가 그 타입을 구현해 타입 오류가 나면 컨트롤러에서 `dependencies.flow?.clearChapter?.(…)`로 부르고 interface에는 선택 멤버로 둔다.

- [ ] **Step 4: 컨트롤러 구현** — `src/app/renewalController.ts`

1. 상태 집합 추가(`removingWorkIds` 옆): `const removingChapterIds = new Set<string>();`
2. `savePosition`의 조기 반환 조건과 `positionDrain` 루프의 `continue` 조건에 `removingChapterIds.has(version.source.chapterId)` / `removingChapterIds.has(next.chapterId)`를 더한다(삭제 중에 위치 쓰기가 끼어들지 않게).
3. `removeWork` 아래에 함수 추가:

```ts
async function removeChapterVersions(chapter: ChapterRef): Promise<ChapterRemovalResult> {
  const { chapterId, workId } = chapter;
  const library = dependencies.library;
  const refused = (blockedBy?: ChapterRemovalResult['blockedBy']): ChapterRemovalResult => ({
    removed: false,
    cleanupComplete: false,
    remainingInventory: [],
    versionIds: [],
    ...(blockedBy ? { blockedBy } : {}),
  });
  if (
    !library?.removeChapterVersions ||
    disposed ||
    removingWorkIds.has(workId) ||
    removingChapterIds.has(chapterId)
  )
    return refused();
  const flowState = dependencies.flow?.getSnapshot();
  if (
    snapshot.pendingSaveChapter?.chapterId === chapterId ||
    flowState?.pendingSave?.source.chapterId === chapterId
  )
    return refused('pending_save');
  if (
    activeTranslation?.chapterId === chapterId ||
    (flowState?.token?.chapterId === chapterId && dependencies.flow?.active)
  )
    return refused('translation');
  const batchState = dependencies.batch?.getSnapshot();
  const batchRuntimeOwner = batchState?.preparing
    ? batchState.preparingWorkId
    : batchState?.active
      ? batchState.record?.work.workId
      : undefined;
  if (
    batchState &&
    ((batchState.active && batchRuntimeOwner === workId) ||
      (batchState.record?.work.workId === workId && batchState.record.phase !== 'complete'))
  )
    return refused('batch');
  if (dependencies.flow?.getUnfinished().some((token) => token.chapterId === chapterId))
    return refused('unfinished_attempt');

  removingChapterIds.add(chapterId);
  try {
    for (const [versionId, position] of pendingPositions)
      if (position.chapterId === chapterId) pendingPositions.delete(versionId);
    const activeWriters = [...(workWriters.get(workId) ?? [])];
    if (activeWriters.length) await Promise.allSettled(activeWriters);

    let result: ChapterRemovalResult;
    try {
      result = await library.removeChapterVersions(chapterId, {
        activeBatchWorkId: batchRuntimeOwner,
      });
    } catch {
      result = {
        removed: null,
        cleanupComplete: false,
        remainingInventory: ['library/index'],
        versionIds: [],
      };
    }
    if (result.removed !== true) return result;

    const removedVersionIds = new Set(result.versionIds);
    for (const [versionId, value] of versionsById)
      if (value.source.chapterId === chapterId) removedVersionIds.add(versionId);
    removedVersionIds.forEach((versionId) => {
      versionsById.delete(versionId);
      positionsByVersion.delete(versionId);
      observedSavedVersionIds.delete(versionId);
    });
    const completed = dependencies.flow?.getCompleted();
    if (completed?.source.chapterId === chapterId)
      retiredCompletedVersionIds.add(completed.versionId);
    dependencies.flow?.clearChapter?.(chapterId);
    if (livePosition?.chapterId === chapterId) livePosition = null;
    if (retryableRepair?.base.source.chapterId === chapterId) retryableRepair = null;
    for (let index = history.length - 1; index >= 0; index--) {
      const route = history[index]!;
      if (route.kind === 'reader' && removedVersionIds.has(route.versionId))
        history.splice(index, 1);
    }
    const savedChapterIds = (savedChaptersByWork.get(workId) ?? []).filter(
      (id) => id !== chapterId,
    );
    savedChaptersByWork.set(workId, savedChapterIds);
    const showing = snapshot.version?.source.chapterId === chapterId;
    publish({
      ...(snapshot.work?.workId === workId ? { savedChapterIds } : {}),
      ...(showing ? { version: null, position: null } : {}),
      recent: snapshot.recent.filter((entry) => !removedVersionIds.has(entry.versionId)),
      libraryWorks: snapshot.libraryWorks.map((entry) =>
        entry.work.workId === workId
          ? {
              ...entry,
              savedChapterIds: entry.savedChapterIds.filter((id) => id !== chapterId),
              recent:
                entry.recent && removedVersionIds.has(entry.recent.versionId) ? null : entry.recent,
            }
          : entry,
      ),
    });
    if (snapshot.route.kind === 'work' && snapshot.route.workId === workId)
      void verifyWorkRecent(workId);
    void refreshLibrary();
    return result;
  } finally {
    removingChapterIds.delete(chapterId);
  }
}
```

- `history`·`retryableRepair`·`livePosition`·`activeTranslation` 등 이름은 removeWork 본문에서 쓰는 실제 이름과 같다. 이름이 다르면 removeWork 본문을 기준으로 맞추고 보고서에 적는다.
- `ChapterRef`·`ChapterRemovalResult` import를 추가한다.

4. 컨트롤러 인터페이스(약 210행)에 `removeChapterVersions(chapter: ChapterRef): Promise<ChapterRemovalResult>;`, 반환 객체(약 2325행 `removeWork,` 옆)에 `removeChapterVersions,`.
5. `openSavedTranslation`(약 2340행)의 첫 조건에 `!retiredCompletedVersionIds.has(value.versionId)`를 더한다(지운 완료본을 다시 열지 않게).

- [ ] **Step 5: 통과 확인** — `npx vitest run tests/ui/renewal-library.test.tsx tests/integration/controller.test.ts tests/integration/navigation-stack.test.ts` PASS.

- [ ] **Step 6: 커밋** — `feat: 회차 저장본 삭제 뒤 목차·이어 읽기 상태 갱신 (#98)`, 바꾼 경로만 stage.

---

### Task 3: 목차 회차 시트의 삭제 항목과 확인 대화상자

**Files:**

- Modify: `src/ui/WorkScreen.tsx`
- Modify: `src/app/Application.tsx` (WorkScreen에 콜백 전달)
- Modify(필요 시): `src/app/application.css` 또는 WorkScreen이 쓰는 CSS(시트 버튼 정렬만)
- Test: `tests/ui/renewal-library.test.tsx`(UI 흐름) 또는 WorkScreen 단독 렌더 테스트가 있으면 그 파일

**Interfaces:**

- Consumes: Task 2의 `controller.removeChapterVersions(chapter)`.
- Produces: `WorkScreenProps.onRemoveChapter?(chapter: ChapterRef): Promise<ChapterRemovalResult>;`

- [ ] **Step 1: 실패하는 테스트**

1. `'저장된 회차 시트에만 저장본 삭제 항목이 있다'` — 1화 저장됨, 2화 미저장. `fireEvent.click(getByRole('button', { name: '1화 메뉴' }))` → `getByRole('button', { name: '이 화 저장본 삭제하기' })` 존재. 닫고 2화 메뉴 → 그 버튼이 없다.
2. `'확인하면 지우고 행 상태·저장 수가 바뀌고 알림이 뜬다'` — 1화 메뉴 → `이 화 저장본 삭제하기` → 대화상자 제목 `1화 저장본을 삭제할까요?`, 본문에 `되돌릴 수 없어요` → `getByRole('button', { name: '삭제하기' })` 클릭 → `await screen.findByText('1화 저장본을 삭제했어요.')`(스낵바), 1화 행 버튼의 접근성 설명에 `저장됨`이 없다, 헤더 메타가 `0화 저장됨`을 포함한다.
3. `'닫기를 누르면 지우지 않는다'` — 대화상자에서 `닫기` → `library.removeChapterVersions` 미호출, 1화는 여전히 `저장됨`.
4. `'막히면 대화상자 안에 이유를 보여 주고 닫지 않는다'` — `library.removeChapterVersions`를 쓰지 않는 경로라 컨트롤러 막힘을 만들기 어렵다면 `vi.spyOn(controller, 'removeChapterVersions').mockResolvedValue({ removed: false, cleanupComplete: false, remainingInventory: [], versionIds: [], blockedBy: 'translation' })`(기존 removeWork UI 테스트 약 879행 방식) → `role="alert"`에 `이 화를 번역하고 있어요. 번역을 마치거나 중단한 뒤 다시 삭제해 주세요.`, 대화상자 유지.
5. `'정리가 일부 남으면 알림 문구가 다르다'` — spy가 `{ removed: true, cleanupComplete: false, remainingInventory: ['versions/x.0.json'], versionIds: ['x'] }` → 스낵바 `1화 저장본을 삭제했어요. 일부 파일은 다음에 정리할게요.` 대화상자 닫힘.

- [ ] **Step 2: 실패 확인** — 해당 테스트 FAIL.

- [ ] **Step 3: 구현**

`WorkScreen`:

- props에 `onRemoveChapter?(chapter: ChapterRef): Promise<ChapterRemovalResult>;`, 구조 분해에 추가.
- 상태: `const [removeChapter, setRemoveChapter] = useState<ChapterRef | null>(null); const [removeBusy, setRemoveBusy] = useState(false); const [removeFeedback, setRemoveFeedback] = useState<string | null>(null); const showSnackbar = useSnackbar();`(`./components/Snackbar`에서 import. WorkScreen이 SnackbarProvider 밖에서 렌더되는 테스트가 있으면 컨텍스트 기본값이 no-op이라 안전하다).
- 시트 안 `원문 사이트에서 보기` 링크 **앞**에(파괴 항목은 마지막에 두는 Android 관례에 맞춰 링크 **뒤**가 낫다 — 링크 뒤에 둔다):
  ```tsx
  {
    onRemoveChapter && savedChapterIds.includes(sheetChapter.chapterId) && (
      <Button
        variant="text"
        tone="danger"
        disabled={busy}
        onClick={() => {
          setRemoveChapter(sheetChapter);
          setRemoveFeedback(null);
          setSheetChapter(null);
        }}
      >
        이 화 저장본 삭제하기
      </Button>
    );
  }
  ```
  `Button`이 `tone` prop을 받는지 `src/ui/components/Button.tsx`에서 확인한다(작품 제거 대화상자가 `tone="danger"`를 쓴다).
- 확인 대화상자(다른 `Dialog`들 옆):
  ```tsx
  <Dialog
    open={!!removeChapter}
    title={
      removeChapter ? `${removeChapter.ordinal}화 저장본을 삭제할까요?` : '저장본을 삭제할까요?'
    }
    onClose={() => {
      if (!removeBusy) setRemoveChapter(null);
    }}
    actions={
      <>
        <Button variant="text" disabled={removeBusy} onClick={() => setRemoveChapter(null)}>
          닫기
        </Button>
        <Button
          variant="filled"
          tone="danger"
          disabled={removeBusy}
          onClick={() => void confirmRemoveChapter()}
        >
          삭제하기
        </Button>
      </>
    }
  >
    <p>이 화의 번역 저장본과 읽던 위치가 이 기기에서 삭제돼요. 삭제한 내용은 되돌릴 수 없어요.</p>
    {removeFeedback && <p role="alert">{removeFeedback}</p>}
  </Dialog>
  ```
- 처리 함수:
  ```ts
  const confirmRemoveChapter = async () => {
    if (!removeChapter || removeBusy || !onRemoveChapter) return;
    const target = removeChapter;
    setRemoveBusy(true);
    try {
      const result = await onRemoveChapter(target);
      if (result.removed === true) {
        setRemoveChapter(null);
        showSnackbar(
          result.cleanupComplete
            ? `${target.ordinal}화 저장본을 삭제했어요.`
            : `${target.ordinal}화 저장본을 삭제했어요. 일부 파일은 다음에 정리할게요.`,
        );
      } else if (result.removed === null) {
        setRemoveFeedback(
          '삭제 여부를 확인하지 못했어요. 앱을 완전히 종료한 뒤 다시 열어 확인해 주세요.',
        );
      } else {
        setRemoveFeedback(
          result.blockedBy === 'pending_save'
            ? '저장하지 못한 번역이 있어요. 먼저 저장을 마친 뒤 다시 삭제해 주세요.'
            : result.blockedBy === 'translation'
              ? '이 화를 번역하고 있어요. 번역을 마치거나 중단한 뒤 다시 삭제해 주세요.'
              : result.blockedBy === 'batch'
                ? '이 작품의 미리 번역이 끝나지 않았어요. 번역을 마친 뒤 다시 삭제해 주세요.'
                : result.blockedBy === 'unfinished_attempt'
                  ? '요청 결과를 확인하지 못했어요. 지금은 이 화 저장본을 삭제할 수 없어요.'
                  : '저장본을 삭제하지 못했어요. 잠시 뒤 다시 시도해 주세요.',
        );
      }
    } catch {
      setRemoveFeedback(
        '삭제 여부를 확인하지 못했어요. 앱을 완전히 종료한 뒤 다시 열어 확인해 주세요.',
      );
    } finally {
      setRemoveBusy(false);
    }
  };
  ```
- `src/app/Application.tsx`의 `<WorkScreen …>`에 `onRemoveChapter={(chapter) => controller.removeChapterVersions(chapter)}`.
- 시트 안 버튼이 링크와 세로로 정렬되지 않으면 `.nr-work-chapter-menu`(CSS 위치 grep)에 `display: grid; justify-items: start;`만 더한다(이미 grid면 손대지 않는다).

- [ ] **Step 4: 통과 확인** — 해당 테스트 PASS.

- [ ] **Step 5: 전체 검사** — `npx vitest run`(#101 batch 타이밍 실패만 나면 그 파일 단독 재실행 통과 기록), `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.

- [ ] **Step 6: 커밋** — `feat: 목차 회차 시트에서 저장본 삭제 (#98)`.
