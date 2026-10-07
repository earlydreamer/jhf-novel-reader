import { Capacitor } from '@capacitor/core';
import type { AppLifecycle, ModelTransport, SecretStore, SourceTransport } from '../../contracts/index';
import type { ProviderConfig } from '../../contracts/legacy';
import { createPrefetchCoordinator } from '../../legacy/jobs/prefetch';
import { createRequestScheduler } from '../../legacy/jobs/scheduler';
import { createTranslationEngine } from '../../legacy/jobs/engine';
import { capacitorHttpClient } from '../../platform/http/capacitor';
import { createModelTransport, createSourceTransport } from '../../platform/http/index';
import { capacitorLifecycle } from '../../platform/lifecycle';
import { createOpenAICompatibleProvider } from '../../providers/openai-compatible/index';
import { createGeminiProvider } from '../../providers/gemini/index';
import { NarouSourceAdapter } from '../../source/index';
import { createNativePreferences, createNativePrivateFiles } from '../../storage/native';
import { createNativeSecretStore } from '../../storage/secrets';
import { type PreferenceBackend } from '../../storage/settings';
import { createSettingsRepository } from '../../storage/legacy/settings';
import { createReaderStore, type PrivateFiles } from '../../storage/store';
import { createReaderController, type ReaderController } from './controller';
import { createLastChapterRepository } from '../lastChapter';

export interface ApplicationAdapters {
  readonly sourceTransport: SourceTransport;
  readonly modelTransport: ModelTransport;
  readonly files: PrivateFiles;
  readonly preferences: PreferenceBackend;
  readonly secrets: SecretStore;
  readonly lifecycle: AppLifecycle;
}
/** Injection boundary for synthetic tests. Production adapters are constructed only below. */
export function createReaderApplication(adapters: ApplicationAdapters): ReaderController {
  const store = createReaderStore(adapters.files);
  const settings = createSettingsRepository(adapters.preferences);
  const pointer = createLastChapterRepository(adapters.preferences);
  const shared = {
    source: new NarouSourceAdapter(adapters.sourceTransport),
    createProvider: (config: ProviderConfig) => config.provider === 'gemini'
      ? createGeminiProvider(config, adapters.modelTransport, adapters.secrets)
      : createOpenAICompatibleProvider(config, adapters.modelTransport, adapters.secrets),
    store, scheduler: createRequestScheduler(),
  };
  const prefetch = createPrefetchCoordinator(createTranslationEngine({ ...shared, priority: 'prefetch' }));
  const engine = createTranslationEngine({
    ...shared,
    // The engine owns session validity and exposes current write errors as
    // retryable storage state; no obsolete job can set a global UI error.
    onCacheKey: key => pointer.save(key),
  });
  const controller = createReaderController({ engine, prefetch, store, settings, pointer, secrets: adapters.secrets, lifecycle: adapters.lifecycle });
  return controller;
}
/** Never fall back to browser HTTP, browser preferences or plaintext web credential storage. */
export function createNativeReaderApplication(): ReaderController | null {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  return createReaderApplication({
    sourceTransport: createSourceTransport(capacitorHttpClient, { minIntervalMs: 1000 }),
    modelTransport: createModelTransport(capacitorHttpClient),
    files: createNativePrivateFiles(), preferences: createNativePreferences(),
    secrets: createNativeSecretStore(), lifecycle: capacitorLifecycle,
  });
}
