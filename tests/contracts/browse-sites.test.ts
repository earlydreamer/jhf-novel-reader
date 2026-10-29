import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BROWSE_SITES } from '../../src/platform/browseSites';

/** SourceSites.java의 프로필 선언을 읽는다. 정해진 형식이 아닌 선언이 있으면 조용히 건너뛰지 않고 실패한다. */
function nativeSites(java: string) {
  const declarations = java.match(/new Site\(/g)?.length ?? 0;
  const sites = [...java.matchAll(/new Site\(\s*"([^"]+)",\s*"([^"]+)",\s*hosts\(([^)]*)\)/g)].map(
    (m) => ({
      id: m[1],
      startUrl: m[2],
      hosts: [...m[3]!.matchAll(/"([^"]+)"/g)].map((h) => h[1]).sort(),
    }),
  );
  if (sites.length !== declarations)
    throw new Error(`SourceSites 선언 ${declarations}개 중 ${sites.length}개만 읽었습니다.`);
  return sites;
}

describe('browse site list', () => {
  it('matches the native site profiles exactly', () => {
    const java = readFileSync(
      'android/app/src/main/java/dev/earlydreamer/jhfreader/SourceSites.java',
      'utf8',
    );
    const native = nativeSites(java);
    expect(native.length).toBeGreaterThan(0);
    expect(
      BROWSE_SITES.map(({ id, startUrl, hosts }) => ({ id, startUrl, hosts: [...hosts].sort() })),
    ).toEqual(native);
  });

  it('refuses a profile declared in a form the check cannot read', () => {
    const java = `new Site(
        "a",
        "https://a.test/",
        hosts("a.test"),
    new Site(NAROU_ID, NAROU_START, NAROU_HOSTS,`;
    expect(() => nativeSites(java)).toThrow('2개 중 1개');
  });

  it('labels every site for the library picker', () => {
    expect(BROWSE_SITES.map((site) => site.label)).toEqual(['소설가가 되자', '카쿠요무', 'pixiv']);
  });
});
