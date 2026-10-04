// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { parseChapter, normalizeSourceUrl, NarouSourceAdapter } from '../../src/source';
const url='https://ncode.syosetu.com/n1234ab/2/';
const html='<h1 class="p-novel__title">合成</h1><div class="p-novel__body"><div class="p-novel__text"><p>本文</p></div></div>';
it.each(['javascript:alert(1)','http://ncode.syosetu.com/n1234ab/2/','https://evil.test/n1234ab/2/','https://ncode.syosetu.com.evil.test/n1234ab/2/','https://user:secret@ncode.syosetu.com/n1234ab/2/','https://ncode.syosetu.com:444/n1234ab/2/','https://novel18.syosetu.com/n1234ab/2/','https://ncode.syosetu.com/login/','https://ncode.syosetu.com/n1234ab/0/','https://ncode.syosetu.com/n1234ab/2/?p=9','https://ncode.syosetu.com/n1234ab/%32/','https://ncode.syosetu.com/n1234ab/../n9999ab/2/'])('rejects unsupported or ambiguous URL %s',value=>expect(()=>normalizeSourceUrl(value)).toThrow('source_access'));
it('drops active elements and emits only structured text without fetching resources',async()=>{
 const result=await parseChapter(html.replace('本文','<script>secret()</script><style>hidden</style><img src="https://evil.test/pixel" onerror="evil()"><iframe src="https://evil.test"></iframe><svg><text>hidden</text></svg><a href="javascript:evil()" onclick="evil()">安全</a>'),url);
 expect(result.paragraphs[0]!.text).toBe('安全');expect(JSON.stringify(result)).not.toContain('evil');
});
it('drops unsafe, cross-work, self, and wrong-direction neighbors',async()=>{
 for(const href of ['javascript:evil()','https://evil.test/','/n9999ab/3/','/n1234ab/2/','/n1234ab/1/']) {
  const result=await parseChapter(html+`<a class="c-pager__item--next" href="${href}">次へ</a>`,url);expect(result.nextUrl).toBeNull();
 }
});
it.each(['<title>ログイン</title>','<title>年齢確認</title>','<title>Access Denied</title>','<form><input type="password"></form>','<div id="cf-challenge-running"></div>'])('rejects interstitial pages even with a copied body marker',async gate=>await expect(parseChapter(gate+html,url)).rejects.toMatchObject({code:'source_access'}));
it.each([401,403,429,302,404])('maps HTTP %s without parsing or retries',async status=>{
 const get=vi.fn().mockResolvedValue({status,headers:{'content-type':'text/html'},data:html,url});
 await expect(new NarouSourceAdapter({get}).getChapter(url,new AbortController().signal)).rejects.toMatchObject({code:'source_access',status});expect(get).toHaveBeenCalledTimes(1);
});
it.each([{url:'https://evil.test/'},{headers:{'content-type':'application/json'}},{data:{}},{headers:{}}])('rejects invalid response %j',async override=>{
 const get=vi.fn().mockResolvedValue({status:200,headers:{'content-type':'text/html; charset=utf-8'},data:html,url,...override});
 await expect(new NarouSourceAdapter({get}).getChapter(url,new AbortController().signal)).rejects.toMatchObject({code:'source_access'});
});
it('validates before GET and ignores response after cancellation',async()=>{
 const controller=new AbortController();const get=vi.fn().mockImplementation(async()=>{controller.abort();return {status:200,headers:{'content-type':'text/html'},data:html,url};});
 const adapter=new NarouSourceAdapter({get});await expect(adapter.getChapter('https://evil.test/',controller.signal)).rejects.toMatchObject({code:'source_access'});expect(get).not.toHaveBeenCalled();
 await expect(adapter.getChapter(url,controller.signal)).rejects.toMatchObject({code:'cancelled'});expect(get).toHaveBeenCalledTimes(1);
 await expect(adapter.getChapter(url,controller.signal)).rejects.toMatchObject({code:'cancelled'});expect(get).toHaveBeenCalledTimes(1);
});
it('follows only the first TOC chapter, with no pagination or bulk fetching',async()=>{
 const root='https://ncode.syosetu.com/n1234ab/'; const first=root+'1/';
 const get=vi.fn(async(target:string)=>({status:200,headers:{'Content-Type':'text/html'},data:target===root?'<h1 class="p-novel__title">作品</h1><div class="p-eplist__sublist"><a href="/n1234ab/1/">一話</a></div><div class="p-eplist__sublist"><a href="/n1234ab/2/">二話</a></div>':html,url:target}));
 expect((await new NarouSourceAdapter({get}).getChapter(root,new AbortController().signal)).canonicalUrl).toBe(first);expect(get.mock.calls.map(c=>c[0])).toEqual([root,first]);
});
it('rejects encoded dot traversal before WHATWG URL canonicalization',()=>{
 expect(()=>normalizeSourceUrl('https://ncode.syosetu.com/n1234ab/%2e%2e/n9999ab/2/')).toThrow('source_access');
});
it('does not mistake a novel title containing login words for a gate',async()=>{
 expect((await parseChapter('<title>異世界にログインした勇者の物語</title>'+html,url)).paragraphs[0]!.text).toBe('本文');
});
it('bounds deep markup with a typed parse error',async()=>{
 await expect(parseChapter(html.replace('本文','<span>'.repeat(512)+'本文'+'</span>'.repeat(512)),url)).rejects.toMatchObject({code:'source_parse'});
});
// Keep the original adversarial input; jsdom parsing can exceed the default 5s
// when the full integration suite runs concurrently. Production limits are unchanged.
it('rejects adversarial 4000-level markup without dropping the depth guard',async()=>{
 await expect(parseChapter(html.replace('本文','<span>'.repeat(4000)+'本文'+'</span>'.repeat(4000)),url)).rejects.toMatchObject({code:'source_parse'});
},20000);
it('discards percent-encoded neighbor paths before resolution',async()=>{
 expect((await parseChapter(html+'<a class="c-pager__item--next" href="/n1234ab/%2e%2e/n1234ab/3/">次へ</a>',url)).nextUrl).toBeNull();
});
it.each(['<ruby><rb>東</rb><rb>京</rb><rt>とう</rt><rt>きょう</rt></ruby>','<ruby>漢<rtc><rt>かん</rt></rtc></ruby>'])('fails unsupported complex ruby closed instead of losing readings',async ruby=>{
 await expect(parseChapter(html.replace('本文',ruby),url)).rejects.toMatchObject({code:'source_parse'});
});
it('rejects grouped ruby readings even when formatting whitespace separates them',async()=>{
 await expect(parseChapter(html.replace('本文','<ruby><rb>東</rb><rb>京</rb><rt>とう</rt>\n<rt>きょう</rt></ruby>'),url)).rejects.toMatchObject({code:'source_parse'});
});
