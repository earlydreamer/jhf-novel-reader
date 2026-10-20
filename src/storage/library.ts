import type {
  ChapterRemovalResult,
  ChapterRemovalInventory,
  CompletedTranslation,
  ReadingPosition,
  LibraryStore,
  WorkPage,
  WorkRemovalInventory,
  WorkRemovalResult,
  WorkUpdate,
} from '../contracts';
import { digest, Journal, serial, type PrivateFiles } from './journal';
import { check, integer, object, snapshot, text } from './validation';
import {
  completedTranslation,
  identifier,
  chapterIdentity,
  readingPosition,
  workPage,
} from './readingValidation';
import { StorageError } from './errors';
import { validateAttempts } from '../translation/attempts';
import { validateBatch } from '../translation/batch';
import { validateTitleRecord } from '../translation/titles';
import { validateGuidance } from '../translation/guidance';
import { legacyBodyValidator, legacyPositionRecord } from './store';
import { createLastChapterRepository } from '../app/lastChapter';
import { validChapterCheckDate } from '../app/chapterUpdateSchedule';
import type { PreferenceBackend } from './settings';
type Index = {
  versions: { versionId: string; chapterId: string; workId: string; updatedAt: string }[];
  workIds: string[];
  recent: { versionId: string; chapterId: string; workId: string; updatedAt: string }[];
  removalInventory?: WorkRemovalInventory[];
  chapterRemovalInventory?: ChapterRemovalInventory[];
  legacyRemovedChapterIds?: string[];
  workUpdates?: WorkUpdate[];
};
async function index(value: unknown): Promise<Index> {
  object(value, [
    'versions',
    'workIds',
    'recent',
    'removalInventory',
    'chapterRemovalInventory',
    'legacyRemovedChapterIds',
    'workUpdates',
  ]);
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
  if (value.workUpdates !== undefined) {
    check(Array.isArray(value.workUpdates));
    const owners = new Set<string>();
    for (const update of value.workUpdates) {
      validateWorkUpdate(update);
      check(value.workIds.includes(update.workId) && !owners.has(update.workId));
      owners.add(update.workId);
    }
  }
  const removalInventory = value.removalInventory ?? [];
  check(Array.isArray(removalInventory));
  for (const entry of removalInventory) {
    object(entry, ['workId', 'cacheKeys', 'paths', 'createdAt', 'pointerCacheKey', 'issues']);
    identifier(entry.workId);
    check(Array.isArray(entry.cacheKeys) && Array.isArray(entry.paths));
    entry.cacheKeys.forEach((key: unknown) =>
      check(typeof key === 'string' && /^v1-[a-f0-9]{64}$/.test(key)),
    );
    entry.paths.forEach((path: unknown) =>
      check(typeof path === 'string' && /^[a-z]+\/[a-zA-Z0-9.-]+\.[01]\.json$/.test(path)),
    );
    text(entry.createdAt);
    check(Number.isFinite(Date.parse(entry.createdAt)));
    if (entry.pointerCacheKey !== undefined)
      check(
        typeof entry.pointerCacheKey === 'string' &&
          /^v1-[a-f0-9]{64}$/.test(entry.pointerCacheKey),
      );
    if (entry.issues !== undefined)
      check(
        Array.isArray(entry.issues) &&
          entry.issues.every((issue: unknown) => typeof issue === 'string'),
      );
  }
  check(new Set(removalInventory.map((entry) => entry.workId)).size === removalInventory.length);
  if (value.removalInventory === undefined) value.removalInventory = [];
  const chapterRemovalInventory = value.chapterRemovalInventory ?? [];
  check(Array.isArray(chapterRemovalInventory));
  const pendingChapters = new Set<string>(),
    pendingVersions = new Set<string>();
  for (const entry of chapterRemovalInventory) {
    object(entry, ['workId', 'chapterId', 'versionIds', 'paths', 'createdAt']);
    identifier(entry.workId);
    chapterIdentity(entry.chapterId);
    check(entry.chapterId.startsWith(`${entry.workId}/`) && !pendingChapters.has(entry.chapterId));
    pendingChapters.add(entry.chapterId);
    check(Array.isArray(entry.versionIds) && Array.isArray(entry.paths));
    for (const id of entry.versionIds) {
      identifier(id);
      check(!pendingVersions.has(id) && !ids.has(id));
      pendingVersions.add(id);
    }
    for (const path of entry.paths) {
      text(path);
      const match = /^(versions|reading)\/([A-Za-z0-9.-]+)\.[01]\.json$/.exec(path);
      check(match !== null && entry.versionIds.includes(match[2]));
    }
    check(new Set(entry.paths).size === entry.paths.length);
    text(entry.createdAt);
    check(Number.isFinite(Date.parse(entry.createdAt)));
  }
  if (value.chapterRemovalInventory === undefined) value.chapterRemovalInventory = [];
  const legacyRemovedChapterIds = value.legacyRemovedChapterIds ?? [];
  check(Array.isArray(legacyRemovedChapterIds));
  legacyRemovedChapterIds.forEach(chapterIdentity);
  check(new Set(legacyRemovedChapterIds).size === legacyRemovedChapterIds.length);
  if (value.legacyRemovedChapterIds === undefined) value.legacyRemovedChapterIds = [];
  return value as unknown as Index;
}
export async function validateWorkPages(value: unknown): Promise<WorkPage[]> {
  check(Array.isArray(value));
  return Promise.all(value.map(workPage));
}

function validateWorkUpdate(value: unknown): asserts value is WorkUpdate {
  object(value, [
    'workId',
    'attemptedAt',
    'lastCheckDate',
    'checkedAt',
    'knownChapterIds',
    'newChapterIds',
    'failed',
  ]);
  identifier(value.workId);
  integer(value.attemptedAt);
  check(validChapterCheckDate(value.lastCheckDate));
  if (value.checkedAt !== null) integer(value.checkedAt);
  check(typeof value.failed === 'boolean');
  for (const ids of [value.knownChapterIds, value.newChapterIds]) {
    if (ids === null) continue;
    check(Array.isArray(ids) && new Set(ids).size === ids.length);
    for (const id of ids) {
      chapterIdentity(id);
      check(id.startsWith(`${value.workId}/`));
    }
  }
  check(Array.isArray(value.newChapterIds));
  check(value.knownChapterIds === null || Array.isArray(value.knownChapterIds));
  check(
    value.newChapterIds.every((id) => (value.knownChapterIds as string[] | null)?.includes(id)),
  );
}
type RemovalOptions = { preferences?: PreferenceBackend };
const slotPath = (name: string, slot: number) => `${name}.${slot}.json`;
function legacyOwner(value: unknown): { workId: string; chapterId: string } | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as {
    chapter?: { source?: { workId?: unknown; chapterId?: unknown } } | null;
    checkpoint?: { chapter?: { workId?: unknown; chapterId?: unknown } } | null;
  };
  const source = body.chapter?.source ?? body.checkpoint?.chapter;
  return source && typeof source.workId === 'string' && typeof source.chapterId === 'string'
    ? { workId: source.workId, chapterId: source.chapterId }
    : null;
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
async function writeBoth<T>(
  journal: Journal,
  name: string,
  value: T,
  validate: (value: unknown) => Promise<T>,
): Promise<void> {
  await journal.save(name, value, validate);
  await journal.save(name, value, validate);
}

/** 삭제 표식은 정리 목록이 퇴역해도 유지하며 이전 유효 슬롯에만 남아 있어도 보존한다. */
function mergeLegacyRemovedChapterIds(indexes: readonly Index[]): string[] {
  return unique(indexes.flatMap((value) => value.legacyRemovedChapterIds ?? []));
}

/** Pending rows in either valid slot remain authoritative until both slots retire them. */
function mergeChapterRemovals(indexes: readonly Index[]): ChapterRemovalInventory[] {
  const merged = new Map<string, ChapterRemovalInventory>();
  for (const item of indexes.flatMap((value) => value.chapterRemovalInventory ?? [])) {
    const previous = merged.get(item.chapterId);
    merged.set(
      item.chapterId,
      previous
        ? {
            ...previous,
            versionIds: unique([...previous.versionIds, ...item.versionIds]),
            paths: unique([...previous.paths, ...item.paths]),
          }
        : item,
    );
  }
  return [...merged.values()];
}

/** Validate only the exact deletion target, never a healthy sibling's fallback payload. */
async function removeOwnedVersionPath(
  files: PrivateFiles,
  path: string,
  owner: { workId: string; chapterId?: string },
): Promise<boolean> {
  const match = /^(versions|reading)\/([A-Za-z0-9.-]+)\.([01])\.json$/.exec(path);
  if (!match) return false;
  try {
    const raw = await files.read(path);
    if (raw === null) return true;
    const exact = new Journal({
      read: async (candidate) => (candidate === path ? raw : null),
      write: async () => {
        throw new Error('read-only cleanup validation');
      },
    });
    const name = `${match[1]}/${match[2]}`;
    let owned: boolean;
    if (match[1] === 'versions') {
      const value = (await exact.load(name, completedTranslation))?.value;
      owned = Boolean(
        value &&
        value.versionId === match[2] &&
        value.source.workId === owner.workId &&
        (!owner.chapterId || value.source.chapterId === owner.chapterId),
      );
    } else {
      const value = (await exact.load(name, readingPosition))?.value;
      owned = Boolean(
        value &&
        value.versionId === match[2] &&
        value.workId === owner.workId &&
        (!owner.chapterId || value.chapterId === owner.chapterId),
      );
    }
    if (!owned || !files.remove) return false;
    await files.remove(path);
    return (await files.read(path)) === null;
  } catch {
    return false;
  }
}

/** Old inventories are discovery records, not authority to delete another work's position. */
async function removeOwnedLegacyPositionPath(
  files: PrivateFiles,
  path: string,
  workId: string,
): Promise<boolean> {
  const match = /^positions\/([a-f0-9]{64})\.([01])\.json$/.exec(path);
  if (!match) return false;
  try {
    const raw = await files.read(path);
    if (raw === null) return true;
    const exact = new Journal({
      read: async (candidate) => (candidate === path ? raw : null),
      write: async () => {
        throw new Error('read-only cleanup validation');
      },
    });
    const value = (await exact.load(`positions/${match[1]}`, legacyPositionRecord))?.value;
    if (!value) return false;
    const chapterId = value.position.chapterId;
    chapterIdentity(chapterId);
    if (
      !chapterId.startsWith(`${workId}/`) ||
      (await digest(chapterId)) !== match[1] ||
      !files.remove
    )
      return false;
    await files.remove(path);
    return (await files.read(path)) === null;
  } catch {
    return false;
  }
}

async function removeWorkData(
  files: PrivateFiles,
  journal: Journal,
  options: RemovalOptions,
  workId: string,
  activeBatchWorkId?: string,
): Promise<WorkRemovalResult> {
  identifier(workId);
  const indexSlots = await journal.readSlots('library/index', index);
  if (indexSlots.found && !indexSlots.entries.length)
    return { removed: null, cleanupComplete: false, remainingInventory: ['library/index'] };
  const current = indexSlots.entries[0]?.value ?? {
    versions: [],
    workIds: [],
    recent: [],
    removalInventory: [],
  };
  const existing = indexSlots.entries.flatMap((entry) => entry.value.removalInventory ?? []);
  const mergedPending = new Map<string, WorkRemovalInventory>();
  for (const entry of existing) {
    const previous = mergedPending.get(entry.workId);
    mergedPending.set(
      entry.workId,
      previous
        ? {
            ...previous,
            cacheKeys: unique([...previous.cacheKeys, ...entry.cacheKeys]),
            paths: unique([...previous.paths, ...entry.paths]),
            issues: unique([...(previous.issues ?? []), ...(entry.issues ?? [])]),
            pointerCacheKey: entry.pointerCacheKey ?? previous.pointerCacheKey,
          }
        : entry,
    );
  }
  const prior = mergedPending.get(workId);
  const chapterRemovals = mergeChapterRemovals(indexSlots.entries.map((entry) => entry.value));
  const absorbed = chapterRemovals.filter((entry) => entry.workId === workId);
  const attemptSlots = await journal.readSlots('attempts/index', validateAttempts);
  const latestAttempts = attemptSlots.entries[0];
  if (attemptSlots.found && !latestAttempts)
    return {
      removed: Boolean(prior),
      cleanupComplete: false,
      remainingInventory: ['attempts/index'],
    };
  const attempts = latestAttempts?.value ?? [];

  const batchSlots = await journal.readSlots('batches/current', validateBatch);
  const latestBatch = batchSlots.entries[0];
  if (batchSlots.found && !latestBatch)
    return {
      removed: Boolean(prior),
      cleanupComplete: false,
      remainingInventory: ['batches/current'],
    };
  // 저장된 batch 기록은 실행 중인 작업이 아니므로 막지 않는다. 런타임 owner만 막는다.
  if (activeBatchWorkId === workId)
    return {
      removed: Boolean(prior),
      cleanupComplete: false,
      remainingInventory: [],
      blockedBy: 'batch',
    };

  const paths: string[] = [],
    issues: string[] = [],
    cacheKeys: string[] = prior?.cacheKeys ? [...prior.cacheKeys] : [],
    chapterIds = new Set(
      current.versions.filter((entry) => entry.workId === workId).map((entry) => entry.chapterId),
    );
  const collect = async <T>(
    name: string,
    validate: (value: unknown) => Promise<T>,
    owns: (value: T) => boolean,
  ) => {
    const slots = await journal.readSlots(name, validate);
    for (const entry of slots.entries) {
      if (owns(entry.value)) paths.push(slotPath(name, entry.slot));
      else issues.push(`소유권이 일치하지 않는 슬롯을 보존했어요: ${slotPath(name, entry.slot)}`);
    }
    for (const slot of slots.invalidSlots)
      issues.push(`소유권을 확인할 수 없는 슬롯을 보존했어요: ${slotPath(name, slot)}`);
  };
  await collect(`works/${workId}`, validateWorkPages, (value) =>
    value.every((page) => page.workId === workId),
  );
  const versionIds = new Set<string>();
  for (const version of current.versions.filter((entry) => entry.workId === workId)) {
    versionIds.add(version.versionId);
    await collect(`versions/${version.versionId}`, completedTranslation, (value) => {
      if (value.source.workId !== workId || value.source.chapterId !== version.chapterId)
        return false;
      chapterIds.add(value.source.chapterId);
      return true;
    });
    await collect(
      `reading/${version.versionId}`,
      readingPosition,
      (value) => value.workId === workId && value.versionId === version.versionId,
    );
  }
  await collect(`titles/${workId}`, validateTitleRecord, (value) => value.workId === workId);
  await collect(`guidance/${workId}`, validateGuidance, (value) => value.workId === workId);

  if (!files.list) {
    issues.push('저장 파일 목록을 조회할 수 없어 색인 밖 저장본 정리를 완료하지 못했어요.');
  } else {
    let versionNames: readonly string[] = [];
    let readingNames: readonly string[] = [];
    try {
      versionNames = await files.list('versions');
    } catch {
      issues.push('저장 번역 파일 목록을 읽지 못했어요.');
    }
    for (const filename of versionNames) {
      const match = /^([A-Za-z0-9.-]+)\.[01]\.json$/.exec(filename);
      if (!match) continue;
      const versionId = match[1]!;
      if (versionIds.has(versionId)) continue;
      versionIds.add(versionId);
      const slots = await journal.readSlots(`versions/${versionId}`, completedTranslation);
      const owned = slots.entries.filter((entry) => entry.value.source.workId === workId);
      for (const entry of owned) {
        chapterIds.add(entry.value.source.chapterId);
        paths.push(slotPath(`versions/${versionId}`, entry.slot));
      }
      for (const slot of slots.invalidSlots)
        issues.push(
          `색인 밖 저장본의 소유권을 확인할 수 없어 보존했어요: ${slotPath(`versions/${versionId}`, slot)}`,
        );
      if (owned.length) {
        await collect(
          `reading/${versionId}`,
          readingPosition,
          (value) => value.workId === workId && value.versionId === versionId,
        );
      }
    }
    try {
      readingNames = await files.list('reading');
    } catch {
      issues.push('읽기 위치 파일 목록을 읽지 못했어요.');
    }
    for (const filename of readingNames) {
      const match = /^([A-Za-z0-9.-]+)\.[01]\.json$/.exec(filename);
      if (!match) continue;
      const versionId = match[1]!;
      if (versionIds.has(versionId)) continue;
      const slots = await journal.readSlots(`reading/${versionId}`, readingPosition);
      for (const entry of slots.entries) {
        if (entry.value.workId === workId && entry.value.versionId === versionId) {
          chapterIds.add(entry.value.chapterId);
          paths.push(slotPath(`reading/${versionId}`, entry.slot));
        }
      }
      for (const slot of slots.invalidSlots)
        issues.push(
          `색인 밖 읽기 위치의 소유권을 확인할 수 없어 보존했어요: ${slotPath(`reading/${versionId}`, slot)}`,
        );
    }
    let names: readonly string[];
    try {
      names = await files.list('chapters');
    } catch {
      names = [];
      issues.push('이전 저장 파일 목록을 읽지 못했어요.');
    }
    for (const filename of names) {
      const match = /^(v1-[a-f0-9]{64})\.[01]\.json$/.exec(filename);
      if (!match) continue;
      const cacheKey = match[1]!;
      let slots;
      try {
        slots = await journal.readSlots(`chapters/${cacheKey}`, legacyBodyValidator(cacheKey));
      } catch {
        issues.push(`이전 저장 파일 소유권을 확인하지 못했어요: chapters/${cacheKey}`);
        continue;
      }
      for (const entry of slots.entries) {
        const owner = legacyOwner(entry.value);
        if (owner?.workId === workId) {
          cacheKeys.push(cacheKey);
          chapterIds.add(owner.chapterId);
          paths.push(slotPath(`chapters/${cacheKey}`, entry.slot));
        }
      }
      for (const slot of slots.invalidSlots)
        issues.push(
          `손상된 이전 저장 슬롯을 보존했어요: ${slotPath(`chapters/${cacheKey}`, slot)}`,
        );
    }
  }
  let pointerCacheKey: string | undefined = prior?.pointerCacheKey;
  if (options.preferences) {
    try {
      const pointer = await createLastChapterRepository(options.preferences).read();
      if (pointer) {
        if (cacheKeys.includes(pointer)) pointerCacheKey = pointer;
        else {
          const slots = await journal.readSlots(
            `chapters/${pointer}`,
            legacyBodyValidator(pointer),
          );
          for (const entry of slots.entries) {
            const owner = legacyOwner(entry.value);
            if (owner?.workId === workId) {
              cacheKeys.push(pointer);
              chapterIds.add(owner.chapterId);
              paths.push(slotPath(`chapters/${pointer}`, entry.slot));
              pointerCacheKey = pointer;
            }
          }
          for (const slot of slots.invalidSlots)
            issues.push(
              `마지막 읽기 기록의 손상 슬롯을 보존했어요: ${slotPath(`chapters/${pointer}`, slot)}`,
            );
        }
      }
    } catch {
      issues.push('마지막 읽기 위치를 확인하지 못했어요.');
    }
  } else {
    issues.push('마지막 읽기 위치 저장소를 사용할 수 없어 정리 완료를 확인하지 못했어요.');
  }
  const removedChapterIds = [...chapterIds].filter((chapterId) => {
    try {
      chapterIdentity(chapterId);
      return chapterId.startsWith(`${workId}/`);
    } catch {
      return false;
    }
  });
  for (const chapterId of removedChapterIds) {
    const name = `positions/${await digest(chapterId)}`;
    await collect(name, legacyPositionRecord, (value) => value.position.chapterId === chapterId);
  }
  const inventory: WorkRemovalInventory = {
    workId,
    cacheKeys: unique(cacheKeys),
    paths: unique([...(prior?.paths ?? []), ...absorbed.flatMap((entry) => entry.paths), ...paths]),
    createdAt: prior?.createdAt ?? new Date().toISOString(),
    ...(pointerCacheKey ? { pointerCacheKey } : {}),
    ...(issues.length ? { issues: unique(issues) } : {}),
  };

  const removedIndex: Index = {
    ...current,
    workUpdates: current.workUpdates?.filter((entry) => entry.workId !== workId),
    workIds: current.workIds.filter((id) => id !== workId),
    versions: current.versions.filter((entry) => entry.workId !== workId),
    recent: current.recent.filter((entry) => entry.workId !== workId),
    chapterRemovalInventory: chapterRemovals.filter((entry) => entry.workId !== workId),
    legacyRemovedChapterIds: unique([
      ...mergeLegacyRemovedChapterIds(indexSlots.entries.map((entry) => entry.value)),
      ...removedChapterIds,
    ]),
    removalInventory: [...mergedPending.values()]
      .filter((entry) => entry.workId !== workId)
      .concat(inventory),
  };
  let removed = Boolean(prior);
  try {
    await journal.save('library/index', removedIndex, index);
    removed = true;
  } catch {
    if (!prior) {
      try {
        const reread = await journal.readSlots('library/index', index);
        const latest = reread.entries[0]?.value;
        removed = Boolean(
          latest &&
          !latest.workIds.includes(workId) &&
          latest.removalInventory?.some((entry) => entry.workId === workId),
        );
        if (!latest)
          return { removed: null, cleanupComplete: false, remainingInventory: ['library/index'] };
      } catch {
        return { removed: null, cleanupComplete: false, remainingInventory: ['library/index'] };
      }
    }
    return { removed, cleanupComplete: false, remainingInventory: ['library/index'] };
  }
  try {
    // 최초 삭제와 재시도 모두 새 inventory가 양 슬롯에 검증되기 전에는 파일을 지우지 않는다.
    await journal.save('library/index', removedIndex, index);
    await writeBoth(
      journal,
      'attempts/index',
      attempts.filter((entry) => !entry.token.chapterId.startsWith(`${workId}/`)),
      validateAttempts,
    );
    const batchValue =
      latestBatch?.value?.work.workId === workId ? null : (latestBatch?.value ?? null);
    await writeBoth(journal, 'batches/current', batchValue, validateBatch);
  } catch {
    return {
      removed,
      cleanupComplete: false,
      remainingInventory: ['library/index', 'attempts/index', 'batches/current'],
    };
  }

  const remaining: string[] = [],
    remove = files.remove;
  for (const path of inventory.paths) {
    if (/^(versions|reading)\//.test(path)) {
      if (!(await removeOwnedVersionPath(files, path, { workId }))) remaining.push(path);
      continue;
    }
    if (path.startsWith('positions/')) {
      if (!(await removeOwnedLegacyPositionPath(files, path, workId))) remaining.push(path);
      continue;
    }
    if (!remove) {
      remaining.push(path);
      continue;
    }
    try {
      await remove.call(files, path);
      if ((await files.read(path)) !== null) remaining.push(path);
    } catch {
      remaining.push(path);
    }
  }
  if (inventory.pointerCacheKey && options.preferences) {
    try {
      const cleared = await createLastChapterRepository(options.preferences).clearIfMatches?.(
        inventory.pointerCacheKey,
      );
      if (cleared === undefined) issues.push('마지막 읽기 위치를 조건부로 지울 수 없어요.');
    } catch {
      issues.push('마지막 읽기 위치를 지우지 못했어요.');
    }
  }
  const residualIssues = unique(issues);
  if (remaining.length || residualIssues.length) {
    const pending: WorkRemovalInventory = {
      ...inventory,
      paths: unique(remaining),
      issues: residualIssues,
    };
    try {
      await writeBoth(
        journal,
        'library/index',
        {
          ...removedIndex,
          removalInventory: [
            ...(removedIndex.removalInventory ?? []).filter((entry) => entry.workId !== workId),
            pending,
          ],
        },
        index,
      );
    } catch {
      // The earlier inventory remains durable; report the unresolved cleanup.
    }
    return {
      removed,
      cleanupComplete: false,
      remainingInventory: unique([...remaining, ...residualIssues]),
    };
  }
  const retired: Index = {
    ...removedIndex,
    removalInventory: (removedIndex.removalInventory ?? []).filter(
      (entry) => entry.workId !== workId,
    ),
  };
  try {
    await writeBoth(journal, 'library/index', retired, index);
  } catch {
    return {
      removed,
      cleanupComplete: false,
      remainingInventory: ['library/index.removalInventory'],
    };
  }
  return { removed, cleanupComplete: true, remainingInventory: [] };
}
async function removeChapterVersionData(
  files: PrivateFiles,
  journal: Journal,
  chapterId: string,
  activeBatchWorkId?: string,
  retryOnly = false,
): Promise<ChapterRemovalResult> {
  chapterIdentity(chapterId);
  const kept = (extra: Partial<ChapterRemovalResult> = {}): ChapterRemovalResult => ({
    removed: false,
    cleanupComplete: false,
    remainingInventory: [],
    versionIds: [],
    ...extra,
  });
  const unknown = (): ChapterRemovalResult =>
    kept({ removed: null, remainingInventory: ['library/index'] });
  const slots = await journal.readSlots('library/index', index);
  if (slots.found && !slots.entries.length) return unknown();
  const current: Index = slots.entries[0]?.value ?? { versions: [], workIds: [], recent: [] };
  const pending = mergeChapterRemovals(slots.entries.map((entry) => entry.value));
  const prior = pending.find((entry) => entry.chapterId === chapterId);
  const targets = retryOnly
    ? []
    : current.versions.filter((entry) => entry.chapterId === chapterId);
  if (!prior && !targets.length)
    return { removed: true, cleanupComplete: true, remainingInventory: [], versionIds: [] };
  const workId = chapterId.split('/')[0]!;
  // 작품 제거가 inventory를 넘겨받으면 그 정리가 먼저다.
  if (
    slots.entries.some((entry) =>
      entry.value.removalInventory?.some((item) => item.workId === workId),
    )
  )
    return kept();
  const batches = await journal.readSlots('batches/current', validateBatch);
  if (batches.found && !batches.entries.length)
    return kept({ remainingInventory: ['batches/current'] });
  if (activeBatchWorkId === workId) return kept({ blockedBy: 'batch' });
  const versionIds = unique([
    ...(prior?.versionIds ?? []),
    ...targets.map((entry) => entry.versionId),
  ]);
  // 복구 슬롯끼리 충돌해도 다른 회차의 살아 있는 ID를 삭제 의도로 해석하지 않는다.
  if (
    current.versions.some(
      (entry) =>
        versionIds.includes(entry.versionId) &&
        (entry.workId !== workId || entry.chapterId !== chapterId),
    )
  )
    return kept({ remainingInventory: ['library/index'] });
  const inventory: ChapterRemovalInventory = {
    workId,
    chapterId,
    versionIds,
    // 처음 삭제할 때만 대상을 늘린다. 재시도는 이후 생성된 UUID 저장본을 건드리지 않는다.
    paths: unique([
      ...(prior?.paths ?? []),
      ...targets.flatMap((entry) =>
        ['versions', 'reading'].flatMap((directory) =>
          [0, 1].map((slot) => slotPath(`${directory}/${entry.versionId}`, slot)),
        ),
      ),
    ]),
    createdAt: prior?.createdAt ?? new Date().toISOString(),
  };
  const dropped = new Set(versionIds);
  const next: Index = {
    ...current,
    versions: current.versions.filter((entry) => !dropped.has(entry.versionId)),
    recent: current.recent.filter((entry) => !dropped.has(entry.versionId)),
    legacyRemovedChapterIds: unique([
      ...mergeLegacyRemovedChapterIds(slots.entries.map((entry) => entry.value)),
      chapterId,
    ]),
    chapterRemovalInventory: pending
      .filter((entry) => entry.chapterId !== chapterId)
      .concat(inventory),
  };
  let removed = Boolean(prior);
  try {
    await journal.save('library/index', next, index);
    removed = true;
  } catch {
    try {
      const latest = (await journal.readSlots('library/index', index)).entries[0]?.value;
      if (!latest) return unknown();
      removed =
        !latest.versions.some((entry) => dropped.has(entry.versionId)) &&
        Boolean(latest.chapterRemovalInventory?.some((entry) => entry.chapterId === chapterId));
    } catch {
      return unknown();
    }
    return kept({
      removed,
      remainingInventory: ['library/index'],
      versionIds: removed ? versionIds : [],
    });
  }
  try {
    // 두 슬롯이 삭제 의도와 대상을 검증해 저장한 뒤에만 실제 파일을 지운다.
    await journal.save('library/index', next, index);
  } catch {
    return kept({ removed, remainingInventory: ['library/index'], versionIds });
  }
  const remaining: string[] = [];
  for (const path of inventory.paths)
    if (!(await removeOwnedVersionPath(files, path, inventory))) remaining.push(path);
  const settled: Index = {
    ...next,
    chapterRemovalInventory: pending
      .filter((entry) => entry.chapterId !== chapterId)
      .concat(remaining.length ? [{ ...inventory, paths: remaining }] : []),
  };
  try {
    await writeBoth(journal, 'library/index', settled, index);
  } catch {
    return {
      removed,
      cleanupComplete: false,
      remainingInventory: unique([...remaining, 'library/index.chapterRemovalInventory']),
      versionIds,
    };
  }
  return {
    removed,
    cleanupComplete: remaining.length === 0,
    remainingInventory: remaining,
    versionIds,
  };
}
export function createLibraryStore(
  files: PrivateFiles,
  options: { preferences?: PreferenceBackend } = {},
): LibraryStore {
  const journal = new Journal(files);
  const readIndex = async () =>
    (await journal.load('library/index', index))?.value ?? {
      versions: [],
      workIds: [],
      recent: [],
      removalInventory: [],
    };
  const indexForWrite = async (): Promise<Index> => {
    const slots = await journal.readSlots('library/index', index);
    const current = slots.entries[0]?.value ??
      (await journal.loadForWrite('library/index', index))?.value ?? {
        versions: [],
        workIds: [],
        recent: [],
      };
    return {
      ...current,
      chapterRemovalInventory: mergeChapterRemovals(slots.entries.map((entry) => entry.value)),
      legacyRemovedChapterIds: mergeLegacyRemovedChapterIds(
        slots.entries.map((entry) => entry.value),
      ),
    };
  };
  const readChapterRemovalInventory = async (): Promise<ChapterRemovalInventory[]> => {
    const slots = await journal.readSlots('library/index', index);
    if (slots.found && !slots.entries.length) throw new StorageError('corrupt');
    return mergeChapterRemovals(slots.entries.map((entry) => entry.value));
  };
  const readVersion = async (versionId: string) => {
    identifier(versionId);
    return (await journal.load(`versions/${versionId}`, completedTranslation))?.value ?? null;
  };
  const readRemovalInventory = async (): Promise<WorkRemovalInventory[]> => {
    const slots = await journal.readSlots('library/index', index);
    if (slots.found && !slots.entries.length) {
      await journal.load('library/index', index);
      throw new StorageError('corrupt');
    }
    const merged = new Map<string, WorkRemovalInventory>();
    for (const item of slots.entries.flatMap((entry) => entry.value.removalInventory ?? [])) {
      const previous = merged.get(item.workId);
      merged.set(
        item.workId,
        previous
          ? {
              ...previous,
              cacheKeys: unique([...previous.cacheKeys, ...item.cacheKeys]),
              paths: unique([...previous.paths, ...item.paths]),
              issues: unique([...(previous.issues ?? []), ...(item.issues ?? [])]),
              pointerCacheKey: item.pointerCacheKey ?? previous.pointerCacheKey,
            }
          : item,
      );
    }
    return [...merged.values()];
  };
  const readLegacyRemovedChapterIds = async () => {
    const slots = await journal.readSlots('library/index', index);
    if (slots.found && !slots.entries.length) throw new StorageError('corrupt');
    return mergeLegacyRemovedChapterIds(slots.entries.map((entry) => entry.value));
  };
  const commitVersion = async (value: CompletedTranslation) => {
    await completedTranslation(value);
    check(!(await readRemovalInventory()).some((entry) => entry.workId === value.source.workId));
    check(
      !(await readChapterRemovalInventory()).some((entry) =>
        entry.versionIds.includes(value.versionId),
      ),
    );
    const old =
      (await journal.loadForWrite(`versions/${value.versionId}`, completedTranslation))?.value ??
      null;
    if (old) check(JSON.stringify(old) === JSON.stringify(value));
    else await journal.save(`versions/${value.versionId}`, value, completedTranslation);
    const current = await indexForWrite();
    const existing = current.versions.find((v) => v.versionId === value.versionId);
    if (existing) {
      check(
        existing.chapterId === value.source.chapterId && existing.workId === value.source.workId,
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
  };
  const savePosition = async (value: ReadingPosition) => {
    await readingPosition(value);
    check(!(await readRemovalInventory()).some((entry) => entry.workId === value.workId));
    check(
      !(await readChapterRemovalInventory()).some((entry) =>
        entry.versionIds.includes(value.versionId),
      ),
    );
    const version = await readVersion(value.versionId);
    check(
      version !== null &&
        version.source.workId === value.workId &&
        version.source.chapterId === value.chapterId,
    );
    const block = version.blocks.find((b) => b.id === value.blockId);
    check(block !== undefined);
    await journal.save(`reading/${value.versionId}`, value, readingPosition);
    const current = await indexForWrite();
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
  };
  return {
    readWorkUpdates: () => serial(files, async () => (await readIndex()).workUpdates ?? []),
    listReadChapterIds: (workId) =>
      serial(files, async () => {
        identifier(workId);
        const current = await readIndex();
        const ids = new Set<string>();
        for (const entry of current.versions.filter((version) => version.workId === workId)) {
          const position = (await journal.load(`reading/${entry.versionId}`, readingPosition))
            ?.value;
          if (position?.workId === workId && position.chapterId === entry.chapterId)
            ids.add(position.chapterId);
        }
        return [...ids];
      }),
    saveWorkUpdate: (input, inputPages) => {
      const value = snapshot(input),
        pages = inputPages && snapshot(inputPages);
      return serial(files, async () => {
        validateWorkUpdate(value);
        const current = await indexForWrite();
        check(current.workIds.includes(value.workId));
        check(!(await readRemovalInventory()).some((entry) => entry.workId === value.workId));
        if (pages) {
          await validateWorkPages(pages);
          check(pages.length > 0 && pages.every((page) => page.workId === value.workId));
          await journal.save(`works/${value.workId}`, pages, validateWorkPages);
        }
        current.workUpdates = [
          ...(current.workUpdates ?? []).filter((entry) => entry.workId !== value.workId),
          value,
        ];
        await journal.save('library/index', current, index);
      });
    },
    readLegacyRemovedChapterIds: () => serial(files, readLegacyRemovedChapterIds),
    readChapterRemovalInventory: () => serial(files, readChapterRemovalInventory),
    retryChapterRemoval: (chapterId) =>
      serial(files, () => removeChapterVersionData(files, journal, chapterId, undefined, true)),
    readRemovalInventory: () => serial(files, readRemovalInventory),
    isWorkRemovalPending: (workId) =>
      serial(files, async () =>
        (await readRemovalInventory()).some((entry) => entry.workId === workId),
      ),
    listWorkIds: () => serial(files, async () => [...(await readIndex()).workIds]),
    readVersion: (versionId) => serial(files, () => readVersion(versionId)),
    readWork: (workId) =>
      serial(files, async () => {
        identifier(workId);
        check(!(await readRemovalInventory()).some((entry) => entry.workId === workId));
        return (await journal.load(`works/${workId}`, validateWorkPages))?.value ?? [];
      }),
    saveWorkPage: (input) => {
      const value = snapshot(input);
      return serial(files, async () => {
        await workPage(value);
        check(!(await readRemovalInventory()).some((entry) => entry.workId === value.workId));
        const previous =
          (await journal.load(`works/${value.workId}`, validateWorkPages))?.value ?? [];
        await journal.save(
          `works/${value.workId}`,
          [...previous.filter((p) => p.pageUrl !== value.pageUrl), value],
          validateWorkPages,
        );
        const current = await indexForWrite();
        if (!current.workIds.includes(value.workId)) current.workIds.push(value.workId);
        await journal.save('library/index', current, index);
      });
    },
    removeWork: (workId, runtime) =>
      serial(files, () =>
        removeWorkData(files, journal, options, workId, runtime?.activeBatchWorkId),
      ),
    removeChapterVersions: (chapterId, runtime) =>
      serial(files, () =>
        removeChapterVersionData(files, journal, chapterId, runtime?.activeBatchWorkId),
      ),
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
    listSavedChapterIds: (workId, chapterIds) => {
      const requested = [...new Set(chapterIds)];
      return serial(files, async () => {
        identifier(workId);
        for (const chapterId of requested) {
          chapterIdentity(chapterId);
          check(chapterId.startsWith(`${workId}/`));
        }
        const candidates = new Set(requested);
        const current = await readIndex();
        const saved = new Set<string>();
        for (const entry of current.versions) {
          if (!candidates.has(entry.chapterId)) continue;
          const value = await readVersion(entry.versionId);
          check(
            entry.workId === workId &&
              value !== null &&
              value.source.workId === workId &&
              value.source.chapterId === entry.chapterId,
          );
          saved.add(entry.chapterId);
        }
        return requested.filter((chapterId) => saved.has(chapterId));
      });
    },
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
      return serial(files, () => commitVersion(value));
    },
    savePosition: (input) => {
      const value = snapshot(input);
      return serial(files, () => savePosition(value));
    },
    importLegacyVersion: (input, inputPosition) => {
      const value = snapshot(input);
      const position = inputPosition ? snapshot(inputPosition) : undefined;
      return serial(files, async () => {
        await completedTranslation(value);
        if (position) {
          await readingPosition(position);
          check(
            position.versionId === value.versionId &&
              position.workId === value.source.workId &&
              position.chapterId === value.source.chapterId,
          );
        }
        // 시작 시 읽은 삭제 표식이 오래돼도 이 큐 안에서는 삭제와 가져오기가 끼어들지 않는다.
        if ((await readLegacyRemovedChapterIds()).includes(value.source.chapterId)) return false;
        const existed = (await readVersion(value.versionId)) !== null;
        await commitVersion(value);
        let restoredPosition = false;
        if (position && !(await journal.load(`reading/${value.versionId}`, readingPosition))) {
          await savePosition(position);
          restoredPosition = true;
        }
        return !existed || restoredPosition;
      });
    },
    readPosition: (versionId) =>
      serial(files, async () => {
        identifier(versionId);
        return (await journal.load(`reading/${versionId}`, readingPosition))?.value ?? null;
      }),
  };
}

export { index as validateLibraryIndex };
