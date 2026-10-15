import Capacitor
import UIKit

@objc(ReaderThemePlugin)
public final class ReaderThemePlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "ReaderThemePlugin"
  public let jsName = "ReaderTheme"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "applyResolvedTheme", returnType: CAPPluginReturnPromise)
  ]

  @objc public func applyResolvedTheme(_ call: CAPPluginCall) {
    guard let theme = call.getString("theme"), ["light", "dark"].contains(theme) else {
      call.reject("invalid_theme")
      return
    }
    DispatchQueue.main.async {
      self.bridge?.viewController?.view.window?.overrideUserInterfaceStyle =
        theme == "dark" ? .dark : .light
      call.resolve()
    }
  }
}

@objc(ScreenAwakePlugin)
public final class ScreenAwakePlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "ScreenAwakePlugin"
  public let jsName = "ScreenAwake"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise)
  ]
  private var enabled = false

  public override func load() {
    NotificationCenter.default.addObserver(
      self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification,
      object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(foreground), name: UIApplication.didBecomeActiveNotification,
      object: nil)
  }
  @objc public func setKeepAwake(_ call: CAPPluginCall) {
    guard let enabled = call.getBool("enabled") else {
      call.reject("invalid")
      return
    }
    DispatchQueue.main.async {
      self.enabled = enabled
      UIApplication.shared.isIdleTimerDisabled =
        enabled && UIApplication.shared.applicationState == .active
      call.resolve()
    }
  }
  @objc private func background() { UIApplication.shared.isIdleTimerDisabled = false }
  @objc private func foreground() { UIApplication.shared.isIdleTimerDisabled = enabled }
  deinit { NotificationCenter.default.removeObserver(self) }
}

@objc(AppReadyPlugin)
public final class AppReadyPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AppReadyPlugin"
  public let jsName = "AppReady"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "ready", returnType: CAPPluginReturnPromise)
  ]
  @objc public func ready(_ call: CAPPluginCall) { call.resolve() }
}
