import type { JSX } from 'react';
import { useRef } from 'react';
import type { CatalogStatus, RenewalSnapshot } from '../app/renewalController';
import type { ConnectionConfig, LocalTranslationLimits } from '../contracts/reading';
import { DEFAULT_LOCAL_LIMITS } from '../translation/segments';
export interface SettingsScreenProps {
  state: RenewalSnapshot;
  onChange(value: Omit<ConnectionConfig, 'revision' | 'authRef'>): void;
  onCheck(secret: string): Promise<void>;
  onSelect(modelId: string): void;
  onLimits?(limits?: LocalTranslationLimits): void;
}
const catalogLabels: Record<CatalogStatus, string> = {
  idle: '연결 확인 전',
  checking: '서버와 모델 목록 확인 중',
  connected: '모델 목록 확인됨. 번역 호환성은 아직 검증되지 않았습니다.',
  auth: '인증에 실패했습니다.',
  storage:
    '인증값을 기기의 보안 저장소에 저장하거나 읽지 못했습니다. 기기 상태를 확인한 뒤 다시 시도하세요.',
  connection: '서버에 연결하지 못했습니다. 주소를 확인하세요.',
  model_list: '모델 목록을 불러오지 못했습니다.',
  empty: '사용 가능한 생성 모델이 없습니다.',
  model_missing: '선택했던 모델이 목록에서 사라졌습니다. 다시 선택하세요.',
  unavailable: '모델 서버 연결은 아직 사용할 수 없습니다.',
};
export function SettingsScreen({
  state,
  onChange,
  onCheck,
  onSelect,
  onLimits,
}: SettingsScreenProps): JSX.Element {
  const secret = useRef<HTMLInputElement>(null);
  const context = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const output = useRef<HTMLInputElement>(null);
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
        연결 확인 시 입력한 인증값을 기기의 보안 저장소에 저장합니다. 화면 상태·일반 설정·로그에는
        보관하지 않습니다. 인증이 없는 서버는 비워 두세요.
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
      {state.connection.provider === 'openai-compatible' && (
        <fieldset disabled={state.translationActive || !state.selectedModelId}>
          <legend>한 화 번역 방식</legend>
          <label>
            <input
              type="checkbox"
              checked={!!state.localLimits}
              onChange={(event) =>
                onLimits?.(event.target.checked ? DEFAULT_LOCAL_LIMITS : undefined)
              }
            />
            컨텍스트에 맞춰 나누어 번역
          </label>
          <p>나눈 구간을 순서대로 번역하고, 한 화가 전부 완성되면 저장합니다.</p>
          {state.localLimits && (
            <form
              key={JSON.stringify(state.localLimits)}
              onSubmit={(event) => {
                event.preventDefault();
                onLimits?.({
                  contextTokens: Number(context.current?.value),
                  inputBudgetTokens: Number(input.current?.value),
                  maxOutputTokens: Number(output.current?.value),
                });
              }}
            >
              <label>
                컨텍스트 크기 (토큰)
                <input
                  ref={context}
                  type="number"
                  min={1024}
                  max={262144}
                  step={1}
                  required
                  defaultValue={state.localLimits.contextTokens}
                />
              </label>
              <label>
                구간 입력 예산 (추정 토큰)
                <input
                  ref={input}
                  type="number"
                  min={512}
                  max={32768}
                  step={1}
                  required
                  defaultValue={state.localLimits.inputBudgetTokens}
                />
              </label>
              <label>
                구간 출력 상한 (토큰)
                <input
                  ref={output}
                  type="number"
                  min={256}
                  max={65536}
                  step={1}
                  required
                  defaultValue={state.localLimits.maxOutputTokens}
                />
              </label>
              <p>
                서버에 로드한 크기와 모델의 지원 크기 중 작은 값을 쓰세요. Hy-MT2는 8192입니다.
                입력은 보수적으로 추정하며 정확한 모델 토큰 수와 다를 수 있습니다. 출력과 별도로
                여유 512토큰을 확보합니다.
              </p>
              <button type="submit">번역 크기 설정 저장</button>
            </form>
          )}
        </fieldset>
      )}
    </section>
  );
}
