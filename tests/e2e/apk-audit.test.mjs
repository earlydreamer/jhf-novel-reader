import { expect, it } from 'vitest';
import { auditAssets, auditProvenance, signerCommand, toZipEntry } from './verify-apk.mjs';
it('matches Windows asset paths to the same ZIP entry used for byte comparison', () => {
  expect(toZipEntry('assets\\nested\\app.js')).toBe('assets/nested/app.js');
  expect(toZipEntry('assets/nested/app.js')).toBe('assets/nested/app.js');
});
it('uses the same SDK signer JAR on Windows and the native signer on Linux', () => {
  expect(signerCommand('win32', 'C:\\Android SDK\\build-tools\\35.0.0')).toEqual({
    file: 'java',
    args: ['-jar', 'C:\\Android SDK\\build-tools\\35.0.0\\lib\\apksigner.jar'],
  });
  expect(signerCommand('linux', '/opt/android-sdk/build-tools/35.0.0')).toEqual({
    file: '/opt/android-sdk/build-tools/35.0.0/apksigner',
    args: [],
  });
});
const config = () => ({
  appId: 'app.narou.reader',
  loggingBehavior: 'none',
  plugins: { CapacitorHttp: { enabled: false } },
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
});
const plugins = ['AppPlugin', 'FilesystemPlugin', 'PreferencesPlugin', 'SecureStorage'].map(
  (classpath) => ({ classpath }),
);
const html = `<html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><script src="/assets/app.js"></script></head></html>`;
it('requires web and native builds from the same clean current commit', () => {
  const current = { commit: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false };
  expect(() => auditProvenance(current, current, current)).not.toThrow();
  expect(() => auditProvenance({ ...current, commit: 'c'.repeat(40) }, current, current)).toThrow();
  expect(() => auditProvenance(current, { ...current, tree: 'c'.repeat(40) }, current)).toThrow();
  expect(() => auditProvenance({ ...current, dirty: true }, current, current)).toThrow();
  expect(() => auditProvenance(current, { ...current, dirty: true }, current)).toThrow();
});
it('accepts complete bundled native assets', () =>
  expect(() => auditAssets(config(), plugins, html)).not.toThrow());
it('accepts the HTML entity encoding emitted by Vite for a meta policy', () =>
  expect(() => auditAssets(config(), plugins, html.replaceAll("'", '&#39;'))).not.toThrow());
it.each(['logging', 'patch', 'mixed', 'remote', 'navigation'])(
  'rejects unsafe packaged %s config',
  (key) => {
    const value = config();
    if (key === 'logging') value.loggingBehavior = 'debug';
    if (key === 'patch') value.plugins.CapacitorHttp.enabled = true;
    if (key === 'mixed') value.android.allowMixedContent = true;
    if (key === 'remote') value.server.url = 'https://example.invalid';
    if (key === 'navigation') value.server.allowNavigation = ['*'];
    expect(() => auditAssets(value, plugins, html)).toThrow();
  },
);
it('rejects missing native secure storage', () =>
  expect(() => auditAssets(config(), plugins.slice(0, 3), html)).toThrow());
it('rejects missing policy or an inline script', () => {
  expect(() => auditAssets(config(), plugins, '<head></head>')).toThrow();
  expect(() =>
    auditAssets(config(), plugins, html.replace('</head>', '<script>unsafe()</script></head>')),
  ).toThrow();
});
it('requires a private browser activity and compiled browser classes', async () => {
  const { auditNativeBrowse } = await import('./verify-apk.mjs');
  const manifest =
    'E: activity\n  A: android:name="app.narou.reader.SourceBrowserActivity"\n  A: android:exported(0x01010010)=(type 0x12)0x0\nE: provider\n';
  const dex =
    "Class descriptor : 'Lapp/narou/reader/SourceBrowserActivity;'\nSuperclass : 'Landroidx/appcompat/app/AppCompatActivity;'\nClass descriptor : 'Lapp/narou/reader/SourceBrowserPlugin;'\nClass descriptor : 'Lapp/narou/reader/SourceBrowserPolicy;'\nClass descriptor : 'Lapp/narou/reader/SourceBrowserLoader;'";
  const registration =
    'const-class v0, Lapp/narou/reader/SourceBrowserPlugin;\ninvoke-virtual {v1, v0}, Lapp/narou/reader/MainActivity;.registerPlugin:()V\ninvoke-super {v1, v2}, Lcom/getcapacitor/BridgeActivity;.onCreate:()V';
  expect(() => auditNativeBrowse(manifest, dex, registration)).not.toThrow();
  expect(() => auditNativeBrowse(manifest, dex, '')).toThrow();
  expect(() =>
    auditNativeBrowse(
      manifest.replace('(type 0x12)0x0', '(type 0x12)0xffffffff'),
      dex,
      registration,
    ),
  ).toThrow();
  expect(() =>
    auditNativeBrowse(
      manifest,
      dex.replace('Lapp/narou/reader/SourceBrowserPlugin;', 'missing'),
      registration,
    ),
  ).toThrow();
  expect(() =>
    auditNativeBrowse(
      manifest,
      dex.replace(
        'Landroidx/appcompat/app/AppCompatActivity;',
        'Lcom/getcapacitor/BridgeActivity;',
      ),
      registration,
    ),
  ).toThrow();
});
it('streams native audit outputs larger than the default child-process buffer', async () => {
  const { runToFile } = await import('./verify-apk.mjs');
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'narou-audit-'));
  try {
    const target = join(dir, 'large.bin');
    runToFile(
      process.execPath,
      ['-e', 'process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 42))'],
      target,
    );
    const value = readFileSync(target);
    expect(value.length).toBe(2 * 1024 * 1024);
    expect(value[0]).toBe(42);
    expect(value[value.length - 1]).toBe(42);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
it('buffers packaged asset output larger than the default child-process limit', async () => {
  const { runToBuffer } = await import('./verify-apk.mjs');
  const size = 2 * 1024 * 1024;
  const value = runToBuffer(
    process.execPath,
    ['-e', `process.stdout.write(Buffer.alloc(${size}, 42))`],
    size,
  );
  expect(value.length).toBe(size);
  expect(value[0]).toBe(42);
  expect(value[value.length - 1]).toBe(42);
});
