// Capacitor regenerates CapApp-SPM on sync. Restore the local native package and app version.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.CAPACITOR_PLATFORM_NAME && process.env.CAPACITOR_PLATFORM_NAME !== 'ios') {
  process.exit(0);
}

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const write = (path, text) => writeFileSync(new URL(path, root), text);
const packagePath = 'ios/App/CapApp-SPM/Package.swift';
let spm = read(packagePath);
if (!spm.includes('.package(name: "JHFNative"')) {
  spm = spm.replace(
    'dependencies: [',
    'dependencies: [\n        .package(name: "JHFNative", path: "../../JHFNative"),',
  );
  spm = spm.replace(
    'name: "CapApp-SPM",\n            dependencies: [',
    'name: "CapApp-SPM",\n            dependencies: [\n                .product(name: "JHFNative", package: "JHFNative"),',
  );
}
if (!spm.includes('.product(name: "JHFNative"'))
  throw new Error('Check Capacitor SPM template before syncing iOS.');
write(packagePath, spm);
const { version } = JSON.parse(read('package.json'));
const [major, minor, patch] = version.split('.').map(Number);
const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
let project = read(projectPath)
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(
    /CURRENT_PROJECT_VERSION = [^;]+;/g,
    `CURRENT_PROJECT_VERSION = ${major * 10000 + minor * 100 + patch};`,
  );
write(projectPath, project);
console.log(`Configured iOS ${version}: ${fileURLToPath(new URL('ios/App', root))}`);
