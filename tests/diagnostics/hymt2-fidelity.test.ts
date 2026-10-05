import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, expect, test } from 'vitest';

const expectedHash = createHash('sha256')
  .update('薬草を集めた。\n\n\n\n毒キノコを避けた。\n\n魔力を調べた。')
  .digest('hex');
beforeAll(() => {
  const result = spawnSync(process.execPath, ['tools/diagnostics/build-adapter.mjs'], {
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
});
function run(hash: string, forbidPost = false) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(resolve('tests/diagnostics/fetch-fixture.mjs')).href,
      'tools/diagnostics/hymt2-fidelity.mjs',
      '--mode',
      'greedy',
      '--model',
      'actual',
      '--repo',
      process.cwd(),
      '--adapter',
      resolve('.superpowers/issue48/adapter.mjs'),
      '--expected-hash',
      hash,
    ],
    { encoding: 'utf8', env: { ...process.env, PROBE_FORBID_POST: forbidPost ? '1' : '0' } },
  );
}
test('changed source stops before generation', () => {
  const result = run('wrong', true);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({
    state: 'not_sent',
    clientPosts: 0,
    errorCode: 'source_changed_no_generation',
  });
});
test('one complete request produces metadata without response/config/usage bodies', () => {
  const result = run(expectedHash);
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report).toMatchObject({
    state: 'completed',
    clientPosts: 1,
    bodyStored: false,
    returnedModelMatchesSelection: false,
    quality: 'NOT_ASSESSED_LEXICAL_CUES_ONLY',
  });
  expect(report.request.parameters).toEqual({ stream: false, temperature: 0 });
  expect(report.loaded.config).toEqual({
    context_length: 16384,
    parallel: 4,
    flash_attention: true,
  });
  expect(report.usage).toEqual({
    prompt_tokens: 8,
    completion_tokens: 4,
    total_tokens: 12,
    reasoning_tokens: 0,
  });
  expect(result.stdout).not.toContain('DO_NOT_LOG');
  expect(report.cues).toContainEqual({
    name: 'poisonous_mushroom',
    sourceMatches: 1,
    outputMatches: 1,
  });
});
