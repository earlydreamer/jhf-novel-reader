// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { AppLifecycle, ModelTransport, SecretStore, SourceTransport } from '../../src/contracts';
import type { ProviderConfig } from '../../src/contracts/legacy';
import { createReaderApplication } from '../../src/app/legacy/compose';
import { createSettingsRepository } from '../../src/storage/legacy/settings';
import { planChunks } from '../../src/legacy/jobs/chunking';
import { createGeminiProvider, GEMINI_BASE_URL } from '../../src/providers/gemini';
const url='https://ncode.syosetu.com/n1234ab/1/';
const html='<h1 class="p-novel__title">합성 회차</h1><div class="p-novel__body"><div class="p-novel__text"><p>雨が降る。</p><p><br></p><p>空を見た。</p></div></div><div class="c-pager"><a class="c-pager__item--next" href="/n1234ab/2/">次へ</a></div>';
const config:ProviderConfig={provider:'gemini',baseUrl:GEMINI_BASE_URL,model:'gemini-synthetic',authRef:'provider.gemini-test',contextBudget:8192,outputBudget:2048,settingsRevision:1};
function setup(){
 const contents=new Map<string,string>(),values=new Map<string,string>();
 const files={read:async(path:string)=>contents.get(path)??null,write:async(path:string,data:string)=>{contents.set(path,data);}};
 const preferences={get:async({key}:{key:string})=>({value:values.get(key)??null}),set:async({key,value}:{key:string,value:string})=>{values.set(key,value);}};
 const sourceTransport:SourceTransport={get:vi.fn(async target=>({status:200,headers:{'content-type':'text/html'},data:html,url:target}))};
 const modelTransport:ModelTransport={get: async () => { throw new Error('Catalog not used in legacy fixture'); }, post:vi.fn(async request=>{const input=JSON.parse((request.body.contents as {parts:{text:string}[]}[])[0]!.parts[0]!.text) as {outputIds:string[]};return {status:200,url:request.url,headers:{},data:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({paragraphs:input.outputIds.map(id=>({id,text:'합성 한국어'}))})}]}}]}};})};
 const secrets:SecretStore={get:vi.fn(async()=> 'synthetic-gemini-key'),set:vi.fn(),remove:vi.fn()};
 const lifecycle:AppLifecycle={subscribe:async()=>async()=>{},isActive:async()=>true};
 const deps={files,preferences,sourceTransport,modelTransport,secrets,lifecycle};
 return {deps,contents,values,async create(c=config,prefetchEnabled=false){await createSettingsRepository(preferences).save({config:c,preferences:{fontSize:18,prefetchEnabled}});const controller=createReaderApplication(deps);await controller.initialize();return controller;}};
}
describe('explicit Gemini composition',()=>{
 it('translates through the same parser/queue/store and restores offline with no requests',async()=>{const h=setup(),first=await h.create();first.readerActions.onOpen(url);await vi.waitFor(()=>expect(first.getSnapshot().reader.job.phase).toBe('ready'));const chapter=first.getSnapshot().reader.chapter!;expect(chapter.paragraphs.map(p=>p.text)).toEqual(['합성 한국어','','합성 한국어']);expect(chapter.identity).toMatchObject({provider:'gemini',normalizedEndpoint:GEMINI_BASE_URL,model:'gemini-synthetic',languageDirection:'ja-ko',promptVersion:'ja-ko-v1'});expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(1);expect(JSON.stringify([...h.values.values(),...h.contents.values()])).not.toContain('synthetic-gemini-key');await first.dispose();vi.mocked(h.deps.modelTransport.post).mockClear();vi.mocked(h.deps.sourceTransport.get).mockClear();const second=createReaderApplication(h.deps);await second.initialize();expect(second.getSnapshot().reader.chapter).toEqual(chapter);expect(h.deps.modelTransport.post).not.toHaveBeenCalled();expect(h.deps.sourceTransport.get).not.toHaveBeenCalled();await second.dispose();});
 it('keeps default-off prefetch network-silent after current chapter finishes',async()=>{const h=setup(),controller=await h.create();controller.readerActions.onOpen(url);await vi.waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('ready'));await new Promise(resolve=>setTimeout(resolve,20));expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(1);expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);await controller.dispose();});
 it('never falls back from a local failure to Gemini',async()=>{const h=setup();vi.mocked(h.deps.modelTransport.post).mockRejectedValue(new Error('local offline'));const local={...config,provider:'openai-compatible' as const,baseUrl:'http://192.0.2.1:1234/v1',model:'synthetic-local',authRef:'provider.local'};const controller=await h.create(local);controller.readerActions.onOpen(url);await vi.waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('unknown'));expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);const sent=vi.mocked(h.deps.modelTransport.post).mock.calls[0]![0];expect(sent.url).toBe(local.baseUrl+'/chat/completions');expect(sent).not.toHaveProperty('geminiApiKey');await controller.dispose();});
 it.each(['MAX_TOKENS','SAFETY'])('never stores %s as complete or exposes partial text',async finishReason=>{const h=setup();vi.mocked(h.deps.modelTransport.post).mockImplementation(async input=>({status:200,url:input.url,headers:{},data:{candidates:[{finishReason,content:{parts:[{text:'private partial output'}]}}]}}));const controller=await h.create();controller.readerActions.onOpen(url);await vi.waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('failed'));expect(controller.getSnapshot().reader.chapter).toBeNull();expect(JSON.stringify([...h.contents.values()])).not.toContain('private partial output');expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);await controller.dispose();});
 it('stops after an uncertain Gemini POST until an explicit user retry',async()=>{const h=setup();vi.mocked(h.deps.modelTransport.post).mockRejectedValue(new Error('network timeout'));const controller=await h.create();controller.readerActions.onOpen(url);await vi.waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('unknown'));await new Promise(resolve=>setTimeout(resolve,20));expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(1);controller.readerActions.onRetry();await vi.waitFor(()=>expect(h.deps.modelTransport.post).toHaveBeenCalledTimes(2));await controller.dispose();});
});
it('accounts for Gemini schema/framing when planning long escaped input',async()=>{
 const budget={...config,contextBudget:2100,outputBudget:512};
 const chapter={canonicalUrl:url,workId:'n1234ab',chapterId:'n1234ab/1',title:'合成',prevUrl:null,nextUrl:null,sourceHash:'synthetic-hash',paragraphs:[{id:'p1',text:'\\"雨\n'.repeat(120),ruby:[]}]};
 const requests=planChunks(chapter,budget,{jobId:'job',chapterId:chapter.chapterId,settingsRevision:1});
 const post=vi.fn<ModelTransport['post']>(async input=>{const payload=JSON.parse((input.body.contents as {parts:{text:string}[]}[])[0]!.parts[0]!.text) as {outputIds:string[]};return {status:200,url:input.url,headers:{},data:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({paragraphs:payload.outputIds.map(id=>({id,text:'번역'}))})}]}}]}};});
 const provider=createGeminiProvider(budget,{get: async () => { throw new Error('Catalog not used in legacy fixture'); }, post},{get:async()=> 'synthetic-key',set:async()=>{},remove:async()=>{}});
 for(const request of requests)await expect(provider.translateChunk(request,new AbortController().signal)).resolves.toMatchObject({finishReason:'complete'});
 expect(post).toHaveBeenCalledTimes(requests.length);
});
it('keeps one native POST across Gemini-to-local switch and discards the late cloud result',async()=>{
 const {createModelTransport}=await import('../../src/platform/http');
 const h=setup();let release!:(value:import('../../src/contracts').HttpResponse)=>void;
 const native=vi.fn<import('../../src/contracts').NativeHttpClient['request']>();
 native.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 native.mockImplementation(async input=>{const payload=JSON.parse((input.data!.messages as {role:string;content:string}[]).find(m=>m.role==='user')!.content) as {outputIds:string[]};return {status:200,url:input.url,headers:{},data:{choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs:payload.outputIds.map(id=>({id,text:'새 로컬 번역'}))})}}]}};});
 h.deps.modelTransport=createModelTransport({request:native});
 const controller=await h.create();controller.readerActions.onOpen(url);
 await vi.waitFor(()=>expect(native).toHaveBeenCalledTimes(1));
 expect(native.mock.calls[0]![0].headers['x-goog-api-key']).toBe('synthetic-gemini-key');
 controller.settingsActions.onConfigChange({...config,provider:'openai-compatible',baseUrl:'http://192.0.2.1/v1',model:'synthetic-local'});
 controller.readerActions.onOpen(url);await vi.waitFor(()=>expect(h.deps.sourceTransport.get).toHaveBeenCalledTimes(2));
 await new Promise(resolve=>setTimeout(resolve,20));expect(native).toHaveBeenCalledTimes(1);
 const cloud=native.mock.calls[0]![0];const payload=JSON.parse((cloud.data!.contents as {parts:{text:string}[]}[])[0]!.parts[0]!.text) as {outputIds:string[]};
 release({status:200,url:cloud.url,headers:{},data:{candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({paragraphs:payload.outputIds.map(id=>({id,text:'폐기할 오래된 번역'}))})}]}}]}});
 await vi.waitFor(()=>expect(controller.getSnapshot().reader.job.phase).toBe('ready'));
 expect(native).toHaveBeenCalledTimes(2);expect(native.mock.calls[1]![0].headers).not.toHaveProperty('x-goog-api-key');expect(native.mock.calls[1]![0].headers).not.toHaveProperty('Authorization');
 expect(controller.getSnapshot().reader.chapter!.identity.provider).toBe('openai-compatible');
 expect(controller.getSnapshot().reader.chapter!.paragraphs[0]!.text).toBe('새 로컬 번역');
 expect(JSON.stringify([...h.contents.values()])).not.toContain('폐기할 오래된 번역');await controller.dispose();
});
