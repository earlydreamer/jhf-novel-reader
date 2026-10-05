import { describe, expect, it, vi } from 'vitest';
import type { AppLifecycle, SecretStore } from '../../src/contracts';
import type { ProviderConfig, ReaderStore } from '../../src/contracts/legacy';
import { createReaderController } from '../../src/app/legacy/controller';
import { createSettingsRepository } from '../../src/storage/legacy/settings';
import type { EngineSnapshot, TranslationEngine } from '../../src/legacy/jobs/engine';
import { reader } from '../ui/fixtures';

const config: ProviderConfig = {provider:'openai-compatible',baseUrl:'http://192.0.2.1:1234/v1',model:'local',contextBudget:16384,outputBudget:4096,settingsRevision:2};
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (reason?:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
function harness(options: {lifecycle?:AppLifecycle; secrets?:SecretStore; ready?:boolean} = {}) {
 const data=new Map<string,string>();
 const settings=createSettingsRepository({get:async({key})=>({value:data.get(key)??null}),set:async({key,value})=>{data.set(key,value);}});
 let snapshot: EngineSnapshot={job:{phase:'idle',completedChunks:0,totalChunks:0},chapter:null,position:null,cacheKey:null};
 if(options.ready) snapshot={job:reader.job,chapter:reader.chapter,position:null,cacheKey:reader.chapter!.cacheKey};
 const listeners=new Set<()=>void>();
 const handle=()=>({done:Promise.resolve(),cancel:vi.fn()});
 const engine:TranslationEngine={getSnapshot:()=>snapshot,subscribe:(listener)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},startChapter:vi.fn(handle),restoreChapter:vi.fn(handle),resumeChapter:vi.fn(handle),retry:vi.fn(handle),cancel:vi.fn(),invalidate:vi.fn(),setForeground:vi.fn()};
 const store:ReaderStore={read:vi.fn(),saveCheckpoint:vi.fn(),commitChapter:vi.fn(),savePosition:vi.fn().mockResolvedValue(undefined)};
 const secrets=options.secrets??{get:vi.fn().mockResolvedValue(null),set:vi.fn().mockResolvedValue(undefined),remove:vi.fn().mockResolvedValue(undefined)};
 const pointer={read:vi.fn().mockResolvedValue(null),save:vi.fn().mockResolvedValue(undefined)};
 const lifecycle=options.lifecycle??{subscribe:async()=>async()=>{},isActive:async()=>true};
 const controller=createReaderController({engine,store,settings,secrets,pointer,lifecycle});
 return {controller,engine,store,secrets,settings,data,pointer,publish(next:EngineSnapshot){snapshot=next;listeners.forEach(listener=>listener());},async initialize(){await settings.save({config,preferences:{fontSize:18,prefetchEnabled:true}});await controller.initialize();}};
}
describe('application controller',()=>{
 it('restores settings with persisted prefetch opt-in and exposes a stable snapshot',async()=>{
  const h=harness(); await h.initialize(); const snapshot=h.controller.getSnapshot();
  expect(snapshot.settings.config).toEqual(config);expect(snapshot.settings.preferences.prefetchEnabled).toBe(true);expect(h.controller.getSnapshot()).toBe(snapshot);
  h.controller.readerActions.onOpen('https://ncode.syosetu.com/n1234ab/1/'); expect(h.engine.startChapter).toHaveBeenCalledWith('https://ncode.syosetu.com/n1234ab/1/',config);
 });
 it('does not dispatch before lifecycle initialization or when inactive',async()=>{
  const h=harness({lifecycle:{subscribe:async()=>async()=>{},isActive:async()=>false}});
  h.controller.readerActions.onOpen('https://ncode.syosetu.com/n1234ab/1/');expect(h.engine.startChapter).not.toHaveBeenCalled();
  await h.initialize();h.controller.readerActions.onOpen('https://ncode.syosetu.com/n1234ab/1/');expect(h.engine.startChapter).not.toHaveBeenCalled();expect(h.engine.setForeground).toHaveBeenLastCalledWith(false);
 });
 it('preserves a newer lifecycle event over a late isActive result',async()=>{
  const initial=deferred<boolean>();let notify!:(active:boolean)=>void;
  const h=harness({lifecycle:{subscribe:async(listener)=>{notify=listener;return async()=>{};},isActive:()=>initial.promise}});
  const ready=h.initialize();await vi.waitFor(()=>expect(notify).toBeTypeOf('function'));notify(false);initial.resolve(true);await ready;
  expect(h.engine.setForeground).toHaveBeenLastCalledWith(false);h.controller.readerActions.onOpen('https://ncode.syosetu.com/n1234ab/1/');expect(h.engine.startChapter).not.toHaveBeenCalled();
 });
 it('fails closed on lifecycle initialization errors and reports a safe error',async()=>{
  const h=harness({lifecycle:{subscribe:async()=>{throw new Error('private details');},isActive:async()=>true}}); await h.initialize();
  expect(h.controller.getSnapshot().appError).toBe('startup');expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('private details');
  h.controller.readerActions.onOpen('https://ncode.syosetu.com/n1234ab/1/');expect(h.engine.startChapter).not.toHaveBeenCalled();
 });
 it('clears an initialization failure after an explicit successful retry',async()=>{
  let fail=true;const h=harness({lifecycle:{subscribe:async()=>async()=>{},isActive:async()=>{if(fail)throw new Error('temporary');return true;}}});
  await h.initialize();expect(h.controller.getSnapshot().appError).toBe('startup');fail=false;await h.controller.initialize();
  expect(h.controller.getSnapshot().initialized).toBe(true);expect(h.controller.getSnapshot().appError).toBeNull();
 });
 it('contains settings-read failures and allows a later explicit initialization retry',async()=>{
  const h=harness();const original=h.settings.read;h.settings.read=async()=>{throw new Error('private settings');};await h.initialize();
  expect(h.controller.getSnapshot().initialized).toBe(false);expect(h.controller.getSnapshot().appError).toBe('settings');h.settings.read=original;
  await h.controller.initialize();expect(h.controller.getSnapshot().initialized).toBe(true);expect(h.controller.getSnapshot().appError).toBeNull();
 });
 it('normalizes settings, increments revision, clears endpoint-scoped auth and persists',async()=>{
  const h=harness();await h.initialize();await h.controller.settingsActions.onSaveSecret('synthetic-secret');
  const before=h.controller.getSnapshot().settings.config;expect(before.authRef).toBeTruthy();
  h.controller.settingsActions.onConfigChange({...before,baseUrl:'http://192.0.2.2:1234/'});
  const after=h.controller.getSnapshot().settings.config;expect(after.baseUrl).toBe('http://192.0.2.2:1234/v1');expect(after.authRef).toBeUndefined();expect(after.settingsRevision).toBe(before.settingsRevision+1);expect(h.engine.invalidate).toHaveBeenCalled();
  await vi.waitFor(async()=>expect((await h.settings.read()).config).toEqual(after));expect([...h.data.values()].join('')).not.toContain('synthetic-secret');
 });
 it('removes a replaced credential only after the new settings persist',async()=>{
  const h=harness();await h.initialize();await h.controller.settingsActions.onSaveSecret('first-secret');const old=h.controller.getSnapshot().settings.config.authRef!;
  await h.controller.settingsActions.onSaveSecret('second-secret');expect(h.secrets.remove).toHaveBeenCalledWith(old);
  const active=h.controller.getSnapshot().settings.config.authRef!;h.settings.save=async()=>{throw new Error('write failed');};
  await h.controller.settingsActions.onSaveSecret('third-secret');expect(h.secrets.remove).not.toHaveBeenCalledWith(active);expect(h.controller.getSnapshot().appError).toBe('settings');
 });
 it('does not attach a late secret save to a changed endpoint',async()=>{
  const pending=deferred<void>();const h=harness({secrets:{get:async()=>null,set:()=>pending.promise,remove:vi.fn().mockResolvedValue(undefined)}});await h.initialize();
  const saving=h.controller.settingsActions.onSaveSecret('synthetic-secret');
  h.controller.settingsActions.onConfigChange({...config,baseUrl:'http://192.0.2.2:1234/v1'});pending.resolve();await saving;
  expect(h.controller.getSnapshot().settings.config.authRef).toBeUndefined();expect(h.controller.getSnapshot().settings.secretStatus).toBe('unset');expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('synthetic-secret');
 });
 it('rounds fractional pixel offsets and rejects stale or invalid positions',async()=>{
  const h=harness({ready:true});await h.initialize();const valid={chapterId:reader.chapter!.source.chapterId,paragraphId:'p1',offset:155.6};
  h.controller.readerActions.onPosition(valid);
  await vi.waitFor(()=>expect(h.store.savePosition).toHaveBeenCalledWith({...valid,offset:156}));
  expect(h.controller.getSnapshot().reader.position?.offset).toBe(156);
  for(const bad of [{...valid,chapterId:'stale'},{...valid,paragraphId:'missing'},{...valid,offset:-1},{...valid,offset:Infinity},{...valid,offset:Number.MAX_VALUE}]) h.controller.readerActions.onPosition(bad);
  expect(h.store.savePosition).toHaveBeenCalledTimes(1);
 });
 it('does not write a queued position after its reader job was replaced',async()=>{
  const h=harness({ready:true});await h.initialize();const pending=deferred<void>();h.store.savePosition=vi.fn().mockImplementationOnce(()=>pending.promise).mockResolvedValue(undefined);
  h.publish({job:{...reader.job,token:{jobId:'old',chapterId:reader.chapter!.source.chapterId,settingsRevision:config.settingsRevision}},chapter:reader.chapter,position:null,cacheKey:reader.chapter!.cacheKey});
  const position={chapterId:reader.chapter!.source.chapterId,paragraphId:'p1',offset:1};h.controller.readerActions.onPosition(position);
  await vi.waitFor(()=>expect(h.store.savePosition).toHaveBeenCalledTimes(1));h.controller.readerActions.onPosition({...position,offset:2});
  h.publish({job:{...reader.job,token:{jobId:'new',chapterId:reader.chapter!.source.chapterId,settingsRevision:config.settingsRevision}},chapter:reader.chapter,position:null,cacheKey:reader.chapter!.cacheKey});
  pending.resolve();await new Promise(resolve=>setTimeout(resolve,0));expect(h.store.savePosition).toHaveBeenCalledTimes(1);
 });
 it('resumes through the existing engine session even before a cache key exists',async()=>{
  const h=harness();await h.initialize();h.publish({job:{phase:'paused',completedChunks:0,totalChunks:0},chapter:null,position:null,cacheKey:null});
  h.controller.readerActions.onResume();expect(h.engine.retry).toHaveBeenCalledTimes(1);expect(h.engine.resumeChapter).not.toHaveBeenCalled();
 });
 it('surfaces settings storage failures without leaking backend messages',async()=>{
  const h=harness();await h.initialize();h.settings.save=async()=>{throw new Error('sensitive backend');};
  h.controller.readerActions.onFontSize(22);await vi.waitFor(()=>expect(h.controller.getSnapshot().appError).toBe('settings'));expect(JSON.stringify(h.controller.getSnapshot())).not.toContain('sensitive backend');
 });
 it('applies explicit Gemini config without reusing local credentials or prefetch consent',async()=>{
  const h=harness();await h.initialize();await h.controller.settingsActions.onSaveSecret('synthetic-local-secret');
  const before=h.controller.getSnapshot().settings.config;
  h.controller.settingsActions.onConfigChange({...before,provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta/',model:'models/synthetic-gemini',contextBudget:8192,outputBudget:2048});
  const after=h.controller.getSnapshot().settings;
  expect(after.config).toEqual({provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini',contextBudget:8192,outputBudget:2048,settingsRevision:before.settingsRevision+1});
  expect(after.secretStatus).toBe('unset');expect(after.preferences.prefetchEnabled).toBe(false);
  await vi.waitFor(async()=>expect((await h.settings.read()).config).toEqual(after.config));
  expect((await h.settings.read()).preferences.prefetchEnabled).toBe(false);
 });
 it('does not attach a late local key save after switching to Gemini',async()=>{
  const pending=deferred<void>();const h=harness({secrets:{get:async()=>null,set:()=>pending.promise,remove:vi.fn().mockResolvedValue(undefined)}});await h.initialize();
  const saving=h.controller.settingsActions.onSaveSecret('synthetic-local-secret');
  h.controller.settingsActions.onConfigChange({...config,provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini'});pending.resolve();await saving;
  expect(h.controller.getSnapshot().settings.config.provider).toBe('gemini');expect(h.controller.getSnapshot().settings.config.authRef).toBeUndefined();
  expect(h.controller.getSnapshot().settings.secretStatus).toBe('unset');expect(h.secrets.remove).toHaveBeenCalledTimes(1);
 });
 it('restores a previously applied Gemini config with its own secure reference',async()=>{
  const h=harness();const gemini={...config,provider:'gemini' as const,baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini',authRef:'provider.gemini'};
  await h.settings.save({config:gemini,preferences:{fontSize:18,prefetchEnabled:false}});await h.controller.initialize();
  expect(h.controller.getSnapshot().initialized).toBe(true);expect(h.controller.getSnapshot().settings.config).toEqual(gemini);
  h.controller.readerActions.onOpen('https://ncode.syosetu.com/n1234ab/1/');expect(h.engine.startChapter).toHaveBeenCalledWith('https://ncode.syosetu.com/n1234ab/1/',gemini);
 });
 it.each(['https://example.com/v1beta','http://generativelanguage.googleapis.com/v1beta','https://generativelanguage.googleapis.com/v1beta?key=private'])('rejects Gemini configuration with unsafe endpoint %s',baseUrl=>{
  return (async()=>{const h=harness();await h.initialize();h.controller.settingsActions.onConfigChange({...config,provider:'gemini',baseUrl,model:'synthetic-gemini'});
   expect(h.controller.getSnapshot().settings.config).toEqual(config);expect(h.controller.getSnapshot().appError).toBe('configuration');})();
 });
 it.each(['','../other','gemini?key=secret','gemini/model'])('rejects unsafe Gemini model %s',model=>{
  return (async()=>{const h=harness();await h.initialize();h.controller.settingsActions.onConfigChange({...config,provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model});
   expect(h.controller.getSnapshot().settings.config).toEqual(config);expect(h.controller.getSnapshot().appError).toBe('configuration');})();
 });

 it('keeps Gemini credentials scoped while model changes and removes the reference when switching back to local',async()=>{
  const h=harness();await h.initialize();
  h.controller.settingsActions.onConfigChange({...config,provider:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:'synthetic-gemini'});
  await h.controller.settingsActions.onSaveSecret('synthetic-gemini-key');
  h.controller.settingsActions.onPrefetchChange(true);const cloud=h.controller.getSnapshot().settings.config;
  h.controller.settingsActions.onConfigChange({...cloud,model:'synthetic-gemini-other'});
  expect(h.controller.getSnapshot().settings.config.authRef).toBe(cloud.authRef);expect(h.controller.getSnapshot().settings.preferences.prefetchEnabled).toBe(true);
  h.controller.settingsActions.onConfigChange({...config,authRef:cloud.authRef});
  expect(h.controller.getSnapshot().settings.config.authRef).toBeUndefined();expect(h.controller.getSnapshot().settings.secretStatus).toBe('unset');
  expect(h.controller.getSnapshot().settings.preferences.prefetchEnabled).toBe(false);
 });

});
