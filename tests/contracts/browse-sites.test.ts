import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BROWSE_SITES } from '../../src/platform/browseSites';

describe('browse site list', () => {
  it('matches the native site profiles exactly', () => {
    const java = readFileSync(
      'android/app/src/main/java/dev/earlydreamer/jhfreader/SourceSites.java',
      'utf8',
    );
    const native = [
      ...java.matchAll(/new Site\(\s*"([^"]+)",\s*"([^"]+)",\s*hosts\(([^)]*)\)/g),
    ].map((m) => ({
      id: m[1],
      startUrl: m[2],
      hosts: [...m[3]!.matchAll(/"([^"]+)"/g)].map((h) => h[1]).sort(),
    }));
    expect(native.length).toBeGreaterThan(0);
    expect(
      BROWSE_SITES.map(({ id, startUrl, hosts }) => ({ id, startUrl, hosts: [...hosts].sort() })),
    ).toEqual(native);
  });

  it('labels every site for the library picker', () => {
    expect(BROWSE_SITES.map((site) => site.label)).toEqual(['나로우', '카쿠요무']);
  });
});
