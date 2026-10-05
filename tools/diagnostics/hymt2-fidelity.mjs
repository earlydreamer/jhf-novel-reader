// One explicit request against an already loaded model. Never prints or stores bodies.
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i]?.startsWith('--') || process.argv[i + 1] === undefined) {
    throw new Error('Arguments must be --name value pairs');
  }
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
const modes = ['app', 'official', 'greedy', 'recommended', 'faithful', 'no-repeat'];
const mode = required('mode');
if (!modes.includes(mode)) throw new Error('Unsupported mode');
const model = required('model');
const api = new URL(args.get('base') ?? 'http://127.0.0.1:1234');
if (api.username || api.password || api.search || api.hash || api.pathname !== '/') {
  throw new Error('Expected a server root without credentials');
}
const hash = (text) => createHash('sha256').update(text).digest('hex');
const numericMetadata = (value, fields) =>
  Object.fromEntries(
    fields
      .filter(
        (key) => typeof value?.[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0,
      )
      .map((key) => [key, value[key]]),
  );
const report = {
  runId: randomUUID(),
  mode,
  model,
  startedAt: new Date().toISOString(),
  clientPosts: 0,
};
let observer;
let reviewData;
const emit = async () => {
  const text = JSON.stringify(report, null, 2) + '\n';
  if (args.has('out')) await writeFile(resolve(args.get('out')), text, { flag: 'wx' });
  process.stdout.write(text);
};

try {
  // Checking the loaded-instance list avoids implicit JIT loading or another model.
  const backend = args.get('backend') ?? 'lmstudio';
  if (!['lmstudio', 'llama-cpp'].includes(backend)) throw new Error('Unsupported backend');
  const catalogResponse = await fetch(
    new URL(backend === 'lmstudio' ? '/api/v1/models' : '/v1/models', api),
    {
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!catalogResponse.ok) throw new Error('catalog_unavailable');
  const catalog = await catalogResponse.json();
  let entry = catalog.models?.find((item) =>
    item.loaded_instances?.some((instance) => instance.id === model),
  );
  let instance = entry?.loaded_instances.find((item) => item.id === model);
  if (backend === 'llama-cpp') {
    if (!catalog.data?.some((item) => item.id === model))
      throw new Error('selected_instance_not_loaded');
    const properties = await (
      await fetch(new URL('/props', api), { signal: AbortSignal.timeout(10000) })
    ).json();
    const defaults = properties.default_generation_settings ?? {};
    const context = defaults.n_ctx ?? properties.n_ctx;
    entry = { key: model };
    instance = { config: { context_length: context, parallel: properties.total_slots } };
    report.engineDefaults = numericMetadata(defaults.params ?? defaults, [
      'temperature',
      'top_p',
      'top_k',
      'repeat_penalty',
      'repeat_last_n',
      'min_p',
    ]);
  }
  if (!instance) throw new Error('selected_instance_not_loaded');
  report.loaded = {
    backend,
    key: entry.key,
    architecture: entry.architecture,
    quantization: entry.quantization,
    config: {
      ...numericMetadata(instance.config, [
        'context_length',
        'eval_batch_size',
        'physical_batch_size',
        'parallel',
        'context_checkpoints',
      ]),
      ...Object.fromEntries(
        [
          'flash_attention',
          'offload_kv_cache_to_gpu',
          'speculative_draft_mtp',
          'speculative_draft_simple',
        ]
          .filter((key) => typeof instance.config?.[key] === 'boolean')
          .map((key) => [key, instance.config[key]]),
      ),
    },
  };
  const require = createRequire(resolve(required('repo'), 'package.json'));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('', { url: 'https://ncode.syosetu.com/' });
  globalThis.document = dom.window.document;
  const { parseChapter, normalizeChapterInput, createProviderSession } = await import(
    pathToFileURL(resolve(required('adapter'))).href
  );
  const sourceUrl = 'https://ncode.syosetu.com/n6517bw/3/';
  const response = await fetch(sourceUrl, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200 || !/^text\/html/i.test(response.headers.get('content-type') ?? ''))
    throw new Error('source_unavailable');
  const source = await parseChapter(await response.text(), sourceUrl);
  let generationSource = source;
  let input = normalizeChapterInput(source);
  report.source = {
    canonicalUrl: sourceUrl,
    chars: source.paragraphs.reduce((sum, p) => sum + p.text.length, 0),
    paragraphs: source.paragraphs.length,
    nonemptyParagraphs: source.paragraphs.filter((p) => p.text.trim()).length,
    inputChars: input.length,
    inputHash: hash(input),
  };
  const expectedHash =
    args.get('expected-hash') ?? '728939898a852f0c93764a984fe043c5f73ea73010fd4bc5af66a418419d2132';
  if (hash(normalizeChapterInput(source)) !== expectedHash)
    throw new Error('source_changed_no_generation');
  const scope = args.get('scope') ?? 'whole';
  const rangeMatch = /^nonempty-(\d+)-(\d+)$/.exec(scope);
  if (!['whole', 'diagnostic-middle'].includes(scope) && !rangeMatch)
    throw new Error('Invalid diagnostic scope');
  let nonemptyRange;
  if (scope === 'diagnostic-middle') nonemptyRange = [59, 87];
  else if (rangeMatch) nonemptyRange = [Number(rangeMatch[1]), Number(rangeMatch[2])];
  if (nonemptyRange) {
    const [start, end] = nonemptyRange;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)
      throw new Error('Invalid diagnostic range');
    const indices = source.paragraphs.map((p, i) => (p.text.trim() ? i : -1)).filter((i) => i >= 0);
    if (indices[start - 1] === undefined || indices[end - 1] === undefined)
      throw new Error('Diagnostic source range unavailable');
    generationSource = {
      ...source,
      paragraphs: source.paragraphs.slice(indices[start - 1], indices[end - 1] + 1),
    };
    input = normalizeChapterInput(generationSource);
  }
  if (args.has('drop-blank')) {
    generationSource = {
      ...generationSource,
      paragraphs: generationSource.paragraphs.filter((p) => p.text.trim()),
    };
    input = normalizeChapterInput(generationSource);
  }
  if (args.has('collapse-blank')) input = input.replace(/\n{3,}/g, '\n\n');
  report.requestSource = {
    scope,
    inputChars: input.length,
    inputHash: hash(input),
    ...(nonemptyRange ? { nonemptyRange, acceptanceRun: false } : {}),
  };
  if (args.has('lms')) {
    report.serverInputObservations = [];
    let pending = '';
    observer = spawn(
      required('lms'),
      ['log', 'stream', '--json', '--source', 'model', '--filter', 'input'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    observer.on('error', () => {
      report.observerState = 'unavailable';
    });
    observer.stdout.on('data', (chunk) => {
      pending += chunk.toString('utf8');
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        try {
          const value = JSON.parse(line);
          const strings = [];
          const collect = (v) => {
            if (typeof v === 'string') strings.push(v);
            else if (v && typeof v === 'object') Object.values(v).forEach(collect);
          };
          collect(value);
          const full = strings.find((s) => s.includes(input));
          // Server-wide observations are never counted as this client's requests.
          report.serverInputObservations.push({
            keys: ['timestamp', 'data'].filter((key) => Object.hasOwn(value, key)),
            fullInputPresentVerbatim: Boolean(full),
            ...(full ? { formattedChars: full.length, formattedHash: hash(full) } : {}),
          });
        } catch {
          /* drop non-JSON log lines, without echoing them */
        }
      }
    });
    await new Promise((done) => setTimeout(done, 1500));
  }
  const instruction =
    mode === 'faithful'
      ? 'Translate the entire following Japanese text into Korean, from the first sentence to the last. Translate every sentence, dialogue, number and detail in the original order. Do not summarize, shorten or skip any passage. Only output the translated result, without any additional explanation:\n'
      : 'Translate the following text into Korean. Note that you should only output the translated result without any additional explanation:\n';
  const transport = {
    get: async () => {
      throw new Error('unexpected_get');
    },
    post: async (request) => {
      let body = request.body;
      if (mode !== 'app')
        body = { ...body, messages: [{ role: 'user', content: instruction + input }] };
      if (mode === 'greedy' || mode === 'faithful' || mode === 'no-repeat')
        body = { ...body, temperature: 0 };
      if (mode === 'no-repeat') body = { ...body, repeat_penalty: 1.0 };
      if (mode === 'recommended')
        body = { ...body, temperature: 0.7, top_p: 0.6, top_k: 20, repeat_penalty: 1.05 };
      if (args.has('reasoning-off')) body = { ...body, reasoning_effort: 'none' };
      report.request = {
        roles: body.messages.map((m) => m.role),
        parameters: Object.fromEntries(
          Object.entries(body).filter(([key]) => !['messages', 'model'].includes(key)),
        ),
        messagesHash: hash(JSON.stringify(body.messages)),
      };
      if (report.clientPosts !== 0) throw new Error('second_post_forbidden');
      const started = performance.now();
      report.clientPosts += 1;
      const res = await fetch(new URL('/v1/chat/completions', api), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      report.modelMs = Math.round(performance.now() - started);
      report.httpStatus = res.status;
      report.usage = {
        ...numericMetadata(data.usage, ['prompt_tokens', 'completion_tokens', 'total_tokens']),
        ...numericMetadata(data.usage?.completion_tokens_details, ['reasoning_tokens']),
      };
      report.returnedModelMatchesSelection = data.model === model;
      const finish = data.choices?.[0]?.finish_reason;
      report.finishReason = ['stop', 'length', 'content_filter'].includes(finish)
        ? finish
        : 'unknown';
      return { status: res.status, url: request.url, headers: {}, data };
    },
  };
  const provider = createProviderSession(
    {
      connection: { provider: 'openai-compatible', baseUrl: api.href, revision: 0 },
      modelId: model,
    },
    transport,
    { get: async () => null },
  );
  const result = await provider.translateChapter(
    {
      source: generationSource,
      token: { requestId: report.runId, chapterId: source.chapterId, settingsRevision: 0 },
      languageDirection: 'ja-ko',
      contractVersion: 'plain-v1',
      promptVersion: 'hymt2-ko-v1',
    },
    new AbortController().signal,
  );
  report.output = {
    chars: result.text.length,
    hash: hash(result.text),
    blocks: result.text.split('\n\n').filter((p) => p.trim()).length,
    hangulChars: [...result.text.matchAll(/[\uac00-\ud7a3]/g)].length,
    kanaChars: [...result.text.matchAll(/[\u3040-\u30ff]/g)].length,
  };
  // These lexical cues identify obvious missing areas, never certify fidelity.
  const cues = [
    ['herb', /薬草/g, /약초/g],
    ['mushroom_any', /キノコ|茸/g, /버섯/g],
    [
      'poisonous_mushroom',
      /毒[^。\n]{0,12}(?:キノコ|茸)/g,
      /독[^.\n]{0,12}버섯|버섯[^.\n]{0,12}독/g,
    ],
    ['magic_power', /魔力/g, /마력/g],
  ];
  report.cues = cues.map(([name, src, dst]) => ({
    name,
    sourceMatches: [...input.matchAll(src)].length,
    outputMatches: [...result.text.matchAll(dst)].length,
  }));
  report.quality = 'NOT_ASSESSED_LEXICAL_CUES_ONLY';
  report.bodyStored = false;
  report.state = 'completed';
  if (args.has('review-port'))
    reviewData = {
      original: generationSource.paragraphs.filter((p) => p.text.trim()).map((p) => p.text),
      translation: result.text.split('\n\n').filter((p) => p.trim()),
    };
  dom.window.close();
} catch (error) {
  // Never expose arbitrary provider bodies, URLs, or native error strings.
  report.state = report.clientPosts ? 'failed_or_unknown' : 'not_sent';
  report.errorCode = [
    'catalog_unavailable',
    'selected_instance_not_loaded',
    'source_unavailable',
    'source_changed_no_generation',
  ].includes(error.message)
    ? error.message
    : 'probe_failed';
  process.exitCode = 1;
} finally {
  if (observer) {
    observer.kill();
    await new Promise((done) => {
      if (observer.exitCode !== null || observer.signalCode !== null) done();
      else {
        observer.once('exit', done);
        setTimeout(done, 2000).unref();
      }
    });
  }
}
await emit();
if (reviewData) {
  const port = Number(args.get('review-port'));
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid review port');
  const escape = (value) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const column = (values) =>
    values.map((p, i) => `<p><small>${i + 1}</small>${escape(p)}</p>`).join('');
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>회차 번역 대조 · ${escape(mode)}</title><style>body{margin:0;background:#fff;color:#222;font:15px/1.75 sans-serif}header{position:sticky;top:0;background:#f1f4fa;padding:8px 20px;border-bottom:1px solid #aaa}main{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:20px}section{min-width:0}p{white-space:pre-wrap;margin:0 0 10px;padding-left:35px;position:relative}small{position:absolute;left:0;color:#777;font-size:10px}h2{font-size:16px}</style><header>${escape(mode)} / ${escape(report.runId)} · 본문은 메모리에만 유지 · 번호는 대조용 표시</header><main><section><h2>원문 · ${reviewData.original.length}개 비어 있지 않은 문단</h2>${column(reviewData.original)}</section><section><h2>번역 · ${reviewData.translation.length}개 출력 블록</h2>${column(reviewData.translation)}</section></main>`,
    );
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  process.stdout.write(JSON.stringify({ review: 'ready', port, runId: report.runId }) + '\n');
  const stop = () => {
    reviewData = null;
    server.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
