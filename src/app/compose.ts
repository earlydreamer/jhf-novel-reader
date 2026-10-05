import { Capacitor } from '@capacitor/core';
import { capacitorHttpClient } from '../platform/http/capacitor';
import { createModelTransport, createSourceTransport } from '../platform/http';
import { capacitorLifecycle } from '../platform/lifecycle';
import { createNativePreferences, createNativePrivateFiles } from '../storage/native';
import { createNativeSecretStore } from '../storage/secrets';
import type { ModelTransport, SecretStore, SourceTransport, AppLifecycle } from '../contracts';
import type { PrivateFiles } from '../storage/journal';
import type { PreferenceBackend } from '../storage/settings';
export interface ApplicationAdapters {
  readonly sourceTransport: SourceTransport;
  readonly modelTransport: ModelTransport;
  readonly files: PrivateFiles;
  readonly preferences: PreferenceBackend;
  readonly secrets: SecretStore;
  readonly lifecycle: AppLifecycle;
}

import { createRenewalController, type RenewalController } from './renewalController';
import { createRenewalSource, normalizeSourceInput } from '../source/work';
import { createLibraryStore } from '../storage/library';
import { createReadingSettingsRepository } from '../storage/settings';
import { createAttemptRepository } from '../translation/attempts';
import { createWholeChapterFlow } from '../translation/wholeChapter';
import { createProviderSession } from '../providers/plainText';
import { listModels } from '../providers/catalog';
import { openSourceBrowser } from '../platform/browse';
import { normalizeOpenAICompatibleBaseUrl } from '../providers/endpoint';
import { ReaderError } from '../contracts';
export function createRenewalApplication(
  adapters: ApplicationAdapters & {
    browse?: () => Promise<{ selectedUrl: string } | null>;
    clock?: { now(): number };
  },
): RenewalController {
  const source = createRenewalSource(adapters.sourceTransport),
    library = createLibraryStore(adapters.files);
  const flow = createWholeChapterFlow({
    source,
    store: library,
    createProvider: (selection) =>
      createProviderSession(selection, adapters.modelTransport, adapters.secrets),
    attempts: createAttemptRepository(adapters.files),
    clock: adapters.clock ?? { now: () => performance.now() },
  });
  return createRenewalController({
    source,
    library,
    flow,
    clock: adapters.clock,
    lifecycle: adapters.lifecycle,
    settings: createReadingSettingsRepository(adapters.preferences),
    browse: adapters.browse,
    normalizeInput(input) {
      const value = normalizeSourceInput(input);
      return value.chapterUrl ?? value.workUrl;
    },
    async catalog(config, secret, signal) {
      if (config.provider !== 'openai-compatible') throw new ReaderError('model_list');
      const connection = { ...config, baseUrl: normalizeOpenAICompatibleBaseUrl(config.baseUrl) };
      let newRef: string | null = null;
      try {
        if (secret) {
          if (/[\u0000-\u0020\u007f]/.test(secret)) throw new ReaderError('auth');
          newRef = `provider.${crypto.randomUUID()}`;
          await adapters.secrets.set(newRef, secret);
          connection.authRef = newRef;
        }
        if (signal.aborted) throw new ReaderError('cancelled');
        const models = await listModels(
          connection,
          adapters.modelTransport,
          adapters.secrets,
          signal,
        );
        if (signal.aborted) throw new ReaderError('cancelled');
        return { connection, models };
      } catch (error) {
        if (newRef) await adapters.secrets.remove(newRef);
        throw error;
      }
    },
  });
}
export function createNativeRenewalApplication(): RenewalController {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android')
    return createRenewalController();
  return createRenewalApplication({
    sourceTransport: createSourceTransport(capacitorHttpClient),
    modelTransport: createModelTransport(capacitorHttpClient),
    files: createNativePrivateFiles(),
    preferences: createNativePreferences(),
    secrets: createNativeSecretStore(),
    lifecycle: capacitorLifecycle,
    browse: () => openSourceBrowser('https://syosetu.com/'),
  });
}
