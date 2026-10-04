import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Paragraph, ReaderActions, ReaderViewState } from '../contracts';
import './reader.css';

const phases = { idle: '읽을 한 화를 골라주세요', preparing: '원문을 준비하고 있어요', translating: '한국어로 옮기고 있어요', validating: '번역을 확인하고 있어요', saving: '완성본을 저장하고 있어요', ready: '읽기 준비 완료', failed: '작업을 마치지 못했어요', unknown: '서버의 처리 결과를 알 수 없어요', paused: '번역이 잠시 멈췄어요' };
const errors = { source_access: '접근할 수 있는 회차 주소인지 확인해주세요.', source_parse: '페이지에서 본문을 찾지 못했어요.', connection: '휴대폰에서 모델 서버에 연결할 수 있는지 확인해주세요.', auth: '모델 인증 설정을 확인해주세요.', timeout_unknown: '서버에서 아직 처리 중일 수 있어요.', invalid_output: '번역이 잘리거나 일부 문단이 빠졌어요.', storage: '기기 저장 공간을 확인해주세요. 번역을 다시 요청하지 않고 저장을 다시 시도합니다.', cancelled: '저장된 진행 상황에서 이어갈 수 있어요.' };

/** Text nodes only. Invalid or overlapping ruby annotations fall back to plain text. */
function SafeParagraph({ paragraph }: { paragraph: Paragraph }) {
 const nodes: ReactNode[] = []; let cursor = 0;
 for (const ruby of paragraph.ruby) {
  if (!Number.isInteger(ruby.start) || !Number.isInteger(ruby.end) || ruby.start < cursor || ruby.end <= ruby.start || ruby.end > paragraph.text.length) continue;
  nodes.push(paragraph.text.slice(cursor, ruby.start));
  nodes.push(<ruby key={`${ruby.start}-${ruby.end}`}>{paragraph.text.slice(ruby.start, ruby.end)}<rp>(</rp><rt>{ruby.reading}</rt><rp>)</rp></ruby>);
  cursor = ruby.end;
 }
 nodes.push(paragraph.text.slice(cursor));
 return <>{nodes}</>;
}
function sourceUrl(value: string): string | null {
 try { const url = new URL(value.trim()); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.hostname === 'ncode.syosetu.com' && /^\/n[0-9a-z]+\/(?:\d+\/)?$/i.test(url.pathname) ? url.href : null; } catch { return null; }
}
export function ReaderScreen(props: ReaderViewState & ReaderActions) {
 const [url, setUrl] = useState(''); const [urlError, setUrlError] = useState(false);
 const content = useRef<HTMLElement>(null);
 const ready = props.job.phase === 'ready' && props.chapter !== null;
 const chapter = ready ? props.chapter : null;
 const busy = ['preparing','translating','validating','saving'].includes(props.job.phase);
 const position = props.position?.chapterId === chapter?.source.chapterId ? props.position : null;
 function restore() {
  if (!position) return;
  const node = Array.from(content.current?.querySelectorAll<HTMLElement>('[data-paragraph-id]') ?? []).find(node => node.dataset.paragraphId === position.paragraphId);
  if (node) {
   // Match capture's viewport-relative offset, independent of CSS scroll-margin.
   const offset = Math.max(0, Math.min(position.offset, Math.max(0, node.offsetHeight - 1)));
   window.scrollBy(0, node.getBoundingClientRect().top + offset);
  }
 }
 useEffect(() => { restore(); }, [chapter?.cacheKey]);
 useEffect(() => {
  if (!chapter) return;
  const save = () => {
   const nodes = Array.from(content.current?.querySelectorAll<HTMLElement>('[data-paragraph-id]') ?? []);
   const node = nodes.find(node => node.getBoundingClientRect().bottom > 0);
   if (node?.dataset.paragraphId) props.onPosition({ chapterId: chapter.source.chapterId, paragraphId: node.dataset.paragraphId, offset: Math.max(0, -node.getBoundingClientRect().top) });
  };
  window.addEventListener('scroll', save, { passive: true }); return () => window.removeEventListener('scroll', save);
 }, [chapter, props.onPosition]);
 const unknown = props.job.phase === 'unknown' || props.job.error?.outcome === 'unknown';
 return <main className="nr-reader">
  <header className="nr-heading"><span className="nr-eyebrow">NAROU READER</span><h1>한 화씩, 천천히.</h1><p>나의 모델로 옮기고, 나의 속도로 읽어요.</p></header>
  <form className="nr-card nr-open" aria-label="회차 열기" onSubmit={event => { event.preventDefault(); const value = sourceUrl(url); setUrlError(!value); if(value) props.onOpen(value); }}>
   <label htmlFor="chapter-url">회차 URL</label><div className="nr-row"><input id="chapter-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="https://ncode.syosetu.com/…" value={url} onChange={event=>setUrl(event.target.value)} aria-invalid={urlError} aria-describedby="url-help" required/><button type="submit">열기</button></div>
   <small id="url-help">접근과 번역이 허용된 회차만 열어주세요.</small>{urlError && <p role="alert">지원하는 HTTPS 회차 주소를 입력해주세요.</p>}
  </form>
  <section className="nr-status" aria-label="번역 상태" aria-live="polite"><strong>{phases[props.job.phase]}</strong>
   {busy && <><p>현재 한 화가 모두 검증·저장되면 본문이 열립니다.</p>{props.job.totalChunks > 0 && <><progress aria-label="번역 진행" value={Math.min(props.job.completedChunks,props.job.totalChunks)} max={props.job.totalChunks}/><small>{props.job.completedChunks} / {props.job.totalChunks} 조각</small></>}<button className="nr-quiet" onClick={props.onCancel}>번역 중단</button></>}
   {props.job.error && <p>{errors[props.job.error.code]}</p>}
   {unknown && <p>다시 시도하면 중복 처리나 추가 비용이 생길 수 있어요. 자동으로 재시도하지 않습니다.</p>}
   {(props.job.phase === 'failed' || props.job.phase === 'unknown') && <button onClick={props.onRetry}>{unknown ? '위험을 확인하고 다시 시도' : props.job.error?.code === 'storage' ? '저장 다시 시도' : '다시 시도'}</button>}
   {props.job.phase === 'paused' && <button onClick={props.onResume}>이어서 번역</button>}
  </section>
  {chapter && <>
   <div className="nr-toolbar"><button className="nr-quiet" aria-pressed={props.showOriginal} onClick={()=>props.onShowOriginal(!props.showOriginal)}>{props.showOriginal ? '번역 보기' : '원문 보기'}</button><label>글자 크기<select value={props.preferences.fontSize} onChange={event=>props.onFontSize(Number(event.target.value))}>{[16,18,20,22,24,28].map(size=><option key={size} value={size}>{size}px</option>)}</select></label>{position && <button className="nr-quiet" onClick={restore}>읽던 위치로</button>}</div>
   <article ref={content} className="nr-chapter" lang={props.showOriginal ? 'ja' : 'ko'} style={{fontSize:`${props.preferences.fontSize}px`}}><span className="nr-eyebrow">{props.showOriginal ? '일본어 원문' : '한국어 번역'}</span><h2>{chapter.source.title}</h2>
    {(props.showOriginal ? chapter.source.paragraphs : chapter.paragraphs.map(paragraph => ({...paragraph,ruby:[]}))).map(paragraph=><p key={paragraph.id} tabIndex={0} data-paragraph-id={paragraph.id} onFocus={()=>props.onPosition({chapterId:chapter.source.chapterId,paragraphId:paragraph.id,offset:0})}><SafeParagraph paragraph={paragraph}/></p>)}
   </article>
   <nav className="nr-navigation" aria-label="회차 이동"><button disabled={!sourceUrl(chapter.source.prevUrl ?? '')} onClick={()=>chapter.source.prevUrl && props.onNavigate(chapter.source.prevUrl)}>이전 화</button><span>한 화를 다 읽었어요</span><button disabled={!sourceUrl(chapter.source.nextUrl ?? '')} onClick={()=>chapter.source.nextUrl && props.onNavigate(chapter.source.nextUrl)}>다음 화</button></nav>
  </>}
 </main>;
}
