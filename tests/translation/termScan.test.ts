import { expect, test } from 'vitest';
import type { GuidanceTerm } from '../../src/translation/guidance';
import { collectScanCandidates, type ScanChapter } from '../../src/translation/termScan';
import { loadKanjidic } from '../../src/translation/kanjidic';

const term = (source: string, extra: Partial<GuidanceTerm> = {}): GuidanceTerm => ({
  source,
  target: `${source}-ko`,
  aliases: [],
  category: '',
  note: '',
  ...extra,
});
const chapter = (chapterId: string, texts: string[]): ScanChapter => ({
  chapterId,
  paragraphs: texts.map((text) => ({ text, ruby: [] })),
});

test('규칙 후보는 new, 원문의 기계 항목은 recheck, 사람 항목은 suggest, 원문에 없는 항목은 뺀다', () => {
  const result = collectScanCandidates(
    [
      chapter('c1', ['アルベルトは剣を抜いた。アルベルトが笑う。ミナは王都へ行く。']),
      chapter('c2', ['ミナが来た。']),
    ],
    [term('ミナ', { origin: 'model' }), term('王都'), term('ギルド', { origin: 'scan' })],
  );
  expect(result.map((item) => [item.source, item.role, item.count])).toEqual([
    ['ミナ', 'recheck', 2],
    ['王都', 'suggest', 1],
    ['アルベルト', 'new', 2],
  ]);
  expect(result.find((item) => item.source === 'ミナ')?.existing?.origin).toBe('model');
  expect(result.find((item) => item.source === 'アルベルト')?.existing).toBeUndefined();
});

test('별칭으로 맞은 항목은 규칙 후보와 합쳐져 하나가 되고 용어집 항목을 가리킨다', () => {
  const glossary = term('ギルド長', { aliases: ['ギルド'] });
  const result = collectScanCandidates(
    [chapter('c1', ['ギルド長が笑う。ギルドは静かだ。ギルドへ行く。'])],
    [glossary],
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ source: 'ギルド長', role: 'suggest', existing: glossary });
});

test('contexts는 최대 3개이고 앞뒤 40자이며 가능하면 서로 다른 회차를 먼저 쓴다', () => {
  const result = collectScanCandidates(
    [
      chapter('c1', ['A1ミナ', 'A2ミナ']),
      chapter('c2', ['B1ミナ']),
      chapter('c3', ['C1ミナ']),
      chapter('c4', ['D1ミナ']),
    ],
    [term('ミナ')],
  );
  expect(result[0]?.count).toBe(5);
  expect(result[0]?.contexts).toEqual(['A1ミナ', 'B1ミナ', 'C1ミナ']);

  const long = collectScanCandidates(
    [chapter('c1', [`${'あ'.repeat(45)}ミナ${'い'.repeat(45)}`])],
    [term('ミナ')],
  );
  expect(long[0]?.contexts).toEqual([`${'あ'.repeat(40)}ミナ${'い'.repeat(40)}`]);
});

test('루비가 정확히 붙은 이름은 ruby를 가진다', () => {
  const result = collectScanCandidates(
    [
      {
        chapterId: 'c1',
        paragraphs: [{ text: '北嶋は笑った。', ruby: [{ start: 0, end: 2, reading: 'きたじま' }] }],
      },
    ],
    [],
  );
  expect(result).toEqual([
    expect.objectContaining({ source: '北嶋', role: 'new', ruby: 'きたじま' }),
  ]);
  expect(result[0]).not.toHaveProperty('existing');
});

test('script는 가타카나·한자·섞임·그 밖을 구분한다', () => {
  const result = collectScanCandidates(
    [chapter('c1', ['カミラと王都と王都のカミラとALICE。'])],
    [term('カミラ'), term('王都'), term('王都のカミラ'), term('ALICE')],
  );
  const scripts = Object.fromEntries(result.map((item) => [item.source, item.script]));
  expect(scripts).toEqual({
    カミラ: 'katakana',
    王都: 'kanji',
    王都のカミラ: 'mixed',
    ALICE: 'other',
  });
});

test('existing 표기가 발음과 어긋난 가타카나 항목은 kanaFlag가 true다', () => {
  const result = collectScanCandidates(
    [chapter('c1', ['アーケンとカミラが来た。'])],
    [term('アーケン', { target: '실베로스' }), term('カミラ', { target: '카밀라' })],
  );
  const flags = Object.fromEntries(result.map((item) => [item.source, item.kanaFlag]));
  expect(flags).toEqual({ アーケン: true, カミラ: false });
});

test('실제 KANJIDIC2를 넘기면 王都의 한자 힌트에 왕·도가 있다', async () => {
  const dic = await loadKanjidic();
  const result = collectScanCandidates([chapter('c1', ['王都へ向かう。'])], [term('王都')], dic);
  const kanji = result[0]?.kanji ?? [];
  expect(kanji.map((item) => item.char)).toEqual(['王', '都']);
  expect(kanji[0]?.ko).toContain('왕');
  expect(kanji[1]?.ko).toContain('도');
  expect(kanji[0]?.en.length).toBeLessThanOrEqual(3);
});

test('사전이 없으면 kanji 힌트를 붙이지 않는다', () => {
  const result = collectScanCandidates([chapter('c1', ['王都へ向かう。'])], [term('王都')]);
  expect(result[0]).not.toHaveProperty('kanji');
});

test('정렬은 사람·기계 항목 먼저, 등장 횟수 내림차순, 같으면 코드포인트순이고 상한을 적용한다', () => {
  const chapters = [
    chapter('c1', [
      'ルクとミナとカイとルク。アルベルトは。アルベルトは。アルベルトは。アルベルトは。アルベルトは。',
    ]),
  ];
  const glossary = [term('ミナ'), term('カイ'), term('ルク')];
  const all = collectScanCandidates(chapters, glossary);
  expect(all.map((item) => [item.source, item.role, item.count])).toEqual([
    ['ルク', 'suggest', 2],
    ['カイ', 'suggest', 1],
    ['ミナ', 'suggest', 1],
    ['アルベルト', 'new', 5],
  ]);
  const limited = collectScanCandidates(chapters, glossary, null, 2);
  expect(limited.map((item) => item.source)).toEqual(['ルク', 'カイ']);
});

test('이름 목록을 주면 목록 밖 후보는 빼고, 규칙에 안 잡힌 목록 이름도 원문에 있으면 후보가 되며, 원문에 없으면 뺀다', () => {
  const result = collectScanCandidates(
    [
      chapter('c1', [
        'アルベルトは剣を抜いた。ルカは去った。アルベルトが笑う。ルカが笑う。ミナは王都へ行く。',
      ]),
    ],
    [term('王都')],
    null,
    60,
    ['アルベルト', 'ミナ', 'ギルド'],
  );
  expect(result.map((item) => [item.source, item.role, item.count])).toEqual([
    ['アルベルト', 'new', 2],
    ['ミナ', 'new', 1],
  ]);
});

test('이름 목록을 주면 limit 인자를 무시하고 목록 길이(최대 200)를 상한으로 쓴다', () => {
  const syllable = (index: number) => String.fromCharCode(0x30a1 + index);
  const names = Array.from(
    { length: 201 },
    (_, index) => `カ${syllable(index % 84)}${syllable(Math.floor(index / 84))}`,
  );
  const text = names.map((name) => `${name}が笑う。`).join('');
  const result = collectScanCandidates([chapter('c1', [text])], [], null, 1, names);
  expect(result).toHaveLength(200);
  expect(
    collectScanCandidates([chapter('c1', [text])], [], null, 1, names.slice(0, 3)),
  ).toHaveLength(3);
});
