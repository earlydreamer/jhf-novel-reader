import type { LibraryStore, RenewalSource, WorkPage, WorkUpdate } from '../contracts/reading';
import { normalizeWorkPageUrl } from '../source/work';
import {
  chapterCheckDate,
  DEFAULT_CHAPTER_UPDATE_DAYS,
  nextChapterCheckAt,
  validChapterUpdateDays,
} from './chapterUpdateSchedule';
import { nextChapterBadgeExpiry, recentChapterIds } from './chapterPublication';

export type ChapterUpdateStatus = WorkUpdate & { checking: boolean; error: string | null };
export type ChapterUpdatesSnapshot = {
  works: Readonly<Record<string, ChapterUpdateStatus>>;
  checkingAll: boolean;
  message: string | null;
  notice?: { id: number; text: string };
};

/** 화면 탐색과 독립된 단일 대기열. 서버에는 목차만 요청한다. */
export function createChapterUpdates(deps: {
  library: LibraryStore;
  source: RenewalSource;
  now?: () => number;
  changed(state: ChapterUpdatesSnapshot): void;
  updated(workId: string, pages: readonly WorkPage[]): void;
  write<T>(workId: string, action: () => Promise<T>): Promise<T>;
  removed(workId: string): boolean;
}) {
  const now = deps.now ?? Date.now;
  let state: ChapterUpdatesSnapshot = { works: {}, checkingAll: false, message: null };
  let active = false,
    disposed = false,
    ready = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  let noticeSequence = 0;
  let queue: Promise<void> = Promise.resolve();
  let allJob: Promise<void> | null = null;
  let scheduleGeneration = 0;
  let intervalDays = DEFAULT_CHAPTER_UPDATE_DAYS;
  let libraryFailureDate: string | null = null;
  const jobs = new Map<string, { control: AbortController; promise: Promise<void> }>();
  const publicationPages = new Map<string, readonly WorkPage[]>();
  const readChapters = new Map<string, Set<string>>();
  const badgeIds = (workId: string, pages = publicationPages.get(workId) ?? []) =>
    recentChapterIds(pages, now()).filter((id) => !readChapters.get(workId)?.has(id));
  async function loadReadChapters(workId: string) {
    const saved = (await deps.library.listReadChapterIds?.(workId)) ?? [];
    if (disposed || deps.removed(workId)) return;
    readChapters.set(workId, new Set([...(readChapters.get(workId) ?? []), ...saved]));
  }
  const notify = (patch: Partial<ChapterUpdatesSnapshot>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    deps.changed(state);
  };
  function resultNotice(text: string) {
    notify({ notice: { id: ++noticeSequence, text } });
  }
  function scheduleBadges() {
    clearTimeout(badgeTimer);
    if (!active || disposed) return;
    const expiry = Math.min(
      Infinity,
      ...[...publicationPages.values()].map((pages) => nextChapterBadgeExpiry(pages, now())),
    );
    if (Number.isFinite(expiry))
      badgeTimer = setTimeout(refreshBadges, Math.max(1, expiry - now()));
  }
  function refreshBadges() {
    for (const value of Object.values(state.works)) {
      const ids = badgeIds(value.workId);
      if (ids.join('\n') !== value.newChapterIds.join('\n')) publishWork(value);
    }
    scheduleBadges();
  }
  function publishWork(value: ChapterUpdateStatus) {
    if (deps.removed(value.workId)) return;
    notify({
      works: {
        ...state.works,
        [value.workId]: {
          ...value,
          newChapterIds: badgeIds(value.workId),
        },
      },
    });
  }
  const dueAt = (value?: WorkUpdate) =>
    value ? nextChapterCheckAt(value.lastCheckDate, intervalDays) : 0;
  async function schedule() {
    const generation = ++scheduleGeneration;
    clearTimeout(timer);
    if (!ready || !active || disposed) return;
    try {
      const ids = (await deps.library.listWorkIds()).filter((id) => !deps.removed(id));
      if (!active || disposed || generation !== scheduleGeneration || !ids.length) return;
      const next = Math.max(
        Math.min(...ids.map((id) => dueAt(state.works[id]))),
        libraryFailureDate ? nextChapterCheckAt(libraryFailureDate, intervalDays) : 0,
      );
      // 실행 중인 확인이 끝나면 다시 예약한다. 화면 진입에서는 호출하지 않는다.
      if (jobs.size || allJob) return;
      timer = setTimeout(
        () => {
          void checkAll(false);
        },
        // 긴 주기도 setTimeout의 32비트 정수 상한을 넘지 않게 예약한다.
        Math.min(2_147_483_647, Math.max(1, next - now())),
      );
    } catch {
      if (!disposed && active && generation === scheduleGeneration) {
        libraryFailureDate = chapterCheckDate(now());
        notify({ message: '검사할 서재 목록을 읽지 못했어요. 수동으로 다시 검사할 수 있어요.' });
        timer = setTimeout(
          () => {
            void schedule();
          },
          Math.min(
            2_147_483_647,
            Math.max(1, nextChapterCheckAt(libraryFailureDate, intervalDays) - now()),
          ),
        );
      }
    }
  }
  async function checkWork(workId: string): Promise<void> {
    const existing = jobs.get(workId);
    if (existing) return existing.promise;
    if (!ready || !active || disposed || deps.removed(workId)) return;
    const control = new AbortController();
    const current = () => !disposed && active && !control.signal.aborted && !deps.removed(workId);
    const job = queue.then(async () => {
      if (!current()) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const previous = state.works[workId];
      let baseline: WorkUpdate = {
        workId,
        lastCheckDate: chapterCheckDate(now()),
        attemptedAt: now(),
        checkedAt: previous?.checkedAt ?? null,
        knownChapterIds: previous?.knownChapterIds ?? null,
        newChapterIds: previous?.newChapterIds ?? [],
        failed: true,
      };
      publishWork({ ...baseline, checking: true, error: null });
      try {
        const cached = await deps.library.readWork(workId);
        if (!current()) return;
        if (!cached.length) throw new Error('missing cached toc');
        await loadReadChapters(workId);
        if (!current()) return;
        publicationPages.set(workId, cached);
        // 신규 여부는 최초 등록 시각, 표시 여부는 별도의 읽기 기록으로 계산한다.
        if (baseline.knownChapterIds === null) {
          baseline.knownChapterIds = [
            ...new Set(cached.flatMap((page) => page.chapters.map((chapter) => chapter.chapterId))),
          ];
        }
        // 페이지 저장 중 중단되어도 이전 비교 기준은 먼저 보존한다.
        await deps.write(workId, () => deps.library.saveWorkUpdate!(baseline));
        if (!current()) return;
        publishWork({ ...baseline, checking: true, error: null });
        timeout = setTimeout(() => control.abort(), 120_000);
        const pages: WorkPage[] = [],
          urls = new Set<string>(),
          ids = new Set<string>();
        let url: string | null = cached[0]!.canonicalUrl;
        let ordinal = 0;
        while (url) {
          if (!current()) throw new Error('cancelled');
          const normalized = normalizeWorkPageUrl(url);
          if (urls.has(normalized) || pages.length >= 1000) throw new Error('invalid toc');
          urls.add(normalized);
          const page = await deps.source.getWorkPage(normalized, control.signal);
          if (!current()) throw new Error('cancelled');
          if (
            page.workId !== workId ||
            page.canonicalUrl !== cached[0]!.canonicalUrl ||
            page.pageUrl !== normalized ||
            !page.chapters.length
          )
            throw new Error('invalid toc');
          for (const chapter of page.chapters) {
            if (
              chapter.workId !== workId ||
              ids.has(chapter.chapterId) ||
              chapter.ordinal !== ordinal + 1
            )
              throw new Error('invalid chapters');
            ids.add(chapter.chapterId);
            ordinal = chapter.ordinal;
          }
          pages.push(page);
          url = page.nextPageUrl;
          if (url) {
            const next = new URL(normalizeWorkPageUrl(url));
            if (
              next.pathname !== new URL(normalized).pathname ||
              Number(next.searchParams.get('p') || 1) <=
                Number(new URL(normalized).searchParams.get('p') || 1)
            )
              throw new Error('invalid next page');
          }
        }
        const result: WorkUpdate = {
          workId,
          lastCheckDate: chapterCheckDate(now()),
          attemptedAt: baseline.attemptedAt,
          checkedAt: now(),
          knownChapterIds: [...ids],
          newChapterIds: badgeIds(workId, pages),
          failed: false,
        };
        if (!current()) return;
        await deps.write(workId, () => deps.library.saveWorkUpdate!(result, pages));
        // 저장을 시작한 뒤 앱이 숨겨져도 이미 커밋한 결과와 메모리 상태는 맞춘다.
        if (disposed || deps.removed(workId)) return;
        publicationPages.set(workId, pages);
        deps.updated(workId, pages);
        publishWork({ ...result, checking: false, error: null });
        if (!allJob) resultNotice('회차 목록을 갱신했어요.');
      } catch {
        if (!disposed && !deps.removed(workId)) {
          baseline = {
            ...baseline,
            lastCheckDate: chapterCheckDate(now()),
          };
          // 자정을 넘긴 실패도 처리 날짜를 보존한다. 실패 재시도는 다음 N일 뒤다.
          try {
            await deps.write(workId, () => deps.library.saveWorkUpdate!(baseline));
          } catch {
            /* 화면에는 실패를 유지한다. */
          }
          publishWork({
            ...baseline,
            checking: false,
            error: control.signal.aborted
              ? '확인을 중단했어요. 다시 확인할 수 있어요.'
              : '확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
          });
          if (!allJob) resultNotice(state.works[workId]!.error!);
        }
      } finally {
        clearTimeout(timeout);
        const value = state.works[workId];
        if (value?.checking) publishWork({ ...value, checking: false });
      }
    });
    queue = job.catch(() => {});
    const promise = job.finally(() => {
      jobs.delete(workId);
      scheduleBadges();
      void schedule();
    });
    jobs.set(workId, { control, promise });
    return promise;
  }
  function checkAll(force = true): Promise<void> {
    if (allJob) return allJob;
    if (!ready || !active || disposed) return Promise.resolve();
    const job = (async () => {
      notify({ checkingAll: true, message: null });
      let checked = 0,
        failed = 0;
      try {
        if (
          !force &&
          libraryFailureDate &&
          nextChapterCheckAt(libraryFailureDate, intervalDays) > now()
        )
          return;
        const ids = await deps.library.listWorkIds();
        libraryFailureDate = null;
        for (const id of ids) {
          if (!active || disposed) break;
          if (deps.removed(id) || (!force && dueAt(state.works[id]) > now())) continue;
          await checkWork(id);
          checked++;
          if (state.works[id]?.error) failed++;
        }
        if (active && checked) {
          const message = failed
            ? `${checked}개 작품 중 ${failed}개를 확인하지 못했어요. 나머지는 갱신했어요.`
            : '회차 목록을 갱신했어요.';
          notify({ message });
          resultNotice(message);
        }
      } catch {
        libraryFailureDate = chapterCheckDate(now());
        const message = '서재를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.';
        notify({ message });
        resultNotice(message);
      } finally {
        notify({ checkingAll: false });
      }
    })();
    allJob = job.finally(() => {
      allJob = null;
      void schedule();
    });
    return allJob;
  }
  return {
    async initialize() {
      if (ready || disposed) return;
      try {
        const records = await deps.library.readWorkUpdates!();
        for (const value of records) {
          try {
            const pages = await deps.library.readWork(value.workId);
            await loadReadChapters(value.workId);
            publicationPages.set(value.workId, pages);
          } catch {
            // 캐시의 등록 시각을 읽지 못하면 이전의 누적 배지를 신규로 취급하지 않는다.
          }
        }
        if (disposed) return;
        notify({
          works: Object.fromEntries(
            records.map((value) => [
              value.workId,
              {
                ...value,
                newChapterIds: badgeIds(value.workId),
                checking: false,
                error: value.failed ? '지난 확인을 마치지 못했어요. 다시 확인할 수 있어요.' : null,
              },
            ]),
          ),
        });
        ready = true;
      } catch {
        notify({ message: '새 회차 확인 기록을 읽지 못했어요. 앱을 다시 열어 주세요.' });
      }
    },
    setForeground(value: boolean) {
      active = value;
      clearTimeout(timer);
      clearTimeout(badgeTimer);
      if (!active) for (const { control } of jobs.values()) control.abort();
      else {
        refreshBadges();
        void schedule();
      }
    },
    setIntervalDays(days: number) {
      if (!validChapterUpdateDays(days)) return;
      intervalDays = days;
      void schedule();
    },
    checkWork,
    checkAll,
    registered() {
      void schedule();
    },
    cancel(workId: string) {
      jobs.get(workId)?.control.abort();
      const previous = state.works[workId];
      if (previous)
        notify({ works: { ...state.works, [workId]: { ...previous, checking: false } } });
    },
    remove(workId: string) {
      jobs.get(workId)?.control.abort();
      const works = { ...state.works };
      delete works[workId];
      publicationPages.delete(workId);
      readChapters.delete(workId);
      notify({ works });
      scheduleBadges();
    },
    readRecorded(workId: string, chapterId: string) {
      if (disposed || deps.removed(workId)) return;
      const ids = readChapters.get(workId) ?? new Set<string>();
      ids.add(chapterId);
      readChapters.set(workId, ids);
      const value = state.works[workId];
      if (value) publishWork(value);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(badgeTimer);
      for (const { control } of jobs.values()) control.abort();
    },
  };
}
