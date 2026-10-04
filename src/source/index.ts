/** Selectors adapted from LNReader/lnreader-plugins at 358388426c0b23674b97760c352ee972b8e4d7b8.
 * Copyright (c) 2021 Rajarshee Chatterjee. MIT; see licenses/lnreader-plugins-MIT.txt. */
import { ReaderError, createParagraphId, type Chapter, type Paragraph, type Ruby, type SourceAdapter, type SourceTransport } from '../contracts';

const ORIGIN = 'https://ncode.syosetu.com';
const BODY = '.p-novel__body .p-novel__text:not([class*="p-novel__text--"]), #novel_honbun';
const TITLE = '.p-novel__title, .novel_subtitle, .novel_title';
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
  if (url.protocol !== 'https:' || url.hostname !== 'ncode.syosetu.com' || url.port || url.username || url.password || url.search) throw access();
  const match = /^\/(n\d{4}[a-z]{1,2})(?:\/([1-9]\d*))?\/?$/i.exec(url.pathname);
  if (!match || (match[2] && !Number.isSafeInteger(Number(match[2])))) throw access();
  return `${ORIGIN}/${match[1]!.toLowerCase()}/${match[2] ? match[2] + '/' : ''}`;
 } catch { throw access(); }
}
function identity(url: string) {
 const parts = new URL(url).pathname.split('/');
 const workId = parts[1]!;
 const episode = parts[2] || ''; 
 return { workId, episode, chapterId: `${workId}/${episode || 'short'}` };
}

/** A detached template is inert, including images/iframes: never insert its content into live DOM. */
function documentFragment(html: string): DocumentFragment {
 if (typeof html !== 'string' || html.length > MAX_HTML_LENGTH) throw parseError();
 const template = document.createElement('template');
 try { template.innerHTML = html; } catch { throw parseError(); }
 const root = template.content;
 const stack: { node: Node; depth: number }[] = [{ node: root, depth: 0 }];
 let nodes = 0;
 while (stack.length) {
  const { node, depth } = stack.pop()!;
  if (depth > 256 || ++nodes > 100_000) throw parseError();
  for (const child of Array.from(node.childNodes)) stack.push({ node: child, depth: depth + 1 });
 }
 const gateTitle = root.querySelector('title')?.textContent || '';
 if (/^(?:(?:ログイン|年齢確認|アクセス制限|アクセス拒否|access denied|forbidden|security check)(?:\s*$|\s*[|｜])|just a moment(?:\s|\.|$))/i.test(gateTitle.trim()) || root.querySelector('input[type="password"], #cf-challenge-running, #challenge-form, form[action*="ageauth"], form[action*="login"]')) throw access();
 root.querySelectorAll('script,style,iframe,object,embed,svg,math,img,picture,video,audio,source,link,meta,base,template,noscript,input,button,select,textarea,[hidden],[aria-hidden="true"]').forEach(element => element.remove());
 return root;
}
function plain(element: Element | null): string {
 return (element?.textContent || '').replace(/[\t\n\r ]+/g, ' ').trim();
}
function readParagraph(element: Node): Omit<Paragraph, 'id'> {
 let text = '';
 const ruby: Ruby[] = [];
 const walk = (node: Node) => {
  if (node.nodeType === 3) { text += (node.textContent || '').replace(/\r\n?/g, '\n'); return; }
  if (node.nodeType !== 1) return;
  const tag = (node as Element).tagName.toLowerCase();
  if (tag === 'rt' || tag === 'rp' || tag === 'rtc') return;
  if (tag === 'br') { text += '\n'; return; }
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
 return { text: cleaned, ruby: ruby.map(r => ({ ...r, start: r.start - leading, end: r.end - leading })).filter(r => r.start >= 0 && r.end <= cleaned.length) };
}
function safeChapterLink(href: string | null, base: string): string | null {
 if (!href) return null;
 try {
  if (/[\\%\u0000-\u0020]/.test(href)) return null;
  const target = normalizeSourceUrl(new URL(href, base).href);
  const other = identity(target);
  return other.workId === identity(base).workId && other.episode ? target : null;
 } catch { return null; }
}
function neighbor(root: DocumentFragment, base: string, direction: 'prev' | 'next'): string | null {
 const selector = direction === 'prev' ? '.c-pager__item--before, .c-pager__item--prev, a[rel="prev"], .novel_bn a' : '.c-pager__item--next, a[rel="next"], .novel_bn a';
 for (const anchor of Array.from(root.querySelectorAll(selector))) {
  if (anchor.closest('.novel_bn') && !plain(anchor).includes(direction === 'prev' ? '前' : '次')) continue;
  const target = safeChapterLink(anchor.getAttribute('href'), base);
  if (target && identity(base).episode && (direction === 'prev' ? Number(identity(target).episode) < Number(identity(base).episode) : Number(identity(target).episode) > Number(identity(base).episode))) return target;
 }
 return null;
}
export interface WorkIndex { readonly title: string; readonly workId: string; readonly chapters: readonly { title: string; url: string }[] }
export function parseWork(html: string, inputUrl: string): WorkIndex {
 const url = normalizeSourceUrl(inputUrl);
 if (identity(url).episode) throw parseError();
 const root = documentFragment(html);
 const title = plain(root.querySelector(TITLE));
 const seen = new Set<string>();
 const chapters: {title:string;url:string}[] = [];
 for (const anchor of Array.from(root.querySelectorAll('.p-eplist__sublist a, .novel_sublist2 .subtitle a'))) {
  const target = safeChapterLink(anchor.getAttribute('href'), url);
  const name = plain(anchor);
  if (target && name && !seen.has(target)) { seen.add(target); chapters.push({ title: name, url: target }); }
 }
 if (!title || !chapters.length) throw parseError();
 return { title, workId: identity(url).workId, chapters };
}
/** Network-free; async only for Web Crypto and shared paragraph IDs. */
export async function parseChapter(html: string, inputUrl: string): Promise<Chapter> {
 const canonicalUrl = normalizeSourceUrl(inputUrl);
 const root = documentFragment(html);
 const containers = root.querySelectorAll(BODY);
 const title = plain(root.querySelector(TITLE));
 if (!title || containers.length !== 1) throw parseError();
 const container = containers[0]!;
 const elements = Array.from(container.querySelectorAll('p'));
 if (elements.length) {
  const remainder = container.cloneNode(true) as Element;
  remainder.querySelectorAll('p').forEach(p => p.remove());
  if (remainder.textContent?.trim()) throw parseError();
 }
 const values = (elements.length ? elements : [container]).map(readParagraph);
 if (!values.some(p => p.text.trim())) throw parseError();
 const {workId,chapterId} = identity(canonicalUrl);
 const paragraphs = await Promise.all(values.map(async (p,index) => ({...p,id:await createParagraphId(chapterId,index,p)})));
 const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([canonicalUrl,values.map(p=>[p.text,p.ruby.map(r=>[r.start,r.end,r.reading])])])));
 const sourceHash = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
 return { canonicalUrl,workId,chapterId,title,paragraphs,sourceHash,prevUrl:neighbor(root,canonicalUrl,'prev'),nextUrl:neighbor(root,canonicalUrl,'next') };
}
function checkCancelled(signal: AbortSignal) { if (signal.aborted) throw new ReaderError('cancelled'); }
export class NarouSourceAdapter implements SourceAdapter {
 constructor(private readonly transport: SourceTransport) {}
 private async getHtml(url: string, signal: AbortSignal): Promise<string> {
  checkCancelled(signal);
  const response = await this.transport.get(url, signal);
  checkCancelled(signal);
  if (response.status !== 200) throw new ReaderError('source_access','received',response.status);
  const contentType = Object.entries(response.headers).find(([name])=>name.toLowerCase()==='content-type')?.[1] || '';
  if (response.url !== url || !/^text\/html(?:\s*;|\s*$)/i.test(contentType) || typeof response.data !== 'string') throw access();
  return response.data;
 }
 async getChapter(inputUrl: string, signal: AbortSignal): Promise<Chapter> {
  let url = normalizeSourceUrl(inputUrl);
  let html = await this.getHtml(url,signal);
  if (!identity(url).episode && !documentFragment(html).querySelector(BODY)) {
   // Never paginate or collect a work. Resolve its first listed episode once.
   url = parseWork(html,url).chapters[0]!.url;
   html = await this.getHtml(url,signal);
  }
  const result = await parseChapter(html,url);
  checkCancelled(signal);
  return result;
 }
}
