import Capacitor
import Network
import UIKit
import WebKit
import XCTest

@testable import App

/// Runs inside the signed product app on the explicitly selected physical iPhone.
@MainActor
final class DeviceSmokeTests: XCTestCase {
  private func webView() async throws -> WKWebView {
    for _ in 0..<200 {
      let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        .flatMap(\.windows)
      if let root = windows.compactMap({ $0.rootViewController as? JHFBridgeViewController }).first,
        let web = root.webView,
        let ready = try? await web.evaluateJavaScript(
          "document.readyState === 'complete' && !!document.querySelector('.nr-library__empty, .nr-library__list, .nr-settings, .nr-work-screen')"),
        ready as? Bool == true
      {
        return web
      }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw NSError(
      domain: "JHFDeviceTests", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "The product app did not render its controls."])
  }
  private func evaluate(_ body: String) async throws -> [String: Any] {
    let web = try await webView()
    let value = try await web.callAsyncJavaScript(
      body, arguments: [:], in: nil, contentWorld: .page)
    return try XCTUnwrap(value as? [String: Any])
  }
  func test01ProductLibraryAndSettingsRender() async throws {
    let web = try await webView()
    let value = try await evaluate(
      "return {platform: Capacitor.getPlatform(), library: !!document.querySelector('[aria-label=\"서재\"]'), add: document.querySelector('.nr-fab')?.textContent === '작품 추가', url: !!document.querySelector('button[aria-label=\"URL로 열기\"]')};"
    )
    XCTAssertEqual(value["platform"] as? String, "ios")
    XCTAssertEqual(value["library"] as? Bool, true)
    XCTAssertEqual(value["add"] as? Bool, true)
    XCTAssertEqual(value["url"] as? Bool, true)
    let dialog = try await evaluate(
      """
      const wait = async predicate => {
          for (let n=0; n<100; n++) {
              if (predicate()) return;
              await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error('URL dialog did not reach the expected state');
      };
      const open = () => document.querySelector('dialog[open] .nr-library__url-form');
      const close = () => [...document.querySelectorAll('dialog[open] button')]
          .find(button => button.textContent.trim() === '닫기').click();
      document.querySelector('.nr-fab').click();
      await wait(open);
      const viaAdd = !!open().querySelector('input[name="url"]');
      close();
      await wait(() => !open());
      document.querySelector('button[aria-label="URL로 열기"]').click();
      await wait(open);
      const viaLink = !!open().querySelector('input[name="url"]');
      const count = document.querySelectorAll('dialog[open] .nr-library__url-form').length;
      close();
      await wait(() => !open());
      return {viaAdd, viaLink, count};
      """)
    XCTAssertEqual(dialog["viaAdd"] as? Bool, true)
    XCTAssertEqual(dialog["viaLink"] as? Bool, true)
    XCTAssertEqual(dialog["count"] as? Int, 1)
    try await Task.sleep(nanoseconds: 400_000_000)
    let library = try await web.takeSnapshot(configuration: nil)
    let shot = XCTAttachment(image: library)
    shot.name = "JHF-iPhone-library"
    shot.lifetime = .keepAlways
    add(shot)
    let settingsReady =
      "!!document.querySelector('section.nr-settings #settings-server') && !!document.querySelector('section.nr-settings input')"
    let before = try await web.evaluateJavaScript(settingsReady)
    XCTAssertEqual(before as? Bool, false)
    _ = try await web.evaluateJavaScript(
      "document.querySelector('button[aria-label=\"설정\"]').click()")
    var settings = false
    for _ in 0..<100 {
      settings = (try await web.evaluateJavaScript(settingsReady)) as? Bool == true
      if settings { break }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    XCTAssertTrue(settings)
    let updates = try await evaluate(
      """
      const form = document.querySelector('.nr-chapter-update-settings');
      const input = form?.querySelector('input[type="number"]');
      return {present:!!form, value:Number(input?.value), min:input?.min, max:input?.max,
          midnight:form?.textContent.includes('0시'), manual:form?.textContent.includes('수동 검사')};
      """)
    XCTAssertEqual(updates["present"] as? Bool, true)
    XCTAssertTrue((1...365).contains(updates["value"] as? Int ?? 0))
    XCTAssertEqual(updates["min"] as? String, "1")
    XCTAssertEqual(updates["max"] as? String, "365")
    XCTAssertEqual(updates["midnight"] as? Bool, true)
    XCTAssertEqual(updates["manual"] as? Bool, true)
    let image = try await web.takeSnapshot(configuration: nil)
    let attachment = XCTAttachment(image: image)
    attachment.name = "JHF-iPhone-settings"
    attachment.lifetime = .keepAlways
    add(attachment)
  }
  /// Synthetic source responses at the JS/native boundary; real storage and product UI.
  /// Native HTTP/SSE are independently exercised by test04 with an in-device server.
  func test05UpdateSettingsManualChecksAndBadges() async throws {
    let settings = try await evaluate(#"""
return await (async()=>{
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{for(let n=0;n<150;n++){if(await fn())return;await pause(100);}throw Error('UI wait timed out');};
const key='narou-reader.reading-settings.v2', prefs=Capacitor.Plugins.Preferences;
const original=(await prefs.get({key})).value;
window.__jhfOriginalSettings=original;
const input=()=>document.querySelector('.nr-chapter-update-settings input');
const set=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input(),String(value)); input().dispatchEvent(new Event('input',{bubbles:true}));};
const originalDays=Number(input().value), trial=originalDays===3?2:3;
const report={defaultDays:originalDays};
try{
set(0);await pause(100);report.rejectsZero=document.querySelector('.nr-chapter-update-settings button').disabled;
set(366);await pause(100);report.rejectsOverMaximum=document.querySelector('.nr-chapter-update-settings button').disabled;
set(trial);await pause(100);document.querySelector('.nr-chapter-update-settings button').click();
await wait(async()=>JSON.parse((await prefs.get({key})).value)?.chapterUpdateDays===trial);
document.querySelector('button[aria-label="뒤로 가기"]').click();await wait(()=>!!document.querySelector('.nr-library'));
document.querySelector('button[aria-label="설정"]').click();await wait(()=>input()?.value===String(trial));
report.savedAndReopened=true;
set(originalDays);await pause(100);document.querySelector('.nr-chapter-update-settings button').click();
await wait(()=>document.querySelector('.nr-chapter-update-settings button').disabled);
}finally{
if(original===null)await prefs.remove({key});else await prefs.set({key,value:original});
report.originalPreferenceRestored=(await prefs.get({key})).value===original;
}
return report;
})();
"""#)
    XCTAssertEqual(settings["rejectsZero"] as? Bool, true)
    XCTAssertEqual(settings["rejectsOverMaximum"] as? Bool, true)
    XCTAssertEqual(settings["savedAndReopened"] as? Bool, true)
    XCTAssertEqual(settings["originalPreferenceRestored"] as? Bool, true)
    let cleanup = #"""
return await (async()=>{
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await delay(100);}throw Error('Fixture cleanup timed out');};
try{
if(document.querySelector('.nr-work-screen,.nr-settings')){document.querySelector('button[aria-label="뒤로 가기"]').click();await wait(()=>!!document.querySelector('.nr-library__empty,.nr-library__list'));}
const menu=document.querySelector('button[aria-label="실기 합성 작품 메뉴"]');
if(menu){if(!document.querySelector('dialog[open]')){menu.click();await delay(100);[...document.querySelectorAll('[role="menuitem"]')].find(x=>x.textContent.includes('서재에서 제거하기')).click();await wait(()=>!!document.querySelector('dialog[open]'));}
[...document.querySelectorAll('dialog[open] button')].find(x=>x.textContent.trim()==='제거하기').click();await wait(()=>!!document.querySelector('.nr-library__empty'));}
return {fixtureRemoved:!!document.querySelector('.nr-library__empty')};
}finally{if(window.__jhfFixture){Capacitor.nativePromise=window.__jhfFixture.original;delete window.__jhfFixture;}}
})();
"""#
    let before = try await evaluate(cleanup)
    XCTAssertEqual(before["fixtureRemoved"] as? Bool, true)
    do {
      let checks = try await evaluate(#"""
return await (async()=>{
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await delay(100);}throw Error(label);};
const click=async text=>{const target=[...document.querySelectorAll('button,[role="menuitem"]')].find(x=>x.textContent.trim()===text||x.getAttribute('aria-label')===text);if(!target)throw Error('Missing '+text);target.click();if(text==='새 회차 확인'||text==='서재 전체 새 회차 확인'){await wait(()=>!!document.querySelector('dialog[open]'),'Check confirmation');await wait(()=>[...document.querySelectorAll('dialog[open] button')].some(x=>x.textContent.trim()==='확인하기'&&!x.disabled),'Check ready');[...document.querySelectorAll('dialog[open] button')].find(x=>x.textContent.trim()==='확인하기').click();await wait(()=>!document.querySelector('dialog[open]'),'Check submitted');}};
document.querySelector('button[aria-label="뒤로 가기"]')?.click();
await wait(()=>!!document.querySelector('.nr-library__empty'),'Expected empty library');
const original=Capacitor.nativePromise;
window.__jhfFixture={count:1,requests:0,original};
Capacitor.nativePromise=function(plugin,method,options){
 if((plugin==='CapacitorHttp'||plugin==='ReaderHttp')&&method==='request'&&options.url.startsWith('https://ncode.syosetu.com/n1234ab/')){
  const f=window.__jhfFixture;f.requests++;
  const data='<h1 class="p-novel__title">실기 합성 작품</h1>'+Array.from({length:f.count},(_,i)=>`<div class="p-eplist__sublist"><a href="/n1234ab/${i+1}/">${i+1}화</a>${i ? '<div class="p-eplist__update">'+new Date(Date.now()-3600000+9*3600000).toISOString().slice(0,16).replaceAll('-','/').replace('T',' ')+'</div>' : ''}</div>`).join('');
  return Promise.resolve({status:200,headers:{'Content-Type':'text/html; charset=utf-8'},data,url:options.url});
 }
 return original.call(this,plugin,method,options);
};
document.querySelector('button[aria-label="URL로 열기"]').click();await wait(()=>!!document.querySelector('input[name="url"]'),'URL dialog');
const input=document.querySelector('input[name="url"]');input.value='https://ncode.syosetu.com/n1234ab/';
document.querySelector('.nr-library__url-form').requestSubmit();
await wait(()=>document.querySelector('.nr-work-screen ol')?.children.length===1,'Initial work');
await wait(()=>[...document.querySelectorAll('.nr-top-app-bar button')].some(button=>button.getAttribute('aria-label')==='새 회차 확인' && !button.disabled),'Individual check ready');
document.querySelector('.nr-top-app-bar button[aria-label="새 회차 확인"]').click();
await wait(()=>document.querySelector('dialog[open] p')?.textContent==='이 작품의 목차를 최신화해요.','Concise confirmation');
[...document.querySelectorAll('dialog[open] button')].find(x=>x.textContent.trim()==='취소').click();
await wait(()=>!document.querySelector('dialog[open]'),'Initial check status closed');
const initialRequests=window.__jhfFixture.requests;
window.__jhfFixture.count=2;
await click('새 회차 확인');
await wait(()=>document.querySelector('.nr-work-screen ol')?.children.length===2&&document.querySelector('.nr-new-chapter-badge')?.textContent==='새 회차','Individual new badge');
const report={individualCheck:true,workBadge:true};
document.querySelector('button[aria-label="뒤로 가기"]').click();await wait(()=>!!document.querySelector('.nr-top-app-bar button[aria-label="서재 전체 새 회차 확인"]'),'Home');
report.libraryBadge=document.querySelector('.nr-library .nr-new-chapter-badge')?.textContent==='새 회차 1';
window.__jhfFixture.count=3;await click('서재 전체 새 회차 확인');
await wait(()=>document.querySelector('.nr-library .nr-new-chapter-badge')?.textContent==='새 회차 2','All check badge');
report.allCheck=true;report.combinedBadge=true;report.manualRequests=window.__jhfFixture.requests-initialRequests;
return report;
})();
"""#)
      XCTAssertEqual(checks["individualCheck"] as? Bool, true)
      XCTAssertEqual(checks["workBadge"] as? Bool, true)
      XCTAssertEqual(checks["libraryBadge"] as? Bool, true)
      XCTAssertEqual(checks["allCheck"] as? Bool, true)
      XCTAssertEqual(checks["combinedBadge"] as? Bool, true)
      XCTAssertEqual(checks["manualRequests"] as? Int, 2)
      let web = try await webView()
      try await Task.sleep(nanoseconds: 400_000_000)
      let image = try await web.takeSnapshot(configuration: nil)
      let attachment = XCTAttachment(image: image)
      attachment.name = "JHF-iPhone-new-chapter-badge"
      attachment.lifetime = .keepAlways
      add(attachment)
    } catch {
      _ = try? await evaluate(cleanup)
      throw error
    }
    let cleaned = try await evaluate(cleanup)
    XCTAssertEqual(cleaned["fixtureRemoved"] as? Bool, true)
  }
  /// Real HTTP responses, native persisted metadata and product UI on the physical iPhone.
  /// Existing translations, reading positions and preferences must remain byte-identical.
  func test06RealNarouWorkAddAndCheck() async throws {
    guard let url = ProcessInfo.processInfo.environment["JHF_REAL_SOURCE_URL"], !url.isEmpty else {
      throw XCTSkip("Pass LiveSourceUrl explicitly to run the real Narou check.")
    }
    let urlData = try JSONSerialization.data(withJSONObject: url, options: .fragmentsAllowed)
    let urlLiteral = try XCTUnwrap(String(data: urlData, encoding: .utf8))
    let script = #"""
return await (async () => {
  const url = __JHF_LIVE_URL_LITERAL__;
  const workId = new URL(url).pathname.split('/')[1];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    for (let n = 0; n < 900; n++) {
      if (await predicate()) return;
      await sleep(100);
    }
    throw new Error(label);
  };
  const button = label => document.querySelector(`.nr-top-app-bar button[aria-label="${label}"]`);
  const modal = () => document.querySelector('dialog[open]');
  const toast = () => document.querySelector('.nr-snackbar__text')?.textContent;
  const refreshed = '회차 목록을 갱신했어요.';
  const clickModal = text => {
    const target = [...modal().querySelectorAll('button')].find(element => element.textContent.trim() === text);
    if (!target || target.disabled) throw new Error('Modal button unavailable: ' + text);
    target.click();
  };
  if (window.__jhfFixture) throw new Error('Synthetic source fixture is active');
  const original = Capacitor.nativePromise;
  const native = (plugin, method, options) => original.call(Capacitor, plugin, method, options);
  const digest = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const readText = async path => (await native('Filesystem','readFile',{path:'narou-reader/'+path,directory:'LIBRARY_NO_CLOUD',encoding:'utf8'})).data;
  const journal = async path => {
    const entries = await Promise.all([0,1].map(async slot => {
      let text;
      try { text = await readText(`${path}.${slot}.json`); } catch { return null; }
      const entry = JSON.parse(text);
      if (await digest(JSON.stringify([1,entry.generation,entry.payload])) !== entry.checksum) throw Error('Journal checksum mismatch');
      return entry;
    }));
    return entries.filter(Boolean).sort((a,b)=>b.generation-a.generation)[0]?.payload;
  };
  const index = async () => {
    const value = await journal('library/index');
    if (!value) throw Error('Library index unavailable');
    return value;
  };
  const protectedSnapshot = async () => {
    const files = {};
    // Discover existing directories first; never hide arbitrary native read errors.
    const roots = (await native('Filesystem','readdir',{path:'narou-reader',directory:'LIBRARY_NO_CLOUD'})).files.map(file=>file.name);
    for (const directory of ['versions','reading','positions','chapters'].filter(name=>roots.includes(name))) {
      const entries = (await native('Filesystem','readdir',{path:'narou-reader/'+directory,directory:'LIBRARY_NO_CLOUD'})).files;
      for (const file of entries.filter(file=>file.type==='file').sort((a,b)=>a.name.localeCompare(b.name))) files[`${directory}/${file.name}`] = await digest(await readText(`${directory}/${file.name}`));
    }
    const preferences = {};
    const {keys} = await native('Preferences','keys',{});
    for (const key of keys.sort()) preferences[key] = await digest((await native('Preferences','get',{key})).value ?? '');
    const data = await index();
    return {files,preferences,workIds:data.workIds,versions:data.versions,recent:data.recent};
  };
  const baseline = await protectedSnapshot();
  const report = window.__jhfLive = {url,platform:Capacitor.getPlatform(),requests:[],responseReplacement:false,initialLibraryCount:baseline.workIds.length};
  const readingSettings = JSON.parse((await native('Preferences','get',{key:'narou-reader.reading-settings.v2'})).value ?? 'null');
  report.modelConfigured = !!readingSettings?.selection?.modelId;
  report.titleToastCount = 0;
  let toastEvents = 0;
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && (node.matches?.('.nr-snackbar__text') || node.querySelector?.('.nr-snackbar__text'))) {
        if (node.textContent.includes(refreshed)) toastEvents++;
        if (node.textContent.includes('제목을 번역하고 있어요.')) report.titleToastCount++;
      }
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  const openConfirmation = async label => {
    const target = button(label);
    if (!target || target.disabled || !target.querySelector('[data-icon="refresh"]')) throw Error('Refresh icon unavailable');
    target.click();
    await wait(modal,'Confirmation did not open');
    const expected = label==='새 회차 확인' ? '이 작품의 목차를 최신화해요.' : '서재에 있는 모든 작품의 목차를 최신화해요.';
    const paragraphs = [...modal().querySelectorAll('p')].map(p=>p.textContent.trim());
    if (paragraphs.length!==1 || paragraphs[0]!==expected || modal().querySelector('[role="status"]')) throw Error('Confirmation copy is not concise');
    report[label==='새 회차 확인' ? 'individualCopy' : 'allCopy'] = paragraphs[0];
  };
  const confirmCheck = async (label,prefix) => {
    // Dismiss the preceding notification so the next success must create a fresh toast.
    document.querySelector('.nr-snackbar button')?.click();
    await wait(()=>!document.querySelector('.nr-snackbar'),'Previous toast did not close');
    const before = report.requests.length;
    await openConfirmation(label);
    await sleep(600);
    report[prefix+'BeforeConfirmNoRequest'] = report.requests.length===before;
    clickModal('취소');
    await wait(()=>!modal(),'Cancel did not close confirmation');
    await sleep(100);
    report[prefix+'CancelNoRequest'] = report.requests.length===before;
    await openConfirmation(label);
    modal().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await wait(()=>!modal(),'Escape did not close confirmation');
    await sleep(250);
    report[prefix+'EscapeNoRequest'] = report.requests.length===before;
    const beforeToasts = toastEvents;
    await openConfirmation(label);
    clickModal('확인하기');
    await wait(()=>!modal(),'Confirmation did not close after submit');
    await wait(()=>report.requests.length>before && report.requests.slice(before).every(request=>request.completed) && button(label) && !button(label).disabled && toast()===refreshed,'Confirmed check and toast did not finish');
    await sleep(100);
    report[prefix+'Requests'] = report.requests.length-before;
    report[prefix+'Toast'] = toast();
    report[prefix+'ToastCount'] = toastEvents-beforeToasts;
    if (!report[prefix+'BeforeConfirmNoRequest'] || !report[prefix+'CancelNoRequest'] || !report[prefix+'EscapeNoRequest'] || report[prefix+'ToastCount']!==1) throw Error('Confirmation or single-toast assertions failed');
  };
  Capacitor.nativePromise = function(plugin,method,options) {
    if ((plugin==='CapacitorHttp'||plugin==='ReaderHttp') && method==='request' && /^https:\/\/ncode\.syosetu\.com\/n\d+[a-z]+\//.test(options.url)) {
      const entry = {url:options.url,completed:false};
      report.requests.push(entry);
      const start = Date.now();
      return original.call(this,plugin,method,options).then(response=>{
        Object.assign(entry,{completed:true,status:response.status,bytes:typeof response.data==='string'?new TextEncoder().encode(response.data).length:0,elapsedMs:Date.now()-start});
        return response;
      },error=>{Object.assign(entry,{completed:true,failed:true});throw error;});
    }
    return original.call(this,plugin,method,options);
  };
  try {
    document.querySelector('.nr-fab').click();
    await wait(()=>document.querySelector('dialog[open] input[name="url"]'),'URL dialog not open');
    document.querySelector('dialog[open] input[name="url"]').value = url;
    document.querySelector('.nr-library__url-form').requestSubmit();
    await wait(()=>document.querySelectorAll('.nr-work-screen ol > li').length>0,'Real work did not render');
    await wait(async()=>button('새 회차 확인') && !button('새 회차 확인').disabled && (await index()).workUpdates?.some(update=>update.workId===workId && !update.failed && update.checkedAt),'Initial check did not settle');
    report.importedChapterCount = document.querySelectorAll('.nr-work-screen ol > li').length;
    report.importRequests = report.requests.length;
    report.workBodyControlRemoved = !document.querySelector('.nr-work-screen .nr-chapter-update-control');
    await confirmCheck('새 회차 확인','individual');
    report.individualSuccess = true;
    report.checkedChapterCount = document.querySelectorAll('.nr-work-screen ol > li').length;
    const data = await index();
    const pages = await journal(`works/${workId}`);
    const readIds = new Set();
    for (const version of data.versions.filter(version=>version.workId===workId)) {
      const position = await journal(`reading/${version.versionId}`);
      if (position) readIds.add(position.chapterId);
    }
    const chapters = pages.flatMap(page=>page.chapters);
    report.workTitle = pages[0].title;
    report.cachedPageCount = pages.length;
    report.cachedChapterCount = chapters.length;
    const now = Date.now();
    const visibleIds = new Set([...document.querySelectorAll('.nr-work-screen ol > li')].map(row=>`${workId}/${row.value}`));
    const expected = chapters.filter(chapter=>{
      const age = now-Date.parse(chapter.publishedAt??'');
      return visibleIds.has(chapter.chapterId) && age>=0 && age<=48*3600000 && !readIds.has(chapter.chapterId);
    }).map(chapter=>chapter.chapterId);
    const actual = [...document.querySelectorAll('.nr-work-screen ol > li')].filter(row=>row.querySelector('.nr-new-chapter-badge')).map(row=>`${workId}/${row.value}`);
    report.publicationMetadata = chapters.slice(-4).map(chapter=>({chapterId:chapter.chapterId,publishedAt:chapter.publishedAt,read:readIds.has(chapter.chapterId),badge:actual.includes(chapter.chapterId)}));
    report.expectedBadgeIds = expected;
    report.actualBadgeIds = actual;
    report.readChapterIds = [...readIds];
    report.badgesMatchPublicationAndReading = JSON.stringify(actual)===JSON.stringify(expected);
    report.chapterBadgesHaveNoNumber = [...document.querySelectorAll('.nr-work-screen .nr-new-chapter-badge')].every(badge=>badge.textContent==='새 회차');
    if (!report.badgesMatchPublicationAndReading || !report.chapterBadgesHaveNoNumber) throw Error('Publication/read badge assertions failed');
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    report.lastCheckDate = data.workUpdates.find(update=>update.workId===workId).lastCheckDate;
    report.dateBasedCheck = report.lastCheckDate===localDate;
    document.querySelector('button[aria-label="뒤로 가기"]').click();
    await wait(()=>button('서재 전체 새 회차 확인'),'Library did not render');
    report.libraryCount = document.querySelectorAll('.nr-library__list > li').length;
    report.libraryBodyControlRemoved = !document.querySelector('.nr-library__updates');
    // Explicitly requested whole-library refresh: preserve every registered work and record all HTTP results.
    await confirmCheck('서재 전체 새 회차 확인','all');
    report.allSuccess = !document.querySelector('.nr-library__update-error');
    if (pages.length>1) {
      const openCached = async () => {
        const target = [...document.querySelectorAll('.nr-library__list .nr-list-item__main')].find(item=>item.querySelector('.nr-list-item__headline')?.textContent===report.workTitle);
        if (!target) throw Error('Cached work row unavailable');
        target.click();
        await wait(()=>document.querySelectorAll('.nr-work-chapters > li').length===pages[0].chapters.length && button('새 회차 확인') && !button('새 회차 확인').disabled,'Cached first page did not render');
      };
      const beforePaging = report.requests.length;
      await openCached();
      report.pagingRowCounts = [document.querySelectorAll('.nr-work-chapters > li').length];
      for (let page=1;page<pages.length;page++) {
        const more = [...document.querySelectorAll('.nr-work-screen button')].find(item=>item.textContent.trim()==='다음 목차 페이지 불러오기');
        if (!more || more.disabled) throw Error('Next cached page control unavailable');
        more.click();
        const expectedCount = pages.slice(0,page+1).reduce((sum,value)=>sum+value.chapters.length,0);
        await wait(()=>document.querySelectorAll('.nr-work-chapters > li').length===expectedCount && button('새 회차 확인') && !button('새 회차 확인').disabled,'Cached next page did not render');
        report.pagingRowCounts.push(expectedCount);
      }
      document.querySelector('button[aria-label="뒤로 가기"]').click();
      await wait(()=>button('서재 전체 새 회차 확인'),'Library after paging unavailable');
      await openCached();
      report.reopenedFirstPageCount = document.querySelectorAll('.nr-work-chapters > li').length;
      document.querySelector('button[aria-label="뒤로 가기"]').click();
      await wait(()=>button('서재 전체 새 회차 확인'),'Library after reopen unavailable');
      report.cachedPagingWithoutRequests = report.requests.length===beforePaging;
      if (!report.cachedPagingWithoutRequests) throw Error('Cached paging requested source again');
    }
    report.allResponsesSuccessful = report.requests.every(request=>request.completed && request.status===200 && request.bytes>0);
    const after = await protectedSnapshot();
    report.protectedFileCount = Object.keys(baseline.files).length;
    report.savedVersionCount = baseline.versions.length;
    report.protectedFilesUnchanged = JSON.stringify(baseline.files)===JSON.stringify(after.files);
    report.preferencesUnchanged = JSON.stringify(baseline.preferences)===JSON.stringify(after.preferences);
    report.versionsUnchanged = JSON.stringify(baseline.versions)===JSON.stringify(after.versions);
    report.readingHistoryUnchanged = JSON.stringify(baseline.recent)===JSON.stringify(after.recent);
    report.existingWorksPreserved = baseline.workIds.every(id=>after.workIds.includes(id));
    report.keptInLibrary = after.workIds.includes(workId);
    if (!report.modelConfigured && report.titleToastCount!==0) throw Error('Title toast displayed without a model request');
    if (!report.workBodyControlRemoved || !report.libraryBodyControlRemoved || !report.allResponsesSuccessful || !report.allSuccess || !report.dateBasedCheck || report.checkedChapterCount!==report.importedChapterCount || !report.protectedFilesUnchanged || !report.preferencesUnchanged || !report.versionsUnchanged || !report.readingHistoryUnchanged || !report.existingWorksPreserved) throw Error('Live refresh/preservation assertions failed');
    return report;
  } catch (error) {
    report.failure = String(error.message);
    report.errorNotice = document.querySelector('.nr-snackbar')?.textContent?.slice(0,500);
    throw error;
  } finally { Capacitor.nativePromise = original; observer.disconnect(); }
})();
"""#
    let result: [String: Any]
    do {
      result = try await evaluate(script.replacingOccurrences(of: "__JHF_LIVE_URL_LITERAL__", with: urlLiteral))
    } catch {
      if let diagnostic = try? await evaluate("return window.__jhfLive || {started:false};") {
        let data = try JSONSerialization.data(withJSONObject: diagnostic, options: [.prettyPrinted, .sortedKeys])
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "JHF-live-source-failure-metadata"
        attachment.lifetime = .keepAlways
        add(attachment)
      }
      throw error
    }
    XCTAssertEqual(result["responseReplacement"] as? Bool, false)
    for key in ["individualSuccess", "allSuccess", "allResponsesSuccessful", "workBodyControlRemoved", "libraryBodyControlRemoved", "individualBeforeConfirmNoRequest", "individualCancelNoRequest", "individualEscapeNoRequest", "allBeforeConfirmNoRequest", "allCancelNoRequest", "allEscapeNoRequest", "badgesMatchPublicationAndReading", "chapterBadgesHaveNoNumber", "dateBasedCheck", "protectedFilesUnchanged", "preferencesUnchanged", "versionsUnchanged", "readingHistoryUnchanged", "existingWorksPreserved", "keptInLibrary"] {
      XCTAssertEqual(result[key] as? Bool, true, key)
    }
    XCTAssertGreaterThan(result["importedChapterCount"] as? Int ?? 0, 0)
    XCTAssertEqual(result["importedChapterCount"] as? Int, result["checkedChapterCount"] as? Int)
    XCTAssertGreaterThan(result["individualRequests"] as? Int ?? 0, 0)
    XCTAssertGreaterThan(result["allRequests"] as? Int ?? 0, 0)
    XCTAssertEqual(result["individualToastCount"] as? Int, 1)
    XCTAssertEqual(result["allToastCount"] as? Int, 1)
    if result["modelConfigured"] as? Bool == false {
      XCTAssertEqual(result["titleToastCount"] as? Int, 0)
    }
    if (result["cachedPageCount"] as? Int ?? 0) > 1 {
      XCTAssertEqual(result["cachedPagingWithoutRequests"] as? Bool, true)
      XCTAssertEqual(result["reopenedFirstPageCount"] as? Int, result["importedChapterCount"] as? Int)
      XCTAssertEqual((result["pagingRowCounts"] as? [Int])?.last, result["cachedChapterCount"] as? Int)
    }
    let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
    let metadata = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
    metadata.name = "JHF-live-source-result-metadata"
    metadata.lifetime = .keepAlways
    add(metadata)
    let web = try await webView()
    let library = XCTAttachment(image: try await web.takeSnapshot(configuration: nil))
    library.name = "JHF-iPhone-real-Narou-library"
    library.lifetime = .keepAlways
    add(library)
    _ = try await evaluate(#"""
return await (async()=>{
  const target=[...document.querySelectorAll('.nr-library__list .nr-list-item__main')].find(item=>item.querySelector('.nr-list-item__headline')?.textContent===window.__jhfLive.workTitle);
  if(!target)throw Error('Snapshot work unavailable');
  target.click();
  for(let i=0;i<200;i++){
    if(document.querySelectorAll('.nr-work-chapters > li').length && document.querySelector('.nr-top-app-bar button[aria-label="새 회차 확인"]:not(:disabled)')){
      document.querySelector('.nr-work-chapters .nr-new-chapter-badge')?.closest('li').scrollIntoView({block:'center'});
      return {ready:true};
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('Snapshot work did not render');
})();
"""#)
    try await Task.sleep(nanoseconds: 300_000_000)
    let work = XCTAttachment(image: try await web.takeSnapshot(configuration: nil))
    work.name = "JHF-iPhone-publication-badges"
    work.lifetime = .keepAlways
    add(work)
    _ = try await evaluate("document.querySelector('button[aria-label=\"뒤로 가기\"]').click(); return {home:true};")
    try await Task.sleep(nanoseconds: 300_000_000)
    _ = try await evaluate("document.querySelector('.nr-top-app-bar button[aria-label=\"서재 전체 새 회차 확인\"]').click(); return {opened:!!document.querySelector('dialog[open]')};")
    try await Task.sleep(nanoseconds: 300_000_000)
    let confirmation = XCTAttachment(image: try await web.takeSnapshot(configuration: nil))
    confirmation.name = "JHF-iPhone-concise-confirmation"
    confirmation.lifetime = .keepAlways
    add(confirmation)
    _ = try await evaluate("[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent.trim()==='취소').click(); return {closed:true};")
  }
  func test02PrivateFilesPreferencesAndKeychainRoundTrip() async throws {
    let value = try await evaluate(
      """
      const {Filesystem, Preferences, SecureStorage} = Capacitor.Plugins;
      const path = 'jhf-ios-smoke-test/value.txt', key = 'jhf-ios-smoke-test';
      let files = false, preferences = false, secure = false;
      try {
          await Filesystem.writeFile({path, directory:'LIBRARY_NO_CLOUD', encoding:'utf8', data:'아이폰 저장 검증', recursive:true});
          files = (await Filesystem.readFile({path, directory:'LIBRARY_NO_CLOUD', encoding:'utf8'})).data === '아이폰 저장 검증';
          await Preferences.set({key,value:'ios'});
          preferences = (await Preferences.get({key})).value === 'ios';
          await SecureStorage.internalSetItem({prefixedKey:'jhf-ios-smoke-test.'+key, data:'synthetic-test-value', sync:false});
          secure = (await SecureStorage.internalGetItem({prefixedKey:'jhf-ios-smoke-test.'+key, sync:false})).data === 'synthetic-test-value';
      } finally {
          await Preferences.remove({key});
          await Filesystem.rmdir({path:'jhf-ios-smoke-test', directory:'LIBRARY_NO_CLOUD', recursive:true});
          await SecureStorage.internalRemoveItem({prefixedKey:'jhf-ios-smoke-test.'+key, sync:false});
      }
      return {files,preferences,secure};
      """)
    XCTAssertEqual(value["files"] as? Bool, true)
    XCTAssertEqual(value["preferences"] as? Bool, true)
    XCTAssertEqual(value["secure"] as? Bool, true)
  }
  func test03EmbeddingIsOptionalAndInvalidBrowserURLsAreRejected() async throws {
    let value = try await evaluate(
      """
      const state = await Capacitor.Plugins.OnDeviceEmbedding.status();
      let rejected = false;
      try { await Capacitor.Plugins.SourceBrowser.open({startUrl:'https://example.com/'}); }
      catch { rejected = true; }
      return {loaded:state.loaded,downloading:state.downloading,rejected};
      """)
    XCTAssertEqual(value["loaded"] as? Bool, false)
    XCTAssertEqual(value["downloading"] as? Bool, false)
    XCTAssertEqual(value["rejected"] as? Bool, true)
  }
  func test04NativeHTTPAndSSEPreserveUnicodeAndRefuseRedirects() async throws {
    let server = try HTTPFixture()
    let port = try await server.start()
    defer { server.stop() }
    let value = try await evaluate(
      """
      const root = 'http://127.0.0.1:\(port)';
      const http = Capacitor.Plugins.ReaderHttp;
      const options = {method:'GET',headers:{},responseType:'json',disableRedirects:true,readTimeout:30000};
      const models = await http.request({...options,url:root+'/v1/models'});
      const redirect = await http.request({...options,url:root+'/redirect'});
      let text='';
      const stream = Capacitor.Plugins.ModelStream;
      const listener = await stream.addListener('data', event => { text += event.data; });
      try {
          const result = await stream.start({id:'17ff4f40-c593-4b25-b89c-83c23a954ade',url:root+'/v1/chat/completions',headers:{},data:{messages:[]}});
          return {model:models.data.data[0].id,redirect:redirect.status,sse:result.sse,unicode:text.includes('아이폰'),done:text.includes('[DONE]')};
      } finally { await listener.remove(); }
      """)
    XCTAssertEqual(value["model"] as? String, "ios-fixture")
    XCTAssertEqual(value["redirect"] as? Int, 302)
    XCTAssertEqual(value["sse"] as? Bool, true)
    XCTAssertEqual(value["unicode"] as? Bool, true)
    XCTAssertEqual(value["done"] as? Bool, true)
    XCTAssertEqual(server.requests, 3, "A redirect must never issue a second request.")
  }
}

private final class HTTPFixture: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "jhf.device.fixture")
  private var count = 0
  var requests: Int { queue.sync { count } }
  init() throws { listener = try NWListener(using: .tcp, on: .any) }
  func start() async throws -> UInt16 {
    try await withCheckedThrowingContinuation { continuation in
      var settled = false
      listener.stateUpdateHandler = { state in
        guard !settled else { return }
        if case .ready = state, let port = self.listener.port {
          settled = true
          continuation.resume(returning: port.rawValue)
        } else if case .failed(let error) = state {
          settled = true
          continuation.resume(throwing: error)
        }
      }
      listener.newConnectionHandler = { connection in
        connection.start(queue: self.queue)
        self.receive(connection, buffer: Data())
      }
      listener.start(queue: queue)
    }
  }
  func stop() { listener.cancel() }
  private func receive(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) {
      data, _, complete, error in
      var buffer = buffer
      if let data { buffer.append(data) }
      if let boundary = buffer.range(of: Data("\r\n\r\n".utf8)),
        let text = String(data: buffer[..<boundary.upperBound], encoding: .utf8)
      {
        let length =
          text.components(separatedBy: "\r\n")
          .first(where: { $0.lowercased().hasPrefix("content-length:") })
          .flatMap { Int($0.split(separator: ":").last!.trimmingCharacters(in: .whitespaces)) } ?? 0
        if buffer.count - boundary.upperBound < length {
          self.receive(connection, buffer: buffer)
          return
        }
        self.count += 1
        let body: String
        let status: String
        let headers: String
        if text.hasPrefix("POST ") {
          body = "data: {\"choices\":[{\"delta\":{\"content\":\"아이폰\"}}]}\n\ndata: [DONE]\n\n"
          status = "200 OK"
          headers = "Content-Type: text/event-stream\r\n"
        } else if text.contains(" /redirect ") {
          body = ""
          status = "302 Found"
          headers = "Location: http://127.0.0.1:\(self.listener.port!.rawValue)/target\r\n"
        } else {
          body = #"{"data":[{"id":"ios-fixture"}]}"#
          status = "200 OK"
          headers = "Content-Type: application/json\r\n"
        }
        let response = Data(
          "HTTP/1.1 \(status)\r\n\(headers)Content-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n\(body)"
            .utf8)
        if text.hasPrefix("POST "), let word = response.range(of: Data("아이폰".utf8)) {
          let split = word.lowerBound + 1
          connection.send(
            content: response[..<split],
            completion: .contentProcessed { _ in
              self.queue.asyncAfter(deadline: .now() + 0.05) {
                connection.send(
                  content: response[split...],
                  completion: .contentProcessed { _ in connection.cancel() })
              }
            })
        } else {
          connection.send(
            content: response, completion: .contentProcessed { _ in connection.cancel() })
        }
      } else if complete || error != nil {
        connection.cancel()
      } else {
        self.receive(connection, buffer: buffer)
      }
    }
  }
}
