import { ReaderError } from '../contracts';
import type {
  ChapterRef,
  LibraryStore,
  RenewalSource,
  SelectedModel,
  TranslationState,
  WorkPage,
} from '../contracts/reading';
import { Journal, serial, type PrivateFiles } from '../storage/journal';
import { check, integer, object, text } from '../storage/validation';
import { StorageError } from '../storage/errors';
import { identifier, selected, workPage } from '../storage/readingValidation';
import type { WholeChapterFlow } from './wholeChapter';
import {
  guidanceHash,
  validateGuidance,
  type GuidanceRepository,
  type WorkGuidance,
} from './guidance';

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
};
export type BatchState = {
  record: BatchRecord | null;
  active: boolean;
  preparing: boolean;
  error: string | null;
  chapterProgress?: TranslationState['progress'];
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
  cancel(): void;
  retrySave(): Promise<void>;
  getSnapshot(): BatchState;
  readonly active: boolean;
  setForeground(active: boolean): void;
  subscribe(listener: (state: BatchState) => void): () => void;
  dispose(): void;
}
const MAX_BATCH_CHAPTERS = 10000;
async function validateBatch(value: unknown): Promise<BatchRecord> {
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
  const listeners = new Set<(state: BatchState) => void>();
  function publish(update: Partial<BatchState>): void {
    state = { ...state, ...update };
    if (!disposed) listeners.forEach((listener) => listener(state));
  }
  async function persist(record: BatchRecord): Promise<void> {
    await dependencies.repository.write(record);
    publish({ record, error: null });
  }
  function matchesSelection(
    version: Awaited<ReturnType<LibraryStore['listVersions']>>[number],
    selection: SelectedModel,
    guidance?: WorkGuidance | null,
  ): boolean {
    return (
      version.provenance.provider === selection.connection.provider &&
      version.provenance.modelId === selection.modelId &&
      version.provenance.guidanceHash === guidanceHash(guidance)
    );
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
      publish({ error: '시작·끝 회차를 올바르게 입력하세요.' });
      return;
    }
    const control = new AbortController();
    preparation = control;
    cancelled = false;
    const frozenSelection = structuredClone(selection);
    publish({ active: true, preparing: true, error: null });
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
          if (versions.some((version) => matchesSelection(version, frozenSelection, guidance)))
            alreadySaved++;
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
      });
    } catch {
      publish({
        error: cancelled
          ? '번역 대상 확인을 중단했습니다.'
          : '전체 목차와 지정 범위를 확인하지 못했습니다. 누락 회차나 범위를 확인하세요. 한 작업에는 최대 10,000화를 담을 수 있습니다.',
      });
    } finally {
      preparation = null;
      publish({ active: false, preparing: false });
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
    cancelled = false;
    publish({ active: true, error: null });
    try {
      const currentGuidance = (await dependencies.guidance?.read(record.work.workId)) ?? null;
      if (guidanceHash(currentGuidance) !== guidanceHash(record.guidance)) {
        publish({ error: '작품의 용어집·말투가 바뀌었습니다. 번역 범위를 다시 확인하세요.' });
        return;
      }
      while (record.cursor < record.chapters.length && !cancelled && foreground && !disposed) {
        const chapter = record.chapters[record.cursor]!;
        const versions = await dependencies.library.listVersions(chapter.chapterId);
        const selection = record.selection;
        const sameModel = versions.filter((version) =>
          matchesSelection(version, selection, record!.guidance),
        );
        const beforeRequest = record.currentVersionIds;
        const completedDuringBatch =
          beforeRequest !== undefined &&
          sameModel.some((version) => !beforeRequest.includes(version.versionId));
        if (completedDuringBatch || (!record.retranslate && sameModel.length > 0)) {
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
        await dependencies.flow.start(chapter, record.selection, record.guidance ?? null);
        const result = dependencies.flow.getCompleted();
        if (result && result.source.chapterId === chapter.chapterId) {
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
          let error = '현재 회차를 번역하지 못했습니다. 이후 회차는 요청하지 않았습니다.';
          if (chapterState.error?.code === 'output_limit')
            error =
              '현재 회차의 출력이 길이 제한으로 잘렸습니다. 완료본으로 저장하거나 이후 회차를 요청하지 않았습니다.';
          else if (chapterState.error?.code === 'guidance_unsupported')
            error =
              '용어집·말투 적용은 로컬 모델의 구간 번역에서 사용할 수 있습니다. 로컬 모델을 선택하거나 이 작품의 항목을 비운 뒤 저장하세요.';
          else if (chapterState.error?.code === 'input_limit')
            error =
              '현재 회차가 선택한 모델의 입력 한도를 넘었습니다. 용어집·말투가 길면 항목을 줄이고 번역 범위를 다시 확인하세요. 연결 설정에서 모델 목록도 확인할 수 있습니다.';
          else if (['source_access', 'source_parse'].includes(chapterState.error?.code ?? ''))
            error = '현재 회차의 원문을 읽지 못했습니다. 원문을 확인한 뒤 재개하세요.';
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
        error: '일괄 번역 상태를 저장하지 못했습니다. 저장본을 확인한 뒤 다시 시도하세요.',
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
      publish({ error: '완료한 번역을 저장하지 못했습니다. 새 생성 요청은 보내지 않았습니다.' });
    } finally {
      publish({ active: false });
    }
  }
  function cancel(): void {
    cancelled = true;
    preparation?.abort();
    if (state.active && !state.preparing) dependencies.flow.cancel();
  }
  const unsubscribe = dependencies.flow.subscribe((chapterState) => {
    if (state.active && !state.preparing) publish({ chapterProgress: chapterState.progress });
  });
  return {
    initialize,
    prepare,
    run,
    cancel,
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
    },
  };
}
