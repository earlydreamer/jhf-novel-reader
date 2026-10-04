import { describe, expect, it } from 'vitest';
import { createLastChapterRepository } from '../../src/app/lastChapter';

describe('last chapter pointer',()=>{
 it('round trips one bounded versioned cache key without storing content',async()=>{
  const values=new Map<string,string>();const backend={get:async({key}:{key:string})=>({value:values.get(key)??null}),set:async({key,value}:{key:string,value:string})=>{values.set(key,value);}};
  const repository=createLastChapterRepository(backend);expect(await repository.read()).toBeNull();
  const key=`v1-${'a'.repeat(64)}`;await repository.save(key);expect(await createLastChapterRepository(backend).read()).toBe(key);expect(values.size).toBe(1);
  expect(JSON.parse([...values.values()][0]!)).toEqual({schemaVersion:1,cacheKey:key});
 });
 it.each(['../secrets','v2-'+ 'a'.repeat(64),'v1-'+ 'A'.repeat(64),'x'.repeat(10000)])('rejects invalid pointer %s',async(key)=>{
  let value:string|null=null;const repository=createLastChapterRepository({get:async()=>({value}),set:async(options)=>{value=options.value;}});
  await expect(repository.save(key)).rejects.toMatchObject({code:'storage'});expect(value).toBeNull();
  value=JSON.stringify({schemaVersion:1,cacheKey:key});await expect(repository.read()).rejects.toMatchObject({code:'storage'});
 });
 it('rejects corrupt, extra-field and future pointers safely',async()=>{
  for(const value of ['{',JSON.stringify({schemaVersion:2,cacheKey:`v1-${'a'.repeat(64)}`}),JSON.stringify({schemaVersion:1,cacheKey:`v1-${'a'.repeat(64)}`,secret:'hidden'})]) {
   const repository=createLastChapterRepository({get:async()=>({value}),set:async()=>{}});await expect(repository.read()).rejects.toMatchObject({code:'storage'});
  }
 });
});
