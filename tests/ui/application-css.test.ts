import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/application.css', 'utf8');

// 주석을 걷어 내고 "선택자 { 본문 }" 규칙을 꺼낸다.
function rules(source: string): { selector: string; body: string }[] {
  const plain = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1]!.trim(),
    body: match[2]!,
  }));
}

// 최상위 쉼표로 선택자 목록을 나눈다(:has(...) 안의 쉼표는 무시한다).
function selectorParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

// :where(...) 묶음을 괄호 짝을 맞춰 통째로 지운다. 남은 부분이 특이도를 올리는 조각이다.
function stripWhere(selector: string): string {
  let out = '';
  let i = 0;
  while (i < selector.length) {
    if (selector.startsWith(':where(', i)) {
      let depth = 0;
      let j = i + ':where'.length;
      for (; j < selector.length; j += 1) {
        if (selector[j] === '(') depth += 1;
        else if (selector[j] === ')' && (depth -= 1) === 0) break;
      }
      i = j + 1;
    } else {
      out += selector[i];
      i += 1;
    }
  }
  return out;
}

const scoped = rules(css)
  .flatMap((rule) => selectorParts(rule.selector))
  .filter((part) => part.startsWith(':where(.nr-screen)'));

describe('application.css screen defaults', () => {
  it('keeps generic element rules at low specificity so component classes win', () => {
    // .nr-screen 뒤에 요소·속성·결합자가 바로 오면 특이도가 올라가 컴포넌트 클래스를 이긴다.
    expect(css).not.toMatch(/^\.nr-screen\s+(?:[a-z]|\[|>)/m);
  });

  it('keeps every selector after the screen scope free of :not() and attributes outside :where', () => {
    // 체크박스·라디오 라벨 규칙도 속성 선택자를 :where 안에 두므로 같은 기준을 통과한다.
    expect(scoped.length).toBeGreaterThan(0);
    for (const part of scoped) expect(stripWhere(part), part).not.toMatch(/:not\(|\[/);
  });

  it('limits role alert and status colors to elements without a component class', () => {
    for (const role of ['alert', 'status']) {
      const matching = scoped.filter((part) => part.includes(`[role='${role}']`));
      expect(matching.length, role).toBeGreaterThan(0);
      for (const part of matching) expect(part, role).toContain(':not([class])');
    }
  });

  it('gives unclassed legacy buttons the 48px touch target', () => {
    // 하위 이슈(#93~#97)가 버튼을 바꾸기 전까지 남는 기존 버튼도 최소 터치 영역을 지킨다.
    const legacy = rules(css).find(
      (rule) => rule.selector === ':where(.nr-screen) :where(button:not([class]))',
    );
    expect(legacy?.body).toMatch(/min-block-size:\s*var\(--touch-target\);/);
  });

  it('lays out checkbox and radio labels as a row inside a low-specificity :where scope', () => {
    const selector =
      ":where(.nr-screen) label:where(:has(> input[type='checkbox'], > input[type='radio']))";
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toMatch(/display:\s*flex;/);
    expect(block).toMatch(/align-items:\s*center;/);
    expect(block).toMatch(/gap:\s*8px;/);
  });

  it('회차 메뉴 시트 행은 리더 시트와 같은 좌우 여백을 두고 글자를 왼쪽에 맞춘다', () => {
    const row = rules(css).find((rule) => rule.selector === '.nr-sheet-action');
    expect(row?.body).toMatch(/padding:\s*8px 24px;/);
    expect(row?.body).toMatch(/text-align:\s*start;/);
  });

  it('회차 메뉴 시트 행은 같은 모양의 최소 높이를 가지고 삭제 행만 오류 색을 쓴다', () => {
    const row = rules(css).find((rule) => rule.selector === '.nr-sheet-action');
    expect(row?.body).toMatch(/min-block-size:\s*56px;/);
    const danger = rules(css).find((rule) => rule.selector === '.nr-sheet-action--danger');
    expect(danger?.body).toMatch(/color:\s*var\(--error\);/);
  });
});

const readerCss = readFileSync('src/ui/immersive-reader.css', 'utf8');

describe('immersive-reader.css reader toolbar split (#152)', () => {
  it('회차 이동 툴바는 배경 없이 양 끝으로 벌리고 빈 가운데는 터치를 통과시킨다', () => {
    const bar = rules(readerCss).find((rule) => rule.selector === '.nr-toolbar.nr-reader-toolbar');
    expect(bar?.body).toMatch(/justify-content:\s*space-between;/);
    expect(bar?.body).toMatch(/pointer-events:\s*none;/);
    expect(bar?.body).toMatch(/background:\s*transparent;/);
  });

  it('양 끝 버튼과 가운데 묶음만 터치를 받는다', () => {
    const ends = rules(readerCss).find((rule) =>
      selectorParts(rule.selector).includes('.nr-reader-toolbar > .nr-reader-symbol-button'),
    );
    const centre = rules(readerCss).find((rule) =>
      selectorParts(rule.selector).includes('.nr-reader-toolbar__center'),
    );
    expect(ends?.body).toMatch(/pointer-events:\s*auto;/);
    expect(centre?.body).toMatch(/pointer-events:\s*auto;/);
  });
});

describe('immersive-reader.css font control and sheet title (#171)', () => {
  it('글자 크기 조절 줄은 라벨을 시작 쪽에 두고 [– 값 +]를 끝 쪽에 묶는다', () => {
    const control = rules(readerCss).find((rule) => rule.selector === '.nr-reader-font-control');
    expect(control?.body).toMatch(/justify-content:\s*flex-start;/);
    const label = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-font-control > span',
    );
    expect(label?.body).toMatch(/margin-inline-end:\s*auto;/);
    expect(label?.body).toMatch(/font:\s*var\(--type-title-medium\);/);
  });

  it('글자 크기 −·+ 버튼은 테두리 있는 원형 버튼으로 보인다', () => {
    const stepper = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-font-control > .nr-reader-symbol-button',
    );
    expect(stepper?.body).toMatch(/border:\s*1px solid var\(--outline\);/);
    expect(stepper?.body).toMatch(/color:\s*var\(--primary\);/);
  });

  it('보기 설정 시트의 legend는 시트 제목과 같은 시작선에 맞춘다', () => {
    const legend = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-sheet-body legend',
    );
    expect(legend?.body).toMatch(/padding-inline:\s*0;/);
  });
});

describe('immersive-reader.css progress bar', () => {
  it('앱바가 숨으면 번역 진행 막대를 화면 맨 위로 올린다', () => {
    const hidden = rules(readerCss).find(
      (rule) =>
        rule.selector === '.nr-immersive-reader > .nr-immersive-appbar--hidden ~ .nr-progress',
    );
    expect(hidden?.body).toMatch(/inset-block-start:\s*var\(--inset-top\);/);
  });
});

describe('immersive-reader.css status pill and first paragraph', () => {
  it('바가 숨은 몰입 상태에서는 상태 알림을 화면 아래로 내린다', () => {
    const hidden = rules(readerCss).find(
      (rule) =>
        rule.selector === '.nr-immersive-reader > .nr-immersive-appbar--hidden ~ .nr-status-pill',
    );
    expect(hidden?.body).toMatch(/inset-block-end:\s*calc\(16px \+ var\(--inset-bottom\)\);/);
  });

  it('행동 안내 카드는 본문 흐름에서 분리되어 고정 위치에 뜨고 닫기 버튼을 기준으로 둔다', () => {
    const float = rules(readerCss).find(
      (rule) => rule.selector === '.nr-immersive-reader > .nr-reader-float',
    );
    expect(float?.body).toMatch(/position:\s*fixed;/);
    expect(float?.body).toMatch(/transition:\s*inset-block-end /);
    const hidden = rules(readerCss).find(
      (rule) =>
        rule.selector === '.nr-immersive-reader > .nr-immersive-appbar--hidden ~ .nr-reader-float',
    );
    expect(hidden?.body).toMatch(/inset-block-end:\s*calc\(16px \+ var\(--inset-bottom\)\);/);
    const close = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-float > .nr-icon-button',
    );
    expect(close?.body).toMatch(/position:\s*absolute;/);
  });

  it('감소된 모션에서는 행동 안내 카드의 위치 전환을 끈다', () => {
    const reduced = rules(readerCss).find(
      (rule) =>
        rule.selector === '.nr-immersive-reader > .nr-reader-float' &&
        /transition:\s*none;/.test(rule.body),
    );
    expect(reduced).toBeDefined();
  });
});

describe('immersive-reader.css chapter end card', () => {
  // .nr-reader-end 규칙은 여러 번 나오므로 같은 선택자를 가진 규칙 본문을 모두 모은다.
  const endBody = rules(readerCss)
    .filter((rule) => selectorParts(rule.selector).includes('.nr-reader-end'))
    .map((rule) => rule.body)
    .join('\n');

  it('회차 끝 카드는 문구와 버튼을 한 줄에 펼치고 사이를 벌린다', () => {
    expect(endBody).toMatch(/display:\s*flex;/);
    expect(endBody).toMatch(/justify-content:\s*space-between;/);
  });

  it('행동 버튼은 카드의 끝(오른쪽)에 둔다', () => {
    const button = rules(readerCss).find((rule) => rule.selector === '.nr-reader-end > .nr-button');
    expect(button?.body).toMatch(/margin-inline-start:\s*auto;/);
  });
});

const componentsCss = readFileSync('src/ui/components/components.css', 'utf8');

function zIndex(body: string | undefined): number {
  return Number(body?.match(/z-index:\s*(\d+);/)?.[1]);
}

describe('immersive-reader.css blank paragraph spacing', () => {
  it('원문 빈 줄 문단은 앞 문단 아래 여백과 합쳐 한 줄 높이만 차지한다(#137)', () => {
    const blank = rules(readerCss).find(
      (rule) => rule.selector === '.nr-immersive-article > p.nr-reader-blank',
    );
    expect(blank?.body).toMatch(/block-size:\s*0\.4em;/);
    expect(blank?.body).toMatch(/margin-block:\s*0;/);
  });
});

describe('immersive-reader.css system bars', () => {
  it('몰입 리더는 상태바와 내비게이션 바 자리를 독서 배경으로 덮는다', () => {
    const sheet = rules(readerCss);
    // 공통 선언(position·배경·z-index)은 ::before, ::after 선택자 목록 하나에 둔다.
    const shared = sheet.find((rule) => {
      const parts = selectorParts(rule.selector);
      return (
        parts.includes('.nr-immersive-reader::before') &&
        parts.includes('.nr-immersive-reader::after')
      );
    });
    expect(shared?.body).toMatch(/position:\s*fixed;/);
    expect(shared?.body).toMatch(/background:\s*var\(--reading-surface\);/);
    expect(shared?.body).toMatch(/pointer-events:\s*none;/);
    expect(shared?.body).toMatch(/z-index:\s*10;/);
    const top = sheet.find((rule) => rule.selector === '.nr-immersive-reader::before');
    const bottom = sheet.find((rule) => rule.selector === '.nr-immersive-reader::after');
    // 띠 끝 16px은 독서 배경에서 투명으로 흐려, 잘린 글자 조각이 경계에 남지 않게 한다(#137).
    expect(top?.body).toMatch(/block-size:\s*calc\(var\(--inset-top\) \+ 16px\);/);
    expect(top?.body).toMatch(
      /background:\s*linear-gradient\(to bottom, var\(--reading-surface\) calc\(100% - 16px\), transparent\);/,
    );
    expect(bottom?.body).toMatch(/block-size:\s*calc\(var\(--inset-bottom\) \+ 16px\);/);
    expect(bottom?.body).toMatch(
      /background:\s*linear-gradient\(to top, var\(--reading-surface\) calc\(100% - 16px\), transparent\);/,
    );
    const above = [
      rules(componentsCss).find((rule) => rule.selector === '.nr-toolbar')?.body,
      sheet.find((rule) => rule.selector === '.nr-immersive-appbar')?.body,
      sheet.find((rule) => rule.selector === '.nr-immersive-reader > .nr-progress')?.body,
    ];
    for (const body of above) {
      expect(zIndex(shared?.body)).toBeLessThan(zIndex(body));
    }
  });
});

describe('components.css navigating list item affordance', () => {
  it('강조색 값은 비활성 규칙보다 앞에 두어 비활성 색이 이기게 한다(#140)', () => {
    const sheet = rules(componentsCss);
    const navigates = sheet.findIndex(
      (rule) => rule.selector === '.nr-list-item--navigates .nr-list-item__supporting',
    );
    const disabled = sheet.findIndex((rule) =>
      selectorParts(rule.selector).includes(
        '.nr-list-item__main:disabled .nr-list-item__supporting',
      ),
    );
    expect(navigates).toBeGreaterThanOrEqual(0);
    expect(disabled).toBeGreaterThan(navigates);
    expect(sheet[navigates]?.body).toMatch(/color:\s*var\(--primary\);/);
    const chevron = sheet.find((rule) => rule.selector === '.nr-list-item__chevron');
    expect(chevron?.body).toMatch(/margin-inline-start:\s*auto;/);
    expect(chevron?.body).toMatch(/color:\s*var\(--on-surface-variant\);/);
    const disabledChevron = sheet.find(
      (rule) => rule.selector === '.nr-list-item__main:disabled .nr-list-item__chevron',
    );
    expect(disabledChevron?.body).toMatch(/color:\s*inherit;/);
  });
});

const baseCss = readFileSync('src/ui/theme/base.css', 'utf8');

describe('base.css Korean line breaking (#167)', () => {
  it('html 규칙은 한국어를 어절 단위로 줄바꿈하고 긴 덩어리는 넘치지 않게 끊는다', () => {
    const html = rules(baseCss).find((rule) => rule.selector === 'html');
    expect(html?.body).toMatch(/word-break:\s*keep-all;/);
    expect(html?.body).toMatch(/overflow-wrap:\s*anywhere;/);
  });

  it('일본어 요소는 어절 줄바꿈을 되돌려 기본 금칙 처리를 쓴다', () => {
    const ja = rules(baseCss).find((rule) => rule.selector === ':lang(ja)');
    expect(ja?.body).toMatch(/word-break:\s*normal;/);
  });
});

const homeCss = readFileSync('src/ui/home.css', 'utf8');

describe('home.css library scroll', () => {
  it('서재는 최소 높이 없이 작품 추가 버튼에 마지막 행이 가리지 않을 여백을 둔다', () => {
    const library = rules(homeCss).find((rule) => rule.selector === '.nr-library');
    expect(library).toBeDefined();
    expect(library?.body).not.toMatch(/min-block-size/);
    expect(library?.body).toMatch(/padding-block-end:\s*calc\(var\(--fab\) \+ 16px\);/);
  });
});

describe('CSS 토큰 참조', () => {
  it('src의 CSS가 쓰는 var(--type-…) 토큰은 모두 tokens.css에 정의돼 있다', () => {
    const tokens = readFileSync('src/ui/theme/tokens.css', 'utf8');
    const defined = new Set([...tokens.matchAll(/--(type-[\w-]+)\s*:/g)].map((match) => match[1]));
    const sheets = readdirSync('src', { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.css'));
    const missing: string[] = [];
    for (const sheet of sheets) {
      const source = readFileSync(join('src', sheet), 'utf8');
      for (const match of source.matchAll(/var\(--(type-[\w-]+)/g)) {
        if (!defined.has(match[1]!)) missing.push(`${sheet}: --${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('immersive-reader.css reader chapter buttons (#155)', () => {
  it('회차 이동 버튼은 글자 폭에 맞는 알약으로 최소 폭과 좌우 여백만 둔다', () => {
    const ends = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-toolbar > .nr-reader-symbol-button',
    );
    expect(ends?.body).toMatch(/min-inline-size:\s*56px;/);
    expect(ends?.body).toMatch(/block-size:\s*56px;/);
    expect(ends?.body).toMatch(/padding-inline:\s*20px;/);
    expect(ends?.body).toMatch(/font:\s*var\(--type-label-large\);/);
    expect(ends?.body).not.toMatch(/(?<![\w-])inline-size:\s*56px;/);
  });
});

describe('immersive-reader.css reader float card (#166)', () => {
  it('닫기 버튼은 본문 카드(z-index 5)보다 위에 있어야 보이고 눌린다', () => {
    const notice = rules(readerCss).find((rule) => rule.selector === '.nr-reader-notice');
    const close = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-float > .nr-icon-button',
    );
    const noticeZ = Number(notice?.body.match(/z-index:\s*(\d+);/)?.[1]);
    const closeZ = Number(close?.body.match(/z-index:\s*(\d+);/)?.[1]);
    expect(noticeZ).toBe(5);
    expect(close?.body).toMatch(/z-index:\s*6;/);
    expect(closeZ).toBeGreaterThan(noticeZ);
  });

  it('떠 있는 카드의 본문은 내용을 양끝으로 나눠 닫기 버튼 자리를 비운다', () => {
    const body = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-float > .nr-reader-notice',
    );
    expect(body?.body).toMatch(/justify-content:\s*space-between;/);
  });
});

describe('immersive-reader.css reader toolbar disabled (#169)', () => {
  it('비활성 회차 이동 버튼은 본문 위에서 투명해지지 않도록 불투명하게 칠한다', () => {
    const disabled = rules(readerCss).find(
      (rule) => rule.selector === '.nr-reader-toolbar > .nr-reader-symbol-button:disabled',
    );
    expect(disabled?.body).toMatch(/opacity:\s*1;/);
    expect(disabled?.body).toMatch(/background:\s*color-mix\(/);
    expect(disabled?.body).not.toMatch(/,\s*transparent\)/);
    expect(disabled?.body).toMatch(/box-shadow:\s*none;/);
  });
});
