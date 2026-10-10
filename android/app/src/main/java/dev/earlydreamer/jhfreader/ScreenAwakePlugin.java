package dev.earlydreamer.jhfreader;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenAwake")
public final class ScreenAwakePlugin extends Plugin {
    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }

        getBridge().executeOnMainThread(() -> {
            try {
                if (enabled) {
                    getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Unable to change keep awake");
            }
        });
    }
}
