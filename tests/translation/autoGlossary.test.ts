import { expect, test, vi } from 'vitest';
import {
  autoGlossaryCandidates,
  createAutoGlossary,
  glossaryRequest,
  mergeGlossaryProposals,
  parseGlossaryProposals,
  shouldGenerateGlossary,
} from '../../src/translation/autoGlossary';
import type {
  GuidanceDraft,
  GuidanceRepository,
  GuidanceTerm,
  WorkGuidance,
} from '../../src/translation/guidance';
import type { ProviderSession, SelectedModel } from '../../src/contracts/reading';
import { source } from '../providers/wholeChapterFixture';

const term = (overrides: Partial<GuidanceTerm> & { source: string }): GuidanceTerm => ({
  target: '번역',
  aliases: [],
  category: '인명',
  note: '',
  ...overrides,
});

const paragraph = (text: string, ruby: { start: number; end: number; reading: string }[] = []) => ({
  text,
  ruby,
});

test('candidates keep ruby pairs and katakana names repeated within the chapter', () => {
  const candidates = autoGlossaryCandidates(
    [
      paragraph('北嶋は笑った。', [{ start: 0, end: 2, reading: 'きたじま' }]),
      paragraph('アルベルトが来た。'),
      paragraph('アルベルトは去った。'),
      paragraph('ヴォルフが一度だけ現れた。'),
    ],
    [],
  );
  expect(candidates).toEqual(expect.arrayContaining(['北嶋', 'アルベルト']));
  expect(candidates).not.toContain('ヴォルフ');
});

test('candidates skip names already in the glossary, including aliases', () => {
  const candidates = autoGlossaryCandidates(
    [
      paragraph('北嶋は笑った。', [{ start: 0, end: 2, reading: 'きたじま' }]),
      paragraph('エリーゼ・ロイが来た。'),
      paragraph('エリーゼ・ロイは去った。'),
      paragraph('アルベルトが来た。'),
      paragraph('アルベルトは去った。'),
    ],
    [
      term({ source: '北嶋' }),
      term({ source: 'エリーゼ・ロイ', origin: 'model' }),
      term({ source: 'ベルナルド', aliases: ['アルベルト'] }),
    ],
  );
  expect(candidates).toEqual([]);
});

test('shouldGenerate is true when rule candidates exist', () => {
  expect(shouldGenerateGlossary(['北嶋'], [term({ source: '北嶋', origin: 'model' })])).toBe(true);
});

test('shouldGenerate is true when no applied term exists, so the first chapter gets a glossary', () => {
  expect(shouldGenerateGlossary([], [])).toBe(true);
  expect(shouldGenerateGlossary([], [term({ source: '北嶋', origin: 'auto' })])).toBe(true);
});

test('shouldGenerate is false when no candidates exist and applied terms are already present', () => {
  expect(shouldGenerateGlossary([], [term({ source: '北嶋', origin: 'scan' })])).toBe(false);
  expect(shouldGenerateGlossary([], [term({ source: '北嶋' })])).toBe(false);
});

const chapterText = '北嶋は笑った。アルベルトが来た。';

test('parse drops sources absent from the chapter, targets with kana, and targets without hangul', () => {
  const result = parseGlossaryProposals(
    {
      terms: [
        { source: '없는이름', target: '없는이름', category: '인명' },
        { source: '北嶋', target: 'きたじま', category: '인명' },
        { source: 'アルベルト', target: 'Albert', category: '인명' },
        { source: '北嶋', target: '기타지마', category: '인명' },
      ],
    },
    chapterText,
  );
  expect(result).toEqual([{ source: '北嶋', target: '기타지마', category: '인명' }]);
});

test('parse removes duplicate sources and keeps the first one', () => {
  const result = parseGlossaryProposals(
    [
      { source: 'アルベルト', target: '알베르트', category: '인명' },
      { source: 'アルベルト', target: '앨버트', category: '인명' },
    ],
    chapterText,
  );
  expect(result).toEqual([{ source: 'アルベルト', target: '알베르트', category: '인명' }]);
});

test('parse caps proposals at forty', () => {
  const names = Array.from(
    { length: 50 },
    (_, index) => `名前${String.fromCharCode(0x4e00 + index)}`,
  );
  const result = parseGlossaryProposals(
    names.map((source, index) => ({ source, target: `이름${index}`, category: '인명' })),
    names.join('。'),
  );
  expect(result).toHaveLength(40);
  expect(result[0]?.source).toBe(names[0]);
});

test('parse keeps a category from the schema and falls back to 기타 for anything else', () => {
  const result = parseGlossaryProposals(
    [
      { source: '北嶋', target: '기타지마', category: '지명' },
      { source: 'アルベルト', target: '알베르트', category: '무엇인지모름' },
    ],
    chapterText,
  );
  expect(result.map((entry) => entry.category)).toEqual(['지명', '기타']);
});

test('parse returns nothing for malformed or non-array responses', () => {
  expect(parseGlossaryProposals(null, chapterText)).toEqual([]);
  expect(parseGlossaryProposals('text', chapterText)).toEqual([]);
  expect(parseGlossaryProposals({ terms: 'x' }, chapterText)).toEqual([]);
  expect(parseGlossaryProposals([{ source: '北嶋' }], chapterText)).toEqual([]);
});

test('glossaryRequest builds the fixed prompt, schema and output limit', () => {
  const request = glossaryRequest(chapterText, ['北嶋', 'アルベルト']);
  expect(request.maxTokens).toBe(1500);
  expect(request.system).toContain('Return only JSON that matches the schema.');
  expect(request.user).toBe(
    'Candidate names found by a rule-based scan (some may be ordinary words):\n北嶋 アルベルト\n\nAlso add proper nouns and epithets you find in this chapter.\n\nChapter text:\n' +
      chapterText,
  );
  expect(request.schema).toMatchObject({
    type: 'object',
    required: ['terms'],
    additionalProperties: false,
  });
});

test('merge leaves names already present in any origin untouched and appends new model terms', () => {
  const existing = [
    term({ source: '北嶋', target: '기타지마', aliases: ['キタジマ'] }),
    term({
      source: 'アルベルト',
      target: '알베르트',
      origin: 'scan',
      evidence: [{ kind: 'ruby', note: '루비' }],
    }),
    term({ source: 'ミナ', target: '미나', origin: 'model' }),
  ];
  const before = structuredClone(existing);
  const result = mergeGlossaryProposals(existing, [
    { source: '北嶋', target: '다른', category: '인명' },
    { source: 'キタジマ', target: '다른', category: '인명' },
    { source: 'アルベルト', target: '다른', category: '인명' },
    { source: 'ミナ', target: '다른', category: '인명' },
    { source: 'リン', target: '린', category: '인명' },
  ]);
  expect(result).toEqual([
    ...before,
    { source: 'リン', target: '린', aliases: [], category: '인명', note: '', origin: 'model' },
  ]);
  expect(existing).toEqual(before);
});

test('candidates skip names of auto terms too, so an unapplied name is not proposed again', () => {
  const candidates = autoGlossaryCandidates(
    [
      paragraph('アルベルトが来た。'),
      paragraph('アルベルトは去った。'),
      paragraph('ヴォルフが来た。'),
      paragraph('ヴォルフは去った。'),
    ],
    [
      term({ source: 'アルベルト', origin: 'auto' }),
      term({ source: 'ベルナルド', aliases: ['ヴォルフ'], origin: 'auto' }),
    ],
  );
  expect(candidates).toEqual([]);
});

test('merge turns an auto term matched by name into a model term in place and keeps its other fields', () => {
  const existing = [
    term({ source: '北嶋', target: '기타지마' }),
    term({
      source: 'アルベルト',
      target: '아르베르토',
      aliases: ['アル'],
      category: '인명',
      note: '메모',
      origin: 'auto',
    }),
    term({
      source: 'ミナ',
      target: '미나',
      origin: 'scan',
      evidence: [{ kind: 'ruby', note: '루비' }],
    }),
  ];
  const before = structuredClone(existing);
  const result = mergeGlossaryProposals(existing, [
    { source: 'アル', target: '알베르트', category: '별명' },
    { source: '北嶋', target: '다른', category: '인명' },
    { source: 'ミナ', target: '다른', category: '인명' },
  ]);
  expect(result).toEqual([
    before[0],
    {
      source: 'アルベルト',
      target: '알베르트',
      aliases: ['アル'],
      category: '별명',
      note: '메모',
      origin: 'model',
    },
    before[2],
  ]);
  expect(existing).toEqual(before);
});

const selection: SelectedModel = {
  connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 0 },
  modelId: 'local',
};
const chapterOf = (...texts: string[]) => ({
  ...source,
  paragraphs: texts.map((text, index) => ({ id: `p${index}`, text, ruby: [] })),
});
const noJson: ProviderSession = {
  listModels: async () => [],
  translateChapter: async () => {
    throw new Error('unused');
  },
};
function modelSession(value: unknown) {
  const completeJson = vi.fn<(request: { user: string }, signal: AbortSignal) => Promise<unknown>>(
    async () => value,
  );
  const session: ProviderSession = {
    listModels: async () => [],
    translateChapter: async () => {
      throw new Error('unused');
    },
    completeJson,
  };
  return { session, completeJson };
}
function memoryGuidance(initial?: GuidanceDraft) {
  let current: GuidanceDraft | null = initial ?? null;
  const save = vi.fn(async (workId: string, draft: GuidanceDraft) => {
    current = structuredClone(draft);
    return { schemaVersion: 1, workId, hash: 'hash', ...structuredClone(draft) } as WorkGuidance;
  });
  const repository: GuidanceRepository = {
    read: async (workId: string) =>
      current
        ? ({ schemaVersion: 1, workId, hash: 'hash', ...structuredClone(current) } as WorkGuidance)
        : null,
    save,
  };
  return { repository, save };
}
const signal = () => new AbortController().signal;

test('createAutoGlossary skips a provider without completeJson and saves nothing', async () => {
  const { repository, save } = memoryGuidance();
  const run = createAutoGlossary(() => noJson, repository);
  await expect(
    run({
      workId: 'n1234ab',
      source: chapterOf('北嶋は笑った。', '北嶋は去った。'),
      selection,
      signal: signal(),
    }),
  ).resolves.toBe('skipped');
  expect(save).not.toHaveBeenCalled();
});

test('createAutoGlossary does not call the model when no candidates exist and applied terms are present', async () => {
  const { repository, save } = memoryGuidance({
    terms: [term({ source: '北嶋', origin: 'scan' })],
    voices: [],
  });
  const { session, completeJson } = modelSession({ terms: [] });
  const run = createAutoGlossary(() => session, repository);
  await expect(
    run({ workId: 'n1234ab', source: chapterOf('北嶋は笑った。'), selection, signal: signal() }),
  ).resolves.toBe('skipped');
  expect(completeJson).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test('createAutoGlossary saves only new model terms and keeps human terms, plot summary and voices', async () => {
  const human = term({ source: '北嶋', target: '기타지마', aliases: ['キタジマ'] });
  const voice = { name: '北嶋', aliases: [], instruction: '반말' };
  const { repository, save } = memoryGuidance({
    terms: [human],
    voices: [voice],
    plotSummary: '요약',
  });
  const { session } = modelSession({
    terms: [
      { source: '北嶋', target: '다른', category: '인명' },
      { source: 'リリアン', target: '릴리언', category: '인명' },
    ],
  });
  const run = createAutoGlossary(() => session, repository);
  await expect(
    run({
      workId: 'n1234ab',
      source: chapterOf('北嶋は笑った。', 'リリアンが来た。', 'リリアンは去った。'),
      selection,
      signal: signal(),
    }),
  ).resolves.toBe('added');
  expect(save).toHaveBeenCalledWith('n1234ab', {
    terms: [
      human,
      {
        source: 'リリアン',
        target: '릴리언',
        aliases: [],
        category: '인명',
        note: '',
        origin: 'model',
      },
    ],
    voices: [voice],
    plotSummary: '요약',
  });
});

test('createAutoGlossary saves nothing when every proposal is already present', async () => {
  const { repository, save } = memoryGuidance({
    terms: [term({ source: '北嶋', target: '기타지마' })],
    voices: [],
  });
  const { session } = modelSession({
    terms: [{ source: '北嶋', target: '다른', category: '인명' }],
  });
  const run = createAutoGlossary(() => session, repository);
  await expect(
    run({
      workId: 'n1234ab',
      source: chapterOf('北嶋は笑った。ミナミが来た。ミナミは去った。'),
      selection,
      signal: signal(),
    }),
  ).resolves.toBe('skipped');
  expect(save).not.toHaveBeenCalled();
});

test('createAutoGlossary saves an auto term that a proposal matches as a model term, keeping the count', async () => {
  const { repository, save } = memoryGuidance({
    terms: [
      term({ source: 'アルベルト', target: '아르베르토', origin: 'auto' }),
      term({ source: '北嶋', origin: 'scan' }),
    ],
    voices: [],
  });
  const { session } = modelSession({
    terms: [{ source: 'アルベルト', target: '알베르트', category: '인명' }],
  });
  const run = createAutoGlossary(() => session, repository);
  await expect(
    run({
      workId: 'n1234ab',
      source: chapterOf('アルベルトが来た。ミナミが来た。ミナミは去った。'),
      selection,
      signal: signal(),
    }),
  ).resolves.toBe('added');
  expect(save.mock.calls[0]?.[1].terms).toEqual([
    {
      source: 'アルベルト',
      target: '알베르트',
      aliases: [],
      category: '인명',
      note: '',
      origin: 'model',
    },
    term({ source: '北嶋', origin: 'scan' }),
  ]);
});

test('createAutoGlossary sends only the first 12,000 characters of the chapter', async () => {
  const { repository } = memoryGuidance();
  const { session, completeJson } = modelSession({ terms: [] });
  const run = createAutoGlossary(() => session, repository);
  await run({
    workId: 'n1234ab',
    source: chapterOf('あ'.repeat(12000), '末尾'),
    selection,
    signal: signal(),
  });
  const request = completeJson.mock.calls[0]?.[0];
  expect(request?.user.endsWith('あ'.repeat(12000))).toBe(true);
  expect(request?.user).not.toContain('末尾');
});
test('parse drops a one-character or short hiragana source even when the chapter contains it', () => {
  const result = parseGlossaryProposals(
    {
      terms: [
        { source: 'ち', target: '루시아나', category: '인명' },
        { source: '北嶋', target: '기타지마', category: '인명' },
      ],
    },
    '……ちょっと北嶋は笑った。',
  );
  expect(result).toEqual([{ source: '北嶋', target: '기타지마', category: '인명' }]);
});
