import { useRef, type JSX } from 'react';
import type { BatchState, ChapterRange } from '../translation/batch';
export interface BatchPanelProps {
  workId: string;
  batch?: BatchState | null;
  batchAvailable?: boolean;
  onPrepareBatch?(range: ChapterRange | null, retranslate: boolean): void;
  onRunBatch?(retryUncertain?: boolean): void;
  onCancelBatch?(): void;
  onRetryBatchSave?(): void;
  onSettings?(): void;
}
export function BatchPanel(props: BatchPanelProps): JSX.Element {
  const first = useRef<HTMLInputElement>(null);
  const last = useRef<HTMLInputElement>(null);
  const retranslate = useRef<HTMLInputElement>(null);
  const record = props.batch?.record?.work.workId === props.workId ? props.batch.record : null;
  const active = props.batch?.active ?? false;
  const awaitingSave = record?.phase === 'saving';
  const canPrepare = props.batchAvailable && !active && !awaitingSave;
  return (
    <section aria-label="일괄 번역">
      <h2>미리 번역하기</h2>
      <p>범위나 전체 회차를 확인한 뒤 시작하세요. 완료된 회차는 저장본으로 읽을 수 있습니다.</p>
      {!props.batchAvailable && !active && (
        <p>연결 설정에서 서버와 모델을 확인하면 번역 대상을 준비할 수 있습니다.</p>
      )}
      {!props.batchAvailable && !active && (
        <button onClick={props.onSettings}>일괄 번역 연결 설정</button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onPrepareBatch?.(
            { first: Number(first.current?.value), last: Number(last.current?.value) },
            retranslate.current?.checked ?? false,
          );
        }}
      >
        <fieldset disabled={!canPrepare}>
          <legend>회차 선택</legend>
          <label>
            시작 회차
            <input ref={first} type="number" min={1} step={1} required defaultValue={1} />
          </label>
          <label>
            끝 회차
            <input ref={last} type="number" min={1} step={1} required />
          </label>
          <label>
            <input ref={retranslate} type="checkbox" />
            이미 번역한 회차도 다시 번역
          </label>
          <button type="submit">범위 확인</button>
          <button
            type="button"
            onClick={() => props.onPrepareBatch?.(null, retranslate.current?.checked ?? false)}
          >
            전체 회차 확인
          </button>
        </fieldset>
      </form>
      {props.batch?.preparing && <p role="status">전체 목차와 번역할 회차를 확인하고 있습니다.</p>}
      {props.batch?.error && <p role="alert">{props.batch.error}</p>}
      {record && (
        <div aria-label="확정한 번역 대상">
          <p>
            확정 범위: {record.chapters[0]!.ordinal}–
            {record.chapters[record.chapters.length - 1]!.ordinal}화 · 총 {record.chapters.length}화
          </p>
          <p>모델: {record.selection.modelId}</p>
          <p>
            {record.retranslate
              ? '기존 완성본을 보존하며 새 번역을 추가합니다.'
              : `이미 저장한 ${record.alreadySaved}화는 기본적으로 건너뜁니다.`}
          </p>
          <p role="status">
            처리 {record.cursor}/{record.chapters.length}화 · 새로 저장 {record.completed}화 ·
            건너뜀 {record.skipped}화
          </p>
          {active && !props.batch?.preparing && (
            <p>현재 회차: {record.chapters[record.cursor]?.title ?? '마무리 중'}</p>
          )}
          {props.batch?.chapterProgress && active && (
            <p>
              현재 화 구간: {props.batch.chapterProgress.completed}/
              {props.batch.chapterProgress.total}
            </p>
          )}
          {record.phase === 'prepared' && (
            <button disabled={!canPrepare} onClick={() => props.onRunBatch?.()}>
              확인한 회차 번역 시작
            </button>
          )}
          {record.phase === 'paused' && (
            <>
              <p>일괄 번역이 중단됐습니다. 완료본은 보존했습니다.</p>
              <button
                disabled={!props.batchAvailable || active}
                onClick={() => props.onRunBatch?.()}
              >
                남은 회차 번역 재개
              </button>
            </>
          )}
          {record.phase === 'unknown' && (
            <>
              <p>
                이전 요청 결과를 확인할 수 없습니다. 다시 요청하면 중복 처리나 비용이 발생할 수
                있습니다.
              </p>
              <button
                disabled={!props.batchAvailable || active}
                onClick={() => props.onRunBatch?.(true)}
              >
                중복 처리 가능성을 확인하고 일괄 번역 재개
              </button>
            </>
          )}
          {awaitingSave && (
            <>
              <p>완료한 번역을 저장하지 못했습니다. 새 요청 전에 저장을 마쳐야 합니다.</p>
              <button disabled={active} onClick={props.onRetryBatchSave}>
                모델 요청 없이 일괄 결과 저장 다시 시도
              </button>
            </>
          )}
          {record.phase === 'complete' && (
            <p>일괄 번역 처리를 마쳤습니다. 목차에서 저장된 회차를 열어 읽으세요.</p>
          )}
        </div>
      )}
      {active && <button onClick={props.onCancelBatch}>일괄 번역 중단</button>}
    </section>
  );
}
