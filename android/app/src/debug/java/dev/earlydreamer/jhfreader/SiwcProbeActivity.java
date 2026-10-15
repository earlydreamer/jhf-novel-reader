package dev.earlydreamer.jhfreader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 인증 A 단계만. 제품 설정·서재·WebView·모델 호출에 접근하지 않는다. */
public final class SiwcProbeActivity extends Activity {
    private static final class HttpFailure extends Exception {
        final int status;
        HttpFailure(int status) { this.status = status; }
    }
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile SiwcLoopback listener;
    private volatile boolean cancelled;
    private volatile boolean destroyed;
    private TextView status;
    private Button start;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 64, 32, 32);
        TextView info = new TextView(this);
        info.setText("JHF SiwC 인증 검증 · A 단계\n\n시스템 브라우저에서 네가 직접 로그인하고 권한을 확인해. 플랜 권한은 Codex/ChatGPT Work 공유 한도에 연결돼. 이 검증은 번역·모델 요청을 하지 않아.\n\n토큰은 파일에 저장하지 않고, 교환 후 refresh 세션 철회를 시도해. 철회 결과는 별도로 표시해. 브라우저의 ChatGPT 로그인 자체를 로그아웃하지는 않아. 결과 파일에는 단계별 성공 여부·시간만 남겨.\n\n콜백 수신 안내가 뜨면 뒤로가기로 이 화면에 돌아와. 5분 뒤에는 시도를 종료해. 앱 종료·취소 뒤 예전 콜백은 사용할 수 없어.\n");
        layout.addView(info);
        start = new Button(this);
        start.setText("Continue with ChatGPT");
        start.setOnClickListener(v -> begin());
        layout.addView(start);
        Button cancel = new Button(this);
        cancel.setText("검증 취소");
        cancel.setOnClickListener(v -> cancel());
        layout.addView(cancel);
        status = new TextView(this);
        status.setText("준비됨 · 자동 로그인 없음");
        status.setTextIsSelectable(false);
        layout.addView(status);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);
        setContentView(scroll);
    }

    private void show(String text) {
        runOnUiThread(() -> { if (!destroyed) status.setText(text); });
    }

    private void cancel() {
        cancelled = true;
        SiwcLoopback current = listener;
        if (current != null) current.close();
        show("취소 요청됨 · 교환이 진행 중이면 결과 확인과 세션 정리 뒤 종료해. 자동 재전송은 없어.");
    }

    private void begin() {
        if (!start.isEnabled()) return;
        File previous = new File(getNoBackupFilesDir(), "siwc-probe-result.json");
        if (previous.exists() && !previous.delete()) {
            show("이전 검증 결과를 지울 수 없어. 인증을 시작하지 않았어.");
            return;
        }
        start.setEnabled(false);
        cancelled = false;
        worker.execute(this::probe);
    }

    private static String read(InputStream input, int limit) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            for (int count; (count = stream.read(buffer)) >= 0;) {
                if (bytes.size() + count > limit) throw new IllegalArgumentException("response size");
                bytes.write(buffer, 0, count);
            }
            return bytes.toString("UTF-8");
        }
    }

    // URL은 외부 입력으로 받지 않는다. POST 실패·결과 불명은 재전송하지 않는다.
    private static String request(String path, Map<String, String> form) throws Exception {
        if (!Arrays.asList("/.well-known/jwks.json", "/api/accounts/oauth/token", "/api/accounts/oauth/revoke").contains(path))
            throw new IllegalArgumentException("endpoint");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(SiwcProtocol.ISSUER + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setRequestProperty("Accept", "application/json");
            if (form != null) {
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                byte[] body = SiwcProtocol.form(form).getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length);
                try (java.io.OutputStream stream = connection.getOutputStream()) { stream.write(body); }
            }
            int code = connection.getResponseCode();
            if (code != 200) throw new HttpFailure(code);
            return read(connection.getInputStream(), 262144);
        } finally { connection.disconnect(); }
    }

    private synchronized JSONObject registration() throws Exception {
        File file = new File(getNoBackupFilesDir(), "siwc-probe-registration.json");
        android.util.AtomicFile atomic = new android.util.AtomicFile(file);
        if (file.exists() || new File(file.getPath() + ".bak").exists())
            return new JSONObject(read(atomic.openRead(), 8192));
        JSONObject initial = new JSONObject().put("host", "urn:uuid:" + UUID.randomUUID());
        saveRegistration(initial);
        return initial;
    }

    private synchronized void saveRegistration(JSONObject metadata) throws Exception {
        // 계정별 등록 ID·검증된 sub와 안정된 host만 보존. 토큰·이메일은 저장하지 않는다.
        android.util.AtomicFile file = new android.util.AtomicFile(new File(getNoBackupFilesDir(), "siwc-probe-registration.json"));
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception error) { file.failWrite(stream); throw error; }
    }

    private void probe() {
        String refresh = null;
        String issued = null;
        boolean tokenResponse = false;
        boolean callbackReceived = false;
        boolean identity = false;
        boolean plan = false;
        boolean revoked = false;
        String outcome = "인증 실패 또는 결과 불명 · 자동 재전송 없음";
        String phase = "인증 준비";
        String revocation = "토큰 응답 미확인 · 원격 세션 상태 미확인";
        long started = SystemClock.elapsedRealtime();
        try (SiwcLoopback loopback = new SiwcLoopback()) {
            listener = loopback;
            JSONObject metadata = registration();
            String selected = metadata.optString("client", SiwcProtocol.DYNAMIC);
            String state = SiwcProtocol.random(), nonce = SiwcProtocol.random(), verifier = SiwcProtocol.random();
            String redirect = loopback.redirect();
            String authorization = SiwcProtocol.authorization(metadata.getString("host"), selected, redirect, state, nonce, verifier);
            if (cancelled || destroyed) throw new java.util.concurrent.CancellationException();
            runOnUiThread(() -> {
                if (cancelled || destroyed) { loopback.close(); return; }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(authorization))
                        .addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (Exception ignored) { cancelled = true; loopback.close(); }
            });
            show("시스템 브라우저에서 로그인 중 · 리스너 유지 · 5분 제한");
            phase = "브라우저 콜백";
            Map<String, String> callback = loopback.await(state, started + 300000);
            callbackReceived = true;
            issued = SiwcProtocol.callbackClient(callback, state, selected);
            if (cancelled || destroyed) throw new java.util.concurrent.CancellationException();
            show("콜백 검증 완료 · 코드 교환 1회 진행");
            phase = "코드 교환";
            Map<String, String> form = new LinkedHashMap<>();
            form.put("grant_type", "authorization_code");
            form.put("client_id", issued);
            form.put("code", callback.get("code"));
            form.put("code_verifier", verifier);
            form.put("redirect_uri", redirect);
            form.put("resource", SiwcProtocol.RESOURCE);
            JSONObject tokens = new JSONObject(request("/api/accounts/oauth/token", form));
            tokenResponse = true;
            refresh = tokens.optString("refresh_token", "");
            phase = "공식 키 조회·ID token 검증";
            String subject = SiwcProtocol.identity(tokens.getString("id_token"),
                new JSONObject(request("/.well-known/jwks.json", null)), issued, nonce, System.currentTimeMillis() / 1000);
            if (metadata.has("subject") && !SiwcProtocol.equal(metadata.getString("subject"), subject))
                throw new IllegalArgumentException("account mismatch");
            identity = true;
            plan = Arrays.asList(tokens.optString("scope", "").split(" +")).contains("chatgpt.tokens.use.direct")
                && "Bearer".equalsIgnoreCase(tokens.optString("token_type"))
                && !tokens.optString("access_token").isEmpty();
            if (!cancelled && !destroyed) {
                saveRegistration(new JSONObject().put("host", metadata.getString("host")).put("client", issued).put("subject", subject));
                outcome = plan ? "인증·플랜 권한 검증 완료 (번역 미실행)" : "신원 검증 완료 · 플랜 권한 미확인";
            }
        } catch (java.util.concurrent.CancellationException ignored) {
            outcome = "취소됨 · 자동 재시작 없음";
        } catch (java.util.concurrent.TimeoutException ignored) {
            outcome = "시간 초과 · 새 시도가 필요해";
        } catch (HttpFailure error) {
            outcome = phase + " 실패 · HTTP " + error.status + " · 자동 재전송 없음";
        } catch (Exception ignored) {
            // 인증 URL·예외 메시지·토큰·콜백·개인정보를 로그 또는 화면에 출력하지 않는다.
            outcome = phase + " 실패 또는 결과 불명 · 자동 재전송 없음";
        } finally {
            listener = null;
            if (tokenResponse && refresh != null && !refresh.isEmpty() && issued != null) {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", issued);
                    form.put("token", refresh);
                    form.put("token_type_hint", "refresh_token");
                    request("/api/accounts/oauth/revoke", form);
                    revoked = true;
                    revocation = "임시 refresh 세션 원격 철회 응답 확인 (HTTP 200)";
                } catch (Exception ignored) { revocation = "원격 철회 미확인 · ChatGPT 연결 관리에서 확인 필요"; }
            } else if (tokenResponse) { revocation = "refresh token 없음 · 원격 철회 미확인"; }
            refresh = null;
            try {
                JSONObject result = new JSONObject().put("completed", true).put("callbackReceived", callbackReceived)
                    .put("tokenResponse", tokenResponse).put("identityVerified", identity).put("planGranted", plan)
                    .put("revocationConfirmed", revoked).put("cancelled", cancelled)
                    .put("elapsedMs", SystemClock.elapsedRealtime() - started).put("outcome", outcome);
                // 비밀이 없는 고정 항목만 기록한다. URL·계정·토큰을 받지 않는다.
                android.util.AtomicFile report = new android.util.AtomicFile(new File(getNoBackupFilesDir(), "siwc-probe-result.json"));
                FileOutputStream output = report.startWrite();
                try {
                    output.write(result.toString().getBytes(StandardCharsets.UTF_8));
                    report.finishWrite(output);
                } catch (Exception error) { report.failWrite(output); throw error; }
            } catch (Exception ignored) { /* 결과 기록 실패로 인증·철회를 재전송하지 않는다. */ }
            show((cancelled ? "취소됨 · 정리 결과 확인" : outcome)
                + "\n신원=" + identity + " · 플랜 권한=" + plan
                + "\n" + revocation + "\n경과 " + ((SystemClock.elapsedRealtime() - started) / 1000) + "초"
                + "\n토큰 파일 저장 없음 · 번역/모델 호출 없음");
            runOnUiThread(() -> { if (!destroyed) start.setEnabled(true); });
        }
    }

    @Override public void onBackPressed() { cancel(); super.onBackPressed(); }

    @Override protected void onDestroy() {
        destroyed = true;
        cancel();
        worker.shutdown();
        super.onDestroy();
    }
}
