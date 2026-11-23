import { expect, test } from 'vitest';
import type { SelectedModel } from '../../src/contracts/reading';
import type { GuidanceRepository } from '../../src/translation/guidance';
import {
  contextHints,
  DEFAULT_SHARED_TERMS,
  readReferenceTerms,
  UNIVERSAL_PRESET,
} from '../../src/translation/preset';

const selection = (
  provider: SelectedModel['connection']['provider'],
  extra: Partial<SelectedModel> = {},
): SelectedModel => ({
  connection: { provider, baseUrl: 'https://example.test/v1', revision: 1 },
  modelId: 'synthetic-model',
  ...extra,
});
const sharedRepository = { readShared: async () => null } as unknown as GuidanceRepository;
const limits = { contextTokens: 8192, inputBudgetTokens: 4096, maxOutputTokens: 2048 };

test('every provider path that accepts reference data reads the shared glossary', async () => {
  for (const choice of [
    selection('gemini', { translationMode: 'stream' }),
    selection('gemini', { translationMode: 'legacy' }),
    selection('openai-compatible', { translationMode: 'stream' }),
    selection('openai-compatible', { translationMode: 'legacy', limits }),
  ])
    await expect(readReferenceTerms(choice, sharedRepository)).resolves.toBe(DEFAULT_SHARED_TERMS);
});

test('a local plain-text request without segments gets no shared terms instead of failing', async () => {
  await expect(
    readReferenceTerms(
      selection('openai-compatible', { translationMode: 'legacy' }),
      sharedRepository,
    ),
  ).resolves.toEqual([]);
});

test('without a shared glossary store the pre-#330 preset rule is kept', async () => {
  await expect(readReferenceTerms(selection('gemini'))).resolves.toEqual([]);
  await expect(readReferenceTerms(selection('openai-compatible', { limits }))).resolves.toBe(
    UNIVERSAL_PRESET,
  );
});

test('a numeric month followed by a duration phrase gets a duration hint', () => {
  const hints = contextHints('この調子なら1月もすれば終わる。彼女は３月もしないうちに戻った。');
  expect(hints).toContain('「1月」');
  expect(hints).toContain('「３月」');
  expect(hints.split('\n').filter(Boolean)).toHaveLength(2);
});
test('calendar months and kanji months get no hint', () => {
  expect(contextHints('1月に入ると街は静かになった。一月もすれば治る。')).toBe('');
});
test('the preset has unique sources and no single-character entries', () => {
  const sources = UNIVERSAL_PRESET.map((term) => term.source.normalize('NFKC'));
  expect(new Set(sources).size).toBe(sources.length);
  expect(UNIVERSAL_PRESET.every((term) => [...term.source].length > 1 && term.target.trim())).toBe(
    true,
  );
});
