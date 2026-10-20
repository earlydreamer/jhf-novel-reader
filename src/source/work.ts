import { ReaderError, type SourceTransport } from '../contracts';
import type { ChapterRef, RenewalSource, SourceSnapshot, WorkPage } from '../contracts/reading';
import {
  BODY,
  TITLE,
  documentFragment,
  normalizeSourceUrl,
  parseChapter,
  plain,
  safeChapterLink,
  sourceIdentity,
} from './parse';

const access = () => new ReaderError('source_access');
const parseError = () => new ReaderError('source_parse', 'received');

/** Work-page queries are exclusively the site's positive TOC page number. */
export function normalizeWorkPageUrl(input: string): string {
  try {
    const value = input.trim();
    if (
      /[\\\u0000-\u0020]/.test(value) ||
      value.split(/[?#]/, 1)[0]!.includes('%') ||
      /\/\.{1,2}(?:\/|$)/.test(value)
    )
      throw access();
    const url = new URL(value);
    if (url.search && !/^\?p=[1-9]\d*$/.test(url.search)) throw access();
    if (url.search && !Number.isSafeInteger(Number(url.searchParams.get('p')))) throw access();
    const canonicalUrl = normalizeSourceUrl(`${url.origin}${url.pathname}`);
    // Inspect credentials and explicit ports before rebuilding the URL.
    if (
      url.username ||
      url.password ||
      url.port ||
      url.protocol !== 'https:' ||
      sourceIdentity(canonicalUrl).episode
    )
      throw access();
    return `${canonicalUrl}${url.search}`;
  } catch {
    throw access();
  }
}

/** Opening an episode retains its selection, while fetching metadata at the work URL. */
export function normalizeSourceInput(input: string): { workUrl: string; chapterUrl?: string } {
  try {
    const chapterUrl = normalizeSourceUrl(input);
    const { workId, episode } = sourceIdentity(chapterUrl);
    if (episode) return { workUrl: `https://ncode.syosetu.com/${workId}/`, chapterUrl };
    return { workUrl: chapterUrl };
  } catch {
    return { workUrl: normalizeWorkPageUrl(input) };
  }
}

function nextPage(root: DocumentFragment, pageUrl: string): string | null {
  const currentPage = Number(new URL(pageUrl).searchParams.get('p') || 1);
  const controls = Array.from(
    root.querySelectorAll('.c-pager__item--next, .novelview_pager-next, a[rel="next"]'),
  );
  const next = controls.find((control) => control.tagName === 'A') ?? controls[0];
  if (!next) return null;
  // 마지막 페이지에서 사이트가 비활성 '다음'을 href 없는 span으로 표시한다.
  if (next.tagName === 'SPAN' && !next.hasAttribute('href')) return null;
  try {
    const href = next.getAttribute('href');
    if (!href || /[\\%\u0000-\u0020]/.test(href)) throw parseError();
    const target = normalizeWorkPageUrl(new URL(href, pageUrl).href);
    if (
      sourceIdentity(target).workId !== sourceIdentity(pageUrl).workId ||
      Number(new URL(target).searchParams.get('p') || 1) <= currentPage
    )
      throw parseError();
    return target;
  } catch {
    throw parseError();
  }
}

/** 목차의 본문 시각은 최초 등록일이다. span의 title에 있는 개정일은 사용하지 않는다. */
function publishedAt(anchor: Element): string | undefined {
  const row = anchor.closest('.p-eplist__sublist, .novel_sublist2');
  const element = row?.querySelector('.p-eplist__update, .long_update');
  if (!element) return;
  const dateText = Array.from(element.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .trim();
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(dateText);
  if (!match) return;
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}`;
  const timestamp = Date.parse(`${local}+09:00`);
  if (!Number.isFinite(timestamp)) return;
  // Date.parse가 2월 30일 등을 다음 달로 보정한 값도 거부한다.
  if (new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 19) !== local) return;
  return new Date(timestamp).toISOString();
}

export function parseWorkPage(html: string, input: string): WorkPage {
  const pageUrl = normalizeWorkPageUrl(input);
  const canonicalUrl = pageUrl.split('?', 1)[0]!;
  const { workId } = sourceIdentity(canonicalUrl);
  const root = documentFragment(html);
  const title = plain(root.querySelector(TITLE));
  if (!title) throw parseError();
  const chapters: ChapterRef[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(
    root.querySelectorAll('.p-eplist__sublist a, .novel_sublist2 .subtitle a'),
  )) {
    const target = safeChapterLink(anchor.getAttribute('href'), canonicalUrl);
    const name = plain(anchor);
    if (!target || !name || seen.has(target)) continue;
    seen.add(target);
    const { chapterId, episode } = sourceIdentity(target);
    const publication = publishedAt(anchor);
    chapters.push({
      workId,
      chapterId,
      canonicalUrl: target,
      title: name,
      ordinal: Number(episode),
      ...(publication ? { publishedAt: publication } : {}),
    });
  }
  // Presence is metadata only: do not parse or prefetch the short-story body.
  if (!chapters.length && root.querySelectorAll(BODY).length === 1 && !new URL(pageUrl).search) {
    chapters.push({ workId, chapterId: `${workId}/short`, canonicalUrl, title, ordinal: 1 });
  }
  if (!chapters.length) throw parseError();
  const nextPageUrl = nextPage(root, pageUrl);
  return {
    workId,
    canonicalUrl,
    title,
    chapters,
    pageUrl,
    nextPageUrl,
    complete: nextPageUrl === null && Number(new URL(pageUrl).searchParams.get('p') || 1) === 1,
  };
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
      const { workUrl } = normalizeSourceInput(input);
      const html = await getHtml(workUrl, signal);
      const page = parseWorkPage(html, workUrl);
      checkCancelled(signal);
      return page;
    },
    async getChapter(ref, signal): Promise<SourceSnapshot> {
      const canonicalUrl = normalizeSourceUrl(ref.canonicalUrl);
      const { workId, chapterId, episode } = sourceIdentity(canonicalUrl);
      if (
        ref.workId !== workId ||
        ref.chapterId !== chapterId ||
        ref.ordinal !== (episode ? Number(episode) : 1)
      )
        throw access();
      const rawHtml = await getHtml(canonicalUrl, signal);
      const fetchedAt = new Date().toISOString();
      const chapter = await parseChapter(rawHtml, canonicalUrl);
      checkCancelled(signal);
      return { ...chapter, captureKind: 'fetched', fetchedAt, rawHtml };
    },
  };
}
