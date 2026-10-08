# #95 목차 화면 개편 구현 계획

상태: Sol 6.1 high 감사 승인 계획 실행. 사용자 후속 구현 범위에 따라 Luna 구현과 Sol 6.1 high 감사를 진행한다.
작성 기준: GitHub earlydreamer/narou-reader #95 최신 본문과 댓글 없음, #94 구현 스냅샷 d882946485d4f8ff53d06058c2c98936c769176d, DESIGN.md, CONTRIBUTING.md, 디자인 시스템 스펙 6.4절.
실행 기준: #94/PR105 및 #106/PR107 전달·병합 완료. 최신 main b4e4d6ef6a195b6cdaf8d1dfd51f60c597ddd242에서 codex/95-work-screen 전용 워크트리를 만들었다. 원본 승인 계획은 root ignored 경로 및 Vault attachments에 보존하며 동작 계약은 유지한다.

## 목표와 범위

목차에서 주 행동인 이어 읽기와 회차 목록을 먼저 보이게 하고, 용어집·범위 번역·제목 조작·원문 링크를 앱바 메뉴, 공용 회차 액션 시트, 전체 화면 대화상자로 옮긴다. 이슈 #95의 완료 조건은 기존 저장본 즉시 읽기, 미저장 회차의 기존 번역 시작 동작, 회차 제목 번역과 직접 수정, 용어집·일괄 번역의 동작 보존, 해요체 문구와 회귀 테스트다.

저장 데이터 형식과 일반 CRUD·저장소 API는 바꾸지 않는다. 현재 controller/API로 요구 동작을 증명할 수 없는 경우에만 목차 이어 읽기 CTA의 expected context처럼 화면에 필요한 최소 접점을 확장한다. 기존 Home 이어 읽기 호출과 공통 제거 흐름은 호환성을 유지한다.

## 실제 코드에서 확인한 출발점

- src/ui/WorkScreen.tsx에는 작품 TitleHeading과 원문 링크, 목차 제목 번역, GuidancePanel, BatchPanel, 현재 목차 원문 링크, 회차별 제목 편집 UI와 저장 상태가 한 화면에 같이 노출된다.
- src/app/Application.tsx의 목차 ShellAppBar는 일반 제목 ‘목차’를 보여 주고 back·더보기 메뉴를 제공한다. 제거는 Home과 함께 requestRemove/controller.removeWork 및 공통 확인·partial·unknown 안내 대화상자를 사용한다.
- src/app/renewalController.ts의 selectChapter는 저장본 조회가 성공하면 저장본 reader로, 성공적으로 저장본이 없으면 translation으로 이동하며 기존 자동 시작·연결·pending save·활성 작업 guard를 적용한다. 저장본 조회 reject는 오류를 표시하고 새 번역으로 진행하지 않는다.
- continueReading(versionId)는 Promise<void>이며 현재 version을 읽은 뒤 source.workId를 기준으로 이동한다. 목차 CTA가 저장소 recent의 versionId만 전달하면 손상되거나 stale한 인덱스가 다른 작품 version을 가리킬 때 다른 작품 reader로 갈 위험이 있으므로 expected context 검증이 필요하다.
- BatchPanel은 global batch.active/preparing과 batch.record를 따로 소비한다. preparingWorkId와 오래된 record.workId가 다를 수 있어 화면·중단 동작의 actual owner 필터가 필요하다.
- ListItem은 주행동 버튼과 trailing 영역을 분리하지만 현재 disabled, contextmenu, ref 계약은 없다. 필요한 세 접점만 최소 확장한다.
- ModalSurface는 open=false에서 null을 반환해 자식을 unmount한다. GuidancePanel, BatchPanel, CandidateReview가 닫힐 때 draft·범위·후보 선택 상태가 초기화된다. 모든 Dialog에 이 동작을 바꾸면 제거 확인 등 기존 범용 Dialog의 수명 계약까지 변경되므로, keepMounted opt-in을 목차 전체 화면 대화상자에만 적용한다.
- #94 제거 결과는 차단, 결과 불명, partial cleanup, 완료로 구분된다. 목차 메뉴도 기존 Application 확인 대화상자와 같은 controller 경로에 연결한다.

## 화면 구조와 데이터 동작

### 앱바와 헤더

앱바는 뒤로 가기, 번역된 작품 제목, 더보기로 구성한다. TopAppBar 제목은 span으로 유지해 본문 h1은 하나만 둔다. 본문 헤더는 기존 TitleHeading의 번역 작품 제목 h1, 원제(lang=ja), 목차 완전성·저장 개수 메타, M 채움 주 행동으로 구성한다. 앱바 제목과 본문 h1은 화면·보조기술 위계를 구분한다. 제목 번역·재번역·직접 수정은 TitleHeading의 기존 저장 키(workId), source 문자열, 저장 origin(user 또는 model), 제목 입력·오류·busy 계약을 한 세트로 보존한다.

선택 상태와 실제 최근 읽기는 다른 상태다. controller는 현재 work별 recent 검증 결과를 view snapshot에 최소 접점으로 제공한다: loading, verified, none, error와 검증된 recent version/chapter/position 정보다. recent 항목을 읽고 version.source workId/chapterId 및 position 소유권을 확인하기 전까지는 loading이다. 저장소 조회가 정상 완료되어 실제 recent가 없거나 stale/mismatch가 확인되면 none, 데이터 schema 검증 실패/corrupt 또는 I/O reject는 error다. 현재 route의 selectedChapterId는 사용자가 선택한 회차를 별도 표시할 수 있지만, 읽는 중 상태·primary 강조·aria-current·진입 시 1회 scroll은 verified actual recent 회차만 근거로 한다. 단순히 selected됐다는 이유로 ‘읽는 중’이라고 표시하지 않는다. recent chapter가 loaded 목록 밖에 있어도 version 소유권이 확인되면 이어 읽기는 허용하지만 목록의 다른 회차를 대신 강조하거나 scroll하지 않는다. recent를 route 선택에 맞춰 임의 변경하지 않는다. view snapshot은 work/removal generation guard와 늦은 read 무효화를 따른다.

회차 보조 줄은 저장 여부·실제 recent 여부·제목 번역 여부를 조합해 ‘저장됨’, ‘읽는 중’, ‘제목 번역 전’을 표현한다. 저장 회차 수는 savedChapterIds의 고유 chapterId 집합 크기다. complete=true인 목차는 실제 고유 회차 수와 저장 수를 표시한다. complete=false인 부분 목차는 총 회차로 단정하지 않고 최대 관측 ordinal까지 표시한다. 예를 들어 page 2에서 101화가 첫 관측 회차라면 해당 항목을 실제 선택 fallback으로 쓰고 메타에는 ‘101화까지 확인했어요’라고 표시한다. parseWorkPage가 다음 페이지를 반환했다는 이유만으로 complete=true로 바꾸지 않는다.

### 목차 이어 읽기 CTA

Home의 continueReading(versionId) string 1인자 시그니처와 기존 missing/error 결과는 유지한다. 목차 CTA는 별도 최소 controller wrapper continueReadingFromWork(workId)를 호출한다. wrapper는 controller의 work별 recent view snapshot 상태를 따른다: loading이면 fallback/route 이동 없이 기다리고, error이면 오류 안내/재시도만 제공하며, verified이면 실제 recent 항목을 확인해 versionId와 expectedContext {workId, chapterId}를 사용하고, none이면 versionId를 만들지 않은 채 같은 fallback 함수로 보낸다. controller는 호출 시 현재 작품의 실제 loaded 목차와 route/removal 세대를 캡처한다. readVersion(versionId)가 끝난 뒤 실제 version.source.workId와 source.chapterId가 기대 work/chapter와 일치하는지 검증하고 기대값 불일치 version을 따라 다른 작품으로 이동하지 않는다.

continueReadingFromWork(workId)는 recent 부재를 포함해 null versionId를 합성하지 않고 controller 안에서 처리한다. view snapshot의 none 또는 readVersion이 성공적으로 null을 반환하거나 source 소유권이 기대 work/chapter와 mismatch이면 캡처한 해당 work의 loaded chapters 중 최소 ordinal을 골라 selectChapter를 호출한다. ordinal 1을 가정하지 않는다. wrapper에서 recent/readVersion 결과가 I/O error면 fallback하지 않고 error 상태를 표시한다. valid version의 readPosition null은 같은 version을 처음 위치로 연다. readPosition reject/corrupt는 error이며 fallback하지 않는다. 호출 중 route·선택·제거 세대가 바뀌면 오래된 결과와 fallback을 모두 무시한다. controller 바깥 UI가 fallback chapter를 별도로 계산해 중복 규칙을 만들지 않는다.

recent/index read error, readVersion I/O reject, readPosition reject/corrupt, 목차/저장본 조회 reject는 absence가 아니다. work view snapshot은 loading에서 error로 바꾸고 verified/none으로 표시하지 않는다. CTA는 오류 안내/재시도만 제공하고 미저장으로 추정하거나 새 translation POST를 보내지 않는다. valid version의 readPosition null은 absence가 아니라 해당 저장본의 처음 위치로 연다. UI가 이미 홈용 continueReading(versionId)로 들어온 경우는 기존 처리 결과를 바꾸지 않는다.

### 회차 행과 메뉴

회차 행은 ListItem의 주 버튼과 trailing 형제 ⋮ 버튼으로 만든다. 주 버튼은 기존 selectChapter만 호출해 저장본 바로 읽기, 미저장 자동 시작 설정, active translation/pending save/connection/batch guard를 보존한다. 저장본 조회 I/O 실패를 미저장으로 바꾸지 않는다.

verified actual recent 행의 scroll은 WorkScreen 입장 시 recent chapter가 loaded 목록에 있을 때 한 번만 한다. chapter가 목록 밖이면 scroll/highlight/aria-current를 생략한다. 재렌더·저장 갱신·batch 이벤트에는 반응하지 않는다.

시트에는 현재 저장 제목의 정확한 key와 source를 기준으로 ‘제목 번역하기’ 또는 ‘제목 다시 번역하기’, ‘제목 직접 고치기’, 해당 회차 canonicalUrl의 원문 사이트 열기를 둔다. TitleControls의 onTranslate(key), onSave(key,target)을 재사용해 user/model origin, 원문 source와 기존 제목을 보존한다. 작품 제목 조작도 기존 TitleHeading의 한 세트만 유지한다.

앱바 더보기는 작품 용어집, 미리 번역, 목차 제목 번역, 작품 원문, 현재 목차 원문, 설정, #94 공통 제거 요청을 제공한다. 원문 대상은 각각 구분한다: 작품 canonicalUrl, 현재 목차 pageUrl, 회차 chapter canonicalUrl. 링크 간 대체·유실이 없어야 한다. 제거는 기존 Application의 공통 확인·busy·차단·unknown·partial 결과 handler를 사용하고 목차 전용 제거 로직을 만들지 않는다.

## 전체 화면 Dialog 및 상태 수명

### keepMounted는 필요한 대화상자만 opt-in

기본 ModalSurface/Dialog/BottomSheet는 open=false에서 현재처럼 자식을 unmount하는 동작을 유지한다. Dialog의 fullScreen 옵션에는 기존 호출과 호환되도록 header confirmLabel/onConfirm 쌍을 optional로 추가한다. 둘 다 있을 때만 확인 버튼을 렌더링한다.

GuidancePanel과 BatchPanel이 들어가는 목차 전체 화면 Dialog에만 keepMounted=true를 전달한다. 닫혀 있어도 해당 owner의 자식 subtree를 유지해 같은 workId/record.id의 draft, 범위, 재번역 선택, CandidateReview chosen/targets/page를 보존한다. 새 workId 또는 새 batch record.id면 해당 상태를 reset한다. 저장 실패는 입력을 유지한다. 다른 일반 Dialog, 제거 확인 Dialog, BottomSheet는 기존 unmount 계약을 유지한다.

keepMounted closed 상태는 안전하게 감춘다. 닫는 순간 native dialog를 close해 open 속성을 제거하고, hidden과 inert를 적용하며 aria-modal을 제거한다. 닫힌 요소가 UI CSS의 display 설정 때문에 보이거나 focusable이 되지 않도록 dialog hidden 규칙을 명시적으로 보장한다. 닫힌 동안 useBackHandler는 등록되지 않고 Tab 순서·focus·role query·접근성 트리에서 제외한다. open 시에만 hidden/inert를 해제하고 showModal, aria-modal, Back handler, 제목 포커스를 적용한다. native showModal을 지원하지 않는 jsdom fallback에서는 open 시 open attribute, closed 시 open attribute 제거 + hidden/inert가 동일하게 적용되어야 한다. native cancel, Esc, scrim, close button, Android system Back은 가장 위의 열린 overlay 하나만 닫고 opener focus 복귀를 유지한다.

GuidancePanel 전체 화면 Dialog의 header 저장은 기존 단일 save 경로를 호출한다. 기존 busy, locked, available, loadedKey guard와 입력 검증·저장 실패 시 draft 유지가 동일하게 적용되며 별도 header 저장 로직으로 우회하지 않는다.

BatchPanel 전체 화면 Dialog header에는 닫기만 둔다. 범위 확인, 전체 회차 확인, scan, 후보 확정, 명시적 번역 시작, unknown 승인 재시도, retrySave는 기존 단계별 body actions를 그대로 둔다. 범용 header confirm은 confirmCandidates, runBatch, cancelBatch 또는 close 의미로 재사용하지 않는다. Dialog 닫기는 cancelBatch를 부르지 않으며 실제 ‘중단’ 조작만 cancelBatch를 부른다.

### 일괄 번역 소유권과 guard

디자인 시스템 6.4의 헤더 아래 진행 고정 카드를 유지한다. 카드는 실제 owner 작품 화면에만 보이고, 누르면 같은 작품의 미리 번역 전체 화면 대화상자를 연다. 준비 중 owner는 `preparingWorkId`, 준비 완료 후 실제 run owner는 authoritative latest record의 `work.workId`다. A의 이전 record가 남은 채 B를 준비하는 동안 A 카드나 A의 중단 동작을 노출하지 않는다. 전역 시작 guard와 각 작품 표시/callback owner 필터는 별도로 유지한다.

실제 batch owner는 preparing 중에는 preparingWorkId, 실제 run 중에는 authoritative latest record.work.workId로 판정한다. 준비 중 오래된 record가 이전 작품 A를 가리켜도 새 준비 대상 B의 화면에 A record/progress/error/CandidateReview/중단을 표시하지 않는다. B의 actual preparing 상태는 B에만 표시한다. 준비 완료 후 B record가 latest가 된 뒤 B의 다음 단계만 렌더링한다. idle 상태의 latest record도 workId가 맞는 화면에만 나타낸다.

active/progress/error/scan/review/run/retry/stop의 모든 work-specific 표시와 callback에서 동일한 owner filter를 적용한다. confirmed guidance hash refreshKey는 record.work.workId와 현재 workId가 일치하고 scan status가 confirmed일 때만 전달한다. 새 prepare/run/save 시작에는 기존 global active/preparing/awaitingSave/pendingSave/translationActive/connection/foreground guard를 유지한다. 특정 작품 화면에서 가드가 약해져 다른 진행 작업과 중복 실행할 수 없어야 한다.

확인 단계의 흐름은 prepare → scan → candidate review/confirm → explicit start → paused/unknown/saving/complete/retry-save를 유지한다. prepare·scan·후보 확정만으로 model POST를 보내지 않는다. 후보 0개 또는 아무 후보를 선택하지 않고 confirm해도 explicit start 전에 POST 0회다. 저장본 0개도 사용자가 명시적으로 시작해야 한다. retrySave는 저장만 재시도하고 새 모델 요청은 보내지 않는다. batch selection 설정 hash가 달라지면 기존 controller의 재확인 오류를 유지하고 이전 후보/대상을 시작하지 않는다.

### 공통 controller·제거 계약

기존 selectChapter, continueReading, loadMoreWorkPage, translateTitles, saveTitle, readGuidance, saveGuidance, prepareBatch, scanBatch, confirmBatchCandidates, runBatch, retryBatchSave, cancelBatch, removeWork 및 snapshot을 우선 재사용한다. 추가 접점은 controller의 work별 recent verification snapshot(status loading/verified/none/error), continueReadingFromWork(workId) wrapper와 오류 후 검증만 다시 하는 retryWorkRecent(workId)로 제한한다. retryWorkRecent만으로 route/회차 선택/모델 POST를 실행하지 않고 검증된 snapshot을 새로 확인한 뒤 사용자가 이어 읽기를 눌러 이동한다. Home의 continueReading(versionId) string 계약은 그대로 둔다. 저장소 API/schema 증설은 필요하지 않다.

#94의 공통 제거 Dialog에 연결해 차단, 결과 불명, partial cleanup, 완료를 구분한다. 진행 중 busy, 재시도, 제거 후 공통 안내도 그대로 쓴다. 모든 신규 문구는 해요체, 원인과 다음 행동을 한 문장으로 표현한다.

## 구현 단계

1. #94 PR 병합 뒤 최신 main과 clean 전용 #95 워크트리를 확인하고 실제 코드/계약이 본 계획과 다른지 재검사한다. 변화가 있으면 구현 전에 이 문서만 보정한다.
2. WorkScreen과 ShellAppBar를 앱바·단일 h1 헤더·original ja·complete/partial 메타·unique saved count·validated M CTA·회차 ListItem으로 재구성한다.
3. controller의 work별 recent verification snapshot과 continueReadingFromWork(workId) wrapper를 추가한다. verified recent만 행 강조/aria-current/scroll에 쓴다. none은 controller의 loaded-list fallback, error는 안내/재시도이며 자동 POST 금지다. source owner, valid-null position, readPosition error, removal/route staleness를 한곳에서 판정하고 Home 1인자 호출은 호환 유지한다.
4. ListItem의 disabled/contextmenu/ref 최소 접점을 추가하고 row ⋮/contextmenu 공용 시트와 3종 원문 URL을 연결한다. title key/source/origin 계약을 기존 TitleHeading에 위임한다.
5. Dialog API에 optional keepMounted/fullScreen confirm pair를 추가한다. 기본 unmount 동작 및 다른 Dialog/BottomSheet는 유지하고 Glossary/Batch에만 opt-in 한다. 닫힌 DOM, Back, Tab, focus, jsdom fallback을 먼저 검증한다.
6. GuidancePanel을 header 저장 guard와 함께 전체 화면 Dialog에 연결한다. BatchPanel/CandidateReview를 body 단계로 옮기고 owner별 card·progress·error·actions를 filter한다. Dialog close는 batch cancel과 분리한다.
7. 기존 #94 공통 제거 흐름, 해요체·아이콘 mapping 최소 변경을 적용한다.
8. 집중 회귀와 필수 프로젝트 검사를 통과시킨 후 6조합 미리보기 및 기기 결과를 별도 근거로 기록한다. 최종 코드 단위는 #95 전체 기능이다.

## 회귀 검증

기존 assertion을 삭제·약화하지 않고 새 구조에서 같은 사용자 동작을 재검증한다.

- tests/ui/renewal-work-range.test.tsx: loaded first ordinal이 101화일 때 첫 회차 fallback, exact position 이어 읽기, selected와 actual recent 구분, recent verification loading/verified/none/error, 저장본·자동시작 guard.
- tests/ui/renewal-toc-pages.test.tsx: pageUrl/canonicalUrl 보존, complete=false 부분 범위, 101화까지 확인 문구, 다음 페이지·중복 병합, recent chapter가 loaded 목록 밖일 때 다른 행 강조/scroll 없음.
- tests/ui/renewal-flow.test.tsx, tests/integration/title-editing.test.tsx, tests/integration/title-provider.test.tsx: 작품·회차 title translate/retranslate/manual edit, key+source 일치, origin user|model, 입력 보존과 실제 POST 수.
- tests/integration/batch-translation.test.tsx 및 batch UI/controller tests: preparingWorkId B + previous record A, 모든 work-specific 표시/callback owner filter, global active/preparing/pending/awaitingSave guard, Guidance refreshKey 일치, close does not cancel, 단계별 POST 수, zero candidates/saved, retrySave no POST.
- tests/ui/components/modal.test.tsx와 tests/ui/components/menu.test.tsx: 기본 Dialog/BottomSheet closed unmount 유지, keepMounted opt-in에 한해 child state 보존, closed hidden/open/CSS display override/aria-modal/useBackHandler/Tab/focus/role 제외, jsdom fallback, nested native cancel/Esc, scrim, opener focus.
- tests/ui/renewal-library.test.tsx: #94 공통 remove success/blocked/partial/unknown/title failure 결과와 목차 메뉴에서 동일 경로.
- keepMounted Dialog state tests: 같은 workId/record.id에서 close button·Back·Esc·scrim으로 닫았다 다시 열어 glossary draft, batch range/retranslate, CandidateReview chosen/targets/page가 유지됨; save 실패는 입력 유지; workId 또는 record.id 변경은 reset.
- continueReadingFromWork tests: verified source ownership은 correct version/position에서 열기; valid null position은 같은 version의 처음 위치; none, successful null version, source mismatch는 controller 캡처 loaded list의 최소 ordinal selectChapter; snapshot loading은 대기·route/fallback/POST 0회, error는 안내·retry만·fallback/POST 0회; schema/corrupt/readVersion/readPosition/readWork/recent/index I/O reject는 error/no fallback/no POST; Home continueReading(string) 1인자 missing/error 동작 유지; 늦은 제거/route/selection 결과 publish 금지.
- Work recent snapshot/UI tests: verified owned recent만 읽는 중 highlight/aria-current/entry scroll, none은 actual recent absent/stale/mismatch, error는 schema/corrupt/I/O failure, loaded 목록 밖 recent는 CTA만 유지하고 대체 행 highlight/scroll 금지.
- 레이아웃 및 접근성: 단일 h1, focus target 안정, 최근 행만 primary/aria-current/entry scroll, 48px 터치, sibling controls, 긴 제목·오버플로·menu clipping, screen reader name.
- 영향 범위 전체 Vitest 1회, typecheck, lint, format check, production build. 이후 전체 재실행은 신규 실패·코드 변경이 근거가 될 때만 한다.

## 시각·접근성·실기 검증 경계

합성 목차 데이터로 실제 Chromium 360, 412, 600 CSS px × light/dark 6조합을 캡처한다. 긴 작품/회차 제목, 부분 목차, 저장 표시, recent row, preparing/running/paused batch, 메뉴·시트·전체 화면 Dialog를 포함한다. 테마와 document.fonts.ready가 안정된 뒤 캡처하고 overflow, truncation, 터치 영역, menu clipping, dialog/safe-area, 다크 테마를 실제로 확인한다. 200% font scale/zoom, prefers-reduced-motion, keyboard focus, single h1, closed dialog accessibility/focus 제외, opener 복귀도 검증한다.

실기 검증은 구현 완료 후 이어서 수행하고 브라우저 검증과 별도 판정한다. KEY2(Android 8.1/API 27, Chrome 121)와 BlackShark(Android 10/API 29) 양 기기에서 오직 app.narou.reader.devicecheck2 패키지만 설치·실행한다. production 패키지와 다른 시험 패키지는 변경하지 않는다. build 때 native suffix만 dirty이고 web tree는 clean이어야 하며, source SHA/tree, APK hash·provenance를 기록한다. synthetic data만 사용하고 저장본·설정 상태를 시험 전후 비교해 변경이 있으면 원상 복구한다. 일반 docs/renewal 보고서에 기기/API/Chrome, source SHA/tree, artifact/APK hash, 실행 절차·결과, 전후 synthetic data 및 settings 상태를 남긴다. Chromium 브라우저 캡처와 Android 실기 성공은 별도 판정한다. 계획 작성 중 ADB·기기 접근은 하지 않는다.

## 완료 조건

- 앱바에 back·번역 작품 제목·더보기, 단일 본문 h1, lang=ja 원제, complete와 partial을 구분한 메타, unique saved count, 검증된 이어 읽기가 있다.
- 목차 CTA는 expected work/chapter와 version source를 검증한다. valid null/mismatch는 controller의 captured loaded list에서 실제 최소 ordinal로 이동하고, valid version + null position은 저장본 처음 위치를 연다. recent 부재는 continueReadingFromWork wrapper 안에서 versionId 없이 같은 fallback으로 처리한다. I/O reject/corrupt는 error이며 fallback/자동 POST는 0회다.
- selected는 actual recent와 다르다. controller의 loading/verified/none/error snapshot에서 verified owned recent 행만 읽는 중 강조·aria-current·초기 scroll을 받는다. recent chapter가 목록 밖이면 CTA는 가능해도 다른 행을 대체 강조하지 않는다. loading 중 주행동은 아직 실행하지 않고 error에서는 재시도 경로만 보여 준다.
- 행 탭 기존 saved/unsaved/autoTranslate guard를 유지한다. contextmenu와 ⋮는 같은 시트를 열고 그 자체로 선택·번역 POST를 보내지 않는다.
- title key/source/origin(user|model) 및 작품·목차·회차 canonical URL 구분을 보존한다.
- Dialog 기본 unmount 계약은 유지한다. keepMounted 목차 전체 화면 Dialog만 same owner draft를 닫기·Back·Esc·scrim 후 보존하고 owner key 변경 시 초기화한다. 닫힌 상태는 보이지 않고 focus/Tab/ARIA/Back에서 제외된다.
- actual batch owner만 card/progress/error/CandidateReview/stop에 표시된다. global guard가 유지되고 단계 확인·retrySave 중 의도하지 않은 model POST가 0회다.
- #94 공통 제거 결과 및 해요체를 재사용한다. 360/412/600 × 두 테마, 200%, reduced motion 및 접근성을 확인한다.
- 최종 PR diff는 #95 범위이며 #94/#102는 main base에 포함된다. 테스트/build, Chromium, KEY2 실기, BlackShark 실기를 각 source SHA/APK provenance와 함께 구분해 보고한다.

## 확인된 불확실성과 결정 경계

- #95 본문은 전체 화면 용어집·batch와 동작 보존을 요구한다. modal state lifetime, recent/source owner, batch runtime owner, 저장 상태 실패 구분은 스펙 6.4와 기존 동작 보존 감사에서 도출한 구현 경계이며 직접 인용한 사용자 확장 요구로 표현하지 않는다.
- 목차 이어 읽기는 기존 Home continueReading(versionId) 동작을 변경하지 않는다. Work CTA에는 continueReadingFromWork(workId)와 work별 recent verification snapshot을 추가해 recent 부재·null/mismatch fallback, I/O error 구분, late-read guard를 controller 한 곳에서 처리한다. versionId를 임의 생성하지 않는다.
- Modal keepMounted는 닫힌 DOM의 CSS display override/접근성/focus 위험이 있으므로 opt-in 범위와 기본 unmount 동작을 회귀로 나눠 검증한다.
- #94의 공통 remove dialog는 Application에 이미 있으므로 목차 화면도 같은 결과 처리 경로를 호출한다. 새 제거 UX/저장 계약을 만들지 않는다.

## 최종 구현·검증 출처

최종 제품과 설치 후보는 b7e3297358294f2ed1857b01ca81b52aba8de6af / tree874f2b128bf83e4508e74d5043f846c5810f5174다. 원본 승인 계획 SHA471b85ab414d4be3374838336d24d3329ee0b75ab03e3e641cd842d495660220은 root/Vault에 그대로 보존했다. recent 재검증 접점은 기존 오류/재시도 요구를 구현하면서 실제 동작 경계를 명시한 보정이며 저장소 API/schema나 Home 계약은 변경하지 않았다. Sol 코드·APK·Chromium 독립 감사와 최신78파일1003테스트/Android CI 성공, 전체 화면 Dialog 간격 및 링크48px 수정은 [실행 검증 보고서](issue-95-work-screen-verification-2026-10-08.md)에 기록한다. 양기기 최종 실기와 전달 상태는 별도 실행 보고서의 실제 결과를 따른다.
