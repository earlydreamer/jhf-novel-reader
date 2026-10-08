import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
export default defineConfig({ plugins: [react(), {
 name: 'production-content-security-policy',
 // Vite's development-only React preamble/HMR needs inline scripts and sockets.
 apply: 'build',
 generateBundle() {
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  this.emitFile({ type: 'asset', fileName: 'source-provenance.json', source: JSON.stringify({
   commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'),
   dirty: git('status', '--porcelain', '--untracked-files=normal') !== ''
  }) + '\n' });
 },
 transformIndexHtml: { order: 'post', handler: () => [{
  tag: 'meta', injectTo: 'head-prepend', attrs: {
   'http-equiv': 'Content-Security-Policy',
   content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
  }
 }] }
}], test: {
  environment: 'node',
  // .superpowers/는 git-ignored 검증·인계 작업 폴더다. 그 안의 테스트 사본을 수집하지 않는다(#101).
  exclude: [...configDefaults.exclude, '.superpowers/**'],
} });
