import { ReaderError } from '../contracts';
import type { Chapter, ChunkRequest, ChunkResult, JobToken, Paragraph, ProviderConfig, Ruby, TranslatedParagraph, ValidatedChunk } from '../contracts';

/** Bump when translation instructions change; the cache identity includes this value. */
export const PROMPT_VERSION = 'ja-ko-v1';
const PLANNER_VERSION = '1';
const INPUT_RESERVE = 1024 + 256;
const OUTPUT_RESERVE = 128;
const CONTEXT_LIMIT = 1024;
const encoder = new TextEncoder();
type Budget = Pick<ProviderConfig, 'contextBudget' | 'outputBudget'>;
const bytes = (value: string): number => encoder.encode(value).length;
function check(condition: unknown, received = false): asserts condition {
 if (!condition) throw new ReaderError('invalid_output', received ? 'received' : 'not_sent');
}
function object(value: unknown): value is Record<string, unknown> {
 return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonblank(value: unknown): value is string { return typeof value === 'string' && !!value.trim(); }
function boundary(text: string, offset: number): boolean {
 return offset === 0 || offset === text.length || !(text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
}
function assertChapter(chapter: Chapter): void {
 check(object(chapter) && nonblank(chapter.sourceHash) && Array.isArray(chapter.paragraphs));
 const ids = new Set<string>();
 for (const p of chapter.paragraphs) {
  check(object(p) && nonblank(p.id) && typeof p.text === 'string' && Array.isArray(p.ruby) && !ids.has(p.id));
  ids.add(p.id);
  // A lone UTF-16 surrogate would be replaced by the transport's UTF-8 encoder.
  check(!/[\uD800-\uDFFF]/u.test(p.text));
  for (const r of p.ruby) {
   check(object(r) && typeof r.start === 'number' && typeof r.end === 'number' && Number.isSafeInteger(r.start) && Number.isSafeInteger(r.end) && r.start >= 0 && r.end > r.start && r.end <= p.text.length && nonblank(r.reading));
   check(boundary(p.text, r.start) && boundary(p.text, r.end));
  }
 }
}
function snapshot(p: Paragraph): Paragraph {
 return { id: p.id, text: p.text, ruby: p.ruby.map(r => ({ start: r.start, end: r.end, reading: r.reading })) };
}
function payload(paragraphs: readonly Paragraph[], context: readonly Paragraph[]): object {
 return { context, paragraphs, outputIds: paragraphs.map(p => p.id), languageDirection: 'ja-ko', promptVersion: PROMPT_VERSION };
}
function fits(paragraphs: readonly Paragraph[], context: readonly Paragraph[], budget: Budget): boolean {
 // Match the provider's nested JSON message escaping, not just raw source bytes.
 // Treat every UTF-8 byte as a token, then allow 1,024 bytes for the static system
 // message and 256 for framing. The provider checks its exact system message too.
 const input = bytes(JSON.stringify([{ role: 'user', content: JSON.stringify(payload(paragraphs, context)) }])) + INPUT_RESERVE;
 // JSON/ID framing is charged exactly. Source text gets a conservative 3x UTF-8
 // expansion allowance (including JSON escapes), plus a fixed completion reserve.
 // This is a planning estimate, never a guarantee of a particular model's output.
 const output = bytes(JSON.stringify({ paragraphs: paragraphs.map(p => ({ id: p.id, text: '' })) })) + OUTPUT_RESERVE
  + 3 * paragraphs.reduce((sum, p) => sum + bytes(JSON.stringify(p.text)) - 2, 0);
 return input + budget.outputBudget <= budget.contextBudget && output <= budget.outputBudget;
}
function rubySlice(p: Paragraph, start: number, end: number): Ruby[] {
 return p.ruby.filter(r => r.start >= start && r.end <= end).map(r => ({ start: r.start - start, end: r.end - start, reading: r.reading }));
}
function safeBoundaries(p: Paragraph): number[] {
 const spans = [...p.ruby].sort((a, b) => a.start - b.start);
 const boundaries = [0];
 let offset = 0, spanIndex = 0, spanEnd = 0;
 for (const char of p.text) {
  offset += char.length;
  while (spanIndex < spans.length && spans[spanIndex]!.start < offset) {
   spanEnd = Math.max(spanEnd, spans[spanIndex]!.end);
   spanIndex++;
  }
  if (offset >= spanEnd) boundaries.push(offset);
 }
 return boundaries;
}
function splitParagraph(p: Paragraph, budget: Budget, sourceIds: ReadonlySet<string>): Paragraph[] {
 const boundaries = safeBoundaries(p);
 const pieces: Paragraph[] = [];
 let cursor = 0;
 while (cursor < boundaries.length - 1) {
  const start = boundaries[cursor]!;
  const segment = (endIndex: number): Paragraph => {
   const end = boundaries[endIndex]!;
   return { id: `${p.id}~part:${start}:${end}`, text: p.text.slice(start, end), ruby: rubySlice(p, start, end) };
  };
  const first = segment(cursor + 1);
  check(fits([first], [], budget)); // An oversized indivisible ruby span fails closed.
  let low = cursor + 1, high = low + 1, step = 1;
  // Exponential probing avoids serializing the whole remaining novel for each
  // small piece, while binary search finds the largest fitting safe boundary.
  while (high < boundaries.length && fits([segment(high)], [], budget)) {
   low = high;
   step *= 2;
   high = Math.min(boundaries.length, high + step);
  }
  let left = low + 1, right = Math.min(high, boundaries.length - 1);
  while (left <= right) {
   const middle = Math.floor((left + right) / 2);
   if (fits([segment(middle)], [], budget)) { low = middle; left = middle + 1; }
   else right = middle - 1;
  }
  const piece = segment(low);
  check(!sourceIds.has(piece.id));
  // Pure whitespace segments need no model request; assembly restores those
  // exact source ranges. This also handles very long leading/trailing spaces.
  if (piece.text.trim()) pieces.push(piece);
  cursor = low;
 }
 return pieces;
}

/** Pure, ordered and deterministic. No tokenizer, network call, or mutable job state. */
export function planChunks(chapter: Chapter, config: Budget, token: JobToken): ChunkRequest[] {
 assertChapter(chapter);
 check(Number.isSafeInteger(config.contextBudget) && Number.isSafeInteger(config.outputBudget) && config.outputBudget > 0 && config.contextBudget > config.outputBudget);
 const budget = { contextBudget: config.contextBudget, outputBudget: config.outputBudget };
 const sourceIds = new Set(chapter.paragraphs.map(p => p.id));
 const requests: ChunkRequest[] = [];
 let pending: Paragraph[] = [];
 const flush = (): void => {
  if (!pending.length) return;
  const previous = requests.at(-1)?.paragraphs.at(-1);
  const context = previous && bytes(JSON.stringify(previous)) <= CONTEXT_LIMIT && fits(pending, [previous], budget) ? [snapshot(previous)] : [];
  requests.push({
   token: { ...token }, chunkId: `chunk:${PLANNER_VERSION}:${PROMPT_VERSION}:${encodeURIComponent(chapter.sourceHash)}:${budget.contextBudget}:${budget.outputBudget}:${requests.length}`,
   context, paragraphs: pending, outputIds: pending.map(p => p.id), languageDirection: 'ja-ko', promptVersion: PROMPT_VERSION,
  });
  pending = [];
 };
 for (const original of chapter.paragraphs) {
  if (!original.text.trim()) continue;
  const p = snapshot(original);
  const pieces = fits([p], [], budget) ? [p] : splitParagraph(p, budget, sourceIds);
  for (const piece of pieces) {
   // Optional context never forces a target to split or spill into another chunk.
   if (pending.length && !fits([...pending, piece], [], budget)) flush();
   pending.push(piece);
  }
 }
 flush();
 return requests;
}

function assertRequest(request: ChunkRequest): void {
 check(object(request) && nonblank(request.chunkId) && request.languageDirection === 'ja-ko' && request.promptVersion === PROMPT_VERSION);
 check(Array.isArray(request.paragraphs) && Array.isArray(request.outputIds) && request.outputIds.length > 0 && request.outputIds.length === request.paragraphs.length);
 const ids = new Set<string>();
 Array.from(request.paragraphs).forEach((p, i) => {
  check(object(p) && nonblank(p.id) && p.id === request.outputIds[i] && !ids.has(p.id) && nonblank(p.text) && Array.isArray(p.ruby));
  ids.add(p.id);
 });
 check(Array.isArray(request.context) && request.context.every(p => object(p) && nonblank(p.id) && !ids.has(p.id)));
}
/** Only complete, exact ordered output becomes checkpoint-eligible data. */
export function validateChunk(request: ChunkRequest, result: ChunkResult): ValidatedChunk {
 assertRequest(request);
 check(object(result) && result.chunkId === request.chunkId && result.finishReason === 'complete' && Array.isArray(result.paragraphs) && result.paragraphs.length === request.outputIds.length, true);
 const paragraphs = Array.from(result.paragraphs).map((p, index) => {
  check(object(p) && p.id === request.outputIds[index] && nonblank(p.text), true);
  return { id: p.id as string, text: p.text };
 });
 return { chunkId: request.chunkId, paragraphs, validated: true };
}
function equalRuby(a: readonly Ruby[], b: readonly Ruby[]): boolean {
 return a.length === b.length && Array.from(a).every((r, i) => object(r) && r.start === b[i]?.start && r.end === b[i]?.end && r.reading === b[i]?.reading);
}
function safeRange(p: Paragraph, start: number, end: number): boolean {
 return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= p.text.length
  && boundary(p.text, start) && boundary(p.text, end) && p.ruby.every(r => !(r.start < start && start < r.end) && !(r.start < end && end < r.end));
}

/** Revalidate persisted chunks and require exact ordered coverage of the source. */
export function reassembleParagraphs(chapter: Chapter, requests: readonly ChunkRequest[], chunks: readonly ValidatedChunk[]): TranslatedParagraph[] {
 assertChapter(chapter);
 check(Array.isArray(requests) && Array.isArray(chunks) && chunks.length === requests.length);
 const originals = new Set(chapter.paragraphs.map(p => p.id));
 const chunkIds = new Set<string>(), segmentIds = new Set<string>();
 const entries: { source: Paragraph; translated: TranslatedParagraph }[] = [];
 Array.from(requests).forEach((request: ChunkRequest, index: number) => {
  assertRequest(request);
  check(!chunkIds.has(request.chunkId)); chunkIds.add(request.chunkId);
  const chunk = chunks[index];
  check(object(chunk) && chunk.validated === true && typeof chunk.chunkId === 'string' && Array.isArray(chunk.paragraphs));
  const valid = validateChunk(request, { chunkId: chunk.chunkId, paragraphs: chunk.paragraphs, finishReason: 'complete' });
  request.paragraphs.forEach((source, i) => {
   check(!segmentIds.has(source.id)); segmentIds.add(source.id);
   entries.push({ source, translated: valid.paragraphs[i]! });
  });
 });
 let cursor = 0;
 const output = chapter.paragraphs.map(original => {
  if (!original.text.trim()) return { id: original.id, text: original.text };
  const entry = entries[cursor];
  if (entry?.source.id === original.id) {
   check(entry.source.text === original.text && equalRuby(entry.source.ruby, original.ruby));
   cursor++;
   return { id: original.id, text: entry.translated.text };
  }
  const prefix = `${original.id}~part:`;
  let covered = 0, count = 0, text = '';
  while (entries[cursor]?.source.id.startsWith(prefix)) {
   const part = entries[cursor]!;
   check(!originals.has(part.source.id));
   const range = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(part.source.id.slice(prefix.length));
   check(range);
   const start = Number(range[1]), end = Number(range[2]);
   check(safeRange(original, start, end) && start >= covered);
   const gap = original.text.slice(covered, start);
   check(!gap.trim() && part.source.text === original.text.slice(start, end) && equalRuby(part.source.ruby, rubySlice(original, start, end)));
   text += gap + part.translated.text;
   covered = end; cursor++; count++;
  }
  const tail = original.text.slice(covered);
  check(count > 0 && !tail.trim());
  return { id: original.id, text: text + tail };
 });
 check(cursor === entries.length);
 return output;
}
