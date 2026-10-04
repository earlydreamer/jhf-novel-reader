import type { ChapterRef, ConnectionConfig, TranslationState } from '../contracts/reading';
export interface TranslationScreenProps { chapter: ChapterRef; connection: ConnectionConfig; modelId: string | null; state: TranslationState; available: boolean; onTranslate(): void; onSettings(): void }
const phases: Record<TranslationState['phase'], string> = { idle: '번역 대기', preparing: '원문 준비', translating: '모델 응답 대기', validating: '결과 확인', saving: '기기에 저장', ready: '읽기 준비 완료', failed: '번역 실패', unknown: '요청 결과 확인 불가' };
export function TranslationScreen(props: TranslationScreenProps) {
  const active = ['preparing', 'translating', 'validating', 'saving'].includes(props.state.phase);
  return <section aria-label="회차 번역">
    <h1>{props.chapter.title}</h1>
    <a href={props.chapter.canonicalUrl} target="_blank" rel="noreferrer">회차 원문</a>
    <p>제공자: {props.connection.provider === 'gemini' ? 'Google Gemini' : 'LM Studio / Ollama'}</p>
    <p>모델: {props.modelId ?? '선택하지 않음'}</p>
    {!props.modelId && <button onClick={props.onSettings}>연결 설정</button>}
    {!props.available && <p>한 화 번역 연결은 아직 사용할 수 없습니다.</p>}
    <button disabled={!props.available || !props.modelId || active || props.state.phase !== 'idle'} onClick={props.onTranslate}>이 화 번역</button>
    <p role="status">{phases[props.state.phase]} · 경과 {Math.floor(props.state.elapsedMs / 1000)}초</p>
    {props.state.phase === 'failed' && <p role="alert">번역을 완료하지 못했습니다. 자동으로 다시 요청하지 않습니다.</p>}
    {props.state.phase === 'unknown' && <p role="alert">서버에서 이미 처리했을 수 있습니다. 다시 요청하면 중복 비용이 발생할 수 있습니다.</p>}
  </section>;
}
