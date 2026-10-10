package dev.earlydreamer.jhfreader;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Model-only SSE. No redirects, cookie persistence, logging or automatic POST retries. */
@CapacitorPlugin(name = "ModelStream")
public final class ModelStreamPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String activeId;
    private volatile boolean cancelled;
    private volatile boolean paused;
    private volatile HttpURLConnection connection;

    @PluginMethod public synchronized void start(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        JSObject headers = call.getObject("headers", new JSObject());
        JSObject body = call.getObject("data");
        try {
            URI target = new URI(url == null ? "" : url);
            if (id == null || !id.matches("[a-f0-9-]{36}") || activeId != null || paused || body == null ||
                !("http".equals(target.getScheme()) || "https".equals(target.getScheme())) ||
                target.getHost() == null || target.getRawUserInfo() != null || target.getRawQuery() != null || target.getRawFragment() != null ||
                !url.matches("https?://[^/?#]+(?:/[A-Za-z0-9._-]+)*/v1/chat/completions") || url.contains("/../") || url.contains("/./")) {
                call.reject("connection_not_sent"); return;
            }
            String auth = headers.getString("Authorization");
            if (auth != null && !auth.matches("Bearer [^\\s\\x7f]+")) { call.reject("auth_not_sent"); return; }
            activeId = id;
            cancelled = false;
            executor.execute(() -> run(call, id, url, auth, body));
        } catch (Exception invalid) { call.reject("connection_not_sent"); }
    }

    private void run(PluginCall call, String id, String url, String auth, JSObject body) {
        HttpURLConnection socket = null;
        JSObject result = null;
        String failure = null;
        try {
            if (cancelled) throw new InterruptedException();
            socket = (HttpURLConnection) new URI(url).toURL().openConnection();
            connection = socket;
            socket.setInstanceFollowRedirects(false);
            socket.setRequestMethod("POST");
            socket.setConnectTimeout(15000);
            // 첫 바이트·다음 줄을 120초 넘게 못 받으면 멈춘 요청으로 본다(#254).
            socket.setReadTimeout(120000);
            socket.setUseCaches(false);
            socket.setRequestProperty("Accept", "text/event-stream");
            socket.setRequestProperty("Content-Type", "application/json");
            socket.setRequestProperty("Cookie", "");
            if (auth != null) socket.setRequestProperty("Authorization", auth);
            socket.setDoOutput(true);
            body.put("stream", true);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            socket.setFixedLengthStreamingMode(bytes.length);
            if (cancelled) throw new InterruptedException();
            try (OutputStream output = socket.getOutputStream()) { output.write(bytes); }
            int status = socket.getResponseCode();
            String mime = socket.getContentType();
            boolean sse = status >= 200 && status < 300 && mime != null && mime.toLowerCase(java.util.Locale.ROOT).startsWith("text/event-stream");
            StringBuilder all = new StringBuilder();
            InputStream input = status >= 400 ? socket.getErrorStream() : socket.getInputStream();
            if (input != null) try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                String line;
                int count = 0;
                while ((line = reader.readLine()) != null) {
                    if (cancelled) throw new InterruptedException();
                    all.append(line).append('\n');
                    if (++count > 200000 || all.length() > (sse ? 16000000 : 65536)) throw new IllegalStateException();
                    if (sse) {
                        JSObject event = new JSObject();
                        event.put("id", id); event.put("data", line + "\n");
                        notifyListeners("data", event);
                    }
                }
            }
            if (cancelled) throw new InterruptedException();
            result = new JSObject();
            result.put("status", status); result.put("url", url); result.put("headers", new JSObject());
            result.put("data", all.toString()); result.put("sse", sse);
        } catch (Exception error) { failure = cancelled ? "cancelled_unknown" : "timeout_unknown"; }
        finally {
            if (socket != null) socket.disconnect();
            synchronized (this) { connection = null; activeId = null; }
        }
        // Settle only after the native socket has been cleaned up.
        if (failure != null) call.reject(failure); else call.resolve(result);
    }

    @PluginMethod public synchronized void cancel(PluginCall call) {
        if (activeId != null && activeId.equals(call.getString("id"))) cancelActive();
        call.resolve();
    }
    private void cancelActive() {
        cancelled = true;
        HttpURLConnection socket = connection;
        if (socket != null) socket.disconnect();
    }
    @Override protected synchronized void handleOnPause() { paused = true; cancelActive(); }
    @Override protected synchronized void handleOnResume() { paused = false; }
    @Override protected synchronized void handleOnDestroy() { cancelActive(); executor.shutdownNow(); }
}
