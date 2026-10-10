package dev.earlydreamer.jhfreader;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 웹 화면이 첫 내용을 그릴 준비가 됐다는 신호. 스플래시는 이 신호(또는 제한 시간)까지 남는다. */
@CapacitorPlugin(name = "AppReady")
public final class AppReadyPlugin extends Plugin {
    @PluginMethod
    public void ready(PluginCall call) {
        if (getActivity() instanceof MainActivity) ((MainActivity) getActivity()).markReady();
        call.resolve();
    }
}
