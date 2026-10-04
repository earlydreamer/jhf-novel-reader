import { useEffect, useRef } from 'react';
import type { CompletedTranslation, ReadingPosition, WorkPage } from '../contracts/reading';
export interface ReaderScreenProps { version: CompletedTranslation; work: WorkPage | null; position: ReadingPosition | null; fontSize: number; showOriginal: boolean; onFontSize(value: number): void; onPosition(blockId: string, offset: number): void; onShowOriginal(value: boolean): void; onContents(): void; onAdjacent(direction: -1 | 1): void }
export function ReaderScreen(props: ReaderScreenProps) {
  const body = useRef<HTMLElement>(null);
  const initialPosition = useRef(props.position);
  useEffect(() => {
    const position = initialPosition.current;
    if (!position || !body.current) return;
    const element = Array.from(body.current.querySelectorAll<HTMLElement>('[data-block-id]')).find(value => value.dataset.blockId === position.blockId);
    if (element) body.current.scrollTop = element.offsetTop + position.offset;
  }, []);
  const chapters = props.work?.chapters ?? [];
  const index = chapters.findIndex(chapter => chapter.chapterId === props.version.source.chapterId);
  function saveScroll(): void {
    if (!body.current || props.showOriginal) return;
    const elements = Array.from(body.current.querySelectorAll<HTMLElement>('[data-block-id]'));
    const block = [...elements].reverse().find(element => element.offsetTop <= (body.current?.scrollTop ?? 0)) ?? elements[0];
    if (block?.dataset.blockId) props.onPosition(block.dataset.blockId, Math.max(0, body.current.scrollTop - block.offsetTop));
  }
  return <section aria-label="독서 화면">
    <h1>{props.version.source.title}</h1>
    <nav aria-label="독서 이동"><button onClick={props.onContents} disabled={!props.work}>목차</button><button onClick={() => props.onShowOriginal(!props.showOriginal)}>{props.showOriginal ? '번역 보기' : '원문 확인'}</button><a href={props.version.source.canonicalUrl} target="_blank" rel="noreferrer">원문 사이트</a><button disabled={index <= 0} onClick={() => props.onAdjacent(-1)}>이전 화</button><button disabled={index < 0 || index >= chapters.length - 1} onClick={() => props.onAdjacent(1)}>다음 화</button></nav>
    <label>글자 크기<input type="range" min="10" max="48" value={props.fontSize} onChange={event => props.onFontSize(Number(event.target.value))} /></label>
    <article ref={body} className="nr-reading-body" tabIndex={0} aria-label={props.showOriginal ? '원문 본문' : '번역 본문'} onScroll={saveScroll} style={{ fontSize: `${props.fontSize}px` }}>
      {props.showOriginal ? props.version.source.paragraphs.map(paragraph => <p key={paragraph.id}>{paragraph.text}</p>) : props.version.blocks.map(block => <p key={block.id} data-block-id={block.id}>{block.text || '\u00a0'}</p>)}
    </article>
  </section>;
}
