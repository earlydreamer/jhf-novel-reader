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
          "document.readyState === 'complete' && !!document.querySelector('.nr-library__empty, .nr-library__list, .nr-settings')"),
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
if(document.querySelector('.nr-work-screen,.nr-settings')){document.querySelector('button[aria-label="뒤로 가기"]').click();await wait(()=>!!document.querySelector('.nr-library__empty,.nr-library__updates button'));}
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
const click=text=>{const target=[...document.querySelectorAll('button,[role="menuitem"]')].find(x=>x.textContent.trim()===text);if(!target)throw Error('Missing '+text);target.click();};
document.querySelector('button[aria-label="뒤로 가기"]')?.click();
await wait(()=>!!document.querySelector('.nr-library__empty'),'Expected empty library');
const original=Capacitor.nativePromise;
window.__jhfFixture={count:1,requests:0,original};
Capacitor.nativePromise=function(plugin,method,options){
 if((plugin==='CapacitorHttp'||plugin==='ReaderHttp')&&method==='request'&&options.url.startsWith('https://ncode.syosetu.com/n1234ab/')){
  const f=window.__jhfFixture;f.requests++;
  const data='<h1 class="p-novel__title">실기 합성 작품</h1>'+Array.from({length:f.count},(_,i)=>`<div class="p-eplist__sublist"><a href="/n1234ab/${i+1}/">${i+1}화</a></div>`).join('');
  return Promise.resolve({status:200,headers:{'Content-Type':'text/html; charset=utf-8'},data,url:options.url});
 }
 return original.call(this,plugin,method,options);
};
document.querySelector('button[aria-label="URL로 열기"]').click();await wait(()=>!!document.querySelector('input[name="url"]'),'URL dialog');
const input=document.querySelector('input[name="url"]');input.value='https://ncode.syosetu.com/n1234ab/';
document.querySelector('.nr-library__url-form').requestSubmit();
await wait(()=>document.querySelector('.nr-work-screen ol')?.children.length===1,'Initial work');
await wait(()=>[...document.querySelectorAll('.nr-chapter-update-control button')].some(button=>button.textContent.trim()==='새 회차 확인' && !button.disabled),'Individual check ready');
const initialRequests=window.__jhfFixture.requests;
window.__jhfFixture.count=2;
click('새 회차 확인');
await wait(()=>document.querySelector('.nr-work-screen ol')?.children.length===2&&document.querySelector('.nr-new-chapter-badge')?.textContent==='새 회차 1','Individual new badge');
const report={individualCheck:true,workBadge:true,lastDate:document.querySelector('.nr-chapter-update-control [role="status"]').textContent.match(/\d{4}-\d{2}-\d{2}/)?.[0]};
document.querySelector('button[aria-label="뒤로 가기"]').click();await wait(()=>!!document.querySelector('.nr-library__updates button'),'Home');
report.libraryBadge=document.querySelector('.nr-library .nr-new-chapter-badge')?.textContent==='새 회차 1';
window.__jhfFixture.count=3;click('서재 전체 새 회차 확인');
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
