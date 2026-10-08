import { describe, expect, it } from 'vitest';
import { ReaderError } from '../../src/contracts';
import {
  getLocalConnectionGuidance,
  normalizeOpenAICompatibleBaseUrl,
} from '../../src/providers/endpoint';

describe('OpenAI-compatible endpoint normalization', () => {
  it.each(['http://host', 'http://host/', 'http://host/v1', 'http://host/v1/'])(
    'normalizes %s without duplicate v1',
    (url) => expect(normalizeOpenAICompatibleBaseUrl(url)).toBe('http://host/v1'),
  );
  it.each([
    'https://user:secret@host',
    'ftp://host',
    'http://host?q=secret',
    'http://host/#x',
    'http://host/v1/chat/completions',
    'not a URL',
  ])('rejects invalid or credential-bearing endpoint %s', (baseUrl) => {
    expect(() => normalizeOpenAICompatibleBaseUrl(baseUrl)).toThrow(ReaderError);
  });
  it.each(['http://host?', 'http://host#', 'http://host/v1?', 'http://host/v1/#'])(
    'rejects empty URL delimiters in %s',
    (baseUrl) => {
      expect(() => normalizeOpenAICompatibleBaseUrl(baseUrl)).toThrow(ReaderError);
    },
  );
  it('provides local troubleshooting without echoing endpoint or changing settings', () => {
    expect(getLocalConnectionGuidance()).toContain('localhost');
    expect(getLocalConnectionGuidance()).toContain('LAN');
  });
});
