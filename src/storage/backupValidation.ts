import { StorageError } from './errors';
import { Journal } from './journal';
import { validateLibraryIndex, validateWorkPages } from './library';
import { completedTranslation, readingPosition } from './readingValidation';
import { createReadingSettingsRepository } from './settings';
import { createReaderStore, legacyBodyValidator, legacyPositionRecord } from './store';
import { check } from './validation';
import { validateAttempts } from '../translation/attempts';
import { validateBatch } from '../translation/batch';
import { validateGuidance } from '../translation/guidance';
import { validateTitleRecord } from '../translation/titles';

export interface BackupSnapshot {
  read(path: string): Promise<string | null>;
  readonly paths: readonly string[];
  readonly settings: string | null;
}

/** Validate the recoverable application view without modifying staged or live bytes. */
export async function validateBackupSnapshot(snapshot: BackupSnapshot): Promise<void> {
  const paths = new Set(snapshot.paths);
  check(paths.size === snapshot.paths.length);
  const files = {
    async read(path: string) {
      const text = await snapshot.read(path);
      if (text === null && paths.has(path)) throw new StorageError('io');
      return text;
    },
    async write() {
      throw new StorageError('invalid');
    },
  };
  const journal = new Journal(files);
  let readableLegacy = 0;
  await createReadingSettingsRepository({
    get: async () => ({ value: snapshot.settings }),
    set: async () => {
      throw new StorageError('invalid');
    },
  }).readReadingSettings();

  const visited = new Set<string>();
  async function load<T>(name: string, validate: (value: unknown) => Promise<T>, needed = true) {
    visited.add(name);
    try {
      return (await journal.load(name, validate))?.value ?? null;
    } catch (error) {
      // Deletion/migration deliberately retain unreadable dead records. Future schemas
      // and I/O failures are never treated as harmless old artifacts.
      if (!needed && error instanceof StorageError && error.reason === 'corrupt') return null;
      throw error;
    }
  }
  const index = await load('library/index', validateLibraryIndex);
  await load('attempts/index', validateAttempts);
  await load('batches/current', validateBatch);
  const workIds = new Set(index?.workIds ?? []);
  for (const ref of index?.versions ?? []) {
    const value = await load(`versions/${ref.versionId}`, completedTranslation);
    check(
      value !== null &&
        value.versionId === ref.versionId &&
        value.source.workId === ref.workId &&
        value.source.chapterId === ref.chapterId,
    );
    workIds.add(ref.workId);
    const position = await load(`reading/${ref.versionId}`, readingPosition);
    if (position)
      check(
        position.versionId === ref.versionId &&
          position.workId === ref.workId &&
          position.chapterId === ref.chapterId &&
          value.blocks.some((block) => block.id === position.blockId),
      );
  }
  for (const workId of workIds) {
    const pages = await load(`works/${workId}`, validateWorkPages);
    if (index?.workIds.includes(workId)) check(pages !== null && pages.length > 0);
    if (pages) check(pages.every((page) => page.workId === workId));
    const guidance = await load(`guidance/${workId}`, validateGuidance);
    if (guidance) check(guidance.workId === workId);
    const titles = await load(`titles/${workId}`, validateTitleRecord);
    if (titles) check(titles.workId === workId);
  }

  // Inspect one journal at a time: never retain all restored novel payloads in JS.
  // Inert filenames and disposable batches/scan-*.json caches are kept unchanged.
  for (const path of paths) {
    const match =
      /^(chapters|positions|versions|reading|works|guidance|titles)\/([A-Za-z0-9.-]+)\.[01]\.json$/.exec(
        path,
      );
    if (!match) continue;
    const [, folder, id] = match;
    const name = `${folder}/${id}`;
    if (visited.has(name)) continue;
    switch (folder) {
      case 'chapters':
        if (/^v1-[a-f0-9]{64}$/.test(id!)) {
          const body = await load(name, legacyBodyValidator(id!), false);
          if (body) {
            try {
              if (await createReaderStore(files).read(id!)) readableLegacy++;
            } catch (error) {
              if (
                !(error instanceof StorageError) ||
                !['corrupt', 'invalid'].includes(error.reason)
              )
                throw error;
            }
          }
        }
        break;
      case 'positions': {
        if (!/^[a-f0-9]{64}$/.test(id!)) break;
        await load(name, legacyPositionRecord, false);
        break;
      }
      case 'versions':
        await load(name, completedTranslation, false);
        break;
      case 'reading':
        await load(name, readingPosition, false);
        break;
      case 'works':
        await load(name, validateWorkPages, false);
        break;
      case 'guidance':
        await load(name, validateGuidance, false);
        break;
      case 'titles':
        await load(name, validateTitleRecord, false);
        break;
    }
  }
  // An unreadable-only archive must not replace healthy data with an empty view.
  check(index !== null || paths.size === 0 || readableLegacy > 0);
}
