import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';
import packageInfo from '../../package.json';
import type { CatalogStatus, RenewalSnapshot } from '../app/renewalController';
import type { ConnectionConfig } from '../contracts/reading';
import { GEMINI_BASE_URL } from '../providers/gemini';
import type { ThemePreference } from '../storage/settings';
import { Button } from './components/Button';
import { Dialog } from './components/Modal';
import { ListItem } from './components/ListItem';
import { Switch } from './components/Switch';

export interface SettingsScreenProps {
  state: RenewalSnapshot;
  onChange(value: Omit<ConnectionConfig, 'revision' | 'authRef'>): void;
  onCheck(secret: string): Promise<void>;
  onSelect(modelId: string): void;
  onMode?(mode: 'stream' | 'legacy'): void;
  onAutoTranslate?(enabled: boolean): void;
  onAutoRetryFailed?(enabled: boolean): void;
  onTheme?(theme: ThemePreference): void;
}

const catalogLabels: Record<CatalogStatus, string> = {
  idle: '아직 연결을 확인하지 않았어요.',
  checking: '서버와 모델 목록을 확인하고 있어요.',
  connected: '모델 목록을 확인했어요. 번역 호환성은 아직 확인하지 않았어요.',
  auth: '인증값이 맞지 않아요. 다시 입력해 주세요.',
  storage: '인증값을 기기의 보안 저장소에 저장하거나 읽지 못했어요. 기기 상태를 확인해 주세요.',
  connection: '서버에 연결하지 못했어요. API 주소를 확인해 주세요.',
  model_list: '모델 목록을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.',
  empty: '번역에 쓸 수 있는 생성 모델이 없어요.',
  model_missing: '선택한 모델이 목록에서 사라졌어요. 다른 모델을 골라 주세요.',
  unavailable: '이 환경에서는 모델 서버 연결을 아직 사용할 수 없어요.',
};

const providerLabels = {
  'openai-compatible': 'LM Studio / Ollama',
  gemini: 'Google Gemini',
} as const;
const modeLabels = { stream: '읽으며 번역', legacy: '기존 묶음 방식' } as const;
const themeLabels: Record<ThemePreference, string> = {
  system: '시스템 설정 따르기',
  light: '라이트',
  dark: '다크',
};
const noticesUrl = 'https://github.com/earlydreamer/narou-reader/blob/main/';

type RadioChoice = {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
};

function RadioList({
  name,
  label,
  value,
  choices,
  onSelect,
}: {
  readonly name: string;
  readonly label: string;
  readonly value: string | null;
  readonly choices: readonly RadioChoice[];
  readonly onSelect: (value: string) => void;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <ListItem
          key={choice.value}
          headline={choice.label}
          current={choice.value === value}
          disabled={choice.disabled}
          onClick={() => onSelect(choice.value)}
          trailing={
            <input
              type="radio"
              name={name}
              aria-label={choice.label}
              checked={choice.value === value}
              disabled={choice.disabled}
              onChange={() => onSelect(choice.value)}
            />
          }
        />
      ))}
    </div>
  );
}

function timingLabel(state: RenewalSnapshot): string {
  const timings = state.translationTimings;
  if (!timings) return '기록 없음';
  return `원문 준비 ${Math.round(timings.sourceMs)}ms · 모델 대기 ${Math.round(timings.modelMs)}ms · 결과 확인·저장 ${Math.round(timings.validationStorageMs)}ms · 리더 표시 ${Math.round(timings.readerDisplayMs)}ms`;
}

export function SettingsScreen({
  state,
  onChange,
  onCheck,
  onSelect,
  onMode,
  onAutoTranslate,
  onAutoRetryFailed,
  onTheme,
}: SettingsScreenProps): JSX.Element {
  const secret = useRef<HTMLInputElement>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [version, setVersion] = useState(() =>
    Capacitor.isNativePlatform()
      ? 'Android 앱 버전을 확인하고 있어요.'
      : `웹 미리보기 ${packageInfo.version}`,
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let mounted = true;
    void App.getInfo().then(
      (info) => {
        if (mounted) setVersion(`Android 앱 ${info.version} (build ${info.build})`);
      },
      () => {
        if (mounted) setVersion('Android 앱 정보 없음');
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  function clearSecret(): string {
    const value = secret.current?.value ?? '';
    if (secret.current) secret.current.value = '';
    return value;
  }

  function update(value: Partial<Pick<ConnectionConfig, 'provider' | 'baseUrl'>>): void {
    clearSecret();
    onChange({ provider: state.connection.provider, baseUrl: state.connection.baseUrl, ...value });
  }

  async function check(): Promise<void> {
    await onCheck(clearSecret());
  }

  async function saveAuth(): Promise<void> {
    const value = clearSecret();
    setAuthOpen(false);
    await onCheck(value);
  }

  function closeAuth(): void {
    clearSecret();
    setAuthOpen(false);
  }

  function chooseProvider(provider: string): void {
    setProviderOpen(false);
    if (provider === state.connection.provider) return;
    if (provider === 'gemini') {
      setGeminiOpen(true);
      return;
    }
    update({ provider: 'openai-compatible' });
  }

  const checking = state.catalogStatus === 'checking';
  const modelLabel =
    state.models.find((model) => model.id === state.selectedModelId)?.displayName ??
    state.selectedModelId ??
    '선택 전';
  const modeDisabled =
    state.translationActive || !!state.batch?.active || !!state.pendingSaveChapter;

  return (
    <section aria-label="설정">
      <h1 className="nr-visually-hidden">설정</h1>

      <section aria-labelledby="settings-server">
        <h2 id="settings-server">번역 서버</h2>
        <div className="nr-list-item nr-list-item--two-line">
          <div className="nr-list-item__main" role="status">
            <span className="nr-list-item__text">
              <span className="nr-list-item__headline">연결 상태</span>
              <span className="nr-list-item__supporting">{catalogLabels[state.catalogStatus]}</span>
            </span>
          </div>
        </div>
        <ListItem
          headline="제공자"
          supporting={providerLabels[state.connection.provider]}
          mainLabel="제공자"
          onClick={() => setProviderOpen(true)}
        />
        <label>
          API 기본 주소
          <input
            type="url"
            value={state.connection.baseUrl}
            onChange={(event) => update({ baseUrl: event.target.value })}
            placeholder="http://100.x.x.x:1234/v1"
          />
        </label>
        {state.connection.authRef ? (
          <ListItem
            headline="인증값"
            supporting="저장됨"
            mainLabel="인증값"
            onClick={() => setAuthOpen(true)}
            trailing={
              <Button variant="text" onClick={() => setAuthOpen(true)}>
                변경
              </Button>
            }
          />
        ) : (
          <label>
            인증값 (선택)
            <input
              ref={secret}
              type="password"
              autoComplete="off"
              disabled={!state.connectionAvailable || checking}
            />
          </label>
        )}
        <Button
          variant="tonal"
          size="s"
          disabled={!state.connectionAvailable || checking || !state.connection.baseUrl}
          onClick={() => void check()}
        >
          연결 확인하기
        </Button>
        <ListItem
          headline="모델"
          supporting={modelLabel}
          mainLabel="모델"
          disabled={checking || state.models.length === 0}
          onClick={() => setModelOpen(true)}
        />
      </section>

      {state.streamingAvailable && onMode && (
        <section aria-labelledby="settings-translation">
          <h2 id="settings-translation">번역 방식</h2>
          <ListItem
            headline="로컬 번역 방식"
            supporting={modeLabels[state.translationMode]}
            mainLabel="로컬 번역 방식"
            disabled={modeDisabled}
            onClick={() => setModeOpen(true)}
          />
          {onAutoTranslate && (
            <Switch
              label="저장본이 없으면 자동으로 번역 시작"
              description="회차를 열면 선택한 모델로 번역해요. 끄면 ‘이 화 번역하기’를 눌러 시작해요."
              checked={state.autoTranslate}
              onChange={onAutoTranslate}
            />
          )}
          {onAutoRetryFailed && (
            <Switch
              label="실패한 문단 자동으로 다시 번역"
              description="읽으며 번역에서 검증에 실패한 문단만 한 번 더 번역해요. 연결이 끊긴 요청은 자동으로 다시 보내지 않아요."
              checked={state.autoRetryFailed}
              onChange={onAutoRetryFailed}
            />
          )}
        </section>
      )}

      {onTheme && (
        <section aria-labelledby="settings-display">
          <h2 id="settings-display">화면</h2>
          <ListItem
            headline="테마"
            supporting={themeLabels[state.theme]}
            mainLabel="테마"
            onClick={() => setThemeOpen(true)}
          />
        </section>
      )}

      <section aria-labelledby="settings-info">
        <h2 id="settings-info">정보</h2>
        <ListItem headline="버전" supporting={version} mainLabel="버전" onClick={() => {}} />
        <ListItem
          headline="오픈소스 라이선스"
          supporting="THIRD_PARTY_NOTICES.md · android/NOTICE"
          mainLabel="오픈소스 라이선스"
          onClick={() => setLicensesOpen(true)}
        />
        <ListItem
          headline="최근 번역 시간"
          supporting={timingLabel(state)}
          mainLabel="최근 번역 시간"
          onClick={() => {}}
        />
      </section>

      <Dialog
        open={providerOpen}
        title="제공자 선택"
        onClose={() => setProviderOpen(false)}
        actions={
          <Button variant="text" onClick={() => setProviderOpen(false)}>
            닫기
          </Button>
        }
      >
        <RadioList
          name="provider"
          label="제공자 선택"
          value={state.connection.provider}
          choices={[
            { value: 'openai-compatible', label: providerLabels['openai-compatible'] },
            { value: 'gemini', label: providerLabels.gemini },
          ]}
          onSelect={chooseProvider}
        />
      </Dialog>

      <Dialog
        open={geminiOpen}
        title="Gemini를 사용할까요?"
        onClose={() => setGeminiOpen(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setGeminiOpen(false)}>
              닫기
            </Button>
            <Button
              variant="text"
              onClick={() => {
                update({ provider: 'gemini', baseUrl: GEMINI_BASE_URL });
                setGeminiOpen(false);
              }}
            >
              Gemini 사용하기
            </Button>
          </>
        }
      >
        <p>Gemini API 사용량에 따라 비용이 발생할 수 있어요.</p>
        <p>번역할 회차 원문을 Google로 전송해요.</p>
      </Dialog>

      <Dialog
        open={authOpen}
        title="인증값 변경"
        onClose={closeAuth}
        actions={
          <>
            <Button variant="text" onClick={closeAuth}>
              닫기
            </Button>
            <Button variant="text" onClick={() => void saveAuth()}>
              저장하기
            </Button>
          </>
        }
      >
        <label>
          새 인증값
          <input ref={secret} type="password" autoComplete="off" />
        </label>
        <p>비워 두고 저장하면 기존 인증값을 유지해요.</p>
      </Dialog>

      <Dialog
        open={modelOpen}
        title="모델 선택"
        onClose={() => setModelOpen(false)}
        actions={
          <Button variant="text" onClick={() => setModelOpen(false)}>
            닫기
          </Button>
        }
      >
        <RadioList
          name="model"
          label="모델 선택"
          value={state.selectedModelId}
          choices={state.models.map((model) => ({
            value: model.id,
            label: model.displayName,
            disabled: !model.supportsGeneration,
          }))}
          onSelect={(modelId) => {
            onSelect(modelId);
            setModelOpen(false);
          }}
        />
      </Dialog>

      <Dialog
        open={modeOpen}
        title="로컬 번역 방식 선택"
        onClose={() => setModeOpen(false)}
        actions={
          <Button variant="text" onClick={() => setModeOpen(false)}>
            닫기
          </Button>
        }
      >
        <RadioList
          name="translation-mode"
          label="로컬 번역 방식 선택"
          value={state.translationMode}
          choices={[
            { value: 'stream', label: modeLabels.stream },
            { value: 'legacy', label: modeLabels.legacy },
          ]}
          onSelect={(mode) => {
            onMode?.(mode === 'stream' ? 'stream' : 'legacy');
            setModeOpen(false);
          }}
        />
      </Dialog>

      <Dialog
        open={themeOpen}
        title="테마 선택"
        onClose={() => setThemeOpen(false)}
        actions={
          <Button variant="text" onClick={() => setThemeOpen(false)}>
            닫기
          </Button>
        }
      >
        <RadioList
          name="theme"
          label="테마 선택"
          value={state.theme}
          choices={[
            { value: 'system', label: themeLabels.system },
            { value: 'light', label: themeLabels.light },
            { value: 'dark', label: themeLabels.dark },
          ]}
          onSelect={(theme) => {
            if (theme === 'system' || theme === 'light' || theme === 'dark') onTheme?.(theme);
            setThemeOpen(false);
          }}
        />
      </Dialog>

      <Dialog
        open={licensesOpen}
        title="오픈소스 라이선스"
        onClose={() => setLicensesOpen(false)}
        actions={
          <Button variant="text" onClick={() => setLicensesOpen(false)}>
            닫기
          </Button>
        }
      >
        <p>
          <a href={`${noticesUrl}THIRD_PARTY_NOTICES.md`} target="_blank" rel="noreferrer">
            웹 앱 제3자 고지 보기
          </a>
        </p>
        <p>
          <a href={`${noticesUrl}android/NOTICE`} target="_blank" rel="noreferrer">
            Android scaffold 고지 보기
          </a>
        </p>
        <p>Android scaffold의 MIT 고지는 narou-reader 프로젝트 자체 라이선스가 아니에요.</p>
      </Dialog>
    </section>
  );
}
