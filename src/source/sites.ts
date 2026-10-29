import { ReaderError, type Chapter, type SourceTransport } from '../contracts';
import type { ChapterRef, RenewalSource, SourceSnapshot, WorkPage } from '../contracts/reading';
import {
  KAKUYOMU_CHAPTER_ID,
  KAKUYOMU_WORK_ID,
  kakuyomuIdentity,
  kakuyomuWorkUrl,
  normalizeKakuyomuInput,
  normalizeKakuyomuUrl,
  parseKakuyomuChapter,
  parseKakuyomuWorkPage,
} from './kakuyomu';
import { normalizeSourceUrl, parseChapter, sourceIdentity } from './parse';
import {
  PIXIV_HOST,
  PIXIV_MIN_INTERVAL_MS,
  PIXIV_WORK_ID,
  isPixivChapterId,
  normalizePixivUrl,
  pixivApi,
  pixivChapter,
  pixivSeriesPage,
  pixivSeriesUrl,
  pixivShowUrl,
  pixivSinglePage,
  pixivTarget,
  readPixivNovel,
  readPixivSeries,
} from './pixiv';
import {
  normalizeSourceInput as normalizeNarouInput,
  normalizeWorkPageUrl as normalizeNarouWorkPageUrl,
  parseWorkPage as parseNarouWorkPage,
} from './work';

/** 원문 전송의 호스트별 최소 간격(ms). 공통 간격보다 길게 둘 사이트만 적는다. */
export const SOURCE_HOST_MIN_INTERVAL_MS: Readonly<Record<string, number>> = {
  [PIXIV_HOST]: PIXIV_MIN_INTERVAL_MS,
};

/** 직접 불러오는 사이트가 쓰는 조회. 검증 규칙은 HTML 조회와 같고 JSON 응답만 받는다. */
export interface SourceFetch {
  json(url: string, signal: AbortSignal): Promise<unknown>;
}

/** 사이트별 URL 정규화·작품과 회차 식별·목차와 본문 추출의 경계. */
interface SiteBase {
  ownsUrl(url: URL): boolean;
  ownsWorkId(workId: string): boolean;
  /** 저장 기록의 회차 ID 형식. 파일 경로에 넣지 않는다. */
  ownsChapterId(chapterId: string): boolean;
  normalizeSourceInput(input: string): { workUrl: string; chapterUrl?: string };
  normalizeWorkPageUrl(input: string): string;
  workUrl(workId: string): string;
  /** 정규화한 작품·회차 주소의 작품 ID. */
  workIdOf(canonicalUrl: string): string;
  /** 저장한 목차 페이지 주소가 이 작품의 정규 주소인지 확인한다. */
  isWorkPageUrl(value: string, workId: string): boolean;
  /** 요청 전에 회차 참조와 주소의 일치를 확인하고 정규 주소를 돌려준다. */
  chapterUrl(ref: ChapterRef): string;
  /** 정규 주소에 쿼리가 들어가는 사이트만 둔다. 이미 정규화된 주소인지 확인한다. */
  isQueryCanonicalUrl?(value: string): boolean;
}
/** 정규 주소의 HTML 한 장에서 목차와 본문을 읽는 사이트. */
interface HtmlSite extends SiteBase {
  parseWorkPage(html: string, pageUrl: string): WorkPage;
  parseChapter(html: string, canonicalUrl: string): Promise<Chapter>;
}
/** 정규 주소와 조회 주소가 달라 필요한 요청을 직접 정하는 사이트. */
interface LoadedSite extends SiteBase {
  loadWorkPage(input: string, fetch: SourceFetch, signal: AbortSignal): Promise<WorkPage>;
  loadChapter(
    ref: ChapterRef,
    canonicalUrl: string,
    fetch: SourceFetch,
    signal: AbortSignal,
  ): Promise<{ chapter: Chapter; raw: string }>;
}
export type SourceSite = HtmlSite | LoadedSite;

const access = () => new ReaderError('source_access');
const NAROU_WORK_ID = /^n[0-9]{4}[a-z]{1,2}$/;
const NAROU_CHAPTER_ID = /^(n[0-9]{4}[a-z]{1,2})\/(short|[1-9][0-9]*)$/;

const narou: SourceSite = {
  ownsUrl: (url) => url.hostname === 'ncode.syosetu.com',
  ownsWorkId: (workId) => NAROU_WORK_ID.test(workId),
  ownsChapterId(chapterId) {
    const match = NAROU_CHAPTER_ID.exec(chapterId);
    return match !== null && (match[2] === 'short' || Number.isSafeInteger(Number(match[2])));
  },
  normalizeSourceInput: normalizeNarouInput,
  normalizeWorkPageUrl: normalizeNarouWorkPageUrl,
  workUrl(workId) {
    if (!NAROU_WORK_ID.test(workId)) throw access();
    return `https://ncode.syosetu.com/${workId}/`;
  },
  workIdOf: (canonicalUrl) => sourceIdentity(canonicalUrl).workId,
  isWorkPageUrl(value, workId) {
    const prefix = `https://ncode.syosetu.com/${workId}/`;
    if (value === prefix) return true;
    if (!value.startsWith(prefix + '?p=')) return false;
    const page = value.slice((prefix + '?p=').length);
    return /^[1-9][0-9]*$/.test(page) && Number.isSafeInteger(Number(page));
  },
  parseWorkPage: parseNarouWorkPage,
  chapterUrl(ref) {
    const canonicalUrl = normalizeSourceUrl(ref.canonicalUrl);
    const { workId, chapterId, episode } = sourceIdentity(canonicalUrl);
    if (
      ref.workId !== workId ||
      ref.chapterId !== chapterId ||
      ref.ordinal !== (episode ? Number(episode) : 1)
    )
      throw access();
    return canonicalUrl;
  },
  parseChapter,
};

const kakuyomu: SourceSite = {
  ownsUrl: (url) => url.hostname === 'kakuyomu.jp',
  ownsWorkId: (workId) => KAKUYOMU_WORK_ID.test(workId),
  ownsChapterId: (chapterId) => KAKUYOMU_CHAPTER_ID.test(chapterId),
  normalizeSourceInput: normalizeKakuyomuInput,
  normalizeWorkPageUrl(input) {
    const canonicalUrl = normalizeKakuyomuUrl(input);
    if (kakuyomuIdentity(canonicalUrl).episode) throw access();
    return canonicalUrl;
  },
  workUrl: kakuyomuWorkUrl,
  workIdOf: (canonicalUrl) => kakuyomuIdentity(canonicalUrl).workId,
  isWorkPageUrl: (value, workId) =>
    KAKUYOMU_WORK_ID.test(workId) && value === kakuyomuWorkUrl(workId),
  parseWorkPage: parseKakuyomuWorkPage,
  chapterUrl(ref) {
    const canonicalUrl = normalizeKakuyomuUrl(ref.canonicalUrl);
    const { workId, chapterId, episode } = kakuyomuIdentity(canonicalUrl);
    // 카쿠요무 회차 ID는 순번이 아니므로 순번은 목차 범위만 확인한다.
    if (
      !episode ||
      ref.workId !== workId ||
      ref.chapterId !== chapterId ||
      !Number.isSafeInteger(ref.ordinal) ||
      ref.ordinal < 1
    )
      throw access();
    return canonicalUrl;
  },
  parseChapter: parseKakuyomuChapter,
};

function pixivWorkUrl(workId: string): string {
  if (!PIXIV_WORK_ID.test(workId)) throw access();
  const id = workId.slice('pixiv-s'.length);
  return workId.startsWith('pixiv-s') ? pixivSeriesUrl(id) : pixivShowUrl(id);
}

const pixiv: LoadedSite = {
  ownsUrl: (url) => url.hostname === PIXIV_HOST || url.hostname === 'pixiv.net',
  ownsWorkId: (workId) => PIXIV_WORK_ID.test(workId),
  ownsChapterId: isPixivChapterId,
  normalizeSourceInput(input) {
    const canonicalUrl = normalizePixivUrl(input);
    // show.php만으로는 단독 작품인지 시리즈 회차인지 알 수 없어 회차 선택으로 보존한다.
    return pixivTarget(canonicalUrl).kind === 'series'
      ? { workUrl: canonicalUrl }
      : { workUrl: canonicalUrl, chapterUrl: canonicalUrl };
  },
  normalizeWorkPageUrl: normalizePixivUrl,
  workUrl: pixivWorkUrl,
  workIdOf(canonicalUrl) {
    // show.php의 작품 ID는 조회해야 알 수 있다. 던지면 sourceWorkId가 null이 된다.
    const target = pixivTarget(canonicalUrl);
    if (target.kind !== 'series') throw access();
    return `pixiv-s${target.id}`;
  },
  isWorkPageUrl: (value, workId) => PIXIV_WORK_ID.test(workId) && value === pixivWorkUrl(workId),
  isQueryCanonicalUrl: (value) => normalizePixivUrl(value) === value,
  chapterUrl(ref) {
    if (
      !isPixivChapterId(ref.chapterId) ||
      !ref.chapterId.startsWith(`${ref.workId}/`) ||
      !Number.isSafeInteger(ref.ordinal) ||
      ref.ordinal < 1
    )
      throw access();
    const canonicalUrl = normalizePixivUrl(ref.canonicalUrl);
    if (canonicalUrl !== pixivShowUrl(ref.chapterId.slice(ref.workId.length + 1))) throw access();
    return canonicalUrl;
  },
  async loadWorkPage(input, fetch, signal) {
    const target = pixivTarget(normalizePixivUrl(input));
    let seriesId = target.id;
    if (target.kind === 'novel') {
      const novel = readPixivNovel(await fetch.json(pixivApi.novel(target.id), signal));
      if (novel.id !== target.id) throw new ReaderError('source_parse', 'received');
      if (novel.seriesId === null) return pixivSinglePage(novel);
      seriesId = novel.seriesId;
    }
    const meta = await fetch.json(pixivApi.series(seriesId), signal);
    const titles = await fetch.json(pixivApi.seriesTitles(seriesId), signal);
    const series = readPixivSeries(meta, titles);
    if (series.id !== seriesId) throw new ReaderError('source_parse', 'received');
    return pixivSeriesPage(series);
  },
  async loadChapter(ref, canonicalUrl, fetch, signal) {
    const target = pixivTarget(canonicalUrl);
    const json = await fetch.json(pixivApi.novel(target.id), signal);
    const chapter = await pixivChapter(readPixivNovel(json), ref);
    return { chapter, raw: JSON.stringify(json) };
  },
};

export const SOURCE_SITES: readonly SourceSite[] = [narou, kakuyomu, pixiv];

function siteForUrl(input: string): SourceSite {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw access();
  }
  const site = SOURCE_SITES.find((candidate) => candidate.ownsUrl(url));
  if (!site) throw access();
  return site;
}

export function siteForWorkId(workId: string): SourceSite | null {
  return SOURCE_SITES.find((site) => site.ownsWorkId(workId)) ?? null;
}

export function isSourceChapterId(chapterId: string): boolean {
  return SOURCE_SITES.some((site) => site.ownsChapterId(chapterId));
}

/** 쿼리가 정규 주소의 일부인 사이트만 판단한다. 다른 사이트의 쿼리 주소(나로우 목차 ?p=)는 정규 주소가 아니다. */
export function isCanonicalSourceUrl(value: string): boolean {
  try {
    return siteForUrl(value).isQueryCanonicalUrl?.(value) ?? false;
  } catch {
    return false;
  }
}

export function isSourceWorkPageUrl(value: string, workId: string): boolean {
  return siteForWorkId(workId)?.isWorkPageUrl(value, workId) ?? false;
}

export function sourceWorkUrl(workId: string): string {
  const site = siteForWorkId(workId);
  if (!site) throw access();
  return site.workUrl(workId);
}

/** Opening an episode retains its selection, while fetching metadata at the work URL. */
export function normalizeSourceInput(input: string): { workUrl: string; chapterUrl?: string } {
  return siteForUrl(input).normalizeSourceInput(input);
}

export function normalizeWorkPageUrl(input: string): string {
  return siteForUrl(input).normalizeWorkPageUrl(input);
}

/** 지원하지 않는 주소면 null. 작품 ID를 알 수 있는 정규화 이전 입력도 받는다. */
export function sourceWorkId(input: string): string | null {
  try {
    const site = siteForUrl(input);
    const { workUrl } = site.normalizeSourceInput(input);
    return site.workIdOf(workUrl);
  } catch {
    return null;
  }
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ReaderError('cancelled');
}

export function createRenewalSource(transport: SourceTransport): RenewalSource {
  async function get(url: string, type: RegExp, signal: AbortSignal) {
    checkCancelled(signal);
    const response = await transport.get(url, signal);
    checkCancelled(signal);
    if (response.status !== 200)
      throw new ReaderError('source_access', 'received', response.status);
    const contentType =
      Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1] || '';
    if (response.url !== url || !type.test(contentType)) throw access();
    return response.data;
  }
  async function getHtml(url: string, signal: AbortSignal): Promise<string> {
    const data = await get(url, /^text\/html(?:\s*;|\s*$)/i, signal);
    if (typeof data !== 'string') throw access();
    return data;
  }
  const fetch: SourceFetch = {
    async json(url, signal) {
      const data = await get(url, /^application\/json(?:\s*;|\s*$)/i, signal);
      // Capacitor Android는 JSON 응답을 responseType과 상관없이 객체로 돌려준다.
      if (typeof data === 'object' && data !== null) return data;
      if (typeof data !== 'string') throw access();
      try {
        return JSON.parse(data) as unknown;
      } catch {
        throw new ReaderError('source_parse', 'received');
      }
    },
  };
  return {
    async getWorkPage(input, signal): Promise<WorkPage> {
      const site = siteForUrl(input);
      if ('loadWorkPage' in site) {
        const page = await site.loadWorkPage(input, fetch, signal);
        checkCancelled(signal);
        return page;
      }
      const { workUrl } = site.normalizeSourceInput(input);
      const html = await getHtml(workUrl, signal);
      const page = site.parseWorkPage(html, workUrl);
      checkCancelled(signal);
      return page;
    },
    async getChapter(ref, signal): Promise<SourceSnapshot> {
      const site = siteForUrl(ref.canonicalUrl);
      const canonicalUrl = site.chapterUrl(ref);
      if ('loadChapter' in site) {
        const { chapter, raw } = await site.loadChapter(ref, canonicalUrl, fetch, signal);
        const fetchedAt = new Date().toISOString();
        checkCancelled(signal);
        // 원문 보관 필드 이름은 HTML 시절 그대로 두고, 받은 JSON을 그대로 담는다.
        return { ...chapter, captureKind: 'fetched', fetchedAt, rawHtml: raw };
      }
      const rawHtml = await getHtml(canonicalUrl, signal);
      const fetchedAt = new Date().toISOString();
      const chapter = await site.parseChapter(rawHtml, canonicalUrl);
      checkCancelled(signal);
      return { ...chapter, captureKind: 'fetched', fetchedAt, rawHtml };
    },
  };
}
