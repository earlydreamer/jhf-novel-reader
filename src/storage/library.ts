import type { CompletedTranslation, LibraryStore, WorkPage } from '../contracts';
import { Journal, serial, type PrivateFiles } from './journal';
import { check, object, snapshot, text } from './validation';
import {
  completedTranslation,
  identifier,
  chapterIdentity,
  readingPosition,
  workPage,
} from './readingValidation';
type Index = {
  versions: { versionId: string; chapterId: string; workId: string; updatedAt: string }[];
  workIds: string[];
  recent: { versionId: string; chapterId: string; workId: string; updatedAt: string }[];
};
async function index(value: unknown): Promise<Index> {
  object(value, ['versions', 'workIds', 'recent']);
  check(
    Array.isArray(value.versions) && Array.isArray(value.workIds) && Array.isArray(value.recent),
  );
  const ids = new Set<string>();
  for (const v of value.versions) {
    object(v, ['versionId', 'chapterId', 'workId', 'updatedAt']);
    identifier(v.versionId);
    chapterIdentity(v.chapterId);
    identifier(v.workId);
    text(v.updatedAt);
    check(Number.isFinite(Date.parse(v.updatedAt)) && !ids.has(v.versionId));
    ids.add(v.versionId);
  }
  const recentWorks = new Set<string>();
  for (const v of value.recent) {
    object(v, ['versionId', 'chapterId', 'workId', 'updatedAt']);
    identifier(v.versionId);
    chapterIdentity(v.chapterId);
    identifier(v.workId);
    text(v.updatedAt);
    check(
      Number.isFinite(Date.parse(v.updatedAt)) &&
        !recentWorks.has(v.workId) &&
        value.versions.some(
          (entry) =>
            entry.versionId === v.versionId &&
            entry.workId === v.workId &&
            entry.chapterId === v.chapterId,
        ),
    );
    recentWorks.add(v.workId);
  }
  for (const id of value.workIds) identifier(id);
  check(new Set(value.workIds).size === value.workIds.length);
  return value as unknown as Index;
}
async function pages(value: unknown): Promise<WorkPage[]> {
  check(Array.isArray(value));
  return Promise.all(value.map(workPage));
}
export function createLibraryStore(files: PrivateFiles): LibraryStore {
  const journal = new Journal(files);
  const readIndex = async () =>
    (await journal.load('library/index', index))?.value ?? {
      versions: [],
      workIds: [],
      recent: [],
    };
  const indexForWrite = async () =>
    (await journal.loadForWrite('library/index', index))?.value ?? {
      versions: [],
      workIds: [],
      recent: [],
    };
  const readVersion = async (versionId: string) => {
    identifier(versionId);
    return (await journal.load(`versions/${versionId}`, completedTranslation))?.value ?? null;
  };
  return {
    listWorkIds: () => serial(files, async () => [...(await readIndex()).workIds]),
    readVersion: (versionId) => serial(files, () => readVersion(versionId)),
    readWork: (workId) =>
      serial(files, async () => {
        identifier(workId);
        return (await journal.load(`works/${workId}`, pages))?.value ?? [];
      }),
    saveWorkPage: (input) => {
      const value = snapshot(input);
      return serial(files, async () => {
        await workPage(value);
        const previous = (await journal.load(`works/${value.workId}`, pages))?.value ?? [];
        await journal.save(
          `works/${value.workId}`,
          [...previous.filter((p) => p.pageUrl !== value.pageUrl), value],
          pages,
        );
        const current = await indexForWrite();
        if (!current.workIds.includes(value.workId)) current.workIds.push(value.workId);
        await journal.save('library/index', current, index);
      });
    },
    listRecent: () =>
      serial(files, async () => {
        const current = await readIndex();
        const seen = new Set<string>();
        return [...current.recent]
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .filter((v) => {
            if (seen.has(v.workId)) return false;
            seen.add(v.workId);
            return true;
          });
      }),
    listVersions: (chapterId) =>
      serial(files, async () => {
        chapterIdentity(chapterId);
        const current = await readIndex();
        const result: CompletedTranslation[] = [];
        for (const v of [...current.versions]
          .filter((v) => v.chapterId === chapterId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
          const value = await readVersion(v.versionId);
          check(value !== null && value.source.chapterId === chapterId);
          result.push(value);
        }
        return result;
      }),
    commitVersion: (input) => {
      const value = snapshot(input);
      return serial(files, async () => {
        await completedTranslation(value);
        const old =
          (await journal.loadForWrite(`versions/${value.versionId}`, completedTranslation))
            ?.value ?? null;
        if (old) check(JSON.stringify(old) === JSON.stringify(value));
        else await journal.save(`versions/${value.versionId}`, value, completedTranslation);
        const current = await indexForWrite();
        const existing = current.versions.find((v) => v.versionId === value.versionId);
        if (existing) {
          check(
            existing.chapterId === value.source.chapterId &&
              existing.workId === value.source.workId,
          );
          return;
        }
        current.versions.push({
          versionId: value.versionId,
          chapterId: value.source.chapterId,
          workId: value.source.workId,
          updatedAt: value.createdAt,
        });
        current.recent = [
          ...current.recent.filter((v) => v.workId !== value.source.workId),
          {
            versionId: value.versionId,
            chapterId: value.source.chapterId,
            workId: value.source.workId,
            updatedAt: value.createdAt,
          },
        ];
        await journal.save('library/index', current, index);
      });
    },
    savePosition: (input) => {
      const value = snapshot(input);
      return serial(files, async () => {
        await readingPosition(value);
        const version = await readVersion(value.versionId);
        check(
          version !== null &&
            version.source.workId === value.workId &&
            version.source.chapterId === value.chapterId,
        );
        const block = version.blocks.find((b) => b.id === value.blockId);
        check(block !== undefined);
        await journal.save(`reading/${value.versionId}`, value, readingPosition);
        const current = await readIndex();
        current.recent = [
          ...current.recent.filter((v) => v.workId !== value.workId),
          {
            workId: value.workId,
            chapterId: value.chapterId,
            versionId: value.versionId,
            updatedAt: new Date().toISOString(),
          },
        ];
        await journal.save('library/index', current, index);
      });
    },
    readPosition: (versionId) =>
      serial(files, async () => {
        identifier(versionId);
        return (await journal.load(`reading/${versionId}`, readingPosition))?.value ?? null;
      }),
  };
}
