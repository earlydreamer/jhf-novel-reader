import { useEffect, useRef, useState } from 'react';
import type { ProviderId, SettingsActions, SettingsViewState } from '../../contracts';
import { GEMINI_BASE_URL, normalizeGeminiBaseUrl, normalizeGeminiModel } from '../../providers/gemini';
import { getLocalConnectionGuidance, normalizeOpenAICompatibleBaseUrl } from '../../providers/openai-compatible';
import '../reader.css';

export function SettingsScreen(props: SettingsViewState & SettingsActions) {
 const [provider, setProvider] = useState(props.config.provider);
 const [baseUrl, setBaseUrl] = useState(props.config.baseUrl);
 const [model, setModel] = useState(props.config.model);
 const [context, setContext] = useState(String(props.config.contextBudget));
 const [output, setOutput] = useState(String(props.config.outputBudget));
 const [cloudAcknowledged, setCloudAcknowledged] = useState(props.config.provider === 'gemini');
 const [error, setError] = useState('');
 const [secretError, setSecretError] = useState('');
 const [pending, setPending] = useState(false);
 const secret = useRef<HTMLInputElement>(null);
 const isGemini = provider === 'gemini';
 let endpointMatches = false;
 try {
  const normalized = isGemini ? normalizeGeminiBaseUrl(baseUrl) : normalizeOpenAICompatibleBaseUrl(baseUrl);
  endpointMatches = provider === props.config.provider && normalized === props.config.baseUrl;
 } catch { /* An invalid draft must never receive a credential. */ }
 const modelMatches = endpointMatches && model.trim() === props.config.model;
 const secretDisabled = pending || props.secretStatus === 'saving' || !endpointMatches;

 useEffect(() => {
  setProvider(props.config.provider); setBaseUrl(props.config.baseUrl); setModel(props.config.model);
  setContext(String(props.config.contextBudget)); setOutput(String(props.config.outputBudget));
  setCloudAcknowledged(props.config.provider === 'gemini'); setError('');
 }, [props.config.provider, props.config.baseUrl, props.config.model, props.config.contextBudget, props.config.outputBudget]);
 useEffect(() => {
  if (secret.current) secret.current.value = '';
  setSecretError('');
 }, [provider, baseUrl]);

 function selectProvider(next: ProviderId) {
  setProvider(next); setCloudAcknowledged(false); setError('');
  if (next === props.config.provider) {
   setBaseUrl(props.config.baseUrl); setModel(props.config.model);
   setContext(String(props.config.contextBudget)); setOutput(String(props.config.outputBudget));
  } else {
   setBaseUrl(next === 'gemini' ? GEMINI_BASE_URL : 'http://localhost:1234/v1');
   // Cloud models and limits vary. Do not carry a local model or budget into a paid provider.
   setModel(''); setContext(''); setOutput('');
  }
 }
 function saveConfig(budgetOnly = false) {
  if (budgetOnly && !modelMatches) return;
  const contextBudget = Number(context), outputBudget = Number(output);
  if (!Number.isSafeInteger(contextBudget) || !Number.isSafeInteger(outputBudget) || outputBudget < 1 || contextBudget <= outputBudget) {
   setError('출력 예산은 1 이상의 정수이며 전체 컨텍스트 예산보다 작아야 합니다.'); return;
  }
  if (isGemini && !cloudAcknowledged) {
   setError('Google 전송과 비용·데이터 처리 조건을 확인하고 동의해주세요.'); return;
  }
  try {
   const endpoint = isGemini ? normalizeGeminiBaseUrl(baseUrl) : normalizeOpenAICompatibleBaseUrl(baseUrl);
   const modelName = isGemini ? normalizeGeminiModel(model) : model.trim();
   if (!modelName || modelName.length > 256) throw new Error();
   props.onConfigChange({provider, baseUrl: endpoint, model: modelName, contextBudget, outputBudget}); setError('');
  } catch { setError(isGemini ? 'Gemini 모델 목록에서 사용할 모델 ID를 확인해주세요.' : '인증·쿼리 없는 HTTP(S) 주소와 모델 이름을 입력해주세요.'); }
 }
 async function saveSecret() {
  const value = secret.current?.value ?? '';
  if (secret.current) secret.current.value = '';
  if (secretDisabled || !value) return;
  setPending(true); setSecretError('');
  try { await props.onSaveSecret(value); }
  catch { setSecretError('인증값을 저장하지 못했습니다. 다시 입력해주세요.'); }
  finally { setPending(false); }
 }
 async function removeSecret() {
  if (secretDisabled) return;
  setPending(true); setSecretError('');
  try { await props.onRemoveSecret(); }
  catch { setSecretError('인증값을 지우지 못했습니다.'); }
  finally { setPending(false); }
 }

 return <section className="nr-settings nr-card" aria-label="번역 설정">
  <span className="nr-eyebrow">내 번역 환경</span><h2>모델 연결</h2>
  <p>{isGemini ? '직접 선택한 Gemini 모델로 번역합니다. 아래 모델과 예산을 입력하고 설정을 적용한 뒤, 이 공급자의 API 키를 저장하세요.' : '휴대폰에서 접근할 수 있는 기존 로컬 모델 서버를 연결하세요.'}</p>
  <form aria-label="모델 설정" onSubmit={event => { event.preventDefault(); saveConfig(); }}>
   <label>번역 공급자<select value={provider} onChange={event => selectProvider(event.target.value as ProviderId)}>
    <option value="openai-compatible">OpenAI 호환 · Ollama / LM Studio</option><option value="gemini">Gemini · Google 클라우드</option>
   </select></label>
   <label>API 기본 주소<input type="url" required readOnly={isGemini} value={baseUrl} inputMode="url" autoCapitalize="none" spellCheck={false} onChange={event => setBaseUrl(event.target.value)} placeholder="http://192.168.1.2:1234/v1" /></label>
   <label>모델 이름<input required value={model} autoCapitalize="none" spellCheck={false} onChange={event => setModel(event.target.value)} /></label>
   {isGemini ? <>
    <small><a href="https://ai.google.dev/gemini-api/docs/models" target="_blank" rel="noreferrer">Gemini 모델 목록</a>에서 사용 가능한 모델 ID와 한도를 확인하세요. 앱은 모델의 가용성이나 최신 한도를 보장하지 않습니다.</small>
    <div id="gemini-notice">
     <p>번역할 원문과 주변 문맥이 Google에 전송되며 사용량에 따라 비용이 발생할 수 있습니다. 무료·유료 서비스와 지역에 따라 데이터 처리 조건이 다릅니다. 무료 서비스의 입력·출력은 제품 개선과 사람의 검토에 사용될 수 있으므로 민감한 내용을 보내지 마세요.</p>
     <p><a href="https://ai.google.dev/gemini-api/docs/pricing" target="_blank" rel="noreferrer">가격 안내</a> · <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">데이터 처리·이용 조건</a></p>
    </div>
    <label className="nr-checkbox"><input type="checkbox" required checked={cloudAcknowledged} aria-describedby="gemini-notice" onChange={event => setCloudAcknowledged(event.target.checked)} />원문과 문맥을 Google에 전송하며 비용·데이터 조건을 확인했습니다.</label>
   </> : <small>HTTP 주소는 암호화되지 않으므로 신뢰하는 로컬 네트워크에서만 사용하세요. {getLocalConnectionGuidance()}</small>}
   <small>모델이나 주소를 바꾸면 진행 중인 작업을 멈추고 새 설정을 적용합니다. 공급자를 바꾸면 인증값을 새로 저장해야 하며 다음 화 미리 번역은 꺼집니다. 연결 실패 시 다른 공급자로 자동 전환하지 않습니다.</small>
   {error && <p role="alert">{error}</p>}<button type="submit">모델 설정 적용</button>
  </form>
  <form aria-label="번역 예산" onSubmit={event => { event.preventDefault(); saveConfig(true); }}>
   <h3>모델 예산</h3>
   <label>전체 컨텍스트 예산<input type="number" min="2" step="1" required value={context} onChange={event => setContext(event.target.value)} /></label>
   <label>출력 예산<input type="number" min="1" step="1" required value={output} onChange={event => setOutput(event.target.value)} /></label>
   <small>모델이 지원하는 토큰 한도 안에서 설정하세요. 앱은 보수적인 바이트 추정치로 문단을 나누며 모델별 정확한 토큰 수를 보장하지 않습니다.</small>
   {!modelMatches && <small>예산을 입력한 뒤 위의 모델 설정 적용 버튼으로 공급자·모델·예산을 함께 저장하세요.</small>}
   <button type="submit" disabled={!modelMatches}>예산 적용</button>
  </form>
  <form aria-label="인증 관리" onSubmit={event => { event.preventDefault(); void saveSecret(); }}>
   <label>{isGemini ? 'Gemini API 키 (필수)' : '인증값 (선택)'}<input ref={secret} type="password" autoComplete="off" spellCheck={false} required={isGemini} disabled={secretDisabled} /></label>
   <small>{!endpointMatches ? '공급자와 API 주소를 먼저 적용해주세요. 적용 전에는 인증값을 저장하거나 지울 수 없습니다.' : isGemini ? '번역 전에 Google Gemini API 키를 저장해야 합니다. 보안 저장소에 저장하며 저장한 값은 다시 표시하지 않습니다.' : '인증이 필요한 서버에만 입력하세요. 보안 저장소에 저장하며 저장한 값은 다시 표시하지 않습니다.'}</small>
   <div className="nr-row"><button disabled={secretDisabled}>인증값 저장</button><button type="button" className="nr-quiet" disabled={secretDisabled || props.secretStatus === 'unset'} onClick={() => void removeSecret()}>인증값 지우기</button></div>
   <p role="status">{!endpointMatches ? '새 설정 적용 대기 중' : pending || props.secretStatus === 'saving' ? '인증값 처리 중' : props.secretStatus === 'saved' ? '인증값 저장됨' : props.secretStatus === 'error' ? '보안 저장소 오류' : '저장된 인증값 없음'}</p>
   {secretError && <p role="alert">{secretError}</p>}
  </form>
  <div className="nr-prefetch"><p id="prefetch-notice">켜면 다음 한 화의 원문을 설정한 모델 서버로 추가 전송합니다. 클라우드 서버라면 사용량에 따른 추가 비용이 발생할 수 있습니다.</p>
   <label className="nr-checkbox"><input type="checkbox" checked={endpointMatches && props.preferences.prefetchEnabled} disabled={!endpointMatches} aria-describedby="prefetch-notice prefetch-help" onChange={event => props.onPrefetchChange(event.target.checked)} />다음 한 화 미리 번역</label>
   <small id="prefetch-help">기본 꺼짐. 현재 화를 저장한 뒤, 앱이 열려 있을 때 다음 한 화만 준비합니다.</small>
  </div>
 </section>;
}
