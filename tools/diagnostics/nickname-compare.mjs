// 명시적으로 실행하는 합성 A/B 비교. 원문·모델 원시 응답·인증값·서버 주소는 기록하지 않는다.
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (
    !['--base', '--model', '--out', '--repetitions', '--cases'].includes(process.argv[i]) ||
    !process.argv[i + 1]
  )
    throw new Error('invalid_arguments');
  args.set(process.argv[i], process.argv[i + 1]);
}
const base = new URL(args.get('--base') ?? 'http://127.0.0.1:18082');
if (
  base.protocol !== 'http:' ||
  base.hostname !== '127.0.0.1' ||
  base.pathname !== '/' ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
)
  throw new Error('expected_loopback_ssh_forward');
const requested = args.get('--model');
const output = args.get('--out');
if (!requested || !output) throw new Error('model_and_output_required');
const count = Number(args.get('--cases') ?? 20);
const repetitions = Number(args.get('--repetitions') ?? 3);
if (
  !Number.isSafeInteger(count) ||
  count < 1 ||
  count > 20 ||
  !Number.isSafeInteger(repetitions) ||
  repetitions < 1 ||
  repetitions > 3
)
  throw new Error('invalid_experiment_size');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtureBytes = await readFile(new URL('./nickname-cases.json', import.meta.url));
const allCases = JSON.parse(fixtureBytes);
const cases = allCases.slice(0, count);
const sourceFiles = [
  'src/translation/nicknameMeaning.ts',
  'src/translation/nicknameExperiment.ts',
  'src/translation/termJudge.ts',
  'src/providers/plainText.ts',
];
const sourceHashes = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (path) => [path, hash(await readFile(path))])),
);
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '',
  sourceHashes,
  fixtureHash: hash(fixtureBytes),
  model: basename(requested),
  caseCount: count,
  repetitions,
  posts: 0,
  trials: [],
  rawBodiesStored: false,
  state: 'preparing',
};
const destination = resolve(output);
await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const checkpoint = async () => writeFile(destination, JSON.stringify(report, null, 2) + '\n');
const controller = new AbortController();
process.once('SIGINT', () => controller.abort());
process.once('SIGTERM', () => controller.abort());
let server;
try {
  const catalogResponse = await fetch(new URL('/v1/models', base), {
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!catalogResponse.ok) throw new Error('catalog_unavailable');
  const catalog = await catalogResponse.json();
  const loaded =
    catalog.data?.filter((item) => item.id === requested || basename(item.id) === requested) ?? [];
  if (loaded.length !== 1) throw new Error('selected_model_not_loaded');
  const model = loaded[0].id;
  report.model = basename(model);
  const properties = await (
    await fetch(new URL('/props', base), { redirect: 'error', signal: AbortSignal.timeout(10000) })
  ).json();
  const settings = properties.default_generation_settings ?? {};
  report.engine = {
    contextTokens: settings.n_ctx ?? properties.n_ctx,
    slots: properties.total_slots,
  };
  server = await createServer({
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
  });
  const { runNicknameComparison, summarizeNicknameComparison } = await server.ssrLoadModule(
    '/src/translation/nicknameExperiment.ts',
  );
  const { createProviderSession } = await server.ssrLoadModule('/src/providers/plainText.ts');
  const { loadKanjidic } = await server.ssrLoadModule('/src/translation/kanjidic.ts');
  const { ReaderError } = await server.ssrLoadModule('/src/contracts/index.ts');
  let progress;
  const transport = {
    get: async () => {
      throw new Error('unexpected_get');
    },
    post: async (request, signal) => {
      if (
        request.url !== new URL('/v1/chat/completions', base).href ||
        request.authorization ||
        request.geminiApiKey
      )
        throw new Error('unexpected_destination');
      const seed =
        12345 +
        (progress?.repetition ?? 0) * 100 +
        (progress?.batch ?? 0) * 3 +
        (progress?.vote ?? 0);
      const body = { ...request.body, seed };
      report.posts++;
      const started = performance.now();
      let response;
      try {
        response = await fetch(request.url, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
        });
      } catch {
        throw new ReaderError(signal.aborted ? 'cancelled' : 'timeout_unknown', 'unknown');
      }
      // 400 응답의 스키마 제거 재전송도 이 진단에서는 금지한다. 한 complete당 POST는 하나다.
      if (!response.ok)
        throw new ReaderError(
          response.status === 401 || response.status === 403 ? 'auth' : 'invalid_output',
          'received',
          response.status,
        );
      const data = await response.json();
      if (data.choices?.[0]?.finish_reason !== 'stop')
        throw new ReaderError('output_limit', 'received');
      process.stdout.write(
        JSON.stringify({
          event: 'request_completed',
          posts: report.posts,
          ...progress,
          durationMs: Math.round(performance.now() - started),
        }) + '\n',
      );
      return { status: response.status, headers: {}, url: request.url, data };
    },
  };
  const session = createProviderSession(
    {
      connection: { provider: 'openai-compatible', baseUrl: base.href, revision: 1 },
      modelId: model,
    },
    transport,
    { get: async () => null, set: async () => {}, remove: async () => {} },
  );
  report.state = 'running';
  const trials = await runNicknameComparison(cases, session.completeJson.bind(session), {
    signal: controller.signal,
    dic: await loadKanjidic(),
    repetitions,
    onProgress: (current) => {
      progress = current;
    },
    onTrial: async (trial) => {
      report.trials.push(trial);
      await checkpoint();
      process.stdout.write(
        JSON.stringify({
          event: 'trial_completed',
          arm: trial.arm,
          repetition: trial.repetition,
          requests: trial.requests,
        }) + '\n',
      );
    },
  });
  report.result = summarizeNicknameComparison(cases, trials);
  report.state = 'completed';
} catch (error) {
  report.state = report.posts ? 'failed_or_unknown' : 'not_sent';
  report.errorCode = [
    'catalog_unavailable',
    'selected_model_not_loaded',
    'unexpected_destination',
    'invalid_fixture',
    'invalid_experiment',
  ].includes(error.message)
    ? error.message
    : controller.signal.aborted
      ? 'cancelled'
      : 'probe_failed';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await checkpoint();
  await server?.close();
}
process.stdout.write(
  JSON.stringify({
    event: 'finished',
    state: report.state,
    posts: report.posts,
    result: report.result,
  }) + '\n',
);
