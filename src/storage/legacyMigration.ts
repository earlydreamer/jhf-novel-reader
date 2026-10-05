import type { CompletedTranslation, LibraryStore, WorkPage } from '../contracts/reading';
import type { CompletedChapter, ReaderStore } from '../contracts/legacy';
import { digest } from './journal';

export type LegacyMigrationWarning = {
  readonly cacheKey: string;
  readonly reason: 'missing' | 'unfinished' | 'unreadable';
};

export type LegacyMigrationSummary = {
  readonly migrated: number;
  readonly skipped: number;
  readonly warnings: readonly LegacyMigrationWarning[];
};

export type LegacyMigrationInput = {
  /**
   * v1 has no chapter index and PrivateFiles cannot list directories. Callers may
   * only provide cache keys reached from an explicit durable pointer.
   */
  readonly cacheKeys: readonly string[];
  readonly legacy: ReaderStore;
  readonly library: LibraryStore;
};

type PreparedMigration = {
  readonly version: CompletedTranslation;
  readonly blockIndexByParagraphId: ReadonlyMap<string, number>;
};

function workPage(completed: CompletedChapter): WorkPage {
  const source = completed.source;
  const suffix = source.chapterId.slice(source.workId.length + 1);
  const ordinal = suffix === 'short' ? 1 : Number(suffix);
  return {
    workId: source.workId,
    canonicalUrl: `https://ncode.syosetu.com/${source.workId}/`,
    title: source.title,
    chapters: [
      {
        workId: source.workId,
        chapterId: source.chapterId,
        canonicalUrl: source.canonicalUrl,
        title: source.title,
        ordinal,
      },
    ],
    pageUrl: `https://ncode.syosetu.com/${source.workId}/`,
    nextPageUrl: null,
    complete: true,
  };
}

async function prepare(completed: CompletedChapter): Promise<PreparedMigration> {
  const versionId = `legacy-${await digest(['v1', completed.cacheKey])}`;
  const text = completed.paragraphs.map((paragraph) => paragraph.text).join('\n\n');
  const blockTexts = text.split('\n\n');
  const blocks = await Promise.all(
    blockTexts.map(async (block, index) => ({ id: await digest([versionId, index]), text: block })),
  );
  const blockIndexByParagraphId = new Map<string, number>();
  let blockIndex = 0;
  for (const paragraph of completed.paragraphs) {
    blockIndexByParagraphId.set(paragraph.id, blockIndex);
    blockIndex += paragraph.text.split('\n\n').length;
  }
  return {
    version: {
      schemaVersion: 2,
      versionId,
      source: {
        ...completed.source,
        captureKind: 'legacy-import',
        rawHtml: null,
        fetchedAt: null,
      },
      text,
      blocks,
      createdAt: completed.completedAt,
      provenance: {
        provider: completed.identity.provider,
        connectionId: await digest([
          completed.identity.provider,
          completed.identity.normalizedEndpoint,
        ]),
        modelId: completed.identity.model,
        contractVersion: 'plain-v1',
        promptVersion: completed.identity.promptVersion,
        languageDirection: completed.identity.languageDirection,
      },
    },
    blockIndexByParagraphId,
  };
}

export async function migrateLegacyData(
  input: LegacyMigrationInput,
): Promise<LegacyMigrationSummary> {
  let migrated = 0;
  let skipped = 0;
  const warnings: LegacyMigrationWarning[] = [];
  for (const cacheKey of new Set(input.cacheKeys)) {
    let stored: Awaited<ReturnType<ReaderStore['read']>>;
    try {
      stored = await input.legacy.read(cacheKey);
    } catch {
      skipped++;
      warnings.push({ cacheKey, reason: 'unreadable' });
      continue;
    }
    if (!stored) {
      skipped++;
      warnings.push({ cacheKey, reason: 'missing' });
      continue;
    }
    if (!stored.chapter) {
      skipped++;
      warnings.push({ cacheKey, reason: 'unfinished' });
      continue;
    }
    const prepared = await prepare(stored.chapter);
    if (await input.library.readVersion(prepared.version.versionId)) {
      skipped++;
      continue;
    }
    await input.library.saveWorkPage(workPage(stored.chapter));
    await input.library.commitVersion(prepared.version);
    const position = stored.position;
    const blockIndex = position
      ? prepared.blockIndexByParagraphId.get(position.paragraphId)
      : undefined;
    const block = blockIndex === undefined ? undefined : prepared.version.blocks[blockIndex];
    if (position && block)
      await input.library.savePosition({
        workId: prepared.version.source.workId,
        chapterId: prepared.version.source.chapterId,
        versionId: prepared.version.versionId,
        blockId: block.id,
        offset: position.offset,
      });
    migrated++;
  }
  return { migrated, skipped, warnings };
}
