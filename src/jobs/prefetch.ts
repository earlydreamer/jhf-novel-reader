import type { CompletedChapter, ProviderConfig } from '../contracts';
import type { TranslationEngine } from './engine';

export interface PrefetchCoordinator {
  setPrefetchEnabled(enabled: boolean): void;
  onCurrentChapterReady(chapter: CompletedChapter, config: ProviderConfig): void;
  onCurrentChapterChanged(): void;
  onForegroundChanged(active: boolean): void;
}
/** Only current-reader ready events enter here; speculative ready never feeds itself. */
export function createPrefetchCoordinator(engine: TranslationEngine): PrefetchCoordinator {
  let enabled = false, foreground = false;
  let candidate: { id: string; url: string; config: ProviderConfig; started: boolean } | null = null;
  function prepare() {
    if (!enabled || !foreground || !candidate) return;
    if (!candidate.started) {
      candidate.started = true;
      engine.startChapter(candidate.url, candidate.config);
    } else if (engine.getSnapshot().job.phase === 'paused') {
      // Only a known-unsent pause is safe to continue automatically. An unknown
      // native outcome or recovered checkpoint needs an explicit reader retry.
      engine.retry();
    }
  }
  function invalidate() { candidate = null; engine.invalidate(); }
  return {
    setPrefetchEnabled(value) {
      enabled = value;
      if (!value) {
        // Preserve terminal errors: OFF must not relabel a failed POST as an
        // unsent pause that ON could silently retry.
        if (['preparing', 'translating', 'validating', 'saving'].includes(engine.getSnapshot().job.phase)) engine.cancel();
      } else prepare();
    },
    onCurrentChapterReady(chapter, config) {
      const url = chapter.source.nextUrl;
      if (!url || url === chapter.source.canonicalUrl) { invalidate(); return; }
      const id = JSON.stringify([chapter.cacheKey, url, config]);
      if (candidate?.id !== id) {
        engine.invalidate();
        candidate = { id, url, config: { ...config }, started: false };
      }
      prepare();
    },
    onCurrentChapterChanged: invalidate,
    onForegroundChanged(active) {
      foreground = active;
      engine.setForeground(active);
      if (active) prepare();
    },
  };
}
