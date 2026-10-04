// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsScreen } from '../../src/ui/legacy/SettingsScreen';
import { settings, settingsActions } from './fixtures';
afterEach(cleanup);
describe('SettingsScreen',()=>{
 it('emits config without revision so controller advances revision; default prefetch off',()=>{const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);expect(screen.getByLabelText('다음 한 화 미리 번역')).not.toBeChecked();fireEvent.change(screen.getByLabelText('모델 이름'),{target:{value:'new-local'}});fireEvent.submit(screen.getByRole('form',{name:'모델 설정'}));expect(a.onConfigChange).toHaveBeenCalledWith(expect.objectContaining({model:'new-local'}));expect(a.onConfigChange.mock.calls[0]![0]).not.toHaveProperty('settingsRevision');});
 it.each(['javascript:alert(1)','https://user:secret@example.com','http://localhost:1234/v1?key=secret','ftp://192.168.1.2'])('rejects unsafe endpoint %s',baseUrl=>{const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);fireEvent.change(screen.getByLabelText('API 기본 주소'),{target:{value:baseUrl}});fireEvent.submit(screen.getByRole('form',{name:'모델 설정'}));expect(a.onConfigChange).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeVisible();});
 it('masks and clears ephemeral secret; never includes it in config',async()=>{const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);const input=screen.getByLabelText('인증값 (선택)');expect(input).toHaveAttribute('type','password');fireEvent.change(input,{target:{value:'synthetic-secret'}});fireEvent.submit(screen.getByRole('form',{name:'인증 관리'}));await waitFor(()=>expect(a.onSaveSecret).toHaveBeenCalledWith('synthetic-secret'));expect(input).toHaveValue('');expect(a.onConfigChange).not.toHaveBeenCalled();});
 it('shows generic secret failure without raw exception',async()=>{const a=settingsActions();a.onSaveSecret.mockRejectedValue(new Error('synthetic-secret'));render(<SettingsScreen {...settings} {...a}/>);fireEvent.change(screen.getByLabelText('인증값 (선택)'),{target:{value:'synthetic-secret'}});fireEvent.submit(screen.getByRole('form',{name:'인증 관리'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('인증값을 저장하지 못했습니다'));expect(screen.queryByText('synthetic-secret')).toBeNull();});
 it('requires explicit Gemini model, budgets and cloud acknowledgment before applying',()=>{
  const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);
  const provider=screen.getByLabelText('번역 공급자');expect(provider).toBeEnabled();
  fireEvent.change(provider,{target:{value:'gemini'}});
  expect(screen.getByLabelText('모델 이름')).toHaveValue('');
  expect(screen.getByLabelText('전체 컨텍스트 예산')).toHaveValue(null);
  expect(screen.getByLabelText('출력 예산')).toHaveValue(null);
  expect(screen.getByLabelText('API 기본 주소')).toHaveValue('https://generativelanguage.googleapis.com/v1beta');
  expect(screen.getByLabelText('API 기본 주소')).toHaveAttribute('readonly');
  expect(screen.getByRole('link',{name:'Gemini 모델 목록'})).toHaveAttribute('href','https://ai.google.dev/gemini-api/docs/models');
  expect(screen.getByRole('link',{name:'가격 안내'})).toHaveAttribute('href','https://ai.google.dev/gemini-api/docs/pricing');
  expect(screen.getByRole('link',{name:'데이터 처리·이용 조건'})).toHaveAttribute('href','https://ai.google.dev/gemini-api/terms');
  fireEvent.change(screen.getByLabelText('모델 이름'),{target:{value:'models/synthetic-gemini'}});
  fireEvent.change(screen.getByLabelText('전체 컨텍스트 예산'),{target:{value:'8192'}});
  fireEvent.change(screen.getByLabelText('출력 예산'),{target:{value:'2048'}});
  fireEvent.submit(screen.getByRole('form',{name:'모델 설정'}));expect(a.onConfigChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox',{name:/Google에 전송/}));
  fireEvent.submit(screen.getByRole('form',{name:'모델 설정'}));
  expect(a.onConfigChange).toHaveBeenCalledWith({provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini',contextBudget:8192,outputBudget:2048});
 });
 it('blocks credential operations and clears input for an unapplied provider change',()=>{
  const a=settingsActions();render(<SettingsScreen {...settings} secretStatus="saved" {...a}/>);
  fireEvent.change(screen.getByLabelText('인증값 (선택)'),{target:{value:'synthetic-local-secret'}});
  fireEvent.change(screen.getByLabelText('번역 공급자'),{target:{value:'gemini'}});
  const key=screen.getByLabelText('Gemini API 키 (필수)');expect(key).toHaveValue('');expect(key).toBeDisabled();
  expect(screen.getByRole('button',{name:'인증값 저장'})).toBeDisabled();expect(screen.getByRole('button',{name:'인증값 지우기'})).toBeDisabled();
  expect(screen.getByRole('checkbox',{name:'다음 한 화 미리 번역'})).toBeDisabled();
  fireEvent.change(key,{target:{value:'synthetic-cloud-secret'}});fireEvent.submit(screen.getByRole('form',{name:'인증 관리'}));
  expect(a.onSaveSecret).not.toHaveBeenCalled();
 });
 it('requires applying endpoint changes before saving a secret',()=>{
  const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);
  fireEvent.change(screen.getByLabelText('API 기본 주소'),{target:{value:'http://192.168.1.3:1234/v1'}});
  expect(screen.getByRole('button',{name:'인증값 저장'})).toBeDisabled();
 });
 it('requires fresh acknowledgment when returning to a Gemini draft',()=>{
  const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);
  fireEvent.change(screen.getByLabelText('번역 공급자'),{target:{value:'gemini'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/Google에 전송/}));
  fireEvent.change(screen.getByLabelText('번역 공급자'),{target:{value:'openai-compatible'}});
  fireEvent.change(screen.getByLabelText('번역 공급자'),{target:{value:'gemini'}});
  expect(screen.getByRole('checkbox',{name:/Google에 전송/})).not.toBeChecked();
 });
 it.each(['','0','1','1.5','9007199254740992'])('rejects invalid context budget %s',context=>{
  const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);
  fireEvent.change(screen.getByLabelText('전체 컨텍스트 예산'),{target:{value:context}});
  fireEvent.submit(screen.getByRole('form',{name:'번역 예산'}));expect(a.onConfigChange).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeVisible();
 });
 it('enables required Gemini key only after its config is applied',async()=>{
  const a=settingsActions();const gemini={...settings,config:{...settings.config,provider:'gemini' as const,baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini'}};
  render(<SettingsScreen {...gemini} {...a}/>);
  const key=screen.getByLabelText('Gemini API 키 (필수)');expect(key).toBeEnabled();expect(key).toBeRequired();
  fireEvent.change(key,{target:{value:'synthetic-gemini-key'}});fireEvent.submit(screen.getByRole('form',{name:'인증 관리'}));
  await waitFor(()=>expect(a.onSaveSecret).toHaveBeenCalledWith('synthetic-gemini-key'));expect(key).toHaveValue('');
 });

 it('does not let budget-only apply activate an unconfirmed provider draft',()=>{
  const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);
  fireEvent.change(screen.getByLabelText('번역 공급자'),{target:{value:'gemini'}});
  fireEvent.change(screen.getByLabelText('모델 이름'),{target:{value:'synthetic-gemini'}});
  fireEvent.change(screen.getByLabelText('전체 컨텍스트 예산'),{target:{value:'8192'}});
  fireEvent.change(screen.getByLabelText('출력 예산'),{target:{value:'2048'}});
  expect(screen.getByRole('button',{name:'예산 적용'})).toBeDisabled();
  fireEvent.submit(screen.getByRole('form',{name:'번역 예산'}));expect(a.onConfigChange).not.toHaveBeenCalled();
 });
 it('shows only cloud guidance for an applied Gemini provider',()=>{
  const a=settingsActions();render(<SettingsScreen {...settings} config={{...settings.config,provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini'}} {...a}/>);
  expect(screen.queryByText(/휴대폰에서 접근할 수 있는 기존 로컬/)).toBeNull();expect(screen.queryByText(/HTTP 주소는 암호화되지/)).toBeNull();
  expect(screen.getByText(/번역 전에 Google Gemini API 키/)).toBeVisible();
 });

});
