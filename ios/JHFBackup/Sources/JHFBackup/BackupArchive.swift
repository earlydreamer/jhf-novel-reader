import CoreFoundation
import CryptoKit
import Foundation
import ZIPFoundation

public enum BackupFailure: Error { case invalid, io, pending }

public final class BackupArchive {
  public struct Snapshot {
    public let paths: [String]
    public let settings: String?
  }
  private let root: URL
  private let readSettings: () -> String?
  private let saveSettings: (String?) throws -> Void
  private let manager = FileManager.default
  private var snapshot: Snapshot?
  private let folders = [
    "chapters", "positions", "library", "versions", "reading", "works", "attempts", "batches",
    "guidance", "titles",
  ]
  private let maxEntry = 64 * 1024 * 1024
  private let maxTotal = 1024 * 1024 * 1024
  private let maxJSON = 1024 * 1024
  private var live: URL { root.appendingPathComponent("narou-reader", isDirectory: true) }
  private var stage: URL { root.appendingPathComponent("narou-reader.restore", isDirectory: true) }
  private var staged: URL { stage.appendingPathComponent("narou-reader", isDirectory: true) }
  private var old: URL { root.appendingPathComponent("narou-reader.old", isDirectory: true) }
  private var marker: URL { root.appendingPathComponent("narou-reader.restore-state") }

  public init(
    root: URL, readSettings: @escaping () -> String?,
    saveSettings: @escaping (String?) throws -> Void
  ) {
    self.root = root.standardizedFileURL.resolvingSymlinksInPath()
    self.readSettings = readSettings
    self.saveSettings = saveSettings
  }
  private func exists(_ url: URL) -> Bool { manager.fileExists(atPath: url.path) }
  private func remove(_ url: URL) throws { if exists(url) { try manager.removeItem(at: url) } }
  private func directory(_ url: URL) throws {
    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true,
      url.resolvingSymlinksInPath().path == url.path
    else { throw BackupFailure.invalid }
  }
  private func valid(_ path: String) -> Bool {
    let pieces = path.split(separator: "/", omittingEmptySubsequences: false)
    return pieces.count == 2 && folders.contains(String(pieces[0])) && !pieces[1].contains("..")
      && pieces[1].range(of: #"^[a-zA-Z0-9.-]+$"#, options: .regularExpression) != nil
  }
  private func files() throws -> [String] {
    if !exists(live) { return [] }
    try directory(live)
    var paths: [String] = []
    for folder in folders {
      let location = live.appendingPathComponent(folder)
      if !exists(location) { continue }
      try directory(location)
      for url in try manager.contentsOfDirectory(
        at: location, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey])
      {
        let path = folder + "/" + url.lastPathComponent
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard valid(path), values.isRegularFile == true, values.isSymbolicLink != true else {
          throw BackupFailure.invalid
        }
        paths.append(path)
        guard paths.count <= 199_998 else { throw BackupFailure.invalid }
      }
    }
    return paths.sorted()
  }
  private func json(_ bytes: Data) throws -> [String: Any] {
    guard bytes.count <= maxJSON,
      let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    else { throw BackupFailure.invalid }
    return value
  }
  private func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
      number.doubleValue.isFinite,
      number.doubleValue == Double(number.intValue)
    else { return nil }
    return number.intValue
  }
  public func export(to destination: URL) throws -> Int {
    guard !exists(marker), !exists(old) else { throw BackupFailure.pending }
    let paths = try files()
    let archive = try Archive(url: destination, accessMode: .create)
    var total = 0
    func add(_ name: String, _ data: Data) throws {
      guard data.count <= maxJSON, total <= maxTotal - data.count else {
        throw BackupFailure.invalid
      }
      total += data.count
      try archive.addEntry(
        with: name, type: .file, uncompressedSize: Int64(data.count), compressionMethod: .deflate
      ) { position, size in
        data.subdata(in: Int(position)..<min(Int(position) + size, data.count))
      }
    }
    try add(
      "manifest.json",
      JSONSerialization.data(withJSONObject: [
        "format": "jhf-novel-reader-backup", "version": 1, "files": paths.count,
        "createdAt": ISO8601DateFormatter().string(from: Date()),
      ]))
    if let settings = readSettings() {
      let data = Data(settings.utf8)
      _ = try json(data)
      try add("settings.json", data)
    }
    for path in paths {
      let url = live.appendingPathComponent(path)
      let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard size <= maxEntry, total <= maxTotal - size else { throw BackupFailure.invalid }
      total += size
      let handle = try FileHandle(forReadingFrom: url)
      defer { try? handle.close() }
      try archive.addEntry(
        with: "narou-reader/" + path, type: .file, uncompressedSize: Int64(size),
        compressionMethod: .deflate
      ) { position, length in
        try handle.seek(toOffset: UInt64(position))
        let data = try handle.read(upToCount: length) ?? Data()
        guard data.count == length else { throw BackupFailure.io }
        return data
      }
    }
    return paths.count
  }
  public func prepare(from source: URL) throws -> Snapshot {
    guard snapshot == nil, !exists(marker), !exists(old), !exists(stage) else {
      throw BackupFailure.pending
    }
    try manager.createDirectory(at: staged, withIntermediateDirectories: true)
    do {
      let archive = try Archive(url: source, accessMode: .read)
      var seen = Set<String>()
      var paths: [String] = []
      var settings: String?
      var declared: Int?
      var total = 0
      for entry in archive {
        guard seen.insert(entry.path).inserted, seen.count <= 200_000, entry.type == .file else {
          throw BackupFailure.invalid
        }
        let metadata = entry.path == "manifest.json" || entry.path == "settings.json"
        let path = String(entry.path.dropFirst("narou-reader/".count))
        guard metadata || (entry.path.hasPrefix("narou-reader/") && valid(path)) else {
          throw BackupFailure.invalid
        }
        let limit = metadata ? maxJSON : maxEntry
        guard entry.uncompressedSize <= UInt64(limit) else { throw BackupFailure.invalid }
        var bytes = Data()
        var written = 0
        let handle: FileHandle?
        if metadata {
          handle = nil
        } else {
          let target = staged.appendingPathComponent(path)
          try manager.createDirectory(
            at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
          guard manager.createFile(atPath: target.path, contents: nil) else {
            throw BackupFailure.io
          }
          handle = try FileHandle(forWritingTo: target)
        }
        defer { try? handle?.close() }
        let crc = try archive.extract(entry) { chunk in
          guard written <= limit - chunk.count, total <= self.maxTotal - chunk.count else {
            throw BackupFailure.invalid
          }
          written += chunk.count
          total += chunk.count
          if let handle { try handle.write(contentsOf: chunk) } else { bytes.append(chunk) }
        }
        guard crc == entry.checksum, UInt64(written) == entry.uncompressedSize else {
          throw BackupFailure.invalid
        }
        if entry.path == "manifest.json" {
          let value = try json(bytes)
          guard value["format"] as? String == "jhf-novel-reader-backup",
            integer(value["version"]) == 1,
            let count = integer(value["files"]), (0...200_000).contains(count)
          else { throw BackupFailure.invalid }
          declared = count
        } else if entry.path == "settings.json" {
          _ = try json(bytes)
          guard let text = String(data: bytes, encoding: .utf8) else { throw BackupFailure.invalid }
          settings = text
        } else {
          paths.append(path)
        }
      }
      guard declared == paths.count else { throw BackupFailure.invalid }
      let prepared = Snapshot(paths: paths.sorted(), settings: settings)
      snapshot = prepared
      return prepared
    } catch {
      try remove(stage)
      throw BackupFailure.invalid
    }
  }
  public func read(_ path: String) throws -> String? {
    guard let snapshot, valid(path) else {
      throw BackupFailure.invalid
    }
    guard snapshot.paths.contains(path) else { return nil }
    return try String(contentsOf: staged.appendingPathComponent(path), encoding: .utf8)
  }
  public func abort() throws {
    guard !exists(marker) else { throw BackupFailure.pending }
    try remove(stage)
    snapshot = nil
  }

  private struct Record: Codable {
    var phase: String
    let hadLive: Bool
    let settings: String?
  }
  private struct Envelope: Codable {
    let payload: Data
    let checksum: String
  }
  private func persist(_ record: Record) throws {
    let payload = try JSONEncoder().encode(record)
    let envelope = Envelope(
      payload: payload,
      checksum: SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined())
    try JSONEncoder().encode(envelope).write(to: marker, options: .atomic)
    let handle = try FileHandle(forWritingTo: marker)
    defer { try? handle.close() }
    try handle.synchronize()
  }
  public func commit() throws -> Int {
    guard let snapshot, !exists(marker), !exists(old) else { throw BackupFailure.pending }
    try directory(staged)
    let record = Record(phase: "undo", hadLive: exists(live), settings: readSettings())
    try persist(record)
    if record.hadLive {
      try directory(live)
      try manager.moveItem(at: live, to: old)
    }
    try manager.moveItem(at: staged, to: live)
    try saveSettings(snapshot.settings)
    var committed = record
    committed.phase = "committed"
    try persist(committed)
    try recover()
    return snapshot.paths.count
  }
  public func recover() throws {
    if !exists(marker) {
      guard !exists(old) else { throw BackupFailure.pending }
      try remove(stage)
      snapshot = nil
      return
    }
    guard (try marker.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? Int.max) <= maxJSON * 2
    else { throw BackupFailure.invalid }
    let envelope = try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: marker))
    guard
      SHA256.hash(data: envelope.payload).map({ String(format: "%02x", $0) }).joined()
        == envelope.checksum
    else { throw BackupFailure.invalid }
    var record = try JSONDecoder().decode(Record.self, from: envelope.payload)
    if record.phase == "undo" {
      if exists(old) {
        try directory(old)
        guard record.hadLive, exists(live) != exists(staged) else { throw BackupFailure.pending }
      } else if record.hadLive {
        guard exists(live), exists(staged) else { throw BackupFailure.pending }
      } else {
        guard exists(live) != exists(staged) else { throw BackupFailure.pending }
      }
      try saveSettings(record.settings)
      if exists(old) {
        if exists(live) { try manager.moveItem(at: live, to: staged) }
        try manager.moveItem(at: old, to: live)
      } else if !record.hadLive, exists(live) {
        try manager.moveItem(at: live, to: staged)
      }
      record.phase = "rolledBack"
      try persist(record)
    }
    if record.phase == "committed" {
      try directory(live)
      guard !exists(staged) else { throw BackupFailure.pending }
      try remove(old)
    } else {
      guard record.phase == "rolledBack", !exists(old), exists(live) == record.hadLive else {
        throw BackupFailure.pending
      }
    }
    try remove(stage)
    try remove(marker)
    snapshot = nil
  }
}
