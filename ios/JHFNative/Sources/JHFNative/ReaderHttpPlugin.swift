import Capacitor
import Foundation

/// Isolated native GET/POST for the existing transports. Never shares WebView cookies.
@objc(ReaderHttpPlugin)
public final class ReaderHttpPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "ReaderHttpPlugin"
  public let jsName = "ReaderHttp"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
  ]
  @objc public func request(_ call: CAPPluginCall) {
    guard let raw = call.getString("url"), let url = URL(string: raw),
      ["http", "https"].contains(url.scheme ?? ""), url.host != nil,
      url.user == nil, url.password == nil, url.fragment == nil,
      let method = call.getString("method"), ["GET", "POST"].contains(method),
      call.getBool("disableRedirects") == true
    else {
      call.reject("connection_not_sent")
      return
    }
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
    request.httpMethod = method
    request.timeoutInterval = Double(call.getInt("readTimeout") ?? 30000) / 1000
    for (name, value) in call.getObject("headers") ?? [:] {
      guard let value = value as? String, !value.contains("\r"), !value.contains("\n"),
        !["cookie", "host"].contains(name.lowercased())
      else {
        call.reject("connection_not_sent")
        return
      }
      request.setValue(value, forHTTPHeaderField: name)
    }
    if method == "POST" {
      guard let body = call.getObject("data"),
        let data = try? JSONSerialization.data(withJSONObject: body)
      else {
        call.reject("connection_not_sent")
        return
      }
      request.httpBody = data
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let operation = IsolatedHTTPRequest(call: call, type: call.getString("responseType") ?? "text")
    operation.start(request)
  }
}

private final class IsolatedHTTPRequest: NSObject, URLSessionDataDelegate {
  private let call: CAPPluginCall
  private let type: String
  private var data = Data()
  private var response: HTTPURLResponse?
  private var failed = false
  init(call: CAPPluginCall, type: String) {
    self.call = call
    self.type = type
  }
  func start(_ request: URLRequest) {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.timeoutIntervalForRequest = request.timeoutInterval
    config.timeoutIntervalForResource = max(30, request.timeoutInterval)
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    session.dataTask(with: request).resume()
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    self.response = response as? HTTPURLResponse
    completionHandler(.allow)
  }
  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive chunk: Data) {
    guard data.count + chunk.count <= 64 * 1024 * 1024 else {
      failed = true
      dataTask.cancel()
      return
    }
    data.append(chunk)
  }
  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    defer { session.finishTasksAndInvalidate() }
    guard error == nil, !failed, let response, let url = response.url else {
      call.reject("connection")
      return
    }
    let value: Any
    if type == "json" {
      value =
        (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) ?? String(
          data: data, encoding: .utf8) ?? ""
    } else {
      value = String(data: data, encoding: .utf8) ?? ""
    }
    var headers: [String: String] = [:]
    for (key, value) in response.allHeaderFields {
      headers[String(describing: key).lowercased()] = String(describing: value)
    }
    call.resolve([
      "status": response.statusCode, "url": url.absoluteString, "headers": headers, "data": value,
    ])
  }
}
