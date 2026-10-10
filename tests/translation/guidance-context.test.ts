import { expect, test } from 'vitest';
import {
  appliedGuidance,
  appliedGuidanceHash,
  guidanceContext,
  isMachineTerm,
  isUnsafeTermName,
  streamingGuidanceContext,
  validateGuidance,
  type GuidanceTerm,
  type WorkGuidance,
} from '../../src/translation/guidance';
import { digest } from '../../src/storage/journal';

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

async function signed(terms: unknown[]): Promise<unknown> {
  return {
    schemaVersion: 1,
    workId: 'n1234ab',
    hash: await digest(['n1234ab', terms, []]),
    terms,
    voices: [],
  };
}
const evidence = [
  { kind: 'wikipedia', url: 'https://ja.wikipedia.org/wiki/アルベルト', note: '기사' },
];
test('model과 scan 항목은 출처와 근거를 담아 저장 형식을 통과한다', async () => {
  await expect(
    validateGuidance(
      await signed([
        { source: 'アル', target: '아르', aliases: [], category: '', note: '', origin: 'model' },
        {
          source: 'アルベルト',
          target: '알베르트',
          aliases: [],
          category: '고유명사',
          note: '',
          origin: 'scan',
          evidence,
        },
      ]),
    ),
  ).resolves.toMatchObject({ workId: 'n1234ab' });
});
test('evidence는 scan 항목에만 있고, 1~6개이며, url은 https로 파싱되는 값만 받는다', async () => {
  const scan = (patch: Record<string, unknown>) =>
    signed([
      {
        source: 'アル',
        target: '아르',
        aliases: [],
        category: '',
        note: '',
        origin: 'scan',
        evidence,
        ...patch,
      },
    ]);
  const rejects = (value: Promise<unknown>) =>
    expect(value.then(validateGuidance)).rejects.toThrow();
  await rejects(
    signed([
      {
        source: 'アル',
        target: '아르',
        aliases: [],
        category: '',
        note: '',
        origin: 'model',
        evidence,
      },
    ]),
  );
  await rejects(scan({ evidence: [] }));
  await rejects(scan({ evidence: Array.from({ length: 7 }, () => evidence[0]) }));
  await rejects(
    scan({ evidence: [{ kind: 'wikipedia', url: 'http://ja.wikipedia.org/x', note: '' }] }),
  );
  await rejects(scan({ evidence: [{ kind: 'wikipedia', url: 'https://[bad', note: '' }] }));
  await rejects(scan({ evidence: [{ kind: 'blog', note: '' }] }));
  await rejects(scan({ evidence: [{ kind: 'model', note: 'x'.repeat(201) }] }));
  await rejects(scan({ evidence: [{ kind: 'model', note: '', extra: 1 }] }));
  await expect(
    validateGuidance(await scan({ evidence: [{ kind: 'model', note: '' }] })),
  ).resolves.toBeTruthy();
});
test('isMachineTerm은 자동 생성·정밀스캔·미확정 후보를 기계 항목으로 본다', () => {
  const term = (origin?: GuidanceTerm['origin']): GuidanceTerm => ({
    source: 'アル',
    target: '아르',
    aliases: [],
    category: '',
    note: '',
    ...(origin ? { origin } : {}),
  });
  expect(isMachineTerm(term())).toBe(false);
  expect(isMachineTerm(term('auto'))).toBe(true);
  expect(isMachineTerm(term('model'))).toBe(true);
  expect(isMachineTerm(term('scan'))).toBe(true);
});
test('model과 scan 항목은 번역에 적용되고 auto 후보는 적용되지 않는다', async () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [
      { source: 'ミナ', target: '미나', aliases: [], category: '', note: '', origin: 'model' },
      { source: 'カイ', target: '카이', aliases: [], category: '', note: '', origin: 'scan' },
      { source: 'リン', target: '린', aliases: [], category: '', note: '', origin: 'auto' },
    ],
  };
  const context = guidanceContext(value, 'n1234ab', 'ミナとカイとリン。');
  expect(context).toContain('ミナ translates to 미나');
  expect(context).toContain('カイ translates to 카이');
  expect(context).not.toContain('リン translates');
});
test('한 글자와 두 글자 이하 히라가나(장음 포함) 원문은 이름으로 쓰기 안전하지 않다', () => {
  for (const name of ['ち', '希', 'ゆい', 'ゆー', 'ー', ' ち ']) {
    expect(isUnsafeTermName(name)).toBe(true);
  }
  for (const name of ['さくら', 'ルシアナ', '希美', '魔王']) {
    expect(isUnsafeTermName(name)).toBe(false);
  }
});
test('짧은 히라가나 원문은 긴 이름 안에서 적용되지 않고 긴 이름만 적용된다', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [
      { source: 'ち', target: '루시아나', aliases: [], category: '', note: '' },
      { source: 'ルシアナ', target: '루시아나', aliases: [], category: '', note: '' },
    ],
    voices: [],
  };
  const applied = appliedGuidance(value, 'n1234ab', 'ちょっと、ルシアナ', []);
  expect(applied?.terms.map(({ term, names }) => [term.source, names])).toEqual([
    ['ルシアナ', ['ルシアナ']],
  ]);
  expect(guidanceContext(value, 'n1234ab', 'ちょっと、ルシアナ')).not.toContain('ち translates');
  expect(guidanceContext(value, 'n1234ab', 'ちょっと心配ですね')).toBe('');
});
test('확정 이름과 후보 이름을 나눈다', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [
      { source: 'リスト', target: '크리스토퍼', aliases: [], category: '', note: '' },
      { source: 'ルシアナ', target: '루시아나', aliases: [], category: '', note: '' },
    ],
    voices: [],
  };
  const applied = appliedGuidance(value, 'n1234ab', 'クリストファーとルシアナ', [])!;
  expect(applied.terms.map((t) => [t.term.source, t.names, t.candidateNames])).toEqual([
    ['リスト', [], ['リスト']],
    ['ルシアナ', ['ルシアナ'], []],
  ]);
});
test('참고 문구: 후보에는 이름으로 쓰였을 때만 조건이 붙는다', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [
      { source: 'リスト', target: '크리스토퍼', aliases: [], category: '', note: '' },
      { source: 'ルシアナ', target: '루시아나', aliases: [], category: '', note: '' },
    ],
    voices: [],
  };
  const text = guidanceContext(value, 'n1234ab', 'クリストファーとルシアナ', []);
  expect(text).toContain('ルシアナ translates to 루시아나');
  expect(text).toContain(
    'リスト translates to 크리스토퍼 (only where リスト is used as this name)',
  );
});
test('적용 해시는 확정·후보를 합친 이름으로 계산해 예전과 같다', async () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [
      { source: 'リスト', target: '크리스토퍼', aliases: [], category: '', note: '' },
      { source: 'ルシアナ', target: '루시아나', aliases: [], category: '', note: '' },
    ],
    voices: [],
  };
  expect(await appliedGuidanceHash(value, 'n1234ab', 'クリストファーとルシアナ', [])).toBe(
    await digest([
      'n1234ab',
      [
        { term: value.terms[0], names: ['リスト'] },
        { term: value.terms[1], names: ['ルシアナ'] },
      ],
      [],
    ]),
  );
});
test('전각 영숫자가 든 입력도 원문 그대로 비교해 예전 해시와 같다', async () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [{ source: 'Sランク', target: 'S급', aliases: [], category: '', note: '' }],
    voices: [],
  };
  expect(await appliedGuidanceHash(value, 'n1234ab', 'Ｓランクだけ')).toBeUndefined();
  expect(await appliedGuidanceHash(value, 'n1234ab', 'Ｓランクの冒険者とSランク。')).toBe(
    await digest(['n1234ab', [{ term: value.terms[0], names: ['Sランク'] }], []]),
  );
});
test('후보 문구도 확정 문구처럼 메모를 붙인다', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [{ source: 'リスト', target: '크리스토퍼', aliases: [], category: '', note: '기사' }],
    voices: [],
  };
  expect(guidanceContext(value, 'n1234ab', 'クリストファーが来た。')).toContain(
    'リスト translates to 크리스토퍼 (기사) (only where リスト is used as this name)',
  );
  expect(streamingGuidanceContext(value, 'n1234ab', 'クリストファーが来た。', [])).toContain(
    'リスト->크리스토퍼 #기사 (only if used as a name here)',
  );
});
test('짧은 히라가나 별칭만 빠지고 같은 항목의 긴 원문은 남는다', () => {
  const value: WorkGuidance = {
    ...guidance,
    terms: [{ source: 'ルシアナ', target: '루시아나', aliases: ['ゆい'], category: '', note: '' }],
    voices: [],
  };
  expect(appliedGuidance(value, 'n1234ab', 'ゆいとルシアナ', [])?.terms[0]?.names).toEqual([
    'ルシアナ',
  ]);
  expect(guidanceContext(value, 'n1234ab', 'ゆいが来た。')).toBe('');
});
