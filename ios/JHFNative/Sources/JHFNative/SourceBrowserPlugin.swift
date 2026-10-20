import Capacitor
import UIKit
import WebKit

enum SourceBrowserPolicy {
  static let hosts: Set<String> = [
    "syosetu.com", "www.syosetu.com", "yomou.syosetu.com", "ncode.syosetu.com",
    "static.syosetu.com",
  ]
  static func browse(_ raw: String) -> URL? {
    guard
      !raw.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 || $0.value == 92 }),
      var parts = URLComponents(string: raw), parts.scheme?.lowercased() == "https",
      let host = parts.host?.lowercased(), hosts.contains(host),
      parts.port == nil, parts.user == nil, parts.password == nil,
      !parts.percentEncodedPath.contains("%"),
      !parts.path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." })
    else { return nil }
    parts.host = host
    parts.scheme = "https"
    parts.fragment = nil
    return parts.url
  }
  static func selected(_ raw: String) -> URL? {
    guard let url = browse(raw), url.host == "ncode.syosetu.com",
      url.path.range(
        of: #"^/n[0-9]{4}[a-z]{1,2}(?:/[1-9][0-9]*)?/?$"#,
        options: [.regularExpression, .caseInsensitive]) != nil
    else { return nil }
    let pieces = url.path.split(separator: "/")
    if pieces.count > 1 {
      guard let value = UInt64(pieces[1]), value <= 9_007_199_254_740_991 else { return nil }
    }
    if let query = url.query {
      guard pieces.count == 1,
        query.range(of: #"^p=[1-9][0-9]*$"#, options: .regularExpression) != nil,
        let value = UInt64(query.dropFirst(2)), value <= 9_007_199_254_740_991
      else { return nil }
    }
    return URL(
      string: "https://ncode.syosetu.com/" + pieces.joined(separator: "/").lowercased() + "/"
        + (url.query.map { "?" + $0 } ?? ""))
  }
}

@objc(SourceBrowserPlugin)
public final class SourceBrowserPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "SourceBrowserPlugin"
  public let jsName = "SourceBrowser"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise)
  ]
  private var active = false
  @objc public func open(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      guard !self.active, let raw = call.getString("startUrl"),
        let url = SourceBrowserPolicy.browse(raw),
        let parent = self.bridge?.viewController, parent.presentedViewController == nil
      else {
        call.reject("source_access")
        return
      }
      self.active = true
      let browser = SourceBrowserController(start: url) { selected in
        self.active = false
        call.resolve(["selectedUrl": selected?.absoluteString as Any? ?? NSNull()])
      }
      let navigation = UINavigationController(rootViewController: browser)
      navigation.modalPresentationStyle = .fullScreen
      parent.present(navigation, animated: true)
    }
  }
}

/// Independent nonpersistent WebView: no Capacitor bridge, file access or page-to-app messages.
private final class SourceBrowserController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  private let start: URL
  private var completion: ((URL?) -> Void)?
  private var web: WKWebView!
  private var take: UIBarButtonItem!
  init(start: URL, completion: @escaping (URL?) -> Void) {
    self.start = start
    self.completion = completion
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "나로우 탐색"
    view.backgroundColor = .systemBackground
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.preferences.javaScriptCanOpenWindowsAutomatically = false
    web = WKWebView(frame: .zero, configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(web)
    NSLayoutConstraint.activate([
      web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
      web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
    ])
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      title: "닫기", style: .plain, target: self, action: #selector(close))
    take = UIBarButtonItem(
      title: "이 작품 가져오기", style: .done, target: self, action: #selector(selectWork))
    take.isEnabled = false
    navigationItem.rightBarButtonItem = take
    toolbarItems = [
      UIBarButtonItem(title: "뒤로", style: .plain, target: self, action: #selector(back)),
      UIBarButtonItem(title: "앞으로", style: .plain, target: self, action: #selector(forward)),
      UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil),
      UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(refresh)),
    ]
    navigationController?.setToolbarHidden(false, animated: false)
    web.load(URLRequest(url: start))
  }
  private func finish(_ url: URL?) {
    guard let done = completion else { return }
    completion = nil
    web.stopLoading()
    dismiss(animated: true) { done(url) }
  }
  @objc private func close() { finish(nil) }
  @objc private func back() { if web.canGoBack { web.goBack() } }
  @objc private func forward() { if web.canGoForward { web.goForward() } }
  @objc private func refresh() { web.reload() }
  @objc private func selectWork() {
    guard let raw = web.url?.absoluteString, let url = SourceBrowserPolicy.selected(raw) else {
      return
    }
    finish(url)
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    take.isEnabled = webView.url.flatMap { SourceBrowserPolicy.selected($0.absoluteString) } != nil
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    take.isEnabled = false
  }
  func webView(
    _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url,
      SourceBrowserPolicy.browse(url.absoluteString) != nil
    else {
      decisionHandler(.cancel)
      return
    }
    if navigationAction.targetFrame == nil {
      webView.load(navigationAction.request)
      decisionHandler(.cancel)
    } else {
      decisionHandler(.allow)
    }
  }
}
