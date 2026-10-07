import type { CompletedTranslation, ReadingPosition, WorkPage, SelectedModel } from '../contracts';
import { check, integer, object, record, text, url } from './validation';
import { StorageError } from './errors';
import { secretRef } from './secrets';
import { validLocalLimits } from '../translation/segments';
export function identifier(value: unknown): asserts value is string {
  text(value);
  check(/^[A-Za-z0-9][A-Za-z0-9.-]{0,255}$/.test(value) && !value.includes('..'));
}
/** Domain payload identity, never interpolated into a private-file path. */
export function chapterIdentity(value: unknown): asserts value is string {
  text(value);
  const match = /^(n[0-9]{4}[a-z]{1,2})\/(short|[1-9][0-9]*)$/.exec(value);
  check(match !== null && (match[2] === 'short' || Number.isSafeInteger(Number(match[2]))));
}
/** Only TOC page references admit the single positive page parameter. */
function workPageUrl(value: unknown, workId: string): void {
  text(value);
  const prefix = `https://ncode.syosetu.com/${workId}/`;
  check(
    value === prefix ||
      (value.startsWith(prefix + '?p=') &&
        /^[1-9][0-9]*$/.test(value.slice((prefix + '?p=').length)) &&
        Number.isSafeInteger(Number(value.slice((prefix + '?p=').length)))),
  );
}
function date(value: unknown) {
  text(value);
  check(Number.isFinite(Date.parse(value)));
}
export function selected(value: unknown): asserts value is SelectedModel {
  object(value, ['connection', 'modelId', 'limits', 'translationMode', 'autoRetryFailed']);
  check(value.autoRetryFailed === undefined || typeof value.autoRetryFailed === 'boolean');
  check(
    value.translationMode === undefined ||
      value.translationMode === 'stream' ||
      value.translationMode === 'legacy',
  );
  text(value.modelId);
  check(value.modelId.length <= 256);
  object(value.connection, ['provider', 'baseUrl', 'authRef', 'revision']);
  const c = value.connection;
  check(c.provider === 'openai-compatible' || c.provider === 'gemini');
  url(c.baseUrl);
  integer(c.revision);
  if (c.authRef !== undefined) secretRef(c.authRef);
  if (value.limits !== undefined) {
    object(value.limits, ['contextTokens', 'inputBudgetTokens', 'maxOutputTokens']);
    check(c.provider === 'openai-compatible');
    check(validLocalLimits(value.limits));
  }
}
export async function completedTranslation(value: unknown): Promise<CompletedTranslation> {
  record(value);
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== 2)
    throw new StorageError('unsupported_schema');
  object(value, [
    'schemaVersion',
    'versionId',
    'source',
    'text',
    'blocks',
    'createdAt',
    'provenance',
    'quality',
    'failedParagraphs',
  ]);
  check(value.schemaVersion === 2);
  identifier(value.versionId);
  text(value.text);
  date(value.createdAt);
  object(value.source, [
    'canonicalUrl',
    'workId',
    'chapterId',
    'title',
    'prevUrl',
    'nextUrl',
    'sourceHash',
    'paragraphs',
    'captureKind',
    'rawHtml',
    'fetchedAt',
  ]);
  const source = value.source;
  identifier(source.workId);
  chapterIdentity(source.chapterId);
  url(source.canonicalUrl, true);
  text(source.title);
  text(source.sourceHash);
  for (const neighbor of [source.prevUrl, source.nextUrl])
    if (neighbor !== null) url(neighbor, true);
  if (source.captureKind === 'fetched') {
    check(typeof source.rawHtml === 'string');
    date(source.fetchedAt);
  } else
    check(
      source.captureKind === 'legacy-import' &&
        source.rawHtml === null &&
        source.fetchedAt === null,
    );
  check(Array.isArray(source.paragraphs) && source.paragraphs.length > 0);
  const ids = new Set<string>();
  for (const p of source.paragraphs) {
    object(p, ['id', 'text', 'ruby']);
    text(p.id);
    check(!ids.has(p.id));
    ids.add(p.id);
    check(typeof p.text === 'string' && Array.isArray(p.ruby));
    let end = 0;
    for (const r of p.ruby) {
      object(r, ['start', 'end', 'reading']);
      integer(r.start);
      integer(r.end, 1);
      text(r.reading);
      check(r.start >= end && r.start < r.end && r.end <= p.text.length);
      end = r.end;
    }
  }
  check(Array.isArray(value.blocks) && value.blocks.length > 0);
  const blocks = new Set<string>();
  for (const b of value.blocks) {
    object(b, ['id', 'text']);
    identifier(b.id);
    check(typeof b.text === 'string' && !blocks.has(b.id));
    blocks.add(b.id);
  }
  check(value.blocks.map((b) => b.text).join('\n\n') === value.text);
  if (value.quality !== undefined) {
    object(value.quality, ['ruleVersion', 'japaneseBlocks', 'missingTerms']);
    check(value.quality.ruleVersion === 'deterministic-v1');
    check(Array.isArray(value.quality.japaneseBlocks));
    let previous = -1;
    for (const index of value.quality.japaneseBlocks) {
      integer(index);
      check(index > previous && index < value.blocks.length);
      previous = index;
    }
    check(Array.isArray(value.quality.missingTerms));
    for (const term of value.quality.missingTerms) {
      object(term, ['source', 'target']);
      text(term.source);
      text(term.target);
      check(
        !!term.source.trim() &&
          !!term.target.trim() &&
          term.source.length <= 80 &&
          term.target.length <= 80,
      );
    }
  }
  object(value.provenance, [
    'provider',
    'connectionId',
    'modelId',
    'contractVersion',
    'promptVersion',
    'languageDirection',
    'generation',
    'guidanceHash',
    'repair',
  ]);
  const p = value.provenance;
  if (p.repair !== undefined) {
    object(p.repair, ['baseVersionId', 'paragraphIndexes']);
    identifier(p.repair.baseVersionId);
    check(p.repair.baseVersionId !== value.versionId);
    check(Array.isArray(p.repair.paragraphIndexes) && p.repair.paragraphIndexes.length > 0);
    const indexes = p.repair.paragraphIndexes as number[];
    const count = source.paragraphs.length;
    check(
      indexes.every(
        (index, i) =>
          Number.isSafeInteger(index) &&
          index >= 0 &&
          index < count &&
          (i === 0 || index > indexes[i - 1]!),
      ),
    );
    check(value.blocks.length === source.paragraphs.length);
  }
  check(p.provider === 'openai-compatible' || p.provider === 'gemini');
  text(p.connectionId);
  text(p.modelId);
  check(p.contractVersion === 'plain-v1' && p.languageDirection === 'ja-ko');
  text(p.promptVersion);
  if (p.guidanceHash !== undefined)
    check(typeof p.guidanceHash === 'string' && /^[a-f0-9]{64}$/.test(p.guidanceHash));
  if (p.generation !== undefined) {
    object(p.generation, [
      'mode',
      'contextTokens',
      'inputBudgetTokens',
      'maxOutputTokens',
      'segments',
      'continuations',
      'estimator',
    ]);
    const g = p.generation;
    check(
      p.provider === 'openai-compatible' &&
        ((p.promptVersion === 'hymt2-segments-v1' && g.mode === 'segments-v1') ||
          (p.promptVersion === 'lines-v1' && g.mode === 'lines-v1') ||
          (p.promptVersion === 'colomo-local-v1' && g.mode === 'colomo-local-v1')),
    );
    integer(g.segments, 1);
    if (g.continuations !== undefined) integer(g.continuations, 0);
    if (g.estimator !== undefined)
      check(g.estimator === 'utf8-v1' || g.estimator === 'gemma-e4b-v1');
    check(validLocalLimits(g));
  }
  if (value.failedParagraphs !== undefined) {
    check(Array.isArray(value.failedParagraphs));
    const failures = value.failedParagraphs as number[];
    const blocks = value.blocks as unknown[];
    check(
      failures.every(
        (index, i) =>
          Number.isSafeInteger(index) &&
          index >= 0 &&
          index < blocks.length &&
          (i === 0 || index > failures[i - 1]!),
      ),
    );
  }
  return value as unknown as CompletedTranslation;
}
export async function workPage(value: unknown): Promise<WorkPage> {
  object(value, [
    'workId',
    'canonicalUrl',
    'title',
    'chapters',
    'pageUrl',
    'nextPageUrl',
    'complete',
  ]);
  identifier(value.workId);
  url(value.canonicalUrl, true);
  workPageUrl(value.pageUrl, value.workId);
  if (value.nextPageUrl !== null) workPageUrl(value.nextPageUrl, value.workId);
  text(value.title);
  check(typeof value.complete === 'boolean' && Array.isArray(value.chapters));
  const ids = new Set<string>();
  for (const ref of value.chapters) {
    object(ref, ['workId', 'chapterId', 'canonicalUrl', 'title', 'ordinal']);
    check(ref.workId === value.workId);
    chapterIdentity(ref.chapterId);
    check(!ids.has(ref.chapterId));
    ids.add(ref.chapterId);
    url(ref.canonicalUrl, true);
    text(ref.title);
    integer(ref.ordinal, 1);
  }
  return value as unknown as WorkPage;
}
export async function readingPosition(value: unknown): Promise<ReadingPosition> {
  object(value, ['workId', 'chapterId', 'versionId', 'blockId', 'offset']);
  for (const key of ['workId', 'versionId', 'blockId']) identifier(value[key]);
  chapterIdentity(value.chapterId);
  check(
    typeof value.offset === 'number' &&
      Number.isFinite(value.offset) &&
      value.offset >= 0 &&
      value.offset <= Number.MAX_SAFE_INTEGER,
  );
  return value as unknown as ReadingPosition;
}
