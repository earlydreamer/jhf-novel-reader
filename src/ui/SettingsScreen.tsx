import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { JSX } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import packageInfo from '../../package.json';
import type {
  CatalogProblem,
  CatalogStatus,
  ConnectionCheckResult,
  RenewalSnapshot,
} from '../app/renewalController';
import type { ConnectionConfig } from '../contracts/reading';
import type { BackupResult } from '../platform/backup';
import { readableModelName } from '../providers/modelName';
import type { ThemePreference } from '../storage/settings';
import { Button } from './components/Button';
import { Chip } from './components/Chip';
import { Dialog } from './components/Modal';
import { LinearProgress } from './components/LinearProgress';
import { ListItem } from './components/ListItem';
import { Switch } from './components/Switch';
import { useSnackbar } from './components/Snackbar';
import { LicensesList } from './LicensesList';
import { ChapterUpdateSettings } from './ChapterUpdateSettings';
import brandLogo from './assets/brand-logo.png';

export interface SettingsScreenProps {
  state: RenewalSnapshot;
  onChange(value: Omit<ConnectionConfig, 'revision' | 'authRef'>): void;
  onCheck(secret: string): Promise<ConnectionCheckResult>;
  onSelect(modelId: string): void;
  onMode?(mode: 'stream' | 'legacy'): void;
  onAutoTranslate?(enabled: boolean): void;
  onAutoRetryFailed?(enabled: boolean): void;
  onAutoGlossary?(enabled: boolean): void;
  onChapterUpdateDays?(days: number): void;
  onLookupWikipedia?(enabled: boolean): void;
  onLookupNamuwiki?(enabled: boolean): void;
  onEnableEmbedding?(): void;
  onDisableEmbedding?(): void;
  onCancelEmbeddingDownload?(): void;
  onRemoveEmbeddingModel?(): void;
  onTheme?(theme: ThemePreference): void;
  /** 백업 파일 만들기·복원(#269). 안드로이드 앱에서만 넘긴다. locked면 번역·스캔이 끝나기를 기다린다. */
  backup?: {
    available: boolean;
    locked: boolean;
    onExport(): Promise<BackupResult>;
    onRestore(): Promise<BackupResult>;
  };
  /** 복원이 끝난 뒤 앱을 다시 불러오는 동작. 시험에서 바꿔 끼운다. */
  onReload?(): void;
}

type LookupSourceKey = 'wikipedia' | 'namuwiki';

/** 바이트를 MB 정수로 바꾼다. 화면은 십진 단위(1MB = 1,000,000바이트)로 통일한다. */
function megabytes(bytes: number): number {
  return Math.round(bytes / 1_000_000);
}

/** 외부 조회를 켜기 전 확인 문구. 보내는 곳과 보내지 않는 것을 그대로 밝힌다. */
const LOOKUP_CONFIRMS: Record<LookupSourceKey, { title: string; body: string }> = {
  wikipedia: {
    title: '위키백과·위키데이터 조회를 켤까요?',
    body: '용어 정밀스캔을 실행할 때 일본어 용어 이름을 ja.wikipedia.org와 www.wikidata.org에 보내요. 회차 본문과 번역문은 보내지 않아요.',
  },
  namuwiki: {
    title: '나무위키 조회를 켤까요?',
    body: '용어 정밀스캔을 실행할 때 일본어 용어 이름을 namu.wiki 검색에 보내요. 회차 본문과 번역문은 보내지 않아요. 가져온 표기에는 나무위키(CC BY-NC-SA 2.0 KR) 출처를 함께 표시해요.',
  },
};

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

function problemMessage(problem: CatalogProblem): string {
  const code = problem.httpStatus ? `(HTTP ${problem.httpStatus})` : '';
  switch (problem.reason) {
    case 'invalid_url':
      return 'API 주소 형식이 올바르지 않아요. http:// 또는 https://로 시작하고 /v1까지만 적어 주세요.';
    case 'network':
      return '서버에 연결하지 못했어요. 주소와 포트, 서버가 켜져 있는지, 같은 네트워크(또는 VPN)에 있는지 확인해 주세요.';
    case 'redirect':
      return `서버가 다른 주소로 보내려고 했어요${code}. 최종 API 주소를 직접 적어 주세요.`;
    case 'http':
      if (problem.httpStatus === 404)
        return '서버가 이 주소를 찾지 못했어요(HTTP 404). API 주소가 /v1로 끝나는지 확인해 주세요.';
      if (problem.httpStatus && problem.httpStatus >= 500)
        return `서버 내부에서 오류가 났어요${code}. 서버 상태를 확인해 주세요.`;
      return `서버가 요청을 처리하지 못했어요${code}. API 주소와 서버 설정을 확인해 주세요.`;
    case 'auth_rejected':
      return `서버가 인증값을 거부했어요${code}. 인증값을 다시 확인해 주세요.`;
    case 'auth_missing':
      return '인증값이 없거나 올바르지 않아요. 인증값을 다시 입력해 주세요.';
    case 'storage':
      return catalogLabels.storage;
    case 'bad_response':
      return '서버 응답에서 모델 목록을 읽지 못했어요. API 주소와 제공자 설정을 확인해 주세요.';
    default:
      return catalogLabels.model_list;
  }
}

function checkResultMessage(result: ConnectionCheckResult): string | null {
  if (result.kind === 'superseded') return null;
  if (result.kind === 'skipped')
    return result.reason === 'busy'
      ? '미리 번역 중에는 연결을 확인할 수 없어요. 번역이 끝난 뒤 다시 확인해 주세요.'
      : result.reason === 'not_ready'
        ? '앱을 준비하고 있어요. 잠시 뒤 다시 확인해 주세요.'
        : catalogLabels.unavailable;
  if (result.problem) return problemMessage(result.problem);
  if (result.status === 'empty')
    return '서버에 연결했지만 번역에 쓸 수 있는 생성 모델이 없어요. 서버에서 모델을 불러와 주세요.';
  if (result.status === 'model_missing')
    return '서버에 연결했지만 선택한 모델이 목록에 없어요. 다른 모델을 골라 주세요.';
  return `서버에 연결했어요. 번역에 쓸 수 있는 모델이 ${result.modelCount}개 있어요.`;
}

const modeLabels = { stream: '읽으며 번역', legacy: '기존 묶음 방식' } as const;
const themeLabels: Record<ThemePreference, string> = {
  system: '시스템 설정 따르기',
  light: '라이트',
  dark: '다크',
};

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
        <div
          key={choice.value}
          className={`nr-list-item${choice.value === value ? ' nr-list-item--current' : ''}`}
        >
          <label className="nr-list-item__main">
            <span className="nr-list-item__text">
              <span className="nr-list-item__headline">{choice.label}</span>
            </span>
            <input
              className="nr-list-item__radio"
              type="radio"
              name={name}
              value={choice.value}
              checked={choice.value === value}
              disabled={choice.disabled}
              onClick={choice.value === value ? () => onSelect(choice.value) : undefined}
              onChange={() => {
                if (choice.disabled) return;
                onSelect(choice.value);
              }}
            />
          </label>
        </div>
      ))}
    </div>
  );
}

type BackupAction = 'export' | 'restore';

/** 백업 결과를 화면 문구로 바꾼다. 취소는 문구가 없다. */
function backupMessage(result: BackupResult, action: BackupAction): string | null {
  switch (result.kind) {
    case 'saved':
      return `백업 파일을 저장했어요. 파일 ${result.files}개를 담았어요.`;
    case 'restored':
      return '복원했어요. 앱을 다시 불러올게요.';
    case 'reload_required':
      return '복원 결과를 확인하지 못했어요. 화면을 다시 불러올게요. 백업을 다시 하려면 앱을 완전히 종료한 뒤 열어 주세요.';
    case 'cancelled':
      return null;
    case 'invalid':
      return '이 앱의 백업 파일이 아니에요. 파일을 다시 골라 주세요.';
    case 'failed':
      return action === 'export'
        ? '백업 파일을 만들지 못했어요. 저장 공간을 확인해 주세요.'
        : '복원하지 못했어요. 지금 데이터는 그대로예요.';
  }
}

const RELOAD_DELAY_MS = 1000;

function timingLabel(state: RenewalSnapshot): string {
  const timings = state.translationTimings;
  if (!timings) return '아직 기록이 없어요';
  return `원문 준비 ${Math.round(timings.sourceMs)}ms · 모델 대기 ${Math.round(timings.modelMs)}ms · 결과 확인·저장 ${Math.round(timings.validationStorageMs)}ms · 리더 표시 ${Math.round(timings.readerDisplayMs)}ms`;
}

/** `http://주소[:포트]/v1` 형식이면 주소와 포트로 나눈다. 다른 형식이면 null. */
export function parsePresetAddress(baseUrl: string): { host: string; port: string } | null {
  const match = /^http:\/\/([^/:?#\s@]+)(?::(\d{1,5}))?\/v1\/?$/i.exec(baseUrl.trim());
  return match ? { host: match[1]!, port: match[2] ?? '' } : null;
}

/** 주소·포트 입력으로 OpenAI 호환 기본 주소를 만든다. 주소가 비면 빈 문자열. */
export function composePresetAddress(host: string, port: string): string {
  const trimmedHost = host.trim();
  if (!trimmedHost) return '';
  const trimmedPort = port.trim();
  return `http://${trimmedHost}${trimmedPort ? `:${trimmedPort}` : ''}/v1`;
}

export function SettingsScreen({
  state,
  onChange,
  onCheck,
  onSelect,
  onMode,
  onAutoTranslate,
  onAutoRetryFailed,
  onAutoGlossary,
  onChapterUpdateDays,
  onLookupWikipedia,
  onLookupNamuwiki,
  onEnableEmbedding,
  onDisableEmbedding,
  onCancelEmbeddingDownload,
  onRemoveEmbeddingModel,
  onTheme,
  backup,
  onReload,
}: SettingsScreenProps): JSX.Element {
  const secret = useRef<HTMLInputElement>(null);
  const showSnackbar = useSnackbar();
  const secretHelpId = useId();
  const addressHelpId = useId();
  const [manualAddress, setManualAddress] = useState(
    () =>
      state.connection.baseUrl.trim() !== '' &&
      parsePresetAddress(state.connection.baseUrl) === null,
  );
  // 같은 목적지인 입력도 편집 중에는 남긴다. 실제 연결이 바뀌면 그 연결의 주소를 표시한다.
  const [manualAddressDraft, setManualAddressDraft] = useState<{
    connection: ConnectionConfig;
    text: string;
  } | null>(null);
  const [host, setHost] = useState(() => parsePresetAddress(state.connection.baseUrl)?.host ?? '');
  const [port, setPort] = useState(() => parsePresetAddress(state.connection.baseUrl)?.port ?? '');
  const [authOpen, setAuthOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [lookupConfirm, setLookupConfirm] = useState<LookupSourceKey | null>(null);
  const [embeddingConfirm, setEmbeddingConfirm] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  // 백업은 한 번에 하나만 한다. 복원이 끝나면 앱을 다시 불러올 때까지 계속 막아 둔다.
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupReloadNeeded, setBackupReloadNeeded] = useState(false);
  const backupReloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [embeddingRemoveConfirm, setEmbeddingRemoveConfirm] = useState(false);
  const embeddingModel = state.embeddingModel;
  const embeddingProgress = embeddingModel?.progress;
  function changeEmbedding(checked: boolean): void {
    // 받는 중에는 토글을 바꾸지 않는다. 중단 버튼으로만 멈춘다.
    if (embeddingModel?.downloading) return;
    if (!checked) {
      onDisableEmbedding?.();
      return;
    }
    // 설치돼 있으면 확인 없이 켜고, 아니면 내려받기 전에 크기와 출처를 먼저 알린다.
    if (embeddingModel?.installed) onEnableEmbedding?.();
    else setEmbeddingConfirm(true);
  }
  function confirmEmbedding(): void {
    setEmbeddingConfirm(false);
    onEnableEmbedding?.();
  }
  function confirmRemoveEmbedding(): void {
    setEmbeddingRemoveConfirm(false);
    onRemoveEmbeddingModel?.();
  }
  function reloadBackup(): void {
    if (backupReloadTimer.current !== null) clearTimeout(backupReloadTimer.current);
    backupReloadTimer.current = null;
    (onReload ?? (() => window.location.reload()))();
  }
  async function runBackup(action: BackupAction): Promise<void> {
    if (!backup || backup.locked || backupBusy) return;
    setBackupBusy(true);
    setBackupNotice(null);
    let result: BackupResult;
    try {
      result = await (action === 'export' ? backup.onExport() : backup.onRestore());
    } catch {
      result = { kind: 'failed' };
    }
    setBackupNotice(backupMessage(result, action));
    if (result.kind === 'restored' || result.kind === 'reload_required') {
      // 데이터가 통째로 바뀌었으므로 화면 상태를 버리고 다시 불러온다. 이 화면이 닫혀도 예약은 그대로 둔다.
      setBackupReloadNeeded(true);
      backupReloadTimer.current = setTimeout(reloadBackup, RELOAD_DELAY_MS);
      return;
    }
    setBackupBusy(false);
  }
  function confirmRestore(): void {
    setRestoreOpen(false);
    void runBackup('restore');
  }
  const lookupAvailable =
    state.termScanAvailable &&
    state.connection.provider === 'openai-compatible' &&
    Boolean(onLookupWikipedia && onLookupNamuwiki);
  function confirmLookup(): void {
    if (lookupConfirm === 'wikipedia') onLookupWikipedia?.(true);
    if (lookupConfirm === 'namuwiki') onLookupNamuwiki?.(true);
    setLookupConfirm(null);
  }
  const [licensesOpen, setLicensesOpen] = useState(false);
  const [version, setVersion] = useState(() =>
    Capacitor.isNativePlatform() ? '버전을 확인하고 있어요.' : `웹 미리보기 ${packageInfo.version}`,
  );

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let mounted = true;
    void App.getInfo().then(
      (info) => {
        if (mounted) setVersion(`버전 ${info.version} (build ${info.build})`);
      },
      () => {
        if (mounted) setVersion('앱 정보를 불러오지 못했어요');
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

  async function runCheck(secret: string): Promise<ConnectionCheckResult | null> {
    let result: ConnectionCheckResult;
    try {
      result = await onCheck(secret);
    } catch {
      showSnackbar(catalogLabels.model_list);
      return null;
    }
    const message = checkResultMessage(result);
    if (message) showSnackbar(message);
    return result;
  }

  async function check(): Promise<ConnectionCheckResult | null> {
    return runCheck(clearSecret());
  }

  /** 목록 없이 모델 행을 누르면 연결을 확인하고, 생성 가능한 모델이 왔을 때만 선택 창을 연다(#176). 실패는 check()가 알린다. */
  async function checkForModel(): Promise<void> {
    const result = await check();
    if (result?.kind === 'done' && result.modelCount > 0) setModelOpen(true);
  }

  async function saveAuth(): Promise<void> {
    const value = clearSecret();
    setAuthOpen(false);
    await runCheck(value);
  }

  function closeAuth(): void {
    clearSecret();
    setAuthOpen(false);
  }

  const checking = state.catalogStatus === 'checking';
  const modelLabel =
    state.models.find((model) => model.id === state.selectedModelId)?.displayName ??
    (state.selectedModelId ? readableModelName(state.selectedModelId) : undefined) ??
    '선택 전';
  const modeDisabled =
    state.translationActive || !!state.batch?.active || !!state.pendingSaveChapter;
  const authDisabled = !state.connectionAvailable || checking || !state.connection.baseUrl;

  return (
    <section className="nr-settings" aria-label="설정">
      <h1 className="nr-visually-hidden">설정</h1>

      <section aria-labelledby="settings-server">
        <h2 id="settings-server">번역 서버</h2>
        <div className="nr-list-item nr-list-item--two-line">
          <div className="nr-list-item__main" role="status">
            <span className="nr-list-item__text">
              <span className="nr-list-item__headline">연결 상태</span>
              <span className="nr-list-item__supporting">
                {state.catalogProblem
                  ? problemMessage(state.catalogProblem)
                  : catalogLabels[state.catalogStatus]}
              </span>
            </span>
          </div>
        </div>
        <Switch
          label="전체 주소 직접 입력"
          description="API 형식이 다르면 켜고 주소 전체를 그대로 적어 주세요."
          checked={manualAddress}
          onChange={(checked) => {
            setManualAddress(checked);
            if (!checked) {
              const parsed = parsePresetAddress(state.connection.baseUrl);
              setHost(parsed?.host ?? '');
              setPort(parsed?.port ?? '');
              // 해석할 수 없는 주소는 지우지 않는다. 사용자가 서버 주소를 적으면 그때 바뀐다.
            }
          }}
        />
        {manualAddress ? (
          <label>
            API 기본 주소
            <input
              type="url"
              disabled={state.batch?.active}
              value={
                manualAddressDraft?.connection === state.connection
                  ? manualAddressDraft.text
                  : state.connection.baseUrl
              }
              onChange={(event) => {
                if (state.batch?.active) return;
                setManualAddressDraft({
                  connection: state.connection,
                  text: event.target.value,
                });
                update({ baseUrl: event.target.value });
              }}
              placeholder="http://192.168.0.10:1234/v1"
            />
          </label>
        ) : (
          <>
            <div className="nr-address-preset">
              <label>
                서버 주소
                <input
                  type="text"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={host}
                  placeholder="192.168.0.10"
                  aria-describedby={addressHelpId}
                  onChange={(event) => {
                    setHost(event.target.value);
                    update({ baseUrl: composePresetAddress(event.target.value, port) });
                  }}
                />
              </label>
              <label>
                포트
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  value={port}
                  placeholder="1234"
                  aria-describedby={addressHelpId}
                  onChange={(event) => {
                    const next = event.target.value.replace(/\D/g, '').slice(0, 5);
                    setPort(next);
                    update({ baseUrl: composePresetAddress(host, next) });
                  }}
                />
              </label>
            </div>
            <div className="nr-address-ports" role="group" aria-label="자주 쓰는 포트">
              <Chip
                label="LM Studio 1234"
                selected={port === '1234'}
                onClick={() => {
                  setPort('1234');
                  update({ baseUrl: composePresetAddress(host, '1234') });
                }}
              />
              <Chip
                label="Ollama 11434"
                selected={port === '11434'}
                onClick={() => {
                  setPort('11434');
                  update({ baseUrl: composePresetAddress(host, '11434') });
                }}
              />
              <Chip
                label="llama.cpp 8080"
                selected={port === '8080'}
                onClick={() => {
                  setPort('8080');
                  update({ baseUrl: composePresetAddress(host, '8080') });
                }}
              />
            </div>
            <p id={addressHelpId}>
              {composePresetAddress(host, port)
                ? `완성 주소: ${composePresetAddress(host, port)}`
                : 'PC의 LAN 주소나 VPN 주소와 서버 포트를 적어 주세요. 기본 포트는 LM Studio 1234, Ollama 11434, llama.cpp 서버 8080이에요.'}
            </p>
          </>
        )}
        {state.connection.authRef ? (
          <ListItem
            headline="인증값"
            supporting="저장됨"
            onClick={() => setAuthOpen(true)}
            trailing={
              <Button variant="text" onClick={() => setAuthOpen(true)}>
                변경
              </Button>
            }
          />
        ) : (
          <>
            <label>
              인증값 (선택)
              <input
                ref={secret}
                type="password"
                autoComplete="off"
                aria-describedby={secretHelpId}
                disabled={!state.connectionAvailable || checking}
              />
            </label>
            <p id={secretHelpId}>
              인증값은 이 기기의 보안 저장소에 저장해요. 인증이 없는 서버라면 비워 두세요.
            </p>
          </>
        )}
        <Button
          variant="tonal"
          size="s"
          disabled={!state.connectionAvailable || checking || !state.connection.baseUrl}
          onClick={() => void check()}
        >
          {checking ? '확인하는 중…' : '연결 확인하기'}
        </Button>
        <ListItem
          headline="모델"
          supporting={modelLabel}
          navigates
          disabled={checking || (state.models.length === 0 && !state.selectedModelId)}
          onClick={() => {
            if (state.models.length > 0) setModelOpen(true);
            else void checkForModel();
          }}
        />
      </section>

      {state.chapterUpdatesAvailable && onChapterUpdateDays && (
        <section aria-labelledby="settings-chapter-updates">
          <h2 id="settings-chapter-updates">새 회차 검사</h2>
          <ChapterUpdateSettings
            key={state.chapterUpdateDays}
            days={state.chapterUpdateDays}
            onSave={onChapterUpdateDays}
          />
        </section>
      )}
      <section aria-labelledby="settings-translation">
        <h2 id="settings-translation">번역 방식</h2>
        {state.streamingAvailable && onMode && (
          <ListItem
            headline="로컬 번역 방식"
            supporting={modeLabels[state.translationMode]}
            navigates
            disabled={modeDisabled}
            onClick={() => setModeOpen(true)}
          />
        )}
        {onAutoTranslate && (
          <Switch
            label="저장본이 없으면 자동으로 번역 시작"
            description="회차를 열면 선택한 모델로 번역해요. 끄면 ‘이 화 번역하기’를 눌러 시작해요."
            checked={state.autoTranslate}
            onChange={onAutoTranslate}
          />
        )}
        {onAutoGlossary && state.connection.provider === 'openai-compatible' && (
          <Switch
            label="번역 전 용어집 자동 생성"
            description="새 이름이 나오면 번역하기 전에 모델로 용어집을 만들어 바로 적용해요. 처음 번역할 때 조금 더 걸리고, 작품 용어집에서 언제든 고칠 수 있어요."
            checked={state.autoGlossary}
            onChange={onAutoGlossary}
          />
        )}
        {onAutoRetryFailed && (
          <Switch
            label="실패한 문단 자동으로 다시 번역"
            description="읽으며 번역에서 검증에 실패한 문단만 한 번 더 번역해요. 추가 모델 요청으로 비용이 생길 수 있어요. 결과를 확인할 수 없는 요청은 자동으로 다시 보내지 않아요."
            checked={state.autoRetryFailed}
            onChange={onAutoRetryFailed}
          />
        )}
        <div className="nr-list-item nr-list-item--two-line">
          <div className="nr-list-item__main">
            <span className="nr-list-item__text">
              <span className="nr-list-item__headline">최근 번역 시간</span>
              <span className="nr-list-item__supporting">{timingLabel(state)}</span>
            </span>
          </div>
        </div>
      </section>

      {lookupAvailable && (
        <section aria-labelledby="settings-term-scan">
          <h2 id="settings-term-scan">용어 정밀스캔</h2>
          <Switch
            label="위키백과·위키데이터에서 찾아보기"
            description="실존 인물·지명의 한국어 표기를 찾아 판정 근거로 써요. 용어 이름만 보내고 회차 본문은 보내지 않아요."
            checked={state.lookupWikipedia}
            onChange={(checked) => {
              if (checked) setLookupConfirm('wikipedia');
              else onLookupWikipedia?.(false);
            }}
          />
          <Switch
            label="나무위키에서 찾아보기"
            description="작품·캐릭터 이름의 한국어 표기를 찾아 판정 근거로 써요. 요청 사이를 띄워서 정밀스캔이 조금 더 걸려요."
            checked={state.lookupNamuwiki}
            onChange={(checked) => {
              if (checked) setLookupConfirm('namuwiki');
              else onLookupNamuwiki?.(false);
            }}
          />
        </section>
      )}

      {state.embeddingAvailable && (
        <section aria-labelledby="settings-embedding">
          <h2 id="settings-embedding">용어 판정</h2>
          <Switch
            label="기기에서 용어 판정 모델 쓰기"
            description="애매한 이름이 그 용어인지 문맥으로 가려요. 판정 모델은 기기 안에서만 돌아가요."
            checked={state.onDeviceEmbedding}
            onChange={changeEmbedding}
          />
          {embeddingModel?.downloading && (
            <>
              <LinearProgress
                label="판정 모델 내려받기"
                value={
                  embeddingProgress && embeddingProgress.total > 0
                    ? embeddingProgress.received / embeddingProgress.total
                    : undefined
                }
              />
              <p>
                {embeddingProgress
                  ? `내려받는 중 · ${megabytes(embeddingProgress.received)}/${megabytes(embeddingProgress.total)}MB`
                  : '내려받는 중'}
              </p>
              <Button variant="text" onClick={() => onCancelEmbeddingDownload?.()}>
                중단
              </Button>
            </>
          )}
          {embeddingModel?.error && <p role="alert">{embeddingModel.error}</p>}
          {embeddingModel?.installed && (
            <div className="nr-list-item nr-list-item--two-line">
              <div className="nr-list-item__main">
                <span className="nr-list-item__text">
                  <span className="nr-list-item__headline">
                    설치된 판정 모델 · {megabytes(embeddingModel.bytes)}MB
                  </span>
                </span>
              </div>
              <Button variant="text" onClick={() => setEmbeddingRemoveConfirm(true)}>
                모델 지우기
              </Button>
            </div>
          )}
        </section>
      )}

      {onTheme && (
        <section aria-labelledby="settings-display">
          <h2 id="settings-display">화면</h2>
          <ListItem
            headline="테마"
            supporting={themeLabels[state.theme]}
            navigates
            onClick={() => setThemeOpen(true)}
          />
        </section>
      )}

      {backup?.available && (
        <section aria-labelledby="settings-backup">
          <h2 id="settings-backup">백업</h2>
          <ListItem
            headline="백업 파일 만들기"
            supporting="서재·저장한 번역·용어집·읽기 위치·설정을 파일 하나로 저장해요."
            disabled={backup.locked || backupBusy}
            onClick={() => void runBackup('export')}
          />
          <ListItem
            headline="백업에서 복원하기"
            supporting="다른 기기나 이전 앱에서 만든 백업 파일을 불러와요."
            disabled={backup.locked || backupBusy}
            onClick={() => setRestoreOpen(true)}
          />
          <p>
            API 키와 기기 판정 모델은 백업에 넣지 않아요. 복원한 뒤 다시 입력하거나 내려받아 주세요.
          </p>
          {backup.locked && <p role="status">번역이나 스캔이 끝난 뒤에 백업할 수 있어요.</p>}
          {backupNotice && <p role="status">{backupNotice}</p>}
          {backupReloadNeeded && (
            <Button variant="text" onClick={reloadBackup}>
              화면 다시 불러오기
            </Button>
          )}
        </section>
      )}

      <section aria-labelledby="settings-info">
        <h2 id="settings-info">정보</h2>
        <ListItem
          headline="오픈소스 라이선스"
          supporting="포함된 오픈소스와 라이선스"
          navigates
          onClick={() => setLicensesOpen(true)}
        />
      </section>

      <footer className="nr-settings-footer">
        <img className="nr-settings-footer__logo" src={brandLogo} alt="" width={96} height={96} />
        <p className="nr-settings-footer__name">JHF Novel Reader</p>
        <p className="nr-settings-footer__version">{version}</p>
      </footer>

      <Dialog
        open={authOpen}
        title="인증값 변경"
        onClose={closeAuth}
        actions={
          <>
            <Button variant="text" onClick={closeAuth}>
              닫기
            </Button>
            <Button variant="text" disabled={authDisabled} onClick={() => void saveAuth()}>
              저장하기
            </Button>
          </>
        }
      >
        <label>
          새 인증값
          <input ref={secret} type="password" autoComplete="off" disabled={authDisabled} />
        </label>
        <p>
          새 인증값은 이 기기의 보안 저장소에 저장해요. 비워 두고 저장하면 기존 인증값을 유지해요.
        </p>
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
        <p>저장된 번역은 어느 방식에서나 읽을 수 있어요.</p>
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
        open={lookupConfirm !== null}
        title={lookupConfirm ? LOOKUP_CONFIRMS[lookupConfirm].title : ''}
        onClose={() => setLookupConfirm(null)}
        actions={
          <>
            <Button variant="text" onClick={() => setLookupConfirm(null)}>
              취소
            </Button>
            <Button variant="text" onClick={confirmLookup}>
              켜기
            </Button>
          </>
        }
      >
        <p>{lookupConfirm ? LOOKUP_CONFIRMS[lookupConfirm].body : ''}</p>
      </Dialog>

      <Dialog
        open={embeddingConfirm}
        title="판정 모델을 내려받을까요?"
        onClose={() => setEmbeddingConfirm(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setEmbeddingConfirm(false)}>
              취소
            </Button>
            <Button variant="text" onClick={confirmEmbedding}>
              내려받기
            </Button>
          </>
        }
      >
        <p>
          EmbeddingGemma 2(약 165MB)를 Hugging Face에서 내려받아 이 기기에 저장해요. Wi-Fi에서 받는
          걸 권장해요. 원문과 번역은 기기 밖으로 보내지 않아요.
        </p>
      </Dialog>

      <Dialog
        open={embeddingRemoveConfirm}
        title="판정 모델을 지울까요?"
        onClose={() => setEmbeddingRemoveConfirm(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setEmbeddingRemoveConfirm(false)}>
              취소
            </Button>
            <Button variant="text" onClick={confirmRemoveEmbedding}>
              지우기
            </Button>
          </>
        }
      >
        <p>다시 쓰려면 다시 내려받아야 해요.</p>
      </Dialog>

      <Dialog
        open={restoreOpen}
        title="백업으로 바꿀까요?"
        onClose={() => setRestoreOpen(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setRestoreOpen(false)}>
              취소
            </Button>
            <Button variant="filled" onClick={confirmRestore}>
              파일 고르기
            </Button>
          </>
        }
      >
        <p>
          지금 기기의 서재·번역·용어집·설정이 백업 파일 내용으로 바뀌어요. 지금 데이터는 지워져요.
        </p>
      </Dialog>

      <Dialog
        open={licensesOpen}
        title="오픈소스 라이선스"
        fullScreen
        onClose={() => setLicensesOpen(false)}
      >
        <LicensesList />
      </Dialog>
    </section>
  );
}
