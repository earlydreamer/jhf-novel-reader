import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ProviderConfig } from '../contracts';
import { getLocalConnectionGuidance } from '../providers/openai-compatible';
import { ReaderScreen } from '../ui/ReaderScreen';
import { SettingsScreen } from '../ui/SettingsScreen';
import type { ApplicationError, ReaderController } from './controller';
import './application.css';

const errorMessages: Record<ApplicationError, string> = {
  startup: '앱 상태를 확인하지 못했습니다. 앱을 다시 열거나 초기화를 다시 시도해주세요.',
  settings: '설정을 기기에 저장하거나 불러오지 못했습니다. 저장 공간을 확인하고 설정을 다시 적용해주세요.',
  configuration: '모델 설정을 확인해주세요. 지원하는 API 주소, 모델 이름과 예산을 적용해야 합니다.',
  secret: '보안 저장소에서 인증값을 처리하지 못했습니다. 인증 설정을 다시 확인해주세요.',
  position: '읽던 위치를 저장하지 못했습니다. 기기 저장 공간을 확인해주세요.',
  last_chapter: '최근 회차 정보를 저장하거나 불러오지 못했습니다. 다음 실행에서 읽던 회차가 자동으로 열리지 않을 수 있습니다.',
};
function UsageNotice() {
  return <aside className="nr-app-notice" aria-label="사용 범위">
    <strong>narou-reader · 현재 한 화 읽기</strong>
    <p>네트워크 번역과 보안 저장은 Android 네이티브 앱에서만 사용할 수 있습니다. 웹 화면에서는 실제 원문·모델 요청을 보내지 않습니다.</p>
    <p>접근과 번역이 허용된 공개 회차만 사용하세요. 로그인, 연령 확인, 접근 제한을 우회하지 않습니다. 원문은 설정한 모델 서버로 전송됩니다.</p>
    <p>다음 한 화 미리 번역은 기본 꺼짐이며 설정에서 켤 수 있습니다. 현재 화를 저장한 뒤 앱이 전면에 있을 때만 준비합니다. 앱이 닫히거나 백그라운드로 전환되면 새 번역 요청을 멈춥니다.</p>
  </aside>;
}
function BudgetSettings({ config, apply }: { config: ProviderConfig; apply(config: Omit<ProviderConfig, 'settingsRevision'>): void }) {
  const [context, setContext] = useState(String(config.contextBudget));
  const [output, setOutput] = useState(String(config.outputBudget));
  const [error, setError] = useState('');
  useEffect(() => { setContext(String(config.contextBudget)); setOutput(String(config.outputBudget)); }, [config.contextBudget, config.outputBudget]);
  return <section className="nr-settings nr-card" aria-label="번역 예산"><h2>모델 예산</h2>
    <form onSubmit={event => {
      event.preventDefault();
      const contextBudget = Number(context), outputBudget = Number(output);
      if (!Number.isSafeInteger(contextBudget) || !Number.isSafeInteger(outputBudget) || outputBudget < 1 || contextBudget <= outputBudget) {
        setError('출력 예산은 1 이상의 정수이며 전체 컨텍스트 예산보다 작아야 합니다.'); return;
      }
      setError(''); apply({ ...config, contextBudget, outputBudget });
    }}>
      <label>전체 컨텍스트 예산<input type="number" min="2" step="1" required value={context} onChange={event => setContext(event.target.value)} /></label>
      <label>출력 예산<input type="number" min="1" step="1" required value={output} onChange={event => setOutput(event.target.value)} /></label>
      <small>모델이 지원하는 토큰 한도 안에서 설정하세요. 앱은 보수적인 바이트 추정치로 문단을 나누며 모델별 정확한 토큰 수를 보장하지 않습니다.</small>
      {error && <p role="alert">{error}</p>}<button type="submit">예산 적용</button>
    </form>
  </section>;
}
function ConnectedApplication({ controller }: { controller: ReaderController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { void controller.initialize(); return () => { void controller.dispose(); }; }, [controller]);
  return <div className="nr-application" lang="ko">
    <UsageNotice />
    {state.appError && <div className="nr-app-error" role="alert">{errorMessages[state.appError]}</div>}
    {!state.initialized && <section className="nr-app-notice"><p>기기에 저장된 설정을 준비하고 있습니다.</p>{state.appError && <button onClick={() => void controller.initialize()}>초기화 다시 시도</button>}</section>}
    <fieldset className="nr-app-controls" disabled={!state.initialized}>
      <SettingsScreen {...state.settings} {...controller.settingsActions} />
      <p className="nr-app-notice">{getLocalConnectionGuidance()}</p>
      <BudgetSettings config={state.settings.config} apply={controller.settingsActions.onConfigChange} />
      <ReaderScreen {...state.reader} {...controller.readerActions} />
    </fieldset>
  </div>;
}
export function Application({ controller }: { controller: ReaderController | null }) {
  if (controller) return <ConnectedApplication controller={controller} />;
  return <main className="nr-application" lang="ko"><UsageNotice /><section className="nr-app-notice"><h1>Android 앱에서 열어주세요</h1><p>이 브라우저에서는 네이티브 네트워크·파일·보안 저장소를 사용할 수 없습니다.</p></section></main>;
}
