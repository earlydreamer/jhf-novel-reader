import { ReaderError, type Chapter, type SourceAdapter } from '../../contracts/index';
import { createCacheKey, type CacheIdentity, type Checkpoint, type ChunkRequest, type CompletedChapter, type JobState, type JobToken, type ProviderConfig, type ReaderStore, type ReadPosition, type TranslationProvider, type ValidatedChunk } from '../../contracts/legacy';
import { normalizeOpenAICompatibleBaseUrl } from '../../providers/openai-compatible/index';
import { normalizeGeminiBaseUrl, normalizeGeminiModel } from '../../providers/gemini/index';
import { createRequestScheduler, type RequestPriority, type RequestScheduler } from './scheduler';
import { planChunks, PROMPT_VERSION, reassembleParagraphs, validateChunk } from './chunking';

export interface EngineSnapshot {
 readonly job: JobState;
 readonly chapter: CompletedChapter | null;
 readonly position: ReadPosition | null;
 readonly cacheKey: string | null;
}
export interface JobHandle { readonly done: Promise<void>; cancel(): void }
export interface TranslationEngine {
 getSnapshot(): EngineSnapshot;
 subscribe(listener: () => void): () => void;
 startChapter(url: string, config: ProviderConfig): JobHandle;
 restoreChapter(cacheKey: string, config: ProviderConfig): JobHandle;
 resumeChapter(cacheKey: string, config: ProviderConfig): JobHandle;
 retry(): JobHandle;
 cancel(): void;
 invalidate(): void;
 setForeground(active: boolean): void;
}
export interface EngineDependencies {
 source: SourceAdapter;
 createProvider(config: ProviderConfig): TranslationProvider;
 store: ReaderStore;
 onCacheKey?(key: string): Promise<void>;
 scheduler?: RequestScheduler;
 priority?: RequestPriority;
}
interface Session {
 config: ProviderConfig;
 abort: AbortController;
 token: JobToken;
 mode: 'start' | 'restore' | 'resume';
 url?: string;
 key?: string;
 chapter?: Chapter;
 identity?: CacheIdentity;
 requests?: ChunkRequest[];
 chunks: ValidatedChunk[];
 loaded: boolean;
 needsCheckpoint: boolean;
 pointerSaved: boolean;
 completed?: CompletedChapter;
 committed: boolean;
 recoveredCheckpoint: boolean;
 position: ReadPosition | null;
 inFlight: boolean;
 responsePending: boolean;
}
const idle = (): EngineSnapshot => ({job:{phase:'idle',completedChunks:0,totalChunks:0},chapter:null,position:null,cacheKey:null});
function safe(error: unknown, code: 'storage' | 'source_access' | 'timeout_unknown' | 'invalid_output'): ReaderError {
 return error instanceof ReaderError ? new ReaderError(error.code,error.outcome,error.status) : new ReaderError(code,code==='timeout_unknown'?'unknown':'not_sent');
}
function normalizeConfig(input: ProviderConfig): ProviderConfig {
 if ((input.provider!=='openai-compatible' && input.provider!=='gemini') || !input.model.trim() || !Number.isSafeInteger(input.settingsRevision) || input.settingsRevision<0 || !Number.isSafeInteger(input.contextBudget) || !Number.isSafeInteger(input.outputBudget) || input.outputBudget<=0 || input.contextBudget<=input.outputBudget) throw new ReaderError('connection');
 return {...input,baseUrl:input.provider==='gemini' ? normalizeGeminiBaseUrl(input.baseUrl) : normalizeOpenAICompatibleBaseUrl(input.baseUrl),model:input.provider==='gemini' ? normalizeGeminiModel(input.model) : input.model.trim()};
}
function identity(chapter: Chapter, config: ProviderConfig): CacheIdentity {
 return {canonicalUrl:chapter.canonicalUrl,sourceHash:chapter.sourceHash,provider:config.provider,normalizedEndpoint:config.baseUrl,model:config.model,promptVersion:PROMPT_VERSION,languageDirection:'ja-ko'};
}
function sameIdentity(a: CacheIdentity,b: CacheIdentity): boolean {
 return a.canonicalUrl===b.canonicalUrl && a.sourceHash===b.sourceHash && a.provider===b.provider && a.normalizedEndpoint===b.normalizedEndpoint && a.model===b.model && a.promptVersion===b.promptVersion && a.languageDirection===b.languageDirection;
}
function validateCompleted(value: CompletedChapter, expected: CacheIdentity, key: string): void {
 const source=value.source;
 if(value.schemaVersion!==1 || value.cacheKey!==key || !sameIdentity(value.identity,expected) || source.canonicalUrl!==expected.canonicalUrl || source.sourceHash!==expected.sourceHash || !source.paragraphs.length || value.paragraphs.length!==source.paragraphs.length || new Set(source.paragraphs.map(p=>p.id)).size!==source.paragraphs.length || value.paragraphs.some((p,i)=>p.id!==source.paragraphs[i]!.id || typeof p.text!=='string' || (source.paragraphs[i]!.text.trim()? !p.text.trim():p.text!==source.paragraphs[i]!.text))) throw new ReaderError('invalid_output');
}
/** One engine per reader role; current and prefetch share the application scheduler. */
export function createTranslationEngine(deps: EngineDependencies): TranslationEngine {
 let snapshot=idle(), current:Session|null=null, foreground=false, sequence=0;
 const scheduler=deps.scheduler??createRequestScheduler();
 const listeners=new Set<()=>void>();
 const emit=(next:EngineSnapshot)=>{snapshot=next;for(const listener of listeners)listener();};
 const valid=(session:Session)=>current===session && !session.abort.signal.aborted;
 function check(session:Session, needsForeground=true) {
  if(!valid(session))throw new ReaderError('cancelled');
  if(needsForeground && !foreground)throw new ReaderError('cancelled');
 }
 function state(session:Session,phase:JobState['phase'],error?:ReaderError) {
  if(!valid(session))return;
  emit({job:{phase,token:session.token,completedChunks:session.chunks.length,totalChunks:session.requests?.length??0,...(error?{error}:{})},chapter:phase==='ready'?session.completed??null:null,position:phase==='ready'?session.position:null,cacheKey:session.key??null});
 }
 async function storage<T>(session:Session,action:()=>Promise<T>):Promise<T> {
  check(session,false);
  try {const value=await action();check(session,false);return value;}
  catch(error){throw safe(error,'storage');}
 }
 async function pointer(session:Session) {
  if(!session.pointerSaved && session.key){await storage(session,()=>deps.onCacheKey?.(session.key!)??Promise.resolve());session.pointerSaved=true;}
 }
 function checkpoint(session:Session):Checkpoint {
  return {schemaVersion:1,cacheKey:session.key!,identity:session.identity!,token:session.token,chapter:session.chapter!,chunks:session.chunks};
 }
 async function saveCheckpoint(session:Session) {
  state(session,'saving');await storage(session,()=>deps.store.saveCheckpoint(checkpoint(session)));session.needsCheckpoint=false;await pointer(session);
 }
 async function model(session:Session,request:ChunkRequest) {
  const task=scheduler.schedule(deps.priority??'current',session.abort.signal,async()=>{
   check(session);session.inFlight=true;session.responsePending=true;
   try{return await deps.createProvider(session.config).translateChunk(request,session.abort.signal);}
   catch(error){throw safe(error,'timeout_unknown');}
   finally{session.inFlight=false;}
  });
  // Never race this with an abort or JS timeout: the native promise owns the slot.
  const result=await task;check(session);return result;
 }
 function adoptCheckpoint(session:Session,cp:Checkpoint) {
  if(cp.schemaVersion!==1 || cp.cacheKey!==session.key || !sameIdentity(cp.identity,session.identity!) || cp.chapter.sourceHash!==session.chapter!.sourceHash || cp.token.chapterId!==session.chapter!.chapterId)throw new ReaderError('invalid_output');
  const requests=session.requests!;
  // A changed planning budget means no checkpoint chunk is reusable, even if the chapter fingerprint stays valid.
  if(cp.chunks.length && cp.chunks[0]!.chunkId!==requests[0]?.chunkId){session.chunks=[];session.needsCheckpoint=true;return;}
  if(cp.chunks.length>requests.length)throw new ReaderError('invalid_output');
  session.chunks=cp.chunks.map((chunk,index)=>{
   if(chunk.validated!==true)throw new ReaderError('invalid_output');
   return validateChunk(requests[index]!,{...chunk,finishReason:'complete'});
  });
 }
 async function load(session:Session) {
  if(session.loaded)return;
  if(session.mode==='start') {
   check(session);state(session,'preparing');
   if(!session.chapter){try{session.chapter=await deps.source.getChapter(session.url!,session.abort.signal);}catch(error){throw safe(error,'source_access');}check(session);}
   session.token={...session.token,chapterId:session.chapter.chapterId};
   session.identity=identity(session.chapter,session.config);
   session.key=await createCacheKey(session.identity);check(session);
  }
  const saved=await storage(session,()=>deps.store.read(session.key!));
  if(session.mode!=='start') {
   if(!saved || (!saved.chapter&&!saved.checkpoint))throw new ReaderError('storage');
   session.chapter=saved.chapter?.source??saved.checkpoint!.chapter;
   session.token={...session.token,chapterId:session.chapter.chapterId};
   session.identity=identity(session.chapter,session.config);
   if(await createCacheKey(session.identity)!==session.key)throw new ReaderError('invalid_output');
   check(session,false);
  }
  session.position=saved?.position??null;
  if(saved?.chapter) {
   validateCompleted(saved.chapter,session.identity!,session.key!);
   // The source fingerprint covers body content, not title/neighbor links. Reuse
   // translations while retaining metadata fetched by an explicit URL reopen.
   const refreshed = session.mode==='start' && JSON.stringify(saved.chapter.source)!==JSON.stringify(session.chapter);
   session.completed=refreshed ? {...saved.chapter,source:session.chapter!} : saved.chapter;
   validateCompleted(session.completed,session.identity!,session.key!);
   session.committed=!refreshed;
   session.loaded=true;
   return;
  }
  session.requests=planChunks(session.chapter!,session.config,session.token);
  if(saved?.checkpoint){adoptCheckpoint(session,saved.checkpoint);session.recoveredCheckpoint=true;}
  else session.needsCheckpoint=true;
  session.loaded=true;
 }
 async function run(session:Session) {
  try {
   // Offline restore is safe even when inactive. All source/model work requires the foreground.
   if(session.mode!=='restore')check(session);
   session.config=normalizeConfig(session.config);
   await load(session);check(session,false);
   if(session.completed){
    if(!session.committed){check(session);state(session,'saving');await storage(session,()=>deps.store.commitChapter(session.completed!));session.committed=true;}
    await pointer(session);state(session,'ready');return;
   }
   if(session.mode==='restore' || (session.mode==='start' && session.recoveredCheckpoint)) {
    state(session,'unknown',new ReaderError('timeout_unknown','unknown'));return;
   }
   check(session);
   if(session.needsCheckpoint)await saveCheckpoint(session);
   await pointer(session);
   for(let index=session.chunks.length;index<session.requests!.length;index++) {
    check(session);state(session,'translating');
    const request={...session.requests![index]!,token:session.token};
    const response=await model(session,request);check(session);
    state(session,'validating');
    const chunk=validateChunk(request,response);check(session);session.responsePending=false;
    session.chunks=[...session.chunks,chunk];session.needsCheckpoint=true;
    await saveCheckpoint(session);
   }
   check(session);state(session,'validating');
   session.completed={schemaVersion:1,cacheKey:session.key!,identity:session.identity!,source:session.chapter!,paragraphs:reassembleParagraphs(session.chapter!,session.requests!,session.chunks),completedAt:new Date().toISOString()};
   validateCompleted(session.completed,session.identity!,session.key!);
   state(session,'saving');await storage(session,()=>deps.store.commitChapter(session.completed!));session.committed=true;
   await pointer(session);check(session);state(session,'ready');
  } catch(error) {
   if(!valid(session))return;
   const failure=safe(error,'invalid_output');
   state(session,failure.code==='cancelled'?'paused':failure.outcome==='unknown'?'unknown':'failed',failure);
  }
 }
 function launch(mode:Session['mode'],config:ProviderConfig,input:string,previous?:Session):JobHandle {
  current?.abort.abort();
  const session:Session={...(previous??{}),config:{...config},abort:new AbortController(),token:{jobId:`job-${++sequence}`,chapterId:previous?.chapter?.chapterId??'',settingsRevision:config.settingsRevision},mode,url:mode==='start'?input:previous?.url,key:mode==='start'?previous?.key:input,chunks:previous?[...previous.chunks]:[],loaded:previous?.loaded??false,needsCheckpoint:previous?.needsCheckpoint??false,pointerSaved:previous?.pointerSaved??false,position:previous?.position??null,inFlight:false,responsePending:false,committed:previous?.committed??false,recoveredCheckpoint:false};
  current=session;state(session,'preparing');
  const done=run(session);
  return {done,cancel(){if(current===session)cancel();}};
 }
 function cancel() {
  const session=current;
  if(!session || snapshot.job.phase==='ready' || snapshot.job.phase==='idle')return;
  // A provider can settle before its response reaches validation. Discarding
  // that response must not turn a sent request into an automatically resumable pause.
  const unknown=session.inFlight || session.responsePending || snapshot.job.error?.outcome==='unknown';
  session.abort.abort();
  emit({...snapshot,chapter:null,position:null,job:{...snapshot.job,phase:unknown?'unknown':'paused',error:new ReaderError('cancelled',unknown?'unknown':'not_sent')}});
 }
 return {
  getSnapshot:()=>snapshot,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  startChapter:(url,config)=>launch('start',config,url),
  restoreChapter:(key,config)=>launch('restore',config,key),
  resumeChapter:(key,config)=>launch('resume',config,key),
  retry(){const previous=current;if(!previous)return {done:Promise.resolve(),cancel(){}};
   return launch(previous.mode==='start'?'start':'resume',previous.config,previous.mode==='start'?previous.url!:previous.key!,previous);
  },
  cancel,
  invalidate(){current?.abort.abort();current=null;emit(idle());},
  setForeground(active){foreground=active;if(!active && ['preparing','translating','validating','saving'].includes(snapshot.job.phase))cancel();},
 };
}
