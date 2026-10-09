import { describe, expect, it } from 'vitest';
import { ReaderError } from '../../../src/contracts';
import {
  GEMINI_BASE_URL,
  normalizeGeminiBaseUrl,
  normalizeGeminiModel,
} from '../../../src/providers/gemini';

describe('Gemini fixed endpoint and model normalization', () => {
  it.each([GEMINI_BASE_URL, GEMINI_BASE_URL + '/'])('normalizes fixed endpoint %s', (value) => {
    expect(normalizeGeminiBaseUrl(value)).toBe(GEMINI_BASE_URL);
  });
  it.each([
    'https://evil.test/v1beta',
    'http://generativelanguage.googleapis.com/v1beta',
    GEMINI_BASE_URL + '?',
    GEMINI_BASE_URL + '#',
    GEMINI_BASE_URL + '?key=secret',
    'https://key@generativelanguage.googleapis.com/v1beta',
    GEMINI_BASE_URL + '/../v1beta',
    'https://generativelanguage.googleapis.com:444/v1beta',
  ])('rejects unsafe endpoint %s', (baseUrl) => {
    expect(() => normalizeGeminiBaseUrl(baseUrl)).toThrow(ReaderError);
  });
  it('normalizes explicit models prefix without choosing a model', () => {
    expect(normalizeGeminiModel(' models/gemini-synthetic ')).toBe('gemini-synthetic');
  });
  it.each([
    '',
    ' ',
    '../other',
    'x:y',
    'x?key=secret',
    'x#',
    'x/y',
    'models/',
    'x%2fy',
    '.',
    '..',
    'x\nkey',
  ])('rejects unsafe model %s', (model) => {
    expect(() => normalizeGeminiModel(model)).toThrow(ReaderError);
  });
});
