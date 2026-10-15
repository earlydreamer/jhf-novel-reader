import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

async function probe(fail = false) {
  const directory = await mkdtemp(join(tmpdir(), 'nickname-compare-'));
  const output = join(directory, 'report.json');
  let posts = 0;
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'synthetic' }] }));
      return;
    }
    if (request.url === '/props') {
      response.end(
        JSON.stringify({ default_generation_settings: { n_ctx: 16384 }, total_slots: 1 }),
      );
      return;
    }
    expect(request.url).toBe('/v1/chat/completions');
    posts++;
    if (fail) {
      request.socket.destroy();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const meaning = body.messages[1].content.startsWith('{');
    const value = meaning
      ? {
          id: 'nickname',
          nickname: true,
          parts: [{ source: '蝮', meaning: '살무사' }],
          referent: '합성 대상',
          rendering: '미노의 살무사',
        }
      : {
          items: [
            {
              id: 'c1',
              kind: 'real',
              category: '별명',
              target: '미노의 살무사',
              reason: 'synthetic-private-response-marker',
            },
          ],
        };
    response.end(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('invalid_test_server');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const child = spawn(
      process.execPath,
      [
        resolve('tools/diagnostics/nickname-compare.mjs'),
        '--base',
        base,
        '--model',
        'synthetic',
        '--out',
        output,
        '--cases',
        '1',
        '--repetitions',
        '1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exitCode = await new Promise<number | null>((done, reject) => {
      child.on('error', reject);
      child.on('close', done);
    });
    const text = await readFile(output, 'utf8');
    return { exitCode, posts, stdout, stderr, text, report: JSON.parse(text), base };
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}

test('실행 명령은 실제 앱 판정을 재사용하고 부분 비교·요청 수·민감 문자열 제외를 기록한다', async () => {
  const result = await probe();
  expect(result.exitCode).toBe(0);
  expect(result.posts).toBe(7);
  expect(result.report.state).toBe('completed');
  expect(result.report.result.decision).toBe('incomplete');
  expect(result.report.rawBodiesStored).toBe(false);
  expect(result.text + result.stdout).not.toContain(result.base);
  expect(result.text + result.stdout).not.toContain('synthetic-private-response-marker');
  expect(result.stdout).toContain('request_completed');
});

test('서버가 결과 없이 연결을 끊으면 실패를 기록하고 POST를 다시 보내지 않는다', async () => {
  const result = await probe(true);
  expect(result.exitCode).toBe(1);
  expect(result.posts).toBe(1);
  expect(result.report.state).toBe('failed_or_unknown');
  expect(result.report.trials).toEqual([]);
  expect(result.text + result.stdout + result.stderr).not.toContain(result.base);
});
