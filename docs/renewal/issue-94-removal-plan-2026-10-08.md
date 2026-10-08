# #94 서재 작품 제거 구현 계획

- 기준일: 2026-10-08
- 작업 브랜치: `codex/94-remove-work`
- 기준 커밋: `30cbd77fb73fcebe2ec190d6648f445519ba29ef`
- 범위: GitHub #94와 디자인 시스템 스펙 §6.3의 작품 단위 로컬 데이터 제거
- 상태: 구현 전 계획. Sol 6.1 사전감사 대조 전에는 제품 코드를 수정하지 않는다.

## 목적과 완료 조건

서재나 목차에서 작품을 제거하면 그 작품에 속한 새 저장 형식과 이전 v1 저장 형식의 목차·번역·읽기 위치·제목·용어집이 더는 로컬에 남지 않아야 한다. 제거가 끝난 뒤 앱을 다시 시작해도 legacy migration이 작품을 되살리지 않아야 한다. 다른 작품의 저장본·진행 중 작업·읽기 접근은 유지한다. 저장소나 파일 정리의 일부가 실패하면 논리 제거, 잔여 데이터, 사용자 안내를 구분해 보고한다.

이슈가 요구하는 사용자 흐름은 서재 행 `⋮` 및 목차 앱바 `⋮`에서 같은 확인 대화상자를 여는 것이다. 대화상자는 작품 이름, 저장된 고유 회차 수, 읽던 위치·제목·용어집 삭제 안내를 해요체로 표시하고 `닫기`와 위험 동작 `제거하기`를 제공한다. 진행 중이거나 저장 대기 중인 대상 작업은 차단하고 이유를 안내한다. 논리 제거가 완료되면 서재로 이동한다. 물리 정리까지 끝났을 때만 완료 스낵바를 표시하고, 잔여 정리나 결과 판정이 불완전하면 그 사실을 별도로 알린다.

## 현재 코드 계약과 영향 지점

- `src/contracts/reading.ts`의 `LibraryStore`는 `workIds`, `recent`, `versions` 인덱스를 관리하지만 제거 API는 없다. `src/storage/library.ts`는 `library/index`, `works/{workId}`, `versions/{versionId}`, `reading/{versionId}`를 쓴다.
- `src/storage/journal.ts`는 같은 `PrivateFiles` 인스턴스에 공유 `serial(files)` 큐를 적용한 두 슬롯 저널이다. `Journal.save()`는 한 슬롯만 갱신한다. transaction 안에서 같은 파일 어댑터의 public repository API를 다시 호출하면 큐 재진입 deadlock이 생길 수 있다.
- `src/storage/native.ts`의 `PrivateFiles` 어댑터는 읽기·쓰기·chapters 목록만 제공한다. 삭제 API, 디렉터리 목록 범위, native adapter 및 테스트 fake 확장이 필요하다. Native Preferences의 last-chapter 포인터는 현재 읽기·쓰기만 제공한다.
- `src/storage/migration.ts`는 매 시작 last-chapter 포인터와 `chapters/v1-<digest>` 파일명을 모은다. `src/storage/legacyMigration.ts`는 v1 완료본을 읽고 v2 목차·버전·위치를 복원한다. `src/storage/store.ts`의 legacy `chapters/{cacheKey}`와 `positions/{digest(chapterId)}`도 두 슬롯 저널이다.
- `src/translation/attempts.ts`의 `attempts/index`는 `chapterId`와 `phase`를 가진다. 대상 `dispatching`·`unknown`은 중복 POST 방지 근거이므로 제거를 막고, 대상 `complete`만 제거한다.
- `src/translation/batch.ts`의 `batches/current`는 현재 두 슬롯에 각각 `BatchRecord`를 쓴다. 오래된 슬롯의 phase는 현재 작업 소유권이 아니다. 현재 작업은 최신 유효 generation, runtime active owner, 그리고 명시적으로 추적하는 `preparingWorkId`로 판단한다.
- `src/translation/wholeChapter.ts`에는 snapshot 외에도 completed·unfinished·pending save와 preview/source가 runtime closure로 남는다. `src/app/renewalController.ts`에는 작품별 Map, 최근 목록, 화면 route/history, source/refresh 작업, title 작업과 위치 저장 대기가 있다. 둘 다 작품 단위 정리와 늦은 callback/write 무효화가 필요하다.
- UI 진입점은 `src/ui/HomeScreen.tsx`, `src/ui/WorkScreen.tsx`, 셸 앱바는 `src/app/Application.tsx`다. 공통 `Dialog`, `Menu`, `Snackbar` 구성요소를 재사용한다.

## 구현 계약

### 1. 논리 제거와 결과 판정

`LibraryStore.removeWork(workId)` 및 controller/UI 결과는 논리 제거와 물리 정리 완료를 분리한다. 반환값은 최소한 `removed: boolean | null`, `cleanupComplete: boolean`, `remainingInventory`를 표현한다.

1. 삭제 작업은 대상별 동기 write fence를 잡고, 현재 대상 unfinished attempt·pending save·active flow·batch를 검사한다. guard가 실패하면 인덱스·파일을 바꾸지 않고 이유를 반환한다.
2. `library/index`에서 대상 `workIds`, `versions`, `recent`를 제외한 payload와 대상별 pending removal inventory를 함께 기록한다. **첫 번째 index 슬롯 write가 검증되면 `removed=true`다.** 이후 두 번째 index slot 또는 attempts slot의 정규화가 실패하면 `cleanupComplete=false`이고 물리 파일 삭제는 0건이다.
3. 첫 index write 또는 read-after-write 검증이 실패해도 write가 실제 디스크에 남았을 수 있다. 이 경우 대상 index를 최신 유효 generation 기준으로 다시 읽어 판정한다. 대상이 빠지고 inventory가 확인되면 `removed=true`; 기존 대상이 남아 있으면 `removed=false`; authoritative 재조회도 불가능하면 `removed=null`로 결과 불명 처리한다. 결과 불명은 성공/실패로 추정하지 않으며, target fence 및 재등록 차단은 안전 확인 전까지 유지한다.
4. pending inventory는 `library/index` payload의 메타데이터 필드로 둔다. `readRemovalInventory()`는 **유효한 두 슬롯의 pending inventory 합집합**을 읽는다. pending target은 재등록, `saveWorkPage`, legacy migration을 막는다.
5. `library/index` 두 슬롯과 attempts 정규화가 모두 검증되고, inventory에 기록한 모든 대상 경로·pointer 정리가 확인된 뒤에만 inventory를 두 슬롯에서 retire한다. 양 슬롯에서 pending inventory가 더는 보이지 않는 것이 `cleanupComplete=true` 조건이다. retirement가 한 슬롯에서만 성공하면 합집합 조회 결과로 inventory를 유지하고 미완료로 반환한다.
6. 삭제 파일 작업이 실패하면 논리 제거는 유지하고 남은 정확한 경로/종류를 inventory에 보존한다. 별도 자동 재시도 서비스를 만들지 않는다.

inventory에는 work ID, 검증된 legacy cacheKey/chapter ID, 정리 대상 식별자와 정리 상태 같은 최소 메타데이터만 둔다. 작품 본문·번역문은 저장하지 않는다. 기존 `library/index` 형식과 validator를 하위 호환되게 확장하고, 다른 작품의 모든 인덱스 항목은 그대로 보존한다.

### 2. 공유 두 슬롯 정규화와 transaction

- `library/index`에서 제거된 payload를 두 슬롯 모두에 쓴다. 첫 슬롯의 검증 성공으로 `removed=true`가 된 뒤 두 번째 슬롯 write가 실패하면 미완료로 중단한다.
- attempts는 두 슬롯을 검증해 **authoritative 최신 유효 snapshot**을 선택하고 target ownership을 `token.chapterId`로 판별한다. 그 최신 snapshot에 target `dispatching` 또는 `unknown`이 있으면 제거를 거부한다. 이전 슬롯에만 남은 target `unknown`은 현재 guard 근거가 아니다. 최신 snapshot에서 target `complete` 기록만 필터링하고 타 work의 모든 기록은 유지한다. 필터 결과를 양 슬롯에 검증 완료하기 전에는 작품 파일을 삭제하지 않는다. 최신 슬롯이 손상되면 Journal 복구 규칙으로 선택되는 이전 유효 snapshot을 authoritative로 취급하고, 그 snapshot에 target unfinished가 있으면 차단한다.
- 대상 `chapterId`에서 current position/legacy data와 연결된 version ID를 확인해 소유권이 검증된 파일만 inventory에 기록한다. 파일 경로 문자열이나 불완전한 index만으로 파일 소유자를 추정하지 않는다.
- `serial(files)` transaction 안에서는 `Journal`을 직접 호출하고 validator를 공유한다. 동일한 adapter queue를 다시 여는 `LibraryStore`, `ReaderStore`, `AttemptRepository`, `BatchRepository`, title/guidance public API를 호출하지 않는다.

### 3. legacy v1 데이터와 재이관 방지

삭제 전 `chapters` 목록에서 v1 cacheKey 후보를 수집하되, 각 슬롯 payload를 기존 legacy validator와 같은 규칙으로 읽어 `chapter.source.workId`가 제거 대상과 일치하는지 확인한다. 후보 파일명만으로 작품 소유권을 판단하지 않는다.

- 검증된 target cacheKey의 `chapters/{cacheKey}.0.json`, `.1.json` 중 target 소유 완료본 또는 checkpoint 슬롯을 inventory에 기록하고 제거한다. 다른 work 소유 슬롯은 보존한다.
- 검증된 target `chapterId`마다 `positions/{digest(chapterId)}.0.json`과 `.1.json`을 읽어 position payload의 `chapterId`가 target과 일치할 때만 제거한다.
- `narou-reader.last-chapter.v1` pointer는 현재 값이 검증된 target cacheKey와 일치할 때만 지운다. 다른 작품의 pointer는 유지한다.
- 미지원 schema, 손상, 소유 불명 슬롯은 추정 삭제하지 않는다. 안전한 제거를 완료하지 못한 정확한 항목으로 보고하고 `cleanupComplete=false`로 남긴다.
- pending inventory에 포함된 target은 migration이 다시 가져오지 않는다. `saveWorkPage`도 pending target을 거부한다. 이렇게 해야 파일 정리 전 앱 재시작이나 부분 실패로 v1 데이터가 v2에 재등록되지 않는다.
- inventory는 v1/v2 모든 대상 파일과 해당 pointer의 제거 성공이 검증된 뒤에만 양 index 슬롯에서 retire한다.

### 4. batch current와 runtime owner

batch 제거 guard는 단순히 두 slots 중 하나의 phase를 보지 않는다. authoritative 최신 유효 generation의 record와 실제 runtime owner를 기준으로 한다. 오래된 slot에만 남은 `prepared`·`unknown` 등의 phase는 현재 실행을 막는 근거가 아니다.

- `prepare(A)`는 첫 await 전에 `preparingWorkId=A`를 설정하고 종료/취소 시 지운다. 직전 persistent record가 B여도 A 제거를 차단한다. A 삭제를 B의 준비/저장이 불필요하게 막지는 않는다.
- 최신 유효 target batch가 `complete`가 아니거나 실제 active/preparing target 작업이면 제거를 차단한다. target complete record는 runtime 및 persistence에서 제거한다.
- 최신 current가 B이고 old slot이 A이면 B의 최신 상태를 유지하면서 old A 사본만 제거한다.
- 최신 current가 A complete이고 old slot이 B paused라면 A 삭제 뒤 old B가 다시 current로 살아나면 안 된다. A를 제거할 때 새 generation의 `null`/clear tombstone을 기록하고 양 슬롯을 같은 논리 clear 상태로 정규화한다. 반대로 최신이 B인 경우 B를 보존해 양 슬롯에 정규화한다. 이 처리는 valid slot의 generation을 기준으로 하고, raw old slot phase를 current 판단에 사용하지 않는다.
- unknown/corrupt slot은 소유권을 추측해 삭제하지 않는다. 안전하게 양 슬롯 상태를 정규화할 수 없으면 잔여 사본으로 보고 완료를 보류한다.

### 5. target writer fence와 runtime 정리

controller에서 제거 시작 시 동기적으로 target fence를 세운다. 이후 target `openWork`/`saveWorkPage`, cached/source refresh, position/title/guidance 저장은 fence를 확인해 시작되지 않게 한다. 이미 대기한 작업은 target만 차단 또는 settle하고, 삭제 이후 stale operation token으로 저장/메모리 publish를 할 수 없게 한다.

- `saveGuidance`는 digest를 계산한 뒤 `serial(files)`에 진입하므로 함수 호출 진입부터 fence와 pending writer tracking이 필요하다.
- title translation/save, target position drain, source fetch/refresh, `refreshLibrary` 및 async cache reads에 operation invalidation을 적용한다. target active translation과 pending save는 guard로 차단한다.
- `WholeChapterFlow`에 target 전용 runtime 정리 계약을 둬 `completed`, `preview`, `source`, `unfinished`, `pendingSave`/token을 정리한다. 전역 `dispose()`로 타 작품 flow를 중단하지 않는다.
- batch runtime에서도 target 전용 clear를 제공한다. batch subscription의 늦은 이벤트가 `flow.getCompleted()`에서 target 완료본을 재주입하지 못하도록 reset/generation 또는 fence 검사를 한다.
- controller의 target `worksById`, `pagesByWorkId`, `chaptersById`, `savedChaptersByWork`, `versionsById`, `positionsByVersion`, `titlesByWork`, title attempts 및 최근목록/화면 snapshot을 제거한다. route/history에서 제거 작품을 가리키는 경로를 걷어내고 서재로 이동한다.

### 6. 물리 제거 범위

validated inventory 기준으로 target 작품의 `works/{workId}`, 각 버전 `versions/{versionId}`, `reading/{versionId}`, `titles/{workId}`, `guidance/{workId}`와 위의 target legacy `chapters`, `positions`, 해당 last-chapter pointer를 제거한다. 공유 index/attempts/batches 파일은 저널 정규화 규칙으로만 변경한다. Settings, theme, model/connection 선택, secret 등 작품 비소유 데이터는 건드리지 않는다.

삭제 adapter는 기존 파일 경로 allowlist를 유지한 채 idempotent remove 동작을 제공한다. 파일 부재는 성공으로 취급하되 권한·I/O·검증 오류는 잔여 inventory로 남긴다. native plugin/fake에서 실제 remove semantics와 missing-file 오류를 테스트한다.

## 검증 계획

테스트는 합성 저장 데이터만 사용한다. 타 작품 보존을 모든 케이스에서 명시적으로 단언하고, 실패 경계에서 “삭제 없음/논리 삭제/결과 불명”을 구별한다.

1. **정상 제거와 다른 작품 보존**: A/B 각기 여러 버전·position·recent·work page·title·guidance를 만든다. A를 제거하고 모든 target v2 데이터와 UI 항목이 없어지며 B의 파일/읽기가 유지되는지 확인한다.
2. **index commit 경계**: 첫 verified index write 전 실패, 첫 write 검증 실패 후 authoritative reread로 removed true/false, 재조회 실패의 `removed:null`을 각각 검증한다. 첫 verified write 이후 두 번째 index 또는 attempts slot write 실패 시 `removed=true`, `cleanupComplete=false`, 물리 파일 삭제 0건인지 단언한다.
3. **inventory 재시작 안전성**: 두 inventory 슬롯의 합집합을 확인한다. 한쪽 retire만 된 상태에서도 pending target이 남아야 한다. pending 상태에서 새 앱/library factory 및 v1 migration을 실행해 target이 재등록되지 않는지 확인한다. 모든 파일/pointer 정리와 양 슬롯 retire 검증 후에만 complete인지 확인한다.
4. **v1 복구와 소유권**: target completed와 checkpoint의 두 슬롯, 두 위치 슬롯, target last pointer를 지운다. factory/migration 재실행 후 target이 부활하지 않아야 한다. B pointer/자료는 유지한다. 손상·unknown-owner 슬롯은 그대로 남고 정확한 잔여 보고와 미완료 결과가 나와야 한다.
5. **attempts fallback**: 최신 snapshot의 target unfinished 요청이면 물리 변경 없이 차단하고, target complete만 제거하며 B의 unfinished/complete 기록은 유지한다. 최신 target complete + 이전 slot의 오래된 target unknown은 제거를 허용하고, 양 슬롯 정규화 뒤 fallback에서도 target token이 나타나지 않아야 한다. 최신 target unknown은 차단하며, 최신 slot이 손상되어 이전 target unknown이 fallback snapshot으로 선택되는 경우도 차단한다.
6. **batch latest vs old slot**: current B + old A이면 B 상태를 유지하고 A를 정리한다. current A complete + old B paused이면 remove 뒤 batch가 B로 되살아나지 않고 clear tombstone/두 slot 상태가 유지된다. old slot의 오래된 phase만으로 guard가 발동하지 않는다. `prepare(A)` 중 prior record B에서도 A 삭제가 차단되고, B의 무관한 작업이 A 삭제를 막지 않는지 확인한다.
7. **늦은 작업 경주**: target source/refresh 결과, guidance digest 이후 저장, title save, queued position write, batch completed event 및 flow completed runtime이 제거 후 target 저장·캐시·Home metadata를 되살리지 못해야 한다. 타 작품 작업은 계속 동작해야 한다.
8. **UI 흐름**: Home와 Work 두 메뉴가 같은 문구/확인 동작을 쓴다. 취소는 변화가 없고, guard 차단은 원인을 안내하며, 정상 제거는 Home과 완료 snackbar, 부분 실패/불명은 구별된 해요체 안내를 보인다. 기존 화면 테스트는 사용자 동작을 보존한 채 이름을 갱신하고 단언을 삭제/약화하지 않는다.
9. **검사 범위**: storage/native/library, attempts/batch/flow/controller, Home·Work·Application UI 관련 단위·통합 테스트, typecheck/lint/format/build를 실행한다. 전체 테스트는 관련 검사가 안정된 뒤 1회 실행하고 기존에 추적 중인 known flake와 새 실패를 구분한다. Android 기기·ADB 검증은 #102 진행 중이므로 하지 않는다.

## 남은 불확실성 및 결정

- `Journal`은 현재 두 슬롯 개별 검증·직접 슬롯 쓰기를 공개하지 않는다. 구현 전에 최소한의 슬롯 inspect/normalize helper가 필요한지 확인하고, public repository 재진입 없이 사용할 수 있는 작은 저널 계약으로 제한한다.
- Preferences adapter의 `remove` 지원 및 native filesystem `deleteFile`의 missing-path 동작은 구현/테스트 시 plugin 타입과 실제 mock 계약에서 확인한다. 기존 범위 밖의 사용자 설정 데이터는 지우지 않는다.
- `readRemovalInventory`는 valid 두 슬롯 합집합을 읽어야 하므로 한 slot만 유효한 상태의 판정 규칙을 테스트로 확정한다. 두 slot 모두 손상되어 pending 여부를 확인할 수 없으면 삭제를 완료로 간주하지 않는다.
- 위 범위를 위해 기존 index/batch 저장 payload에 호환 가능한 메타데이터/clear tombstone을 추가할 수 있지만, 저장 포맷 전면 변경이나 일반 목적 CRUD·백그라운드 청소 서비스는 추가하지 않는다.
