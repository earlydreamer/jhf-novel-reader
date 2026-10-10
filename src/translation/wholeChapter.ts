import { ReaderError } from '../contracts';
import type {
  ChapterRef,
  CompletedTranslation,
  LibraryStore,
  ProviderSession,
  RenewalSource,
  SelectedModel,
  SourceSnapshot,
  TranslationState,
  TranslationToken,
} from '../contracts/reading';
import { digest } from '../storage/journal';
import { normalizeOpenAICompatibleBaseUrl } from '../providers/endpoint';
import { normalizeGeminiBaseUrl } from '../providers/gemini';
import type { AttemptRepository } from './attempts';
import { createSingleFlight } from './singleFlight';
import {
  guidanceContext,
  appliedGuidance,
  plotSummaryWithoutNames,
  streamingGuidanceContext,
  appliedGuidanceHash,
  type GuidanceRepository,
  type WorkGuidance,
} from './guidance';
import { normalizeChapterInput } from '../providers/plainText';
import { contextHints, referencePreset } from './preset';
import { checkTranslationQuality } from './quality';
export interface FlowDependencies {
  source: RenewalSource;
  createProvider(selection: SelectedModel): ProviderSession;
  store: LibraryStore;
  attempts: AttemptRepository;
  clock: { now(): number };
  guidance?: GuidanceRepository;
  /** 번역 직전 자동 용어집(#192). 없으면 건너뛴다. */
  autoGlossary?: (input: {
    workId: string;
    source: SourceSnapshot;
    selection: SelectedModel;
    signal: AbortSignal;
  }) => Promise<'skipped' | 'added'>;
}
export type PhaseDurations = { sourceMs: number; modelMs: number; validationStorageMs: number };
export type ParagraphRepair = { base: CompletedTranslation; indexes: readonly number[] };
export function createWholeChapterFlow(deps: FlowDependencies) {
  const slot = createSingleFlight(),
    listeners = new Set<(state: TranslationState) => void>();
  let state: TranslationState = { phase: 'idle', elapsedMs: 0 };
  let abort: AbortController | null = null,
    foreground = false,
    disposed = false;
  let started = 0,
    dispatched = false,
    completed: CompletedTranslation | null = null;
  let timings: PhaseDurations = { sourceMs: 0, modelMs: 0, validationStorageMs: 0 };
  let unfinished: readonly TranslationToken[] = [];
  function publish(update: Partial<TranslationState>) {
    state = { ...state, ...update, elapsedMs: Math.max(0, deps.clock.now() - started) };
    if (!disposed) listeners.forEach((listener) => listener(state));
  }
  async function initialize() {
    unfinished = await deps.attempts.readUnfinished();
    for (const token of unfinished) await deps.attempts.write({ token, phase: 'unknown' });
  }
  async function save(value: CompletedTranslation, token: TranslationToken) {
    publish({ phase: 'saving', pendingSave: value, error: undefined });
    try {
      await deps.store.commitVersion(value);
      await deps.attempts.write({ token, phase: 'complete' });
      unfinished = unfinished.filter((entry) => entry.requestId !== token.requestId);
      completed = value;
      publish({ phase: 'ready', pendingSave: undefined });
    } catch {
      publish({ phase: 'failed', error: new ReaderError('storage'), pendingSave: value });
    }
  }
  async function start(
    ref: ChapterRef,
    selection: SelectedModel,
    approved?: WorkGuidance | null,
    scannedSource?: SourceSnapshot,
    repair?: ParagraphRepair,
    options: { autoGlossary?: boolean } = {},
  ): Promise<void> {
    if (!foreground || disposed || slot.occupied || state.pendingSave) return;
    const chapter = structuredClone(ref),
      selected = structuredClone(selection),
      frozenGuidance = approved === undefined ? undefined : structuredClone(approved);
    const frozenRepair = repair ? structuredClone(repair) : undefined;
    await slot.run(async () => {
      const token: TranslationToken = {
        requestId: crypto.randomUUID(),
        chapterId: chapter.chapterId,
        settingsRevision: selected.connection.revision,
      };
      const control = new AbortController();
      abort = control;
      dispatched = false;
      completed = null;
      started = deps.clock.now();
      timings = { sourceMs: 0, modelMs: 0, validationStorageMs: 0 };
      state = {
        phase: 'preparing',
        token,
        elapsedMs: 0,
        ...(frozenRepair ? { preview: frozenRepair.base.text } : {}),
      };
      publish({});
      const timer = setInterval(() => publish({}), 250);
      try {
        const source = scannedSource
          ? structuredClone(scannedSource)
          : await deps.source.getChapter(chapter, control.signal);
        if (
          source.chapterId !== chapter.chapterId ||
          source.workId !== chapter.workId ||
          source.canonicalUrl !== chapter.canonicalUrl
        )
          throw new ReaderError('source_parse');
        const repairIndexes = new Set(frozenRepair?.indexes);
        if (
          frozenRepair &&
          (frozenRepair.base.source.chapterId !== source.chapterId ||
            frozenRepair.base.source.sourceHash !== source.sourceHash ||
            frozenRepair.base.blocks.length !== source.paragraphs.length ||
            selected.translationMode !== 'stream' ||
            selected.connection.provider !== 'openai-compatible' ||
            !repairIndexes.size ||
            [...repairIndexes].some(
              (index) =>
                !Number.isSafeInteger(index) ||
                index < 0 ||
                index >= source.paragraphs.length ||
                !source.paragraphs[index]!.text.trim(),
            ))
        )
          throw new ReaderError('invalid_output', 'not_sent');
        const requestSource = frozenRepair
          ? {
              ...source,
              paragraphs: source.paragraphs.map((paragraph, index) =>
                repairIndexes.has(index) ? paragraph : { ...paragraph, text: '', ruby: [] },
              ),
            }
          : source;
        const mergePreview = (preview: string) =>
          frozenRepair
            ? (() => {
                const rows = preview.split('\n\n');
                return frozenRepair.base.blocks
                  .map((block, index) =>
                    repairIndexes.has(index) && rows[index]?.trim() ? rows[index]! : block.text,
                  )
                  .join('\n\n');
              })()
            : preview;
        if (frozenRepair) publish({ preview: frozenRepair.base.text });
        timings.sourceMs = deps.clock.now() - started;
        if (control.signal.aborted || !foreground || disposed) throw new ReaderError('cancelled');
        // 번역 직전 자동 용어집(#192): 원문을 한 번만 받고 같은 취소 신호를 쓴다. 실패해도 번역은 막지 않는다.
        if (
          options.autoGlossary &&
          deps.autoGlossary &&
          !frozenRepair &&
          frozenGuidance === undefined &&
          selected.connection.provider === 'openai-compatible'
        ) {
          publish({ glossary: 'running' });
          const child = new AbortController();
          const abortChild = () => child.abort();
          control.signal.addEventListener('abort', abortChild, { once: true });
          const timeout = setTimeout(abortChild, 30_000);
          try {
            await deps.autoGlossary({
              workId: chapter.workId,
              source,
              selection: selected,
              signal: child.signal,
            });
            publish({ glossary: undefined });
          } catch {
            if (control.signal.aborted) throw new ReaderError('cancelled');
            publish({ glossary: 'failed' });
          } finally {
            clearTimeout(timeout);
            control.signal.removeEventListener('abort', abortChild);
          }
        }
        const guidance =
          frozenGuidance === undefined
            ? ((await deps.guidance?.read(chapter.workId)) ?? null)
            : frozenGuidance;
        const preset = referencePreset(selected);
        const segmented = selected.connection.provider === 'openai-compatible' && !!selected.limits;
        const streaming =
          selected.connection.provider === 'openai-compatible' &&
          selected.translationMode === 'stream';
        // 문형 힌트는 구간 번역에서만, 그 구간에 해당 문형이 있을 때만 참고 데이터 앞에 붙는다.
        const reference = (input: string) => {
          const hints = segmented ? contextHints(input) : '';
          const terms = streaming
            ? streamingGuidanceContext(guidance, chapter.workId, input, preset)
            : guidanceContext(guidance, chapter.workId, input, preset);
          return hints ? hints + (terms || '\n') : terms;
        };
        const chapterReference = reference(normalizeChapterInput(requestSource));
        if (
          chapterReference &&
          (selected.connection.provider !== 'openai-compatible' || (!selected.limits && !streaming))
        )
          throw new ReaderError('guidance_unsupported');
        const provider = deps.createProvider(selected);
        await deps.attempts.write({ token, phase: 'dispatching' });
        if (control.signal.aborted || !foreground || disposed) {
          await deps.attempts.write({ token, phase: 'complete' });
          throw new ReaderError('cancelled');
        }
        dispatched = true;
        publish({ phase: 'translating' });
        const modelStarted = deps.clock.now();
        const result = await provider.translateChapter(
          {
            token,
            source: requestSource,
            languageDirection: 'ja-ko',
            contractVersion: 'plain-v1',
            promptVersion: streaming ? 'colomo-local-v1' : segmented ? 'lines-v1' : 'hymt2-ko-v1',
            onProgress: (completed, total) => publish({ progress: { completed, total } }),
            onPreview: (preview) => publish({ preview: mergePreview(preview) }),
            ...(chapterReference ? { reference } : {}),
            ...(streaming
              ? {
                  requiredTerms: (input: string) =>
                    (appliedGuidance(guidance, chapter.workId, input, [])?.terms ?? []).flatMap(
                      ({ term, names }) => names.map((source) => ({ source, target: term.target })),
                    ),
                  plotSummary: plotSummaryWithoutNames(guidance),
                }
              : {}),
          },
          control.signal,
        );
        timings.modelMs = deps.clock.now() - modelStarted;
        if (control.signal.aborted || disposed) throw new ReaderError('cancelled', 'unknown');
        publish({ phase: 'validating' });
        const processingStarted = deps.clock.now();
        if (result.finishReason !== 'complete')
          throw new ReaderError(
            result.finishReason === 'length'
              ? 'output_limit'
              : result.finishReason === 'blocked'
                ? 'blocked'
                : 'invalid_output',
            'received',
          );
        let text = result.text.replace(/\r\n/g, '\n');
        if (!text.trim()) throw new ReaderError('invalid_output', 'received');
        let failures = result.failedParagraphs ?? [];
        if (frozenRepair) {
          const repairedRows = text.split('\n\n');
          if (repairedRows.length !== source.paragraphs.length)
            throw new ReaderError('invalid_output', 'received');
          const failed = new Set(failures);
          text = frozenRepair.base.blocks
            .map((block, index) =>
              repairIndexes.has(index) && !failed.has(index) ? repairedRows[index]! : block.text,
            )
            .join('\n\n');
          failures = [
            ...new Set([
              ...(frozenRepair.base.failedParagraphs ?? []).filter(
                (index) => !repairIndexes.has(index),
              ),
              ...failures,
            ]),
          ].sort((a, b) => a - b);
          publish({ preview: text });
        }
        let normalizedBaseUrl: string;
        switch (selected.connection.provider) {
          case 'openai-compatible':
            normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(selected.connection.baseUrl);
            break;
          case 'gemini':
            normalizedBaseUrl = normalizeGeminiBaseUrl(selected.connection.baseUrl);
            break;
          default:
            throw new ReaderError('connection');
        }
        const appliedHash = await appliedGuidanceHash(
          guidance,
          chapter.workId,
          normalizeChapterInput(requestSource),
          preset,
        );
        const versionId = crypto.randomUUID();
        const blocks = await Promise.all(
          text
            .split('\n\n')
            .map(async (text, index) => ({ id: await digest([versionId, index]), text })),
        );
        const value: CompletedTranslation = {
          ...(failures.length ? { failedParagraphs: failures } : {}),
          schemaVersion: 2,
          versionId,
          source,
          text,
          blocks,
          quality: checkTranslationQuality(
            chapter.workId,
            normalizeChapterInput(source),
            blocks,
            guidance,
            preset,
          ),
          createdAt: new Date().toISOString(),
          provenance: {
            provider: selected.connection.provider,
            connectionId: await digest([selected.connection.provider, normalizedBaseUrl]),
            modelId: selected.modelId,
            contractVersion: 'plain-v1',
            promptVersion:
              result.generation?.mode === 'colomo-local-v1'
                ? 'colomo-local-v1'
                : result.generation
                  ? 'lines-v1'
                  : 'hymt2-ko-v1',
            languageDirection: 'ja-ko',
            ...(result.generation ? { generation: result.generation } : {}),
            ...(appliedHash ? { guidanceHash: appliedHash } : {}),
            ...(frozenRepair
              ? {
                  repair: {
                    baseVersionId: frozenRepair.base.versionId,
                    paragraphIndexes: [...repairIndexes].sort((a, b) => a - b),
                  },
                }
              : {}),
          },
        };
        if (control.signal.aborted || disposed) throw new ReaderError('cancelled', 'unknown');
        await save(value, token);
        timings.validationStorageMs = deps.clock.now() - processingStarted;
      } catch (error) {
        const safe =
          error instanceof ReaderError
            ? new ReaderError(error.code, error.outcome, error.status)
            : new ReaderError(
                dispatched ? 'timeout_unknown' : 'storage',
                dispatched ? 'unknown' : 'not_sent',
              );
        const unknown = dispatched && (control.signal.aborted || safe.outcome === 'unknown');
        try {
          await deps.attempts.write({ token, phase: unknown ? 'unknown' : 'complete' });
        } catch {
          publish({ phase: 'unknown', error: new ReaderError('storage', 'unknown') });
          return;
        }
        if (unknown) unfinished = [...unfinished, token];
        publish({ phase: unknown ? 'unknown' : 'failed', error: safe });
      } finally {
        clearInterval(timer);
        abort = null;
      }
    });
  }
  function cancel() {
    abort?.abort();
    if (slot.occupied && !state.pendingSave)
      publish({
        phase: dispatched ? 'unknown' : 'failed',
        error: new ReaderError('cancelled', dispatched ? 'unknown' : 'not_sent'),
      });
  }
  async function retrySave() {
    const value = state.pendingSave,
      token = state.token;
    if (!value || !token || slot.occupied || disposed || !foreground) return;
    await slot.run(() => save(value, token));
  }
  return {
    start,
    cancel,
    retrySave,
    initialize,
    subscribe(fn: (state: TranslationState) => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => state,
    getCompleted: () => completed,
    getUnfinished: () => unfinished,
    // 실행 중인 번역만 막는다. 저장 대기·결과 불명 요청은 메모리에서 정리하고, 저장소 기록은 호출자가 지운다.
    clearWork(workId: string): boolean {
      if (slot.occupied && state.token?.chapterId.startsWith(`${workId}/`)) return false;
      unfinished = unfinished.filter((token) => !token.chapterId.startsWith(`${workId}/`));
      if (completed?.source.workId === workId) completed = null;
      if (
        state.pendingSave?.source.workId === workId ||
        state.token?.chapterId.startsWith(`${workId}/`)
      ) {
        state = { phase: 'idle', elapsedMs: 0 };
        if (!disposed) listeners.forEach((listener) => listener(state));
      }
      return true;
    },
    // 결과 불명 요청은 막지도 지우지도 않는다. 회차 삭제 뒤에도 다시 번역할 때 중복 경고가 남는다.
    clearChapter(chapterId: string): boolean {
      if (slot.occupied && state.token?.chapterId === chapterId) return false;
      if (completed?.source.chapterId === chapterId) completed = null;
      if (
        state.pendingSave?.source.chapterId === chapterId ||
        state.token?.chapterId === chapterId
      ) {
        state = { phase: 'idle', elapsedMs: 0 };
        if (!disposed) listeners.forEach((listener) => listener(state));
      }
      return true;
    },
    getTimings: () => ({ ...timings }),
    get active() {
      return slot.occupied;
    },
    setForeground(active: boolean) {
      foreground = active;
      if (!active) cancel();
    },
    dispose() {
      disposed = true;
      cancel();
      listeners.clear();
    },
  };
}
export type WholeChapterFlow = ReturnType<typeof createWholeChapterFlow>;
