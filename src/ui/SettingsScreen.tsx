import { useEffect, useRef, useState } from 'react';
import type { SettingsActions, SettingsViewState } from '../contracts';
import './reader.css';
export function SettingsScreen(props: SettingsViewState & SettingsActions) {
 const [baseUrl,setBaseUrl]=useState(props.config.baseUrl); const [model,setModel]=useState(props.config.model);
 const [error,setError]=useState(''); const [secretError,setSecretError]=useState(''); const [pending,setPending]=useState(false);
 const secret=useRef<HTMLInputElement>(null);
 useEffect(()=>{setBaseUrl(props.config.baseUrl);setModel(props.config.model);},[props.config.baseUrl,props.config.model]);
 function saveConfig() {
  try { const url=new URL(baseUrl.trim()); if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!model.trim()) throw new Error();
   const {settingsRevision: _revision,...config}=props.config; props.onConfigChange({...config,baseUrl:url.href.replace(/\/$/,''),model:model.trim()}); setError('');
  } catch { setError('인증·쿼리 없는 HTTP(S) 주소와 모델 이름을 입력해주세요.'); }
 }
 async function saveSecret() {
  const value=secret.current?.value ?? ''; if(secret.current) secret.current.value=''; if(!value) return;
  setPending(true);setSecretError('');try{await props.onSaveSecret(value);}catch{setSecretError('인증값을 저장하지 못했습니다. 다시 입력해주세요.');}finally{setPending(false);}
 }
 async function removeSecret(){setPending(true);setSecretError('');try{await props.onRemoveSecret();}catch{setSecretError('인증값을 지우지 못했습니다.');}finally{setPending(false);}}
 return <section className="nr-settings nr-card" aria-label="번역 설정"><span className="nr-eyebrow">내 번역 환경</span><h2>모델 연결</h2><p>휴대폰에서 접근할 수 있는 기존 로컬 모델 서버를 연결하세요.</p>
  <form aria-label="모델 설정" onSubmit={event=>{event.preventDefault();saveConfig();}}>
   <label>번역 공급자<select value={props.config.provider} disabled><option value="openai-compatible">OpenAI 호환 · Ollama / LM Studio</option><option value="gemini">Gemini · 후속 지원</option></select></label>
   <label>API 기본 주소<input type="url" required value={baseUrl} inputMode="url" autoCapitalize="none" spellCheck={false} onChange={event=>setBaseUrl(event.target.value)} placeholder="http://192.168.1.2:1234/v1"/></label>
   <label>모델 이름<input required value={model} autoCapitalize="none" spellCheck={false} onChange={event=>setModel(event.target.value)}/></label>
   <small>모델이나 주소를 바꾸면 이전 작업과 구분해 새 설정을 적용합니다. HTTP 주소는 암호화되지 않으므로 신뢰하는 로컬 네트워크에서만 사용하세요.</small>
   {error && <p role="alert">{error}</p>}<button type="submit">모델 설정 적용</button>
  </form>
  <form aria-label="인증 관리" onSubmit={event=>{event.preventDefault();void saveSecret();}}><label>인증값 (선택)<input ref={secret} type="password" autoComplete="off" spellCheck={false} disabled={pending} /></label><small>인증이 필요한 서버에만 입력하세요. 보안 저장소에 저장하며 저장한 값은 다시 표시하지 않습니다.</small><div className="nr-row"><button disabled={pending || props.secretStatus==='saving'}>인증값 저장</button><button type="button" className="nr-quiet" disabled={pending || props.secretStatus==='saving' || props.secretStatus==='unset'} onClick={()=>void removeSecret()}>인증값 지우기</button></div>
   <p role="status">{pending || props.secretStatus==='saving' ? '인증값 처리 중' : props.secretStatus==='saved' ? '인증값 저장됨' : props.secretStatus==='error' ? '보안 저장소 오류' : '저장된 인증값 없음'}</p>{secretError && <p role="alert">{secretError}</p>}
  </form>
  <div className="nr-prefetch"><p id="prefetch-notice">켜면 다음 한 화의 원문을 설정한 모델 서버로 추가 전송합니다. 클라우드 서버라면 사용량에 따른 추가 비용이 발생할 수 있습니다.</p><label className="nr-checkbox"><input type="checkbox" checked={props.preferences.prefetchEnabled} aria-describedby="prefetch-notice prefetch-help" onChange={event=>props.onPrefetchChange(event.target.checked)}/>다음 한 화 미리 번역</label><small id="prefetch-help">기본 꺼짐. 현재 화를 저장한 뒤, 앱이 열려 있을 때 다음 한 화만 준비합니다.</small></div>
 </section>;
}
