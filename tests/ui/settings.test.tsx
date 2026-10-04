// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SettingsScreen } from '../../src/ui/SettingsScreen';
import { settings, settingsActions } from './fixtures';
afterEach(cleanup);
describe('SettingsScreen',()=>{
 it('emits config without revision so controller advances revision; default prefetch off',()=>{const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);expect(screen.getByLabelText('다음 한 화 미리 번역')).not.toBeChecked();fireEvent.change(screen.getByLabelText('모델 이름'),{target:{value:'new-local'}});fireEvent.submit(screen.getByRole('form',{name:'모델 설정'}));expect(a.onConfigChange).toHaveBeenCalledWith(expect.objectContaining({model:'new-local'}));expect(a.onConfigChange.mock.calls[0]![0]).not.toHaveProperty('settingsRevision');});
 it.each(['javascript:alert(1)','https://user:secret@example.com','http://localhost:1234/v1?key=secret','ftp://192.168.1.2'])('rejects unsafe endpoint %s',baseUrl=>{const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);fireEvent.change(screen.getByLabelText('API 기본 주소'),{target:{value:baseUrl}});fireEvent.submit(screen.getByRole('form',{name:'모델 설정'}));expect(a.onConfigChange).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeVisible();});
 it('masks and clears ephemeral secret; never includes it in config',async()=>{const a=settingsActions();render(<SettingsScreen {...settings} {...a}/>);const input=screen.getByLabelText('인증값 (선택)');expect(input).toHaveAttribute('type','password');fireEvent.change(input,{target:{value:'synthetic-secret'}});fireEvent.submit(screen.getByRole('form',{name:'인증 관리'}));await waitFor(()=>expect(a.onSaveSecret).toHaveBeenCalledWith('synthetic-secret'));expect(input).toHaveValue('');expect(a.onConfigChange).not.toHaveBeenCalled();});
 it('shows generic secret failure without raw exception',async()=>{const a=settingsActions();a.onSaveSecret.mockRejectedValue(new Error('synthetic-secret'));render(<SettingsScreen {...settings} {...a}/>);fireEvent.change(screen.getByLabelText('인증값 (선택)'),{target:{value:'synthetic-secret'}});fireEvent.submit(screen.getByRole('form',{name:'인증 관리'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('인증값을 저장하지 못했습니다'));expect(screen.queryByText('synthetic-secret')).toBeNull();});
});
