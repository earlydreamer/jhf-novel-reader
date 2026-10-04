import { describe, expect, it, vi } from 'vitest';
import { createTranslationEngine } from '../../src/jobs/engine';
import { ReaderError, type Chapter, type ChunkRequest, type ChunkResult, type ProviderConfig, type ReaderStore, type StoredReaderData } from '../../src/contracts';

const config: ProviderConfig = {provider:'openai-compatible',baseUrl:'http://model.test/v1',model:'local',contextBudget:8192,outputBudget:1024,settingsRevision:1};
const chapter = (id='1',long=false): Chapter => ({canonicalUrl:`https://ncode.syosetu.com/n1234ab/${id}/`,workId:'n1234ab',chapterId:`n1234ab/${id}`,sourceHash:`hash-${id}`,title:'合成',prevUrl:null,nextUrl:null,paragraphs:[{id:`p-${id}`,text:long?'合成本文。'.repeat(500):'合成本文。',ruby:[]}]});
const result=(r:ChunkRequest):ChunkResult=>({chunkId:r.chunkId,finishReason:'complete',paragraphs:r.outputIds.map(id=>({id,text:'번역'}))});
function deferred<T>() {let resolve!:(value:T)=>void; let reject!:(error:unknown)=>void; const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function until(fn:()=>boolean) {for(let i=0;i<200;i++){if(fn()) return;await new Promise(r=>setTimeout(r,1));}throw new Error('condition not reached');}
function setup(options:{long?:boolean;translate?:(r:ChunkRequest,s:AbortSignal)=>Promise<ChunkResult>}={}) {
 const records=new Map<string,StoredReaderData>();
 const store:ReaderStore={read:vi.fn(async key=>structuredClone(records.get(key)??null)),saveCheckpoint:vi.fn(async cp=>{records.set(cp.cacheKey,{chapter:null,checkpoint:structuredClone(cp),position:null});}),commitChapter:vi.fn(async c=>{records.set(c.cacheKey,{chapter:structuredClone(c),checkpoint:null,position:null});}),savePosition:vi.fn(async()=>{})};
 const translate=vi.fn(options.translate??(async(r:ChunkRequest)=>result(r)));
 const source={getChapter:vi.fn(async(url:string)=>chapter(url.includes('/2/')?'2':'1',options.long))};
 const engine=createTranslationEngine({source,createProvider:()=>({translateChunk:translate}),store}); engine.setForeground(true);
 return {engine,source,translate,store,records};
}
describe('current chapter state machine',()=>{
 it('reaches ready only after complete chapter commit resolves',async()=>{
  const h=setup();const commit=deferred<void>();h.store.commitChapter=vi.fn(()=>commit.promise);
  const job=h.engine.startChapter(chapter().canonicalUrl,config);await until(()=>vi.mocked(h.store.commitChapter).mock.calls.length===1);
  expect(h.engine.getSnapshot().job.phase).toBe('saving');expect(h.engine.getSnapshot().chapter).toBeNull();commit.resolve();await job.done;
  expect(h.engine.getSnapshot().job.phase).toBe('ready');expect(h.engine.getSnapshot().chapter?.paragraphs).toEqual([{id:'p-1',text:'번역'}]);
 });
 it.each(['missing','duplicate','extra','empty','length','wrong-chunk'])('rejects %s without completed commit',async mode=>{
  const h=setup({translate:async r=>{const good=result(r);return mode==='missing'?{...good,paragraphs:[]}:mode==='duplicate'?{...good,paragraphs:[good.paragraphs[0]!,good.paragraphs[0]!]}:mode==='extra'?{...good,paragraphs:[...good.paragraphs,{id:'extra',text:'x'}]}:mode==='empty'?{...good,paragraphs:good.paragraphs.map(p=>({...p,text:''}))}:mode==='length'?{...good,finishReason:'length'}:{...good,chunkId:'other'};}});
  await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.engine.getSnapshot().job.error?.code).toBe('invalid_output');expect(h.store.commitChapter).not.toHaveBeenCalled();
 });
 it('does not automatically retry an unknown model outcome',async()=>{
  const h=setup({translate:async()=>{throw new ReaderError('timeout_unknown','unknown');}});
  await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.engine.getSnapshot().job.phase).toBe('unknown');expect(h.translate).toHaveBeenCalledTimes(1);
  await h.engine.retry().done;expect(h.translate).toHaveBeenCalledTimes(2);
 });
 it('retains global native slot through cancelled A, queued B, newer C',async()=>{
  const first=deferred<ChunkResult>();let firstRequest!:ChunkRequest;let active=0,max=0;
  const h=setup({translate:async r=>{active++;max=Math.max(max,active);if(!firstRequest){firstRequest=r;const response=await first.promise;active--;return response;}active--;return result(r);}});
  const a=h.engine.startChapter(chapter().canonicalUrl,config);await until(()=>h.translate.mock.calls.length===1);
  const b=h.engine.startChapter(chapter('2').canonicalUrl,{...config,settingsRevision:2});
  const c=h.engine.startChapter(chapter('2').canonicalUrl,{...config,settingsRevision:3});
  await new Promise(r=>setTimeout(r,10));expect(h.translate).toHaveBeenCalledTimes(1);first.resolve(result(firstRequest));await Promise.all([a.done,b.done,c.done]);
  expect(max).toBe(1);expect(h.translate).toHaveBeenCalledTimes(2);expect(h.engine.getSnapshot().job.token?.settingsRevision).toBe(3);expect(h.engine.getSnapshot().chapter?.source.chapterId).toBe('n1234ab/2');
 });
 it('pauses foreground work without automatic continuation and guards late output',async()=>{
  const wait=deferred<ChunkResult>();let request!:ChunkRequest;const h=setup({translate:async r=>{request=r;return wait.promise;}});
  const job=h.engine.startChapter(chapter().canonicalUrl,config);await until(()=>h.translate.mock.calls.length===1);h.engine.setForeground(false);expect(h.engine.getSnapshot().job.phase).toBe('unknown');wait.resolve(result(request));await job.done;
  expect(h.store.commitChapter).not.toHaveBeenCalled();h.engine.setForeground(true);expect(h.translate).toHaveBeenCalledTimes(1);
 });
 it('does not fetch or POST while backgrounded',async()=>{const h=setup();h.engine.setForeground(false);await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.source.getChapter).not.toHaveBeenCalled();expect(h.translate).not.toHaveBeenCalled();expect(h.engine.getSnapshot().job.phase).toBe('paused');});
 it('retries completed storage without another model request',async()=>{
  const h=setup();const commit=h.store.commitChapter;let fail=true;h.store.commitChapter=vi.fn(async value=>{if(fail)throw new ReaderError('storage');await commit(value);});
  await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.engine.getSnapshot().job.error?.code).toBe('storage');const calls=h.translate.mock.calls.length;fail=false;await h.engine.retry().done;expect(h.translate).toHaveBeenCalledTimes(calls);expect(h.engine.getSnapshot().job.phase).toBe('ready');
 });
 it('retries an unsaved validated checkpoint before any additional model request',async()=>{
  const h=setup({long:true});const save=h.store.saveCheckpoint;let saves=0;let fail=true;h.store.saveCheckpoint=vi.fn(async cp=>{saves++;if(cp.chunks.length===1&&fail)throw new ReaderError('storage');await save(cp);});
  await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.engine.getSnapshot().job.error?.code).toBe('storage');expect(h.translate).toHaveBeenCalledTimes(1);fail=false;await h.engine.retry().done;expect(h.engine.getSnapshot().job.phase).toBe('ready');expect(h.translate.mock.calls.length).toBe(h.engine.getSnapshot().job.totalChunks);expect(saves).toBeGreaterThan(2);
 });
 it('restores complete chapter and saved position atomically without source or model',async()=>{
  const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;const record=h.records.get(key)!;const savedPosition={chapterId:'n1234ab/1',paragraphId:'p-1',offset:321};h.records.set(key,{...record,position:savedPosition});
  const restored=createTranslationEngine({source:h.source,createProvider:()=>({translateChunk:h.translate}),store:h.store});const snapshots:unknown[]=[];restored.subscribe(()=>{if(restored.getSnapshot().job.phase==='ready')snapshots.push(restored.getSnapshot().position);});
  await restored.restoreChapter(key,config).done;expect(h.source.getChapter).toHaveBeenCalledTimes(1);expect(h.translate).toHaveBeenCalledTimes(1);expect(snapshots).toEqual([savedPosition]);
 });
 it('restores incomplete checkpoint as unknown and needs explicit resume',async()=>{
  const h=setup({long:true});h.translate.mockImplementationOnce(async r=>result(r)).mockRejectedValueOnce(new ReaderError('timeout_unknown','unknown'));
  await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;const before=h.translate.mock.calls.length;
  const restored=createTranslationEngine({source:h.source,createProvider:()=>({translateChunk:h.translate}),store:h.store});restored.setForeground(true);await restored.restoreChapter(key,config).done;expect(restored.getSnapshot().job.phase).toBe('unknown');expect(h.translate).toHaveBeenCalledTimes(before);
  await restored.resumeChapter(key,config).done;expect(restored.getSnapshot().job.phase).toBe('ready');expect(h.source.getChapter).toHaveBeenCalledTimes(1);
 });
 it.each([{model:'different'},{baseUrl:'http://other.test/v1'}])('never resumes incompatible cached settings %j',async change=>{
  const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;await h.engine.resumeChapter(key,{...config,...change}).done;expect(h.engine.getSnapshot().job.phase).toBe('failed');expect(h.engine.getSnapshot().chapter).toBeNull();expect(h.translate).toHaveBeenCalledTimes(1);
 });
 it('discards tampered checkpoint outputs rather than reuse validated marker',async()=>{
  const h=setup({long:true});h.translate.mockImplementationOnce(async r=>result(r)).mockRejectedValueOnce(new ReaderError('timeout_unknown','unknown'));await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;const record=h.records.get(key)!;const cp=record.checkpoint!;
  h.records.set(key,{...record,checkpoint:{...cp,chunks:[{...cp.chunks[0]!,paragraphs:[{id:'unknown',text:'bad'}]}]}});const before=h.translate.mock.calls.length;await h.engine.resumeChapter(key,config).done;expect(h.engine.getSnapshot().job.phase).toBe('failed');expect(h.translate).toHaveBeenCalledTimes(before);
 });
});
it('completed offline cache remains readable with smaller future request budgets',async()=>{
 const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;
 await h.engine.restoreChapter(key,{...config,contextBudget:256,outputBudget:128}).done;expect(h.engine.getSnapshot().job.phase).toBe('ready');expect(h.translate).toHaveBeenCalledTimes(1);
});
it('new explicit open with an interrupted checkpoint warns instead of automatically POSTing',async()=>{
 const h=setup({translate:async()=>{throw new ReaderError('timeout_unknown','unknown');}});await h.engine.startChapter(chapter().canonicalUrl,config).done;
 await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.translate).toHaveBeenCalledTimes(1);expect(h.engine.getSnapshot().job.phase).toBe('unknown');
});
it('source hash change produces a fresh cache key and model request',async()=>{
 const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;const oldKey=h.engine.getSnapshot().cacheKey;
 h.source.getChapter.mockResolvedValueOnce({...chapter(),sourceHash:'changed',paragraphs:[{id:'new-id',text:'変更',ruby:[]}]});await h.engine.startChapter(chapter().canonicalUrl,config).done;
 expect(h.engine.getSnapshot().cacheKey).not.toBe(oldKey);expect(h.translate).toHaveBeenCalledTimes(2);expect(h.engine.getSnapshot().chapter?.paragraphs[0]?.id).toBe('new-id');
});
it('settings invalidation ignores a completed late model response',async()=>{
 const waiting=deferred<ChunkResult>();let req!:ChunkRequest;const h=setup({translate:async r=>{req=r;return waiting.promise;}});const job=h.engine.startChapter(chapter().canonicalUrl,config);await until(()=>h.translate.mock.calls.length===1);h.engine.invalidate();waiting.resolve(result(req));await job.done;
 expect(h.engine.getSnapshot().job.phase).toBe('idle');expect(h.store.commitChapter).not.toHaveBeenCalled();
});
it('backgrounding a queued job prevents its later provider dispatch',async()=>{
 const waiting=deferred<ChunkResult>();let req!:ChunkRequest;const h=setup({translate:async r=>{req=r;return waiting.promise;}});const a=h.engine.startChapter(chapter().canonicalUrl,config);await until(()=>h.translate.mock.calls.length===1);
 const b=h.engine.startChapter(chapter('2').canonicalUrl,config);await new Promise(r=>setTimeout(r,10));h.engine.setForeground(false);waiting.resolve(result(req));await Promise.all([a.done,b.done]);expect(h.translate).toHaveBeenCalledTimes(1);expect(h.engine.getSnapshot().job.phase).toBe('paused');
});
it('source access errors remain separate from model and storage failures',async()=>{
 const h=setup();h.source.getChapter.mockRejectedValueOnce(new ReaderError('source_parse'));await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.engine.getSnapshot().job.error?.code).toBe('source_parse');expect(h.translate).not.toHaveBeenCalled();
});
it('cached-ready pointer failure retries pointer without model or duplicate commit',async()=>{
 const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;let fails=true;const pointer=vi.fn(async()=>{if(fails)throw new ReaderError('storage');});
 const restored=createTranslationEngine({source:h.source,createProvider:()=>({translateChunk:h.translate}),store:h.store,onCacheKey:pointer});restored.setForeground(true);await restored.restoreChapter(key,config).done;expect(restored.getSnapshot().job.error?.code).toBe('storage');fails=false;await restored.retry().done;
 expect(restored.getSnapshot().job.phase).toBe('ready');expect(h.translate).toHaveBeenCalledTimes(1);expect(h.store.commitChapter).toHaveBeenCalledTimes(1);
});
it('refreshes fetched navigation/title metadata durably without retranslating identical body',async()=>{
 const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;const key=h.engine.getSnapshot().cacheKey!;
 const updated={...chapter(),title:'New title',nextUrl:chapter('2').canonicalUrl};h.source.getChapter.mockResolvedValueOnce(updated);
 const originalCommit=h.store.commitChapter, pending=deferred<void>();h.store.commitChapter=vi.fn(async value=>{await pending.promise;await originalCommit(value);});
 const reopened=h.engine.startChapter(chapter().canonicalUrl,config);await until(()=>vi.mocked(h.store.commitChapter).mock.calls.length===1);
 expect(h.engine.getSnapshot().job.phase).toBe('saving');expect(h.engine.getSnapshot().chapter).toBeNull();pending.resolve();await reopened.done;
 expect(h.engine.getSnapshot().chapter?.source).toEqual(updated);expect(h.records.get(key)?.chapter?.source.nextUrl).toBe(updated.nextUrl);expect(h.translate).toHaveBeenCalledTimes(1);
});
it('metadata-only commit failure can retry without another model request',async()=>{
 const h=setup();await h.engine.startChapter(chapter().canonicalUrl,config).done;h.source.getChapter.mockResolvedValueOnce({...chapter(),nextUrl:chapter('2').canonicalUrl});
 const commit=h.store.commitChapter;h.store.commitChapter=vi.fn().mockRejectedValueOnce(new ReaderError('storage')).mockImplementation(commit);
 await h.engine.startChapter(chapter().canonicalUrl,config).done;expect(h.engine.getSnapshot().job.error?.code).toBe('storage');await h.engine.retry().done;
 expect(h.engine.getSnapshot().chapter?.source.nextUrl).toBe(chapter('2').canonicalUrl);expect(h.translate).toHaveBeenCalledTimes(1);
});
