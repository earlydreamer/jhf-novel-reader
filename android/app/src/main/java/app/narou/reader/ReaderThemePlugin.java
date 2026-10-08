package app.narou.reader;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReaderTheme")
public final class ReaderThemePlugin extends Plugin {
    @PluginMethod
    public void applyResolvedTheme(PluginCall call) {
        String theme = call.getString("theme");
        if (!"light".equals(theme) && !"dark".equals(theme)) {
            call.reject("Unsupported resolved theme");
            return;
        }
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("Main activity unavailable");
            return;
        }

        getBridge().executeOnMainThread(() -> {
            try {
                ((MainActivity) getActivity()).applyResolvedTheme(theme);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Unable to apply resolved theme");
            }
        });
    }
}
