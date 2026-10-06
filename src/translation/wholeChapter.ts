import { ReaderError } from '../contracts';
import type {
  ChapterRef,
  CompletedTranslation,
  LibraryStore,
  ProviderSession,
  RenewalSource,
  SelectedModel,
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
  guidanceHash,
  type GuidanceRepository,
  type WorkGuidance,
} from './guidance';
import { normalizeChapterInput } from '../providers/plainText';
export interface FlowDependencies {
  source: RenewalSource;
  createProvider(selection: SelectedModel): ProviderSession;
  store: LibraryStore;
  attempts: AttemptRepository;
  clock: { now(): number };
  guidance?: GuidanceRepository;
}
export type PhaseDurations = { sourceMs: number; modelMs: number; validationStorageMs: number };
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
  ): Promise<void> {
    if (!foreground || disposed || slot.occupied || state.pendingSave) return;
    const chapter = structuredClone(ref),
      selected = structuredClone(selection),
      frozenGuidance = approved === undefined ? undefined : structuredClone(approved);
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
      state = { phase: 'preparing', token, elapsedMs: 0 };
      publish({});
      const timer = setInterval(() => publish({}), 250);
      try {
        const source = await deps.source.getChapter(chapter, control.signal);
        timings.sourceMs = deps.clock.now() - started;
        if (control.signal.aborted || !foreground || disposed) throw new ReaderError('cancelled');
        const guidance =
          frozenGuidance === undefined
            ? ((await deps.guidance?.read(chapter.workId)) ?? null)
            : frozenGuidance;
        const referenceContext = guidanceContext(
          guidance,
          chapter.workId,
          normalizeChapterInput(source),
        );
        if (
          referenceContext &&
          (selected.connection.provider !== 'openai-compatible' || !selected.limits)
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
            source,
            languageDirection: 'ja-ko',
            contractVersion: 'plain-v1',
            promptVersion:
              selected.connection.provider === 'openai-compatible' && selected.limits
                ? 'hymt2-segments-v1'
                : 'hymt2-ko-v1',
            onProgress: (completed, total) => publish({ progress: { completed, total } }),
            ...(referenceContext ? { referenceContext } : {}),
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
        const text = result.text.replace(/\r\n/g, '\n');
        if (!text.trim()) throw new ReaderError('invalid_output', 'received');
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
        const versionId = crypto.randomUUID();
        const value: CompletedTranslation = {
          schemaVersion: 2,
          versionId,
          source,
          text,
          blocks: await Promise.all(
            text
              .split('\n\n')
              .map(async (text, index) => ({ id: await digest([versionId, index]), text })),
          ),
          createdAt: new Date().toISOString(),
          provenance: {
            provider: selected.connection.provider,
            connectionId: await digest([selected.connection.provider, normalizedBaseUrl]),
            modelId: selected.modelId,
            contractVersion: 'plain-v1',
            promptVersion: result.generation ? 'hymt2-segments-v1' : 'hymt2-ko-v1',
            languageDirection: 'ja-ko',
            ...(result.generation ? { generation: result.generation } : {}),
            ...(guidanceHash(guidance) ? { guidanceHash: guidanceHash(guidance) } : {}),
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
