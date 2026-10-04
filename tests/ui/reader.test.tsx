// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReaderError } from '../../src/contracts';
import { ReaderScreen } from '../../src/ui/legacy/ReaderScreen';
import { reader, actions } from './fixtures';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('ReaderScreen',()=>{
 it.each(['idle','preparing','translating','validating','saving','failed','unknown','paused'] as const)('hides chapter before ready: %s',phase=>{render(<ReaderScreen {...reader} {...actions()} job={{phase,completedChunks:1,totalChunks:2}}/>);expect(screen.queryByText('빗소리가 잦아들었다.')).toBeNull();expect(screen.queryByRole('article')).toBeNull();});
 it('renders text safely, toggles original, font and navigation',()=>{const a=actions();const {container,rerender}=render(<ReaderScreen {...reader} {...a}/>);expect(screen.getByText('빗소리가 잦아들었다.')).toBeVisible();expect(container.querySelector('img')).toBeNull();expect(screen.getByRole('button',{name:'이전 화'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'다음 화'}));expect(a.onNavigate).toHaveBeenCalledWith(reader.chapter!.source.nextUrl);fireEvent.click(screen.getByRole('button',{name:'원문 보기'}));expect(a.onShowOriginal).toHaveBeenCalledWith(true);fireEvent.change(screen.getByLabelText('글자 크기'),{target:{value:'22'}});expect(a.onFontSize).toHaveBeenCalledWith(22);rerender(<ReaderScreen {...reader} {...a} showOriginal/>);expect(container.querySelector('rt')).toHaveTextContent('あめ');expect(container.querySelector('script')).toBeNull();});
 it('emits a position through keyboard focus and restores matching paragraph',()=>{vi.spyOn(window,'scrollBy').mockImplementation(()=>{});const a=actions();const {container}=render(<ReaderScreen {...reader} {...a} position={{chapterId:'1',paragraphId:'p2',offset:0}}/>);fireEvent.focus(container.querySelector('[data-paragraph-id="p1"]')!);expect(a.onPosition).toHaveBeenCalledWith({chapterId:'1',paragraphId:'p1',offset:0});expect(screen.getByText('읽던 위치로')).toBeVisible();});
 it('round-trips restored offsets without scroll-margin drift',()=>{
  let paragraphTop=500;
  const height=300;
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn(function(){paragraphTop=24;})});
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){const top=this.dataset.paragraphId==='p1'?paragraphTop:paragraphTop+height;return {top,bottom:top+height,left:0,right:320,width:320,height,x:0,y:top,toJSON(){return {};}};});
  vi.spyOn(HTMLElement.prototype,'offsetHeight','get').mockReturnValue(height);
  vi.spyOn(window,'scrollBy').mockImplementation((x:number | ScrollToOptions,y?:number)=>{paragraphTop-=typeof x==='number' ? (y ?? 0) : (x.top ?? 0);});
  const a=actions();
  for(let reopen=0;reopen<3;reopen++){
   const view=render(<ReaderScreen {...reader} {...a} position={{chapterId:'1',paragraphId:'p1',offset:100}}/>);
   fireEvent.scroll(window);
   expect(a.onPosition).toHaveBeenLastCalledWith({chapterId:'1',paragraphId:'p1',offset:100});
   view.unmount();paragraphTop=500;
  }
 });
 it('requires explicit retry for unknown results and offers paused resume',()=>{const a=actions();const {rerender}=render(<ReaderScreen {...reader} {...a} job={{phase:'unknown',completedChunks:1,totalChunks:2,error:new ReaderError('timeout_unknown','unknown')}}/>);expect(screen.getByText(/중복 처리/)).toBeVisible();expect(a.onRetry).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'위험을 확인하고 다시 시도'}));expect(a.onRetry).toHaveBeenCalledOnce();rerender(<ReaderScreen {...reader} {...a} job={{phase:'paused',completedChunks:1,totalChunks:2}}/>);fireEvent.click(screen.getByRole('button',{name:'이어서 번역'}));expect(a.onResume).toHaveBeenCalledOnce();});
 it('rejects unsafe URLs and submits a valid chapter URL',()=>{const a=actions();render(<ReaderScreen {...reader} {...a}/>);fireEvent.change(screen.getByLabelText('회차 URL'),{target:{value:'javascript:alert(1)'}});fireEvent.submit(screen.getByRole('form',{name:'회차 열기'}));expect(a.onOpen).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('회차 URL'),{target:{value:reader.chapter!.source.canonicalUrl}});fireEvent.submit(screen.getByRole('form',{name:'회차 열기'}));expect(a.onOpen).toHaveBeenCalledWith(reader.chapter!.source.canonicalUrl);});
});
