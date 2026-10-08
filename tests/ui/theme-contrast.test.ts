// 토큰 대비 감사. tokens.css의 라이트·다크·독서 배경 값을 WCAG 2.2와 APCA(0.0.98G-4g)로 함께 판정한다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/ui/theme/tokens.css', import.meta.url), 'utf8');
const immersiveCss = readFileSync(
  new URL('../../src/ui/immersive-reader.css', import.meta.url),
  'utf8',
);

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

const themes = {
  light: block(':root'),
  dark: { ...block(':root'), ...block(":root[data-theme='dark']") },
};
const cases = Object.entries(themes).flatMap(([theme, tokens]) =>
  pairs.map(([fg, bg, use, gate]) => ({
    name: `${theme} ${use} (${fg} / ${bg})`,
    fg: tokens[fg],
    bg: tokens[bg],
    gate,
  })),
);
const reading = [
  { name: 'light 독서 기본', fg: themes.light['on-surface'], bg: themes.light.surface },
  { name: 'dark 독서 기본', fg: themes.dark['on-surface'], bg: themes.dark.surface },
  {
    name: 'light 독서 세피아',
    fg: block("[data-reading-background='sepia']")['reading-on-surface'],
    bg: block("[data-reading-background='sepia']")['reading-surface'],
  },
  {
    name: 'light 독서 검정',
    fg: block("[data-reading-background='black']")['reading-on-surface'],
    bg: block("[data-reading-background='black']")['reading-surface'],
  },
  {
    name: 'dark 독서 세피아',
    fg: block("[data-reading-background='sepia']")['reading-on-surface'],
    bg: block("[data-reading-background='sepia']")['reading-surface'],
  },
  {
    name: 'dark 독서 검정',
    fg: block("[data-reading-background='black']")['reading-on-surface'],
    bg: block("[data-reading-background='black']")['reading-surface'],
  },
].map((value) => ({ ...value, gate: READ }));
const readingSubtext = [
  { name: 'light 독서 보조', fg: themes.light['on-surface-variant'], bg: themes.light.surface },
  { name: 'dark 독서 보조', fg: themes.dark['on-surface-variant'], bg: themes.dark.surface },
  {
    name: 'light 독서 세피아 보조',
    fg: block("[data-reading-background='sepia']")['reading-on-surface-variant'],
    bg: block("[data-reading-background='sepia']")['reading-surface'],
  },
  {
    name: 'light 독서 검정 보조',
    fg: block("[data-reading-background='black']")['reading-on-surface-variant'],
    bg: block("[data-reading-background='black']")['reading-surface'],
  },
  {
    name: 'dark 독서 세피아 보조',
    fg: block("[data-reading-background='sepia']")['reading-on-surface-variant'],
    bg: block("[data-reading-background='sepia']")['reading-surface'],
  },
  {
    name: 'dark 독서 검정 보조',
    fg: block("[data-reading-background='black']")['reading-on-surface-variant'],
    bg: block("[data-reading-background='black']")['reading-surface'],
  },
].map((value) => ({ ...value, gate: SUB }));
const readingFailedLabel = [
  { name: 'light 독서 실패 문구', fg: themes.light['on-surface'], bg: themes.light.surface },
  { name: 'dark 독서 실패 문구', fg: themes.dark['on-surface'], bg: themes.dark.surface },
  {
    name: 'light 독서 세피아 실패 문구',
    fg: block("[data-reading-background='sepia']")['reading-on-surface'],
    bg: block("[data-reading-background='sepia']")['reading-surface'],
  },
  {
    name: 'light 독서 검정 실패 문구',
    fg: block("[data-reading-background='black']")['reading-on-surface'],
    bg: block("[data-reading-background='black']")['reading-surface'],
  },
  {
    name: 'dark 독서 세피아 실패 문구',
    fg: block("[data-reading-background='sepia']")['reading-on-surface'],
    bg: block("[data-reading-background='sepia']")['reading-surface'],
  },
  {
    name: 'dark 독서 검정 실패 문구',
    fg: block("[data-reading-background='black']")['reading-on-surface'],
    bg: block("[data-reading-background='black']")['reading-surface'],
  },
].map((value) => ({ ...value, gate: TEXT }));

describe('design token contrast', () => {
  it('gives every light color token a dark override so no value silently falls back to light', () => {
    // themes.dark는 라이트 값을 밑에 깔고 덮어쓰므로, 다크 블록에 없는 토큰은 조용히 라이트 값으로 감사된다.
    const dark = block(":root[data-theme='dark']");
    expect(Object.keys(block(':root')).filter((name) => !(name in dark))).toEqual([]);
  });

  it.each([...cases, ...reading, ...readingSubtext, ...readingFailedLabel])(
    '$name',
    ({ fg, bg, gate }) => {
      expect(fg, '전경 토큰 누락').toMatch(/^#[0-9A-F]{6}$/);
      expect(bg, '배경 토큰 누락').toMatch(/^#[0-9A-F]{6}$/);
      expect(wcag(fg!, bg!)).toBeGreaterThanOrEqual(gate[0]);
      expect(Math.abs(apca(fg!, bg!))).toBeGreaterThanOrEqual(gate[1]);
    },
  );

  it('keeps failed paragraph labels on the readable immersive foreground while retaining the error border', () => {
    expect(immersiveCss).toMatch(
      /\.nr-reader-failed-label\s*\{[^}]*color:\s*var\(--reading-on-surface\)/s,
    );
    expect(immersiveCss).toMatch(
      /\.nr-reader-paragraph--failed\s*\{[^}]*border-inline-start:\s*3px solid var\(--error\)/s,
    );
  });
});
