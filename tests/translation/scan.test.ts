import { expect, test } from 'vitest';
import { scanNameCandidates } from '../../src/translation/scan';

const chapter = (
  chapterId: string,
  texts: string[],
  ruby: { p: number; start: number; end: number; reading: string }[] = [],
) => ({
  chapterId,
  paragraphs: texts.map((text, index) => ({
    id: `${chapterId}-${index}`,
    text,
    ruby: ruby
      .filter((entry) => entry.p === index)
      .map(({ start, end, reading }) => ({ start, end, reading })),
  })),
});

test('ruby pairs become candidates with their reading even when they appear once', () => {
  const result = scanNameCandidates(
    [chapter('c1', ['北嶋は笑った。'], [{ p: 0, start: 0, end: 2, reading: 'きたじま' }])],
    [],
  );
  expect(result).toEqual([
    { source: '北嶋', reading: 'きたじま', kind: 'ruby', count: 1, chapterIds: ['c1'] },
  ]);
});
test('katakana names need repeated appearances and keep a middle-dot full name as one candidate', () => {
  const result = scanNameCandidates(
    [
      chapter('c1', ['アルベルト・フォンは剣を抜いた。', 'ミナが来た。']),
      chapter('c2', ['アルベルト・フォンが笑う。ーーー']),
    ],
    [],
  );
  expect(result.map((entry) => [entry.source, entry.count, entry.chapterIds])).toEqual([
    ['アルベルト・フォン', 2, ['c1', 'c2']],
  ]);
});
test('names already in the glossary or preset are skipped, including width variants', () => {
  const result = scanNameCandidates(
    [chapter('c1', ['アルベルトとギルドとギルド。アルベルト。'])],
    [{ source: 'ｱﾙﾍﾞﾙﾄ', target: '알베르트', aliases: [], category: '', note: '' }],
    [{ source: 'ギルド', target: '길드', aliases: [], category: '', note: '' }],
  );
  expect(result).toEqual([]);
});
test('ruby text is counted once, promotes a previous katakana hit and auto candidates remain discoverable', () => {
  const result = scanNameCandidates(
    [
      chapter('c1', ['アルベルト。']),
      chapter('c2', ['アルベルト。'], [{ p: 0, start: 0, end: 5, reading: 'あるべると' }]),
    ],
    [
      {
        source: 'アルベルト',
        target: '미확정',
        aliases: [],
        category: '',
        note: '',
        origin: 'auto',
      },
    ],
  );
  expect(result).toEqual([
    {
      source: 'アルベルト',
      reading: 'あるべると',
      kind: 'ruby',
      count: 2,
      chapterIds: ['c1', 'c2'],
    },
  ]);
});
