import { describe, expect, it, vi } from 'vitest';
import type { ChunkRequest, ModelTransport, ProviderConfig } from '../../src/contracts';
import { createOpenAICompatibleProvider } from '../../src/providers/openai-compatible';
import { createGeminiProvider, GEMINI_BASE_URL } from '../../src/providers/gemini';
const request:ChunkRequest={token:{jobId:'job',chapterId:'chapter',settingsRevision:1},chunkId:'chunk',context:[{id:'before',text:'前',ruby:[]}],paragraphs:[{id:'a',text:'雨',ruby:[]},{id:'b',text:'空',ruby:[]}],outputIds:['a','b'],languageDirection:'ja-ko',promptVersion:'ja-ko-v1'};
const good=[{id:'a',text:'비'},{id:'b',text:'하늘'}];
const providers=[
 {id:'openai-compatible' as const,url:'http://192.0.2.1/v1',create:createOpenAICompatibleProvider,envelope:(paragraphs:unknown)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({paragraphs})}}]})},
 {id:'gemini' as const,url:GEMINI_BASE_URL,create:createGeminiProvider,envelope:(paragraphs:unknown)=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({paragraphs})}]}}]})},
];
for(const provider of providers)describe(provider.id+' shared TranslationProvider contract',()=>{
 const config:ProviderConfig={provider:provider.id,baseUrl:provider.url,model:'synthetic-model',authRef:'provider.test',contextBudget:8192,outputBudget:1024,settingsRevision:1};
 const secrets={get:async()=> 'synthetic-key',set:async()=>{},remove:async()=>{}};
 it('returns exact ordered IDs excluding surrounding context',async()=>{const post:ModelTransport['post']=async input=>({status:200,url:input.url,headers:{},data:provider.envelope(good)});expect(await provider.create(config,{post},secrets).translateChunk(request,new AbortController().signal)).toEqual({chunkId:'chunk',paragraphs:good,finishReason:'complete'});});
 it.each([[...good].reverse(),[good[0],good[0]],[{id:'before',text:'앞'},good[1]],[],[...good,{id:'extra',text:'추가'}]].map(paragraphs=>({paragraphs})))('rejects incorrect complete output %#',async ({paragraphs})=>{const post:ModelTransport['post']=async input=>({status:200,url:input.url,headers:{},data:provider.envelope(paragraphs)});await expect(provider.create(config,{post},secrets).translateChunk(request,new AbortController().signal)).rejects.toMatchObject({code:'invalid_output',outcome:'received'});});
 it('snapshots config and does not retry an unknown POST',async()=>{const mutable={...config};const post=vi.fn<ModelTransport['post']>().mockRejectedValue(new Error('private server details'));const adapter=provider.create(mutable,{post},secrets);mutable.baseUrl='https://evil.test';mutable.model='changed';await expect(adapter.translateChunk(request,new AbortController().signal)).rejects.toMatchObject({code:'timeout_unknown',outcome:'unknown',message:'timeout_unknown'});expect(post).toHaveBeenCalledTimes(1);expect(post.mock.calls[0]![0].url).toContain(config.baseUrl);expect(post.mock.calls[0]![0].url).not.toContain('evil.test');});
});
