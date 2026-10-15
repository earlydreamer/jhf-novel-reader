package dev.earlydreamer.jhfreader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.AtomicFile;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** debug 전용 A→B→C PoC. 제품 설정·서재·WebView 브리지에 연결하지 않는다. */
public final class SiwcProbeActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SiwcHttp http = new SiwcHttp();
    private final List<Button> controls = new ArrayList<>();
    private volatile SiwcLoopback listener;
    private volatile boolean cancelled, destroyed, busy, inferring;
    private volatile String inferenceModel;
    private volatile int inferenceNumber;
    private SiwcVault vault;
    private SiwcSession session;
    private TextView status, translation;
    private Spinner picker;
    private List<SiwcHttp.Model> choices = new ArrayList<>();

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        vault = new SiwcVault(this, "session");
        session = new SiwcSession(vault, http);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(32, 48, 32, 32);
        TextView info = new TextView(this);
        info.setText("JHF SiwC 보호 저장·합성 번역 검증\n\nA 인증 왕복은 앞선 APK에서 확인했어. 이번 연결은 B 검증을 위해 토큰을 Android Keystore로 암호화해 이 테스트 앱에 보관해. 명시적으로 연결 해제를 누르면 원격 철회와 로컬 삭제를 진행해. 기존 JHF 앱과 별도 패키지야.\n\n로그인·복원·갱신·모델 목록은 번역을 요청하지 않아. 모델을 직접 선택하고 합성 번역 버튼을 누를 때만 아래 합성 문단과 번역 지침을 OpenAI에 보내. Codex/ChatGPT Work 공유 한도를 쓰며 다른 과금 경로로 자동 전환하지 않아.\n\n브라우저 콜백 뒤 뒤로가기로 돌아와. 저장 확인→앱 재실행 후 복원→갱신→모델 목록→합성 번역 1회→연결 해제 순서로 검증해. 결과 불명 요청은 재전송하지 않아.\n\n합성 원문: " + SiwcResponses.SYNTHETIC + "\n");
        layout.addView(info);
        TextView diagnosticInfo = new TextView(this);
        diagnosticInfo.setText("정밀 검증: 기본 추론 한도는 연결당 1회야. 추가 진단을 명시적으로 허용하면 같은 연결에서 총 3회까지 각각 실행할 수 있어. 결과 불명 요청도 시도 수에 포함하고 자동 재시도하지 않아. 진단 중에는 암호화한 연결을 유지할 수 있으며 검증이 끝나면 연결 해제를 실행해.\n");
        layout.addView(diagnosticInfo);
        button(layout, "Continue with ChatGPT", this::begin);
        button(layout, "보호 저장 연결 복원", () -> perform("restore", () -> {
            JSONObject value = current(false, false);
            report("session", new JSONObject().put("operation", "restore").put("success", true)
                .put("inferenceAttempted", value.getBoolean("inferenceAttempted"))
                .put("inferenceAttempts", value.optInt("inferenceAttempts", 0))
                .put("maxInferenceAttempts", value.optInt("maxInferenceAttempts", 1)));
            show("보호 저장 연결 복원됨 · 계정 정보·토큰은 표시하지 않아");
        }));
        button(layout, "토큰 갱신 검증 1회", () -> perform("refresh", () -> {
            current(true, true);
            report("session", new JSONObject().put("operation", "refresh").put("success", true));
            show("갱신 완료 · 최신 회전 토큰을 보호 저장했어");
        }));
        button(layout, "계정 모델 목록 읽기", () -> perform("models", () -> {
            JSONObject value = current(true, false);
            List<SiwcHttp.Model> models = http.models(value.getString("access_token"));
            if (models.isEmpty()) throw new IllegalStateException("no visible models");
            runOnUiThread(() -> {
                if (destroyed) return;
                choices = models;
                picker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, models));
            });
            report("session", new JSONObject().put("operation", "models").put("success", true).put("modelCount", models.size()));
            show("모델 목록 확인됨 · 선택 후 합성 번역을 직접 실행해");
        }));
        picker = new Spinner(this);
        layout.addView(picker);
        button(layout, "정밀 진단 허용 · 같은 연결 총 3회", () -> perform("diagnostic_budget", () -> {
            JSONObject value = current(false, false);
            session.allowAdditionalDiagnostics(value.getString("client"), value.getString("subject"));
            report("session", new JSONObject().put("operation", "diagnostic_budget").put("success", true)
                .put("maxInferenceAttempts", 3));
            show("진단 상한 총 3회 · 기존 시도 수를 유지하며 요청은 각각 명시적으로 실행해");
        }));
        button(layout, "합성 문단 번역 1회 · 공유 한도 사용", this::translate);
        button(layout, "연결 해제 · 원격 철회와 로컬 삭제", () -> perform("disconnect", () -> {
            boolean present = vault.load() != null;
            boolean revoked = session.disconnect();
            report("session", new JSONObject().put("operation", "disconnect").put("localCleared", true)
                .put("hadSession", present).put("revocationConfirmed", revoked).put("success", !present || revoked));
            runOnUiThread(() -> {
                choices = new ArrayList<>();
                picker.setAdapter(null);
                translation.setText("");
            });
            show(!present ? "저장된 연결 없음 · 원격 철회 요청 없음" : (revoked ? "원격 철회 응답 확인 · 로컬 토큰 삭제 완료"
                : "로컬 토큰 삭제 · 원격 철회 미확인, ChatGPT 연결 관리에서 확인해"));
        }));
        Button cancel = new Button(this);
        cancel.setText("진행 중 검증 취소");
        cancel.setOnClickListener(v -> cancel());
        layout.addView(cancel);
        status = new TextView(this);
        status.setText("준비됨 · 로그인·번역 자동 실행 없음");
        layout.addView(status);
        translation = new TextView(this);
        translation.setTag("siwc-translation");
        layout.addView(translation);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);
        setContentView(scroll);
    }

    private void button(LinearLayout layout, String label, Runnable action) {
        Button control = new Button(this);
        control.setText(label);
        control.setOnClickListener(v -> action.run());
        controls.add(control);
        layout.addView(control);
    }

    private void enabled(boolean value) {
        busy = !value;
        runOnUiThread(() -> { if (!destroyed) for (Button control : controls) control.setEnabled(value); });
    }
    private void show(String text) { runOnUiThread(() -> { if (!destroyed) status.setText(text); }); }
    private void cancel() {
        cancelled = true;
        SiwcLoopback current = listener;
        if (current != null) current.close();
        http.cancelInference();
        show("취소 요청됨 · 교환 중이면 정리 뒤 종료해. 결과 불명 요청은 재전송하지 않아.");
    }
    private interface Task { void run() throws Exception; }

    private void perform(String operation, Task task) {
        if (busy) return;
        enabled(false);
        cancelled = false;
        worker.execute(() -> {
            try {
                if (destroyed || cancelled) return;
                task.run();
            } catch (Exception error) {
                String message = operation + " 실패 또는 결과 불명 · 자동 재전송 없음";
                if (error instanceof SiwcHttp.Failure) message += " · HTTP " + ((SiwcHttp.Failure) error).status;
                show(message);
                try {
                    if (!"inference".equals(operation) || inferring) {
                        JSONObject failure = new JSONObject().put("operation", operation).put("success", false)
                            .put("attempted", inferring).put("completed", false).put("cancelled", cancelled)
                            .put("guard", SiwcResponses.guard(error));
                        if (inferring && inferenceModel != null) failure.put("model", inferenceModel).put("attemptNumber", inferenceNumber)
                            .put("transport", http.transportDiagnostics());
                        if (error instanceof SiwcHttp.Failure) {
                            failure.put("failureKind", "http").put("httpStatus", ((SiwcHttp.Failure) error).status)
                                .put("errorCode", ((SiwcHttp.Failure) error).code).put("http", ((SiwcHttp.Failure) error).details);
                        } else if (error instanceof SiwcResponses.Failure) {
                            failure.put("failureKind", "sse").put("terminalEvent", ((SiwcResponses.Failure) error).event)
                                .put("errorCode", ((SiwcResponses.Failure) error).code)
                                .put("parameter", ((SiwcResponses.Failure) error).parameter);
                        } else failure.put("failureKind", cancelled ? "cancelled"
                            : error instanceof org.json.JSONException ? "response_schema"
                            : error instanceof java.util.concurrent.TimeoutException || error instanceof java.net.SocketTimeoutException ? "timeout"
                            : error instanceof java.io.IOException ? "transport_unknown"
                            : error instanceof IllegalArgumentException ? "protocol_validation" : "state_or_storage");
                        report("inference".equals(operation) ? "inference" : "session", failure);
                    }
                } catch (Exception ignored) { }
            } finally { inferring = false; inferenceModel = null; enabled(true); }
        });
    }

    private JSONObject current(boolean fresh, boolean force) throws Exception {
        if (cancelled || destroyed) throw new java.util.concurrent.CancellationException();
        JSONObject metadata = registration();
        String client = metadata.getString("client"), subject = metadata.getString("subject");
        return fresh ? session.fresh(client, subject, System.currentTimeMillis() / 1000, force)
            : session.restore(client, subject);
    }

    private void translate() {
        if (busy || choices.isEmpty() || picker.getSelectedItemPosition() < 0) {
            show("연결한 계정의 모델 목록을 먼저 읽고 모델을 선택해.");
            return;
        }
        final String model = choices.get(picker.getSelectedItemPosition()).slug;
        perform("inference", () -> {
            JSONObject value = current(true, false);
            inferenceNumber = session.markInference(value.getString("client"), value.getString("subject"));
            inferenceModel = model;
            inferring = true;
            report("inference", new JSONObject().put("attempted", true).put("completed", false).put("model", model).put("attemptNumber", inferenceNumber));
            SiwcResponses.Result result = http.translate(value.getString("access_token"), model,
                () -> cancelled || destroyed, partial -> runOnUiThread(() -> {
                    if (!destroyed) translation.setText("수신 중 · 완료 미확인\n" + partial);
                }));
            report("inference", new JSONObject().put("attempted", true).put("completed", true)
                .put("model", model).put("attemptNumber", inferenceNumber).put("firstMs", result.firstMs).put("totalMs", result.totalMs)
                .put("inputTokens", result.inputTokens).put("outputTokens", result.outputTokens)
                .put("textChars", result.text.length()).put("mediaType", result.mediaType)
                .put("frames", result.frames).put("streamChars", result.streamChars).put("transport", http.transportDiagnostics()));
            runOnUiThread(() -> { if (!destroyed) translation.setText(result.text); });
            show("response.completed 확인 · 합성 번역 완료. 남은 진단 예산도 자동으로 사용하지 않아.");
        });
    }

    private synchronized JSONObject registration() throws Exception {
        AtomicFile file = new AtomicFile(new File(getNoBackupFilesDir(), "siwc-probe-registration.json"));
        if (file.getBaseFile().exists() || new File(file.getBaseFile().getPath() + ".bak").exists()) {
            try (InputStream input = file.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[1024];
                for (int n; (n = input.read(buffer)) >= 0;) {
                    if (output.size() + n > 8192) throw new IllegalArgumentException("metadata size");
                    output.write(buffer, 0, n);
                }
                return new JSONObject(output.toString("UTF-8"));
            }
        }
        JSONObject metadata = new JSONObject().put("host", "urn:uuid:" + UUID.randomUUID());
        write("siwc-probe-registration.json", metadata);
        return metadata;
    }

    private synchronized void write(String filename, JSONObject value) throws Exception {
        AtomicFile file = new AtomicFile(new File(getNoBackupFilesDir(), filename));
        FileOutputStream output = file.startWrite();
        try {
            output.write(value.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) { file.failWrite(output); throw error; }
    }
    private void report(String kind, JSONObject safe) throws Exception {
        if (!"session".equals(kind) && !"inference".equals(kind)) throw new IllegalArgumentException("report");
        // 호출자가 만든 성패·시간·모델 slug만 기록한다. 인증정보·응답 본문을 전달하지 않는다.
        write("siwc-" + kind + "-result.json", safe);
    }

    private void begin() {
        if (busy) return;
        File previous = new File(getNoBackupFilesDir(), "siwc-probe-result.json");
        if (previous.exists() && !previous.delete()) { show("이전 검증 결과를 지울 수 없어 인증을 시작하지 않았어."); return; }
        enabled(false);
        cancelled = false;
        worker.execute(this::probe);
    }

    private void probe() {
        String refresh = null, issued = null;
        boolean callbackReceived = false, tokenResponse = false, identity = false, plan = false;
        boolean retained = false, revoked = false;
        String phase = "인증 준비", outcome = "인증 실패 또는 결과 불명 · 자동 재전송 없음";
        long started = SystemClock.elapsedRealtime();
        try (SiwcLoopback loopback = new SiwcLoopback()) {
            listener = loopback;
            if (vault.load() != null) throw new IllegalStateException("disconnect previous session first");
            JSONObject metadata = registration();
            String selected = metadata.optString("client", SiwcProtocol.DYNAMIC);
            String state = SiwcProtocol.random(), nonce = SiwcProtocol.random(), verifier = SiwcProtocol.random();
            String redirect = loopback.redirect();
            String authorization = SiwcProtocol.authorization(metadata.getString("host"), selected, redirect, state, nonce, verifier);
            if (cancelled || destroyed) throw new java.util.concurrent.CancellationException();
            runOnUiThread(() -> {
                if (cancelled || destroyed) { loopback.close(); return; }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(authorization)).addCategory(Intent.CATEGORY_BROWSABLE));
                } catch (Exception ignored) { cancelled = true; loopback.close(); }
            });
            phase = "브라우저 콜백";
            show("시스템 브라우저에서 로그인 중 · 리스너 유지 · 5분 제한");
            Map<String, String> callback = loopback.await(state, started + 300000);
            callbackReceived = true;
            issued = SiwcProtocol.callbackClient(callback, state, selected);
            if (cancelled || destroyed) throw new java.util.concurrent.CancellationException();
            phase = "코드 교환";
            Map<String, String> form = new LinkedHashMap<>();
            form.put("grant_type", "authorization_code");
            form.put("client_id", issued);
            form.put("code", callback.get("code"));
            form.put("code_verifier", verifier);
            form.put("redirect_uri", redirect);
            form.put("resource", SiwcProtocol.RESOURCE);
            JSONObject tokens = new JSONObject(http.request("/api/accounts/oauth/token", form));
            tokenResponse = true;
            refresh = tokens.optString("refresh_token", "");
            phase = "공식 키 조회·ID token 검증";
            String subject = SiwcProtocol.identity(tokens.getString("id_token"),
                new JSONObject(http.request("/.well-known/jwks.json", null)), issued, nonce, System.currentTimeMillis() / 1000);
            if (metadata.has("subject") && !SiwcProtocol.equal(metadata.getString("subject"), subject))
                throw new IllegalArgumentException("account mismatch");
            identity = true;
            plan = SiwcSession.permits(tokens);
            if (!plan) throw new IllegalStateException("plan permission missing");
            if (cancelled || destroyed) throw new java.util.concurrent.CancellationException();
            phase = "토큰 보호 저장";
            write("siwc-probe-registration.json", new JSONObject().put("host", metadata.getString("host"))
                .put("client", issued).put("subject", subject));
            session.install(issued, subject, tokens, System.currentTimeMillis() / 1000);
            retained = true;
            outcome = "인증·플랜 권한 검증과 토큰 보호 저장 완료 · 번역 미실행";
        } catch (java.util.concurrent.TimeoutException ignored) {
            outcome = "로그인 시간 초과 · 새 시도가 필요해";
        } catch (Exception error) {
            outcome = phase + " 실패 또는 결과 불명 · 자동 재전송 없음";
            if (error instanceof SiwcHttp.Failure) outcome += " · HTTP " + ((SiwcHttp.Failure) error).status;
        } finally {
            listener = null;
            if (retained && (cancelled || destroyed)) {
                try { revoked = session.disconnect(); retained = false; refresh = null; }
                catch (Exception ignored) { outcome = "취소 뒤 로컬 삭제 미확인 · 연결 해제를 다시 실행해"; }
            }
            if (!retained && tokenResponse && refresh != null && !refresh.isEmpty() && issued != null) {
                try {
                    Map<String, String> form = new LinkedHashMap<>();
                    form.put("client_id", issued);
                    form.put("token", refresh);
                    form.put("token_type_hint", "refresh_token");
                    http.request("/api/accounts/oauth/revoke", form);
                    revoked = true;
                } catch (Exception ignored) { }
            }
            refresh = null;
            try {
                write("siwc-probe-result.json", new JSONObject().put("completed", true).put("callbackReceived", callbackReceived)
                    .put("tokenResponse", tokenResponse).put("identityVerified", identity).put("planGranted", plan)
                    .put("protectedSessionStored", retained).put("revocationConfirmed", revoked).put("cancelled", cancelled)
                    .put("elapsedMs", SystemClock.elapsedRealtime() - started).put("outcome", outcome));
            } catch (Exception ignored) { }
            show(outcome + "\n보호 저장=" + retained + " · 원격 철회 확인=" + revoked
                + (retained ? "\n연결은 유지돼. 복원·갱신 검증 뒤 명시적으로 연결 해제를 눌러줘." : "\n철회 미확인 시 ChatGPT 연결 관리에서 확인해."));
            enabled(true);
        }
    }

    @Override protected void onPause() {
        if (inferring) cancel();
        super.onPause();
    }
    @Override public void onBackPressed() { cancel(); super.onBackPressed(); }
    @Override protected void onDestroy() {
        destroyed = true;
        cancel();
        worker.shutdown();
        super.onDestroy();
    }
}
