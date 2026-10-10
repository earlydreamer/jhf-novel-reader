package dev.earlydreamer.jhfreader;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SourceBrowser")
public final class SourceBrowserPlugin extends Plugin {
    private boolean active;

    @PluginMethod public synchronized void open(PluginCall call) {
        String start = SourceBrowserPolicy.browseUrl(call.getString("startUrl"));
        if (start == null || active) {
            call.reject("source_access");
            return;
        }
        active = true;
        Intent intent = new Intent(getContext(), SourceBrowserActivity.class).putExtra(SourceBrowserActivity.START_URL, start);
        if (getActivity() instanceof MainActivity) {
            String theme = ((MainActivity) getActivity()).resolvedTheme();
            if (theme != null) intent.putExtra(SourceBrowserTheme.EXTRA, theme);
        }
        try { startActivityForResult(call, intent, "browserResult"); }
        catch (RuntimeException unavailable) {
            active = false;
            call.reject("source_access");
        }
    }

    @ActivityCallback private synchronized void browserResult(PluginCall call, ActivityResult result) {
        active = false;
        if (call == null) return;
        JSObject response = new JSObject();
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            response.put("selectedUrl", org.json.JSONObject.NULL);
            call.resolve(response);
            return;
        }
        Intent data = result.getData();
        String selected = data == null ? null : SourceBrowserPolicy.selectedUrl(data.getStringExtra(SourceBrowserActivity.SELECTED_URL));
        if (result.getResultCode() != Activity.RESULT_OK || selected == null) {
            call.reject("source_access");
            return;
        }
        response.put("selectedUrl", selected);
        call.resolve(response);
    }
}
