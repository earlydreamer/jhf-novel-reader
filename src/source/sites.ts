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
  normalizeSourceInput as normalizeNarouInput,
  normalizeWorkPageUrl as normalizeNarouWorkPageUrl,
  parseWorkPage as parseNarouWorkPage,
} from './work';

/** 사이트별 URL 정규화·작품과 회차 식별·목차와 본문 추출의 경계. */
export interface SourceSite {
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
  parseWorkPage(html: string, pageUrl: string): WorkPage;
  /** 요청 전에 회차 참조와 주소의 일치를 확인하고 정규 주소를 돌려준다. */
  chapterUrl(ref: ChapterRef): string;
  parseChapter(html: string, canonicalUrl: string): Promise<Chapter>;
}

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

export const SOURCE_SITES: readonly SourceSite[] = [narou, kakuyomu];

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
  async function getHtml(url: string, signal: AbortSignal): Promise<string> {
    checkCancelled(signal);
    const response = await transport.get(url, signal);
    checkCancelled(signal);
    if (response.status !== 200)
      throw new ReaderError('source_access', 'received', response.status);
    const contentType =
      Object.entries(response.headers).find(
        ([name]) => name.toLowerCase() === 'content-type',
      )?.[1] || '';
    if (
      response.url !== url ||
      !/^text\/html(?:\s*;|\s*$)/i.test(contentType) ||
      typeof response.data !== 'string'
    )
      throw access();
    return response.data;
  }
  return {
    async getWorkPage(input, signal): Promise<WorkPage> {
      const site = siteForUrl(input);
      const { workUrl } = site.normalizeSourceInput(input);
      const html = await getHtml(workUrl, signal);
      const page = site.parseWorkPage(html, workUrl);
      checkCancelled(signal);
      return page;
    },
    async getChapter(ref, signal): Promise<SourceSnapshot> {
      const site = siteForUrl(ref.canonicalUrl);
      const canonicalUrl = site.chapterUrl(ref);
      const rawHtml = await getHtml(canonicalUrl, signal);
      const fetchedAt = new Date().toISOString();
      const chapter = await site.parseChapter(rawHtml, canonicalUrl);
      checkCancelled(signal);
      return { ...chapter, captureKind: 'fetched', fetchedAt, rawHtml };
    },
  };
}
