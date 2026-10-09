import { ReaderError, type HttpResponse, type LookupTransport } from '../contracts';

export type LookupHit = {
  kind: 'wikipedia' | 'wikidata' | 'namuwiki';
  /** 한국어 표기 */
  ko: string;
  /** 근거 링크(https) */
  url: string;
  /** 200자 이내 설명 */
  note: string;
  /** 위키백과 정확 연결이면 true */
  exact: boolean;
};

const NOTE_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined;
}

function note(text: string): string {
  return text.slice(0, NOTE_LIMIT);
}

async function fetchData(
  transport: LookupTransport,
  url: string,
  responseType: 'json' | 'text',
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw new ReaderError('cancelled');
  const response: HttpResponse = await transport.get(url, responseType, signal);
  if (signal.aborted) throw new ReaderError('cancelled');
  if (response.status < 200 || response.status >= 300)
    throw new ReaderError('connection', 'received', response.status);
  return response.data;
}

export async function lookupWikipedia(
  transport: LookupTransport,
  ja: string,
  signal: AbortSignal,
): Promise<LookupHit | null> {
  const data = await fetchData(
    transport,
    `https://ja.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=langlinks&lllang=ko&titles=${encodeURIComponent(ja)}`,
    'json',
    signal,
  );
  const query = field(data, 'query');
  const page = first(field(query, 'pages'));
  if (!isRecord(page) || page.missing === true) return null;
  const redirect = first(field(query, 'redirects'));
  const redirected = isRecord(redirect) && typeof redirect.to === 'string';
  const jaTitle = redirected ? redirect.to : page.title;
  if (typeof jaTitle !== 'string') return null;
  const link = first(field(page, 'langlinks'));
  if (!isRecord(link) || typeof link.title !== 'string') return null;
  const koTitle = link.title;
  // 한국어 문서 제목의 괄호 설명(예: '(무장)')은 표기에서 뗀다.
  const ko = koTitle.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (!ko) return null;
  return {
    kind: 'wikipedia',
    ko,
    url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(koTitle.replace(/ /g, '_'))}`,
    note: note(
      redirected ? `위키백과: ${ja} → ${jaTitle} → ${ko}` : `위키백과: ${jaTitle} → ${ko}`,
    ),
    exact: true,
  };
}

export async function lookupWikidata(
  transport: LookupTransport,
  ja: string,
  signal: AbortSignal,
): Promise<LookupHit | null> {
  const search = await fetchData(
    transport,
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=ja&uselang=ja&type=item&limit=1&search=${encodeURIComponent(ja)}`,
    'json',
    signal,
  );
  const hit = first(field(search, 'search'));
  // 라벨이 입력과 정확히 같을 때만 쓴다. 다른 항목을 엉뚱하게 붙이지 않는다.
  if (!isRecord(hit) || typeof hit.id !== 'string' || !/^Q\d+$/.test(hit.id)) return null;
  if (hit.label !== ja) return null;
  const id = hit.id;
  const entities = await fetchData(
    transport,
    `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${id}&props=labels&languages=ko`,
    'json',
    signal,
  );
  const label = field(field(field(entities, 'entities'), id), 'labels');
  const ko = field(label, 'ko');
  const value = isRecord(ko) && typeof ko.value === 'string' ? ko.value.trim() : '';
  if (!value) return null;
  return {
    kind: 'wikidata',
    ko: value,
    url: `https://www.wikidata.org/wiki/${id}`,
    note: note(`위키데이터 ${id}: ${value}`),
    exact: false,
  };
}

export async function lookupNamuwiki(
  transport: LookupTransport,
  ja: string,
  signal: AbortSignal,
): Promise<LookupHit | null> {
  const url = `https://namu.wiki/Search?q=${encodeURIComponent(ja)}`;
  const data = await fetchData(transport, url, 'text', signal);
  if (typeof data !== 'string') return null;
  const found = namuKoreanFor(data, ja);
  if (!found) return null;
  return {
    kind: 'namuwiki',
    ko: found.ko,
    url,
    note: note(`나무위키 검색: ${found.ko} (${ja}) ${found.count}회`),
    exact: false,
  };
}

const ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ['&lt;', '<'],
  ['&gt;', '>'],
  ['&quot;', '"'],
  ['&#39;', "'"],
  ['&nbsp;', ' '],
  // &amp;는 마지막에 풀어야 '&amp;lt;'가 '<'로 두 번 풀리지 않는다.
  ['&amp;', '&'],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 태그를 걷어 낸 텍스트에서 '한국어 (日本語)' 패턴으로 ja의 한국어 표기 후보를 센다. */
export function namuKoreanFor(html: string, ja: string): { ko: string; count: number } | null {
  let plain = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  for (const [entity, char] of ENTITIES) plain = plain.split(entity).join(char);
  plain = plain.replace(/\s+/g, ' ').trim();

  const pattern = new RegExp(
    `([가-힣][가-힣·\\s]{0,20}?)\\s*\\(\\s*${escapeRegExp(ja)}(?:\\s*[;,)/])`,
    'g',
  );
  const counts = new Map<string, number>();
  for (const match of plain.matchAll(pattern)) {
    const ko = (match[1] ?? '').trim();
    if (ko.length < 2 || ko.length > 20) continue;
    counts.set(ko, (counts.get(ko) ?? 0) + 1);
  }
  // 동률이면 먼저 나온 후보를 쓴다(Map은 삽입 순서를 지킨다).
  let best: { ko: string; count: number } | null = null;
  for (const [ko, count] of counts) if (!best || count > best.count) best = { ko, count };
  return best;
}
