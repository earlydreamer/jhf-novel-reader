import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');
describe('Android packaging guardrails (static, not device execution)', () => {
  it('opts the app into selected dynamic HTTP model hosts while denying source HTTP', () => {
    const path = 'android/app/src/main/res/xml/network_security_config.xml';
    expect(existsSync(path)).toBe(true);
    const policy = read(path);
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain(
      'android:networkSecurityConfig="@xml/network_security_config"',
    );
    expect(policy).toContain('<base-config cleartextTrafficPermitted="true"');
    expect(policy).toContain('<domain-config cleartextTrafficPermitted="false">');
    expect(policy).toContain('<domain includeSubdomains="true">syosetu.com</domain>');
    expect(policy).not.toMatch(/debug-overrides|certificates.*(?:user|raw)/);
  });
  it('limits the WebView to bundled content and keeps native HTTP explicit', () => {
    const page = read('vite.config.ts');
    expect(page).toContain("'http-equiv': 'Content-Security-Policy'");
    expect(page).toContain("apply: 'build'");
    for (const rule of [
      "default-src 'self'",
      "script-src 'self'",
      "connect-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ])
      expect(page).toContain(rule);
    const config = read('capacitor.config.ts');
    expect(config).toContain("loggingBehavior: 'none'");
    expect(config).toContain('allowMixedContent: false');
    expect(config).toContain("androidScheme: 'https'");
    expect(config).toContain('CapacitorHttp: { enabled: false }');
    expect(config).not.toMatch(/allowNavigation|server:\s*\{[^}]*url:/);
  });
  it('ships device and cloud exclusions for every app-private storage domain', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    for (const file of ['backup_rules', 'data_extraction_rules']) {
      const rules = read(`android/app/src/main/res/xml/${file}.xml`);
      for (const domain of ['sharedpref', 'file', 'database', 'root', 'external']) {
        expect(rules.match(new RegExp(`domain="${domain}" path="\\."`, 'g'))).toHaveLength(
          file === 'backup_rules' ? 1 : 2,
        );
      }
    }
  });
  it('has an exact-commit CI APK audit and retained debug artifact', () => {
    const path = '.github/workflows/android-check.yml';
    expect(existsSync(path)).toBe(true);
    const workflow = read(path);
    expect(workflow).toContain('github.event.pull_request.head.sha || github.sha');
    expect(workflow).toContain('assembleDebug');
    expect(workflow).toContain('node tests/e2e/verify-apk.mjs');
    expect(workflow).toContain('actions/upload-artifact@');
    expect(workflow).toContain('if-no-files-found: error');
    expect(workflow).not.toContain('pull_request_target');
  });
});
