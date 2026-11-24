package dev.earlydreamer.jhfreader;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.HttpURLConnection;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeoutException;
import org.json.JSONObject;

/**
 * ChatGPT 계정 연결과 모델 요청. 토큰·계정 식별자는 웹 화면에 넘기지 않고 이 플러그인 안에서만 붙인다.
 * 앱이 백그라운드로 가면 진행 중인 모델 요청을 끊고 새 요청을 받지 않는다. 로그인 대기는 브라우저 전환 중에도 유지한다.
 */
@CapacitorPlugin(name = "ChatGpt")
public final class ChatGptPlugin extends Plugin {
    /** 짧은 포그라운드 서비스의 시스템 한도(약 3분) 안에서 끝낸다. */
    private static final long LOGIN_TIMEOUT_MS = 170 * 1000L;
    /** 콜백을 받은 뒤 브라우저가 같은 콜백을 다시 열어도 완료 페이지를 보여 주는 시간. */
    private static final long CALLBACK_GRACE_MS = 10 * 1000L;
    private final ExecutorService login = Executors.newSingleThreadExecutor();
    private final ExecutorService requests = Executors.newSingleThreadExecutor();
    private final ChatGptHttp http = new ChatGptHttp();
    private ChatGptSession session;
    private volatile ChatGptLoopback loopback;
    private String activeId;
    private volatile boolean cancelled;
    private volatile boolean paused;
    private volatile HttpURLConnection connection;

    @Override public void load() {
        session = new ChatGptSession(new ChatGptVault(getContext(), "session"),
            new ChatGptVault(getContext(), "registration"), http, System::currentTimeMillis);
    }

    @PluginMethod public void status(PluginCall call) {
        requests.execute(() -> {
            try {
                JSObject result = new JSObject();
                result.put("state", session.status());
                call.resolve(result);
            } catch (Exception unreadable) {
                call.reject("storage");
            }
        });
    }

    @PluginMethod public synchronized void connect(PluginCall call) {
        if (loopback != null) { call.reject("busy"); return; }
        final ChatGptLoopback listener;
        try {
            listener = new ChatGptLoopback(getContext().getPackageName() + "://chatgpt");
        } catch (Exception unavailable) {
            outcome(call, "failed");
            return;
        }
        loopback = listener;
        Runnable closer = listener::close;
        login.execute(() -> {
            String result;
            try {
                result = signIn(listener, closer);
            } finally {
                if (!listener.lingering()) {
                    listener.close();
                    releaseService(closer);
                }
                synchronized (this) { if (loopback == listener) loopback = null; }
            }
            outcome(call, result);
        });
    }

    /** 이 시도가 띄운 서비스일 때만 내린다. 그 사이 새 로그인이 서비스를 이어받았으면 그대로 둔다. */
    private synchronized void releaseService(Runnable closer) {
        if (ChatGptLoginService.onTimeout != closer) return;
        ChatGptLoginService.onTimeout = null;
        ChatGptLoginService.stop(getContext());
    }

    private String signIn(ChatGptLoopback listener, Runnable closer) {
        try {
            ChatGptSession.Begin begin = session.begin();
            String state = ChatGptProtocol.random();
            String nonce = ChatGptProtocol.random();
            String verifier = ChatGptProtocol.random();
            String redirect = listener.redirect();
            // 수신기를 연 뒤에 브라우저를 연다. 앱 안 WebView가 아니라 시스템 브라우저로 로그인한다.
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(ChatGptProtocol.authorization(
                begin.hostId, begin.client, redirect, state, nonce, verifier)));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            browser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            // 브라우저가 앞에 있는 동안 시스템이 이 앱의 네트워크를 막지 않도록 서비스를 띄운다.
            ChatGptLoginService.onTimeout = closer;
            ChatGptLoginService.start(getContext());
            try {
                getContext().startActivity(browser);
            } catch (ActivityNotFoundException missing) {
                return "no_browser";
            }
            Map<String, String> query = listener.await(state, LOGIN_TIMEOUT_MS);
            listener.linger(state, CALLBACK_GRACE_MS, () -> releaseService(closer));
            String client = ChatGptProtocol.callbackClient(query, state, begin.client);
            session.complete(client, query.get("code"), verifier, redirect, nonce);
            return "connected";
        } catch (CancellationException cancelledByUser) {
            return "cancelled";
        } catch (TimeoutException late) {
            return "timeout";
        } catch (ChatGptProtocol.Denied denied) {
            return "denied";
        } catch (ChatGptSession.NotEligible notEligible) {
            return "not_eligible";
        } catch (ChatGptSession.Failed failed) {
            return "already_connected".equals(failed.reason) || "account_mismatch".equals(failed.reason)
                ? failed.reason : "failed";
        } catch (Exception failed) {
            return "failed";
        }
    }

    private static void outcome(PluginCall call, String value) {
        JSObject result = new JSObject();
        result.put("outcome", value);
        call.resolve(result);
    }

    @PluginMethod public synchronized void cancelConnect(PluginCall call) {
        ChatGptLoopback listener = loopback;
        if (listener != null) listener.close();
        call.resolve();
    }

    @PluginMethod public void models(PluginCall call) {
        if (paused) { call.reject("connection_not_sent"); return; }
        requests.execute(() -> {
            try {
                ChatGptSession.Response response = http.models(session.access());
                JSObject result = new JSObject();
                result.put("status", response.status);
                result.put("data", response.status == 200
                    ? new JSONObject().put("models", ChatGptProtocol.models(response.body))
                    : ChatGptProtocol.errorSummary(response.body));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(localFailure(error, false));
            }
        });
    }

    private static String localFailure(Exception error, boolean sent) {
        if (error instanceof ChatGptSession.Reconnect) return "reconnect_required";
        if (error instanceof ChatGptSession.NotEligible) return "not_eligible";
        if (error instanceof ChatGptSession.Temporary) return "temporary";
        if (error instanceof ChatGptProtocol.Invalid) return "invalid_output";
        return sent ? "timeout_unknown" : "connection";
    }

    @PluginMethod public synchronized void respond(PluginCall call) {
        String id = call.getString("id");
        JSONObject body;
        try {
            body = ChatGptProtocol.responsesBody(call.getObject("body"));
        } catch (Exception invalid) {
            call.reject("connection_not_sent");
            return;
        }
        if (id == null || !id.matches("[a-f0-9-]{36}") || activeId != null || paused) {
            call.reject("connection_not_sent");
            return;
        }
        activeId = id;
        cancelled = false;
        requests.execute(() -> run(call, id, body));
    }

    private void run(PluginCall call, String id, JSONObject body) {
        JSObject result = null;
        String failure = null;
        boolean sent = false;
        try {
            if (cancelled) throw new InterruptedException();
            String access = session.access();
            if (cancelled) throw new InterruptedException();
            sent = true;
            ChatGptSession.Response response = http.stream(access, body.toString(),
                () -> cancelled, socket -> connection = socket, line -> {
                    JSObject event = new JSObject();
                    event.put("id", id);
                    event.put("data", line);
                    notifyListeners("data", event);
                });
            if (response.status == 401) confirmDisconnected(response.body);
            result = new JSObject();
            result.put("status", response.status);
            result.put("data", response.body);
        } catch (InterruptedException stopped) {
            failure = sent ? "cancelled_unknown" : "connection_not_sent";
        } catch (ChatGptSession.Reconnect | ChatGptSession.NotEligible | ChatGptSession.Temporary local) {
            failure = localFailure(local, false);
        } catch (Exception error) {
            failure = cancelled ? (sent ? "cancelled_unknown" : "connection_not_sent")
                : sent ? "timeout_unknown" : "connection_not_sent";
        } finally {
            synchronized (this) { connection = null; activeId = null; }
        }
        if (failure != null) call.reject(failure); else call.resolve(result);
    }

    /** 401 subscription_sharing_invalid_user는 계정 연결이 끊겼다는 확인이다. 저장한 세션을 더 쓰지 않는다. */
    private void confirmDisconnected(String summary) {
        try {
            JSONObject error = new JSONObject(summary).optJSONObject("error");
            if (error != null && "subscription_sharing_invalid_user".equals(error.optString("code")))
                session.forget();
        } catch (Exception ignored) {
            // 확인할 수 없으면 세션을 유지한다.
        }
    }

    @PluginMethod public synchronized void cancel(PluginCall call) {
        if (activeId != null && activeId.equals(call.getString("id"))) cancelActive();
        call.resolve();
    }

    @PluginMethod public void disconnect(PluginCall call) {
        synchronized (this) { cancelActive(); }
        requests.execute(() -> {
            try {
                boolean[] result = session.disconnect();
                JSObject value = new JSObject();
                value.put("revoked", result[0]);
                value.put("hadSession", result[1]);
                value.put("cleared", true);
                call.resolve(value);
            } catch (Exception failed) {
                call.reject("storage");
            }
        });
    }

    private void cancelActive() {
        cancelled = true;
        HttpURLConnection socket = connection;
        if (socket != null) socket.disconnect();
    }

    @Override protected synchronized void handleOnPause() {
        paused = true;
        cancelActive();
    }

    @Override protected synchronized void handleOnResume() { paused = false; }

    @Override protected synchronized void handleOnDestroy() {
        cancelActive();
        ChatGptLoopback listener = loopback;
        if (listener != null) listener.close();
        ChatGptLoginService.stop(getContext());
        login.shutdownNow();
        requests.shutdownNow();
    }
}
