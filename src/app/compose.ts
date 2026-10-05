import { Capacitor } from '@capacitor/core';
import { capacitorHttpClient } from '../platform/http/capacitor';
import { createModelTransport, createSourceTransport } from '../platform/http';
import { capacitorLifecycle } from '../platform/lifecycle';
import { createNativePreferences, createNativePrivateFiles } from '../storage/native';
import { createNativeSecretStore } from '../storage/secrets';
import type { AppLifecycle, ModelChoice, ModelTransport, SecretStore, SourceTransport } from '../contracts';
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
import { createV1Migration } from '../storage/migration';
import { createReadingSettingsRepository } from '../storage/settings';
import { createAttemptRepository } from '../translation/attempts';
import { createWholeChapterFlow } from '../translation/wholeChapter';
import { createProviderSession } from '../providers/plainText';
import { listModels } from '../providers/catalog';
import { createGeminiProviderSession, listGeminiModels } from '../providers/gemini/wholeChapter';
import { openSourceBrowser } from '../platform/browse';
import { normalizeOpenAICompatibleBaseUrl } from '../providers/endpoint';
import { normalizeGeminiBaseUrl } from '../providers/gemini';
import { ReaderError } from '../contracts';
export function createRenewalApplication(
  adapters: ApplicationAdapters & {
    browse?: () => Promise<{ selectedUrl: string } | null>;
    clock?: { now(): number };
  },
): RenewalController {
  const source = createRenewalSource(adapters.sourceTransport),
    library = createLibraryStore(adapters.files);
  const migrateV1 = createV1Migration(adapters.files, adapters.preferences, library);
  const flow = createWholeChapterFlow({
    source,
    store: library,
    createProvider: (selection) => {
      switch (selection.connection.provider) {
        case 'openai-compatible':
          return createProviderSession(selection, adapters.modelTransport, adapters.secrets);
        case 'gemini':
          return createGeminiProviderSession(selection, adapters.modelTransport, adapters.secrets);
        default:
          throw new ReaderError('model_missing');
      }
    },
    attempts: createAttemptRepository(adapters.files),
    clock: adapters.clock ?? { now: () => performance.now() },
  });
  return createRenewalController({
    source,
    library,
    migrateLegacy: migrateV1,
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
      let baseUrl: string;
      switch (config.provider) {
        case 'openai-compatible':
          baseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);
          break;
        case 'gemini':
          baseUrl = normalizeGeminiBaseUrl(config.baseUrl);
          break;
        default:
          throw new ReaderError('model_list');
      }
      const connection = { ...config, baseUrl };
      let newRef: string | null = null;
      try {
        if (secret) {
          if (/[\u0000-\u0020\u007f]/.test(secret)) throw new ReaderError('auth');
          newRef = `provider.${crypto.randomUUID()}`;
          await adapters.secrets.set(newRef, secret);
          connection.authRef = newRef;
        }
        if (signal.aborted) throw new ReaderError('cancelled');
        let models: readonly ModelChoice[];
        switch (connection.provider) {
          case 'openai-compatible':
            models = await listModels(connection, adapters.modelTransport, adapters.secrets, signal);
            break;
          case 'gemini':
            models = await listGeminiModels(
              connection,
              adapters.modelTransport,
              adapters.secrets,
              signal,
            );
            break;
          default:
            throw new ReaderError('model_list');
        }
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
