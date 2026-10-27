import { ReaderError, type Paragraph, type Ruby } from '../contracts';

const MAX_CONTENT_LENGTH = 2_000_000;
const RUBY = String.raw`\[\[rb:[^\]]*?\]\]`;
// 왼쪽부터 태그를 소비한다. 맞지 않는 괄호는 글자 그대로 남는다.
const TAG = new RegExp(
  [
    `\\[\\[rb:([^\\]]*?)\\]\\]`,
    `\\[chapter:((?:[^\\[\\]]|${RUBY})*)\\]`,
    `\\[jumpuri:([^\\]]*?)\\]`,
    `\\[jump:[0-9]+\\]`,
    `\\[(?:pixivimage|uploadedimage):[^\\]]*\\]`,
  ].join('|'),
  'g',
);

type Line = { text: string; ruby: Ruby[] };

function split(value: string): [string, string] | null {
  const index = value.indexOf('>');
  if (index < 0) return null;
  const left = value.slice(0, index).trim();
  const right = value.slice(index + 1).trim();
  return left && right ? [left, right] : null;
}

function render(segment: string): Line {
  let text = '';
  const ruby: Ruby[] = [];
  let last = 0;
  for (const match of segment.matchAll(TAG)) {
    text += segment.slice(last, match.index);
    last = match.index + match[0].length;
    const [whole, rb, chapter, jumpuri] = match;
    if (rb !== undefined) {
      const pair = split(rb);
      if (!pair) {
        text += whole;
        continue;
      }
      ruby.push({ start: text.length, end: text.length + pair[0].length, reading: pair[1] });
      text += pair[0];
    } else if (chapter !== undefined) {
      const inner = render(chapter);
      ruby.push(
        ...inner.ruby.map((r) => ({
          ...r,
          start: r.start + text.length,
          end: r.end + text.length,
        })),
      );
      text += inner.text;
    } else if (jumpuri !== undefined) {
      const pair = split(jumpuri);
      text += pair ? pair[0] : whole;
    }
    // [jump:N]과 삽화 태그는 남길 글자가 없다.
  }
  text += segment.slice(last);
  return { text, ruby };
}

function paragraph(segment: string): Omit<Paragraph, 'id'> {
  const { text, ruby } = render(segment);
  // 전각 들여쓰기는 남기고 가장자리의 ASCII 공백만 지운다.
  const leading = text.match(/^[\t ]*/)![0].length;
  const cleaned = text.replace(/^[\t ]+|[\t ]+$/g, '');
  return {
    text: cleaned,
    ruby: ruby
      .map((r) => ({ ...r, start: r.start - leading, end: r.end - leading }))
      .filter((r) => r.start >= 0 && r.end <= cleaned.length),
  };
}

/** pixiv 본문 마크업을 줄 단위 문단과 루비로 바꾼다. 삽화는 제거하고 실행하지 않는다. */
export function parsePixivContent(content: string): Omit<Paragraph, 'id'>[] {
  if (content.length > MAX_CONTENT_LENGTH) throw new ReaderError('source_parse', 'received');
  const paragraphs: Omit<Paragraph, 'id'>[] = [];
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const segments = line.split('[newpage]');
    if (segments.length === 1) {
      paragraphs.push(paragraph(line));
      continue;
    }
    // 쪽 나눔은 빈 문단 하나로 남긴다.
    segments.forEach((segment, index) => {
      if (index > 0) paragraphs.push({ text: '', ruby: [] });
      if (segment.trim()) paragraphs.push(paragraph(segment));
    });
  }
  return paragraphs;
}
