import { ReaderError } from '../contracts';
import type {
  ChapterRef,
  LibraryStore,
  RenewalSource,
  SelectedModel,
  SourceSnapshot,
  TranslationState,
  WorkPage,
} from '../contracts/reading';
import { Journal, serial, type PrivateFiles } from '../storage/journal';
import { check, integer, object, text } from '../storage/validation';
import { StorageError } from '../storage/errors';
import { identifier, selected, workPage } from '../storage/readingValidation';
import type { WholeChapterFlow } from './wholeChapter';
import { normalizeChapterInput } from '../providers/plainText';
import { referencePreset } from './preset';
import {
  appliedGuidanceHash,
  guidanceHash,
  isMachineTerm,
  validateGuidance,
  type GuidanceRepository,
  type WorkGuidance,
} from './guidance';
import { createNameCandidateScan, type NameCandidate } from './scan';
import type { ScanChapter } from './termScan';

export type CandidateChoice = { source: string; target: string };
type RangeScan = { status: 'pending' | 'review' | 'confirmed'; candidates: NameCandidate[] };

type BatchPhase = 'prepared' | 'running' | 'paused' | 'unknown' | 'saving' | 'complete';
export type ChapterRange = { first: number; last: number };
export type BatchRecord = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  work: WorkPage;
  selection: SelectedModel;
  chapters: readonly ChapterRef[];
  retranslate: boolean;
  alreadySaved: number;
  cursor: number;
  completed: number;
  skipped: number;
  phase: BatchPhase;
  currentVersionIds?: readonly string[];
  guidance?: WorkGuidance;
  scan?: RangeScan;
};
export type BatchState = {
  record: BatchRecord | null;
  active: boolean;
  preparing: boolean;
  preparingWorkId?: string;
  errorWorkId?: string;
  error: string | null;
  chapterProgress?: TranslationState['progress'];
  scanProgress?: { completed: number; total: number };
};
export interface BatchRepository {
  read(): Promise<BatchRecord | null>;
  write(value: BatchRecord): Promise<void>;
}
export interface BatchTranslation {
  initialize(): Promise<void>;
  prepare(
    work: WorkPage,
    selection: SelectedModel,
    range: ChapterRange | null,
    retranslate: boolean,
  ): Promise<void>;
  run(retryUncertain?: boolean): Promise<void>;
  scan(): Promise<void>;
  /** review 단계 범위의 원문을 회차 순서대로 돌려준다. 범위 스캔에서 받은 원문은 다시 받지 않는다. */
  scanChapters(
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ScanChapter[]>;
  confirmCandidates(choices: readonly CandidateChoice[]): Promise<void>;
  cancel(): void;
  clearWork(workId: string): boolean;
  retrySave(): Promise<void>;
  getSnapshot(): BatchState;
  readonly active: boolean;
  setForeground(active: boolean): void;
  subscribe(listener: (state: BatchState) => void): () => void;
  dispose(): void;
}
const MAX_BATCH_CHAPTERS = 10000;
// 범위가 커도 원문 전문은 처음 8화까지만 재사용한다. 나머지는 번역할 때 다시 가져온다.
const SCANNED_SOURCE_CACHE_SIZE = 8;
export async function validateBatch(value: unknown): Promise<BatchRecord | null> {
  if (value === null) return null;
  if (
    value &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    value.schemaVersion !== 1
  )
    throw new StorageError('unsupported_schema');
  object(value, [
    'schemaVersion',
    'id',
    'createdAt',
    'work',
    'selection',
    'chapters',
    'retranslate',
    'alreadySaved',
    'cursor',
    'completed',
    'skipped',
    'phase',
    'currentVersionIds',
    'guidance',
    'scan',
  ]);
  check(value.schemaVersion === 1);
  identifier(value.id);
  text(value.createdAt);
  check(Number.isFinite(Date.parse(value.createdAt)));
  selected(value.selection);
  const work = await workPage(value.work);
  if (value.guidance !== undefined) {
    const guidance = await validateGuidance(value.guidance);
    check(guidance.workId === work.workId);
  }
  check(work.complete && work.nextPageUrl === null);
  check(
    Array.isArray(value.chapters) &&
      value.chapters.length > 0 &&
      value.chapters.length <= MAX_BATCH_CHAPTERS,
  );
  const validatedChapters = await workPage({ ...work, chapters: value.chapters });
  const chapterIds = new Set(validatedChapters.chapters.map((chapter) => chapter.chapterId));
  if (value.scan !== undefined) {
    object(value.scan, ['status', 'candidates']);
    check(['pending', 'review', 'confirmed'].includes(String(value.scan.status)));
    check(Array.isArray(value.scan.candidates));
    const names = new Set<string>();
    for (const candidate of value.scan.candidates) {
      object(candidate, ['source', 'reading', 'kind', 'count', 'chapterIds']);
      text(candidate.source);
      check(!!candidate.source.trim() && !names.has(candidate.source.normalize('NFKC')));
      names.add(candidate.source.normalize('NFKC'));
      if (candidate.reading !== undefined) text(candidate.reading);
      check(candidate.kind === 'ruby' || candidate.kind === 'katakana');
      integer(candidate.count, 1);
      check(Array.isArray(candidate.chapterIds) && candidate.chapterIds.length > 0);
      check(new Set(candidate.chapterIds).size === candidate.chapterIds.length);
      check(candidate.chapterIds.every((id) => chapterIds.has(String(id))));
    }
    if (value.scan.status === 'pending') check(value.scan.candidates.length === 0);
  }
  check(
    validatedChapters.chapters.every(
      (chapter, index) => chapter.ordinal === validatedChapters.chapters[0]!.ordinal + index,
    ),
  );
  check(typeof value.retranslate === 'boolean');
  integer(value.alreadySaved);
  integer(value.cursor);
  integer(value.completed);
  integer(value.skipped);
  check(value.alreadySaved <= value.chapters.length && value.cursor <= value.chapters.length);
  check(value.completed + value.skipped === value.cursor);
  check(
    ['prepared', 'running', 'paused', 'unknown', 'saving', 'complete'].includes(
      String(value.phase),
    ),
  );
  if (value.phase === 'complete') check(value.cursor === value.chapters.length);
  if (value.currentVersionIds !== undefined) {
    check(
      Array.isArray(value.currentVersionIds) &&
        value.currentVersionIds.length <= MAX_BATCH_CHAPTERS,
    );
    value.currentVersionIds.forEach(identifier);
  }
  return value as unknown as BatchRecord;
}
export function createBatchRepository(files: PrivateFiles): BatchRepository {
  const journal = new Journal(files);
  return {
    read: () =>
      serial(
        files,
        async () => (await journal.load('batches/current', validateBatch))?.value ?? null,
      ),
    write: (value) =>
      serial(files, () => journal.save('batches/current', structuredClone(value), validateBatch)),
  };
}
export function createBatchTranslation(dependencies: {
  source: RenewalSource;
  library: LibraryStore;
  flow: WholeChapterFlow;
  repository: BatchRepository;
  guidance?: GuidanceRepository;
}): BatchTranslation {
  let state: BatchState = { record: null, active: false, preparing: false, error: null };
  let foreground = false;
  let disposed = false;
  let cancelled = false;
  let preparation: AbortController | null = null;
  const scannedSources = new Map<string, SourceSnapshot>();
  // 범위 스캔에서 받은 회차 원문(정밀스캔 채우기용). 범위 전체를 기억하므로 scannedSources와 달리 개수 상한이 없다.
  const scannedChapters = new Map<string, ScanChapter>();
  const listeners = new Set<(state: BatchState) => void>();
  function publish(update: Partial<BatchState>): void {
    const next = { ...state, ...update };
    if ('error' in update) {
      if (update.error === null) next.errorWorkId = undefined;
      else if (update.error !== undefined && update.errorWorkId === undefined)
        next.errorWorkId = state.record?.work.workId;
    }
    if (next.errorWorkId === undefined) delete next.errorWorkId;
    state = next;
    if (!disposed) listeners.forEach((listener) => listener(state));
  }
  async function persist(record: BatchRecord): Promise<void> {
    await dependencies.repository.write(record);
    publish({ record, error: null, errorWorkId: undefined });
  }
  async function matchesSelection(
    version: Awaited<ReturnType<LibraryStore['listVersions']>>[number],
    selection: SelectedModel,
    guidance?: WorkGuidance | null,
  ): Promise<boolean> {
    return (
      version.provenance.provider === selection.connection.provider &&
      version.provenance.modelId === selection.modelId &&
      version.provenance.guidanceHash ===
        (await appliedGuidanceHash(
          guidance ?? null,
          version.source.workId,
          normalizeChapterInput(version.source),
          referencePreset(selection),
        ))
    );
  }
  async function filterAsync<T>(items: readonly T[], test: (item: T) => Promise<boolean>) {
    const kept = await Promise.all(items.map(test));
    return items.filter((_, index) => kept[index]);
  }
  async function initialize(): Promise<void> {
    const record = await dependencies.repository.read();
    if (!record) return;
    if (record.phase === 'running' || record.phase === 'saving') {
      const phase = record.currentVersionIds === undefined ? 'paused' : 'unknown';
      await persist({ ...record, phase });
      return;
    }
    publish({ record });
  }
  async function collectWork(work: WorkPage, signal: AbortSignal): Promise<WorkPage> {
    const chapters = new Map<string, ChapterRef>();
    const visited = new Set<string>();
    let pageUrl: string | null = work.canonicalUrl;
    let lastPage = work;
    while (pageUrl) {
      if (signal.aborted) throw new ReaderError('cancelled');
      if (visited.has(pageUrl) || visited.size >= MAX_BATCH_CHAPTERS)
        throw new ReaderError('source_parse');
      visited.add(pageUrl);
      const page = await dependencies.source.getWorkPage(pageUrl, signal);
      if (page.workId !== work.workId || page.pageUrl !== pageUrl)
        throw new ReaderError('source_parse');
      await dependencies.library.saveWorkPage(page);
      for (const chapter of page.chapters) {
        if (chapters.has(chapter.chapterId)) throw new ReaderError('source_parse');
        chapters.set(chapter.chapterId, chapter);
      }
      if (chapters.size > MAX_BATCH_CHAPTERS) throw new ReaderError('source_parse');
      pageUrl = page.nextPageUrl;
      lastPage = page;
    }
    const ordered = [...chapters.values()].sort((left, right) => left.ordinal - right.ordinal);
    if (!ordered.length || ordered.some((chapter, index) => chapter.ordinal !== index + 1))
      throw new ReaderError('source_parse');
    const completeWork = {
      ...lastPage,
      chapters: ordered,
      pageUrl: work.canonicalUrl,
      nextPageUrl: null,
      complete: true,
    };
    await dependencies.library.saveWorkPage(completeWork);
    return completeWork;
  }
  async function prepare(
    work: WorkPage,
    selection: SelectedModel,
    range: ChapterRange | null,
    retranslate: boolean,
  ): Promise<void> {
    if (
      state.active ||
      disposed ||
      dependencies.flow.active ||
      dependencies.flow.getSnapshot().pendingSave ||
      !foreground
    )
      return;
    if (
      range &&
      (!Number.isSafeInteger(range.first) ||
        !Number.isSafeInteger(range.last) ||
        range.first < 1 ||
        range.last < range.first)
    ) {
      publish({ error: '시작·끝 회차를 올바르게 입력해 주세요.', errorWorkId: work.workId });
      return;
    }
    const control = new AbortController();
    preparation = control;
    const preparingWorkId = work.workId;
    cancelled = false;
    const frozenSelection = structuredClone(selection);
    publish({
      active: true,
      preparing: true,
      preparingWorkId,
      error: null,
      errorWorkId: undefined,
    });
    try {
      const completeWork = await collectWork(work, control.signal);
      const guidance = (await dependencies.guidance?.read(work.workId)) ?? null;
      const first = range?.first ?? 1;
      const last = range?.last ?? completeWork.chapters.length;
      if (last > completeWork.chapters.length) throw new ReaderError('source_parse');
      const chapters = completeWork.chapters.filter(
        (chapter) => chapter.ordinal >= first && chapter.ordinal <= last,
      );
      if (chapters.length !== last - first + 1) throw new ReaderError('source_parse');
      let alreadySaved = 0;
      if (!retranslate) {
        for (const chapter of chapters) {
          const versions = await dependencies.library.listVersions(chapter.chapterId);
          const matching = await filterAsync(versions, (version) =>
            matchesSelection(version, frozenSelection, guidance),
          );
          if (matching.length) alreadySaved++;
        }
      }
      if (cancelled || control.signal.aborted || !foreground || disposed)
        throw new ReaderError('cancelled');
      await persist({
        schemaVersion: 1,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        work: completeWork,
        selection: frozenSelection,
        ...(guidanceHash(guidance) ? { guidance: structuredClone(guidance!) } : {}),
        chapters,
        retranslate,
        alreadySaved,
        cursor: 0,
        completed: 0,
        skipped: 0,
        phase: 'prepared',
        ...(dependencies.guidance
          ? { scan: { status: 'pending', candidates: [] } as RangeScan }
          : {}),
      });
      scannedSources.clear();
      scannedChapters.clear();
    } catch {
      publish({
        error: cancelled
          ? '번역 대상 확인을 멈췄어요.'
          : '전체 목차와 고른 범위를 확인하지 못했어요. 빠진 회차나 범위를 확인해 주세요. 한 번에 최대 10,000화까지 번역할 수 있어요.',
        errorWorkId: preparingWorkId,
      });
    } finally {
      preparation = null;
      publish({ active: false, preparing: false, preparingWorkId: undefined });
    }
  }
  function canReview(): boolean {
    return (
      !!state.record &&
      state.record.phase === 'prepared' &&
      !state.active &&
      !disposed &&
      foreground &&
      !dependencies.flow.active &&
      !dependencies.flow.getSnapshot().pendingSave
    );
  }
  async function scan(): Promise<void> {
    const record = state.record;
    if (!record || !canReview() || record.scan?.status !== 'pending') return;
    const control = new AbortController();
    preparation = control;
    cancelled = false;
    publish({
      active: true,
      error: null,
      scanProgress: { completed: 0, total: record.chapters.length },
    });
    scannedSources.clear();
    scannedChapters.clear();
    try {
      const guidance = (await dependencies.guidance?.read(record.work.workId)) ?? null;
      const candidateScan = createNameCandidateScan(
        guidance?.terms ?? [],
        referencePreset(record.selection),
      );
      let completed = 0;
      for (const chapter of record.chapters) {
        const source = await dependencies.source.getChapter(chapter, control.signal);
        if (
          source.workId !== record.work.workId ||
          source.chapterId !== chapter.chapterId ||
          source.canonicalUrl !== chapter.canonicalUrl
        )
          throw new ReaderError('source_parse');
        if (cancelled || control.signal.aborted || !foreground || disposed)
          throw new ReaderError('cancelled');
        candidateScan.add(source);
        if (scannedSources.size < SCANNED_SOURCE_CACHE_SIZE)
          scannedSources.set(chapter.chapterId, source);
        scannedChapters.set(chapter.chapterId, {
          chapterId: chapter.chapterId,
          paragraphs: source.paragraphs.map(({ text, ruby }) => ({ text, ruby })),
        });
        publish({ scanProgress: { completed: ++completed, total: record.chapters.length } });
      }
      const candidates = candidateScan.result();
      await persist({ ...record, scan: { status: 'review', candidates } });
    } catch {
      scannedSources.clear();
      scannedChapters.clear();
      publish({
        error: cancelled
          ? '후보 스캔을 멈췄어요. 범위 전체를 다시 스캔해 주세요.'
          : '범위 전체의 원문을 확인하지 못했어요. 일부 후보만 확정하지 않고 스캔을 다시 시도할 수 있어요.',
      });
    } finally {
      preparation = null;
      publish({ active: false, scanProgress: undefined });
    }
  }
  async function scanChapters(
    signal: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ScanChapter[]> {
    const record = state.record;
    if (!record || record.phase !== 'prepared' || record.scan?.status !== 'review')
      throw new ReaderError('source_parse');
    const chapters: ScanChapter[] = [];
    for (const chapter of record.chapters) {
      if (signal.aborted) throw new ReaderError('cancelled');
      let scanned = scannedChapters.get(chapter.chapterId);
      if (!scanned) {
        const source = await dependencies.source.getChapter(chapter, signal);
        if (signal.aborted) throw new ReaderError('cancelled');
        if (
          source.workId !== record.work.workId ||
          source.chapterId !== chapter.chapterId ||
          source.canonicalUrl !== chapter.canonicalUrl
        )
          throw new ReaderError('source_parse');
        scanned = {
          chapterId: chapter.chapterId,
          paragraphs: source.paragraphs.map(({ text, ruby }) => ({ text, ruby })),
        };
        scannedChapters.set(chapter.chapterId, scanned);
      }
      chapters.push(scanned);
      onProgress?.(chapters.length, record.chapters.length);
    }
    return chapters;
  }
  async function confirmCandidates(choices: readonly CandidateChoice[]): Promise<void> {
    const record = state.record;
    if (!record || !canReview() || record.scan?.status !== 'review' || !dependencies.guidance)
      return;
    const frozenChoices = structuredClone(choices);
    cancelled = false;
    publish({ active: true, error: null });
    try {
      const keys = frozenChoices.map((choice) => choice.source.normalize('NFKC'));
      check(new Set(keys).size === keys.length);
      check(
        frozenChoices.every(
          (choice) =>
            record.scan!.candidates.some((candidate) => candidate.source === choice.source) &&
            !!choice.target.trim(),
        ),
      );
      const current = await dependencies.guidance.read(record.work.workId);
      if (cancelled || !foreground || disposed) throw new ReaderError('cancelled');
      const terms = [...(current?.terms ?? [])];
      for (const choice of frozenChoices) {
        const key = choice.source.normalize('NFKC');
        const existing = terms.find((term) =>
          [term.source, ...term.aliases].some((name) => name.normalize('NFKC') === key),
        );
        // 스캔 중 별도로 확정한 수동 항목은 덮어쓰지 않는다.
        // 사람이 확정한 후보는 기계가 만든 항목(auto·model·scan)을 덮어쓴다.
        if (existing && !isMachineTerm(existing)) continue;
        const confirmed = {
          source: choice.source,
          target: choice.target.trim(),
          aliases: [],
          category: '고유명사',
          note: '',
        };
        if (existing)
          terms[terms.indexOf(existing)] = {
            source: existing.source,
            target: confirmed.target,
            aliases: existing.aliases,
            category: existing.category,
            note: existing.note,
          };
        else terms.push(confirmed);
      }
      const guidance = frozenChoices.length
        ? await dependencies.guidance.save(record.work.workId, {
            terms,
            voices: current?.voices ?? [],
            ...(current?.plotSummary !== undefined ? { plotSummary: current.plotSummary } : {}),
          })
        : current;
      let alreadySaved = 0;
      if (!record.retranslate)
        for (const chapter of record.chapters) {
          const versions = await dependencies.library.listVersions(chapter.chapterId);
          if (
            (
              await filterAsync(versions, (version) =>
                matchesSelection(version, record.selection, guidance),
              )
            ).length
          )
            alreadySaved++;
        }
      const next = {
        ...record,
        guidance: guidanceHash(guidance) ? structuredClone(guidance!) : undefined,
        alreadySaved,
        scan: { ...record.scan, status: 'confirmed' as const },
      };
      await persist(next);
      // 확정 뒤에는 정밀스캔 채우기를 쓰지 않으므로 기억한 원문을 놓는다.
      scannedChapters.clear();
    } catch {
      publish({
        error:
          '후보를 확정하지 못했어요. 한국어 표기(80자 이내)와 저장 상태를 확인한 뒤 다시 시도해 주세요.',
      });
    } finally {
      publish({ active: false });
    }
  }
  async function advance(record: BatchRecord, skipped: boolean): Promise<BatchRecord> {
    const cursor = record.cursor + 1;
    const next: BatchRecord = {
      ...record,
      cursor,
      completed: record.completed + (skipped ? 0 : 1),
      skipped: record.skipped + (skipped ? 1 : 0),
      phase: cursor === record.chapters.length ? 'complete' : 'running',
      currentVersionIds: undefined,
    };
    await persist(next);
    return next;
  }
  async function run(retryUncertain: boolean = false): Promise<void> {
    let record = state.record;
    if (
      !record ||
      state.active ||
      disposed ||
      !foreground ||
      dependencies.flow.active ||
      dependencies.flow.getSnapshot().pendingSave ||
      !['prepared', 'paused', 'unknown'].includes(record.phase)
    )
      return;
    if (record.phase === 'unknown' && !retryUncertain) return;
    if (record.scan && record.scan.status !== 'confirmed') {
      publish({ error: '범위의 후보를 스캔하고 표기를 확정한 뒤 번역을 시작해 주세요.' });
      return;
    }
    cancelled = false;
    publish({ active: true, error: null });
    try {
      const currentGuidance = (await dependencies.guidance?.read(record.work.workId)) ?? null;
      if (guidanceHash(currentGuidance) !== guidanceHash(record.guidance)) {
        publish({ error: '작품 용어집이나 말투가 바뀌었어요. 번역 범위를 다시 확인해 주세요.' });
        return;
      }
      while (record.cursor < record.chapters.length && !cancelled && foreground && !disposed) {
        const chapter = record.chapters[record.cursor]!;
        const versions = await dependencies.library.listVersions(chapter.chapterId);
        const selection = record.selection;
        const sameModel = await filterAsync(versions, (version) =>
          matchesSelection(version, selection, record!.guidance),
        );
        const beforeRequest = record.currentVersionIds;
        const completedDuringBatch =
          beforeRequest !== undefined &&
          sameModel.some((version) => !beforeRequest.includes(version.versionId));
        if (completedDuringBatch || (!record.retranslate && sameModel.length > 0)) {
          scannedSources.delete(chapter.chapterId);
          record = await advance(record, !completedDuringBatch);
          retryUncertain = false;
          continue;
        }
        if (
          dependencies.flow
            .getUnfinished()
            .some((token) => token.chapterId === chapter.chapterId) &&
          !retryUncertain
        ) {
          await persist({ ...record, phase: 'unknown' });
          break;
        }
        if (cancelled || !foreground || disposed) break;
        // 회차 흐름 진입 전에 기록해, 비정상 종료가 재전송 승인으로 이어지지 않게 한다.
        record = {
          ...record,
          phase: 'running',
          currentVersionIds: sameModel.map((version) => version.versionId),
        };
        await persist(record);
        if (cancelled || !foreground || disposed) break;
        await dependencies.flow.start(
          chapter,
          record.selection,
          record.guidance ?? null,
          scannedSources.get(chapter.chapterId),
        );
        const result = dependencies.flow.getCompleted();
        if (result && result.source.chapterId === chapter.chapterId) {
          scannedSources.delete(chapter.chapterId);
          record = await advance(record, false);
          retryUncertain = false;
          continue;
        }
        const chapterState = dependencies.flow.getSnapshot();
        let phase: BatchPhase = 'paused';
        if (chapterState.pendingSave) phase = 'saving';
        else if (chapterState.phase === 'unknown') phase = 'unknown';
        await persist({ ...record, phase });
        if (chapterState.phase === 'failed' && !chapterState.pendingSave) {
          let error = '현재 회차를 번역하지 못해서 다음 회차는 요청하지 않았어요.';
          if (chapterState.error?.code === 'output_limit')
            error =
              '현재 회차의 번역이 길이 제한으로 잘렸어요. 완료본으로 저장하지 않았고 다음 회차도 요청하지 않았어요.';
          else if (chapterState.error?.code === 'guidance_unsupported')
            error =
              '용어집·말투는 로컬 모델의 구간 번역에서만 쓸 수 있어요. 로컬 모델을 고르거나 이 작품의 항목을 비우고 저장해 주세요.';
          else if (chapterState.error?.code === 'input_limit')
            error =
              '현재 회차가 선택한 모델의 입력 한도를 넘었어요. 용어집·말투가 길면 항목을 줄이고 번역 범위를 다시 확인해 주세요. 연결 설정에서 모델 목록도 확인할 수 있어요.';
          else if (['source_access', 'source_parse'].includes(chapterState.error?.code ?? ''))
            error = '현재 회차의 원문을 읽지 못했어요. 원문을 확인한 뒤 다시 시작해 주세요.';
          publish({ error });
        }
        break;
      }
      if (
        (cancelled || !foreground) &&
        record.cursor < record.chapters.length &&
        state.record?.phase === 'running'
      )
        await persist({ ...record, phase: 'paused' });
    } catch {
      publish({
        record: state.record ? { ...state.record, phase: 'unknown' } : null,
        error: '일괄 번역 상태를 저장하지 못했어요. 저장본을 확인한 뒤 다시 시도해 주세요.',
      });
    } finally {
      publish({ active: false, chapterProgress: undefined });
    }
  }
  async function retrySave(): Promise<void> {
    const record = state.record;
    if (
      !record ||
      record.phase !== 'saving' ||
      state.active ||
      disposed ||
      !foreground ||
      dependencies.flow.active
    )
      return;
    publish({ active: true, error: null });
    try {
      await dependencies.flow.retrySave();
      const result = dependencies.flow.getCompleted();
      if (result?.source.chapterId === record.chapters[record.cursor]?.chapterId) {
        const next = await advance(record, false);
        if (next.phase !== 'complete') await persist({ ...next, phase: 'paused' });
      }
    } catch {
      publish({ error: '완료한 번역을 저장하지 못했어요. 새 번역 요청은 보내지 않았어요.' });
    } finally {
      publish({ active: false });
    }
  }
  function cancel(): void {
    cancelled = true;
    preparation?.abort();
    if (state.active && !state.preparing) dependencies.flow.cancel();
  }
  function clearWork(workId: string): boolean {
    const activeOwner = state.preparing
      ? state.preparingWorkId
      : state.active
        ? state.record?.work.workId
        : undefined;
    if (activeOwner === workId) return false;
    if (state.record?.work.workId === workId) {
      const clearError = state.errorWorkId === undefined || state.errorWorkId === workId;
      publish({
        record: null,
        ...(clearError ? { error: null, errorWorkId: undefined } : {}),
        chapterProgress: undefined,
        scanProgress: undefined,
      });
    } else if (state.errorWorkId === workId) {
      publish({ error: null, errorWorkId: undefined });
    }
    for (const [chapterId, source] of scannedSources)
      if (source.workId === workId) scannedSources.delete(chapterId);
    for (const chapterId of [...scannedChapters.keys()])
      if (chapterId.startsWith(`${workId}/`)) scannedChapters.delete(chapterId);
    return true;
  }
  const unsubscribe = dependencies.flow.subscribe((chapterState) => {
    if (state.active && !state.preparing) publish({ chapterProgress: chapterState.progress });
  });
  return {
    initialize,
    prepare,
    scan,
    scanChapters,
    confirmCandidates,
    run,
    cancel,
    clearWork,
    retrySave,
    getSnapshot: (): BatchState => state,
    get active(): boolean {
      return state.active;
    },
    setForeground(active: boolean): void {
      foreground = active;
      if (!active) cancel();
    },
    subscribe(listener: (state: BatchState) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      cancel();
      unsubscribe();
      listeners.clear();
      scannedSources.clear();
      scannedChapters.clear();
    },
  };
}
