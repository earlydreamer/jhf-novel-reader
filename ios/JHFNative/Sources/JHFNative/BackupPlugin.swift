import Capacitor
import Foundation
import JHFBackup
import UIKit
import UniformTypeIdentifiers

@objc(BackupPlugin)
public final class BackupPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
  public let identifier = "BackupPlugin"
  public let jsName = "Backup"
  public let pluginMethods: [CAPPluginMethod] = [
    "recoverRestore", "export", "prepareRestore", "listRestoreFiles", "readRestoreFile",
    "commitRestore", "abortRestore",
  ].compactMap { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
  private let queue = DispatchQueue(label: "dev.earlydreamer.jhfreader.backup", qos: .userInitiated)
  private let settingsKey = "CapacitorStorage.narou-reader.reading-settings.v2"
  private var archive: BackupArchive!
  private var ready = false
  private var token: String?
  private var paths: [String] = []
  // Picker state is confined to the main queue; archive state to queue.
  private var pickerCall: CAPPluginCall?
  private var exporting = false
  private var exportFile: URL?
  private var exportCount = 0
  private var busy = false

  public override func load() {
    let library = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
    archive = BackupArchive(
      root: library.appendingPathComponent("NoCloud", isDirectory: true),
      readSettings: { UserDefaults.standard.string(forKey: self.settingsKey) },
      saveSettings: { value in
        UserDefaults.standard.set(value, forKey: self.settingsKey)
        guard UserDefaults.standard.synchronize() else { throw BackupFailure.io }
      })
  }
  @objc public func recoverRestore(_ call: CAPPluginCall) {
    DispatchQueue.main.async {
      guard self.pickerCall == nil else {
        call.reject("restore_recovery_required")
        return
      }
      self.queue.async {
        self.ready = false
        do {
          try self.archive.recover()
          self.token = nil
          self.paths = []
          self.busy = false
          self.ready = true
          call.resolve(["ready": true])
        } catch { call.reject("restore_recovery_required") }
      }
    }
  }
  @objc public func `export`(_ call: CAPPluginCall) {
    queue.async {
      guard self.ready, !self.busy else {
        call.reject("backup_failed")
        return
      }
      self.busy = true
      let file = FileManager.default.temporaryDirectory.appendingPathComponent(
        "jhf-backup-\(UUID().uuidString).zip")
      do {
        let count = try self.archive.export(to: file)
        DispatchQueue.main.async {
          self.exporting = true
          self.exportFile = file
          self.exportCount = count
          self.present(
            UIDocumentPickerViewController(forExporting: [file], asCopy: true), call: call)
        }
      } catch {
        try? FileManager.default.removeItem(at: file)
        self.busy = false
        call.reject("backup_failed")
      }
    }
  }
  @objc public func prepareRestore(_ call: CAPPluginCall) {
    queue.async {
      guard self.ready, !self.busy else {
        call.reject("restore_failed")
        return
      }
      self.busy = true
      DispatchQueue.main.async {
        self.exporting = false
        self.present(
          UIDocumentPickerViewController(forOpeningContentTypes: [.zip, .data], asCopy: false),
          call: call)
      }
    }
  }
  private func present(_ picker: UIDocumentPickerViewController, call: CAPPluginCall) {
    guard pickerCall == nil, let parent = bridge?.viewController,
      parent.presentedViewController == nil
    else {
      cleanupPicker()
      call.reject("backup_failed")
      return
    }
    pickerCall = call
    picker.delegate = self
    picker.allowsMultipleSelection = false
    parent.present(picker, animated: true)
  }
  private func cleanupPicker() {
    if let file = exportFile { try? FileManager.default.removeItem(at: file) }
    exportFile = nil
    pickerCall = nil
    queue.async { self.busy = false }
  }
  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let call = pickerCall
    let wasExporting = exporting
    cleanupPicker()
    call?.resolve(wasExporting ? ["saved": false] : ["prepared": false])
  }
  public func documentPicker(
    _ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]
  ) {
    guard let call = pickerCall, let url = urls.first else {
      cleanupPicker()
      return
    }
    pickerCall = nil
    if exporting {
      let bytes =
        exportFile.flatMap { try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize } ?? 0
      let count = exportCount
      cleanupPicker()
      call.resolve(["saved": true, "files": count, "bytes": bytes])
      return
    }
    queue.async {
      let scope = url.startAccessingSecurityScopedResource()
      defer { if scope { url.stopAccessingSecurityScopedResource() } }
      let copy = FileManager.default.temporaryDirectory.appendingPathComponent(
        "jhf-restore-\(UUID().uuidString).zip")
      defer { try? FileManager.default.removeItem(at: copy) }
      do {
        // Copy once into private staging; never reopen an externally mutable provider URL.
        guard FileManager.default.createFile(atPath: copy.path, contents: nil) else {
          throw BackupFailure.io
        }
        let input = try FileHandle(forReadingFrom: url)
        let output = try FileHandle(forWritingTo: copy)
        defer {
          try? input.close()
          try? output.close()
        }
        var count = 0
        while let chunk = try input.read(upToCount: 65536), !chunk.isEmpty {
          count += chunk.count
          guard count <= 1_073_741_824 else { throw BackupFailure.invalid }
          try output.write(contentsOf: chunk)
        }
        try output.synchronize()
        let snapshot = try self.archive.prepare(from: copy)
        let token = UUID().uuidString
        self.token = token
        self.paths = snapshot.paths
        call.resolve([
          "prepared": true, "token": token, "files": snapshot.paths.count,
          "settings": snapshot.settings as Any? ?? NSNull(),
        ])
      } catch {
        do {
          try self.archive.abort()
          self.busy = false
          call.reject("backup_invalid")
        } catch {
          self.ready = false
          call.reject("restore_restart_required")
        }
      }
    }
  }
  private func authorized(_ call: CAPPluginCall) -> Bool {
    token != nil && token == call.getString("token")
  }
  @objc public func listRestoreFiles(_ call: CAPPluginCall) {
    queue.async {
      guard self.authorized(call), let offset = call.getInt("offset"),
        (0...self.paths.count).contains(offset)
      else {
        call.reject("restore_failed")
        return
      }
      let end = min(offset + 256, self.paths.count)
      call.resolve([
        "paths": Array(self.paths[offset..<end]),
        "nextOffset": end < self.paths.count ? end as Any : NSNull(),
      ])
    }
  }
  @objc public func readRestoreFile(_ call: CAPPluginCall) {
    queue.async {
      guard self.authorized(call), let path = call.getString("path") else {
        call.reject("restore_failed")
        return
      }
      do { call.resolve(["text": try self.archive.read(path) as Any? ?? NSNull()]) } catch {
        call.reject("restore_failed")
      }
    }
  }
  @objc public func commitRestore(_ call: CAPPluginCall) {
    queue.async {
      guard self.authorized(call) else {
        call.reject("restore_failed")
        return
      }
      self.ready = false
      do {
        let count = try self.archive.commit()
        self.token = nil
        self.paths = []
        self.busy = false
        call.resolve(["restored": true, "files": count])
      } catch { call.reject("restore_restart_required") }
    }
  }
  @objc public func abortRestore(_ call: CAPPluginCall) {
    queue.async {
      guard self.authorized(call) else {
        call.reject("restore_failed")
        return
      }
      do {
        try self.archive.abort()
        self.token = nil
        self.paths = []
        self.busy = false
        call.resolve()
      } catch {
        self.ready = false
        call.reject("restore_restart_required")
      }
    }
  }
}
