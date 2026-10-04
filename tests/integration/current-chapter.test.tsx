// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppLifecycle, ModelTransport, ProviderConfig, SecretStore, SourceTransport } from '../../src/contracts';
import { createReaderApplication } from '../../src/app/compose';
import { Application } from '../../src/app/Application';
import { createSettingsRepository } from '../../src/storage/settings';
import { createReaderStore } from '../../src/storage/store';
import { createLastChapterRepository } from '../../src/app/lastChapter';
const url='https://ncode.syosetu.com/n1234ab/1/';
const html='<h1 class="p-novel__title">합성 회차</h1><div class="p-novel__body"><div class="p-novel__text"><p>雨が降る。</p><p><br></p><p>空を見た。</p></div></div>';
const config:ProviderConfig={provider:'openai-compatible',baseUrl:'http://192.0.2.1:1234/v1',model:'synthetic',contextBudget:16384,outputBudget:4096,settingsRevision:1};
function setup() {
 const contents=new Map<string,string>(), values=new Map<string,string>();
 const files={read:async(path:string)=>contents.get(path)??null,write:async(path:string,data:string)=>{contents.set(path,data);}};
 const preferences={get:async({key}:{key:string})=>({value:values.get(key)??null}),set:async({key,value}:{key:string,value:string})=>{values.set(key,value);}};
 const sourceTransport:SourceTransport={get:vi.fn(async(target)=>({status:200,headers:{'content-type':'text/html'},data:html,url:target}))};
 const modelTransport:ModelTransport={post:vi.fn(async(request)=>{
  const messages=request.body.messages as {role:string;content:string}[];
  const message=JSON.parse(messages.find(item=>item.role==='user')!.content) as {outputIds:string[]};
  return {status:200,url:request.url,headers:{},data:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:message.outputIds.map((id,index)=>({id,text:`합성 번역 ${index+1}`}))})}}]}};
 })};
 const secrets:SecretStore={get:async()=>null,set:async()=>{},remove:async()=>{}};
 const lifecycle:AppLifecycle={subscribe:async()=>async()=>{},isActive:async()=>true};
 const deps={files,preferences,sourceTransport,modelTransport,secrets,lifecycle};
 return {deps,contents,values,async create(){await createSettingsRepository(preferences).save({config,preferences:{fontSize:20,prefetchEnabled:false}});return createReaderApplication(deps);}};
}
afterEach(cleanup);
describe('synthetic current chapter application',()=>{
 it('opens a URL through real parser/provider/store and restores complete text and position offline',async()=>{
  const h=setup();const first=await h.create();await first.initialize();
  render(<Application controller={first}/>);
  fireEvent.change(screen.getByLabelText('회차 URL'),{target:{value:url}});fireEvent.click(screen.getByRole('button',{name:'열기'}));
  await screen.findByText('읽기 준비 완료');expect(screen.getByText('합성 회차')).toBeVisible();
  const chapter=first.getSnapshot().reader.chapter!;expect(chapter.paragraphs.map(p=>p.text)).toEqual(['합성 번역 1','','합성 번역 2']);
  expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(1);expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);
  const position={chapterId:chapter.source.chapterId,paragraphId:chapter.paragraphs[2]!.id,offset:22};
  act(()=>first.readerActions.onPosition({...position,offset:21.7}));
  await waitFor(async()=>expect((await createReaderStore(h.deps.files).read(chapter.cacheKey))?.position).toEqual(position));
  cleanup();await first.dispose();
  h.deps.sourceTransport.get=vi.fn().mockRejectedValue(new Error('offline source'));h.deps.modelTransport.post=vi.fn().mockRejectedValue(new Error('offline model'));
  const second=createReaderApplication(h.deps);const snapshots:ReturnType<typeof second.getSnapshot>[]=[];second.subscribe(()=>snapshots.push(second.getSnapshot()));
  await second.initialize();expect(second.getSnapshot().reader.chapter).toEqual(chapter);expect(second.getSnapshot().reader.position).toEqual(position);
  expect(snapshots.filter(s=>s.reader.job.phase==='ready').every(s=>s.reader.position?.offset===22)).toBe(true);
  expect(h.deps.sourceTransport.get).not.toHaveBeenCalled();expect(h.deps.modelTransport.post).not.toHaveBeenCalled();await second.dispose();
 });
 it('shows app-owned budget inputs and settings failures with visible default-off prefetch opt-in',async()=>{
  const h=setup(), controller=await h.create();await controller.initialize();render(<Application controller={controller}/>);
  expect(screen.getByLabelText('전체 컨텍스트 예산')).toHaveValue(16384);expect(screen.getByLabelText('출력 예산')).toHaveValue(4096);
  const style=document.createElement('style');style.textContent=readFileSync('src/app/application.css','utf8');document.head.append(style);
  const checkbox=screen.getByRole('checkbox',{name:'다음 한 화 미리 번역'});expect(checkbox).toBeVisible();expect(checkbox).not.toBeChecked();
  expect(screen.getByText(/원문을 설정한 모델 서버로 추가 전송/)).toBeVisible();
  fireEvent.click(checkbox);expect(checkbox).toBeChecked();style.remove();
  fireEvent.change(screen.getByLabelText('출력 예산'),{target:{value:'20000'}});fireEvent.click(screen.getByRole('button',{name:'예산 적용'}));
  expect(screen.getByRole('alert')).toHaveTextContent('출력 예산');
  act(()=>controller.settingsActions.onConfigChange({...config,baseUrl:'http://192.0.2.1/private'}));
  expect(screen.getAllByRole('alert').some(node=>node.textContent?.includes('설정'))).toBe(true);await controller.dispose();
 });
 it('does not dispatch when initial lifecycle is inactive',async()=>{
  const h=setup();h.deps.lifecycle.isActive=async()=>false;const controller=await h.create();await controller.initialize();controller.readerActions.onOpen(url);
  await Promise.resolve();expect(h.deps.sourceTransport.get).not.toHaveBeenCalled();expect(h.deps.modelTransport.post).not.toHaveBeenCalled();await controller.dispose();
 });
 it('contains provider output failure without rendering unvalidated text',async()=>{
  const h=setup();h.deps.modelTransport.post=vi.fn(async(request)=>({status:200,url:request.url,headers:{},data:{choices:[{finish_reason:'length',message:{content:'unvalidated private output'}}]}}));
  const controller=await h.create();await controller.initialize();controller.readerActions.onOpen(url);
  await waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('failed'));expect(controller.getSnapshot().reader.chapter).toBeNull();expect(JSON.stringify(controller.getSnapshot())).not.toContain('unvalidated private output');await controller.dispose();
 });
 it('makes pointer write failure retryable without duplicating model work',async()=>{
  const h=setup(), original=h.deps.preferences.set;let fail=true;
  h.deps.preferences.set=async options=>{if(fail&&options.key.includes('last-chapter'))throw new Error('private write detail');await original(options);};
  const controller=await h.create();await controller.initialize();controller.readerActions.onOpen(url);
  await waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('failed'));
  expect(controller.getSnapshot().reader.job.error?.code).toBe('storage');expect(controller.getSnapshot().appError).toBeNull();expect(h.deps.modelTransport.post).not.toHaveBeenCalled();
  fail=false;controller.readerActions.onRetry();await waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('ready'));
  expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);expect(controller.getSnapshot().appError).toBeNull();await controller.dispose();
 });
 it('reports a bad startup pointer at app level without making network requests',async()=>{
  const h=setup(), controller=await h.create();await createLastChapterRepository(h.deps.preferences).save(`v1-${'a'.repeat(64)}`);
  const pointerEntry=[...h.values.keys()].find(key=>key.includes('last-chapter'))!;h.values.set(pointerEntry,'broken');
  await controller.initialize();expect(controller.getSnapshot().appError).toBe('last_chapter');expect(h.deps.sourceTransport.get).not.toHaveBeenCalled();expect(h.deps.modelTransport.post).not.toHaveBeenCalled();await controller.dispose();
 });
});
it('ignores stale pointer write failure after replacement chapter pointer succeeds',async()=>{
 const h=setup(), original=h.deps.preferences.set;let reject!:(error:Error)=>void;const pending=new Promise<void>((_,no)=>{reject=no;});let pointerCalls=0;
 h.deps.preferences.set=async options=>{if(options.key.includes('last-chapter')&&++pointerCalls===1)await pending;await original(options);};
 const controller=await h.create();await controller.initialize();controller.readerActions.onOpen(url);await waitFor(()=>expect(pointerCalls).toBe(1));
 controller.readerActions.onOpen(url.replace('/1/','/2/'));reject(new Error('old pointer failed'));
 await waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('ready'));
 expect(controller.getSnapshot().reader.chapter?.source.chapterId).toBe('n1234ab/2');expect(pointerCalls).toBe(2);expect(controller.getSnapshot().appError).toBeNull();
 expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);await controller.dispose();
});
