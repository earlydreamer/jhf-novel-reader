import { describe, expect, it, vi } from 'vitest';
import { createRequestScheduler } from '../../src/jobs/scheduler';
import { createTranslationEngine } from '../../src/jobs/engine';
import { createPrefetchCoordinator } from '../../src/jobs/prefetch';
import { ReaderError, type Chapter, type ChunkRequest, type ChunkResult, type ProviderConfig, type ReaderStore, type StoredReaderData } from '../../src/contracts';

const config: ProviderConfig = {provider:'openai-compatible',baseUrl:'http://model.test/v1',model:'local',contextBudget:8192,outputBudget:1024,settingsRevision:1};
const chapter=(n:number):Chapter=>({canonicalUrl:`https://ncode.syosetu.com/n1234ab/${n}/`,workId:'n1234ab',chapterId:`n1234ab/${n}`,sourceHash:`hash-${n}`,title:'合成',prevUrl:null,nextUrl:n<3?`https://ncode.syosetu.com/n1234ab/${n+1}/`:null,paragraphs:[{id:`p-${n}`,text:'合成本文。',ruby:[]}]});
const result=(r:ChunkRequest):ChunkResult=>({chunkId:r.chunkId,finishReason:'complete',paragraphs:r.outputIds.map(id=>({id,text:'번역'}))});
function deferred<T>() {let resolve!:(value:T)=>void; const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
function setup(translate: (r:ChunkRequest,s:AbortSignal)=>Promise<ChunkResult> = async r=>result(r)) {
 const records=new Map<string,StoredReaderData>();
 const store:ReaderStore={read:vi.fn(async key=>structuredClone(records.get(key)??null)),saveCheckpoint:vi.fn(async cp=>{records.set(cp.cacheKey,{chapter:null,checkpoint:structuredClone(cp),position:null});}),commitChapter:vi.fn(async c=>{records.set(c.cacheKey,{chapter:structuredClone(c),checkpoint:null,position:null});}),savePosition:vi.fn(async()=>{})};
 const source={getChapter:vi.fn(async(url:string)=>chapter(Number(new URL(url).pathname.split('/')[2])))};
 const model=vi.fn(translate), pointer=vi.fn(async(_key:string)=>{}), scheduler=createRequestScheduler();
 const deps={source,store,createProvider:()=>({translateChunk:model}),scheduler};
 const current=createTranslationEngine({...deps,onCacheKey:pointer});
 const speculative=createTranslationEngine({...deps,priority:'prefetch'});
 const prefetch=createPrefetchCoordinator(speculative);
 current.setForeground(true);prefetch.onForegroundChanged(true);
 return {current,speculative,prefetch,model,source,store,records,pointer,scheduler};
}
async function ready(h:ReturnType<typeof setup>,n=1) {
 await h.current.startChapter(chapter(n).canonicalUrl,config).done;
 const saved=h.current.getSnapshot().chapter!;
 h.prefetch.onCurrentChapterReady(saved,config);
 return saved;
}
describe('shared native request scheduler',()=>{
 it('prioritizes current work and retains an aborted native slot until settlement',async()=>{
  const scheduler=createRequestScheduler(), held=deferred<void>(), order:string[]=[];
  const first=new AbortController(), next=new AbortController();
  const a=scheduler.schedule('prefetch',first.signal,async()=>{order.push('active');await held.promise;});
  await vi.waitFor(()=>expect(order).toEqual(['active']));first.abort();
  const b=scheduler.schedule('prefetch',next.signal,async()=>{order.push('prefetch');});
  const c=scheduler.schedule('current',next.signal,async()=>{order.push('current');});
  await new Promise(resolve=>setTimeout(resolve,10));expect(order).toEqual(['active']);held.resolve();await Promise.all([a,b,c]);
  expect(order).toEqual(['active','current','prefetch']);
 });
 it('removes aborted queued work without invoking it',async()=>{
  const scheduler=createRequestScheduler(), signal=new AbortController(), task=vi.fn(async()=>{});
  const pending=scheduler.schedule('prefetch',signal.signal,task);signal.abort();
  await expect(pending).rejects.toMatchObject({code:'cancelled'});expect(task).not.toHaveBeenCalled();
 });
});
describe('exactly one next chapter prefetch',()=>{
 it('defaults off: no next source or model requests',async()=>{
  const h=setup();await ready(h);await new Promise(resolve=>setTimeout(resolve,10));
  expect(h.source.getChapter).toHaveBeenCalledTimes(1);expect(h.model).toHaveBeenCalledTimes(1);
 });
 it('prepares B after A without chaining C, replacing A, or touching its pointer',async()=>{
  const h=setup();h.prefetch.setPrefetchEnabled(true);const current=await ready(h), snapshot=h.current.getSnapshot();
  await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('ready'));
  expect(h.source.getChapter.mock.calls.map(([url])=>url)).toEqual([chapter(1).canonicalUrl,chapter(2).canonicalUrl]);
  expect(h.current.getSnapshot()).toBe(snapshot);expect(h.pointer.mock.calls.every(([key])=>key===current.cacheKey)).toBe(true);
  expect(h.records.size).toBe(2);expect(h.model).toHaveBeenCalledTimes(2);
 });
 it('dispatches nothing while inactive, then prepares the still-current neighbor on foreground',async()=>{
  const h=setup();h.prefetch.setPrefetchEnabled(true);h.prefetch.onForegroundChanged(false);await ready(h);
  expect(h.source.getChapter).toHaveBeenCalledTimes(1);h.prefetch.onForegroundChanged(true);
  await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('ready'));expect(h.model).toHaveBeenCalledTimes(2);
 });
 it('cancels stale prefetch on navigation but holds the native slot for current work',async()=>{
  const held=deferred<ChunkResult>();let pending!:ChunkRequest, active=0,max=0;
  const h=setup(async r=>{active++;max=Math.max(max,active);try{if(r.token.chapterId===chapter(2).chapterId){pending=r;return await held.promise;}return result(r);}finally{active--;}});
  h.prefetch.setPrefetchEnabled(true);await ready(h);await vi.waitFor(()=>expect(h.model).toHaveBeenCalledTimes(2));
  h.prefetch.onCurrentChapterChanged();const next=h.current.startChapter(chapter(3).canonicalUrl,config);
  await new Promise(resolve=>setTimeout(resolve,10));expect(h.model).toHaveBeenCalledTimes(2);held.resolve(result(pending));await next.done;
  await vi.waitFor(()=>expect(h.model).toHaveBeenCalledTimes(3));expect(max).toBe(1);
  expect([...h.records.values()].some(record=>record.chapter?.source.chapterId===chapter(2).chapterId)).toBe(false);
  expect(h.current.getSnapshot().chapter?.source.chapterId).toBe(chapter(3).chapterId);
 });
 it.each(['off','background'])('does not retry uncertain work after %s and reactivation',async action=>{
  const held=deferred<ChunkResult>();let request!:ChunkRequest;
  const h=setup(async r=>{if(r.token.chapterId===chapter(2).chapterId){request=r;return held.promise;}return result(r);});
  h.prefetch.setPrefetchEnabled(true);await ready(h);await vi.waitFor(()=>expect(h.model).toHaveBeenCalledTimes(2));
  if(action==='off')h.prefetch.setPrefetchEnabled(false);else h.prefetch.onForegroundChanged(false);
  held.resolve(result(request));await new Promise(resolve=>setTimeout(resolve,10));
  if(action==='off')h.prefetch.setPrefetchEnabled(true);else h.prefetch.onForegroundChanged(true);
  await new Promise(resolve=>setTimeout(resolve,10));expect(h.model).toHaveBeenCalledTimes(2);expect(h.speculative.getSnapshot().job.phase).toBe('unknown');
 });
 it('does not retry a model timeout on repeated ready or lifecycle notifications',async()=>{
  const h=setup(async r=>{if(r.token.chapterId===chapter(2).chapterId)throw new ReaderError('timeout_unknown','unknown');return result(r);});
  h.prefetch.setPrefetchEnabled(true);const saved=await ready(h);await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('unknown'));
  h.prefetch.onCurrentChapterReady(saved,config);h.prefetch.onForegroundChanged(false);h.prefetch.onForegroundChanged(true);
  await new Promise(resolve=>setTimeout(resolve,10));expect(h.model).toHaveBeenCalledTimes(2);
 });
 it('reuses a completed neighbor cache without model work',async()=>{
  const h=setup();await h.current.startChapter(chapter(2).canonicalUrl,config).done;h.prefetch.setPrefetchEnabled(true);await ready(h);
  await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('ready'));expect(h.model).toHaveBeenCalledTimes(2);
 });
 it('invalidates a pending source response on a settings or chapter change',async()=>{
  const h=setup(), held=deferred<Chapter>();h.prefetch.setPrefetchEnabled(true);
  h.source.getChapter.mockImplementation(async url=>url===chapter(2).canonicalUrl?held.promise:chapter(1));
  await ready(h);await vi.waitFor(()=>expect(h.source.getChapter).toHaveBeenCalledTimes(2));h.prefetch.onCurrentChapterChanged();held.resolve(chapter(2));
  await new Promise(resolve=>setTimeout(resolve,10));expect(h.model).toHaveBeenCalledTimes(1);expect(h.records.size).toBe(1);
 });
});
it('resumes known-unsent work with validated chunks after a foreground pause',async()=>{
 const h=setup(),saved=deferred<void>();let chunks=0;
 h.source.getChapter.mockImplementation(async url=>{const c=chapter(Number(new URL(url).pathname.split('/')[2]));return c.chapterId===chapter(2).chapterId?{...c,paragraphs:[{...c.paragraphs[0]!,text:'合成本文。'.repeat(500)}]}:c;});
 const save=h.store.saveCheckpoint;
 h.store.saveCheckpoint=vi.fn(async cp=>{if(cp.chapter.chapterId===chapter(2).chapterId && cp.chunks.length===1 && chunks++===0)await saved.promise;await save(cp);});
 h.prefetch.setPrefetchEnabled(true);await ready(h);
 await vi.waitFor(()=>expect(chunks).toBe(1));h.prefetch.onForegroundChanged(false);saved.resolve();await new Promise(resolve=>setTimeout(resolve,10));
 expect(h.speculative.getSnapshot().job.phase).toBe('paused');const firstB=h.model.mock.calls[1]![0].chunkId;h.prefetch.onForegroundChanged(true);
 await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('ready'));
 expect(h.model.mock.calls.filter(([r])=>r.chunkId===firstB)).toHaveLength(1);
});
it('never dispatches a queued prefetch after OFF while a current native request is settling',async()=>{
 const h=setup(),held=deferred<ChunkResult>();let request!:ChunkRequest;
 await ready(h);h.model.mockImplementationOnce(async r=>{request=r;return held.promise;});
 const pending=h.current.startChapter(chapter(3).canonicalUrl,config);await vi.waitFor(()=>expect(h.model).toHaveBeenCalledTimes(2));
 h.prefetch.setPrefetchEnabled(true);await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('translating'));
 h.prefetch.setPrefetchEnabled(false);held.resolve(result(request));await pending.done;await new Promise(resolve=>setTimeout(resolve,10));
 expect(h.model).toHaveBeenCalledTimes(2);expect(h.speculative.getSnapshot().job.phase).toBe('paused');
});
it.each(['invalid_output','connection','source_access','storage'] as const)('preserves terminal %s across OFF/ON instead of retrying',async code=>{
 const h=setup(async r=>{if(r.token.chapterId===chapter(2).chapterId)throw new ReaderError(code,'received');return result(r);});
 h.prefetch.setPrefetchEnabled(true);await ready(h);await vi.waitFor(()=>expect(h.speculative.getSnapshot().job.phase).toBe('failed'));
 h.prefetch.setPrefetchEnabled(false);h.prefetch.setPrefetchEnabled(true);await new Promise(resolve=>setTimeout(resolve,10));
 expect(h.model).toHaveBeenCalledTimes(2);expect(h.speculative.getSnapshot().job.phase).toBe('failed');
});
it('does not resend a settled but not-yet-validated response after OFF/ON',async()=>{
 const h=setup(),schedule=h.scheduler.schedule;let cancelled=false;
 h.scheduler.schedule=(priority,signal,request)=>schedule(priority,signal,request).then(value=>{
  if(priority==='prefetch' && !cancelled){cancelled=true;h.prefetch.setPrefetchEnabled(false);}return value;
 });
 h.prefetch.setPrefetchEnabled(true);await ready(h);await vi.waitFor(()=>expect(cancelled).toBe(true));
 expect(h.speculative.getSnapshot().job.phase).toBe('unknown');h.prefetch.setPrefetchEnabled(true);
 await new Promise(resolve=>setTimeout(resolve,10));expect(h.model).toHaveBeenCalledTimes(2);
});
