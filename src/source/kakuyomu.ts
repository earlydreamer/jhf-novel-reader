/** 본문·제목 선택자는 LNReader/lnreader-plugins 67dce30db9dc730345b095f3da04f0fac087cb48의
 * plugins/japanese/kakuyomu.ts를 참고했다. Copyright (c) 2021 Rajarshee Chatterjee.
 * MIT; see licenses/lnreader-plugins-MIT.txt. 목차는 그 구현과 달리 tableOfContentsV2 순서를 따른다. */
import { ReaderError, type Chapter } from '../contracts';
import type { ChapterRef, WorkPage } from '../contracts/reading';
import { chapterFromBody, documentFragment, inertFragment } from './parse';

const ORIGIN = 'https://kakuyomu.jp';
/** 사이트 간 충돌을 막는 작품 ID 접두어. 숫자 ID는 Number로 바꾸지 않는다. */
const PREFIX = 'kakuyomu-';
const ID = '[1-9][0-9]{0,29}';
const PATH = new RegExp(`^/works/(${ID})(?:/episodes/(${ID}))?/?$`);
const BODY = '.widget-episodeBody';
const TITLE = '.widget-episodeTitle';
const access = () => new ReaderError('source_access');
const parseError = () => new ReaderError('source_parse', 'received');

export const KAKUYOMU_WORK_ID = new RegExp(`^${PREFIX}${ID}$`);
export const KAKUYOMU_CHAPTER_ID = new RegExp(`^(${PREFIX}${ID})/(${ID})$`);

/** 자격 증명·쿼리·다른 호스트·인코딩 경로·경로 이동을 거부한다. */
export function normalizeKakuyomuUrl(input: string): string {
  try {
    const value = input.trim();
    if (/[\\\u0000- ]/.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) throw access();
    if (value.split(/[?#]/, 1)[0]!.includes('%')) throw access();
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'kakuyomu.jp' ||
      url.port ||
      url.username ||
      url.password ||
      url.search
    )
      throw access();
    const match = PATH.exec(url.pathname);
    if (!match) throw access();
    return `${ORIGIN}/works/${match[1]}${match[2] ? `/episodes/${match[2]}` : ''}`;
  } catch {
    throw access();
  }
}

export function kakuyomuIdentity(url: string): {
  workId: string;
  episode: string;
  chapterId: string;
} {
  const match = PATH.exec(new URL(url).pathname);
  if (!match) throw access();
  const workId = `${PREFIX}${match[1]}`;
  const episode = match[2] ?? '';
  return { workId, episode, chapterId: `${workId}/${episode}` };
}

export function kakuyomuWorkUrl(workId: string): string {
  if (!KAKUYOMU_WORK_ID.test(workId)) throw access();
  return `${ORIGIN}/works/${workId.slice(PREFIX.length)}`;
}

/** 회차 주소는 선택만 보존하고, 목차는 항상 작품 주소에서 가져온다. */
export function normalizeKakuyomuInput(input: string): { workUrl: string; chapterUrl?: string } {
  const canonicalUrl = normalizeKakuyomuUrl(input);
  const { workId, episode } = kakuyomuIdentity(canonicalUrl);
  if (episode) return { workUrl: kakuyomuWorkUrl(workId), chapterUrl: canonicalUrl };
  return { workUrl: canonicalUrl };
}

type Ref = { __ref: string };
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw parseError();
  return value as Record<string, unknown>;
}
function refs(value: unknown, typename: string): string[] {
  if (!Array.isArray(value)) throw parseError();
  return value.map((entry) => {
    const ref = record(entry) as Partial<Ref>;
    if (typeof ref.__ref !== 'string' || !ref.__ref.startsWith(`${typename}:`)) throw parseError();
    return ref.__ref;
  });
}
function nonEmpty(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/[\t\n\r ]+/g, ' ').trim() : '';
  if (!text) throw parseError();
  return text;
}
function publishedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

/** __NEXT_DATA__는 실행하지 않고 JSON으로만 읽는다. 목차는 한 페이지에 모두 있다. */
export function parseKakuyomuWorkPage(html: string, input: string): WorkPage {
  const canonicalUrl = normalizeKakuyomuUrl(input);
  const { workId, episode } = kakuyomuIdentity(canonicalUrl);
  if (episode) throw access();
  const root = inertFragment(html);
  const scripts = root.querySelectorAll('script#__NEXT_DATA__[type="application/json"]');
  if (scripts.length !== 1) throw parseError();
  let state: Record<string, unknown>;
  try {
    const data = record(JSON.parse(scripts[0]!.textContent || ''));
    state = record(record(record(data.props).pageProps).__APOLLO_STATE__);
  } catch {
    throw parseError();
  }
  const object = (key: string, typename: string) => {
    const value = record(Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null);
    if (value.__typename !== typename) throw parseError();
    return value;
  };
  const siteId = workId.slice(PREFIX.length);
  const work = object(`Work:${siteId}`, 'Work');
  if (work.id !== siteId) throw parseError();
  const title = nonEmpty(work.title);
  const chapters: ChapterRef[] = [];
  const seen = new Set<string>();
  for (const groupRef of refs(work.tableOfContentsV2, 'TableOfContentsChapter')) {
    const group = object(groupRef, 'TableOfContentsChapter');
    for (const episodeRef of refs(group.episodeUnions, 'Episode')) {
      const entry = object(episodeRef, 'Episode');
      const id = entry.id;
      if (
        typeof id !== 'string' ||
        episodeRef !== `Episode:${id}` ||
        !/^[1-9][0-9]{0,29}$/.test(id)
      )
        throw parseError();
      if (seen.has(id)) throw parseError();
      seen.add(id);
      const publication = publishedAt(entry.publishedAt);
      chapters.push({
        workId,
        chapterId: `${workId}/${id}`,
        canonicalUrl: `${canonicalUrl}/episodes/${id}`,
        title: nonEmpty(entry.title),
        // 사이트 ID와 읽는 순번은 분리한다.
        ordinal: chapters.length + 1,
        ...(publication ? { publishedAt: publication } : {}),
      });
    }
  }
  if (!chapters.length) throw parseError();
  // 공개 회차 수를 확인할 수 없거나 목차와 어긋나면 완전한 목차로 표시하지 않는다.
  if (!Number.isSafeInteger(work.publicEpisodeCount) || work.publicEpisodeCount !== chapters.length)
    throw parseError();
  // 차단 화면 검사는 inertFragment에서 끝났다. 남은 HTML은 읽지 않는다.
  return {
    workId,
    canonicalUrl,
    title,
    chapters,
    pageUrl: canonicalUrl,
    nextPageUrl: null,
    complete: true,
  };
}

function neighbor(root: DocumentFragment, base: string, id: string): string | null {
  const href = root.querySelector(id)?.getAttribute('href');
  if (!href || /[\\%\u0000- ]/.test(href)) return null;
  try {
    const target = normalizeKakuyomuUrl(new URL(href, base).href);
    const other = kakuyomuIdentity(target);
    const current = kakuyomuIdentity(base);
    return other.workId === current.workId && other.episode && other.episode !== current.episode
      ? target
      : null;
  } catch {
    return null;
  }
}

/** Network-free; async only for Web Crypto and shared paragraph IDs. */
export async function parseKakuyomuChapter(html: string, inputUrl: string): Promise<Chapter> {
  const canonicalUrl = normalizeKakuyomuUrl(inputUrl);
  const { workId, episode, chapterId } = kakuyomuIdentity(canonicalUrl);
  if (!episode) throw access();
  const root = documentFragment(html);
  return chapterFromBody(
    root,
    { body: BODY, title: TITLE },
    { canonicalUrl, workId, chapterId },
    {
      prevUrl: neighbor(root, canonicalUrl, '#contentMain-readPreviousEpisode'),
      nextUrl: neighbor(root, canonicalUrl, '#contentMain-readNextEpisode'),
    },
  );
}
