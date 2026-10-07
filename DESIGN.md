# Narou Reader 디자인 시스템

화면 디자인의 정본이다. 결정의 배경과 화면별 상세는 [화면 디자인 시스템 스펙](docs/superpowers/specs/2026-10-08-ui-design-system-design.md)에 있다. 코드와 이 문서가 다르면 실제 동작을 먼저 확인하고, 코드가 의도에 맞게 바뀐 것이면 이 문서를 고친다.

## 1. 원칙

- **본문이 주인공이다.** 화면 크롬은 조용하게 두고, 화면당 주 행동 하나만 강조한다.
- **색은 Very Peri, 구조는 Android.** 색과 컴포넌트 질감은 kawaii-agent-desktop의 Very Peri 기조를 따른다. 크기·위계·동작·세부 규칙은 Material 3 Expressive와 Android 플랫폼 관례를 따른다.
- **대비는 두 기준을 모두 통과한다.** WCAG 2.2 대비비와 APCA Lc(WCAG 3.0 초안)를 함께 본다.
- **덜 중요한 기능은 접는다.** 앱바 `더보기` 메뉴, 바텀시트, 대화상자로 옮긴다. 롱프레스 같은 제스처에는 항상 메뉴 대안을 둔다.
- **문구는 해요체다.** 7절을 따른다.

## 2. 토큰

정본은 `src/ui/theme/tokens.css`다. 다른 CSS는 토큰만 참조하고 hex 값을 쓰지 않는다. 테마는 `html[data-theme="light"|"dark"]`로 적용한다. `시스템 설정 따르기`는 앱 코드가 `prefers-color-scheme`을 해석해 둘 중 하나로 설정한다.

### 2.1 색

Very Peri `#6667AB`는 라이트 테마의 채움 면(`--primary-fill`)이다. 메뉴는 `--surface-container`, 바텀시트는 `--surface-container-low`, 대화상자는 `--surface-container-high`, 스낵바는 `--inverse-*` 면을 쓴다. 바탕 위 글자로 쓰면 Lc 72.4라 본문 기준에 못 미치므로 글자와 아이콘은 `--primary`(`#3F4199`)를 쓴다. 대화상자(`surface-container-high`) 위 텍스트 버튼까지 Lc 75를 넘기려면 이 깊이가 필요하다.

| 토큰 | 라이트 | 다크 |
|---|---|---|
| `--surface` | `#FAFAFD` | `#13131B` |
| `--surface-container-lowest` | `#FFFFFF` | `#0E0E15` |
| `--surface-container-low` | `#F4F4FA` | `#1A1A24` |
| `--surface-container` | `#EEEEF6` | `#1F1F2A` |
| `--surface-container-high` | `#E8E8F2` | `#262633` |
| `--surface-container-highest` | `#E2E2EE` | `#30303F` |
| `--on-surface` | `#1A1A28` | `#EEEEF6` |
| `--on-surface-variant` | `#45465C` | `#C9C9DC` |
| `--outline` | `#6E6F86` | `#A3A4BF` |
| `--outline-variant` | `#C9C9DA` | `#464659` |
| `--primary` | `#3F4199` | `#D2D3FF` |
| `--primary-fill` | `#6667AB` | `#D2D3FF` |
| `--on-primary` | `#FFFFFF` | `#1A1B55` |
| `--primary-container` | `#E3E3FA` | `#3B3C8F` |
| `--on-primary-container` | `#2C2D78` | `#E6E5FF` |
| `--secondary-container` | `#E6E6F2` | `#383850` |
| `--on-secondary-container` | `#2E2F45` | `#E6E5FA` |
| `--error` | `#901C16` | `#FFC4BC` |
| `--on-error` | `#FFFFFF` | `#4A0002` |
| `--error-container` | `#FCE4E2` | `#8C0009` |
| `--on-error-container` | `#7A1712` | `#FFE1DD` |
| `--success` | `#1F6B45` | `#8BE0B0` |
| `--warning` | `#7A5A12` | `#EFCB7C` |
| `--inverse-surface` | `#2C2C3A` | `#E4E4EE` |
| `--inverse-on-surface` | `#F2F2FA` | `#1A1A28` |
| `--inverse-primary` | `#D2D3FF` | `#36388F` |

독서 배경(`[data-reading-background]`, 리더 본문 영역에만 적용):

| 값 | `--reading-surface` | `--reading-on-surface` |
|---|---|---|
| `theme` | 테마의 `--surface` | 테마의 `--on-surface` |
| `sepia` | `#F4EBD7` | `#2B2116` |
| `black` | `#000000` | `#E4E4EE` |

### 2.2 대비 게이트

`tests/ui/theme-contrast.test.ts`가 아래 게이트로 모든 조합을 판정하고, 실패하면 CI도 실패한다. APCA 상수는 0.0.98G-4g다.

| 게이트 | WCAG 2.2 | APCA \|Lc\| | 대상 |
|---|---|---|---|
| 독서 본문 | 7:1 | 90 | 독서 배경 × 두 테마 |
| UI 본문·라벨 | 4.5:1 | 75 | `on-surface`, 버튼 라벨, `primary` 글자, 상태 글자, 컨테이너 글자 |
| 보조 텍스트 | 4.5:1 | 60 | `on-surface-variant` |
| 아이콘·3차·포커스 | 3:1 | 45 | `outline`, 포커스 링 |
| 그래픽 | 3:1 | 30 | 입력 테두리, 스위치 트랙, 진행 막대 |

새 색 조합을 만들면 감사 테스트에 조합을 추가한다. 통과하지 못하는 조합은 쓰지 않는다.

### 2.3 타이포

Pretendard Variable을 번들한다(`src/ui/theme/fonts/`, OFL). 원문(`lang="ja"`)은 시스템 일본어 글꼴로 대체된다. 크기는 `rem`(Android 글꼴 크기 설정을 따른다).

| 토큰 | 크기/행간 | 굵기 | 용도 |
|---|---|---|---|
| `--type-headline-small` | 24/32 | 600 | 목차 헤더 작품 제목, 빈 상태 제목 |
| `--type-title-large` | 22/28 | 600 | 앱바 제목 |
| `--type-title-medium` | 16/24 | 600 | 시트·대화상자 제목 |
| `--type-body-large` | 16/24 | 400 | 목록 1행, UI 본문 |
| `--type-body-medium` | 14/20 | 400 | 보조 줄, 설명 |
| `--type-label-large` | 14/20 | 600 | 버튼 |
| `--type-label-medium` | 12/16 | 500 | 칩, 메타, 상태 알약 |

리더 본문은 기본 18px, 줄 간격 1.6·1.8·2.0(기본 1.8), 글자 크기 범위 10~48px. 숫자는 `tabular-nums`, 제목은 `text-wrap: balance`, 본문은 `text-wrap: pretty`.

### 2.4 모양·크기·높이·모션

- 모양: `--shape-xs 4px` · `--shape-sm 8px`(칩·메뉴) · `--shape-md 12px`(카드) · `--shape-lg 16px`(FAB) · `--shape-xl 28px`(시트 위 모서리·대화상자) · `--shape-full`(버튼·알약·툴바).
- 크기: 터치 영역 최소 48px. 버튼 M 56px(화면 주 행동 하나), S 40px(나머지). 아이콘 버튼 40px(영역 48). 앱바 64px. 목록 행 56·72px. Extended FAB 56px. 플로팅 툴바 64px.
- 높이: 깊이는 `surface-container-*` 톤으로 나눈다. 그림자는 FAB·플로팅 툴바·메뉴·대화상자에만.
- 상태 레이어: 호버 8%, 포커스 10%, 눌림 10%, 드래그 16%. 비활성은 내용 38%·면 12%.
- 포커스: `:focus-visible`에서 `3px solid var(--primary)`, 간격 2px.
- 모션: `transform`·`opacity`만. 표준 이징 `cubic-bezier(0.2, 0, 0, 1)`, 짧은 전환 150ms, 시트·대화상자 열기 300ms·닫기 200ms. `prefers-reduced-motion: reduce`이면 전환 0ms.

## 3. 버튼 위계

| 단계 | 형태 | 규칙 |
|---|---|---|
| 1 | 채움(`filled`) M 56 | 화면당 하나. 그 화면에서 가장 많이 하는 행동(이어서 읽기, 이 화 번역하기, 다음 화 읽기). FAB이 있는 화면에서는 FAB이 이 자리다. |
| 2 | 토널(`tonal`) S 40 | 보조 행동(미리 번역하기, 연결 확인하기, 다음 목차 불러오기). |
| 3 | 아웃라인(`outlined`) S 40 | 같은 무게의 대안 행동. |
| 4 | 텍스트(`text`) S 40 | 대화상자 버튼, 카드 안 행동, 취소성 행동(`닫기`, `중단`). |

- 파괴적 행동(제거, 삭제)은 화면에 버튼으로 두지 않는다. `더보기` 메뉴의 오류색 항목 → 확인 대화상자의 오류색 버튼으로만 실행한다.
- 비활성 버튼은 진행 중 잠금처럼 피할 수 없을 때만 쓴다. 조건이 안 맞으면 누른 뒤 이유를 스낵바나 대화상자로 알린다.

## 4. 컴포넌트

`src/ui/components/`에 있다. 규격과 접근성 계약은 스펙 5절을 따른다. Button, IconButton, TopAppBar, ListItem, Card, Chip, Dialog, BottomSheet, Menu, Snackbar, ExtendedFab, FloatingToolbar, Switch, LinearProgress, StatusPill, Icon.

- 아이콘은 Material Symbols Outlined(Apache-2.0)에서 쓰는 것만 `src/ui/icons/`에 복사한다. `Icon` 컴포넌트가 CSS 마스크로 `currentColor`를 입힌다.
- 아이콘만 있는 버튼은 `aria-label`이 필수다.
- 대화상자와 바텀시트는 열리면 제목으로 포커스를 옮기고, 닫히면 연 요소로 돌려준다. Esc, 스크림 탭, 시스템 뒤로 가기로 닫힌다.

## 5. 내비게이션

- 계층: `서재 → 목차 → 리더`. 설정은 서재 앱바에서, 그리고 번역 화면의 연결 안내에서 들어간다.
- 앱 안에서 앱바 `←`와 시스템 뒤로 가기는 같은 백스택을 따른다.
- 같은 작품 안의 회차끼리 이동은 스택에 쌓지 않고 교체한다. 다른 작품의 회차로 가면 쌓는다. `목차`는 바로 아래가 같은 작품 목차면 그리로 돌아간다. `서재로 가기`는 스택을 비운다.
- 시스템 뒤로 가기 순서: 열린 오버레이 닫기 → 리더 바 숨기기 → 이전 화면 → 서재에서 앱을 백그라운드로.
- edge-to-edge: Capacitor `SystemBars`의 `insetsHandling: 'css'`가 넣는 `--safe-area-inset-*`를 `--inset-*` 토큰으로 받아 앱바·FAB·툴바·시트에 여백으로 쓴다.

## 6. 화면 배치 요약

| 화면 | 앱바 | 주 행동 | 접힌 기능 |
|---|---|---|---|
| 서재 | `서재` · URL로 열기 · 설정 | `작품 찾기` FAB | 작품 행 `더보기`(원문 사이트, 서재에서 제거) |
| 목차 | `←` · 작품 제목 · `더보기` | `N화부터 이어서 읽기` | 앱바 메뉴(용어집, 미리 번역, 목차 제목 번역, 원문, 제거), 회차 바텀시트 |
| 리더 | 탭하면 나타남: `←` · 회차 제목 · 원문 전환 · `더보기` | 회차 끝 `다음 화 읽기` | 플로팅 툴바(이전·목차·보기 설정·다음), 앱바 메뉴, 문단 바텀시트 |
| 설정 | `←` · `설정` | 없음 | 선택 항목은 라디오 대화상자 |

## 7. UX 라이팅

토스 [앱인토스 UI/UX 가이드의 UX 라이팅](https://developers-apps-in-toss.toss.im/design/consumer-ux-guide.md)을 따른다.

- 모든 문구는 해요체로 쓴다. `되어요` 대신 `돼요`.
- 능동형으로 쓴다(`저장됐어요` → `저장했어요`). 수동형은 만료, 사용자에게 미치는 영향, 안심 안내에만 쓴다.
- 긍정형으로 쓴다(`~할 수 없어요` → `~하면 ~할 수 있어요`). 정말 불가능한 일만 부정형으로 말한다.
- 과도한 경어를 쓰지 않는다(`~시겠어요`, `~께`, `계시다`).
- 명사를 나열하지 않고 동사로 풀어 쓴다(`제목 미번역` → `제목 번역 전`).
- 대화상자 왼쪽 버튼은 `닫기`다. 오른쪽 버튼은 결과를 예측할 수 있는 동사로 쓴다(`제거하기`, `저장하기`, `열기`).
- 메뉴 항목은 `~하기`로 쓴다. 칩과 상태 라벨은 짧은 형태를 허용한다(`저장됨`, `읽는 중`).
- 오류는 원인과 다음 행동을 한 문장으로 한 번만 말한다.
- 내부 용어(바이트, 토큰, 요청 ID)는 기본 화면에 쓰지 않는다.

## 8. 검증

- 대비 감사 테스트, 컴포넌트 접근성 테스트, 화면 테스트(같은 동작을 새 접근성 이름으로 검증).
- 합성 미리보기(`tests/ui/renewal-preview.html`)를 360·412·600px × 라이트·다크로 확인.
- 실기: Black Shark 2(Android 10)·Fold7(Android 16)에서 인셋, 뒤로 가기, 글꼴 200%, TalkBack 기본 탐색, 기존 저장본·설정 보존.
