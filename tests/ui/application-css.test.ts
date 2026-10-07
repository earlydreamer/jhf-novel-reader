import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/application.css', 'utf8');

describe('application.css screen defaults', () => {
  it('keeps generic element rules at low specificity so component classes win', () => {
    // .nr-screen 뒤에 요소·속성·결합자가 바로 오면 특이도가 올라가 컴포넌트 클래스를 이긴다.
    expect(css).not.toMatch(/^\.nr-screen\s+(?:[a-z]|\[|>)/m);
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
});
