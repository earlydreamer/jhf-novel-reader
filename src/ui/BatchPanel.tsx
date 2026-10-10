import { useRef, type JSX } from 'react';
import type { BatchState, ChapterRange, CandidateChoice } from '../translation/batch';
import type { RenewalSnapshot } from '../app/renewalController';
import { CandidateReview } from './CandidateReview';
import { Button } from './components/Button';
import { LinearProgress } from './components/LinearProgress';
import { lookupLabel, progressText } from './TermScanPanel';
import { readableModelName } from '../providers/modelName';
export interface BatchPanelProps {
  workId: string;
  batch?: BatchState | null;
  batchAvailable?: boolean;
  onPrepareBatch?(range: ChapterRange | null, retranslate: boolean): void;
  onRunBatch?(retryUncertain?: boolean): void;
  onScanBatch?(): void;
  onConfirmBatchCandidates?(choices: readonly CandidateChoice[]): void;
  /** 정밀스캔으로 후보 표기 채우기. 연결 조건은 fillAllowed로 Application이 정한다. */
  batchFill?: RenewalSnapshot['batchFill'];
  fillAllowed?: boolean;
  onFillBatch?(): void;
  onCancelBatchFill?(): void;
  onCancelBatch?(): void;
  onRetryBatchSave?(): void;
  onSettings?(): void;
  globalBlocked?: boolean;
  /** 작품의 마지막 회차 번호. 기록이 없을 때 끝 회차 칸의 기본값이다. */
  lastOrdinal?: number;
}

type BatchFill = NonNullable<RenewalSnapshot['batchFill']>;

/** 정밀스캔 채우기 구역. 상태별 문구와 버튼만 보여 주고 결과 적용은 CandidateReview가 한다. */
function FillSection({
  fill,
  disabled,
  onFill,
  onCancel,
}: {
  fill: BatchFill | null;
  disabled: boolean;
  onFill(): void;
  onCancel(): void;
}): JSX.Element {
  if (!fill) {
    return (
      <>
        <p>
          모델이 원문 문맥과 한자 뜻을 보고 후보 표기를 채워요. 채운 표기는 확정하기 전에 고칠 수
          있어요.
        </p>
        <Button variant="tonal" disabled={disabled} onClick={onFill}>
          정밀스캔으로 표기 채우기
        </Button>
      </>
    );
  }
  if (fill.phase === 'running') {
    const text = progressText(fill.progress);
    const progress = fill.progress;
    const value = progress && progress.total > 0 ? progress.done / progress.total : undefined;
    return (
      <>
        {text && <p>{text}</p>}
        <LinearProgress label={text ?? '표기 채우기 진행'} value={value} />
        <Button variant="text" onClick={onCancel}>
          중단
        </Button>
      </>
    );
  }
  if (fill.phase === 'failed') {
    return (
      <>
        <p role="alert">{fill.error}</p>
        <Button variant="tonal" disabled={disabled} onClick={onFill}>
          다시 시도하기
        </Button>
      </>
    );
  }
  if (fill.phase === 'cancelled') {
    return (
      <>
        <p>표기 채우기를 중단했어요.</p>
        <Button variant="text" disabled={disabled} onClick={onFill}>
          다시 채우기
        </Button>
      </>
    );
  }
  const result = fill.result;
  if (!result) return <></>;
  return (
    <>
      <p>
        표기 {result.suggestions.length}개를 채웠어요 · 일반어로 판정 {result.common.length}개
      </p>
      {result.skipped > 0 && (
        <p role="status">
          {`이번에 판정하지 못한 후보가 ${result.skipped}개 있어요. 한 번에 등장 횟수가 많은 200개까지 판정해요. 나머지는 직접 확인해 주세요.`}
        </p>
      )}
      {result.counts.unanswered > 0 && (
        <p role="status">모델이 답하지 않은 이름이 {result.counts.unanswered}개 있어요.</p>
      )}
      {result.partial && <p role="status">일부 판정 요청이 실패해서 나머지 결과만 채웠어요.</p>}
      {result.lookupFailed && result.lookupFailed.length > 0 && (
        <p role="status">
          {`${lookupLabel(result.lookupFailed)} 조회가 안 돼서 그 근거 없이 판정했어요.`}
        </p>
      )}
      <Button variant="text" disabled={disabled} onClick={onFill}>
        다시 채우기
      </Button>
    </>
  );
}
export function BatchPanel(props: BatchPanelProps): JSX.Element {
  const first = useRef<HTMLInputElement>(null);
  const last = useRef<HTMLInputElement>(null);
  const retranslate = useRef<HTMLInputElement>(null);
  const record = props.batch?.record?.work.workId === props.workId ? props.batch.record : null;
  const active = props.batch?.active ?? false;
  const awaitingSave = props.batch?.record?.phase === 'saving';
  // 정밀스캔 채우기는 용어집 잠금을 쓰므로 진행 중에는 미리 번역 준비도 막는다.
  const filling = props.batchFill?.phase === 'running';
  const canPrepare =
    props.batchAvailable && !props.globalBlocked && !active && !awaitingSave && !filling;
  // 채우기 결과는 이 기록의 것만 쓴다.
  const fill = record && props.batchFill?.recordId === record.id ? props.batchFill : null;
  const fillResult = fill?.phase === 'done' ? fill.result : undefined;
  // 로컬 서버는 다시 요청해도 비용이 없다. 문구와 버튼은 연결 종류에 맞춘다.
  const local = record?.selection.connection.provider === 'openai-compatible';
  // 범위 칸의 기본값: 기록이 있으면 그 범위, 없으면 1화부터 작품의 마지막 회차까지.
  const rangeKey = record?.id ?? 'none';
  const firstDefault = record?.chapters[0]?.ordinal ?? 1;
  const lastDefault = record?.chapters.at(-1)?.ordinal ?? props.lastOrdinal;
  return (
    <section className="nr-batch-panel" aria-label="일괄 번역">
      <p>범위나 전체 회차를 확인한 뒤 시작해 주세요. 완료한 회차는 저장본으로 읽을 수 있어요.</p>
      {!props.batchAvailable && !active && (
        <p>연결 설정에서 서버와 모델을 확인하면 번역 대상을 준비할 수 있어요.</p>
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
          <div className="nr-batch-range">
            <label>
              시작 회차
              <input
                key={`first:${rangeKey}`}
                ref={first}
                type="number"
                min={1}
                step={1}
                required
                defaultValue={firstDefault}
              />
            </label>
            <label>
              끝 회차
              <input
                key={`last:${rangeKey}`}
                ref={last}
                type="number"
                min={1}
                step={1}
                required
                defaultValue={lastDefault}
              />
            </label>
          </div>
          <label className="nr-batch-retranslate">
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
      {props.batch?.preparing && <p role="status">전체 목차와 번역할 회차를 확인하고 있어요.</p>}
      {props.batch?.scanProgress && (
        <p role="status">
          범위 후보 스캔 {props.batch.scanProgress.completed}/{props.batch.scanProgress.total}화 ·
          모델 요청 없이 원문을 확인하고 있어요.
        </p>
      )}
      {props.batch?.error && <p role="alert">{props.batch.error}</p>}
      {record && (
        <div aria-label="확정한 번역 대상">
          <p>
            확정 범위: {record.chapters[0]!.ordinal}–
            {record.chapters[record.chapters.length - 1]!.ordinal}화 · 총 {record.chapters.length}화
          </p>
          <p>모델: {readableModelName(record.selection.modelId)}</p>
          <p>
            {record.retranslate
              ? '기존 완성본은 그대로 두고 새 번역을 추가해요.'
              : `같은 모델·용어집으로 이미 저장한 ${record.alreadySaved}화는 건너뛰어요.`}
          </p>
          <p role="status">
            처리 {record.cursor}/{record.chapters.length}화 · 새로 저장 {record.completed}화 ·
            건너뜀 {record.skipped}화
          </p>
          {active && !props.batch?.preparing && !props.batch?.scanProgress && (
            <p>현재 회차: {record.chapters[record.cursor]?.title ?? '마무리 중'}</p>
          )}
          {props.batch?.chapterProgress && active && (
            <p>
              현재 화 구간: {props.batch.chapterProgress.completed}/
              {props.batch.chapterProgress.total}
            </p>
          )}
          {record.phase === 'prepared' && record.scan?.status === 'pending' && (
            <>
              <p>
                선택한 범위 전체에서 후보를 한 번 확인해요. 작품 용어집에서 편집한 항목은 먼저
                저장해 주세요.
              </p>
              <button disabled={!canPrepare} onClick={props.onScanBatch}>
                범위 고유명사 후보 스캔
              </button>
            </>
          )}
          {record.phase === 'prepared' && record.scan?.status === 'review' && (
            <>
              {props.fillAllowed && record.scan.candidates.length > 0 && (
                <section aria-label="정밀스캔으로 표기 채우기">
                  <FillSection
                    fill={fill}
                    disabled={!canPrepare}
                    onFill={() => props.onFillBatch?.()}
                    onCancel={() => props.onCancelBatchFill?.()}
                  />
                </section>
              )}
              <CandidateReview
                key={record.id}
                candidates={record.scan.candidates}
                disabled={!canPrepare}
                onConfirm={props.onConfirmBatchCandidates}
                suggestions={fillResult?.suggestions}
                common={fillResult?.common}
              />
            </>
          )}
          {record.scan?.status === 'confirmed' && (
            <p>후보 확인을 마쳤어요. 확정한 작품 용어집으로 각 회차를 순서대로 번역해요.</p>
          )}
          {record.phase === 'prepared' && (!record.scan || record.scan.status === 'confirmed') && (
            <button disabled={!canPrepare} onClick={() => props.onRunBatch?.()}>
              확인한 회차 번역 시작
            </button>
          )}
          {record.phase === 'paused' && (
            <>
              <p>일괄 번역이 중단됐어요. 완료본은 그대로 남아 있어요.</p>
              <button
                disabled={!props.batchAvailable || props.globalBlocked || active}
                onClick={() => props.onRunBatch?.()}
              >
                남은 회차 번역 재개
              </button>
              <p>재개하지 않으려면 위에서 범위를 새로 확인해 주세요.</p>
            </>
          )}
          {record.phase === 'unknown' && (
            <>
              <p>
                {local
                  ? '이전 요청 결과를 확인하지 못했어요. 로컬 서버라 다시 요청해도 비용은 들지 않아요. 재개하면 이 회차를 다시 요청해요.'
                  : '이전 요청 결과를 확인할 수 없어요. 다시 요청하면 중복으로 처리되거나 비용이 생길 수 있어요.'}
              </p>
              <button
                disabled={!props.batchAvailable || props.globalBlocked || active}
                onClick={() => props.onRunBatch?.(true)}
              >
                {local ? '일괄 번역 재개' : '중복 처리 가능성을 확인하고 일괄 번역 재개'}
              </button>
              <p>
                재개하지 않으려면 위에서 범위를 새로 확인해 주세요. 완료한 회차는 그대로 남아요.
              </p>
            </>
          )}
          {record.phase === 'saving' && (
            <>
              <p>완료한 번역을 저장하지 못했어요. 새로 요청하기 전에 저장을 마쳐야 해요.</p>
              <button disabled={active} onClick={props.onRetryBatchSave}>
                모델 요청 없이 일괄 결과 저장 다시 시도
              </button>
            </>
          )}
          {record.phase === 'complete' && (
            <p>일괄 번역을 마쳤어요. 목차에서 저장된 회차를 열어 읽을 수 있어요.</p>
          )}
        </div>
      )}
      {active && <button onClick={props.onCancelBatch}>일괄 번역 중단</button>}
    </section>
  );
}
