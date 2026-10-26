import { Capacitor } from '@capacitor/core';
import { capacitorHttpClient } from '../platform/http/capacitor';
import { createNativeStreamingClient } from '../platform/http/stream';
import {
  createLookupTransport,
  createModelTransport,
  createSourceTransport,
} from '../platform/http';
import { capacitorLifecycle } from '../platform/lifecycle';
import { capacitorEmbedding } from '../platform/embedding';
import { createNativePreferences, createNativePrivateFiles } from '../storage/native';
import { createNativeSecretStore } from '../storage/secrets';
import type {
  AppLifecycle,
  ModelChoice,
  ModelTransport,
  SecretStore,
  SourceTransport,
} from '../contracts';
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
import { createRenewalSource, normalizeSourceInput } from '../source/sites';
import { createLibraryStore } from '../storage/library';
import { createV1Migration } from '../storage/migration';
import { createReadingSettingsRepository } from '../storage/settings';
import { createAttemptRepository } from '../translation/attempts';
import { createWholeChapterFlow } from '../translation/wholeChapter';
import { createBatchRepository, createBatchTranslation } from '../translation/batch';
import { createBatchScanStore } from '../translation/batchScanStore';
import { createProviderSession } from '../providers/plainText';
import { listModels } from '../providers/catalog';
import { createGeminiProviderSession, listGeminiModels } from '../providers/gemini/wholeChapter';
import { openSourceBrowser } from '../platform/browse';
import { BROWSE_SITES } from '../platform/browseSites';
import { normalizeOpenAICompatibleBaseUrl } from '../providers/endpoint';
import { normalizeGeminiBaseUrl } from '../providers/gemini';
import { ReaderError } from '../contracts';
import { createGuidanceRepository, type WorkGuidance } from '../translation/guidance';
import { createAutoGlossary } from '../translation/autoGlossary';
import { createTitleRepository, createTitleTranslation } from '../translation/titles';
import { createRangeJudge, createTermScan } from '../translation/termScanRun';
import { loadKanjidic } from '../translation/kanjidic';
import { decideCandidates } from '../translation/termDecision';
export function createRenewalApplication(
  adapters: ApplicationAdapters & {
    browse?: (startUrl?: string) => Promise<{ selectedUrl: string } | null>;
    clock?: { now(): number };
  },
): RenewalController {
  const source = createRenewalSource(adapters.sourceTransport),
    library = createLibraryStore(adapters.files, { preferences: adapters.preferences });
  const migrateV1 = createV1Migration(adapters.files, adapters.preferences, library);
  const guidance = createGuidanceRepository(adapters.files);
  const createProvider = (selection: import('../contracts').SelectedModel) => {
    switch (selection.connection.provider) {
      case 'openai-compatible':
        return createProviderSession(selection, adapters.modelTransport, adapters.secrets);
      case 'gemini':
        return createGeminiProviderSession(selection, adapters.modelTransport, adapters.secrets);
      default:
        throw new ReaderError('model_missing');
    }
  };
  // 기기 용어 판정 문(#241). 설정 토글이 켜지고 모델이 설치됐을 때만 컨트롤러가 켠다. 미리 번역도 이 흐름을 쓴다.
  const termDecisionGate = { enabled: false };
  const flow = createWholeChapterFlow({
    source,
    store: library,
    guidance,
    createProvider,
    ...(capacitorEmbedding.available()
      ? {
          decideCandidates: async (input: string, workGuidance: WorkGuidance | null) =>
            termDecisionGate.enabled
              ? decideCandidates(input, workGuidance?.terms ?? [], (texts) =>
                  capacitorEmbedding.embed(texts),
                )
              : null,
        }
      : {}),
    ...(guidance ? { autoGlossary: createAutoGlossary(createProvider, guidance) } : {}),
    attempts: createAttemptRepository(adapters.files),
    clock: adapters.clock ?? { now: () => performance.now() },
  });
  return createRenewalController({
    defaultTranslationMode: adapters.modelTransport.streamPost ? 'stream' : 'legacy',
    streamingAvailable: Boolean(adapters.modelTransport.streamPost),
    source,
    library,
    guidance,
    termScan: guidance
      ? createTermScan({ createProvider, guidance, library, loadKanjidic, lookup: lookupTransport })
      : undefined,
    rangeJudge: guidance
      ? createRangeJudge({ createProvider, guidance, loadKanjidic, lookup: lookupTransport })
      : undefined,
    titles: createTitleRepository(adapters.files),
    translateTitles: createTitleTranslation(
      createProvider,
      guidance,
      Boolean(adapters.modelTransport.streamPost),
    ),
    migrateLegacy: migrateV1,
    flow,
    batch: createBatchTranslation({
      source,
      library,
      flow,
      repository: createBatchRepository(adapters.files),
      guidance,
      scanStore: createBatchScanStore(adapters.files),
    }),
    clock: adapters.clock,
    lifecycle: adapters.lifecycle,
    embedding: capacitorEmbedding,
    onTermDecisionChange: (enabled: boolean) => {
      termDecisionGate.enabled = enabled;
    },
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
            models = await listModels(
              connection,
              adapters.modelTransport,
              adapters.secrets,
              signal,
            );
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

/** 정밀스캔 외부 조회 통로. 출처별 설정이 켜졌을 때만 엔진이 쓴다. */
export const lookupTransport = createLookupTransport(capacitorHttpClient);

export function createNativeRenewalApplication(): RenewalController {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android')
    return createRenewalController();
  return createRenewalApplication({
    sourceTransport: createSourceTransport(capacitorHttpClient, { minIntervalMs: 1000 }),
    modelTransport: createModelTransport(capacitorHttpClient, createNativeStreamingClient()),
    files: createNativePrivateFiles(),
    preferences: createNativePreferences(),
    secrets: createNativeSecretStore(),
    lifecycle: capacitorLifecycle,
    browse: (startUrl = BROWSE_SITES[0]!.startUrl) => openSourceBrowser(startUrl),
  });
}
