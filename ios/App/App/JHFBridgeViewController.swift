import Capacitor
import JHFNative

final class JHFBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SourceBrowserPlugin())
        bridge?.registerPluginInstance(ModelStreamPlugin())
        bridge?.registerPluginInstance(ReaderHttpPlugin())
        bridge?.registerPluginInstance(BackupPlugin())
        bridge?.registerPluginInstance(OnDeviceEmbeddingPlugin())
        bridge?.registerPluginInstance(ReaderThemePlugin())
        bridge?.registerPluginInstance(ScreenAwakePlugin())
        bridge?.registerPluginInstance(AppReadyPlugin())
        #if DEBUG
        if #available(iOS 16.4, *) { webView?.isInspectable = true }
        #endif
    }
}
