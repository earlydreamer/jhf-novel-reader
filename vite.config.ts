import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { execFileSync } from 'node:child_process';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'production-content-security-policy',
      // Vite's development-only React preamble/HMR needs inline scripts and sockets.
      apply: 'build',
      generateBundle() {
        const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
        this.emitFile({
          type: 'asset',
          fileName: 'source-provenance.json',
          source:
            JSON.stringify({
              commit: git('rev-parse', 'HEAD'),
              tree: git('rev-parse', 'HEAD^{tree}'),
              dirty: git('status', '--porcelain', '--untracked-files=normal') !== '',
            }) + '\n',
        });
      },
      transformIndexHtml: {
        order: 'post',
        handler: () => [
          {
            tag: 'meta',
            injectTo: 'head-prepend',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content:
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
            },
          },
        ],
      },
    },
  ],
  test: {
    environment: 'node',
    // 통합 테스트는 jsdom 전체 렌더·Node 자식 프로세스 때문에 단독으로도 1~3초 걸리고, 다른 vitest와 동시에 돌면
    // 3~4배 느려진다(#186 측정: 최악 약 12초). 시간 제한은 멈춘 테스트를 끊는 안전장치라 판정 의미는 바뀌지 않는다.
    testTimeout: 20_000,
    // .superpowers/는 git-ignored 검증·인계 작업 폴더다. 그 안의 테스트 사본을 수집하지 않는다(#101).
    exclude: [...configDefaults.exclude, '.superpowers/**'],
  },
});
