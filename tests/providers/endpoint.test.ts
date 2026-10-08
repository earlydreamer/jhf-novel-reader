import { describe, expect, it } from 'vitest';
import {
  getLocalConnectionGuidance,
  normalizeOpenAICompatibleBaseUrl,
} from '../../src/providers/endpoint';

describe('OpenAI-compatible endpoint normalization', () => {
  it.each(['http://host', 'http://host/', 'http://host/v1', 'http://host/v1/'])(
    'normalizes %s without duplicate v1',
    (url) => expect(normalizeOpenAICompatibleBaseUrl(url)).toBe('http://host/v1'),
  );
  it('provides local troubleshooting without echoing endpoint or changing settings', () => {
    expect(getLocalConnectionGuidance()).toContain('localhost');
    expect(getLocalConnectionGuidance()).toContain('LAN');
  });
});
