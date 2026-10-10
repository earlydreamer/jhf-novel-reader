import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('disables app backups with explicit legacy and Android 12 transfer rules', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  expect(manifest).toContain('android:allowBackup="false"');
  expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
  expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  for (const file of ['backup_rules', 'data_extraction_rules']) {
    const rules = readFileSync(`android/app/src/main/res/xml/${file}.xml`, 'utf8');
    expect(rules).toContain('domain="sharedpref" path="."');
    expect(rules).toContain('domain="file" path="."');
  }
});
it('keeps the generated native smoke test aligned with the application ID', () => {
  const config = readFileSync('capacitor.config.ts', 'utf8');
  const instrumented = readFileSync(
    'android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java',
    'utf8',
  );
  expect(config).toContain("appId: 'dev.earlydreamer.jhfreader'");
  expect(instrumented).toContain(
    'assertEquals("dev.earlydreamer.jhfreader", appContext.getPackageName())',
  );
});
it('disables native bridge argument logging even in debug builds', () => {
  const config = readFileSync('capacitor.config.ts', 'utf8');
  expect(config).toContain("loggingBehavior: 'none'");
});
