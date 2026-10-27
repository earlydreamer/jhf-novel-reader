/** Selectors adapted from LNReader/lnreader-plugins at 358388426c0b23674b97760c352ee972b8e4d7b8.
 * Copyright (c) 2021 Rajarshee Chatterjee. MIT; see licenses/lnreader-plugins-MIT.txt. */
import {
  ReaderError,
  createParagraphId,
  type Chapter,
  type Paragraph,
  type Ruby,
} from '../contracts';

const ORIGIN = 'https://ncode.syosetu.com';
export const BODY = '.p-novel__body .p-novel__text:not([class*="p-novel__text--"]), #novel_honbun';
export const TITLE = '.p-novel__title, .novel_subtitle, .novel_title';
const MAX_HTML_LENGTH = 2_000_000;
const access = () => new ReaderError('source_access');
const parseError = () => new ReaderError('source_parse', 'received');

/** No credentials, query parameters, alternate hosts, encoded paths or path traversal. */
export function normalizeSourceUrl(input: string): string {
  try {
    const value = input.trim();
    if (/[\\\u0000-\u0020]/.test(value) || /\/\.{1,2}(?:\/|$)/.test(value)) throw access();
    if (value.split(/[?#]/, 1)[0]!.includes('%')) throw access();
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'ncode.syosetu.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search
    )
      throw access();
    const match = /^\/(n\d{4}[a-z]{1,2})(?:\/([1-9]\d*))?\/?$/i.exec(url.pathname);
    if (!match || (match[2] && !Number.isSafeInteger(Number(match[2])))) throw access();
    return `${ORIGIN}/${match[1]!.toLowerCase()}/${match[2] ? match[2] + '/' : ''}`;
  } catch {
    throw access();
  }
}
export function sourceIdentity(url: string) {
  const parts = new URL(url).pathname.split('/');
  const workId = parts[1]!;
  const episode = parts[2] || '';
  return { workId, episode, chapterId: `${workId}/${episode || 'short'}` };
}

/** A detached template is inert, including images/iframes: never insert its content into live DOM.
 * 정리 전 단계라 실행하지 않는 구조화 데이터 script를 읽을 수 있다. 본문은 documentFragment로 읽는다. */
export function inertFragment(html: string): DocumentFragment {
  if (typeof html !== 'string' || html.length > MAX_HTML_LENGTH) throw parseError();
  const template = document.createElement('template');
  try {
    template.innerHTML = html;
  } catch {
    throw parseError();
  }
  const root = template.content;
  const stack: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > 256 || ++nodes > 100_000) throw parseError();
    for (const child of Array.from(node.childNodes)) stack.push({ node: child, depth: depth + 1 });
  }
  const gateTitle = root.querySelector('title')?.textContent || '';
  if (
    /^(?:(?:ログイン|年齢確認|アクセス制限|アクセス拒否|access denied|forbidden|security check)(?:\s*$|\s*[|｜])|just a moment(?:\s|\.|$))/i.test(
      gateTitle.trim(),
    ) ||
    root.querySelector(
      'input[type="password"], #cf-challenge-running, #challenge-form, form[action*="ageauth"], form[action*="login"]',
    )
  )
    throw access();
  return root;
}
export function documentFragment(html: string): DocumentFragment {
  const root = inertFragment(html);
  root
    .querySelectorAll(
      'script,style,iframe,object,embed,svg,math,img,picture,video,audio,source,link,meta,base,template,noscript,input,button,select,textarea,[hidden],[aria-hidden="true"]',
    )
    .forEach((element) => element.remove());
  return root;
}
export function plain(element: Element | null): string {
  return (element?.textContent || '').replace(/[\t\n\r ]+/g, ' ').trim();
}
function readParagraph(element: Node): Omit<Paragraph, 'id'> {
  let text = '';
  const ruby: Ruby[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      text += (node.textContent || '').replace(/\r\n?/g, '\n');
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toLowerCase();
    if (tag === 'rt' || tag === 'rp' || tag === 'rtc') return;
    if (tag === 'br') {
      text += '\n';
      return;
    }
    if (tag === 'ruby') {
      if ((node as Element).querySelector('rtc, ruby')) throw parseError();
      let start = text.length;
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === 'rt') {
          const reading = plain(child as Element);
          if (reading && !text.slice(start).trim()) throw parseError();
          if (reading && text.length > start) ruby.push({ start, end: text.length, reading });
          start = text.length;
        } else walk(child);
      }
    } else for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(element);
  // Keep Japanese fullwidth indentation and intentional internal line breaks.
  const leading = text.match(/^[\t\r\n ]*/)?.[0].length || 0;
  const cleaned = text.replace(/^[\t\r\n ]+|[\t\r\n ]+$/g, '');
  return {
    text: cleaned,
    ruby: ruby
      .map((r) => ({ ...r, start: r.start - leading, end: r.end - leading }))
      .filter((r) => r.start >= 0 && r.end <= cleaned.length),
  };
}
export function safeChapterLink(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    if (/[\\%\u0000-\u0020]/.test(href)) return null;
    const target = normalizeSourceUrl(new URL(href, base).href);
    const other = sourceIdentity(target);
    return other.workId === sourceIdentity(base).workId && other.episode ? target : null;
  } catch {
    return null;
  }
}
function neighbor(root: DocumentFragment, base: string, direction: 'prev' | 'next'): string | null {
  const selector =
    direction === 'prev'
      ? '.c-pager__item--before, .c-pager__item--prev, a[rel="prev"], .novel_bn a'
      : '.c-pager__item--next, a[rel="next"], .novel_bn a';
  for (const anchor of Array.from(root.querySelectorAll(selector))) {
    if (anchor.closest('.novel_bn') && !plain(anchor).includes(direction === 'prev' ? '前' : '次'))
      continue;
    const target = safeChapterLink(anchor.getAttribute('href'), base);
    if (
      target &&
      sourceIdentity(base).episode &&
      (direction === 'prev'
        ? Number(sourceIdentity(target).episode) < Number(sourceIdentity(base).episode)
        : Number(sourceIdentity(target).episode) > Number(sourceIdentity(base).episode))
    )
      return target;
  }
  return null;
}
export interface WorkIndex {
  readonly title: string;
  readonly workId: string;
  readonly chapters: readonly { title: string; url: string }[];
}
export function parseWork(html: string, inputUrl: string): WorkIndex {
  const url = normalizeSourceUrl(inputUrl);
  if (sourceIdentity(url).episode) throw parseError();
  const root = documentFragment(html);
  const title = plain(root.querySelector(TITLE));
  const seen = new Set<string>();
  const chapters: { title: string; url: string }[] = [];
  for (const anchor of Array.from(
    root.querySelectorAll('.p-eplist__sublist a, .novel_sublist2 .subtitle a'),
  )) {
    const target = safeChapterLink(anchor.getAttribute('href'), url);
    const name = plain(anchor);
    if (target && name && !seen.has(target)) {
      seen.add(target);
      chapters.push({ title: name, url: target });
    }
  }
  if (!title || !chapters.length) throw parseError();
  return { title, workId: sourceIdentity(url).workId, chapters };
}
/** 사이트 어댑터가 고른 본문 컨테이너 하나를 문단·루비·빈 줄 보존 계약으로 읽는다. */
export async function chapterFromBody(
  root: DocumentFragment,
  selectors: { body: string; title: string },
  identity: { canonicalUrl: string; workId: string; chapterId: string },
  neighbors: { prevUrl: string | null; nextUrl: string | null },
): Promise<Chapter> {
  const containers = root.querySelectorAll(selectors.body);
  const title = plain(root.querySelector(selectors.title));
  if (!title || containers.length !== 1) throw parseError();
  const container = containers[0]!;
  const elements = Array.from(container.querySelectorAll('p'));
  if (elements.length) {
    const remainder = container.cloneNode(true) as Element;
    remainder.querySelectorAll('p').forEach((p) => p.remove());
    if (remainder.textContent?.trim()) throw parseError();
  }
  const values = (elements.length ? elements : [container]).map(readParagraph);
  return chapterFromParagraphs(values, title, identity, neighbors);
}
/** 사이트가 읽은 문단에 ID와 원문 해시를 붙인다. HTML이 아닌 원문도 같은 계약을 쓴다. */
export async function chapterFromParagraphs(
  values: readonly Omit<Paragraph, 'id'>[],
  title: string,
  identity: { canonicalUrl: string; workId: string; chapterId: string },
  neighbors: { prevUrl: string | null; nextUrl: string | null },
): Promise<Chapter> {
  if (!title || !values.some((p) => p.text.trim())) throw parseError();
  const { canonicalUrl, workId, chapterId } = identity;
  const paragraphs = await Promise.all(
    values.map(async (p, index) => ({ ...p, id: await createParagraphId(chapterId, index, p) })),
  );
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([
        canonicalUrl,
        values.map((p) => [p.text, p.ruby.map((r) => [r.start, r.end, r.reading])]),
      ]),
    ),
  );
  const sourceHash = Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return { canonicalUrl, workId, chapterId, title, paragraphs, sourceHash, ...neighbors };
}
/** Network-free; async only for Web Crypto and shared paragraph IDs. */
export async function parseChapter(html: string, inputUrl: string): Promise<Chapter> {
  const canonicalUrl = normalizeSourceUrl(inputUrl);
  const root = documentFragment(html);
  const { workId, chapterId } = sourceIdentity(canonicalUrl);
  return chapterFromBody(
    root,
    { body: BODY, title: TITLE },
    { canonicalUrl, workId, chapterId },
    {
      prevUrl: neighbor(root, canonicalUrl, 'prev'),
      nextUrl: neighbor(root, canonicalUrl, 'next'),
    },
  );
}
