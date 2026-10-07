# Very Peri 디자인 시스템과 앱 셸 구현 계획 (#92)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 화면 재설계가 공유할 토큰·폰트·아이콘·공통 컴포넌트·앱 셸(앱바, 시스템 뒤로 가기, edge-to-edge, 앱 테마)을 만들고, 기존 화면이 새 셸 안에서 그대로 동작하게 한다.

**Architecture:** 의존성 없는 CSS 변수 토큰(`src/ui/theme/tokens.css`)과 자체 React 컴포넌트(`src/ui/components/`)를 만든다. 테마·독서 보기 설정은 기존 설정 스키마 v2의 선택 필드로 저장하고, 셸(`src/app/Application.tsx`)이 `html[data-theme]`·시스템 바·뒤로 가기·포커스를 관리한다. 컨트롤러 백스택은 회차 간 이동을 교체로 바꾼다.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 5 + Testing Library(jsdom), Capacitor 8(`@capacitor/app`, `@capacitor/core`의 `SystemBars`).

**Spec:** `docs/superpowers/specs/2026-10-08-ui-design-system-design.md` (정본 요약: `DESIGN.md`)

## Global Constraints

- 작업 위치: 워크트리 `D:/projects/narou-reader-92`, 브랜치 `codex/92-design-system`. 다른 워크트리와 `D:/projects/narou-reader`(main)의 파일은 건드리지 않는다. 워크트리에 `node_modules`가 없으면 먼저 `cd /d/projects/narou-reader-92 && npm ci --no-audit --no-fund`를 실행한다(lockfile 변경 금지).
- 새 런타임·개발 의존성을 추가하지 않는다. 폰트와 아이콘은 파일로 복사해 넣는다(Task 1).
- CSS는 토큰만 참조한다. `src/ui/theme/tokens.css` 밖에서 hex 색을 쓰지 않는다(`src/ui/reader.css`와 `src/ui/legacy/**`는 레거시라 예외, 건드리지 않는다).
- 새 사용자 문구는 해요체(DESIGN.md 7절). 단, 이 이슈에서는 기존 화면 문구를 바꾸지 않는다(하위 이슈 #93~#97 범위). 셸에 새로 생기는 문구만 해요체로 쓴다: `서재`, `목차`, `읽기`, `설정`, `뒤로 가기`, `더보기`, `서재로 가기`, `시스템 설정 따르기`, `라이트`, `다크`, `화면 테마`.
- 터치 영역 48px 이상, 아이콘만 있는 버튼은 `aria-label` 필수.
- 모션은 `transform`·`opacity`만, `prefers-reduced-motion: reduce`에서 0ms.
- jsdom에는 `HTMLDialogElement.showModal`, `window.matchMedia`, `inert`가 없다. 코드는 존재 여부를 확인하고 대체 경로를 쓴다.
- 테스트 파일 첫 줄: DOM이 필요하면 `// @vitest-environment jsdom`, 그다음 `import '@testing-library/jest-dom/vitest';`.
- 커밋 형식: `type: 한국어 설명 (#92)` + 빈 줄 + 본문(선택) + 빈 줄 + `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`. stage는 경로를 명시한다(`git add .`/`-A` 금지).
- 각 태스크 끝에서 `npx vitest run <해당 테스트>`와 `npm run typecheck`를 통과시킨다. 마지막 태스크에서 전체 검사를 돌린다.
- 명령은 Git Bash 기준이다. 작업 디렉터리는 항상 `cd /d/projects/narou-reader-92 && ...`로 명시한다.

## File Structure

| 경로 | 책임 |
|---|---|
| `src/ui/theme/tokens.css` | 색·타이포·모양·크기·모션·인셋 토큰(정본) |
| `src/ui/theme/base.css` | `@font-face`, 문서 바탕, 포커스 링, 모션 감소 |
| `src/ui/theme/fonts/PretendardVariable.woff2` | 번들 폰트 |
| `src/ui/theme/theme.ts` | 테마 해석(`resolveTheme`, `useResolvedTheme`) |
| `src/ui/icons/*.svg`, `src/ui/icons/svg.d.ts` | Material Symbols 아이콘 원본과 모듈 타입 |
| `src/ui/components/*.tsx`, `components.css` | 공통 컴포넌트와 스타일 |
| `src/ui/shell/backStack.ts` | 뒤로 가기 LIFO 레지스트리와 `useBackHandler` |
| `src/platform/shell.ts` | Capacitor 뒤로 가기·앱 종료·시스템 바 어댑터 |
| `src/storage/settings.ts` | 설정 스키마 v2 선택 필드 추가 |
| `src/app/renewalController.ts` | 테마 상태·백스택 규칙 |
| `src/app/Application.tsx`, `application.css` | 셸 |
| `tests/ui/theme-contrast.test.ts` | 대비 감사 |
| `tests/ui/components/*.test.tsx` | 컴포넌트 접근성 테스트 |
| `tests/ui/shell.test.tsx` | 셸 동작 테스트 |
| `tests/integration/navigation-stack.test.ts` | 백스택 규칙 테스트 |
| `tests/integration/theme-preferences.test.ts` | 테마 설정 저장 테스트 |

---

### Task 1: 폰트·아이콘 에셋과 Icon 컴포넌트

**Files:**
- Create: `src/ui/theme/fonts/PretendardVariable.woff2`, `licenses/Pretendard-OFL.txt`, `licenses/material-symbols-Apache-2.0.txt`
- Create: `src/ui/icons/{arrow_back,more_vert,settings,close,check}.svg`, `src/ui/icons/svg.d.ts`
- Create: `src/ui/components/Icon.tsx`, `src/ui/components/components.css`
- Modify: `THIRD_PARTY_NOTICES.md`
- Test: `tests/ui/components/icon.test.tsx`

**Interfaces:**
- Produces: `Icon({ name, size? }: { name: IconName; size?: number })`, `type IconName = 'arrow_back' | 'more_vert' | 'settings' | 'close' | 'check'`. 렌더 결과는 `aria-hidden="true"`인 `<span class="nr-icon" data-icon={name}>`.

- [ ] **Step 1: 에셋 받기 (스크래치 폴더에서)**

```bash
SCRATCH="$(mktemp -d)" && cd "$SCRATCH" \
 && npm pack pretendard@1.3.9 @material-symbols/svg-400@0.47.6 --silent \
 && mkdir p s && tar -xzf pretendard-1.3.9.tgz -C p && tar -xzf material-symbols-svg-400-0.47.6.tgz -C s \
 && mkdir -p /d/projects/narou-reader-92/src/ui/theme/fonts /d/projects/narou-reader-92/src/ui/icons \
 && cp p/package/dist/web/variable/woff2/PretendardVariable.woff2 /d/projects/narou-reader-92/src/ui/theme/fonts/ \
 && for n in arrow_back more_vert settings close check; do cp "s/package/outlined/$n.svg" /d/projects/narou-reader-92/src/ui/icons/; done \
 && cp s/package/LICENSE /d/projects/narou-reader-92/licenses/material-symbols-Apache-2.0.txt \
 && curl -sSfL https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE -o /d/projects/narou-reader-92/licenses/Pretendard-OFL.txt \
 && head -2 /d/projects/narou-reader-92/licenses/Pretendard-OFL.txt && ls -la /d/projects/narou-reader-92/src/ui/theme/fonts /d/projects/narou-reader-92/src/ui/icons
```

Expected: 라이선스 첫 줄 `Copyright (c) 2021, Kil Hyung-jin ...`, woff2 약 2,057,688바이트, svg 5개.

- [ ] **Step 2: SVG 모듈 타입 선언**

`src/ui/icons/svg.d.ts`:

```ts
declare module '*.svg' {
  const url: string;
  export default url;
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

`tests/ui/components/icon.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Icon } from '../../../src/ui/components/Icon';
afterEach(cleanup);
it('renders a decorative masked icon with its name and size', () => {
  const { container } = render(<Icon name="arrow_back" size={20} />);
  const icon = container.querySelector('.nr-icon') as HTMLElement;
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  expect(icon).toHaveAttribute('data-icon', 'arrow_back');
  expect(icon.style.getPropertyValue('--nr-icon-size')).toBe('20px');
  expect(icon.style.getPropertyValue('--nr-icon')).toMatch(/^url\(".+arrow_back.*\.svg.*"\)$/);
});
```

- [ ] **Step 4: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/icon.test.tsx`
Expected: FAIL (모듈 `Icon` 없음)

- [ ] **Step 5: Icon과 기본 CSS 구현**

`src/ui/components/Icon.tsx`:

```tsx
import type { CSSProperties, JSX } from 'react';
import arrowBack from '../icons/arrow_back.svg';
import check from '../icons/check.svg';
import close from '../icons/close.svg';
import moreVert from '../icons/more_vert.svg';
import settings from '../icons/settings.svg';
import './components.css';

// Material Symbols Outlined(Apache-2.0)에서 쓰는 아이콘만 복사해 둔다. 새 아이콘은 같은 방법으로 추가한다.
const icons = { arrow_back: arrowBack, check, close, more_vert: moreVert, settings } as const;
export type IconName = keyof typeof icons;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }): JSX.Element {
  const style = {
    '--nr-icon': `url("${icons[name]}")`,
    '--nr-icon-size': `${size}px`,
  } as CSSProperties;
  return <span className="nr-icon" aria-hidden="true" data-icon={name} style={style} />;
}
```

`src/ui/components/components.css` (이 태스크에서 만들고 이후 태스크가 아래에 절을 덧붙인다):

```css
/* 공통 컴포넌트 스타일. 토큰만 참조한다(DESIGN.md 2·4절). */
.nr-icon {
  display: inline-block;
  flex: none;
  inline-size: var(--nr-icon-size, 24px);
  block-size: var(--nr-icon-size, 24px);
  background-color: currentColor;
  -webkit-mask: var(--nr-icon) center / contain no-repeat;
  mask: var(--nr-icon) center / contain no-repeat;
}
```

- [ ] **Step 6: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/icon.test.tsx && npm run typecheck`
Expected: PASS. 만약 `--nr-icon` 값 정규식이 Vitest의 에셋 경로 형식과 다르면, 실제 값을 출력해 보고 정규식만 `/arrow_back/`를 포함하는지 확인하는 형태로 바꾼다(단언을 지우지 않는다).

- [ ] **Step 7: 서드파티 고지 추가**

`THIRD_PARTY_NOTICES.md` 끝에 추가:

```markdown

## Pretendard Variable 1.3.9

- Upstream: https://github.com/orioncactus/pretendard
- File: `src/ui/theme/fonts/PretendardVariable.woff2` (unchanged, from the npm package `pretendard@1.3.9`)
- License: SIL Open Font License 1.1. The complete license is in [`licenses/Pretendard-OFL.txt`](licenses/Pretendard-OFL.txt).

## Material Symbols (Outlined, weight 400)

- Upstream: https://github.com/google/material-design-icons (npm `@material-symbols/svg-400@0.47.6`)
- Files: `src/ui/icons/*.svg` (unchanged copies of the icons the app uses)
- License: Apache License 2.0. The complete license is in [`licenses/material-symbols-Apache-2.0.txt`](licenses/material-symbols-Apache-2.0.txt).
```

- [ ] **Step 8: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/theme/fonts/PretendardVariable.woff2 src/ui/icons licenses/Pretendard-OFL.txt licenses/material-symbols-Apache-2.0.txt src/ui/components/Icon.tsx src/ui/components/components.css THIRD_PARTY_NOTICES.md tests/ui/components/icon.test.tsx \
 && git commit -m "feat: Pretendard·Material Symbols 에셋과 Icon 컴포넌트 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 토큰·기본 CSS·대비 감사 테스트

**Files:**
- Create: `src/ui/theme/tokens.css`, `src/ui/theme/base.css`
- Test: `tests/ui/theme-contrast.test.ts`

**Interfaces:**
- Produces: CSS 변수 전체(아래 코드). 다른 CSS는 이 이름만 쓴다. `base.css`가 `tokens.css`를 `@import`하므로 앱은 `base.css` 하나만 불러온다.

- [ ] **Step 1: 실패하는 대비 감사 테스트 작성**

`tests/ui/theme-contrast.test.ts`:

```ts
// 토큰 대비 감사. tokens.css의 라이트·다크·독서 배경 값을 WCAG 2.2와 APCA(0.0.98G-4g)로 함께 판정한다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/theme/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`tokens.css에 ${selector} 블록이 없다`);
  const body = css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g))
    out[match[1]!] = match[2]!.toUpperCase();
  return out;
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function wcag(fg: string, bg: string): number {
  const y = (hex: string) => {
    const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [a, b] = [y(fg), y(bg)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function apca(fg: string, bg: string): number {
  const y = (hex: string) => {
    const [r, g, b] = rgb(hex).map((c) => c ** 2.4) as [number, number, number];
    const value = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    return value < 0.022 ? value + (0.022 - value) ** 1.414 : value;
  };
  const [text, back] = [y(fg), y(bg)];
  if (Math.abs(back - text) < 0.0005) return 0;
  if (back > text) {
    const s = (back ** 0.56 - text ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (back ** 0.65 - text ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

type Gate = readonly [wcagMin: number, lcMin: number];
const READ: Gate = [7, 90];
const TEXT: Gate = [4.5, 75];
const SUB: Gate = [4.5, 60];
const ICON: Gate = [3, 45];
const GRAPHIC: Gate = [3, 30];
const pairs: readonly (readonly [string, string, string, Gate])[] = [
  ['on-surface', 'surface', '본문', TEXT],
  ['on-surface', 'surface-container-low', '카드·바텀시트 본문', TEXT],
  ['on-surface', 'surface-container', '메뉴 본문', TEXT],
  ['on-surface', 'surface-container-high', '대화상자 본문', TEXT],
  ['on-surface', 'surface-container-highest', '입력값', TEXT],
  ['on-surface-variant', 'surface', '보조 텍스트', SUB],
  ['on-surface-variant', 'surface-container-low', '보조(카드·시트)', SUB],
  ['on-surface-variant', 'surface-container', '보조(메뉴)', SUB],
  ['on-surface-variant', 'surface-container-high', '보조(대화상자)', SUB],
  ['on-surface-variant', 'surface-container-highest', '보조(입력)', SUB],
  ['outline', 'surface', '아이콘·3차', ICON],
  ['outline', 'surface-container-low', '아이콘(카드·시트)', ICON],
  ['outline', 'surface-container-high', '아이콘(대화상자)', ICON],
  ['outline', 'surface-container-highest', '입력 테두리', GRAPHIC],
  ['on-primary', 'primary-fill', '채움 버튼 라벨', TEXT],
  ['primary', 'surface', '텍스트 버튼·링크', TEXT],
  ['primary', 'surface-container-low', '텍스트 버튼(카드·시트)', TEXT],
  ['primary', 'surface-container', '텍스트 버튼(메뉴)', TEXT],
  ['primary', 'surface-container-high', '텍스트 버튼(대화상자)', TEXT],
  ['on-primary-container', 'primary-container', '토널 버튼·이어서 읽기 카드', TEXT],
  ['on-secondary-container', 'secondary-container', '선택 칩', TEXT],
  ['error', 'surface', '오류 글자', TEXT],
  ['error', 'surface-container', '파괴적 메뉴 항목', TEXT],
  ['error', 'surface-container-high', '대화상자 파괴적 버튼', TEXT],
  ['on-error', 'error', '삭제 채움 버튼', TEXT],
  ['on-error-container', 'error-container', '오류 카드', TEXT],
  ['success', 'surface', '완료 글자', TEXT],
  ['warning', 'surface', '주의 글자', TEXT],
  ['inverse-on-surface', 'inverse-surface', '스낵바 글자', TEXT],
  ['inverse-primary', 'inverse-surface', '스낵바 행동', TEXT],
  ['primary-fill', 'surface', 'FAB·진행 막대', GRAPHIC],
  ['primary-fill', 'primary-container', '진행 막대(트랙 위)', GRAPHIC],
  ['primary', 'surface', '포커스 링', ICON],
  ['primary', 'surface-container-high', '포커스 링(대화상자)', ICON],
];

const themes = { light: block(':root'), dark: { ...block(':root'), ...block(":root[data-theme='dark']") } };
const cases = Object.entries(themes).flatMap(([theme, tokens]) =>
  pairs.map(([fg, bg, use, gate]) => ({ name: `${theme} ${use} (${fg} / ${bg})`, fg: tokens[fg], bg: tokens[bg], gate })),
);
const reading = [
  { name: 'light 독서 기본', fg: themes.light['on-surface'], bg: themes.light.surface },
  { name: 'dark 독서 기본', fg: themes.dark['on-surface'], bg: themes.dark.surface },
  { name: '독서 세피아', fg: block("[data-reading-background='sepia']")['reading-on-surface'], bg: block("[data-reading-background='sepia']")['reading-surface'] },
  { name: '독서 검정', fg: block("[data-reading-background='black']")['reading-on-surface'], bg: block("[data-reading-background='black']")['reading-surface'] },
].map((value) => ({ ...value, gate: READ }));

describe('design token contrast', () => {
  it.each([...cases, ...reading])('$name', ({ fg, bg, gate }) => {
    expect(fg, '전경 토큰 누락').toMatch(/^#[0-9A-F]{6}$/);
    expect(bg, '배경 토큰 누락').toMatch(/^#[0-9A-F]{6}$/);
    expect(wcag(fg!, bg!)).toBeGreaterThanOrEqual(gate[0]);
    expect(Math.abs(apca(fg!, bg!))).toBeGreaterThanOrEqual(gate[1]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/theme-contrast.test.ts`
Expected: FAIL (`tokens.css` 없음, ENOENT)

- [ ] **Step 3: 토큰 작성**

`src/ui/theme/tokens.css`:

```css
/* 디자인 토큰 정본. 근거는 DESIGN.md 2절이고, 색을 바꾸면 tests/ui/theme-contrast.test.ts가 판정한다. */
:root {
  color-scheme: light;
  --surface: #fafafd;
  --surface-container-lowest: #ffffff;
  --surface-container-low: #f4f4fa;
  --surface-container: #eeeef6;
  --surface-container-high: #e8e8f2;
  --surface-container-highest: #e2e2ee;
  --on-surface: #1a1a28;
  --on-surface-variant: #45465c;
  --outline: #6e6f86;
  --outline-variant: #c9c9da;
  --primary: #3f4199;
  --primary-fill: #6667ab;
  --on-primary: #ffffff;
  --primary-container: #e3e3fa;
  --on-primary-container: #2c2d78;
  --secondary-container: #e6e6f2;
  --on-secondary-container: #2e2f45;
  --error: #901c16;
  --on-error: #ffffff;
  --error-container: #fce4e2;
  --on-error-container: #7a1712;
  --success: #1f6b45;
  --warning: #7a5a12;
  --inverse-surface: #2c2c3a;
  --inverse-on-surface: #f2f2fa;
  --inverse-primary: #d2d3ff;
  --scrim: rgb(0 0 0 / 0.32);
  --shadow-color: rgb(26 26 40 / 0.16);
  --reading-surface: var(--surface);
  --reading-on-surface: var(--on-surface);

  --font-sans: 'Pretendard Variable', Pretendard, system-ui, -apple-system, 'Noto Sans KR', sans-serif;
  --type-headline-small: 600 1.5rem/2rem var(--font-sans);
  --type-title-large: 600 1.375rem/1.75rem var(--font-sans);
  --type-title-medium: 600 1rem/1.5rem var(--font-sans);
  --type-body-large: 400 1rem/1.5rem var(--font-sans);
  --type-body-medium: 400 0.875rem/1.25rem var(--font-sans);
  --type-label-large: 600 0.875rem/1.25rem var(--font-sans);
  --type-label-medium: 500 0.75rem/1rem var(--font-sans);

  --shape-xs: 4px;
  --shape-sm: 8px;
  --shape-md: 12px;
  --shape-lg: 16px;
  --shape-xl: 28px;
  --shape-full: 999px;

  --touch-target: 48px;
  --button-m: 56px;
  --button-s: 40px;
  --icon-button: 40px;
  --app-bar: 64px;
  --list-one-line: 56px;
  --list-two-line: 72px;
  --fab: 56px;
  --toolbar: 64px;
  --content-max: 840px;
  --reading-max: 40em;

  --elevation-2: 0 1px 2px var(--shadow-color), 0 2px 6px 2px var(--shadow-color);
  --elevation-3: 0 1px 3px var(--shadow-color), 0 4px 8px 3px var(--shadow-color);
  --state-hover: 0.08;
  --state-focus: 0.1;
  --state-pressed: 0.1;
  --state-dragged: 0.16;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-spring: linear(0, 0.2 6%, 0.6 16%, 0.92 28%, 1.04 40%, 1.02 55%, 1);
  --duration-short: 150ms;
  --duration-enter: 300ms;
  --duration-exit: 200ms;

  /* Capacitor SystemBars(insetsHandling: 'css')가 --safe-area-inset-*를 넣는다. 없으면 env()로 대체한다. */
  --inset-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
  --inset-right: var(--safe-area-inset-right, env(safe-area-inset-right, 0px));
  --inset-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px));
  --inset-left: var(--safe-area-inset-left, env(safe-area-inset-left, 0px));
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --surface: #13131b;
  --surface-container-lowest: #0e0e15;
  --surface-container-low: #1a1a24;
  --surface-container: #1f1f2a;
  --surface-container-high: #262633;
  --surface-container-highest: #30303f;
  --on-surface: #eeeef6;
  --on-surface-variant: #c9c9dc;
  --outline: #a3a4bf;
  --outline-variant: #464659;
  --primary: #d2d3ff;
  --primary-fill: #d2d3ff;
  --on-primary: #1a1b55;
  --primary-container: #3b3c8f;
  --on-primary-container: #e6e5ff;
  --secondary-container: #383850;
  --on-secondary-container: #e6e5fa;
  --error: #ffc4bc;
  --on-error: #4a0002;
  --error-container: #8c0009;
  --on-error-container: #ffe1dd;
  --success: #8be0b0;
  --warning: #efcb7c;
  --inverse-surface: #e4e4ee;
  --inverse-on-surface: #1a1a28;
  --inverse-primary: #36388f;
  --scrim: rgb(0 0 0 / 0.5);
  --shadow-color: rgb(0 0 0 / 0.4);
}
[data-reading-background='sepia'] {
  --reading-surface: #f4ebd7;
  --reading-on-surface: #2b2116;
}
[data-reading-background='black'] {
  --reading-surface: #000000;
  --reading-on-surface: #e4e4ee;
}
```

주의: 감사 테스트의 `block(':root')`는 첫 `:root {`만 읽는다. `:root {` 블록을 하나만 둔다.

- [ ] **Step 4: 기본 CSS 작성**

`src/ui/theme/base.css`:

```css
@import './tokens.css';

@font-face {
  font-family: 'Pretendard Variable';
  src: url('./fonts/PretendardVariable.woff2') format('woff2-variations');
  font-weight: 45 920;
  font-style: normal;
  font-display: swap;
}
html {
  background: var(--surface);
  color: var(--on-surface);
  font: var(--type-body-large);
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body {
  margin: 0;
  min-block-size: 100dvh;
  background: var(--surface);
}
:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}
[lang='ja'] {
  font-family: system-ui, 'Noto Sans JP', 'Noto Sans CJK JP', sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0ms !important;
    animation-duration: 0ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/theme-contrast.test.ts`
Expected: PASS, 72개 케이스(34 × 2 + 4). 하나라도 실패하면 토큰 값을 바꾸지 말고 DESIGN.md 2.1절과 대조해 오타를 찾는다.

- [ ] **Step 6: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/theme/tokens.css src/ui/theme/base.css tests/ui/theme-contrast.test.ts \
 && git commit -m "feat: Very Peri 토큰과 WCAG·APCA 대비 감사 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 테마·독서 보기 설정 저장

**Files:**
- Modify: `src/storage/settings.ts:1-25` (타입·검증)
- Modify: `src/app/renewalController.ts` (스냅샷 필드, `persistSettings`, `initialize`, 공개 메서드)
- Test: `tests/storage/reading-settings.test.ts`(추가), `tests/integration/theme-preferences.test.ts`(신규)

**Interfaces:**
- Produces (`src/storage/settings.ts`):
  - `export type ThemePreference = 'system' | 'light' | 'dark';`
  - `export type ReadingBackground = 'theme' | 'sepia' | 'black';`
  - `export type LineHeight = 1.6 | 1.8 | 2;`
  - `ReadingSettings`에 선택 필드 `theme?`, `readingBackground?`, `lineHeight?`
- Produces (`RenewalSnapshot`): `theme: ThemePreference`(기본 `'system'`), `readingBackground: ReadingBackground`(기본 `'theme'`), `lineHeight: LineHeight`(기본 `1.8`)
- Produces (`RenewalController`): `changeTheme(theme: ThemePreference): void`, `changeReadingBackground(value: ReadingBackground): void`, `changeLineHeight(value: LineHeight): void`

- [ ] **Step 1: 실패하는 저장소 테스트 추가**

`tests/storage/reading-settings.test.ts` 끝에 추가:

```ts
test('v2 settings keep optional theme and reading view preferences', async () => {
  const memory = new Map<string, string>();
  const repository = createReadingSettingsRepository({
    get: async ({ key }) => ({ value: memory.get(key) ?? null }),
    set: async ({ key, value }) => {
      memory.set(key, value);
    },
  });
  const settings = {
    schemaVersion: 2 as const,
    selection: null,
    fontSize: 18,
    theme: 'dark' as const,
    readingBackground: 'sepia' as const,
    lineHeight: 2 as const,
  };
  await repository.saveReadingSettings(settings);
  expect(await repository.readReadingSettings()).toEqual(settings);
  await expect(
    repository.saveReadingSettings({ ...settings, theme: 'neon' as never }),
  ).rejects.toThrow();
  await expect(
    repository.saveReadingSettings({ ...settings, readingBackground: 'blue' as never }),
  ).rejects.toThrow();
  await expect(
    repository.saveReadingSettings({ ...settings, lineHeight: 1.7 as never }),
  ).rejects.toThrow();
});
test('v2 settings saved before theme preferences still read unchanged', async () => {
  const stored = JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 22 });
  const repository = createReadingSettingsRepository({
    get: async () => ({ value: stored }),
    set: async () => {},
  });
  expect(await repository.readReadingSettings()).toEqual({
    schemaVersion: 2,
    selection: null,
    fontSize: 22,
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/storage/reading-settings.test.ts`
Expected: 첫 새 테스트 FAIL(저장 시 `corrupt` 또는 검증 실패), 두 번째는 PASS.

- [ ] **Step 3: 스키마 확장**

`src/storage/settings.ts`에서 `ReadingSettings` 타입과 `readingSettings` 함수를 아래로 바꾼다(다른 코드는 그대로):

```ts
export type ThemePreference = 'system' | 'light' | 'dark';
export type ReadingBackground = 'theme' | 'sepia' | 'black';
export type LineHeight = 1.6 | 1.8 | 2;
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];
export const READING_BACKGROUNDS: readonly ReadingBackground[] = ['theme', 'sepia', 'black'];
export const LINE_HEIGHTS: readonly LineHeight[] = [1.6, 1.8, 2];
export type ReadingSettings = {
  schemaVersion: 2;
  selection: import('../contracts').SelectedModel | null;
  fontSize: number;
  autoTranslate?: boolean;
  autoRetryFailed?: boolean;
  theme?: ThemePreference;
  readingBackground?: ReadingBackground;
  lineHeight?: LineHeight;
};
function readingSettings(value: unknown): ReadingSettings {
  object(value, [
    'schemaVersion',
    'selection',
    'fontSize',
    'autoTranslate',
    'autoRetryFailed',
    'theme',
    'readingBackground',
    'lineHeight',
  ]);
  check(value.autoTranslate === undefined || typeof value.autoTranslate === 'boolean');
  check(value.autoRetryFailed === undefined || typeof value.autoRetryFailed === 'boolean');
  check(value.theme === undefined || THEME_PREFERENCES.includes(value.theme as ThemePreference));
  check(
    value.readingBackground === undefined ||
      READING_BACKGROUNDS.includes(value.readingBackground as ReadingBackground),
  );
  check(value.lineHeight === undefined || LINE_HEIGHTS.includes(value.lineHeight as LineHeight));
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== 2)
    throw new StorageError('unsupported_schema');
  check(value.schemaVersion === 2);
  integer(value.fontSize, 10);
  check(value.fontSize <= 48);
  if (value.selection !== null) selected(value.selection);
  return value as unknown as ReadingSettings;
}
```

- [ ] **Step 4: 저장소 테스트 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/storage/reading-settings.test.ts`
Expected: PASS

- [ ] **Step 5: 실패하는 컨트롤러 테스트 작성**

`tests/integration/theme-preferences.test.ts`:

```ts
import { expect, it, vi } from 'vitest';
import { createRenewalController } from '../../src/app/renewalController';
import type { ReadingSettings } from '../../src/storage/settings';

function controllerWith(saved: ReadingSettings) {
  const saveReadingSettings = vi.fn(async (_value: ReadingSettings) => {});
  const controller = createRenewalController({
    settings: { readReadingSettings: async () => saved, saveReadingSettings },
  });
  return { controller, saveReadingSettings };
}

it('defaults to the system theme and default reading view', async () => {
  const { controller } = controllerWith({ schemaVersion: 2, selection: null, fontSize: 18 });
  await controller.initialize();
  expect(controller.getSnapshot()).toMatchObject({
    theme: 'system',
    readingBackground: 'theme',
    lineHeight: 1.8,
  });
  controller.dispose();
});

it('restores saved preferences and persists changes without default keys', async () => {
  const { controller, saveReadingSettings } = controllerWith({
    schemaVersion: 2,
    selection: null,
    fontSize: 18,
    theme: 'dark',
  });
  await controller.initialize();
  expect(controller.getSnapshot().theme).toBe('dark');
  controller.changeReadingBackground('sepia');
  controller.changeLineHeight(2);
  controller.changeTheme('system');
  await vi.waitFor(() => expect(saveReadingSettings).toHaveBeenCalledTimes(3));
  const last = saveReadingSettings.mock.calls.at(-1)![0];
  expect(last).toMatchObject({ readingBackground: 'sepia', lineHeight: 2 });
  expect(last).not.toHaveProperty('theme');
  controller.dispose();
});

it('ignores values outside the allowed preferences', async () => {
  const { controller, saveReadingSettings } = controllerWith({
    schemaVersion: 2,
    selection: null,
    fontSize: 18,
  });
  await controller.initialize();
  controller.changeTheme('neon' as never);
  controller.changeLineHeight(3 as never);
  controller.changeReadingBackground('blue' as never);
  expect(controller.getSnapshot()).toMatchObject({
    theme: 'system',
    lineHeight: 1.8,
    readingBackground: 'theme',
  });
  expect(saveReadingSettings).not.toHaveBeenCalled();
  controller.dispose();
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/integration/theme-preferences.test.ts`
Expected: FAIL (`theme` 필드 없음 / `changeTheme` 없음)

- [ ] **Step 7: 컨트롤러 구현**

`src/app/renewalController.ts`:

1. import에 추가:
```ts
import {
  LINE_HEIGHTS,
  READING_BACKGROUNDS,
  THEME_PREFERENCES,
  type LineHeight,
  type ReadingBackground,
  type ThemePreference,
} from '../storage/settings';
```
(이미 `ReadingSettings`를 같은 모듈에서 import하고 있으면 같은 import 문에 합친다.)

2. `RenewalSnapshot` 인터페이스의 `readonly fontSize: number;` 아래에 추가:
```ts
  readonly theme: ThemePreference;
  readonly readingBackground: ReadingBackground;
  readonly lineHeight: LineHeight;
```

3. `RenewalController` 인터페이스의 `changeFontSize(fontSize: number): void;` 아래에 추가:
```ts
  changeTheme(theme: ThemePreference): void;
  changeReadingBackground(value: ReadingBackground): void;
  changeLineHeight(value: LineHeight): void;
```

4. 초기 스냅샷의 `fontSize: 18,` 아래에 추가:
```ts
    theme: 'system',
    readingBackground: 'theme',
    lineHeight: 1.8,
```

5. `persistSettings`의 `value` 객체에서 `fontSize: snapshot.fontSize,` 아래에 추가:
```ts
      ...(snapshot.theme !== 'system' ? { theme: snapshot.theme } : {}),
      ...(snapshot.readingBackground !== 'theme'
        ? { readingBackground: snapshot.readingBackground }
        : {}),
      ...(snapshot.lineHeight !== 1.8 ? { lineHeight: snapshot.lineHeight } : {}),
```
`ReadingSettings`를 만드는 곳은 `persistSettings` 하나뿐이다(`grep -n "schemaVersion: 2" src/app/renewalController.ts`가 한 줄만 찾는다). 다른 `SelectedModel` 객체는 바꾸지 않는다.

6. `initialize`의 `publish({ connection: ..., fontSize: saved.fontSize, ... })`에 추가:
```ts
            theme: saved.theme ?? 'system',
            readingBackground: saved.readingBackground ?? 'theme',
            lineHeight: saved.lineHeight ?? 1.8,
```

7. `changeFontSize` 함수 아래에 추가:
```ts
  function changeTheme(theme: ThemePreference): void {
    if (!THEME_PREFERENCES.includes(theme) || theme === snapshot.theme) return;
    publish({ theme });
    persistSettings();
  }
  function changeReadingBackground(value: ReadingBackground): void {
    if (!READING_BACKGROUNDS.includes(value) || value === snapshot.readingBackground) return;
    publish({ readingBackground: value });
    persistSettings();
  }
  function changeLineHeight(value: LineHeight): void {
    if (!LINE_HEIGHTS.includes(value) || value === snapshot.lineHeight) return;
    publish({ lineHeight: value });
    persistSettings();
  }
```

8. 반환 객체의 `changeFontSize,` 옆에 `changeTheme, changeReadingBackground, changeLineHeight,`를 추가한다.

- [ ] **Step 8: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/integration/theme-preferences.test.ts tests/storage/reading-settings.test.ts && npm run typecheck`
Expected: PASS. `persistSettings`는 `initialized` 이후에만 저장하므로 `initialize()`를 먼저 기다린다(테스트가 이미 그렇게 한다).

- [ ] **Step 9: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/storage/settings.ts src/app/renewalController.ts tests/storage/reading-settings.test.ts tests/integration/theme-preferences.test.ts \
 && git commit -m "feat: 앱 테마와 독서 보기 설정 저장 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Button·IconButton·Chip·Card·ListItem

**Files:**
- Create: `src/ui/components/Button.tsx`, `IconButton.tsx`, `Chip.tsx`, `Card.tsx`, `ListItem.tsx`
- Modify: `src/ui/components/components.css` (절 추가)
- Test: `tests/ui/components/basic.test.tsx`

**Interfaces:**
- Consumes: `Icon`, `IconName` (Task 1)
- Produces:
  - `Button(props: ButtonProps)`; `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant: 'filled'|'tonal'|'outlined'|'text'; size?: 'm'|'s'; tone?: 'danger'; icon?: IconName }`. 기본 `size='s'`, 기본 `type='button'`.
  - `IconButton(props: IconButtonProps)`; `IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'|'children'> { icon: IconName; label: string; variant?: 'standard'|'tonal'; pressed?: boolean; ref?: Ref<HTMLButtonElement> }`
  - `Chip({ label, selected?, onClick? })` — `selected`가 boolean이면 `aria-pressed`.
  - `Card({ variant?: 'filled'|'tonal'|'error', onClick?, label?, role?, children })` — `onClick`이 있으면 루트가 `<button>`.
  - `ListItem({ headline, supporting?, leading?, trailing?, onClick, current?, lang? })`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/components/basic.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../../../src/ui/components/Button';
import { IconButton } from '../../../src/ui/components/IconButton';
import { Chip } from '../../../src/ui/components/Chip';
import { Card } from '../../../src/ui/components/Card';
import { ListItem } from '../../../src/ui/components/ListItem';
afterEach(cleanup);

describe('Button', () => {
  it('defaults to a small non-submitting button and exposes its variant', () => {
    const onClick = vi.fn();
    render(
      <form onSubmit={() => { throw new Error('submitted'); }}>
        <Button variant="tonal" onClick={onClick}>미리 번역하기</Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: '미리 번역하기' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('nr-button', 'nr-button--tonal', 'nr-button--s');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('supports the medium filled primary action and danger tone', () => {
    render(
      <>
        <Button variant="filled" size="m">12화부터 이어서 읽기</Button>
        <Button variant="filled" tone="danger">제거하기</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: '12화부터 이어서 읽기' })).toHaveClass('nr-button--m');
    expect(screen.getByRole('button', { name: '제거하기' })).toHaveClass('nr-button--danger');
  });
});

describe('IconButton', () => {
  it('requires a label and reflects pressed state', () => {
    render(<IconButton icon="settings" label="설정" pressed={false} />);
    const button = screen.getByRole('button', { name: '설정' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button.querySelector('.nr-icon')).toHaveAttribute('aria-hidden', 'true');
  });
  it('omits aria-pressed when it is not a toggle', () => {
    render(<IconButton icon="close" label="닫기" />);
    expect(screen.getByRole('button', { name: '닫기' })).not.toHaveAttribute('aria-pressed');
  });
});

describe('Chip and Card', () => {
  it('filter chip exposes selection', () => {
    render(<Chip label="세피아" selected onClick={() => {}} />);
    expect(screen.getByRole('button', { name: '세피아' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('interactive card is a button and static card is not', () => {
    const onClick = vi.fn();
    render(
      <>
        <Card variant="tonal" onClick={onClick} label="이어서 읽기 작품 A">이어서 읽기</Card>
        <Card variant="error">저장하지 못했어요</Card>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '이어서 읽기 작품 A' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('저장하지 못했어요').closest('button')).toBeNull();
  });
});

describe('ListItem', () => {
  it('keeps the main action and trailing action as sibling buttons', () => {
    const onClick = vi.fn();
    render(
      <ListItem
        headline="마을의 아침"
        supporting="12화 · 오늘 읽음"
        current
        onClick={onClick}
        trailing={<IconButton icon="more_vert" label="12화 더보기" />}
      />,
    );
    const main = screen.getByRole('button', { name: /마을의 아침/ });
    expect(main).toHaveAttribute('aria-current', 'true');
    expect(main).toHaveAccessibleName('마을의 아침 12화 · 오늘 읽음');
    expect(main.contains(screen.getByRole('button', { name: '12화 더보기' }))).toBe(false);
    fireEvent.click(main);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/basic.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 컴포넌트 구현**

`src/ui/components/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, JSX } from 'react';
import { Icon, type IconName } from './Icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'filled' | 'tonal' | 'outlined' | 'text';
  size?: 'm' | 's';
  tone?: 'danger';
  icon?: IconName;
}
export function Button({
  variant,
  size = 's',
  tone,
  icon,
  className,
  type = 'button',
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes = ['nr-button', `nr-button--${variant}`, `nr-button--${size}`];
  if (tone) classes.push(`nr-button--${tone}`);
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(' ')} {...rest}>
      {icon && <Icon name={icon} size={size === 'm' ? 24 : 18} />}
      <span className="nr-button__label">{children}</span>
    </button>
  );
}
```

`src/ui/components/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, JSX, Ref } from 'react';
import { Icon, type IconName } from './Icon';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  icon: IconName;
  label: string;
  variant?: 'standard' | 'tonal';
  pressed?: boolean;
  ref?: Ref<HTMLButtonElement>;
}
export function IconButton({
  icon,
  label,
  variant = 'standard',
  pressed,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps): JSX.Element {
  const classes = ['nr-icon-button', `nr-icon-button--${variant}`];
  if (className) classes.push(className);
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={classes.join(' ')}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
```

`src/ui/components/Chip.tsx`:

```tsx
import type { JSX } from 'react';

export function Chip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected?: boolean;
  onClick?(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`nr-chip${selected ? ' nr-chip--selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
```

`src/ui/components/Card.tsx`:

```tsx
import type { AriaRole, JSX, ReactNode } from 'react';

export function Card({
  variant = 'filled',
  onClick,
  label,
  role,
  children,
}: {
  variant?: 'filled' | 'tonal' | 'error';
  onClick?(): void;
  label?: string;
  role?: AriaRole;
  children: ReactNode;
}): JSX.Element {
  const className = `nr-card nr-card--${variant}${onClick ? ' nr-card--interactive' : ''}`;
  if (onClick)
    return (
      <button type="button" className={className} aria-label={label} onClick={onClick}>
        {children}
      </button>
    );
  return (
    <section className={className} aria-label={label} role={role}>
      {children}
    </section>
  );
}
```

`src/ui/components/ListItem.tsx`:

```tsx
import type { JSX, ReactNode } from 'react';

export function ListItem({
  headline,
  supporting,
  leading,
  trailing,
  onClick,
  current = false,
  lang,
}: {
  headline: ReactNode;
  supporting?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick(): void;
  current?: boolean;
  lang?: string;
}): JSX.Element {
  const classes = ['nr-list-item'];
  if (supporting) classes.push('nr-list-item--two-line');
  if (current) classes.push('nr-list-item--current');
  return (
    <div className={classes.join(' ')}>
      <button
        type="button"
        className="nr-list-item__main"
        aria-current={current ? 'true' : undefined}
        onClick={onClick}
      >
        {leading && <span className="nr-list-item__leading">{leading}</span>}
        <span className="nr-list-item__text">
          <span className="nr-list-item__headline" lang={lang}>
            {headline}
          </span>
          {supporting && <span className="nr-list-item__supporting"> {supporting}</span>}
        </span>
      </button>
      {trailing && <span className="nr-list-item__trailing">{trailing}</span>}
    </div>
  );
}
```

(보조 줄 앞의 공백 하나는 접근성 이름을 `헤드라인 보조줄`로 띄워 읽게 하려는 것이다. CSS가 보조 줄을 블록으로 내리므로 화면에는 보이지 않는다.)

- [ ] **Step 4: 스타일 추가**

`src/ui/components/components.css` 끝에 추가:

```css
/* 상태 레이어: 호버 8%, 포커스·눌림 10% */
.nr-button,
.nr-icon-button,
.nr-chip,
.nr-card--interactive,
.nr-list-item__main,
.nr-menu__item,
.nr-fab,
.nr-snackbar__action {
  position: relative;
  isolation: isolate;
  -webkit-tap-highlight-color: transparent;
}
.nr-button::before,
.nr-icon-button::before,
.nr-chip::before,
.nr-card--interactive::before,
.nr-list-item__main::before,
.nr-menu__item::before,
.nr-fab::before,
.nr-snackbar__action::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: currentColor;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-short) var(--ease-standard);
}
:is(.nr-button, .nr-icon-button, .nr-chip, .nr-card--interactive, .nr-list-item__main, .nr-menu__item, .nr-fab, .nr-snackbar__action):hover::before {
  opacity: var(--state-hover);
}
:is(.nr-button, .nr-icon-button, .nr-chip, .nr-card--interactive, .nr-list-item__main, .nr-menu__item, .nr-fab, .nr-snackbar__action):focus-visible::before {
  opacity: var(--state-focus);
}
:is(.nr-button, .nr-icon-button, .nr-chip, .nr-card--interactive, .nr-list-item__main, .nr-menu__item, .nr-fab, .nr-snackbar__action):active::before {
  opacity: var(--state-pressed);
}

/* Button */
.nr-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-inline-size: var(--touch-target);
  border: 0;
  border-radius: var(--shape-full);
  font: var(--type-label-large);
  white-space: nowrap;
  cursor: pointer;
}
.nr-button--s {
  block-size: var(--button-s);
  padding: 0 24px;
}
.nr-button--s::after {
  /* 시각 40px, 터치 영역 48px */
  content: '';
  position: absolute;
  inset: -4px 0;
}
.nr-button--m {
  block-size: var(--button-m);
  padding: 0 28px;
  font: var(--type-title-medium);
}
.nr-button--filled {
  background: var(--primary-fill);
  color: var(--on-primary);
}
.nr-button--tonal {
  background: var(--primary-container);
  color: var(--on-primary-container);
}
.nr-button--outlined {
  background: transparent;
  color: var(--primary);
  box-shadow: inset 0 0 0 1px var(--outline);
}
.nr-button--text {
  background: transparent;
  color: var(--primary);
  padding: 0 12px;
}
.nr-button--danger.nr-button--filled {
  background: var(--error);
  color: var(--on-error);
}
.nr-button--danger:not(.nr-button--filled) {
  color: var(--error);
}
.nr-button:disabled {
  cursor: default;
  background: color-mix(in srgb, var(--on-surface) 12%, transparent);
  color: color-mix(in srgb, var(--on-surface) 38%, transparent);
  box-shadow: none;
}
.nr-button--text:disabled,
.nr-button--outlined:disabled {
  background: transparent;
}
.nr-button:disabled::before {
  display: none;
}

/* IconButton: 시각 40px, 터치 영역 48px */
.nr-icon-button {
  display: inline-grid;
  place-items: center;
  inline-size: var(--icon-button);
  block-size: var(--icon-button);
  margin: 4px;
  padding: 0;
  border: 0;
  border-radius: var(--shape-full);
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
}
.nr-icon-button::after {
  content: '';
  position: absolute;
  inset: -4px;
}
.nr-icon-button--tonal {
  background: var(--secondary-container);
  color: var(--on-secondary-container);
}
.nr-icon-button[aria-pressed='true'] {
  background: var(--primary-container);
  color: var(--on-primary-container);
}
.nr-icon-button:disabled {
  cursor: default;
  color: color-mix(in srgb, var(--on-surface) 38%, transparent);
}

/* Chip */
.nr-chip {
  display: inline-flex;
  align-items: center;
  block-size: 32px;
  padding: 0 16px;
  border: 0;
  border-radius: var(--shape-sm);
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--outline);
  color: var(--on-surface-variant);
  font: var(--type-label-large);
  cursor: pointer;
}
.nr-chip::after {
  content: '';
  position: absolute;
  inset: -8px 0;
}
.nr-chip--selected {
  background: var(--secondary-container);
  box-shadow: none;
  color: var(--on-secondary-container);
}

/* Card */
.nr-card {
  display: block;
  box-sizing: border-box;
  inline-size: 100%;
  margin: 0;
  padding: 16px;
  border: 0;
  border-radius: var(--shape-md);
  font: var(--type-body-large);
  text-align: start;
}
.nr-card--filled {
  background: var(--surface-container-low);
  color: var(--on-surface);
}
.nr-card--tonal {
  background: var(--primary-container);
  color: var(--on-primary-container);
}
.nr-card--error {
  background: var(--error-container);
  color: var(--on-error-container);
}
.nr-card--interactive {
  cursor: pointer;
}

/* ListItem */
.nr-list-item {
  display: flex;
  align-items: center;
  min-block-size: var(--list-one-line);
}
.nr-list-item--two-line {
  min-block-size: var(--list-two-line);
}
.nr-list-item--current {
  background: var(--primary-container);
  color: var(--on-primary-container);
}
.nr-list-item__main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 16px;
  align-self: stretch;
  min-inline-size: 0;
  padding: 8px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: var(--type-body-large);
  text-align: start;
  cursor: pointer;
}
.nr-list-item__leading {
  flex: none;
  min-inline-size: 2ch;
  color: var(--on-surface-variant);
  font: var(--type-label-large);
  font-variant-numeric: tabular-nums;
}
.nr-list-item--current .nr-list-item__leading {
  color: inherit;
}
.nr-list-item__text {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
}
.nr-list-item__headline {
  overflow-wrap: anywhere;
}
.nr-list-item__supporting {
  color: var(--on-surface-variant);
  font: var(--type-body-medium);
}
.nr-list-item--current .nr-list-item__supporting {
  color: inherit;
}
.nr-list-item__trailing {
  display: flex;
  flex: none;
  padding-inline-end: 4px;
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/basic.test.tsx && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/components/Button.tsx src/ui/components/IconButton.tsx src/ui/components/Chip.tsx src/ui/components/Card.tsx src/ui/components/ListItem.tsx src/ui/components/components.css tests/ui/components/basic.test.tsx \
 && git commit -m "feat: 버튼·아이콘 버튼·칩·카드·목록 행 컴포넌트 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 뒤로 가기 레지스트리와 Dialog·BottomSheet

**Files:**
- Create: `src/ui/shell/backStack.ts`, `src/ui/components/Modal.tsx`
- Modify: `src/ui/components/components.css`
- Test: `tests/ui/components/modal.test.tsx`

**Interfaces:**
- Produces (`backStack.ts`): `pushBackHandler(handler: () => void): () => void`, `runTopBackHandler(): boolean`, `useBackHandler(active: boolean, handler: () => void): void`
- Produces (`Modal.tsx`):
  - `Dialog({ open, title, onClose, children, actions?, fullScreen? }: DialogProps)` — `fullScreen?: { confirmLabel: string; onConfirm(): void; confirmDisabled?: boolean }`
  - `BottomSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode })`
- 닫힘은 항상 부모의 `onClose`가 `open`을 `false`로 바꿔서 일어난다(제어 컴포넌트).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/components/modal.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { BottomSheet, Dialog } from '../../../src/ui/components/Modal';
import { Button } from '../../../src/ui/components/Button';
import { pushBackHandler, runTopBackHandler } from '../../../src/ui/shell/backStack';
afterEach(cleanup);

function Harness({ sheet = false, onClose }: { sheet?: boolean; onClose?(): void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      {sheet ? (
        <BottomSheet open={open} title="13화" onClose={close}>
          <button type="button">제목 번역하기</button>
        </BottomSheet>
      ) : (
        <Dialog
          open={open}
          title="작품 B를 서재에서 제거할까요?"
          onClose={close}
          actions={
            <>
              <Button variant="text" onClick={close}>
                닫기
              </Button>
              <Button variant="text" tone="danger">
                제거하기
              </Button>
            </>
          }
        >
          <p>삭제한 내용은 되돌릴 수 없어요.</p>
        </Dialog>
      )}
    </>
  );
}

describe('backStack', () => {
  it('runs the most recent handler first and unregisters', () => {
    const calls: string[] = [];
    const removeA = pushBackHandler(() => calls.push('a'));
    const removeB = pushBackHandler(() => calls.push('b'));
    expect(runTopBackHandler()).toBe(true);
    removeB();
    expect(runTopBackHandler()).toBe(true);
    removeA();
    expect(runTopBackHandler()).toBe(false);
    expect(calls).toEqual(['b', 'a']);
  });
});

describe.each([false, true])('modal surface (sheet=%s)', (sheet) => {
  const title = sheet ? '13화' : '작품 B를 서재에서 제거할까요?';
  it('opens labelled by its title, focuses the title and restores focus on close', () => {
    render(<Harness sheet={sheet} />);
    const opener = screen.getByRole('button', { name: '열기' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: title })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
  it('closes from the system back handler while open', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    expect(runTopBackHandler()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runTopBackHandler()).toBe(false);
  });
  it('closes when the scrim (the dialog element itself) is clicked', () => {
    render(<Harness sheet={sheet} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    fireEvent.click(screen.getByRole('dialog', { name: title }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

it('full-screen dialog has a close icon and a confirm action', () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <Dialog
      open
      title="용어집 편집하기"
      onClose={onClose}
      fullScreen={{ confirmLabel: '저장하기', onConfirm }}
    >
      <p>본문</p>
    </Dialog>,
  );
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/modal.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 레지스트리 구현**

`src/ui/shell/backStack.ts`:

```ts
import { useEffect, useRef } from 'react';

// 시스템 뒤로 가기를 받을 오버레이(메뉴·시트·대화상자·리더 바)를 LIFO로 쌓는다.
const handlers: (() => void)[] = [];

export function pushBackHandler(handler: () => void): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function runTopBackHandler(): boolean {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function useBackHandler(active: boolean, handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => (active ? pushBackHandler(() => latest.current()) : undefined), [active]);
}
```

- [ ] **Step 4: Modal 구현**

`src/ui/components/Modal.tsx`:

```tsx
import { useId, useLayoutEffect, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import { useBackHandler } from '../shell/backStack';
import { Button } from './Button';
import { IconButton } from './IconButton';
import './components.css';

interface SurfaceProps {
  open: boolean;
  title: string;
  onClose(): void;
  className: string;
  children: ReactNode;
  header?(titleId: string, titleRef: RefObject<HTMLHeadingElement | null>): ReactNode;
}

function ModalSurface({ open, title, onClose, className, children, header }: SurfaceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useBackHandler(open, onClose);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 실제 WebView는 showModal로 최상위 레이어·배경 비활성을 얻는다. jsdom에는 없어서 open 속성으로 대체한다.
    if (typeof element.showModal === 'function') {
      if (!element.open) element.showModal();
    } else element.setAttribute('open', '');
    titleRef.current?.focus();
    return () => {
      if (typeof element.close === 'function' && element.open) element.close();
      else element.removeAttribute('open');
      opener?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className={`nr-modal ${className}`}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="nr-modal__surface">
        {header ? (
          header(titleId, titleRef)
        ) : (
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="nr-modal__title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </dialog>
  );
}

export interface DialogProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  actions?: ReactNode;
  fullScreen?: { confirmLabel: string; onConfirm(): void; confirmDisabled?: boolean };
}
export function Dialog({ open, title, onClose, children, actions, fullScreen }: DialogProps): JSX.Element | null {
  if (fullScreen)
    return (
      <ModalSurface
        open={open}
        title={title}
        onClose={onClose}
        className="nr-dialog nr-dialog--fullscreen"
        header={(titleId, titleRef) => (
          <div className="nr-dialog__header">
            <IconButton icon="close" label="닫기" onClick={onClose} />
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="nr-modal__title">
              {title}
            </h2>
            <Button
              variant="text"
              disabled={fullScreen.confirmDisabled}
              onClick={fullScreen.onConfirm}
            >
              {fullScreen.confirmLabel}
            </Button>
          </div>
        )}
      >
        <div className="nr-dialog__body">{children}</div>
      </ModalSurface>
    );
  return (
    <ModalSurface open={open} title={title} onClose={onClose} className="nr-dialog">
      <div className="nr-dialog__body">{children}</div>
      {actions && <div className="nr-dialog__actions">{actions}</div>}
    </ModalSurface>
  );
}

export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}): JSX.Element | null {
  return (
    <ModalSurface open={open} title={title} onClose={onClose} className="nr-sheet">
      <span className="nr-sheet__handle" aria-hidden="true" />
      {children}
    </ModalSurface>
  );
}
```

BottomSheet의 손잡이(`nr-sheet__handle`)는 마크업상 제목 뒤에 오지만, CSS(`.nr-sheet .nr-modal__surface`의 `flex-direction: column`과 `.nr-sheet__handle { order: -1; }`, Step 5)가 제목 위에 보이게 한다.

- [ ] **Step 5: 스타일 추가**

`src/ui/components/components.css` 끝에 추가:

```css
/* Dialog · BottomSheet */
.nr-modal {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--on-surface);
  max-inline-size: none;
  max-block-size: none;
  overflow: visible;
}
.nr-modal::backdrop {
  background: var(--scrim);
}
.nr-modal__title {
  margin: 0 0 16px;
  font: var(--type-headline-small);
  text-wrap: balance;
}
.nr-modal__title:focus {
  outline: none;
}
.nr-dialog {
  position: fixed;
  inset: 0;
  margin: auto;
  inline-size: min(560px, calc(100vw - 48px));
  block-size: fit-content;
}
.nr-dialog .nr-modal__surface {
  box-sizing: border-box;
  max-block-size: calc(100dvh - 48px - var(--inset-top) - var(--inset-bottom));
  overflow: auto;
  padding: 24px;
  border-radius: var(--shape-xl);
  background: var(--surface-container-high);
}
.nr-dialog__body {
  color: var(--on-surface-variant);
  font: var(--type-body-medium);
}
.nr-dialog__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}
.nr-dialog--fullscreen {
  inset: 0;
  margin: 0;
  inline-size: 100vw;
  block-size: 100dvh;
}
.nr-dialog--fullscreen .nr-modal__surface {
  display: flex;
  flex-direction: column;
  block-size: 100%;
  max-block-size: none;
  padding: 0;
  border-radius: 0;
  background: var(--surface);
}
.nr-dialog__header {
  display: flex;
  align-items: center;
  gap: 4px;
  min-block-size: calc(var(--app-bar) + var(--inset-top));
  padding: var(--inset-top) max(4px, var(--inset-right)) 0 max(4px, var(--inset-left));
  box-sizing: border-box;
}
.nr-dialog__header .nr-modal__title {
  flex: 1;
  margin: 0;
  font: var(--type-title-large);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nr-dialog--fullscreen .nr-dialog__body {
  flex: 1;
  overflow: auto;
  padding: 0 max(24px, var(--inset-right)) calc(24px + var(--inset-bottom)) max(24px, var(--inset-left));
  color: var(--on-surface);
  font: var(--type-body-large);
}
.nr-sheet {
  position: fixed;
  inset: auto 0 0 0;
  margin: 0 auto;
  inline-size: min(640px, 100vw);
}
.nr-sheet .nr-modal__surface {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-block-size: 90dvh;
  overflow: auto;
  padding: 0 0 calc(16px + var(--inset-bottom));
  border-radius: var(--shape-xl) var(--shape-xl) 0 0;
  background: var(--surface-container-low);
}
.nr-sheet__handle {
  order: -1;
  display: block;
  inline-size: 32px;
  block-size: 4px;
  margin: 16px auto 8px;
  border-radius: var(--shape-full);
  background: var(--outline);
}
.nr-sheet .nr-modal__title {
  margin: 8px 24px;
  font: var(--type-title-medium);
}
@media (prefers-reduced-motion: no-preference) {
  .nr-dialog[open] .nr-modal__surface {
    animation: nr-dialog-in var(--duration-enter) var(--ease-standard);
  }
  .nr-sheet[open] .nr-modal__surface {
    animation: nr-sheet-in var(--duration-enter) var(--ease-spring);
  }
}
@keyframes nr-dialog-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@keyframes nr-sheet-in {
  from {
    transform: translateY(100%);
  }
}
```

- [ ] **Step 6: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/modal.test.tsx && npm run typecheck && npm run lint`
Expected: PASS. `react-hooks` 린트가 `useBackHandler`의 ref 갱신을 지적하면 `useLayoutEffect`로 바꾼다(동작은 같다).

- [ ] **Step 7: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/shell/backStack.ts src/ui/components/Modal.tsx src/ui/components/components.css tests/ui/components/modal.test.tsx \
 && git commit -m "feat: 뒤로 가기 레지스트리와 대화상자·바텀시트 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Menu

**Files:**
- Create: `src/ui/components/Menu.tsx`
- Modify: `src/ui/components/components.css`
- Test: `tests/ui/components/menu.test.tsx`

**Interfaces:**
- Consumes: `IconButton`, `Icon`, `useBackHandler`
- Produces: `Menu({ label, items, icon? }: { label: string; items: readonly MenuItem[]; icon?: IconName })`; `interface MenuItem { label: string; onSelect(): void; tone?: 'danger'; icon?: IconName }`. 트리거는 `aria-label={label}`인 아이콘 버튼(기본 아이콘 `more_vert`).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/components/menu.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '../../../src/ui/components/Menu';
import { runTopBackHandler } from '../../../src/ui/shell/backStack';
afterEach(cleanup);

function setup() {
  const home = vi.fn();
  const remove = vi.fn();
  render(
    <>
      <Menu
        label="더보기"
        items={[
          { label: '서재로 가기', onSelect: home },
          { label: '서재에서 제거하기', onSelect: remove, tone: 'danger' },
        ]}
      />
      <p>바깥</p>
    </>,
  );
  return { home, remove, trigger: screen.getByRole('button', { name: '더보기' }) };
}

it('opens a labelled menu, focuses the first item and selects with click', () => {
  const { home, trigger } = setup();
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: '더보기' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toHaveFocus();
  fireEvent.click(screen.getByRole('menuitem', { name: '서재로 가기' }));
  expect(home).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('moves with arrow keys and closes with Escape back to the trigger', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: '서재에서 제거하기' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(screen.getByRole('menuitem', { name: '서재에서 제거하기' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('closes on an outside pointer and on the system back handler', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByText('바깥'));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  expect(runTopBackHandler()).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('marks destructive items', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  expect(screen.getByRole('menuitem', { name: '서재에서 제거하기' })).toHaveClass(
    'nr-menu__item--danger',
  );
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/menu.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/ui/components/Menu.tsx`:

```tsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { useBackHandler } from '../shell/backStack';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import './components.css';

export interface MenuItem {
  label: string;
  onSelect(): void;
  tone?: 'danger';
  icon?: IconName;
}

export function Menu({
  label,
  items,
  icon = 'more_vert',
}: {
  label: string;
  items: readonly MenuItem[];
  icon?: IconName;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useBackHandler(open, () => close());
  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const rect = list.current.getBoundingClientRect();
    setUpward(rect.bottom > window.innerHeight && rect.top > rect.height);
    list.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, close]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = [
      ...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close(false);
  }
  return (
    <div className="nr-menu-anchor">
      <IconButton
        ref={trigger}
        icon={icon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={`nr-menu${upward ? ' nr-menu--up' : ''}`}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`nr-menu__item${item.tone ? ` nr-menu__item--${item.tone}` : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={20} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 스타일 추가**

`src/ui/components/components.css` 끝에 추가:

```css
/* Menu */
.nr-menu-anchor {
  position: relative;
  display: inline-flex;
}
.nr-menu {
  position: absolute;
  z-index: 30;
  inset-block-start: 100%;
  inset-inline-end: 4px;
  min-inline-size: 12rem;
  max-inline-size: min(17.5rem, calc(100vw - 16px));
  padding: 8px 0;
  border-radius: var(--shape-sm);
  background: var(--surface-container);
  color: var(--on-surface);
  box-shadow: var(--elevation-2);
}
.nr-menu--up {
  inset-block-start: auto;
  inset-block-end: 100%;
}
.nr-menu__item {
  display: flex;
  align-items: center;
  gap: 12px;
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: var(--touch-target);
  padding: 0 16px;
  border: 0;
  background: transparent;
  color: inherit;
  font: var(--type-body-large);
  text-align: start;
  cursor: pointer;
}
.nr-menu__item .nr-icon {
  color: var(--on-surface-variant);
}
.nr-menu__item--danger,
.nr-menu__item--danger .nr-icon {
  color: var(--error);
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/menu.test.tsx && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/components/Menu.tsx src/ui/components/components.css tests/ui/components/menu.test.tsx \
 && git commit -m "feat: 키보드·뒤로 가기를 지원하는 메뉴 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 7: TopAppBar·ExtendedFab·FloatingToolbar·Switch·LinearProgress·StatusPill·Snackbar

**Files:**
- Create: `src/ui/components/TopAppBar.tsx`, `ExtendedFab.tsx`, `FloatingToolbar.tsx`, `Switch.tsx`, `LinearProgress.tsx`, `StatusPill.tsx`, `Snackbar.tsx`
- Modify: `src/ui/components/components.css`
- Test: `tests/ui/components/chrome.test.tsx`

**Interfaces:**
- Produces:
  - `TopAppBar({ title, titleAs?: 'h1'|'span', navigation?: ReactNode, actions?: ReactNode })` — 루트 `<header class="nr-top-app-bar" data-scrolled>`.
  - `ExtendedFab({ icon, label, onClick, collapsed? })`
  - `FloatingToolbar({ label, children, hidden? })` — `role="toolbar"`, 좌우 화살표 이동, `hidden`이면 `inert`·`aria-hidden` 처리.
  - `Switch({ label, description?, checked, onChange(checked: boolean) })`
  - `LinearProgress({ label, value? })` — `value`는 0~1, 없으면 비결정형.
  - `StatusPill({ icon?, children, action? })` — `role="status"`, `action?: { label: string; onClick(): void }`.
  - `SnackbarProvider({ children })`, `useSnackbar(): (text: string, action?: { label: string; onAction(): void }) => void`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/components/chrome.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TopAppBar } from '../../../src/ui/components/TopAppBar';
import { IconButton } from '../../../src/ui/components/IconButton';
import { ExtendedFab } from '../../../src/ui/components/ExtendedFab';
import { FloatingToolbar } from '../../../src/ui/components/FloatingToolbar';
import { Switch } from '../../../src/ui/components/Switch';
import { LinearProgress } from '../../../src/ui/components/LinearProgress';
import { StatusPill } from '../../../src/ui/components/StatusPill';
import { SnackbarProvider, useSnackbar } from '../../../src/ui/components/Snackbar';
afterEach(cleanup);

describe('TopAppBar', () => {
  it('renders a heading title by default and plain text on request', () => {
    const { rerender } = render(<TopAppBar title="서재" />);
    expect(screen.getByRole('heading', { level: 1, name: '서재' })).toBeVisible();
    rerender(
      <TopAppBar
        title="목차"
        titleAs="span"
        navigation={<IconButton icon="arrow_back" label="뒤로 가기" />}
      />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('banner')).toHaveTextContent('목차');
    expect(screen.getByRole('button', { name: '뒤로 가기' })).toBeVisible();
  });
});

describe('ExtendedFab', () => {
  it('keeps its label as the accessible name when collapsed', () => {
    const onClick = vi.fn();
    const { rerender } = render(<ExtendedFab icon="check" label="작품 찾기" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: '작품 찾기' }));
    rerender(<ExtendedFab icon="check" label="작품 찾기" onClick={onClick} collapsed />);
    expect(screen.getByRole('button', { name: '작품 찾기' })).toHaveClass('nr-fab--collapsed');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('FloatingToolbar', () => {
  it('moves focus between its buttons with arrow keys and can be hidden', () => {
    const { rerender } = render(
      <FloatingToolbar label="읽기 도구">
        <IconButton icon="arrow_back" label="이전 화" />
        <IconButton icon="more_vert" label="목차" />
      </FloatingToolbar>,
    );
    const toolbar = screen.getByRole('toolbar', { name: '읽기 도구' });
    screen.getByRole('button', { name: '이전 화' }).focus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '목차' })).toHaveFocus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '이전 화' })).toHaveFocus();
    rerender(
      <FloatingToolbar label="읽기 도구" hidden>
        <IconButton icon="arrow_back" label="이전 화" />
      </FloatingToolbar>,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.querySelector('.nr-toolbar')).toHaveAttribute('inert');
  });
});

describe('Switch', () => {
  it('is a labelled switch with a description', () => {
    const onChange = vi.fn();
    render(
      <Switch
        label="저장본이 없으면 자동으로 번역 시작"
        description="끄면 직접 시작해요."
        checked={false}
        onChange={onChange}
      />,
    );
    const control = screen.getByRole('switch', { name: '저장본이 없으면 자동으로 번역 시작' });
    expect(control).toHaveAccessibleDescription('끄면 직접 시작해요.');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('LinearProgress and StatusPill', () => {
  it('reports determinate progress and status with an action', () => {
    const onClick = vi.fn();
    render(
      <>
        <LinearProgress label="번역 진행" value={0.375} />
        <LinearProgress label="준비" />
        <StatusPill action={{ label: '중단', onClick }}>번역하는 중 · 3/8묶음</StatusPill>
      </>,
    );
    expect(screen.getByRole('progressbar', { name: '번역 진행' })).toHaveAttribute(
      'aria-valuenow',
      '38',
    );
    expect(screen.getByRole('progressbar', { name: '준비' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('status')).toHaveTextContent('번역하는 중 · 3/8묶음');
    fireEvent.click(screen.getByRole('button', { name: '중단' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Snackbar', () => {
  it('shows queued messages one at a time in a live region without a status role', () => {
    vi.useFakeTimers();
    let show: ReturnType<typeof useSnackbar> = () => {};
    function Probe() {
      show = useSnackbar();
      return null;
    }
    render(
      <SnackbarProvider>
        <Probe />
      </SnackbarProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    const undo = vi.fn();
    act(() => {
      show('서재에서 제거했어요');
      show('제목을 저장했어요', { label: '보기', onAction: undo });
    });
    expect(screen.getByText('서재에서 제거했어요')).toBeVisible();
    expect(screen.queryByText('제목을 저장했어요')).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('제목을 저장했어요')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('제목을 저장했어요')).toBeNull();
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components/chrome.test.tsx`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/ui/components/TopAppBar.tsx`:

```tsx
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import './components.css';

export function TopAppBar({
  title,
  titleAs = 'h1',
  navigation,
  actions,
}: {
  title: string;
  titleAs?: 'h1' | 'span';
  navigation?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const Title = titleAs;
  return (
    <header className="nr-top-app-bar" data-scrolled={scrolled}>
      {navigation && <span className="nr-top-app-bar__navigation">{navigation}</span>}
      <Title className="nr-top-app-bar__title">{title}</Title>
      {actions && <span className="nr-top-app-bar__actions">{actions}</span>}
    </header>
  );
}
```

`src/ui/components/ExtendedFab.tsx`:

```tsx
import type { JSX } from 'react';
import { Icon, type IconName } from './Icon';

export function ExtendedFab({
  icon,
  label,
  onClick,
  collapsed = false,
}: {
  icon: IconName;
  label: string;
  onClick(): void;
  collapsed?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`nr-fab${collapsed ? ' nr-fab--collapsed' : ''}`}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
    >
      <Icon name={icon} />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}
```

`src/ui/components/FloatingToolbar.tsx`:

```tsx
import type { JSX, KeyboardEvent, ReactNode } from 'react';

export function FloatingToolbar({
  label,
  children,
  hidden = false,
}: {
  label: string;
  children: ReactNode;
  hidden?: boolean;
}): JSX.Element {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    event.preventDefault();
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  }
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={`nr-toolbar${hidden ? ' nr-toolbar--hidden' : ''}`}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
```

(React 19는 `inert` 불리언 속성을 지원한다. 타입 오류가 나면 `{...(hidden ? { inert: true } : {})}`로 바꾼다.)

`src/ui/components/Switch.tsx`:

```tsx
import { useId, type JSX } from 'react';

export function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  const id = useId();
  // 설명은 label 밖에 둔다. label 안에 있으면 접근성 이름에 설명이 섞인다.
  return (
    <div className="nr-switch-row">
      <span className="nr-switch-row__text">
        <label htmlFor={id} className="nr-switch-row__label">
          {label}
        </label>
        {description && (
          <span id={`${id}-description`} className="nr-switch-row__description">
            {description}
          </span>
        )}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="nr-switch"
        checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}
```

`src/ui/components/LinearProgress.tsx`:

```tsx
import type { CSSProperties, JSX } from 'react';

export function LinearProgress({ label, value }: { label: string; value?: number }): JSX.Element {
  const determinate = typeof value === 'number';
  const clamped = determinate ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(clamped * 100) : undefined}
      className={`nr-progress${determinate ? '' : ' nr-progress--indeterminate'}`}
      style={{ '--nr-progress': clamped } as CSSProperties}
    >
      <span className="nr-progress__bar" />
    </div>
  );
}
```

`src/ui/components/StatusPill.tsx`:

```tsx
import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function StatusPill({
  icon,
  children,
  action,
}: {
  icon?: IconName;
  children: ReactNode;
  action?: { label: string; onClick(): void };
}): JSX.Element {
  return (
    <div className="nr-status-pill">
      <span role="status" className="nr-status-pill__text">
        {icon && <Icon name={icon} size={18} />}
        {children}
      </span>
      {action && (
        <button type="button" className="nr-status-pill__action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
```

`src/ui/components/Snackbar.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

type SnackbarAction = { label: string; onAction(): void };
type Message = { id: number; text: string; action?: SnackbarAction };
type Show = (text: string, action?: SnackbarAction) => void;
const SnackbarContext = createContext<Show>(() => {});

export function SnackbarProvider({ children }: { children: ReactNode }): JSX.Element {
  const [queue, setQueue] = useState<Message[]>([]);
  const next = useRef(0);
  const show = useCallback<Show>((text, action) => {
    next.current += 1;
    const id = next.current;
    setQueue((current) => [...current, { id, text, ...(action ? { action } : {}) }]);
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(
      () => setQueue((items) => items.slice(1)),
      current.action ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [current]);
  return (
    <SnackbarContext.Provider value={show}>
      {children}
      {/* 역할 없는 live 영역: 화면의 role="status" 질의와 겹치지 않는다. */}
      <div className="nr-snackbar-region" aria-live="polite" aria-atomic="true">
        {current && (
          <div className="nr-snackbar" key={current.id}>
            <span className="nr-snackbar__text">{current.text}</span>
            {current.action && (
              <button
                type="button"
                className="nr-snackbar__action"
                onClick={() => {
                  current.action!.onAction();
                  setQueue((items) => items.slice(1));
                }}
              >
                {current.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): Show {
  return useContext(SnackbarContext);
}
```

모든 새 파일 맨 위에 다른 컴포넌트처럼 `import './components.css';`가 필요하지 않다(`Icon`·`TopAppBar`·`Modal`·`Menu`가 이미 불러온다). 단, `Switch`·`LinearProgress`·`Snackbar`·`FloatingToolbar`가 단독으로 쓰일 수 있으므로 이 네 파일에도 `import './components.css';`를 추가한다.

- [ ] **Step 4: 스타일 추가**

`src/ui/components/components.css` 끝에 추가:

```css
/* TopAppBar */
.nr-top-app-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  min-block-size: calc(var(--app-bar) + var(--inset-top));
  padding: var(--inset-top) max(4px, var(--inset-right)) 0 max(4px, var(--inset-left));
  background: var(--surface);
  color: var(--on-surface);
}
.nr-top-app-bar[data-scrolled='true'] {
  background: var(--surface-container);
}
.nr-top-app-bar__title {
  flex: 1;
  min-inline-size: 0;
  margin: 0 0 0 12px;
  font: var(--type-title-large);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nr-top-app-bar__navigation + .nr-top-app-bar__title {
  margin-inline-start: 0;
}
.nr-top-app-bar__navigation,
.nr-top-app-bar__actions {
  display: flex;
  align-items: center;
}

/* ExtendedFab */
.nr-fab {
  position: fixed;
  z-index: 20;
  inset-inline-end: max(16px, calc(16px + var(--inset-right)));
  inset-block-end: calc(16px + var(--inset-bottom));
  display: inline-flex;
  align-items: center;
  gap: 12px;
  block-size: var(--fab);
  min-inline-size: var(--fab);
  padding: 0 20px 0 16px;
  border: 0;
  border-radius: var(--shape-lg);
  background: var(--primary-fill);
  color: var(--on-primary);
  font: var(--type-label-large);
  box-shadow: var(--elevation-3);
  cursor: pointer;
}
.nr-fab--collapsed {
  justify-content: center;
  inline-size: var(--fab);
  padding: 0;
}

/* FloatingToolbar */
.nr-toolbar {
  position: fixed;
  z-index: 20;
  inset-inline: 0;
  inset-block-end: calc(16px + var(--inset-bottom));
  display: flex;
  justify-content: center;
  gap: 4px;
  inline-size: fit-content;
  margin: 0 auto;
  padding: 8px;
  border-radius: var(--shape-full);
  background: var(--primary-container);
  color: var(--on-primary-container);
  box-shadow: var(--elevation-3);
  transition:
    transform var(--duration-enter) var(--ease-standard),
    opacity var(--duration-enter) var(--ease-standard);
}
.nr-toolbar .nr-icon-button {
  color: inherit;
}
.nr-toolbar--hidden {
  opacity: 0;
  transform: translateY(calc(100% + 16px + var(--inset-bottom)));
  pointer-events: none;
}

/* Switch */
.nr-switch-row {
  display: flex;
  align-items: center;
  gap: 16px;
  min-block-size: var(--list-one-line);
  padding: 8px 16px;
}
.nr-switch-row__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-inline-size: 0;
}
.nr-switch-row__label {
  font: var(--type-body-large);
}
.nr-switch-row__description {
  color: var(--on-surface-variant);
  font: var(--type-body-medium);
}
.nr-switch {
  appearance: none;
  position: relative;
  flex: none;
  inline-size: 52px;
  block-size: 32px;
  margin: 8px 0;
  border-radius: var(--shape-full);
  background: var(--surface-container-highest);
  box-shadow: inset 0 0 0 2px var(--outline);
  cursor: pointer;
}
.nr-switch::before {
  content: '';
  position: absolute;
  inset-block-start: 8px;
  inset-inline-start: 8px;
  inline-size: 16px;
  block-size: 16px;
  border-radius: 50%;
  background: var(--outline);
  transition: transform var(--duration-short) var(--ease-standard);
}
.nr-switch:checked {
  background: var(--primary-fill);
  box-shadow: none;
}
.nr-switch:checked::before {
  background: var(--on-primary);
  transform: translateX(20px) scale(1.5);
}

/* LinearProgress */
.nr-progress {
  position: relative;
  overflow: hidden;
  block-size: 4px;
  border-radius: var(--shape-full);
  background: var(--primary-container);
}
.nr-progress__bar {
  position: absolute;
  inset-block: 0;
  inset-inline-start: 0;
  inline-size: 100%;
  border-radius: inherit;
  background: var(--primary-fill);
  transform: scaleX(var(--nr-progress, 0));
  transform-origin: left center;
  transition: transform var(--duration-short) var(--ease-standard);
}
.nr-progress--indeterminate .nr-progress__bar {
  inline-size: 40%;
  transform: none;
  animation: nr-progress 1.6s var(--ease-standard) infinite;
}
@keyframes nr-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

/* StatusPill */
.nr-status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  min-block-size: 48px;
  padding: 4px 8px 4px 16px;
  border-radius: var(--shape-full);
  background: var(--primary-container);
  color: var(--on-primary-container);
  font: var(--type-label-large);
  box-shadow: var(--elevation-2);
}
.nr-status-pill__text {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
}
.nr-status-pill__action {
  min-block-size: var(--touch-target);
  padding: 0 12px;
  border: 0;
  border-radius: var(--shape-full);
  background: transparent;
  color: inherit;
  font: var(--type-label-large);
  text-decoration: underline;
  cursor: pointer;
}

/* Snackbar */
.nr-snackbar-region {
  position: fixed;
  z-index: 40;
  inset-inline: 0;
  inset-block-end: calc(16px + var(--inset-bottom) + var(--nr-snackbar-offset, 0px));
  display: flex;
  justify-content: center;
  padding: 0 16px;
  pointer-events: none;
}
.nr-snackbar {
  display: flex;
  align-items: center;
  gap: 8px;
  max-inline-size: min(560px, 100%);
  min-block-size: 48px;
  padding: 4px 8px 4px 16px;
  border-radius: var(--shape-xs);
  background: var(--inverse-surface);
  color: var(--inverse-on-surface);
  font: var(--type-body-medium);
  box-shadow: var(--elevation-3);
  pointer-events: auto;
}
.nr-snackbar__text {
  flex: 1;
}
.nr-snackbar__action {
  min-block-size: var(--touch-target);
  padding: 0 12px;
  border: 0;
  border-radius: var(--shape-full);
  background: transparent;
  color: var(--inverse-primary);
  font: var(--type-label-large);
  cursor: pointer;
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/components && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/components tests/ui/components/chrome.test.tsx \
 && git commit -m "feat: 앱바·FAB·플로팅 툴바·스위치·진행 표시·스낵바 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 백스택 규칙(회차 간 교체·목차 복귀·서재로 가기)

**Files:**
- Modify: `src/app/renewalController.ts` (`navigate`, `showContents`, 새 `goHome`·`canGoBack`, 인터페이스·반환 객체)
- Modify: `tests/ui/renewal-flow.test.tsx:585-597` (기대 동작 변경)
- Test: `tests/integration/navigation-stack.test.ts`(신규)

**Interfaces:**
- Produces (`RenewalController`): `goHome(): void`, `canGoBack(): boolean`
- 규칙: 현재 라우트와 새 라우트가 둘 다 `translation`·`reader`이면 `navigate`는 히스토리에 넣지 않는다. `showContents()`는 히스토리 맨 위가 같은 작품의 `work`면 그 항목의 `selectedChapterId`를 현재 회차로 바꾸고 `back()`한다. `goHome()`은 `home`으로 이동하고 히스토리를 비운다. `canGoBack()`은 히스토리 길이가 0보다 크면 `true`.

- [ ] **Step 1: 실패하는 테스트 작성**

`renewal-flow.test.tsx`의 `fixture()`·`page`·`saved`·`chapters`는 export되지 않으므로, 새 테스트는 최소 의존성으로 직접 만든다.

`tests/integration/navigation-stack.test.ts`:

```ts
import { expect, it, vi } from 'vitest';
import { createRenewalController } from '../../src/app/renewalController';
import type { CompletedTranslation, WorkPage } from '../../src/contracts/reading';

const chapters = [1, 2, 3].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
}));
const page: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters,
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};
function version(index: number): CompletedTranslation {
  const chapter = chapters[index]!;
  return {
    schemaVersion: 2,
    versionId: `saved-${index + 1}`,
    source: {
      ...chapter,
      sourceHash: `hash-${index}`,
      paragraphs: [{ id: `source-${index}`, text: '原文', ruby: [] }],
      prevUrl: null,
      nextUrl: null,
      captureKind: 'fetched',
      fetchedAt: '2026-10-04T00:00:00Z',
      rawHtml: '<p>原文</p>',
    },
    text: '저장된 한국어 본문',
    blocks: [{ id: `translated-${index}`, text: '저장된 한국어 본문' }],
    createdAt: '2026-10-04T00:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'connection',
      modelId: 'fixture',
      promptVersion: 'fixture',
    },
  } as CompletedTranslation;
}
const versions = chapters.map((_, index) => version(index));

function controller() {
  const app = createRenewalController({
    library: {
      saveWorkPage: vi.fn(async () => {}),
      readWork: vi.fn(async () => [page]),
      listRecent: vi.fn(async () => []),
      listVersions: vi.fn(async (chapterId: string) =>
        versions.filter((value) => value.source.chapterId === chapterId),
      ),
      readVersion: vi.fn(async (id: string) => versions.find((v) => v.versionId === id) ?? null),
      commitVersion: vi.fn(async () => {}),
      savePosition: vi.fn(async () => {}),
      readPosition: vi.fn(async () => null),
    } as never,
    source: { getWorkPage: async () => page, getChapter: async () => versions[0]!.source } as never,
  });
  app.changeAutoTranslate(false);
  return app;
}

it('moving between chapters replaces the top entry so back returns to the contents', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[0]!);
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.adjacentChapter(1);
  await vi.waitFor(() =>
    expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-2' }),
  );
  app.adjacentChapter(1);
  await vi.waitFor(() =>
    expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-3' }),
  );
  app.back();
  expect(app.getSnapshot().route.kind).toBe('work');
  app.back();
  expect(app.getSnapshot().route.kind).toBe('home');
  expect(app.canGoBack()).toBe(false);
  app.dispose();
});

it('contents returns to the existing contents entry instead of stacking another one', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[1]!);
  app.showContents();
  expect(app.getSnapshot().route).toEqual({
    kind: 'work',
    workId: 'n1234ab',
    selectedChapterId: 'n1234ab/2',
  });
  app.back();
  expect(app.getSnapshot().route.kind).toBe('home');
  app.dispose();
});

it('contents pushes a contents entry when the reader was opened from home', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  app.navigate({ kind: 'home' });
  await app.selectChapter(chapters[0]!);
  app.showContents();
  expect(app.getSnapshot().route.kind).toBe('work');
  app.back();
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.dispose();
});

it('goHome clears the stack', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[0]!);
  expect(app.canGoBack()).toBe(true);
  app.goHome();
  expect(app.getSnapshot().route).toEqual({ kind: 'home' });
  expect(app.canGoBack()).toBe(false);
  app.dispose();
});

it('settings opened from a chapter returns to that chapter', async () => {
  const app = controller();
  await app.openWork(page.canonicalUrl);
  await app.selectChapter(chapters[0]!);
  app.navigate({ kind: 'settings' });
  app.back();
  expect(app.getSnapshot().route).toEqual({ kind: 'reader', versionId: 'saved-1' });
  app.dispose();
});
```

`CompletedTranslation`·`WorkPage` 필드가 실제 타입과 다르면 `tests/ui/renewal-flow.test.tsx`의 `saved`·`page` 정의(약 22~62행)를 기준으로 맞춘다. `as never`로 의존성 타입을 넘기는 부분은 실제 `RenewalDependencies` 형태에 맞춰 줄일 수 있으면 줄인다.

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/integration/navigation-stack.test.ts`
Expected: FAIL (`canGoBack`·`goHome` 없음, 첫 테스트의 두 번째 `back()`이 회차로 돌아감)

- [ ] **Step 3: 컨트롤러 구현**

`src/app/renewalController.ts`:

1. `RenewalController` 인터페이스의 `back(): void;` 아래에 추가:
```ts
  goHome(): void;
  canGoBack(): boolean;
```

2. `function navigate(route: Route): void {` 바로 위에 추가:
```ts
  const chapterLevel = (route: Route) => route.kind === 'translation' || route.kind === 'reader';
```

3. `navigate` 안의 `history.push(snapshot.route);`를 아래로 바꾼다:
```ts
    // 회차끼리의 이동(번역→리더, 이전·다음 화)은 쌓지 않는다. 뒤로 가기 한 번이면 회차에 들어오기 전 화면으로 간다.
    if (!(chapterLevel(snapshot.route) && chapterLevel(route))) history.push(snapshot.route);
```

4. `showContents`를 아래로 바꾼다:
```ts
  function showContents(): void {
    if (!snapshot.work) return;
    const workId = snapshot.work.workId;
    const selected = snapshot.chapter ? { selectedChapterId: snapshot.chapter.chapterId } : {};
    const previous = history[history.length - 1];
    if (previous?.kind === 'work' && previous.workId === workId) {
      // 이미 쌓인 같은 작품 목차로 돌아간다. 목차-리더 왕복으로 스택이 자라지 않게 한다.
      history[history.length - 1] = { kind: 'work', workId, ...selected };
      back();
      return;
    }
    navigate({ kind: 'work', workId, ...selected });
    requestTitleTranslation();
  }
```

5. `back` 함수 아래에 추가:
```ts
  function goHome(): void {
    navigate({ kind: 'home' });
    history.length = 0;
  }
  function canGoBack(): boolean {
    return history.length > 0;
  }
```

6. 반환 객체의 `back,` 아래에 `goHome,`와 `canGoBack,`를 추가한다.

- [ ] **Step 4: 새 테스트 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/integration/navigation-stack.test.ts`
Expected: PASS

- [ ] **Step 5: 기대 동작이 바뀐 기존 테스트 갱신**

`tests/ui/renewal-flow.test.tsx`의 `'next unsaved chapter enters a waiting screen without a model request'` 테스트(약 586~597행)에서 마지막 두 줄을 바꾼다. 승인된 설계(스펙 6.1)대로 다음 화에서 뒤로 가면 이전 화가 아니라 목차로 간다.

바꾸기 전:
```tsx
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByText('저장된 한국어 본문')).toBeVisible();
```
바꾼 뒤(이 시점의 셸 버튼 이름은 아직 `뒤로`다. Task 10에서 `뒤로 가기`로 일괄 변경한다):
```tsx
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));
    expect(screen.getByRole('heading', { name: page.title })).toBeVisible();
    expect(screen.queryByText('저장된 한국어 본문')).toBeNull();
```

- [ ] **Step 6: 관련 스위트 전체 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/renewal-flow.test.tsx tests/integration && npm run typecheck`
Expected: PASS. 다른 테스트가 실패하면, 그 테스트가 회차→회차 이동 뒤 `back()`으로 이전 회차를 기대하는지 확인한다. 그렇다면 같은 원칙으로 기대값을 "회차에 들어오기 전 화면"으로 바꾸고, 바꾼 테스트 이름과 이유를 커밋 본문에 적는다. 그 외 이유의 실패는 구현을 고친다(테스트를 약하게 만들지 않는다).

- [ ] **Step 7: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/app/renewalController.ts tests/integration/navigation-stack.test.ts tests/ui/renewal-flow.test.tsx \
 && git commit -m "feat: 회차 간 이동을 교체하는 백스택과 서재로 가기 (#92)" -m "다음 화로 넘어간 뒤 뒤로 가기는 목차로 돌아가도록 기존 테스트 기대값을 바꿨다." -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 테마 적용·플랫폼 어댑터·설정 화면 테마 선택

**Files:**
- Create: `src/ui/theme/theme.ts`, `src/platform/shell.ts`
- Modify: `src/ui/SettingsScreen.tsx` (테마 선택 절 추가), `src/app/Application.tsx`(설정 화면에 `onTheme` 전달만)
- Test: `tests/ui/theme.test.tsx`

**Interfaces:**
- Produces (`theme.ts`): `type ResolvedTheme = 'light' | 'dark'`, `resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme`, `useResolvedTheme(preference: ThemePreference): ResolvedTheme`
- Produces (`shell.ts`): `interface ShellPlatform { onBackButton(listener: () => void): () => void; exitApp(): void; setSystemBarsTheme(theme: ResolvedTheme): void }`, `capacitorShell: ShellPlatform`, `noopShell: ShellPlatform`
- Produces (`SettingsScreen` props): `onTheme?(theme: ThemePreference): void`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/ui/theme.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { resolveTheme } from '../../src/ui/theme/theme';
import { SettingsScreen } from '../../src/ui/SettingsScreen';
import { createRenewalController } from '../../src/app/renewalController';
afterEach(cleanup);

describe('resolveTheme', () => {
  it('follows the system only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('SettingsScreen theme section', () => {
  it('offers the three theme choices and reports the selection', () => {
    const state = createRenewalController().getSnapshot();
    const onTheme = vi.fn();
    render(
      <SettingsScreen
        state={state}
        onChange={() => {}}
        onCheck={async () => {}}
        onSelect={() => {}}
        onTheme={onTheme}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: '화면 테마' });
    expect(group).toBeVisible();
    expect(screen.getByRole('radio', { name: '시스템 설정 따르기' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: '다크' }));
    expect(onTheme).toHaveBeenCalledWith('dark');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/theme.test.tsx`
Expected: FAIL (모듈·라디오 그룹 없음)

- [ ] **Step 3: 테마 해석 구현**

`src/ui/theme/theme.ts`:

```ts
import { useSyncExternalStore } from 'react';
import type { ThemePreference } from '../../storage/settings';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

function query(): MediaQueryList | null {
  // jsdom과 일부 WebView에는 matchMedia가 없을 수 있다.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}
function subscribe(listener: () => void): () => void {
  const media = query();
  if (!media) return () => {};
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
}
const systemDark = () => query()?.matches ?? false;

export function useResolvedTheme(preference: ThemePreference): ResolvedTheme {
  return resolveTheme(preference, useSyncExternalStore(subscribe, systemDark, () => false));
}
```

- [ ] **Step 4: 플랫폼 어댑터 구현**

`src/platform/shell.ts`:

```ts
import { App } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import type { ResolvedTheme } from '../ui/theme/theme';

export interface ShellPlatform {
  onBackButton(listener: () => void): () => void;
  exitApp(): void;
  setSystemBarsTheme(theme: ResolvedTheme): void;
}

export const noopShell: ShellPlatform = {
  onBackButton: () => () => {},
  exitApp: () => {},
  setSystemBarsTheme: () => {},
};

export const capacitorShell: ShellPlatform = {
  onBackButton(listener) {
    if (!Capacitor.isNativePlatform()) return () => {};
    const handle = App.addListener('backButton', () => listener());
    return () => {
      void handle.then((value) => value.remove());
    };
  },
  exitApp() {
    if (Capacitor.isNativePlatform()) void App.exitApp();
  },
  setSystemBarsTheme(theme) {
    if (!Capacitor.isNativePlatform()) return;
    // Dark = 어두운 배경 위 밝은 아이콘.
    void SystemBars.setStyle({
      style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    }).catch(() => {});
  },
};
```

- [ ] **Step 5: 설정 화면에 테마 절 추가**

`src/ui/SettingsScreen.tsx`:
1. import에 `import type { ThemePreference } from '../storage/settings';` 추가.
2. `SettingsScreenProps`에 `onTheme?(theme: ThemePreference): void;` 추가, 함수 매개변수 구조 분해에 `onTheme` 추가.
3. `<h1>연결 설정</h1>` 바로 아래에 추가(기존 문구와 순서는 그대로 둔다):

```tsx
      {onTheme && (
        <fieldset className="nr-theme-choice">
          <legend id="nr-theme-legend">화면 테마</legend>
          <div role="radiogroup" aria-labelledby="nr-theme-legend">
            {(
              [
                ['system', '시스템 설정 따르기'],
                ['light', '라이트'],
                ['dark', '다크'],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="nr-theme"
                  value={value}
                  checked={state.theme === value}
                  onChange={() => onTheme(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
```

4. `src/app/Application.tsx`의 `<SettingsScreen ... />`에 `onTheme={controller.changeTheme}`를 추가한다.

- [ ] **Step 6: 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/theme.test.tsx tests/ui/renewal-flow.test.tsx && npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/ui/theme/theme.ts src/platform/shell.ts src/ui/SettingsScreen.tsx src/app/Application.tsx tests/ui/theme.test.tsx \
 && git commit -m "feat: 시스템 테마 해석과 화면 테마 선택 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 앱 셸(앱바·뒤로 가기·테마 적용·포커스·edge-to-edge)

**Files:**
- Modify: `src/app/Application.tsx` (셸 구조), `src/app/application.css` (전면 교체), `src/app/compose.ts` 또는 `src/app/bootstrap.tsx`(플랫폼 주입이 필요하면)
- Modify: `index.html`, `capacitor.config.ts`, `android/app/src/main/AndroidManifest.xml`
- Modify: `tests/ui/renewal-flow.test.tsx`, `tests/integration/renewal-first-slice.test.tsx` (셸 버튼 이름)
- Test: `tests/ui/shell.test.tsx`(신규)

**Interfaces:**
- Consumes: `TopAppBar`, `IconButton`, `Menu`, `Card`, `SnackbarProvider` (Task 4–7), `runTopBackHandler` (Task 5), `controller.goHome/canGoBack/back` (Task 8), `useResolvedTheme`, `ShellPlatform`, `capacitorShell` (Task 9)
- Produces: `Application({ controller, platform? }: { controller: RenewalController; platform?: ShellPlatform })` — `platform` 기본값 `capacitorShell`.

셸 앱바 규칙(스펙 6.1):
- `home`: `TopAppBar title="서재" titleAs="span"` + 액션 `IconButton icon="settings" label="설정"`.
- 그 외: 내비 `IconButton icon="arrow_back" label="뒤로 가기" onClick={controller.back}` + 제목(`work`→`목차`, `translation`·`reader`→`읽기`, `settings`→`설정`, `titleAs="span"`) + 액션 `Menu label="더보기"` 항목 `서재로 가기`(→`goHome`)와, `settings`가 아닐 때 `설정`(→`navigate({ kind: 'settings' })`).

- [ ] **Step 1: 실패하는 셸 테스트 작성**

`tests/ui/shell.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController } from '../../src/app/renewalController';
import type { ShellPlatform } from '../../src/platform/shell';
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
});

function platform() {
  let back: (() => void) | null = null;
  const value: ShellPlatform & { pressBack(): void } = {
    onBackButton: (listener) => {
      back = listener;
      return () => {
        back = null;
      };
    },
    exitApp: vi.fn(),
    setSystemBarsTheme: vi.fn(),
    pressBack: () => back?.(),
  };
  return value;
}

describe('application shell', () => {
  it('shows the library app bar with settings and applies the resolved theme', async () => {
    const shell = platform();
    const controller = createRenewalController();
    render(<Application controller={controller} platform={shell} />);
    expect(screen.getByRole('banner')).toHaveTextContent('서재');
    expect(screen.getByRole('button', { name: '설정' })).toBeVisible();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(shell.setSystemBarsTheme).toHaveBeenCalledWith('light');
    act(() => controller.changeTheme('dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(shell.setSystemBarsTheme).toHaveBeenLastCalledWith('dark');
    controller.dispose();
  });

  it('settings screen has back and the overflow menu, and system back returns', () => {
    const shell = platform();
    const controller = createRenewalController();
    render(<Application controller={controller} platform={shell} />);
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('banner')).toHaveTextContent('설정');
    expect(screen.getByRole('button', { name: '뒤로 가기' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '더보기' }));
    expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: '설정' })).toBeNull();
    act(() => shell.pressBack());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(controller.getSnapshot().route.kind).toBe('settings');
    act(() => shell.pressBack());
    expect(controller.getSnapshot().route.kind).toBe('home');
    act(() => shell.pressBack());
    expect(shell.exitApp).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('moves focus to the new screen heading after navigation', () => {
    const controller = createRenewalController();
    render(<Application controller={controller} platform={platform()} />);
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('heading', { level: 1, name: '연결 설정' })).toHaveFocus();
    controller.dispose();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/shell.test.tsx`
Expected: FAIL (`platform` prop·앱바 없음)

- [ ] **Step 3: Application 셸 구현**

`src/app/Application.tsx`에서 `RouteScreen` 함수는 그대로 두고(Task 9에서 넣은 `onTheme` 포함), import와 `Application` 함수를 아래로 바꾼다.

import 부분:
```tsx
import type { JSX } from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { HomeScreen } from '../ui/HomeScreen';
import { WorkScreen } from '../ui/WorkScreen';
import { TranslationScreen } from '../ui/TranslationScreen';
import { ReaderScreen } from '../ui/ReaderScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import { TopAppBar } from '../ui/components/TopAppBar';
import { IconButton } from '../ui/components/IconButton';
import { Menu } from '../ui/components/Menu';
import { Card } from '../ui/components/Card';
import { Button } from '../ui/components/Button';
import { SnackbarProvider } from '../ui/components/Snackbar';
import { runTopBackHandler } from '../ui/shell/backStack';
import { useResolvedTheme } from '../ui/theme/theme';
import { capacitorShell, type ShellPlatform } from '../platform/shell';
import type { RenewalController, RenewalSnapshot } from './renewalController';
import '../ui/theme/base.css';
import './application.css';
```

`Application` 함수:
```tsx
const routeTitles = { work: '목차', translation: '읽기', reader: '읽기', settings: '설정' } as const;

function ShellAppBar({
  controller,
  state,
}: {
  controller: RenewalController;
  state: RenewalSnapshot;
}): JSX.Element {
  if (state.route.kind === 'home')
    return (
      <TopAppBar
        title="서재"
        titleAs="span"
        actions={
          <IconButton
            icon="settings"
            label="설정"
            onClick={() => controller.navigate({ kind: 'settings' })}
          />
        }
      />
    );
  const items = [{ label: '서재로 가기', onSelect: controller.goHome }];
  if (state.route.kind !== 'settings')
    items.push({ label: '설정', onSelect: () => controller.navigate({ kind: 'settings' }) });
  return (
    <TopAppBar
      title={routeTitles[state.route.kind]}
      titleAs="span"
      navigation={<IconButton icon="arrow_back" label="뒤로 가기" onClick={controller.back} />}
      actions={<Menu label="더보기" items={items} />}
    />
  );
}

export function Application({
  controller,
  platform = capacitorShell,
}: {
  controller: RenewalController;
  platform?: ShellPlatform;
}): JSX.Element {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    void controller.initialize();
  }, [controller]);
  useEffect(
    () =>
      platform.onBackButton(() => {
        // 순서: 열린 오버레이 → 이전 화면 → 서재에서 앱 종료.
        if (runTopBackHandler()) return;
        if (controller.canGoBack()) controller.back();
        else platform.exitApp();
      }),
    [controller, platform],
  );
  const theme = useResolvedTheme(state.theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    platform.setSystemBarsTheme(theme);
  }, [theme, platform]);
  const main = useRef<HTMLElement>(null);
  const routeKey = JSON.stringify(state.route);
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    // 화면이 바뀌면 새 화면 제목으로 포커스를 옮겨 스크린 리더가 위치를 알게 한다.
    const heading = main.current?.querySelector<HTMLElement>('h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [routeKey]);
  return (
    <SnackbarProvider>
      <div className="nr-application" lang="ko">
        <ShellAppBar controller={controller} state={state} />
        <main ref={main} className="nr-screen">
          {state.error && (
            <Card variant="error" role="alert">
              {state.error}
            </Card>
          )}
          {/* 아래 알림 카드들은 #93(서재)에서 서재 화면으로 옮긴다. 문구는 그 이슈에서 바꾼다. */}
          {state.batch?.record &&
            state.batch.record.phase !== 'complete' &&
            (state.route.kind !== 'work' ||
              state.route.workId !== state.batch.record.work.workId) && (
              <aside aria-label="일괄 번역 상태" className="nr-notice">
                <p>
                  {state.batch.record.work.title}의 일괄 번역 상태가 저장되어 있습니다. 자동으로
                  다시 전송하지 않습니다.
                </p>
                <Button variant="text" onClick={controller.openBatch}>
                  일괄 번역 상태 보기
                </Button>
              </aside>
            )}
          {state.legacyWarnings.length > 0 && (
            <aside aria-label="이전 읽기 데이터 확인" role="status" className="nr-notice">
              <p>이전 읽기 데이터 일부를 가져오지 못했습니다. 원본 파일은 그대로 보존했습니다.</p>
              <ul>
                {state.legacyWarnings.map((warning) => (
                  <li key={warning.cacheKey}>
                    기록 {warning.cacheKey.slice(3, 15)}:{' '}
                    {warning.reason === 'unfinished'
                      ? '미완료 번역입니다. 자동으로 번역을 재개하지 않습니다.'
                      : warning.reason === 'missing'
                        ? '저장 파일을 찾을 수 없습니다.'
                        : '손상되었거나 지원하지 않는 형식입니다.'}
                  </li>
                ))}
              </ul>
            </aside>
          )}
          {state.pendingSaveChapter &&
            (state.route.kind !== 'translation' ||
              state.route.chapterId !== state.pendingSaveChapter.chapterId) && (
              <aside aria-label="저장 대기 중인 번역" className="nr-notice nr-notice--error">
                <p>
                  {state.pendingSaveChapter.title}의 번역 결과가 아직 저장을 완료하지 못했습니다.
                  저장을 마친 뒤 새 번역을 요청할 수 있습니다.
                </p>
                <Button variant="text" onClick={controller.openPendingSave}>
                  저장 대기 중인 번역으로 돌아가기
                </Button>
              </aside>
            )}
          {state.titlesBusy && <p role="status">제목 번역 중… 완료된 제목부터 표시합니다.</p>}
          {state.titlesError && <p role="alert">{state.titlesError}</p>}
          <RouteScreen controller={controller} state={state} />
          {state.translationTimings && (
            <details>
              <summary>최근 번역 단계별 시간</summary>
              <p>
                원문 준비 {Math.round(state.translationTimings.sourceMs)}ms · 모델 대기{' '}
                {Math.round(state.translationTimings.modelMs)}ms · 결과 확인·저장{' '}
                {Math.round(state.translationTimings.validationStorageMs)}ms · 리더 표시{' '}
                {Math.round(state.translationTimings.readerDisplayMs)}ms
              </p>
            </details>
          )}
        </main>
      </div>
    </SnackbarProvider>
  );
}
```

주의: 기존 `state.error`는 `<p role="alert">`였다. `Card`의 `role` prop으로 `alert`을 유지한다(`section`에 `role="alert"`). 기존 테스트가 `getByRole('alert')`로 이 문구를 찾는다.

- [ ] **Step 4: 셸 CSS 교체**

`src/app/application.css` 전체를 아래로 바꾼다(기존 화면 마크업을 하위 이슈가 재작성하기 전까지 토큰으로 맞추는 기본 스타일):

```css
/* 앱 셸과, 하위 이슈(#93~#97)가 화면을 재작성하기 전 기존 마크업의 기본 스타일. 토큰만 참조한다. */
.nr-application {
  min-block-size: 100dvh;
  background: var(--surface);
  color: var(--on-surface);
}
.nr-screen {
  box-sizing: border-box;
  max-inline-size: var(--content-max);
  margin: 0 auto;
  padding: 8px max(16px, var(--inset-right)) calc(32px + var(--inset-bottom))
    max(16px, var(--inset-left));
}
.nr-screen > * + * {
  margin-block-start: 16px;
}
.nr-screen h1 {
  margin: 8px 0 16px;
  font: var(--type-headline-small);
  text-wrap: balance;
}
.nr-screen h1:focus {
  outline: none;
}
.nr-screen h2,
.nr-screen h3 {
  margin: 24px 0 8px;
  font: var(--type-title-medium);
}
.nr-screen p {
  margin: 8px 0;
}
.nr-screen a {
  color: var(--primary);
}
.nr-screen [role='alert'] {
  color: var(--error);
}
.nr-screen [role='status'] {
  color: var(--on-surface-variant);
  font: var(--type-body-medium);
}
.nr-screen .nr-card[role='alert'] {
  color: var(--on-error-container);
}
.nr-notice {
  padding: 16px;
  border-radius: var(--shape-md);
  background: var(--surface-container-low);
}
.nr-notice--error {
  background: var(--error-container);
  color: var(--on-error-container);
}
.nr-notice--error .nr-button--text {
  color: var(--on-error-container);
}
/* 클래스 없는 기존 버튼: 토널 S 버튼 모양 */
.nr-screen button:not([class]) {
  min-block-size: var(--button-s);
  margin: 4px 8px 4px 0;
  padding: 0 20px;
  border: 0;
  border-radius: var(--shape-full);
  background: var(--primary-container);
  color: var(--on-primary-container);
  font: var(--type-label-large);
  cursor: pointer;
}
.nr-screen button:not([class]):disabled {
  cursor: default;
  background: color-mix(in srgb, var(--on-surface) 12%, transparent);
  color: color-mix(in srgb, var(--on-surface) 38%, transparent);
}
.nr-screen label {
  display: grid;
  gap: 4px;
  min-inline-size: 0;
  margin-block: 12px;
  color: var(--on-surface-variant);
  font: var(--type-body-medium);
}
.nr-screen input:not([type='checkbox']):not([type='radio']):not([type='range']),
.nr-screen select,
.nr-screen textarea {
  box-sizing: border-box;
  inline-size: 100%;
  min-block-size: var(--touch-target);
  padding: 0 16px;
  border: 0;
  border-block-end: 1px solid var(--outline);
  border-radius: var(--shape-xs) var(--shape-xs) 0 0;
  background: var(--surface-container-highest);
  color: var(--on-surface);
  font: var(--type-body-large);
}
.nr-screen textarea {
  padding-block: 12px;
}
.nr-screen input[type='checkbox'],
.nr-screen input[type='radio'],
.nr-screen input[type='range'] {
  accent-color: var(--primary-fill);
}
.nr-screen fieldset {
  min-inline-size: 0;
  margin: 16px 0;
  padding: 8px 16px 16px;
  border: 1px solid var(--outline-variant);
  border-radius: var(--shape-md);
}
.nr-screen legend {
  padding: 0 4px;
  font: var(--type-title-medium);
}
.nr-screen details {
  padding: 8px 16px;
  border-radius: var(--shape-md);
  background: var(--surface-container-low);
}
.nr-screen summary {
  min-block-size: var(--touch-target);
  display: flex;
  align-items: center;
  cursor: pointer;
}
.nr-screen ol,
.nr-screen ul {
  padding-inline-start: 24px;
}
.nr-theme-choice [role='radiogroup'] {
  display: grid;
  gap: 4px;
}
.nr-theme-choice label {
  display: flex;
  align-items: center;
  gap: 12px;
  min-block-size: var(--touch-target);
  margin: 0;
  color: var(--on-surface);
  font: var(--type-body-large);
}
/* 기존 독서·번역 화면의 본문 영역 */
.nr-reading-body {
  position: relative;
  overflow-y: auto;
  max-block-size: 65vh;
  margin-top: 16px;
  padding: 20px;
  border-radius: var(--shape-md);
  background: var(--reading-surface);
  color: var(--reading-on-surface);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  text-wrap: pretty;
}
.nr-stream-body {
  min-block-size: 40vh;
  max-block-size: 70vh;
}
.nr-stream-toolbar,
.nr-title-actions,
.nr-batch-retranslate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.nr-stream-toolbar p {
  flex: 1;
}
.nr-stream-caption,
.nr-stream-empty {
  color: var(--on-surface-variant);
  font: var(--type-body-medium);
}
.nr-batch-range {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.nr-candidate,
.nr-quality,
.nr-title form {
  overflow-wrap: anywhere;
}
.nr-title {
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
.nr-setting-toggle {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px;
}
.nr-setting-toggle span {
  grid-column: 2;
}
```

- [ ] **Step 5: edge-to-edge·뒤로 가기 플랫폼 설정**

`index.html`의 viewport 메타를 바꾸고 color-scheme 메타를 추가한다(한 줄 파일 형식 유지):

```html
<!doctype html>
<html lang="ko"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" /><meta name="color-scheme" content="light dark" /><title>narou-reader</title></head><body><div id="root"></div><script type="module" src="/src/app/bootstrap.tsx"></script></body></html>
```

`capacitor.config.ts`의 `plugins` 줄을 바꾼다(기존 `CapacitorHttp: { enabled: false }` 문자열은 패키징 테스트가 검사하므로 그대로 둔다):

```ts
 plugins: {
  CapacitorHttp: { enabled: false },
  // edge-to-edge: --safe-area-inset-* CSS 변수를 WebView에 넣는다(Android 10 WebView 포함).
  SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' }
 }
```

`android/app/src/main/AndroidManifest.xml`의 `<application` 속성에 추가(`android:theme="@style/AppTheme"` 다음 줄):

```xml
        android:enableOnBackInvokedCallback="true"
```

- [ ] **Step 6: 셸 테스트 통과 확인**

Run: `cd /d/projects/narou-reader-92 && npx vitest run tests/ui/shell.test.tsx tests/e2e/android-packaging.test.ts`
Expected: PASS

- [ ] **Step 7: 셸 버튼 이름이 바뀐 기존 테스트 갱신**

두 파일에서 기존 셸 버튼(`홈`, `뒤로`, 작품·회차 화면에서의 `설정`)을 새 셸로 바꾼다. 동작 단언은 그대로 둔다.

`tests/ui/renewal-flow.test.tsx`와 `tests/integration/renewal-first-slice.test.tsx` 각각의 import 아래(첫 `describe`/`it` 전)에 헬퍼를 추가한다:

```tsx
function chooseShellMenu(item: string) {
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}
```

바꿀 곳(`grep -n "name: '홈'\|name: '뒤로'\|name: '설정'" tests/ui/renewal-flow.test.tsx tests/integration/renewal-first-slice.test.tsx`로 확인):

| 파일:행(대략) | 이전 | 이후 |
|---|---|---|
| `renewal-flow.test.tsx:346` | `fireEvent.click(screen.getByRole('button', { name: '홈' }));` | `chooseShellMenu('서재로 가기');` |
| `renewal-flow.test.tsx:394`, `:422`, `:595` | `screen.getByRole('button', { name: '뒤로' })` | `screen.getByRole('button', { name: '뒤로 가기' })` |
| `renewal-flow.test.tsx:406` (작품 화면에서 설정 열기) | `fireEvent.click(screen.getByRole('button', { name: '설정' }));` | `chooseShellMenu('설정');` |
| `renewal-flow.test.tsx:508` (홈에서 설정) | 그대로 (`설정` 아이콘 버튼) | — |
| `renewal-first-slice.test.tsx:646` | `fireEvent.click(screen.getByRole('button', { name: '홈' }));` | `chooseShellMenu('서재로 가기');` |

`renewal-first-slice.test.tsx:647`의 `expect(h.app.getSnapshot().route.kind).toBe('home');`은 그대로 통과해야 한다.

- [ ] **Step 8: 전체 테스트**

Run: `cd /d/projects/narou-reader-92 && npx vitest run && npm run typecheck && npm run lint`
Expected: PASS 전부. 실패가 남으면:
- 같은 접근성 이름이 셸과 화면에 동시에 생겨 `getByRole`이 여러 개를 찾는 경우(예: `설정`): 화면 쪽 요소는 그대로 두고 테스트가 의도한 요소를 `within(screen.getByRole('main'))` 또는 `within(screen.getByRole('banner'))`로 좁힌다.
- `role="status"`가 하나라고 가정한 테스트가 실패하면 새 셸이 `status`를 추가했는지 확인한다(추가하지 않아야 한다. 스낵바 영역은 역할이 없다).
- 포커스 이동 때문에 실패하면 해당 테스트의 단언을 확인하고, 셸의 포커스 효과가 첫 렌더에는 실행되지 않는지 확인한다.

- [ ] **Step 9: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add src/app/Application.tsx src/app/application.css index.html capacitor.config.ts android/app/src/main/AndroidManifest.xml tests/ui/shell.test.tsx tests/ui/renewal-flow.test.tsx tests/integration/renewal-first-slice.test.tsx \
 && git commit -m "feat: 앱바·시스템 뒤로 가기·테마 적용을 갖춘 앱 셸 (#92)" -m "기존 상단 뒤로·홈·설정 버튼을 M3 앱바와 더보기 메뉴로 바꾸고 테스트의 버튼 이름을 맞췄다." -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 마무리 — 포맷 대상·미리보기 확인·전체 검사

**Files:**
- Modify: `package.json` (`format:check` 대상)
- Modify: `tests/ui/renewal-preview.tsx` (필요 시 `platform={noopShell}`)

- [ ] **Step 1: 포맷 대상 추가**

`package.json`의 `format:check` 스크립트 끝(` .prettierrc.json"` 앞)에 아래 패턴을 공백으로 구분해 추가한다:

```
\"src/ui/components/*.{ts,tsx,css}\" \"src/ui/theme/*.{ts,css}\" \"src/ui/shell/*.ts\" \"src/platform/shell.ts\" \"tests/ui/components/*.tsx\" \"tests/ui/{shell,theme}.test.tsx\" tests/ui/theme-contrast.test.ts tests/integration/navigation-stack.test.ts tests/integration/theme-preferences.test.ts
```

그다음 새 파일만 포맷한다:

```bash
cd /d/projects/narou-reader-92 && npx prettier --write "src/ui/components/*.{ts,tsx,css}" "src/ui/theme/*.{ts,css}" "src/ui/shell/*.ts" src/platform/shell.ts "tests/ui/components/*.tsx" "tests/ui/{shell,theme}.test.tsx" tests/ui/theme-contrast.test.ts tests/integration/navigation-stack.test.ts tests/integration/theme-preferences.test.ts src/app/Application.tsx src/app/application.css src/ui/SettingsScreen.tsx \
 && npm run format:check
```

Expected: `All matched files use Prettier code style!`

- [ ] **Step 2: 미리보기 확인**

`tests/ui/renewal-preview.tsx`가 `<Application controller={...} />`를 렌더하면 `platform={noopShell}`을 넘기도록 바꾼다(`import { noopShell } from '../../src/platform/shell';`). 그다음:

```bash
cd /d/projects/narou-reader-92 && npm run dev -- --port 5180 --strictPort
```

다른 셸에서(또는 내장 브라우저로) `http://localhost:5180/tests/ui/renewal-preview.html`을 열어 확인한다. 확인할 것: 앱바가 위에 붙어 있다, 서재 앱바에 설정 아이콘, 설정 화면에서 `화면 테마`를 `다크`로 바꾸면 전체가 다크 토큰으로 바뀐다, 버튼이 둥근 토널 모양이다, 가로 스크롤이 없다. 확인 후 dev 서버를 종료한다. 스크린샷은 커밋하지 않는다(보고에만 쓴다).

- [ ] **Step 3: 전체 검사**

```bash
cd /d/projects/narou-reader-92 && npm run format:check && npm run lint && npm run typecheck && npx vitest run && npm run build
```

Expected: 모두 PASS. 테스트 개수를 기록한다(작업 전 main 기준 개수와 비교해 줄어들지 않았는지 확인: `git stash` 대신 `cd /d/projects/narou-reader && npx vitest run --reporter=dot | tail -3`로 main 기준을 읽는다. main 작업 트리는 수정하지 않는다).

- [ ] **Step 4: 커밋**

```bash
cd /d/projects/narou-reader-92 && git add package.json tests/ui/renewal-preview.tsx $(git diff --name-only -- src tests | tr '\n' ' ') \
 && git commit -m "chore: 디자인 시스템 파일을 포맷 검사 대상에 추가 (#92)" -m "Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
```

(`git diff --name-only`가 비어 있으면 그 부분은 생략한다. 이 커밋에는 포맷으로 바뀐 파일만 들어가야 한다. `git status --short`로 범위 밖 파일이 없는지 먼저 확인한다.)

- [ ] **Step 5: push**

```bash
cd /d/projects/narou-reader-92 && git push origin codex/92-design-system && git status -sb | head -1
```

PR 생성·실기 검증·Opus 감사는 이 계획 밖(오케스트레이터)에서 한다.
