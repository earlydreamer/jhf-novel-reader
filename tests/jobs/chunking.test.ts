import { describe, expect, it } from 'vitest';
import type { Chapter, ModelRequest, Paragraph, SecretStore } from '../../src/contracts';
import type { ChunkRequest, ChunkResult, JobToken, ProviderConfig, ValidatedChunk } from '../../src/contracts/legacy';
import { ReaderError } from '../../src/contracts';
import { createOpenAICompatibleProvider } from '../../src/providers/openai-compatible';
import { PROMPT_VERSION, planChunks, reassembleParagraphs, validateChunk } from '../../src/legacy/jobs/chunking';

const token: JobToken = { jobId: 'job-1', chapterId: 'chapter-1', settingsRevision: 0 };
const config: ProviderConfig = { provider: 'openai-compatible', baseUrl: 'http://192.0.2.1:11434', model: 'synthetic', contextBudget: 8192, outputBudget: 2048, settingsRevision: 0 };
const paragraph = (id: string, text: string, ruby: Paragraph['ruby'] = []): Paragraph => ({ id, text, ruby });
function chapter(paragraphs: readonly Paragraph[], sourceHash = 'synthetic-source-hash'): Chapter {
 return { canonicalUrl: 'https://ncode.syosetu.com/n1234aa/1/', workId: 'n1234aa', chapterId: token.chapterId, title: '試験', prevUrl: null, nextUrl: null, sourceHash, paragraphs };
}
function result(request: ChunkRequest, text = '번역'): ChunkResult {
 return { chunkId: request.chunkId, finishReason: 'complete', paragraphs: request.outputIds.map(id => ({ id, text })) };
}
function translated(requests: readonly ChunkRequest[]): ValidatedChunk[] {
 return requests.map(request => validateChunk(request, result(request)));
}
function invalid(operation: () => unknown): void {
 expect(operation).toThrow(ReaderError);
 try { operation(); } catch (error) { expect(error).toMatchObject({ code: 'invalid_output' }); }
}
const segments = (requests: readonly ChunkRequest[]) => requests.flatMap(request => request.paragraphs);

describe('deterministic chunk planning', () => {
 it('groups ordered paragraphs and keeps job identity out of deterministic chunk identity', () => {
  const source = chapter([paragraph('p1', '第一段落。'), paragraph('p2', '第二段落。')]);
  const planned = planChunks(source, config, token);
  expect(planned).toHaveLength(1);
  expect(planned[0]).toMatchObject({ token, paragraphs: source.paragraphs, outputIds: ['p1', 'p2'], context: [], languageDirection: 'ja-ko', promptVersion: PROMPT_VERSION });
  expect(planChunks(source, config, { ...token, jobId: 'different' }).map(r => r.chunkId)).toEqual(planned.map(r => r.chunkId));
  expect(planChunks(source, config, token)).toEqual(planned);
  for (const changed of [{ ...config, outputBudget: 2049 }, { ...config, contextBudget: 8193 }]) {
   expect(planChunks(source, changed, token)[0]!.chunkId).not.toBe(planned[0]!.chunkId);
  }
  expect(planChunks({ ...source, sourceHash: 'changed' }, config, token)[0]!.chunkId).not.toBe(planned[0]!.chunkId);
 });

 it('omits blank paragraphs from model input and restores their exact original text and IDs', () => {
  const source = chapter([paragraph('empty', ''), paragraph('p1', 'こんにちは。'), paragraph('space', ' \t\n\u3000'), paragraph('p2', '世界。')]);
  const planned = planChunks(source, config, token);
  expect(segments(planned).map(p => p.id)).toEqual(['p1', 'p2']);
  expect(reassembleParagraphs(source, planned, translated(planned))).toEqual([
   { id: 'empty', text: '' }, { id: 'p1', text: '번역' }, { id: 'space', text: ' \t\n\u3000' }, { id: 'p2', text: '번역' },
  ]);
  const blanks = chapter([paragraph('blank', '\n \t')]);
  expect(planChunks(blanks, config, token)).toEqual([]);
  expect(reassembleParagraphs(blanks, [], [])).toEqual([{ id: 'blank', text: '\n \t' }]);
 });

 it('splits long Japanese text on code points with stable UTF-16 range IDs and no source loss', () => {
  const text = 'あ😀𠮷東京の物語。'.repeat(160);
  const source = chapter([paragraph('long', text)]);
  const planned = planChunks(source, { ...config, outputBudget: 900 }, token);
  const pieces = segments(planned);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.map(p => p.text).join('')).toBe(text);
  let offset = 0;
  for (const p of pieces) {
   expect(p.id).toBe(`long~part:${offset}:${offset + p.text.length}`);
   expect(/[\uD800-\uDFFF]/u.test(p.text)).toBe(false);
   offset += p.text.length;
  }
  expect(new Set(planned.map(r => r.chunkId)).size).toBe(planned.length);
  expect(reassembleParagraphs(source, planned, translated(planned))).toEqual([{ id: 'long', text: '번역'.repeat(pieces.length) }]);
 });

 it('restores skipped whitespace-only split ranges without sending blank model targets', () => {
  const text = ' '.repeat(1000) + '始まり。' + ' \t\n'.repeat(500) + '終わり。' + '\u3000'.repeat(300);
  const source = chapter([paragraph('spaces', text)]);
  const planned = planChunks(source, { ...config, outputBudget: 700 }, token);
  expect(planned.length).toBeGreaterThan(0);
  expect(segments(planned).every(p => !!p.text.trim())).toBe(true);
  const echoed = planned.map(req => validateChunk(req, { chunkId: req.chunkId, finishReason: 'complete', paragraphs: req.paragraphs.map(p => ({ id: p.id, text: p.text })) }));
  expect(reassembleParagraphs(source, planned, echoed)).toEqual([{ id: 'spaces', text }]);
 });

 it('keeps complete ruby spans and translates their positions relative to split segments', () => {
  const text = '😀あ'.repeat(40) + '東京' + 'い𠮷'.repeat(80);
  const source = chapter([paragraph('ruby', text, [{ start: 120, end: 122, reading: 'とうきょう' }, { start: 185, end: 188, reading: 'よみ' }])]);
  const planned = planChunks(source, { ...config, outputBudget: 700 }, token);
  const restoredRuby: Paragraph['ruby'][number][] = [];
  let offset = 0;
  for (const p of segments(planned)) {
   for (const r of p.ruby) restoredRuby.push({ ...r, start: r.start + offset, end: r.end + offset });
   offset += p.text.length;
  }
  expect(restoredRuby).toEqual(source.paragraphs[0]!.ruby);
  expect(segments(planned).map(p => p.text).join('')).toBe(text);
 });

 it('rejects a ruby span that cannot fit without removing its annotation', () => {
  const text = '東京'.repeat(200);
  invalid(() => planChunks(chapter([paragraph('p', text, [{ start: 0, end: text.length, reading: 'とうきょう'.repeat(200) }])]), { ...config, outputBudget: 700 }, token));
 });

 it('includes only bounded previous context when it fits, with no output overlap', () => {
  const source = chapter(Array.from({ length: 5 }, (_, i) => paragraph(`p${i}`, '東京の物語。'.repeat(6))));
  const planned = planChunks(source, { ...config, outputBudget: 600 }, token);
  expect(planned.length).toBeGreaterThan(1);
  expect(planned.slice(1).some(r => r.context.length > 0)).toBe(true);
  for (const [index, request] of planned.entries()) {
   expect(request.context.length).toBeLessThanOrEqual(1);
   expect(request.context.every(p => !request.outputIds.includes(p.id))).toBe(true);
   if (request.context.length) expect(request.context[0]).toEqual(planned[index - 1]!.paragraphs.at(-1));
  }
  expect(reassembleParagraphs(source, planned, translated(planned))).toHaveLength(source.paragraphs.length);
 });

 it('drops optional context instead of reducing target coverage', () => {
  const source = chapter([paragraph('p1', 'あ'.repeat(70)), paragraph('p2', 'い'.repeat(70))]);
  const planned = planChunks(source, { ...config, contextBudget: 2750, outputBudget: 900 }, token);
  expect(segments(planned).map(p => p.id)).toEqual(['p1', 'p2']);
  expect(planned).toHaveLength(2);
  expect(planned[1]!.context).toEqual([]);
 });

 it.each([
  { contextBudget: 1000, outputBudget: 100 }, { contextBudget: 8192, outputBudget: 1 },
  { contextBudget: 1000, outputBudget: 1000 }, { contextBudget: Infinity, outputBudget: 10 },
  { contextBudget: 8192, outputBudget: 1.5 }, { contextBudget: 8192, outputBudget: -1 },
 ])('rejects invalid or insufficient budgets %j without creating unusable requests', budget => {
  invalid(() => planChunks(chapter([paragraph('p1', 'あ')]), budget, token));
 });

 it('rejects duplicate source IDs and invalid ruby or surrogate boundaries', () => {
  invalid(() => planChunks(chapter([paragraph('p', 'あ'), paragraph('p', 'い')]), config, token));
  for (const ruby of [[{ start: 1, end: 2, reading: 'x' }], [{ start: 0, end: 4, reading: 'x' }], [{ start: 0, end: 0, reading: 'x' }]]) {
   invalid(() => planChunks(chapter([paragraph('p', '😀あ', ruby)]), config, token));
  }
 });

 it('fits every emitted escape-heavy request into the actual provider preflight', async () => {
  const source = chapter([
   paragraph('escape"\\\n', ('東京\\"\n\t\u0001😀').repeat(220)),
   paragraph('ruby', '読み仮名'.repeat(100), [{ start: 0, end: 4, reading: '\\"\n'.repeat(15) }]),
  ]);
  for (const budget of [{ contextBudget: 2700, outputBudget: 750 }, { contextBudget: 8192, outputBudget: 2048 }]) {
   const planned = planChunks(source, budget, token);
   expect(planned.length).toBeGreaterThan(0);
   const posted: ModelRequest[] = [];
   const secrets: SecretStore = { get: async () => null, set: async () => {}, remove: async () => {} };
   const provider = createOpenAICompatibleProvider({ ...config, ...budget }, { get: async () => { throw new Error('Catalog not used in legacy fixture'); }, post: async request => {
    posted.push(request);
    const messages = request.body.messages as { role: string; content: string }[];
    const payload = JSON.parse(messages[1]!.content) as { outputIds: string[] };
    return { status: 200, headers: {}, url: request.url, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ paragraphs: payload.outputIds.map(id => ({ id, text: '번역' })) }) } }] } };
   } }, secrets);
   for (const request of planned) {
    expect(await provider.translateChunk(request, new AbortController().signal)).toEqual(result(request));
    const outputFraming = new TextEncoder().encode(JSON.stringify({ paragraphs: request.outputIds.map(id => ({ id, text: '' })) })).length;
    const expansion = request.paragraphs.reduce((sum, p) => sum + new TextEncoder().encode(JSON.stringify(p.text)).length - 2, 0) * 3;
    expect(outputFraming + expansion).toBeLessThanOrEqual(budget.outputBudget);
   }
   expect(posted).toHaveLength(planned.length);
  }
 });
});

describe('chunk result validation and complete source coverage', () => {
 const source = chapter([paragraph('p1', '初め。'), paragraph('p2', '続き。')]);
 const request = () => planChunks(source, config, token)[0]!;
 it('accepts exact ordered nonempty output and returns an independent validated snapshot', () => {
  const req = request(); const value = result(req);
  const valid = validateChunk(req, value);
  expect(valid).toEqual({ chunkId: req.chunkId, paragraphs: value.paragraphs, validated: true });
  expect(valid.paragraphs).not.toBe(value.paragraphs);
  expect(valid.paragraphs[0]).not.toBe(value.paragraphs[0]);
 });
 it.each(['length', 'blocked', 'unknown'] as const)('rejects %s finish reasons', finishReason => {
  const req = request(); invalid(() => validateChunk(req, { ...result(req), finishReason }));
 });
 it('rejects chunk identity, duplicate/missing/reordered/added IDs, blank and malformed text', () => {
  const req = request(); const value = result(req);
  const invalidResults: unknown[] = [
   { ...value, chunkId: 'different' }, { ...value, paragraphs: value.paragraphs.slice(1) },
   { ...value, paragraphs: [...value.paragraphs].reverse() }, { ...value, paragraphs: [value.paragraphs[0], value.paragraphs[0]] },
   { ...value, paragraphs: [...value.paragraphs, { id: 'extra', text: 'extra' }] },
   { ...value, paragraphs: [{ id: 'p1', text: ' \n' }, value.paragraphs[1]] },
   { ...value, paragraphs: [{ id: 'p1', text: 42 }, value.paragraphs[1]] }, { ...value, paragraphs: Array(2) }, null,
  ];
  for (const bad of invalidResults) invalid(() => validateChunk(req, bad as ChunkResult));
 });
 it('rejects malformed or sparse request arrays instead of accepting a validated marker', () => {
  const req = request();
  invalid(() => validateChunk({ ...req, paragraphs: Array(2) }, result(req)));
  invalid(() => reassembleParagraphs(source, [null] as unknown as ChunkRequest[], translated([req])));
  const badRuby = { ...req, paragraphs: [{ ...req.paragraphs[0]!, ruby: [null] }, req.paragraphs[1]!] } as unknown as ChunkRequest;
  invalid(() => reassembleParagraphs(source, [badRuby], translated([req])));
 });
 it('requires exactly all request chunks in original order, even for purported validated data', () => {
  const multiSource = chapter([paragraph('p1', '東京'.repeat(200)), paragraph('p2', '次。')]);
  const planned = planChunks(multiSource, { ...config, outputBudget: 700 }, token);
  const valid = translated(planned);
  for (const bad of [valid.slice(1), [...valid, valid[0]!], [...valid].reverse(), [{ ...valid[0]!, validated: false }, ...valid.slice(1)]]) {
   invalid(() => reassembleParagraphs(multiSource, planned, bad as ValidatedChunk[]));
  }
  invalid(() => reassembleParagraphs(multiSource, planned.slice(1), valid.slice(1)));
  invalid(() => reassembleParagraphs(multiSource, planned, [{ ...valid[0]!, paragraphs: [] }, ...valid.slice(1)]));
 });
 it('rejects requests that omit, reorder, duplicate, or alter source paragraphs', () => {
  const req = request();
  const badRequests: ChunkRequest[][] = [
   [{ ...req, paragraphs: [req.paragraphs[0]!], outputIds: ['p1'] }],
   [{ ...req, paragraphs: [...req.paragraphs].reverse(), outputIds: ['p2', 'p1'] }],
   [{ ...req, paragraphs: [req.paragraphs[0]!, req.paragraphs[0]!], outputIds: ['p1', 'p1'] }],
   [{ ...req, paragraphs: [{ ...req.paragraphs[0]!, text: 'changed' }, req.paragraphs[1]!] }],
  ];
  for (const bad of badRequests) invalid(() => reassembleParagraphs(source, bad, bad.map(r => ({ chunkId: r.chunkId, paragraphs: result(r).paragraphs, validated: true }))));
 });
 it('rechecks split ranges, ruby annotations, and every source code point during assembly', () => {
  const longSource = chapter([paragraph('long', '東京'.repeat(100), [{ start: 0, end: 2, reading: 'とうきょう' }])]);
  const planned = planChunks(longSource, { ...config, outputBudget: 700 }, token);
  const first = planned[0]!;
  const changed = [{ ...first, paragraphs: [{ ...first.paragraphs[0]!, ruby: [] }, ...first.paragraphs.slice(1)] }, ...planned.slice(1)];
  invalid(() => reassembleParagraphs(longSource, changed, translated(changed)));
  const omitted = planned.slice(1);
  invalid(() => reassembleParagraphs(longSource, omitted, translated(omitted)));
 });
});
