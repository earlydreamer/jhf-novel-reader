/** Compiled-artifact audit. Run at repository root after cap sync + assembleDebug.
 * This proves packaging/signature/provenance, NOT installation or device behavior. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  openSync,
  closeSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

export function auditProvenance(web, native, current) {
  for (const [kind, built] of [
    ['web', web],
    ['native', native],
  ]) {
    assert.equal(built.dirty, false, `${kind} was built from a dirty checkout`);
    assert.equal(built.commit, current.commit, `${kind} was built from a different commit`);
    assert.equal(built.tree, current.tree, `${kind} source tree differs`);
  }
}

export function auditAssets(config, plugins, html) {
  assert.equal(config.appId, 'app.narou.reader');
  assert.equal(config.loggingBehavior, 'none');
  assert.equal(config.plugins.CapacitorHttp.enabled, false);
  assert.equal(config.server.androidScheme, 'https');
  assert.equal(config.server.url, undefined);
  assert.equal(config.server.allowNavigation, undefined);
  assert.equal(config.android.allowMixedContent, false);
  for (const name of ['AppPlugin', 'FilesystemPlugin', 'PreferencesPlugin', 'SecureStorage']) {
    assert(
      plugins.some((plugin) => plugin.classpath.split('.').at(-1) === name),
      `Missing native plugin ${name}`,
    );
  }
  const document = new JSDOM(html).window.document;
  const policy = document
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute('content');
  assert(policy, 'Missing packaged CSP');
  for (const rule of [
    "script-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ])
    assert(
      policy
        .split(';')
        .map((x) => x.trim())
        .includes(rule),
      `Missing CSP rule: ${rule}`,
    );
  assert(html.includes('<head>'), 'Capacitor bootstrap needs literal <head> before CSP');
  assert(
    html.indexOf('Content-Security-Policy') < html.indexOf('<script'),
    'CSP must precede bundled scripts',
  );
  assert(!/<script\b(?![^>]*\bsrc=)[^>]*>/i.test(html), 'Unexpected inline script');
}

/** Compiled manifest + DEX inspection, independent of source-file declarations. */
export function auditNativeBrowse(manifest, dexDump, mainDisassembly) {
  const activities = manifest
    .split(/(?=E: activity\b)/)
    .filter((part) => part.includes('SourceBrowserActivity'));
  const activity = activities.find((part) => /android:name[^\n]*SourceBrowserActivity/.test(part));
  assert(activity, 'Missing packaged SourceBrowserActivity');
  const ownElement = activity.split(/\n[ \t]*E: /)[0];
  assert.match(
    ownElement,
    /android:exported[^\n]*\(type 0x12\)0x0/,
    'Source browser must not be exported',
  );
  for (const name of [
    'SourceBrowserActivity',
    'SourceBrowserPlugin',
    'SourceBrowserPolicy',
    'SourceBrowserLoader',
  ])
    assert(dexDump.includes(`Lapp/narou/reader/${name};`), `Missing compiled ${name}`);
  const match = /Class descriptor\s*:\s*'Lapp\/narou\/reader\/SourceBrowserActivity;'/.exec(
    dexDump,
  );
  assert(match, 'Missing browser class definition');
  const descriptor = match.index + match[0].length;
  const nextClass = dexDump.indexOf('Class descriptor', descriptor);
  const definition = dexDump.slice(descriptor, nextClass < 0 ? undefined : nextClass);
  assert.match(
    definition,
    /Superclass[^\n]*Landroidx\/appcompat\/app\/AppCompatActivity;/,
    'Source browser must use isolated AppCompatActivity',
  );
  assert(
    !definition.includes('Lcom/getcapacitor/BridgeActivity;'),
    'Source browser must not inherit the Capacitor bridge',
  );
  assert.match(
    mainDisassembly,
    /const-class (v[0-9]+), Lapp\/narou\/reader\/SourceBrowserPlugin;[^]*?invoke-virtual \{v[0-9]+, \1\}, Lapp\/narou\/reader\/MainActivity;\.registerPlugin:[^]*?invoke-super[^\n]*Lcom\/getcapacitor\/BridgeActivity;\.onCreate:/,
    'Source browser plugin must be registered before the app bridge starts',
  );
}

/** Large APK/DEX outputs go straight to disk, never through execFileSync's 1 MiB default buffer. */
export function runToFile(program, args, destination) {
  const fd = openSync(destination, 'w');
  try {
    execFileSync(program, args, { stdio: ['ignore', fd, 'pipe'] });
  } finally {
    closeSync(fd);
  }
}

export function toZipEntry(relative) {
  return relative.replaceAll('\\', '/');
}

export function signerCommand(platform, buildTools) {
  if (platform === 'win32')
    return { file: 'java', args: ['-jar', path.win32.join(buildTools, 'lib', 'apksigner.jar')] };
  return { file: path.posix.join(buildTools, 'apksigner'), args: [] };
}

export function main() {
  const run = (program, args) =>
    execFileSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  assert(sdk, 'Set ANDROID_HOME to the installed Android SDK');
  const buildTools = path.join(sdk, 'build-tools', '35.0.0');
  const apk = 'android/app/build/outputs/apk/debug/app-debug.apk';
  assert(existsSync(apk), 'Build the debug APK first');
  assert.equal(
    run('git', ['status', '--porcelain', '--untracked-files=normal']).trim(),
    '',
    'Commit changes before recording APK provenance',
  );
  const entry = (name) => run('unzip', ['-p', apk, name]);
  const source = JSON.parse(entry('assets/source-provenance.json'));
  auditProvenance(JSON.parse(entry('assets/public/source-provenance.json')), source, {
    commit: run('git', ['rev-parse', 'HEAD']).trim(),
    tree: run('git', ['rev-parse', 'HEAD^{tree}']).trim(),
  });
  const config = JSON.parse(entry('assets/capacitor.config.json'));
  const plugins = JSON.parse(entry('assets/capacitor.plugins.json'));
  const html = entry('assets/public/index.html');
  auditAssets(config, plugins, html);
  assert.equal(
    html,
    readFileSync('dist/index.html', 'utf8'),
    'APK web assets are stale; rebuild and cap sync',
  );
  // Verify every built asset, not only index.html, against the APK bytes.
  const entries = new Set(run('unzip', ['-Z1', apk]).trim().split('\n'));
  for (const relative of readdirSync('dist', { recursive: true }).filter((name) =>
    statSync(path.join('dist', name)).isFile(),
  )) {
    const name = `assets/public/${toZipEntry(relative)}`;
    assert(entries.has(name), `Missing packaged asset: ${relative}`);
    const packaged = execFileSync('unzip', ['-p', apk, name]);
    assert(
      packaged.equals(readFileSync(path.join('dist', relative))),
      `Stale packaged asset: ${relative}`,
    );
  }
  const aapt = (...args) => run(path.join(buildTools, 'aapt'), args);
  const badging = aapt('dump', 'badging', apk);
  assert.match(badging, /package: name='app\.narou\.reader'/);
  assert.match(badging, /sdkVersion:'24'/);
  assert.match(badging, /targetSdkVersion:'36'/);
  const manifest = aapt('dump', 'xmltree', apk, 'AndroidManifest.xml');
  const dexDirectory = 'android/build/verification/dex';
  mkdirSync(dexDirectory, { recursive: true });
  let mainDisassembly = '';
  const dexDump = [...entries]
    .filter((name) => /^classes[0-9]*\.dex$/.test(name))
    .map((name) => {
      const target = path.join(dexDirectory, name);
      runToFile('unzip', ['-p', apk, name], target);
      const dumpPath = `${target}.txt`;
      runToFile(path.join(buildTools, 'dexdump'), [target], dumpPath);
      const dump = readFileSync(dumpPath, 'utf8');
      if (/Class descriptor\s*:\s*'Lapp\/narou\/reader\/MainActivity;'/.test(dump)) {
        const disassemblyPath = `${target}.disassembly.txt`;
        runToFile(path.join(buildTools, 'dexdump'), ['-d', target], disassemblyPath);
        const disassembly = readFileSync(disassemblyPath, 'utf8');
        const match = /Class descriptor\s*:\s*'Lapp\/narou\/reader\/MainActivity;'/.exec(
          disassembly,
        );
        const after = disassembly.slice(match.index + match[0].length);
        mainDisassembly = after.split('Class descriptor')[0];
      }
      return dump
        .split(/(?=Class descriptor)/)
        .filter((part) => /^Class descriptor\s*:\s*'Lapp\/narou\/reader\//.test(part))
        .join('\n');
    })
    .join('\n');
  auditNativeBrowse(manifest, dexDump, mainDisassembly);
  assert(
    dexDump.includes('Lapp/narou/reader/ModelStreamPlugin;'),
    'Missing compiled model SSE plugin',
  );
  assert.match(
    mainDisassembly,
    /const-class (v[0-9]+), Lapp\/narou\/reader\/ModelStreamPlugin;[^]*?invoke-virtual \{v[0-9]+, \1\}, Lapp\/narou\/reader\/MainActivity;\.registerPlugin:/,
    'Model SSE plugin must be registered in app bridge',
  );
  assert.match(manifest, /android:allowBackup[^\n]*\(type 0x12\)0x0/);
  for (const attribute of ['networkSecurityConfig', 'fullBackupContent', 'dataExtractionRules'])
    assert(manifest.includes(`android:${attribute}`));
  const network = aapt('dump', 'xmltree', apk, 'res/xml/network_security_config.xml');
  assert.match(network, /base-config[\s\S]*cleartextTrafficPermitted[^\n]*0xffffffff/);
  assert.match(network, /domain-config[\s\S]*cleartextTrafficPermitted[^\n]*0x0/);
  assert(network.includes('syosetu.com'));
  for (const file of ['backup_rules', 'data_extraction_rules']) {
    const xml = aapt('dump', 'xmltree', apk, `res/xml/${file}.xml`);
    for (const domain of ['sharedpref', 'file', 'database', 'root', 'external'])
      assert(xml.includes(`"${domain}"`));
  }
  const signer = signerCommand(process.platform, buildTools);
  const signature = run(signer.file, [...signer.args, 'verify', '--verbose', '--print-certs', apk]);
  assert(signature.includes('Verified using v2 scheme (APK Signature Scheme v2): true'));
  const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const report = {
    kind: 'debug-packaging-only',
    commit: source.commit,
    tree: source.tree,
    lockfileSha256: sha256(readFileSync('package-lock.json')),
    apkSha256: sha256(readFileSync(apk)),
    applicationId: config.appId,
    minSdk: 24,
    targetSdk: 36,
    node: process.version,
    nativePluginClasses: [
      ...plugins.map((plugin) => plugin.classpath),
      'app.narou.reader.SourceBrowserPlugin',
    ],
    isolatedBrowserActivity: 'app.narou.reader.SourceBrowserActivity',
    deviceExecution: 'NOT RUN by this audit; see docs/android-validation.md',
  };
  const output = 'android/build/verification';
  mkdirSync(output, { recursive: true });
  writeFileSync(`${output}/provenance.json`, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(`${output}/apk-sha256.txt`, `${report.apkSha256}  app-debug.apk\n`);
  writeFileSync(`${output}/signature.txt`, signature);
  writeFileSync(`${output}/package.txt`, badging);
  writeFileSync(`${output}/manifest.txt`, manifest);
  writeFileSync(`${output}/network-security.txt`, network);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
