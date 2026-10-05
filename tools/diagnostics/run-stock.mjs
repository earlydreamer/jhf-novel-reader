// A temporary, loopback-only independent backend. Its process is always stopped.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2)
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
};
const base = 'http://127.0.0.1:18750';
const model = 'narou-hy-mt2-7b-stock';
const versionResult = spawnSync(required('engine'), ['--version'], {
  encoding: 'utf8',
  windowsHide: true,
});
const version = (versionResult.stdout ?? '') + (versionResult.stderr ?? '');
if (versionResult.status !== 0 || !/build 11415, commit 8e1642198/.test(version))
  throw new Error('Expected the pinned b11415 engine');
let occupied = false;
try {
  await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) });
  occupied = true;
} catch {
  /* no listener */
}
if (occupied) throw new Error('Diagnostic port is already occupied');
const parameters = [
  '-m',
  required('model-file'),
  '-a',
  model,
  '--host',
  '127.0.0.1',
  '--port',
  '18750',
  '-c',
  '16384',
  '-np',
  '1',
  '-ngl',
  '99',
  '-fa',
  'on',
  '-b',
  '2048',
  '-ub',
  '512',
  '-n',
  '-1',
  '--no-webui',
  '--log-disable',
];
const server = spawn(required('engine'), parameters, {
  windowsHide: true,
  stdio: ['ignore', 'ignore', 'ignore'],
});
let spawnFailed = false;
server.on('error', () => {
  spawnFailed = true;
});
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    if (spawnFailed || server.exitCode !== null)
      throw new Error('Independent backend failed to start');
    try {
      const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* model is loading */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error('Independent backend did not become ready');
  const probeArgs = [
    resolve(required('probe')),
    '--backend',
    'llama-cpp',
    '--mode',
    'no-repeat',
    '--model',
    model,
    '--base',
    base,
    '--repo',
    required('repo'),
    '--adapter',
    required('adapter'),
  ];
  const probe = spawn(process.execPath, probeArgs, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let output = '';
  probe.stdout.setEncoding('utf8');
  probe.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const code = await new Promise((done) => {
    probe.once('exit', done);
    probe.once('error', () => done(-1));
  });
  if (!output.trim()) throw new Error('Probe returned no metadata');
  const report = JSON.parse(output);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(required('engine'))) hash.update(chunk);
  report.stockRuntime = {
    build: 'b11415',
    commit: '8e1642198dcd4e408f8776222d6ae31b74d01187',
    serverSha256: hash.digest('hex'),
    context: 16384,
    parallel: 1,
    flashAttention: true,
    gpuLayers: 99,
    evalBatch: 2048,
    physicalBatch: 512,
    outputLimit: 'unlimited-until-EOS-or-context',
  };
  const text = JSON.stringify(report, null, 2) + '\n';
  await writeFile(required('out'), text, { flag: 'wx' });
  process.stdout.write(text);
  process.exitCode = code;
} finally {
  server.kill();
  await new Promise((done) => {
    if (server.exitCode !== null || server.signalCode !== null) done();
    else {
      server.once('exit', done);
      setTimeout(done, 3000).unref();
    }
  });
}
