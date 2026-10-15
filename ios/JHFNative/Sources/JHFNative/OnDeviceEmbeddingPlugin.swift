import Capacitor
import CryptoKit
import Foundation
import LiteRTLM
import UIKit

private enum EmbeddingFailure: String, Error {
  case busy, cancelled, verify, network, io, not_installed, invalid, engine
}

private final class ModelDownloadDelegate: NSObject, URLSessionDownloadDelegate {
  let progress: (Int64, Int64) -> Void
  private var lastNotice = Date.distantPast
  init(progress: @escaping (Int64, Int64) -> Void) { self.progress = progress }
  static func allowed(_ url: URL?) -> Bool {
    guard let url, url.scheme == "https", let host = url.host?.lowercased() else { return false }
    return host == "huggingface.co" || host.hasSuffix(".huggingface.co") || host.hasSuffix(".hf.co")
  }
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {}
  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    if totalBytesWritten > EmbeddingService.modelBytes { downloadTask.cancel() }
    if Date().timeIntervalSince(lastNotice) >= 0.5 {
      lastNotice = Date()
      progress(totalBytesWritten, EmbeddingService.modelBytes)
    }
  }
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(Self.allowed(request.url) ? request : nil)
  }
}

private actor EmbeddingService {
  static let modelBytes: Int64 = 164_626_432
  static let sha256 = "2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb"
  static let source = URL(
    string:
      "https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm"
  )!
  private var engine: EmbeddingEngine?
  private var downloading = false
  private var embedding = false
  private var unloading = false
  private var removing = false
  private let directory = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("narou-reader-models", isDirectory: true)
  private var model: URL { directory.appendingPathComponent("embeddinggemma-2-text-270m.litertlm") }
  private func installed() -> Bool {
    (try? model.resourceValues(forKeys: [.fileSizeKey]).fileSize) == Int(Self.modelBytes)
  }
  func status() -> [String: Any] {
    let present = installed()
    return [
      "installed": present, "bytes": present ? Self.modelBytes : 0, "loaded": engine != nil,
      "downloading": downloading,
    ]
  }
  func download(progress: @escaping (Int64, Int64) -> Void) async throws {
    guard !downloading, !embedding, !unloading, !removing else { throw EmbeddingFailure.busy }
    if installed() { return }
    downloading = true
    defer { downloading = false }
    let delegate = ModelDownloadDelegate(progress: progress)
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 60
    config.timeoutIntervalForResource = 1800
    let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let temporary: URL
    let response: URLResponse
    do { (temporary, response) = try await session.download(from: Self.source) } catch {
      throw Task.isCancelled ? EmbeddingFailure.cancelled : EmbeddingFailure.network
    }
    defer { try? FileManager.default.removeItem(at: temporary) }
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      ModelDownloadDelegate.allowed(response.url)
    else { throw EmbeddingFailure.network }
    try Task.checkCancellation()
    let handle = try FileHandle(forReadingFrom: temporary)
    defer { try? handle.close() }
    var hash = SHA256()
    var count: Int64 = 0
    while let data = try handle.read(upToCount: 65536), !data.isEmpty {
      try Task.checkCancellation()
      count += Int64(data.count)
      guard count <= Self.modelBytes else { throw EmbeddingFailure.verify }
      hash.update(data: data)
    }
    guard count == Self.modelBytes,
      hash.finalize().map({ String(format: "%02x", $0) }).joined() == Self.sha256
    else { throw EmbeddingFailure.verify }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var folder = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    if FileManager.default.fileExists(atPath: model.path) {
      try FileManager.default.removeItem(at: model)
    }
    try FileManager.default.moveItem(at: temporary, to: model)
    progress(count, Self.modelBytes)
  }
  func unload() async {
    guard !unloading else { return }
    unloading = true
    defer { unloading = false }
    let current = engine
    engine = nil
    await current?.close()
  }
  func remove() async throws {
    guard !downloading, !embedding, !unloading, !removing else { throw EmbeddingFailure.busy }
    removing = true
    defer { removing = false }
    await unload()
    if FileManager.default.fileExists(atPath: model.path) {
      try FileManager.default.removeItem(at: model)
    }
  }
  func embed(_ texts: [String]) async throws -> [[Double]] {
    guard !downloading, !embedding, !unloading, !removing else { throw EmbeddingFailure.busy }
    guard installed() else { throw EmbeddingFailure.not_installed }
    guard !texts.isEmpty, texts.count <= 128, texts.allSatisfy({ $0.utf16.count <= 2000 }) else {
      throw EmbeddingFailure.invalid
    }
    embedding = true
    defer { embedding = false }
    do {
      if engine == nil {
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
          .appendingPathComponent("litertlm", isDirectory: true)
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        let created = EmbeddingEngine(
          config: EmbeddingEngineConfig(
            modelPath: model.path, backend: .cpu(threadCount: 2), cacheDir: cache.path))
        engine = created
        try await created.initialize()
      }
      guard let engine else { throw EmbeddingFailure.engine }
      let responses = try await engine.computeEmbeddingBatch(
        contentsBatch: texts.map { [.text($0)] },
        options: EmbeddingOptions(normalize: true, outputSize: 256))
      guard responses.count == texts.count else { throw EmbeddingFailure.engine }
      return try responses.map {
        guard $0.embedding.count == 256, $0.embedding.allSatisfy({ $0.isFinite }) else {
          throw EmbeddingFailure.engine
        }
        return $0.embedding.map(Double.init)
      }
    } catch {
      await unload()
      throw EmbeddingFailure.engine
    }
  }
}

@objc(OnDeviceEmbeddingPlugin)
public final class OnDeviceEmbeddingPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "OnDeviceEmbeddingPlugin"
  public let jsName = "OnDeviceEmbedding"
  public let pluginMethods: [CAPPluginMethod] = [
    "status", "download", "cancelDownload", "unload", "remove", "embed",
  ].compactMap { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
  private let service = EmbeddingService()
  private var downloadOperation: Task<Void, Never>?
  public override func load() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification,
      object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(background),
      name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
  }
  private func reject(_ call: CAPPluginCall, _ error: Error) {
    let code =
      (error as? EmbeddingFailure)?.rawValue ?? (error is CancellationError ? "cancelled" : "io")
    call.reject(code, code)
  }
  @objc public func status(_ call: CAPPluginCall) { Task { call.resolve(await service.status()) } }
  @objc public func download(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      guard self.downloadOperation == nil else {
        call.reject("busy", "busy")
        return
      }
      self.downloadOperation = Task {
        do {
          try await self.service.download { received, total in
            self.notifyListeners("downloadProgress", data: ["received": received, "total": total])
          }
          call.resolve()
        } catch { self.reject(call, error) }
        await MainActor.run { self.downloadOperation = nil }
      }
    }
  }
  @objc public func cancelDownload(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      self.downloadOperation?.cancel()
      call.resolve()
    }
  }
  @objc public func unload(_ call: CAPPluginCall) {
    Task {
      await service.unload()
      call.resolve()
    }
  }
  @objc public func remove(_ call: CAPPluginCall) {
    Task {
      do {
        try await service.remove()
        call.resolve()
      } catch { reject(call, error) }
    }
  }
  @objc public func embed(_ call: CAPPluginCall) {
    guard let texts = call.getArray("texts", String.self) else {
      call.reject("invalid", "invalid")
      return
    }
    Task {
      do { call.resolve(["vectors": try await service.embed(texts)]) } catch { reject(call, error) }
    }
  }
  @objc private func background() { Task { await service.unload() } }
  deinit {
    NotificationCenter.default.removeObserver(self)
    downloadOperation?.cancel()
  }
}
