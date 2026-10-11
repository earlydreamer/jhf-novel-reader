# #96 몰입형 리더 구현 계획
## 실행 기준 (2026-10-08)

#95 PR108을 최종77f8289/Checks1003테스트·Android CI·Sol6.1 high 증거 감사 승인 후 main1e9c73c06348c38f3ca32f8a562a21988834e230에 병합했다. 기본 main 원격 동일/clean·0/0, #95 브랜치/worktree 정리를 확인했다. #96 전용 `<worktrees>/96-immersive-reader/narou-reader` / codex/96-immersive-reader에서 이 base로 시작한다. 기준 b7 제품과 최신 main의 차이는 #95 문서2경로뿐이며 제품·테스트 변경0이다.

사용자 지정 구현 Luna high/독립 감사 GPT-6.1 Sol high다. 원본 승인 계획 SHA256f12ff0391a58be17e84345f8c6fd7a315e25f789cf99a6cb72310341bc345172은 root ignored verification-96-plan/plan-draft.md에 변경 없이 보존한다. 아래 과거 후보 상태 설명은 사전 계획 작성 당시 맥락이며 실제 실행 기준은 이 단락과 현재 코드다. 생산 데이터·실제 소설·사설 endpoint·모델 통신을 이 UI 작업의 실기 검증에 사용하지 않는다.


## 근거와 기준

이 문서는 GitHub 이슈 #96의 현재 본문과 댓글, 디자인 시스템 명세 6.5절, #95 후보 `b7e3297358294f2ed1857b01ca81b52aba8de6af`의 실제 UI·controller·test 경로를 대조해 작성한 실행 계획이다. #96은 #92 디자인 시스템을 선행으로 둔 OPEN 이슈이며, 목적은 분리된 번역 화면과 저장본 리더의 표현을 본문 중심의 한 화면으로 합치는 것이다. 저장 방식, controller/route 계약, 모델 호출 파이프라인을 새로 설계하는 범위가 아니다.

#95 기준 코드는 아직 `Application`에서 `translation` 라우트에 `TranslationScreen`(streaming이면 `StreamingReader`), `reader` 라우트에 별도 `ReaderScreen`을 조건 렌더링한다. `renewalController`에는 이미 두 라우트, version/position, 번역 상태, 원문 전환, 최근 위치 저장, 회차 이동, 실패 복구, 보기 설정 메서드가 있다. 이 구조와 현재 route/history 규칙을 보존하면서 사용자에게는 같은 몰입형 리더 표현을 제공한다.

구현 시작 전 #95가 main에 병합된 최신 SHA를 확인하고, 이 계획에서 언급한 `Application`, `Modal`, controller, CSS 및 회귀 테스트의 현재 내용을 다시 읽는다. #95 이후 변경된 계약을 이 문서보다 우선한다. 실제 이슈 96의 실기 요구는 별도의 검증 권한·자료 경계로 남긴다.

## 목표 동작

- `translation`과 `reader` route는 그대로 유지한다. `Application.RouteScreen`은 둘을 공통 리더 표현으로 연결하되 각 route가 제공하는 실제 source/version/translation state를 섞지 않는다. 현재 route 키 변경 시 `Application`이 main의 `h1`로 포커스를 옮기므로, 통합 화면에도 안정적인 단일 제목/포커스 위치를 둔다.
- 기본은 본문 몰입 상태다. 회차 화수와 제목은 본문 첫 부분에 들어가 본문과 함께 스크롤된다. 본문 가로 가운데 60% 탭으로 앱바·하단 도구 모음을 토글한다. 아래 스크롤은 숨기고 위 스크롤은 보인다. 숨긴 두 바는 `inert`, `aria-hidden`, 포인터 차단 및 시각 숨김을 함께 적용해 키보드/보조기술/터치 대상이 되지 않게 한다. 페이지의 첫 키보드 진입은 포커스 시에만 보이는 `읽기 메뉴 열기` 동작으로 바를 보여 준다.
- 앱바는 목차로 가는 뒤로가기, 회차 제목, `aria-pressed`가 있는 원문/번역 전환, ⋮ 메뉴를 가진다. 메뉴에는 기존 품질 확인, 문단 선택 재번역, 실패 문단 재번역, 제목 재번역/직접 수정, 원문 사이트, 번역 정보(모델·경과 시간), 서재 이동을 둔다. 제스처를 요구하는 기능에는 반드시 메뉴 또는 명시적 버튼 대안을 둔다.
- 하단 `FloatingToolbar`는 이전 화, 목차, Aa 보기 설정, 다음 화로 구성한다. 세 보기 설정은 현재 settings 저장소/API를 재사용한다: 배경 `theme`·`sepia`·`black` 세 값, 글자 크기 10–48px 범위의 2px 간격, 줄 간격 1.6·1.8·2. 선택이 즉시 controller에 반영되고 기존 `narou-reader.reading-settings.v2`에 지속되는 것을 확인한다. 저장소가 허용하는 기존 홀수 크기19/47px도 유효하다. 시트를 열거나 재시작했다는 이유로 짝수화·저장하지 않고, 사용자가 ±2를 누를 때만 현재 정수에서2px 증감하고10~48로 clamp한다.
- 진행 UI는 앱바가 숨겨져도 본문 흐름에서 항상 읽을 수 있다. 번역 중 진행 막대·묶음 완료 수·중단, 원문 준비/모델 대기/검증/저장 단계, 도착한 저장 전 미리보기를 기존 상태에서 표시한다. `unknown`은 중복 요청 위험을 안내하고 자동 재전송하지 않는다. `pendingSave`는 모델을 다시 부르지 않는 저장 재시도만 제공한다. 이슈/명세의 연결 설정·원문 변경·회차 완료·다음 화 상태와 행동도 기존 API에서 표현한다.
- 실패 문단은 실제 version.failedParagraphs에 기록된 문단만 확정 실패로 본문 안 표시하고 직접 재번역 행동으로 찾을 수 있게 한다. 가나 잔존/확정 표기 미발견의 품질 heuristic은 확인 필요 표시·기존 품질 설명으로 분리하고 그 자체를 확정 실패로 바꾸지 않는다. 롱프레스 시 문단 작업 시트에 `이 문단 다시 번역하기`와 `이 문단 원문 보기`를 제공하고, 선택 문단/실패 문단 메뉴 대안도 유지한다. 본문의 텍스트 선택과 기본 contextmenu만 차단하고 대화상자 입력폼의 선택·편집은 보존한다. pointer 이동·pointercancel·짧은 탭을 구분하며 longpress 뒤 합성 click이 바를 다시 토글하지 않게 한다. 기존 `retryParagraphs(indexes)` 범위와 controller의 요청/저장 검증을 우회하지 않는다. 원문과 1:1 대응되지 않거나 로컬 streaming 지원이 없는 경우 현재 제한·설명과 비활성 상태를 유지한다.

## 보존해야 할 데이터·동작 계약

1. **번역과 저장본 경로:** `Route`의 `translation`/`reader`, `selectChapter`, `continueReading`, `openSavedTranslation`, `translate`, `retryTranslation`, `retrySave`, `retryParagraphs`, `refreshSource`, `showContents`, `adjacentChapter`를 호출 경계로 유지한다. 모델/저장 구현을 UI 안으로 옮기지 않는다. 현재 adoptCompleted가 translation route를 유지하는 colomo-local-v1 live stream/문단 repair 및 해당 저장 전용 retry 경로에서 같은 article DOM과 위치를 유지한다. 일반 번역 완료의 기존 openCompleted→reader route 전환은 보존하며 모든 완료를 translation에 남기는 controller 변경은 하지 않는다. 사용자가 저장본 열기를 별도로 요청할 때의 route 이동은 기존 계약을 따른다.
2. **위치 복원:** 완성 번역의 durable 위치는 `ReadingPosition(workId, chapterId, versionId, blockId, offset)` 및 `savePosition` 경로를 유지한다. 미리보기는 `previewPosition(index, offset)`으로 live 위치를 보낸다. 빈 문단을 걸러 index를 재번호화하지 않고 기존 preview index→completed blocks 대응을 보존한다. `adoptCompleted`가 같은 chapter의 live 위치를 새 version block에 매핑하는 동작을 유지해, 스트림 완료 직후 읽던 문단/offset을 저장본으로 이어 준다. 저장 전 preview, 저장 완료, 리더 재진입/재시작을 각각 검증하고 version/chapter가 바뀐 오래된 콜백이 현재 위치를 덮지 않는지 확인한다.
3. **원문/번역 위치:** 현재 snapshot의 `showOriginal`은 두 표현이 공유하고, 저장 위치는 번역 version의 block만 표현한다. 원문 위치를 번역 저장 위치로 기록하지 않는다. 현재 snapshot.chapter는 ChapterRef이며 translating 원문은 wholeChapter 내부 local이라 공개 sourceWork/rawSource가 있는 것으로 가정하지 않는다. 원문은 현재 chapter와 소유권이 일치하는 completedVersion.source에서 사용하고 문단 repair의 base version도 같은 기준을 적용한다. pendingSave.source를 보여 줄 경우 저장 완료 표기/ durable 위치쓰기와 분리한다. idle/preparing/일반 미완성 stream에서 원문이 없으면 전환을 비활성화하고 설명하며, 원문 보기를 위해 추가 source fetch나 모델 POST를 실행하지 않는다. 공통 리더 내부에서 번역과 원문의 현재 scroll anchor를 분리해 전환 왕복 시 각각 복원한다. 동일 version/회차 안 전환에서만 유지하고 다른 회차/소유자의 version으로 바뀌면 낡은 화면 anchor를 적용하지 않는다. 같은 회차 live preview의 version=null→completed version 채택은 저장 완료 전환이며 anchor 초기화 대상에서 제외해 preview 위치를 새 block에 이어 준다. 기존 저장 위치 복원·preview 위치 테스트를 유지하면서 원문 왕복 테스트를 추가한다.
4. **재요청 안전:** unknown/실패 상태에서 명시적인 사용자의 재번역 요청만 모델 POST로 이어진다. pending 저장은 `retrySave`/`retryBatchSave` 계열 저장 전용 경로로 처리하고 모델 요청 횟수가 늘지 않음을 단언한다. 실패 문단 CTA는 해당 index만 전달하며, 원본 version이 덮어쓰기/삭제되지 않는 기존 계약을 보존한다.
5. **라우팅과 Back:** 동일 작품 회차 사이 이동은 history 항목을 불필요하게 늘리지 않고 뒤로가면 목차로 돌아간다. 다른 작품 진입, 목차, 설정, 홈의 기존 backstack 규칙을 유지한다. Back은 열린 메뉴/대화상자/시트 → 보이는 reader 바 숨기기 → 기존 route Back 순서다. 기존 useBackHandler/BackStack 우선순위를 사용해 reader barsVisible 동안 바 숨김 handler를 등록하고 overlay가 이를 앞서도록 구성한다. overlay 닫기·바 숨김만으로 route 변경/모델 POST가 없어야 하며, 바가 숨겨진 다음 Back만 기존 route로 진행한다.
6. **#95 Modal 계약:** `ModalSurface.keepMounted`는 선택 기능이며 기본값 `false` 및 일반 `Dialog`/`BottomSheet` 닫힘 시 unmount 동작을 유지한다. 리더 화면 전환을 위해 필요하다면 특정 리더 child만 opt-in한다. 남겨 둔 닫힌 DOM은 `hidden`+`inert`, `aria-modal` 해제, `useBackHandler` 비활성 상태로 역할/Tab/포커스에서 빠져야 한다. native `<dialog>.showModal()`과 jsdom의 `open` 속성 fallback, Escape/native cancel, scrim, opener focus 반환을 회귀 테스트한다. 리더는 닫힌 시트 때문에 본문/바 포커스나 Back 순서를 잃지 않아야 한다.

## 현재 코드 접점

- `src/app/Application.tsx`: 현재 route별 화면 분기, 공통 ShellAppBar와 main/h1 route focus가 있다. 공통 reader view를 연결하고 reader route용 앱바/메뉴를 여기 또는 화면 구성 요소에 연결하되 settings/서재/목차 경로는 건드리지 않는다.
- `src/app/routes.ts`, `src/app/renewalController.ts`: route union, `navigate`의 동일 작품 chapter 이동/history 규칙, 선택/열기/복원, `previewPosition`, `adoptCompleted`, `savePosition`, 원문 전환, 재시도, 설정, source refresh, 인접 회차를 보존한다. UI 상태 전용 조정 외 저장소 API/모델 pipeline 변경이 필요해 보이면 먼저 새 scope 여부를 확인한다.
- `src/ui/TranslationScreen.tsx`, `src/ui/StreamingReader.tsx`, `src/ui/ReaderScreen.tsx`: 현재 번역과 saved reader의 분리된 표현 및 state를 가진다. 새 공통 리더 컴포넌트나 명확한 공유 presentation 경계를 두되 ready/preview/source/version의 의미를 명시적으로 전달한다. `src/ui/legacy/ReaderScreen.tsx`는 구형 화면이다. 아래 `tests/ui/reader.test.tsx`가 이 파일을 import하고 있으므로 이 테스트를 새 화면 검증으로 잘못 간주하거나 삭제하지 않는다.
- `src/ui/ParagraphRetryPanel.tsx`, `src/ui/TitleHeading.tsx`: 기존 선택·실패 재번역 및 제목 번역/수정 핸들러를 활용한다. 새 inline CTA는 별도 직접 동작을 보태되 기존 대안과 scope를 그대로 연결한다.
- `src/ui/components/FloatingToolbar.tsx`, `Modal.tsx`, `Menu.tsx`, `LinearProgress.tsx`, `StatusPill.tsx`: toolbar keyboard semantics, #95 native dialog 및 keepMounted opt-in, 메뉴의 포커스/닫기, 진행·상태 표현을 재사용한다. 필요 없는 공통 component API 확장은 피한다.
- `src/ui/reader.css`, `src/app/application.css`, `src/ui/components/components.css`: 현재 reader CSS는 기존/legacy 레이아웃 위주이고 앱 공통 stylesheet가 더해진다. immersed body, safe area, bars hidden/inert, touch target, 배경/줄 간격, 200% 글자 확대와 reduced motion을 함께 정의한다. 전역 flow spacing이나 일반 화면 간격을 부작용으로 바꾸지 않는다.
- `src/storage/settings.ts`, `tests/storage/reading-settings.test.ts`: 배경 enum 및 줄 간격 enum, 10–48 font validation, v2 저장/복원 계약이 이미 있다. 새 저장 포맷을 만들지 않고 이 repository를 사용한다.

## 단계별 구현 및 회귀

1. **기준선 고정:** #95 main merge 뒤 SHA/status와 실제 파일을 다시 확인한다. `src/ui/legacy/ReaderScreen.tsx`/`tests/ui/reader.test.tsx`와 current renewal UI/integration을 분리한다. 기존 `Modal` API, controller routes, persisted setting/version/position schema를 기준선으로 기록한다.
2. **공통 리더 presentation:** snapshot의 route별 source를 한 화면으로 전달하고 본문·제목·progress/status·failed paragraph renderer를 통합한다. stream preview와 ready 전환의 article DOM identity/anchor, 저장 version을 연 뒤의 읽기 복원, 원문/번역 각각의 in-session 위치를 검증한다.
3. **몰입 상호작용:** body center 60% tap, scroll 방향 상태, bars inert/aria-hidden, keyboard-only reveal, Back, header menu, long press와 버튼 대안, Aa sheet를 연결한다. 닫힌 메뉴/모달로 focus나 Back이 새지 않는지 검사한다.
4. **상태/오류 행동:** pending save, unknown, failed paragraph, source changed, chapter end를 본문 내부에 렌더한다. storage-only retry는 model POST 0회, retry paragraph는 선택한 index만 호출, unknown re-entry는 자동 POST가 없음을 통합 controller/store fixture로 확인한다.
5. **설정/반응형 접근성:** 세 배경, 10–48px 2px step, 세 line-height 값의 persistence/재시작을 검사한다. 360/412/600 CSS px와 라이트·세 독서 배경에서 synthetic 긴 일본어/부분 번역/실패 문단을 표시하고 overflow·safe area·터치 48px·focus를 확인한다. 200% 확대, `prefers-reduced-motion`, 원문·번역 전환 위치, menu/sheet 닫기와 opener focus 복귀를 테스트한다.

기존 regression의 핵심 파일:

- `tests/integration/renewal-streaming.test.tsx`: Application+실 controller의 preview→ready article 동일성, 읽던 위치의 저장, 자동 시작 1회, 원문 토글, 실패 문단 범위 재시도, unknown 후 자동 재전송 금지, 저장 전용 재시도에서 POST 증가 금지를 보존한다.
- `tests/integration/current-chapter.test.tsx`: legacy compose/Application을 사용하는 기존 통합 회귀로 보존하되 새 renewal reader의 복원 근거로 세지 않는다. renewal-streaming/renewal-first-slice 및 실제 renewal controller+storage 재시작 복원 테스트를 따로 연결한다.
- `tests/integration/navigation-stack.test.ts`: 회차 이동, 목차 복귀, 다른 작품, home/settings backstack 경계를 보존한다.
- `tests/integration/renewal-first-slice.test.tsx`, `tests/integration/batch-translation.test.tsx`: translation/error/manual retry와 공유 batch/저장 guard의 기존 동작을 화면 통합 후에도 유지한다.
- `tests/ui/translation-preview.test.tsx`: 저장 전 미리보기는 번역 중에만 보이고 실패/완료 표시와 혼동되지 않도록 현재 assertion을 새 공통 화면 구조에 맞게 갱신한다.
- `tests/ui/components/modal.test.tsx`, `tests/ui/components/menu.test.tsx`: native Escape/cancel, menu 우선 닫힘, 시스템 Back, scrim, focus return, keepMounted hidden/inert 및 기본 unmount 회귀를 보존한다.
- `tests/ui/quality-review.test.tsx`: quality 내용과 선택 이동 계약을 유지한다. `tests/storage/reading-settings.test.ts`, `tests/integration/theme-preferences.test.ts`: 읽기 보기 설정 persistence/restart를 확인한다.
- 새 `tests/ui/immersive-reader.test.tsx` (또는 현 화면 테스트에 동등한 새 describe)를 두어 route에 따른 공통 UI, 60% 토글, scroll up/down, hidden bar의 role/tab 차단, 최초 keyboard reveal, 모든 행동의 메뉴 대안, inline failed paragraph CTA, view settings 값/48px controls, reduced motion/200% 레이아웃을 직접 단언한다. 구현 중 파일명은 실제 테스트 구조와 맞춰 결정하되 신규 reader test를 legacy `tests/ui/reader.test.tsx`에 섞지 않는다.

목표 테스트는 최소 다음을 명시적으로 검증한다: 같은 live article이 preview/translation completion/pending-save retry 동안 유지됨; preview에서 현재 index+offset이 completed version block에 매핑됨; 원문↔번역 왕복 시 서로의 위치가 복원되고 durable translation position은 유지됨; saved reader reopen/restart에서 올바른 version anchor로 복원됨; `pendingSave`에서 storage retry만 발생해 model POST가 0; `unknown`의 자동 resend가 0이며 명시 retry만 1; failed paragraph의 direct CTA가 정확한 index만 보냄; chapter/work route 이동과 back 동작 및 #95 dialog/menu 우선순위 유지; setting 세 종류의 값이 저장 후 재시작에도 유지됨; hidden bar의 interactive descendant가 keyboard/AX에서 빠지고 첫 keyboard reveal 가능; 360/412/600과 200%에서 가로 overflow 없음.

## 검증·완료 경계

전용 #96 worktree의 main 기반 코드에서 관련 Vitest 파일부터 실행하고, 제품 변경 후 `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build` 및 관련 UI/controller/integration/storage 회귀를 실행한다. 영향을 받는 전체 Vitest는 완료 전에 한 번 실행하고, 실패는 기존 알려진 flaky 항목과 새 회귀를 분리해 기록한다. 실제 Chromium 합성 preview는 이슈의 세 독서 배경과 반응형·접근성 상태를 캡처하되 API transport는 mock으로 둔다.

현재 계획 단계에는 실제 소설 회차·실제 모델 응답/API 호출을 사용하지 않는다. 향후 이슈의 실기 조건은 root가 승인한 synthetic `.devicecheck2` 두 기기 검증에서만 다루고, 제품 SHA/APK 출처·설정 전후·합성 데이터 경계를 별도로 기록한다. 이 검증은 실제 번역 품질이나 사용자의 실제 소설 데이터에 대한 성공 주장으로 확대하지 않는다.

완료 조건은 이슈의 모든 상호작용·보존 회귀가 테스트에 연결되고, 독서/번역의 기존 상태와 저장 계약을 유지하며, 시각·접근성 검증에서 본문 상호작용/오버플로/숨은 컨트롤 접근 문제가 없고, 필수 검사 결과 및 실기 한계를 정확히 기록하는 것이다.

## Sol 6.1 high 읽기 전용 감사 반영

정본6.1 Back은 overlay→reader 바숨김→route순서, 6.5 문단 시트는 재번역/원문보기와 본문선택차단을 요구한다. 실제 API의 source가용성·colomo 완료route·legacy홀수font값·legacy테스트경계를 위 본문에 보정했다. #95 전달 뒤 최신main과실제코드를다시대조한뒤구현하며 이 계획만으로 실제모델/사설endpoint/생산데이터접근은허용하지않는다.

