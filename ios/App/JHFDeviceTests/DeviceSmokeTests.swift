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
          "document.readyState === 'complete' && !!document.querySelector('button')"),
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
      "return {platform: Capacitor.getPlatform(), library: !!document.querySelector('[aria-label=\"서재\"]')};"
    )
    XCTAssertEqual(value["platform"] as? String, "ios")
    XCTAssertEqual(value["library"] as? Bool, true)
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
    let image = try await web.takeSnapshot(configuration: nil)
    let attachment = XCTAttachment(image: image)
    attachment.name = "JHF-iPhone-settings"
    attachment.lifetime = .keepAlways
    add(attachment)
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
