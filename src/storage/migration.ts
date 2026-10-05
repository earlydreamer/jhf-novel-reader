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
    await migrateLegacyData({
      cacheKeys: cacheKey ? [cacheKey] : [],
      legacy: createReaderStore(files),
      library,
    });
  };
}
