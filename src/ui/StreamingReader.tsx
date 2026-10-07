import { useRef, type JSX } from 'react';
import type { TranslationScreenProps } from './TranslationScreen';
export function StreamingReader(props: TranslationScreenProps): JSX.Element {
  const body = useRef<HTMLElement>(null);
  const phase = props.state.phase,
    active = props.requestActive;
  const ready = phase === 'ready';
  const texts = (props.state.preview ?? '').split('\n\n');
  const status = ready
    ? '저장 완료'
    : phase === 'saving'
      ? '기기에 저장 중'
      : phase === 'preparing'
        ? '원문 준비 중'
        : phase === 'translating'
          ? '읽으며 번역 중'
          : phase === 'unknown'
            ? '요청 결과 확인 필요'
            : phase === 'failed'
              ? '번역 중단'
              : '번역 준비';
  function position() {
    const element = body.current;
    if (!element) return;
    const rows = [...element.querySelectorAll<HTMLElement>('[data-preview-index]')];
    const row = [...rows].reverse().find((row) => row.offsetTop <= element.scrollTop) ?? rows[0];
    if (row)
      props.onPreviewPosition?.(
        Number(row.dataset.previewIndex),
        Math.max(0, element.scrollTop - row.offsetTop),
      );
  }
  return (
    <section aria-label="회차 번역" className="nr-stream-reader">
      <h1>{props.chapter.title}</h1>
      <div className="nr-stream-toolbar">
        <p role="status" aria-live="polite">
          {status}
          {props.state.progress
            ? ` · ${props.state.progress.completed}/${props.state.progress.total}묶음`
            : ''}
        </p>
        {active && <button onClick={props.onCancel}>중단</button>}
        {ready && (
          <button
            onClick={() => {
              position();
              props.onOpenSaved?.();
            }}
          >
            저장본으로 읽기
          </button>
        )}
        {phase === 'idle' && (
          <button
            disabled={
              !props.available ||
              !props.modelId ||
              props.catalogReady === false ||
              active ||
              props.pendingSaveElsewhere
            }
            onClick={props.onTranslate}
          >
            이 화 번역
          </button>
        )}
      </div>
      {props.catalogStatus === 'checking' && (
        <p role="status">저장된 서버와 모델을 확인하고 있습니다.</p>
      )}
      {props.catalogReady === false && props.catalogStatus !== 'checking' && (
        <p>서버 연결을 확인한 뒤 번역할 수 있습니다.</p>
      )}
      {props.catalogReady === false && props.connection.baseUrl && (
        <button
          disabled={props.catalogStatus === 'checking' || active}
          onClick={props.onCheckConnection}
        >
          연결 다시 확인
        </button>
      )}
      {(!props.modelId || props.catalogReady === false) && (
        <button onClick={props.onSettings}>연결 설정</button>
      )}
      {props.state.preview && (
        <p className="nr-stream-caption">
          {ready ? '기기에 저장했습니다.' : '저장 전 미리보기 · 도착한 문단부터 읽을 수 있어요.'}
        </p>
      )}
      <article
        ref={body}
        tabIndex={0}
        aria-label="번역 미리보기"
        className="nr-reading-body nr-stream-body"
        style={{ fontSize: `${props.fontSize ?? 18}px` }}
        onScroll={position}
      >
        {props.state.preview ? (
          texts.map((text, index) => (
            <p key={index} data-preview-index={index}>
              {text || '\u00a0'}
            </p>
          ))
        ) : (
          <p className="nr-stream-empty">
            {active
              ? '첫 문단이 도착하면 여기에 바로 표시됩니다.'
              : '번역을 시작하면 이 화면에서 바로 읽을 수 있습니다.'}
          </p>
        )}
      </article>
      {phase === 'unknown' && (
        <p role="alert">
          연결이 끊겼거나 기기에서 기다리기를 중단했습니다. 서버가 이미 처리했을 수 있어 자동으로
          다시 보내지 않습니다. 미리보기는 완성 저장본이 아닙니다.
        </p>
      )}
      {phase === 'failed' && (
        <p role="alert">
          {props.state.error?.code === 'input_limit'
            ? '한 문단 또는 참고 메모가 로컬 입력 한도를 넘었습니다. 메모를 줄이거나 기존 묶음 방식을 선택하세요.'
            : props.state.pendingSave
              ? '결과를 기기에 저장하지 못했습니다. 모델 요청 없이 저장을 다시 시도할 수 있습니다.'
              : '번역을 완료하지 못했습니다. 연결과 모델을 확인하세요.'}
        </p>
      )}
      {props.state.pendingSave && (
        <button disabled={active} onClick={props.onRetrySave}>
          모델 요청 없이 저장 다시 시도
        </button>
      )}
      {!props.state.pendingSave && ['failed', 'unknown'].includes(phase) && (
        <button
          disabled={
            active || props.pendingSaveElsewhere || !props.modelId || props.catalogReady === false
          }
          onClick={props.onRetry}
        >
          중복 처리 가능성을 확인하고 다시 번역
        </button>
      )}
      <details>
        <summary>번역 정보</summary>
        <p>
          작은 묶음 실시간 번역 · 최대 8K 입력 창 · {Math.floor(props.state.elapsedMs / 1000)}초
        </p>
        <p>모델: {props.modelId ?? '선택하지 않음'}</p>
        <a href={props.chapter.canonicalUrl} target="_blank" rel="noreferrer">
          회차 원문
        </a>
      </details>
    </section>
  );
}
