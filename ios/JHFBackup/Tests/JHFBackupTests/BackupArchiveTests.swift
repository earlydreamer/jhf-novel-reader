import Foundation
import XCTest
import ZIPFoundation

@testable import JHFBackup

final class BackupArchiveTests: XCTestCase {
  var folder: URL!
  override func setUpWithError() throws {
    folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  }
  override func tearDownWithError() throws { try FileManager.default.removeItem(at: folder) }
  private func make(_ name: String, _ body: String, root: URL) throws {
    let url = root.appendingPathComponent(name)
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(body.utf8).write(to: url)
  }
  private func zip(_ entries: [(String, String)]) throws -> URL {
    let url = folder.appendingPathComponent(UUID().uuidString + ".zip")
    let archive = try Archive(url: url, accessMode: .create)
    for (path, text) in entries {
      let bytes = Data(text.utf8)
      try archive.addEntry(
        with: path, type: .file, uncompressedSize: Int64(bytes.count), compressionMethod: .deflate
      ) { position, size in
        bytes.subdata(in: Int(position)..<min(Int(position) + size, bytes.count))
      }
    }
    return url
  }
  private let manifest = #"{"format":"jhf-novel-reader-backup","version":1,"files":1}"#

  func testRoundTripPreservesLiveDataUntilCommitAndExcludesKeysAndModels() throws {
    let root = folder.appendingPathComponent("source")
    try make("narou-reader/library/index.0.json", "saved novel", root: root)
    try make("narou-reader-models/model.bin", "model", root: root)
    try make("credentials/secret", "private key", root: root)
    let source = BackupArchive(root: root, readSettings: { "{}" }, saveSettings: { _ in })
    let file = folder.appendingPathComponent("export.zip")
    XCTAssertEqual(try source.export(to: file), 1)
    let target = folder.appendingPathComponent("target")
    try make("narou-reader/library/index.0.json", "original", root: target)
    var settings: String? = "old settings"
    let restore = BackupArchive(
      root: target, readSettings: { settings }, saveSettings: { settings = $0 })
    let snapshot = try restore.prepare(from: file)
    XCTAssertEqual(snapshot.paths, ["library/index.0.json"])
    XCTAssertEqual(try restore.read(snapshot.paths[0]), "saved novel")
    XCTAssertEqual(
      try String(contentsOf: target.appendingPathComponent("narou-reader/library/index.0.json")),
      "original")
    XCTAssertEqual(try restore.commit(), 1)
    XCTAssertEqual(settings, "{}")
    XCTAssertEqual(
      try String(contentsOf: target.appendingPathComponent("narou-reader/library/index.0.json")),
      "saved novel")
  }
  func testRejectsTraversalUnknownFoldersCountMismatchAndDuplicatePaths() throws {
    let restore = BackupArchive(
      root: folder.appendingPathComponent("target"), readSettings: { nil }, saveSettings: { _ in })
    for entries in [
      [("manifest.json", manifest), ("../outside", "bad")],
      [("manifest.json", manifest), ("narou-reader/credentials/key", "bad")],
      [("manifest.json", manifest)],
      [
        ("manifest.json", manifest), ("narou-reader/library/index.0.json", "a"),
        ("narou-reader/library/index.0.json", "b"),
      ],
      [
        ("manifest.json", #"{"format":"wrong","version":1,"files":1}"#),
        ("narou-reader/library/index.0.json", "a"),
      ],
    ] {
      XCTAssertThrowsError(try restore.prepare(from: zip(entries)))
      try restore.recover()
    }
    XCTAssertFalse(
      FileManager.default.fileExists(atPath: folder.appendingPathComponent("outside").path))
  }
  func testAbortPreservesExistingDataAndSettings() throws {
    let root = folder.appendingPathComponent("target")
    try make("narou-reader/library/index.0.json", "original", root: root)
    let restore = BackupArchive(
      root: root, readSettings: { "old" },
      saveSettings: { _ in XCTFail("abort must not save settings") })
    _ = try restore.prepare(
      from: zip([("manifest.json", manifest), ("narou-reader/library/index.0.json", "new")]))
    try restore.abort()
    XCTAssertEqual(
      try String(contentsOf: root.appendingPathComponent("narou-reader/library/index.0.json")),
      "original")
  }
  func testSettingsFailureRollsBackFilesAndRecoversAfterRestart() throws {
    let root = folder.appendingPathComponent("target")
    try make("narou-reader/library/index.0.json", "original", root: root)
    var settings: String? = "old"
    var reject = true
    let restore = BackupArchive(
      root: root, readSettings: { settings },
      saveSettings: { next in
        if reject { throw BackupFailure.io }
        settings = next
      })
    _ = try restore.prepare(
      from: zip([("manifest.json", manifest), ("narou-reader/library/index.0.json", "new")]))
    XCTAssertThrowsError(try restore.commit())
    reject = false
    let restarted = BackupArchive(
      root: root, readSettings: { settings }, saveSettings: { settings = $0 })
    try restarted.recover()
    XCTAssertEqual(settings, "old")
    XCTAssertEqual(
      try String(contentsOf: root.appendingPathComponent("narou-reader/library/index.0.json")),
      "original")
  }
  func testTruncatedZIPAndSymlinkAreRejected() throws {
    let target = BackupArchive(
      root: folder.appendingPathComponent("target"), readSettings: { nil }, saveSettings: { _ in })
    let file = try zip([("manifest.json", manifest), ("narou-reader/library/index.0.json", "new")])
    var bytes = try Data(contentsOf: file)
    bytes.removeLast(24)
    let broken = folder.appendingPathComponent("broken.zip")
    try bytes.write(to: broken)
    XCTAssertThrowsError(try target.prepare(from: broken))
    try target.recover()
    let link = folder.appendingPathComponent("link.zip")
    let archive = try Archive(url: link, accessMode: .create)
    let data = Data("/etc/passwd".utf8)
    try archive.addEntry(
      with: "narou-reader/library/link", type: .symlink, uncompressedSize: Int64(data.count)
    ) { _, _ in data }
    XCTAssertThrowsError(try target.prepare(from: link))
  }
}
