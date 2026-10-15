import Capacitor
import Foundation
import UIKit

/// Model-only SSE. Ephemeral requests never forward cookies or follow redirects.
@objc(ModelStreamPlugin)
public final class ModelStreamPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDataDelegate {
  public let identifier = "ModelStreamPlugin"
  public let jsName = "ModelStream"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
    CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
  ]
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private var pending: CAPPluginCall?
  private var requestID = ""
  private var requestURL = ""
  private var buffer = Data()
  private var result = Data()
  private var status = 0
  private var sse = false
  private var cancelled = false
  private var oversized = false

  public override func load() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification,
      object: nil)
  }
  @objc public func start(_ call: CAPPluginCall) {
    DispatchQueue.main.async { self.begin(call) }
  }
  private func begin(_ call: CAPPluginCall) {
    guard pending == nil, UIApplication.shared.applicationState == .active,
      let id = call.getString("id"), UUID(uuidString: id) != nil,
      let raw = call.getString("url"), let url = URL(string: raw),
      ["http", "https"].contains(url.scheme ?? ""), url.host != nil,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
      raw.range(
        of: #"^https?://[^/?#]+(?:/[A-Za-z0-9._-]+)*/v1/chat/completions$"#,
        options: .regularExpression) != nil,
      !raw.contains("/../"), !raw.contains("/./"),
      var body = call.getObject("data")
    else {
      call.reject("connection_not_sent")
      return
    }
    let headers = call.getObject("headers") ?? [:]
    let auth = headers["Authorization"] as? String
    if let auth, auth.range(of: #"^Bearer [^\s\x7f]+$"#, options: .regularExpression) == nil {
      call.reject("auth_not_sent")
      return
    }
    body["stream"] = true
    guard let data = try? JSONSerialization.data(withJSONObject: body) else {
      call.reject("connection_not_sent")
      return
    }
    var request = URLRequest(
      url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 120)
    request.httpMethod = "POST"
    request.httpBody = data
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    if let auth { request.setValue(auth, forHTTPHeaderField: "Authorization") }
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.timeoutIntervalForRequest = 120
    config.timeoutIntervalForResource = 3600
    pending = call
    requestID = id
    requestURL = raw
    buffer = Data()
    result = Data()
    status = 0
    sse = false
    cancelled = false
    oversized = false
    let created = URLSession(configuration: config, delegate: self, delegateQueue: .main)
    session = created
    task = created.dataTask(with: request)
    task?.resume()
  }
  @objc public func cancel(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      if self.requestID == call.getString("id") { self.stop() }
      call.resolve()
    }
  }
  @objc private func background() { stop() }
  private func stop() {
    cancelled = true
    task?.cancel()
  }
  public func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
  public func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let response = response as? HTTPURLResponse else {
      completionHandler(.cancel)
      return
    }
    status = response.statusCode
    sse = (200..<300).contains(status) && (response.mimeType?.lowercased() == "text/event-stream")
    completionHandler(.allow)
  }
  public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data)
  {
    guard !cancelled, !oversized else { return }
    guard result.count + data.count <= (sse ? 16_000_000 : 65_536) else {
      oversized = true
      dataTask.cancel()
      return
    }
    result.append(data)
    if sse {
      buffer.append(data)
      while let newline = buffer.firstIndex(of: 10) {
        let end = buffer.index(after: newline)
        let line = buffer[..<end]
        guard let text = String(data: line, encoding: .utf8) else {
          oversized = true
          dataTask.cancel()
          return
        }
        notifyListeners("data", data: ["id": requestID, "data": text])
        buffer.removeSubrange(..<end)
      }
    }
  }
  public func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?
  ) {
    guard let call = pending else {
      session.invalidateAndCancel()
      return
    }
    if sse, !buffer.isEmpty, error == nil, let tail = String(data: buffer, encoding: .utf8) {
      notifyListeners("data", data: ["id": requestID, "data": tail])
    }
    let response: [String: Any] = [
      "status": status, "url": requestURL, "headers": [:],
      "data": String(data: result, encoding: .utf8) ?? "", "sse": sse,
    ]
    let failed = error != nil || oversized
    let wasCancelled = cancelled
    pending = nil
    self.task = nil
    self.session = nil
    result = Data()
    buffer = Data()
    session.finishTasksAndInvalidate()
    if failed {
      call.reject(wasCancelled ? "cancelled_unknown" : "timeout_unknown")
    } else {
      call.resolve(response)
    }
  }
  deinit {
    NotificationCenter.default.removeObserver(self)
    session?.invalidateAndCancel()
  }
}
