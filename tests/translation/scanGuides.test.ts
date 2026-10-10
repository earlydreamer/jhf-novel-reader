import { expect, test } from 'vitest';
import type { ScanCandidate } from '../../src/translation/termScan';
import { SCAN_GUIDES, guidesFor } from '../../src/translation/scanGuides';

const candidate = (source: string, extra: Partial<ScanCandidate> = {}): ScanCandidate => ({
  source,
  role: 'new',
  count: 1,
  chapterIds: ['c1'],
  contexts: [],
  script: 'other',
  ...extra,
});
const hint = [
  { char: '公', ko: ['공'], en: ['public'] },
  { char: '爵', ko: ['작'], en: ['baron'] },
];
const ids = (items: readonly ScanCandidate[]) => guidesFor(items).map((guide) => guide.id);

test('지침 모듈은 정해진 순서로 다섯 개다', () => {
  expect(SCAN_GUIDES.map((guide) => guide.id)).toEqual([
    'ruby',
    'historical',
    'epithet',
    'sino',
    'fantasy',
  ]);
});

test('루비가 있는 가타카나 이름은 루비 지침과 판타지 지침을 받는다', () => {
  expect(ids([candidate('カミラ', { script: 'katakana', ruby: 'かみら' })])).toEqual([
    'ruby',
    'fantasy',
  ]);
});

test('루비가 없는 가타카나 이름은 판타지 지침만 받는다', () => {
  expect(ids([candidate('カミラ', { script: 'katakana' })])).toEqual(['fantasy']);
});

test('힌트가 있는 두 글자 한자 관직은 역사 지침과 한자음 지침을 받는다', () => {
  expect(ids([candidate('公爵', { script: 'kanji', kanji: hint })])).toEqual([
    'historical',
    'sino',
  ]);
});

test('한자음 지침은 힌트가 없으면 받지 않는다', () => {
  expect(ids([candidate('公爵', { script: 'kanji' })])).toEqual(['historical']);
});

test('한자음 지침은 네 글자 이상의 한자 이름에는 맞지 않는다', () => {
  expect(ids([candidate('王都騎士団', { script: 'kanji', kanji: hint })])).toEqual(['historical']);
});

test('혼합 표기의 별명은 역사 지침과 별명 지침을 받는다', () => {
  expect(ids([candidate('美濃の蝮', { script: 'mixed' })])).toEqual(['historical', 'epithet']);
});

test('の가 들어 있는 이름은 표기와 상관없이 별명 지침을 받는다', () => {
  expect(ids([candidate('ミナの', { script: 'other' })])).toEqual(['epithet']);
});

test('한자만 있는 이름은 역사 지침만 받는다', () => {
  expect(ids([candidate('織田信長', { script: 'kanji' })])).toEqual(['historical']);
});

test('여러 후보의 지침은 중복 없이 SCAN_GUIDES 순서로 합쳐진다', () => {
  expect(
    ids([
      candidate('公爵', { script: 'kanji', kanji: hint }),
      candidate('カミラ', { script: 'katakana', ruby: 'かみら' }),
      candidate('王都', { script: 'kanji', kanji: hint }),
    ]),
  ).toEqual(['ruby', 'historical', 'sino', 'fantasy']);
});

test('어떤 유형에도 맞지 않는 후보는 지침이 없다', () => {
  expect(ids([candidate('ABC')])).toEqual([]);
});

test('각 지침은 문장을 가진다', () => {
  for (const guide of SCAN_GUIDES) expect(guide.text.length).toBeGreaterThan(0);
});

test('별명 지침은 뜻으로 옮기고 한자 음을 の 뒤에 잇지 않는다고 말한다', () => {
  const epithet = SCAN_GUIDES.find((guide) => guide.id === 'epithet');
  expect(epithet?.text).toBe(
    'Epithets and nicknames are translated by meaning, not by sound. Use the provided kanji meanings; keep place names transliterated. Never chain the Korean readings of the kanji after の (for example 甲斐の虎 → 가이의 호랑이, not 가이의 호).',
  );
});
