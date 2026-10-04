import { useRef } from 'react';
import type { CatalogStatus, RenewalSnapshot } from '../app/renewalController';
import type { ConnectionConfig } from '../contracts/reading';
export interface SettingsScreenProps {
  state: RenewalSnapshot;
  onChange(value: Omit<ConnectionConfig, 'revision' | 'authRef'>): void;
  onCheck(secret: string): Promise<void>;
  onSelect(modelId: string): void;
}
const catalogLabels: Record<CatalogStatus, string> = {
  idle: '연결 확인 전',
  checking: '서버와 모델 목록 확인 중',
  connected: '모델 목록 확인됨. 번역 호환성은 아직 검증되지 않았습니다.',
  auth: '인증에 실패했습니다.',
  connection: '서버에 연결하지 못했습니다. 주소를 확인하세요.',
  model_list: '모델 목록을 불러오지 못했습니다.',
  empty: '사용 가능한 생성 모델이 없습니다.',
  model_missing: '선택했던 모델이 목록에서 사라졌습니다. 다시 선택하세요.',
  unavailable: '모델 서버 연결은 아직 사용할 수 없습니다.',
};
export function SettingsScreen({ state, onChange, onCheck, onSelect }: SettingsScreenProps) {
  const secret = useRef<HTMLInputElement>(null);
  function update(value: Partial<Pick<ConnectionConfig, 'provider' | 'baseUrl'>>): void {
    if (secret.current) secret.current.value = '';
    onChange({ provider: state.connection.provider, baseUrl: state.connection.baseUrl, ...value });
  }
  async function check(): Promise<void> {
    const value = secret.current?.value ?? '';
    if (secret.current) secret.current.value = '';
    await onCheck(value);
  }
  const checking = state.catalogStatus === 'checking';
  return (
    <section aria-label="연결 설정">
      <h1>연결 설정</h1>
      <label>
        제공자
        <select
          value={state.connection.provider}
          onChange={(event) =>
            update({ provider: event.target.value === 'gemini' ? 'gemini' : 'openai-compatible' })
          }
        >
          <option value="openai-compatible">LM Studio / Ollama</option>
          <option value="gemini">Google Gemini</option>
        </select>
      </label>
      <p>
        Gemini를 고르면 회차 본문이 Google로 전송되며 비용이 발생할 수 있습니다. 자동으로 다른
        제공자로 전환하지 않습니다.
      </p>
      <label>
        API 기본 주소
        <input
          type="url"
          value={state.connection.baseUrl}
          onChange={(event) => update({ baseUrl: event.target.value })}
          placeholder="http://100.x.x.x:1234/v1"
        />
      </label>
      <label>
        인증값 (선택)
        <input
          ref={secret}
          type="password"
          autoComplete="off"
          disabled={!state.connectionAvailable || checking}
        />
      </label>
      <p>
        인증값은 연결 확인에만 전달하며 화면 상태와 로그에 보관하지 않습니다. 보안 저장은 네이티브
        연결 단계에서 제공합니다.
      </p>
      <div className="nr-row">
        <button
          disabled={!state.connectionAvailable || checking || !state.connection.baseUrl}
          onClick={() => void check()}
        >
          연결 확인
        </button>
        <button
          disabled={!state.connectionAvailable || checking || !state.connection.baseUrl}
          onClick={() => void check()}
        >
          모델 목록 새로고침
        </button>
      </div>
      <p role="status">{catalogLabels[state.catalogStatus]}</p>
      <label>
        모델 선택
        <select
          value={state.selectedModelId ?? ''}
          disabled={checking || state.models.length === 0}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">모델을 선택하세요</option>
          {state.models.map((model) => (
            <option key={model.id} value={model.id} disabled={!model.supportsGeneration}>
              {model.displayName}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
