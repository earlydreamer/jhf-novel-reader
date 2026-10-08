import { readFileSync } from 'node:fs';
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

  it('회차 메뉴 시트는 리더 시트와 같은 좌우 여백을 두고 항목을 왼쪽에 맞춘다', () => {
    const menu = rules(css).find((rule) => rule.selector === '.nr-work-chapter-menu');
    expect(menu?.body).toMatch(/padding:\s*8px 24px 16px;/);
    expect(menu?.body).toMatch(/justify-items:\s*start;/);
  });
});
