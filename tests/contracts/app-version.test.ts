import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps package.json as the release version that matches the lockfile', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };
  expect(pkg.version).toMatch(/^\d+\.\d{1,2}\.\d{1,2}$/);
  expect(lock.version).toBe(pkg.version);
  expect(lock.packages['']?.version).toBe(pkg.version);
});

it('derives Android versionName and versionCode from package.json instead of fixed values', () => {
  const gradle = readFileSync('android/app/build.gradle', 'utf8');
  expect(gradle).not.toMatch(/versionCode\s+\d+/);
  expect(gradle).not.toMatch(/versionName\s+["']/);
  expect(gradle).toContain("rootProject.file('../package.json')");
  expect(gradle).toContain('versionCode appVersionCode');
  expect(gradle).toContain('versionName appVersion');
});
