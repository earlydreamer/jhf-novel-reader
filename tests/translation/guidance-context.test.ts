import { expect, test } from 'vitest';
import {
  appliedGuidanceHash,
  guidanceContext,
  type WorkGuidance,
} from '../../src/translation/guidance';

const guidance: WorkGuidance = {
  schemaVersion: 1,
  workId: 'n1234ab',
  hash: 'hash',
  terms: [
    { source: 'アル', target: '아르', aliases: [], category: '', note: '' },
    { source: 'アルベルト', target: '알베르트', aliases: ['ベルト様'], category: '', note: '기사' },
  ],
  voices: [{ name: 'アルベルト', aliases: [], instruction: '반말을 쓴다.' }],
};
test('reference data uses the compact Hy-MT terminology lines and ends before the instruction', () => {
  const context = guidanceContext(guidance, 'n1234ab', 'アルベルトが来た。');
  expect(
    context.startsWith(
      'Reference the following translations:\nアルベルト translates to 알베르트 (기사)\n',
    ),
  ).toBe(true);
  expect(context).toContain('アルベルト: 반말을 쓴다.');
  expect(context.endsWith('\n\n')).toBe(true);
  expect(context).not.toContain('{');
});
test('a longer matched name masks shorter names inside it', () => {
  expect(guidanceContext(guidance, 'n1234ab', 'アルベルトが来た。')).not.toContain(
    'アル translates',
  );
  const both = guidanceContext(guidance, 'n1234ab', 'アルとアルベルト。');
  expect(both).toContain('アル translates to 아르');
  expect(both).toContain('アルベルト translates to 알베르트');
});
test('only matched names are listed and unmatched entries are omitted', () => {
  const context = guidanceContext(guidance, 'n1234ab', 'ベルト様は笑った。');
  expect(context).toContain('ベルト様 translates to 알베르트 (기사)');
  expect(context).not.toContain('アル translates');
  expect(context).not.toContain('반말');
  expect(guidanceContext(guidance, 'n1234ab', '誰もいない。')).toBe('');
  expect(() => guidanceContext(guidance, 'n9999zz', 'アル')).toThrow();
});
test('a term alias does not hide a voice with a shorter name of the same character', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [{ source: '合成', target: '가온', aliases: ['合成君'], category: '', note: '' }],
    voices: [{ name: '合成', aliases: [], instruction: '존댓말을 유지한다.' }],
  };
  const context = guidanceContext(value, 'n1234ab', '合成君は来なかった。');
  expect(context).toContain('合成君 translates to 가온');
  expect(context).not.toContain('合成 translates');
  expect(context).toContain('合成: 존댓말을 유지한다.');
});
test('applied hash covers only entries matched in the chapter source', async () => {
  const base = await appliedGuidanceHash(guidance, 'n1234ab', 'アルベルトが来た。');
  expect(base).toMatch(/^[a-f0-9]{64}$/);
  const unrelated: WorkGuidance = {
    ...guidance,
    terms: [
      ...guidance.terms,
      { source: '未登場', target: '미등장', aliases: [], category: '', note: '' },
    ],
  };
  expect(await appliedGuidanceHash(unrelated, 'n1234ab', 'アルベルトが来た。')).toBe(base);
  const changed: WorkGuidance = {
    ...guidance,
    terms: guidance.terms.map((term) =>
      term.source === 'アルベルト' ? { ...term, target: '알버트' } : term,
    ),
  };
  expect(await appliedGuidanceHash(changed, 'n1234ab', 'アルベルトが来た。')).not.toBe(base);
  expect(await appliedGuidanceHash(guidance, 'n1234ab', '誰もいない。')).toBeUndefined();
});
test('unconfirmed scan candidates are neither injected nor hashed', async () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [
      ...guidance.terms,
      { source: 'ミナ', target: '미나', aliases: [], category: '', note: '', origin: 'auto' },
    ],
  };
  const context = guidanceContext(value, 'n1234ab', 'ミナとアルベルト。');
  expect(context).not.toContain('ミナ translates');
  expect(await appliedGuidanceHash(value, 'n1234ab', 'ミナとアルベルト。')).toBe(
    await appliedGuidanceHash(guidance, 'n1234ab', 'ミナとアルベルト。'),
  );
});
const preset = [
  { source: '冒険者ギルド', target: '모험가 길드', aliases: [], category: '', note: '' },
  { source: 'アルベルト', target: '프리셋표기', aliases: [], category: '', note: '' },
];
test('the built-in preset applies without a work glossary and a work entry overrides it', async () => {
  const presetOnly = guidanceContext(null, 'n1234ab', '冒険者ギルドへ行く。', preset);
  expect(presetOnly).toContain('冒険者ギルド translates to 모험가 길드');
  expect(await appliedGuidanceHash(null, 'n1234ab', '冒険者ギルドへ行く。', preset)).toMatch(
    /^[a-f0-9]{64}$/,
  );
  const merged = guidanceContext(guidance, 'n1234ab', 'アルベルトと冒険者ギルド。', preset);
  expect(merged).toContain('アルベルト translates to 알베르트');
  expect(merged).not.toContain('프리셋표기');
  expect(merged).toContain('冒険者ギルド translates to 모험가 길드');
  expect(guidanceContext(null, 'n1234ab', '冒険者ギルド。', [])).toBe('');
});
