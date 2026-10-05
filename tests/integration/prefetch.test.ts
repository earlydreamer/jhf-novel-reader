// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createReaderApplication } from '../../src/app/legacy/compose';
import { createSettingsRepository } from '../../src/storage/legacy/settings';
import { createLastChapterRepository } from '../../src/app/lastChapter';
import { createReaderStore } from '../../src/storage/store';
import type { AppLifecycle, HttpResponse, ModelRequest } from '../../src/contracts';
import type { ProviderConfig } from '../../src/contracts/legacy';
const url=(n:number)=>`https://ncode.syosetu.com/n1234ab/${n}/`;
const config:ProviderConfig={provider:'openai-compatible',baseUrl:'http://192.0.2.1:1234/v1',model:'synthetic',contextBudget:8192,outputBudget:1024,settingsRevision:1};
function response(request:ModelRequest):HttpResponse {
 const messages=request.body.messages as {role:string;content:string}[];
 const {outputIds}=JSON.parse(messages.find(m=>m.role==='user')!.content) as {outputIds:string[]};
 return {status:200,url:request.url,headers:{},data:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:outputIds.map(id=>({id,text:'합성 번역'}))})}}]}};
}
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
function setup(enabled=false) {
 const contents=new Map<string,string>(),values=new Map<string,string>();let notify!:(active:boolean)=>void;
 const files={read:async(path:string)=>contents.get(path)??null,write:async(path:string,data:string)=>{contents.set(path,data);}};
 const preferences={get:async({key}:{key:string})=>({value:values.get(key)??null}),set:async({key,value}:{key:string,value:string})=>{values.set(key,value);}};
 const sourceTransport={get:vi.fn(async(target:string)=>({status:200,url:target,headers:{'content-type':'text/html'},data:`<h1 class="p-novel__title">合成 ${target}</h1><div class="p-novel__body"><div class="p-novel__text"><p>雨が降る。</p></div></div><a class="c-pager__item c-pager__item--next" href="${url(Number(new URL(target).pathname.split('/')[2])+1)}">次へ</a>`}))};
 const modelTransport={get: async () => { throw new Error('Catalog not used in legacy fixture'); }, post:vi.fn(async(request:ModelRequest,_signal:AbortSignal)=>response(request))};
 const lifecycle:AppLifecycle={subscribe:async(listener)=>{notify=listener;return async()=>{};},isActive:async()=>true};
 const deps={files,preferences,sourceTransport,modelTransport,lifecycle,secrets:{get:async()=>null,set:async()=>{},remove:async()=>{}}};
 const settings=createSettingsRepository(preferences);
 return {deps,settings,contents,values,notify:(active:boolean)=>notify(active),async create(){await settings.save({config,preferences:{fontSize:20,prefetchEnabled:enabled}});const app=createReaderApplication(deps);await app.initialize();return app;}};
}
describe('prefetch through real composition, parser, provider and durable store',()=>{
 it('persists explicit opt-in, preserves font changes, and keeps current reader/pointer while caching only B',async()=>{
  const h=setup(),app=await h.create();expect(app.getSnapshot().settings.preferences.prefetchEnabled).toBe(false);
  app.settingsActions.onPrefetchChange(true);app.readerActions.onFontSize(24);
  await vi.waitFor(async()=>expect((await h.settings.read()).preferences).toEqual({fontSize:24,prefetchEnabled:true}));
  app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2));
  await vi.waitFor(()=>expect([...h.contents.values()].some(v=>v.includes('"chapterId":"n1234ab/2"')&&v.includes('completedAt'))).toBe(true));
  const current=app.getSnapshot().reader.chapter!;
  expect(current.source.chapterId).toBe('n1234ab/1');expect(app.getSnapshot().reader.job.phase).toBe('ready');
  expect(await createLastChapterRepository(h.deps.preferences).read()).toBe(current.cacheKey);
  expect(h.deps.sourceTransport.get.mock.calls.map(([u])=>u)).toEqual([url(1),url(2)]);
  app.settingsActions.onPrefetchChange(false);await vi.waitFor(async()=>expect((await h.settings.read()).preferences.prefetchEnabled).toBe(false));await app.dispose();
 });
 it('restores saved opt-in and completed B is reused on navigation without translating B again',async()=>{
  const h=setup(true),app=await h.create();expect(app.getSnapshot().settings.preferences.prefetchEnabled).toBe(true);
  app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2));
  await vi.waitFor(()=>expect([...h.contents.values()].some(v=>v.includes('"chapterId":"n1234ab/2"')&&v.includes('completedAt'))).toBe(true));
  app.settingsActions.onPrefetchChange(false);app.readerActions.onNavigate(url(2));
  await vi.waitFor(()=>expect(app.getSnapshot().reader.chapter?.source.chapterId).toBe('n1234ab/2'));
  expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2);await app.dispose();
 });
 it('does not prefetch on current source failure',async()=>{
  const h=setup(true),app=await h.create();h.deps.sourceTransport.get.mockRejectedValueOnce(new Error('synthetic failure'));
  app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(app.getSnapshot().reader.job.phase).toBe('failed'));
  expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(1);expect(h.deps.modelTransport.post).not.toHaveBeenCalled();await app.dispose();
 });
 it('prevents overlap and stale B writes after navigation with long-latency native settlement',async()=>{
  const h=setup(true),app=await h.create(),held=deferred<HttpResponse>();let request!:ModelRequest;let active=0,max=0,calls=0;
  h.deps.modelTransport.post.mockImplementation(async req=>{active++;max=Math.max(max,active);try{if(++calls===2){request=req;return await held.promise;}return response(req);}finally{active--;}});
  app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(calls).toBe(2));app.readerActions.onNavigate(url(3));app.settingsActions.onPrefetchChange(false);
  await new Promise(resolve=>setTimeout(resolve,30));expect(calls).toBe(2);held.resolve(response(request));
  await vi.waitFor(()=>expect(app.getSnapshot().reader.chapter?.source.chapterId).toBe('n1234ab/3'));
  expect(max).toBe(1);expect(calls).toBe(3);
  expect([...h.contents.values()].some(v=>v.includes('"chapterId":"n1234ab/2"')&&v.includes('completedAt'))).toBe(false);
  expect(await createLastChapterRepository(h.deps.preferences).read()).toBe(app.getSnapshot().reader.chapter!.cacheKey);await app.dispose();
 });
 it('keeps ambiguous prefetch checkpoint for explicit user resume after restart',async()=>{
  const h=setup(true),app=await h.create(),held=deferred<HttpResponse>();let request!:ModelRequest;
  h.deps.modelTransport.post.mockImplementationOnce(async req=>response(req)).mockImplementationOnce(async req=>{request=req;return held.promise;});
  app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2));h.notify(false);held.resolve(response(request));await app.dispose();
  const restored=createReaderApplication(h.deps);await restored.initialize();
  expect(restored.getSnapshot().reader.chapter?.source.chapterId).toBe('n1234ab/1');
  await new Promise(resolve=>setTimeout(resolve,30));expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2);
  restored.readerActions.onNavigate(url(2));await vi.waitFor(()=>expect(restored.getSnapshot().reader.job.phase).toBe('unknown'));
  expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2);restored.readerActions.onResume();
  await vi.waitFor(()=>expect(restored.getSnapshot().reader.chapter?.source.chapterId).toBe('n1234ab/2'));
  restored.settingsActions.onPrefetchChange(false);await restored.dispose();
 });
 it('persists no prefetch pointer even if speculative checkpoint storage fails',async()=>{
  const h=setup(true),app=await h.create(),write=h.deps.files.write;
  h.deps.files.write=async(path,data)=>{if(data.includes('"chapterId":"n1234ab/2"'))throw new Error('synthetic storage failure');await write(path,data);};
  app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(2));
  await new Promise(resolve=>setTimeout(resolve,20));expect(app.getSnapshot().reader.job.phase).toBe('ready');
  const current=app.getSnapshot().reader.chapter!;expect(await createLastChapterRepository(h.deps.preferences).read()).toBe(current.cacheKey);
  expect((await createReaderStore(h.deps.files).read(current.cacheKey))?.chapter).toEqual(current);expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);await app.dispose();
 });
});
it('does not start stale A prefetch after a ready subscriber synchronously navigates elsewhere',async()=>{
 const h=setup(true),app=await h.create();let navigated=false;
 app.subscribe(()=>{if(!navigated && app.getSnapshot().reader.chapter?.source.chapterId==='n1234ab/1'){navigated=true;app.readerActions.onNavigate(url(4));}});
 app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(app.getSnapshot().reader.chapter?.source.chapterId).toBe('n1234ab/4'));
 await new Promise(resolve=>setTimeout(resolve,20));expect(h.deps.sourceTransport.get.mock.calls.map(([u])=>u)).not.toContain(url(2));await app.dispose();
});
it('does not prefetch after current commit failure',async()=>{
 const h=setup(true),app=await h.create(),write=h.deps.files.write;
 h.deps.files.write=async(path,data)=>{if(data.includes('completedAt'))throw new Error('synthetic commit failure');await write(path,data);};
 app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(app.getSnapshot().reader.job.phase).toBe('failed'));
 expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(1);expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);await app.dispose();
});
it('invalidates pending neighbor source on model revision and uses refreshed source metadata',async()=>{
 const h=setup(true),app=await h.create(),held=deferred<Awaited<ReturnType<typeof h.deps.sourceTransport.get>>>(),get=h.deps.sourceTransport.get.getMockImplementation()!;let changed=false;
 h.deps.sourceTransport.get.mockImplementation(async target=>target===url(2)?held.promise:{...await get(target),data:(await get(target)).data.replace(url(2),changed?url(4):url(2))});
 app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(2));
 app.settingsActions.onConfigChange({...config,model:'changed-model'});changed=true;held.resolve(await get(url(2)));
 await new Promise(resolve=>setTimeout(resolve,20));expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);
 expect(app.getSnapshot().reader.job.phase).toBe('idle');app.readerActions.onOpen(url(1));
 await vi.waitFor(()=>expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(3));
 expect(h.deps.sourceTransport.get.mock.calls.map(([u])=>u)).toEqual([url(1),url(2),url(1),url(4)]);
 expect(app.getSnapshot().reader.chapter?.source.nextUrl).toBe(url(4));await app.dispose();
});
it('orders an already-started speculative cache commit before newer current metadata',async()=>{
 const h=setup(true),app=await h.create(),held=deferred<void>(),write=h.deps.files.write,get=h.deps.sourceTransport.get.getMockImplementation()!;let blocked=false;
 h.deps.files.write=async(path,data)=>{if(!blocked && data.includes('"chapterId":"n1234ab/2"') && data.includes('completedAt')){blocked=true;await held.promise;}await write(path,data);};
 app.readerActions.onOpen(url(1));await vi.waitFor(()=>expect(blocked).toBe(true));
 h.deps.sourceTransport.get.mockImplementation(async target=>({...await get(target),data:(await get(target)).data.replace('合成','Updated')}));
 app.settingsActions.onPrefetchChange(false);app.readerActions.onNavigate(url(2));held.resolve();
 await vi.waitFor(()=>expect(app.getSnapshot().reader.chapter?.source.title).toContain('Updated'));
 const current=app.getSnapshot().reader.chapter!;
 expect((await createReaderStore(h.deps.files).read(current.cacheKey))?.chapter?.source.title).toContain('Updated');
 expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2);await app.dispose();
});
