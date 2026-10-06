import { createLastChapterRepository } from '../app/lastChapter';
import type { LibraryStore } from '../contracts/reading';
import type { PrivateFiles } from './journal';
import { migrateLegacyData } from './legacyMigration';
import type { PreferenceBackend } from './settings';
import { createReaderStore } from './store';

export function createV1Migration(
  files: PrivateFiles,
  preferences: PreferenceBackend,
  library: LibraryStore,
): () => Promise<void> {
  return async () => {
    const cacheKey = await createLastChapterRepository(preferences).read();
    const cacheKeys = cacheKey ? [cacheKey] : [];
    for (const name of (await files.list?.('chapters')) ?? []) {
      const match = /^(v1-[a-f0-9]{64})\.[01]\.json$/.exec(name);
      if (match) cacheKeys.push(match[1]!);
    }
    await migrateLegacyData({
      cacheKeys,
      legacy: createReaderStore(files),
      library,
    });
  };
}
