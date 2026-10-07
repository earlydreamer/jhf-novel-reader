import type { JSX } from 'react';
import { useEffect, useRef } from 'react';
import type { CompletedTranslation, ReadingPosition, WorkPage } from '../contracts/reading';
import { japaneseBlockIndexes } from '../translation/quality';
export interface ReaderScreenProps {
  version: CompletedTranslation;
  work: WorkPage | null;
  position: ReadingPosition | null;
  fontSize: number;
  showOriginal: boolean;
  sourceChange: 'idle' | 'checking' | 'unchanged' | 'changed' | 'unavailable';
  onDisplayed?(versionId: string): void;
  onFontSize(value: number): void;
  onPosition(blockId: string, offset: number): void;
  onShowOriginal(value: boolean): void;
  onRefreshSource(): void;
  onContents(): void;
  onAdjacent(direction: -1 | 1): void;
}
export function ReaderScreen(props: ReaderScreenProps): JSX.Element {
  const quality = props.version.quality;
  const japaneseBlocks = quality?.japaneseBlocks ?? japaneseBlockIndexes(props.version.blocks);
  const missingTerms = quality?.missingTerms ?? [];
  const body = useRef<HTMLElement>(null);
  const reportDisplayed = props.onDisplayed,
    displayedVersionId = props.version.versionId;
  useEffect(() => {
    reportDisplayed?.(displayedVersionId);
  }, [reportDisplayed, displayedVersionId]);
  const translationPosition = useRef<Pick<ReadingPosition, 'blockId' | 'offset'> | null>(
    props.position,
  );
  useEffect(() => {
    const position = translationPosition.current;
    if (props.showOriginal || !body.current) return;
    if (!position) {
      body.current.scrollTop = 0;
      return;
    }
    const element = Array.from(body.current.querySelectorAll<HTMLElement>('[data-block-id]')).find(
      (value) => value.dataset.blockId === position.blockId,
    );
    if (element) body.current.scrollTop = element.offsetTop + position.offset;
  }, [props.showOriginal]);
  const chapters = props.work?.chapters ?? [];
  const index = chapters.findIndex(
    (chapter) => chapter.chapterId === props.version.source.chapterId,
  );
  function saveScroll(): void {
    if (!body.current || props.showOriginal) return;
    const elements = Array.from(body.current.querySelectorAll<HTMLElement>('[data-block-id]'));
    const block =
      [...elements]
        .reverse()
        .find((element) => element.offsetTop <= (body.current?.scrollTop ?? 0)) ?? elements[0];
    if (block?.dataset.blockId) {
      const offset = Math.max(0, body.current.scrollTop - block.offsetTop);
      translationPosition.current = { blockId: block.dataset.blockId, offset };
      props.onPosition(block.dataset.blockId, offset);
    }
  }
  function jumpToBlock(index: number): void {
    const block = props.version.blocks[index];
    if (!block) return;
    translationPosition.current = { blockId: block.id, offset: 0 };
    props.onPosition(block.id, 0);
    if (props.showOriginal) props.onShowOriginal(false);
    else {
      const element = Array.from(
        body.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [],
      ).find((element) => element.dataset.blockId === block.id);
      if (element && body.current) body.current.scrollTop = element.offsetTop;
    }
    body.current?.focus();
  }
  return (
    <section aria-label="독서 화면">
      <h1>{props.version.source.title}</h1>
      {!!props.version.failedParagraphs?.length && (
        <p role="status">
          번역하지 못한 {props.version.failedParagraphs.length}개 문단은 원문으로 남겼습니다. 본문의
          표시를 확인하세요.
        </p>
      )}
      <nav aria-label="독서 이동">
        <button onClick={props.onContents} disabled={!props.work}>
          목차
        </button>
        <button onClick={() => props.onShowOriginal(!props.showOriginal)}>
          {props.showOriginal ? '번역 보기' : '원문 확인'}
        </button>
        <a href={props.version.source.canonicalUrl} target="_blank" rel="noreferrer">
          원문 사이트
        </a>
        <button disabled={index <= 0} onClick={() => props.onAdjacent(-1)}>
          이전 화
        </button>
        <button
          disabled={index < 0 || index >= chapters.length - 1}
          onClick={() => props.onAdjacent(1)}
        >
          다음 화
        </button>
      </nav>
      {props.sourceChange === 'checking' && <p role="status">원문 변경을 확인하고 있습니다.</p>}
      {props.sourceChange === 'unchanged' && <p role="status">원문이 변경되지 않았습니다.</p>}
      {props.sourceChange === 'changed' && (
        <p role="status">
          원문이 변경되었습니다.{' '}
          <button onClick={props.onRefreshSource}>새 원문으로 번역 준비</button>
        </p>
      )}
      {props.sourceChange === 'unavailable' && <p role="status">원문 변경을 확인할 수 없습니다.</p>}
      <label>
        글자 크기
        <input
          type="range"
          min="10"
          max="48"
          value={props.fontSize}
          onChange={(event) => props.onFontSize(Number(event.target.value))}
        />
      </label>
      <details className="nr-quality" aria-label="번역 확인 표시">
        <summary>
          번역 확인 · 가나가 남은 문단 {japaneseBlocks.length}개 · 확정 표기 미발견{' '}
          {missingTerms.length}개
        </summary>
        <p>
          가나 잔존과 확정 표기의 전체 부재만 확인합니다. 한자만 남은 일본어, 일부 등장분의 다른
          표기, 의미·말투는 원문과 직접 비교해 주세요. 번역 본문은 자동으로 고치거나 다시 요청하지
          않습니다.
        </p>
        {!quality && <p>이 저장본은 용어 확인 기록이 없어 가나 잔존만 확인했습니다.</p>}
        {!japaneseBlocks.length && !missingTerms.length && (
          <p>이 확인 규칙에서 발견한 항목이 없습니다. 번역 품질의 합격 판정은 아닙니다.</p>
        )}
        {japaneseBlocks.length > 0 && (
          <ul>
            {japaneseBlocks.map((index) => (
              <li key={index}>
                <button onClick={() => jumpToBlock(index)}>
                  가나가 남은 {index + 1}번째 문단 보기
                </button>
              </li>
            ))}
          </ul>
        )}
        {missingTerms.length > 0 && (
          <ul>
            {missingTerms.map((term) => (
              <li key={term.source}>
                {term.source} → {term.target}: 번역 전체에서 확정 표기를 찾지 못했습니다.
              </li>
            ))}
          </ul>
        )}
      </details>
      <article
        ref={body}
        className="nr-reading-body"
        tabIndex={0}
        aria-label={props.showOriginal ? '원문 본문' : '번역 본문'}
        onScroll={saveScroll}
        style={{ fontSize: `${props.fontSize}px` }}
      >
        {props.showOriginal
          ? props.version.source.paragraphs.map((paragraph) => (
              <p key={paragraph.id}>{paragraph.text}</p>
            ))
          : props.version.blocks.map((block) => (
              <p key={block.id} data-block-id={block.id}>
                {block.text || '\u00a0'}
              </p>
            ))}
      </article>
    </section>
  );
}
