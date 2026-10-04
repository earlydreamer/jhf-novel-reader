import { Capacitor } from '@capacitor/core';
import type { AppLifecycle, ModelTransport, SecretStore, SourceTransport } from '../contracts';
import { createTranslationEngine } from '../jobs/engine';
import { capacitorHttpClient } from '../platform/http/capacitor';
import { createModelTransport, createSourceTransport } from '../platform/http';
import { capacitorLifecycle } from '../platform/lifecycle';
import { createOpenAICompatibleProvider } from '../providers/openai-compatible';
import { NarouSourceAdapter } from '../source';
import { createNativePreferences, createNativePrivateFiles } from '../storage/native';
import { createNativeSecretStore } from '../storage/secrets';
import { createSettingsRepository, type PreferenceBackend } from '../storage/settings';
import { createReaderStore, type PrivateFiles } from '../storage/store';
import { createReaderController, type ReaderController } from './controller';
import { createLastChapterRepository } from './lastChapter';

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
  const engine = createTranslationEngine({
    source: new NarouSourceAdapter(adapters.sourceTransport),
    createProvider: config => createOpenAICompatibleProvider(config, adapters.modelTransport, adapters.secrets),
    store,
    // The engine owns session validity and exposes current write errors as
    // retryable storage state; no obsolete job can set a global UI error.
    onCacheKey: key => pointer.save(key),
  });
  const controller = createReaderController({ engine, store, settings, pointer, secrets: adapters.secrets, lifecycle: adapters.lifecycle });
  return controller;
}
/** Never fall back to browser HTTP, browser preferences or plaintext web credential storage. */
export function createNativeReaderApplication(): ReaderController | null {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  return createReaderApplication({
    sourceTransport: createSourceTransport(capacitorHttpClient),
    modelTransport: createModelTransport(capacitorHttpClient),
    files: createNativePrivateFiles(), preferences: createNativePreferences(),
    secrets: createNativeSecretStore(), lifecycle: capacitorLifecycle,
  });
}
