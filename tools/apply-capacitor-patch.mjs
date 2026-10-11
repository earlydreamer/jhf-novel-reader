// Keep the device-proven SystemBars fix without patch-package's vulnerable dependencies.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const installed = JSON.parse(
  readFileSync(new URL('../node_modules/@capacitor/android/package.json', import.meta.url), 'utf8'),
);
if (installed.version !== '8.5.2') {
  throw new Error(`Revalidate the SystemBars patch for @capacitor/android ${installed.version}`);
}

const patch = 'patches/@capacitor+android+8.5.2.patch';
const apply = (...args) =>
  spawnSync('git', ['apply', ...args, patch], {
    cwd: root,
    encoding: 'utf8',
  });
const requireSuccess = (result) => {
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`SystemBars patch failed: ${result.stderr || result.stdout}`);
  }
};

const check = apply('--check');
if (check.status === 0) {
  requireSuccess(apply());
  console.log('Applied @capacitor/android SystemBars patch');
} else {
  // npm rebuild / repeated postinstall must preserve an already patched installation.
  requireSuccess(apply('--reverse', '--check'));
  console.log('@capacitor/android SystemBars patch already applied');
}
