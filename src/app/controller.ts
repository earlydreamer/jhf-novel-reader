import {
  DEFAULT_PREFERENCES, ReaderError,
  type AppLifecycle, type ProviderConfig, type ReadPosition, type ReaderActions,
  type ReaderPreferences, type ReaderStore, type ReaderViewState, type SecretStore,
  type SettingsActions, type SettingsViewState,
} from '../contracts';
import type { PrefetchCoordinator } from '../jobs/prefetch';
import type { TranslationEngine } from '../jobs/engine';
import { normalizeOpenAICompatibleBaseUrl } from '../providers/openai-compatible';
import { normalizeGeminiBaseUrl, normalizeGeminiModel } from '../providers/gemini';
import type { SavedSettings } from '../storage/settings';

export interface SettingsRepository { read(): Promise<SavedSettings>; save(settings: SavedSettings): Promise<void> }
export interface LastChapterRepository { read(): Promise<string | null>; save(key: string): Promise<void> }
export type ApplicationError = 'startup' | 'settings' | 'configuration' | 'secret' | 'position' | 'last_chapter';
export interface ApplicationSnapshot {
  readonly initialized: boolean;
  readonly reader: ReaderViewState;
  readonly settings: SettingsViewState;
  readonly appError: ApplicationError | null;
}
export interface ControllerDependencies {
  readonly engine: TranslationEngine;
  readonly prefetch?: PrefetchCoordinator;
  readonly store: ReaderStore;
  readonly settings: SettingsRepository;
  readonly secrets: SecretStore;
  readonly pointer: LastChapterRepository;
  readonly lifecycle: AppLifecycle;
}
export const DEFAULT_CONFIG: ProviderConfig = Object.freeze({
  provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'local',
  contextBudget: 16384, outputBudget: 4096, settingsRevision: 0,
});
function normalizeConfig(input: ProviderConfig): ProviderConfig {
  if (!['openai-compatible', 'gemini'].includes(input.provider) || !input.model.trim() || input.model.trim().length > 256 ||
      !Number.isSafeInteger(input.contextBudget) || !Number.isSafeInteger(input.outputBudget) ||
      input.outputBudget < 1 || input.contextBudget <= input.outputBudget ||
      !Number.isSafeInteger(input.settingsRevision) || input.settingsRevision < 0 ||
      (input.authRef !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.authRef))) throw new ReaderError('connection');
  return {
    provider: input.provider,
    baseUrl: input.provider === 'gemini' ? normalizeGeminiBaseUrl(input.baseUrl) : normalizeOpenAICompatibleBaseUrl(input.baseUrl),
    model: input.provider === 'gemini' ? normalizeGeminiModel(input.model) : input.model.trim(),
    contextBudget: input.contextBudget, outputBudget: input.outputBudget, settingsRevision: input.settingsRevision,
    ...(input.authRef ? { authRef: input.authRef } : {}),
  };
}
function withoutAuth(config: ProviderConfig): ProviderConfig {
  const { authRef: _auth, ...safe } = config;
  return safe;
}
export function createReaderController(deps: ControllerDependencies) {
  let config = DEFAULT_CONFIG;
  let preferences: ReaderPreferences = { ...DEFAULT_PREFERENCES };
  let initialized = false, configured = false, disposed = false, foreground = false, showOriginal = false;
  let appError: ApplicationError | null = null;
  let secretStatus: SettingsViewState['secretStatus'] = 'unset';
  let endpointGeneration = 0, secretOperation = 0, settingsOperation = 0, lifecycleEvents = 0;
  let localPosition: ReadPosition | null = null;
  let engineSnapshot = deps.engine.getSnapshot();
  let snapshot: ApplicationSnapshot;
  let initializePromise: Promise<void> | null = null;
  let unsubscribeLifecycle: (() => Promise<void>) | null = null;
  let settingsQueue: Promise<void> = Promise.resolve();
  let positionQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  function publish() {
    if (disposed) return;
    snapshot = {
      initialized,
      reader: { job: engineSnapshot.job, chapter: engineSnapshot.chapter, position: localPosition,
        preferences, showOriginal },
      settings: { config, preferences, secretStatus }, appError,
    };
    listeners.forEach(listener => listener());
  }
  function fail(error: ApplicationError) { appError = error; publish(); }
  publish();
  const unsubscribeEngine = deps.engine.subscribe(() => {
    const next = deps.engine.getSnapshot();
    if (next.chapter !== engineSnapshot.chapter || next.cacheKey !== engineSnapshot.cacheKey || next.position !== engineSnapshot.position)
      localPosition = next.position;
    engineSnapshot = next;
    publish();
    // A subscriber can synchronously navigate, change settings or dispose.
    if (!disposed && deps.engine.getSnapshot() === next && next.job.phase === 'ready' && next.chapter)
      deps.prefetch?.onCurrentChapterReady(next.chapter, { ...config });
  });
  function persistSettings(): Promise<boolean> {
    const operation = ++settingsOperation;
    const saved: SavedSettings = { config: configured ? { ...config } : null, preferences: { ...preferences } };
    const task = settingsQueue.then(() => deps.settings.save(saved));
    settingsQueue = task.catch(() => {});
    return task.then(() => {
      if (operation === settingsOperation && !disposed && appError === 'settings') { appError = null; publish(); }
      return true;
    }, () => { if (operation === settingsOperation && !disposed) fail('settings'); return false; });
  }
  function changeConfig(next: ProviderConfig) {
    config = next;
    configured = true;
    deps.prefetch?.onCurrentChapterChanged();
    deps.engine.invalidate();
    engineSnapshot = deps.engine.getSnapshot();
    localPosition = engineSnapshot.position;
    showOriginal = false;
    appError = null;
    publish();
    return persistSettings();
  }
  function dispatchAllowed() { return initialized && foreground && configured && !disposed; }
  function open(url: string) {
    if (!dispatchAllowed()) { if (initialized && !configured) fail('configuration'); return; }
    showOriginal = false; appError = null;
    deps.prefetch?.onCurrentChapterChanged();
    deps.engine.startChapter(url, { ...config });
    publish();
  }
  async function initialize() {
    if (initialized || disposed) return;
    if (initializePromise) return initializePromise;
    appError = null; publish();
    initializePromise = (async () => {
      try {
        // Subscribe first. A subsequent app event always wins over a late initial query.
        const eventAtStart = lifecycleEvents;
        if (!unsubscribeLifecycle) {
          const unsubscribe = await deps.lifecycle.subscribe(active => {
            if (disposed) return;
            lifecycleEvents++;
            foreground = active;
            deps.engine.setForeground(active);
            deps.prefetch?.onForegroundChanged(active);
          });
          if (disposed) { await unsubscribe(); return; }
          unsubscribeLifecycle = unsubscribe;
        }
        const active = await deps.lifecycle.isActive();
        if (disposed) return;
        if (lifecycleEvents === eventAtStart) foreground = active;
        deps.engine.setForeground(foreground);
        deps.prefetch?.onForegroundChanged(foreground);
        let saved: SavedSettings;
        try { saved = await deps.settings.read(); } catch { fail('settings'); return; }
        if (disposed) return;
        try { config = saved.config ? normalizeConfig(saved.config) : DEFAULT_CONFIG; }
        catch { fail('configuration'); return; }
        configured = saved.config !== null;
        preferences = { ...saved.preferences };
        deps.prefetch?.setPrefetchEnabled(preferences.prefetchEnabled);
        secretStatus = config.authRef ? 'saved' : 'unset';
        let key: string | null;
        try { key = await deps.pointer.read(); } catch { fail('last_chapter'); key = null; }
        if (disposed) return;
        initialized = true;
        publish();
        if (key && configured) await deps.engine.restoreChapter(key, { ...config }).done;
      } catch { if (!disposed) { foreground = false; deps.engine.setForeground(false); deps.prefetch?.onForegroundChanged(false); fail('startup'); } }
      finally { initializePromise = null; }
    })();
    return initializePromise;
  }
  const readerActions: ReaderActions = {
    onOpen: open, onNavigate: open,
    onCancel() { if (!disposed) { deps.prefetch?.onCurrentChapterChanged(); deps.engine.cancel(); } },
    onRetry() { if (dispatchAllowed()) { appError = null; deps.prefetch?.onCurrentChapterChanged(); deps.engine.retry(); publish(); } },
    onResume() { if (dispatchAllowed()) { deps.prefetch?.onCurrentChapterChanged(); deps.engine.retry(); } },
    onShowOriginal(show) { showOriginal = show; publish(); },
    onFontSize(size) {
      if (!initialized || !Number.isSafeInteger(size) || size < 10 || size > 48 || disposed) return;
      preferences = { ...preferences, fontSize: size }; publish(); void persistSettings();
    },
    onPosition(position) {
      const chapter = engineSnapshot.chapter;
      if (disposed || !initialized || engineSnapshot.job.phase !== 'ready' || !chapter ||
          position.chapterId !== chapter.source.chapterId || !chapter.paragraphs.some(p => p.id === position.paragraphId) ||
          !Number.isFinite(position.offset) || position.offset < 0 || !Number.isSafeInteger(Math.round(position.offset))) return;
      const normalized = { chapterId: position.chapterId, paragraphId: position.paragraphId, offset: Math.round(position.offset) };
      const key = engineSnapshot.cacheKey, revision = config.settingsRevision, jobId = engineSnapshot.job.token?.jobId;
      localPosition = normalized; publish();
      positionQueue = positionQueue.then(async () => {
        if (disposed || engineSnapshot.cacheKey !== key || config.settingsRevision !== revision || engineSnapshot.job.token?.jobId !== jobId || engineSnapshot.job.phase !== 'ready') return;
        try { await deps.store.savePosition(normalized); }
        catch { if (!disposed && engineSnapshot.cacheKey === key && config.settingsRevision === revision && engineSnapshot.job.token?.jobId === jobId) fail('position'); }
      });
    },
  };
  const settingsActions: SettingsActions = {
    onConfigChange(input) {
      if (!initialized || disposed) return;
      try {
        const next = normalizeConfig({ ...input, settingsRevision: config.settingsRevision + 1 });
        const providerChanged = next.provider !== config.provider;
        const endpointChanged = next.baseUrl !== config.baseUrl || providerChanged;
        // Callers cannot inject an auth reference. Only an explicit secure-store save can attach one.
        const safe = withoutAuth(next);
        if (endpointChanged) { endpointGeneration++; secretOperation++; secretStatus = 'unset'; }
        if (providerChanged) {
          preferences = { ...preferences, prefetchEnabled: false };
          deps.prefetch?.setPrefetchEnabled(false);
        }
        void changeConfig({ ...safe, ...(!endpointChanged && config.authRef ? { authRef: config.authRef } : {}) });
      } catch { fail('configuration'); }
    },
    async onSaveSecret(secret) {
      if (!initialized || !configured || disposed) { fail('configuration'); throw new ReaderError('auth'); }
      if (!secret || /[\u0000-\u0020\u007f]/.test(secret)) { fail('secret'); throw new ReaderError('auth'); }
      const generation = endpointGeneration, operation = ++secretOperation;
      const ref = `provider.${crypto.randomUUID()}`;
      secretStatus = 'saving'; publish();
      try {
        await deps.secrets.set(ref, secret);
        if (disposed || generation !== endpointGeneration || operation !== secretOperation) {
          await deps.secrets.remove(ref); return;
        }
        const previousRef = config.authRef;
        secretStatus = 'saved';
        const persisted = await changeConfig({ ...config, authRef: ref, settingsRevision: config.settingsRevision + 1 });
        // Preserve the previously persisted credential if the new settings did not reach disk.
        if (persisted && previousRef && previousRef !== ref) {
          try { await deps.secrets.remove(previousRef); } catch { if (!disposed) fail('secret'); }
        }
      } catch {
        if (!disposed && generation === endpointGeneration && operation === secretOperation) { secretStatus = 'error'; fail('secret'); }
        throw new ReaderError('auth');
      }
    },
    async onRemoveSecret() {
      if (!initialized || disposed || !config.authRef) return;
      const ref = config.authRef, generation = endpointGeneration, operation = ++secretOperation;
      secretStatus = 'saving'; publish();
      try {
        await deps.secrets.remove(ref);
        if (disposed || generation !== endpointGeneration || operation !== secretOperation || config.authRef !== ref) return;
        secretStatus = 'unset';
        await changeConfig({ ...withoutAuth(config), settingsRevision: config.settingsRevision + 1 });
      } catch {
        if (!disposed && generation === endpointGeneration && operation === secretOperation) { secretStatus = 'error'; fail('secret'); }
        throw new ReaderError('auth');
      }
    },
    onPrefetchChange(enabled) {
      if (!initialized || disposed) return;
      preferences = { ...preferences, prefetchEnabled: enabled };
      deps.prefetch?.setPrefetchEnabled(enabled);
      publish(); void persistSettings();
    },
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize, readerActions, settingsActions,
    async dispose() {
      if (disposed) return;
      disposed = true; endpointGeneration++; secretOperation++;
      deps.prefetch?.onCurrentChapterChanged();
      deps.engine.invalidate(); unsubscribeEngine(); listeners.clear();
      const unsubscribe = unsubscribeLifecycle; unsubscribeLifecycle = null;
      if (unsubscribe) { try { await unsubscribe(); } catch { /* Native listener is no longer allowed to affect state. */ } }
    },
  };
}
export type ReaderController = ReturnType<typeof createReaderController>;

export { createRenewalController } from "./renewalController";
export type { RenewalController, RenewalDependencies, RenewalSnapshot } from "./renewalController";
