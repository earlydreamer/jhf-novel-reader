import type { JSX } from 'react';
import type { ErrorCode } from '../contracts';
import type { ChapterRef, ConnectionConfig, TranslationState } from '../contracts/reading';
export interface TranslationScreenProps {
  chapter: ChapterRef;
  connection: ConnectionConfig;
  modelId: string | null;
  state: TranslationState;
  available: boolean;
  requestActive: boolean;
  pendingSaveElsewhere?: boolean;
  catalogReady?: boolean;
  onCancel?(): void;
  onRetry?(): void;
  onRetrySave?(): void;
  onOpenSaved?(): void;
  onTranslate(): void;
  onSettings(): void;
}
const phases: Record<TranslationState['phase'], string> = {
  idle: '번역 대기',
  preparing: '원문 준비',
  translating: '모델 응답 대기',
  validating: '결과 확인',
  saving: '기기에 저장',
  ready: '읽기 준비 완료',
  failed: '번역 실패',
  unknown: '요청 결과 확인 불가',
};
const errors: Partial<Record<ErrorCode, string>> = {
  auth: '서버 인증에 실패했습니다. 연결 설정을 확인하세요.',
  connection: '서버에 연결하지 못했습니다. 주소와 서버 상태를 확인하세요.',
  source_access: '선택한 회차에 접근하지 못했습니다. 원문을 확인하세요.',
  source_parse: '선택한 회차의 본문을 읽지 못했습니다. 원문을 확인하세요.',
  input_limit:
    '현재 모델 또는 서버의 입력 한도를 넘었습니다. 전체 회차를 나누어 재요청하지 않습니다.',
  output_limit: '출력이 길이 제한으로 잘렸습니다. 완료본으로 저장하지 않았습니다.',
  blocked: '제공자가 응답을 차단했습니다. 다른 제공자로 자동 전환하지 않습니다.',
  invalid_output: '완료된 번역 응답을 확인하지 못했습니다.',
  model_missing: '현재 모델 목록에서 생성 모델을 선택하세요.',
  storage: '기기 저장소를 읽거나 쓰지 못했습니다. 기기 상태를 확인하세요.',
};
export function TranslationScreen(props: TranslationScreenProps): JSX.Element {
  const active = ['preparing', 'translating', 'validating', 'saving'].includes(props.state.phase);
  return (
    <section aria-label="회차 번역">
      <h1>{props.chapter.title}</h1>
      <a href={props.chapter.canonicalUrl} target="_blank" rel="noreferrer">
        회차 원문
      </a>
      <p>
        제공자: {props.connection.provider === 'gemini' ? 'Google Gemini' : 'LM Studio / Ollama'}
      </p>
      <p>모델: {props.modelId ?? '선택하지 않음'}</p>
      {props.catalogReady === false && (
        <p role="status">서버 연결이 확인되지 않았습니다. 연결 설정에서 서버 주소를 확인하세요.</p>
      )}
      {props.catalogReady !== false && !props.modelId && (
        <p role="status">생성 모델이 선택되지 않았습니다. 연결 설정에서 모델을 선택하세요.</p>
      )}
      {(!props.modelId || props.catalogReady === false) && (
        <button onClick={props.onSettings}>연결 설정</button>
      )}
      {!props.available && <p>한 화 번역 연결은 아직 사용할 수 없습니다.</p>}
      {props.requestActive && <p>진행 중인 번역 요청이 끝날 때까지 새 요청을 기다립니다.</p>}
      <button
        disabled={
          !props.available ||
          !props.modelId ||
          props.catalogReady === false ||
          active ||
          props.requestActive ||
          props.pendingSaveElsewhere ||
          props.state.phase !== 'idle'
        }
        onClick={props.onTranslate}
      >
        이 화 번역
      </button>
      {props.requestActive && <button onClick={props.onCancel}>기기에서 기다리기 중단</button>}
      {props.state.pendingSave && (
        <button disabled={props.requestActive} onClick={props.onRetrySave}>
          모델 요청 없이 저장 다시 시도
        </button>
      )}
      {!props.state.pendingSave && ['failed', 'unknown'].includes(props.state.phase) && (
        <button
          disabled={
            props.requestActive ||
            props.pendingSaveElsewhere ||
            !props.modelId ||
            props.catalogReady === false
          }
          onClick={props.onRetry}
        >
          중복 처리 가능성을 확인하고 다시 번역
        </button>
      )}
      {props.state.phase === 'ready' && (
        <button onClick={props.onOpenSaved}>저장된 번역 열기</button>
      )}
      <p role="status">
        {phases[props.state.phase]} · 경과 {Math.floor(props.state.elapsedMs / 1000)}초
      </p>
      {props.state.error && errors[props.state.error.code] && (
        <p role="alert">{errors[props.state.error.code]}</p>
      )}
      {props.state.phase === 'failed' && (
        <p role="alert">
          {props.state.pendingSave
            ? '번역 결과를 기기에 저장하지 못했습니다. 저장만 다시 시도할 수 있습니다.'
            : '번역을 완료하지 못했습니다. 자동으로 다시 요청하지 않습니다.'}
        </p>
      )}
      {props.state.phase === 'unknown' && (
        <p role="alert">
          서버에서 이미 처리했을 수 있습니다. 다시 요청하면 중복 비용이 발생할 수 있습니다.
        </p>
      )}
    </section>
  );
}
