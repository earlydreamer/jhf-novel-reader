/** pixiv 소설은 로그인 없이 읽히는 일본어 작품만 지원한다. 본문은 HTML이 아니라 ajax JSON에서 읽는다. */
import { ReaderError, type Chapter } from '../contracts';
import type { ChapterRef, WorkPage } from '../contracts/reading';
import { chapterFromParagraphs } from './parse';
import { parsePixivContent } from './pixivText';

export const PIXIV_HOST = 'www.pixiv.net';
/** pixiv 가이드라인의 수집·과부하 금지에 맞춰 원문 요청 사이에 두는 최소 간격. */
export const PIXIV_MIN_INTERVAL_MS = 2000;
const ORIGIN = `https://${PIXIV_HOST}`;
const HOSTS = new Set([PIXIV_HOST, 'pixiv.net']);
const ID = '[1-9][0-9]{0,19}';
const NUMERIC_ID = new RegExp(`^${ID}$`);
const SERIES_PATH = new RegExp(`^/novel/series/(${ID})/?$`);
const SHOW_QUERY = new RegExp(`^\\?id=(${ID})$`);
/** 시리즈(s)와 단독 작품(n)의 숫자 ID가 겹칠 수 있어 접두어로 나눈다. 숫자는 Number로 바꾸지 않는다. */
export const PIXIV_WORK_ID = new RegExp(`^pixiv-[sn]${ID}$`);
export const PIXIV_CHAPTER_ID = new RegExp(`^pixiv-([sn])(${ID})/(${ID})$`);

const access = () => new ReaderError('source_access');
const parseError = () => new ReaderError('source_parse', 'received');
const unsupported = () => new ReaderError('source_unsupported', 'received');

export const pixivApi = {
  novel: (id: string) => `${ORIGIN}/ajax/novel/${id}`,
  series: (id: string) => `${ORIGIN}/ajax/novel/series/${id}`,
  seriesTitles: (id: string) => `${ORIGIN}/ajax/novel/series/${id}/content_titles`,
};
export const pixivShowUrl = (id: string) => `${ORIGIN}/novel/show.php?id=${id}`;
export const pixivSeriesUrl = (id: string) => `${ORIGIN}/novel/series/${id}`;

/** 단독 작품은 회차 ID의 소설 번호가 작품 번호와 같아야 한다. */
export function isPixivChapterId(chapterId: string): boolean {
  const match = PIXIV_CHAPTER_ID.exec(chapterId);
  return match !== null && (match[1] === 's' || match[2] === match[3]);
}

/** 자격 증명·포트·다른 쿼리·인코딩 경로·경로 이동을 거부하고 사람이 여는 주소로 맞춘다. */
export function normalizePixivUrl(input: string): string {
  try {
    const value = input.trim();
    if (/[\\\u0000- ]/.test(value) || /\/\.{1,2}(?:[/?#]|$)/.test(value)) throw access();
    if (value.split('#', 1)[0]!.includes('%')) throw access();
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !HOSTS.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      throw access();
    const series = SERIES_PATH.exec(url.pathname);
    if (series && !url.search) return pixivSeriesUrl(series[1]!);
    const novel = url.pathname === '/novel/show.php' ? SHOW_QUERY.exec(url.search) : null;
    if (novel) return pixivShowUrl(novel[1]!);
    throw access();
  } catch {
    throw access();
  }
}

export function pixivTarget(
  canonicalUrl: string,
): { kind: 'series'; id: string } | { kind: 'novel'; id: string } {
  const url = new URL(normalizePixivUrl(canonicalUrl));
  const series = SERIES_PATH.exec(url.pathname);
  if (series) return { kind: 'series', id: series[1]! };
  return { kind: 'novel', id: SHOW_QUERY.exec(url.search)![1]! };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw parseError();
  return value as Record<string, unknown>;
}
function nonEmpty(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\t\n\r ]+/g, ' ').trim() : '';
  if (!text) throw parseError();
  return text;
}
/** 실측상 seriesId는 숫자, 나머지 ID는 숫자 문자열로 온다. 둘 다 문자열로 맞춘다. */
function idOf(value: unknown): string {
  if (typeof value === 'string' && NUMERIC_ID.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  throw parseError();
}
function publishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
/** 없는 작품은 error:true로 온다. */
function body(json: unknown): unknown {
  const root = record(json);
  if (root.error === true) throw access();
  if (root.error !== false) throw parseError();
  return root.body;
}
function neighborId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const entry = record(value);
  return entry.available === false ? null : idOf(entry.id);
}

export type PixivNovel = {
  id: string;
  title: string;
  content: string;
  seriesId: string | null;
  prevId: string | null;
  nextId: string | null;
  publishedAt?: string;
};

export function readPixivNovel(json: unknown): PixivNovel {
  const novel = record(body(json));
  const id = idOf(novel.id);
  const title = nonEmpty(novel.title);
  if (typeof novel.content !== 'string') throw parseError();
  if (novel.isLoginOnly === true || novel.xRestrict !== 0 || novel.language !== 'ja')
    throw unsupported();
  const nav = novel.seriesNavData;
  let seriesId: string | null = null;
  let prevId: string | null = null;
  let nextId: string | null = null;
  if (nav !== null && nav !== undefined) {
    const value = record(nav);
    seriesId = idOf(value.seriesId);
    prevId = neighborId(value.prev);
    nextId = neighborId(value.next);
  }
  const date = publishedAt(novel.createDate);
  return {
    id,
    title,
    content: novel.content,
    seriesId,
    prevId,
    nextId,
    ...(date ? { publishedAt: date } : {}),
  };
}

export type PixivSeries = { id: string; title: string; entries: { id: string; title: string }[] };

/** 목차 개수가 공개 회차 수와 다르면 완전한 목차로 보지 않는다. 비공개 회차는 목차에서 뺀다. */
export function readPixivSeries(meta: unknown, titles: unknown): PixivSeries {
  const series = record(body(meta));
  const id = idOf(series.id);
  const title = nonEmpty(series.title);
  if (series.xRestrict !== 0 || (series.maxXRestrict ?? 0) !== 0 || series.language !== 'ja')
    throw unsupported();
  const count = series.publishedContentCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw parseError();
  const list = body(titles);
  if (!Array.isArray(list) || list.length !== count) throw parseError();
  const seen = new Set<string>();
  const entries: { id: string; title: string }[] = [];
  for (const item of list) {
    const entry = record(item);
    const entryId = idOf(entry.id);
    if (seen.has(entryId)) throw parseError();
    seen.add(entryId);
    if (entry.available === false) continue;
    entries.push({ id: entryId, title: nonEmpty(entry.title) });
  }
  if (!entries.length) throw parseError();
  return { id, title, entries };
}

export function pixivSeriesPage(series: PixivSeries): WorkPage {
  const workId = `pixiv-s${series.id}`;
  const canonicalUrl = pixivSeriesUrl(series.id);
  return {
    workId,
    canonicalUrl,
    title: series.title,
    // 사이트 ID와 읽는 순번은 분리하고, 순번은 공개 회차에 빈칸 없이 매긴다.
    chapters: series.entries.map((entry, index) => ({
      workId,
      chapterId: `${workId}/${entry.id}`,
      canonicalUrl: pixivShowUrl(entry.id),
      title: entry.title,
      ordinal: index + 1,
    })),
    pageUrl: canonicalUrl,
    nextPageUrl: null,
    complete: true,
  };
}

export function pixivSinglePage(novel: PixivNovel): WorkPage {
  if (novel.seriesId !== null) throw parseError();
  const workId = `pixiv-n${novel.id}`;
  const canonicalUrl = pixivShowUrl(novel.id);
  return {
    workId,
    canonicalUrl,
    title: novel.title,
    chapters: [
      {
        workId,
        chapterId: `${workId}/${novel.id}`,
        canonicalUrl,
        title: novel.title,
        ordinal: 1,
        ...(novel.publishedAt ? { publishedAt: novel.publishedAt } : {}),
      },
    ],
    pageUrl: canonicalUrl,
    nextPageUrl: null,
    complete: true,
  };
}

/** 회차가 다른 시리즈로 옮겨졌거나 단독 작품이 시리즈에 들어갔으면 저장된 참조와 맞지 않으니 거부한다. */
export async function pixivChapter(novel: PixivNovel, ref: ChapterRef): Promise<Chapter> {
  const match = PIXIV_CHAPTER_ID.exec(ref.chapterId);
  if (!match || !isPixivChapterId(ref.chapterId)) throw access();
  const [, kind, workNumber, novelId] = match as unknown as [string, 's' | 'n', string, string];
  const workId = `pixiv-${kind}${workNumber}`;
  if (ref.workId !== workId) throw access();
  if (novel.id !== novelId) throw parseError();
  if (kind === 's' ? novel.seriesId !== workNumber : novel.seriesId !== null) throw parseError();
  const neighbor = (id: string | null) => (kind === 's' && id ? pixivShowUrl(id) : null);
  return chapterFromParagraphs(
    parsePixivContent(novel.content),
    novel.title,
    { canonicalUrl: pixivShowUrl(novelId), workId, chapterId: ref.chapterId },
    { prevUrl: neighbor(novel.prevId), nextUrl: neighbor(novel.nextId) },
  );
}
