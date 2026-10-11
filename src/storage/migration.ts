import { createLastChapterRepository } from '../app/lastChapter';
import type { LibraryStore } from '../contracts/reading';
import type { PrivateFiles } from './journal';
import { migrateLegacyData, type LegacyMigrationSummary } from './legacyMigration';
import type { PreferenceBackend } from './settings';
import { createReaderStore } from './store';

export function createV1Migration(
  files: PrivateFiles,
  preferences: PreferenceBackend,
  library: LibraryStore,
): () => Promise<LegacyMigrationSummary> {
  return async () => {
    const pending = (await library.readChapterRemovalInventory?.()) ?? [];
    // 한 번의 시작에서 각 기존 정리만 재시도한다. 실패한 경로는 다음 시작 때 다시 확인한다.
    for (const entry of pending) {
      try {
        await library.retryChapterRemoval?.(entry.chapterId);
      } catch {
        /* inventory를 보존한다. */
      }
    }
    const remaining = (await library.readChapterRemovalInventory?.()) ?? [];
    const deleted = (await library.readLegacyRemovedChapterIds?.()) ?? [];
    const skipChapterIds = [
      ...new Set([...deleted, ...[...pending, ...remaining].map((entry) => entry.chapterId)]),
    ];
    const cacheKey = await createLastChapterRepository(preferences).read();
    const removalInventory = (await library.readRemovalInventory?.()) ?? [];
    const cacheKeys = cacheKey ? [cacheKey] : [];
    for (const name of (await files.list?.('chapters')) ?? []) {
      const match = /^(v1-[a-f0-9]{64})\.[01]\.json$/.exec(name);
      if (match) cacheKeys.push(match[1]!);
    }
    return migrateLegacyData({
      cacheKeys,
      legacy: createReaderStore(files),
      library,
      skipChapterIds,
      skipWorkIds: removalInventory.map((entry) => entry.workId),
    });
  };
}

export type { LegacyMigrationSummary, LegacyMigrationWarning } from './legacyMigration';
