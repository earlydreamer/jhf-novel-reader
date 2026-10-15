package dev.earlydreamer.jhfreader;

import org.json.JSONArray;
import org.json.JSONObject;
import javax.net.ssl.HttpsURLConnection;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** 고정 OpenAI HTTPS 경계. 재시도·리디렉션·다른 제공자 대체 없음. */
final class SiwcHttp implements SiwcSession.Auth {
    static final class Failure extends Exception {
        final int status;
        final String code;
        final JSONObject details;
        private Failure(int status, String code, JSONObject details) {
            this.status = status; this.code = SiwcResponses.safeCode(code); this.details = details;
        }
        static Failure describe(int status, String raw, String requestId) throws Exception {
            JSONObject safe = new JSONObject().put("status", status);
            String shape = raw == null ? "unreadable" : raw.isEmpty() ? "empty" : "non_json", code = "", parameter = "", type = "";
            String diagnostic = raw == null ? "" : raw;
            try {
                JSONObject body = new JSONObject(raw == null ? "" : raw);
                JSONObject error = body.optJSONObject("error");
                if (error != null) {
                    shape = "api_error_object";
                    code = error.optString("code"); parameter = error.optString("param"); type = error.optString("type");
                    diagnostic = error.optString("message");
                } else if (body.opt("detail") instanceof String) {
                    shape = "detail_string";
                    diagnostic = body.getString("detail");
                } else { shape = "other_json"; diagnostic = ""; }
            } catch (org.json.JSONException ignored) { }
            safe.put("bodyShape", shape).put("errorCode", SiwcResponses.safeCode(code))
                .put("parameter", SiwcResponses.safeParam(parameter));
            if (Arrays.asList("invalid_request_error", "authentication_error", "permission_error", "rate_limit_error", "server_error").contains(type))
                safe.put("errorType", type);
            JSONArray terms = new JSONArray();
            String lower = diagnostic.toLowerCase(java.util.Locale.ROOT);
            // 자유 문장을 복사하지 않고 고정 어휘의 존재 여부만 남긴다.
            for (String word : new String[]{"direct", "route", "routing", "serving", "enabled", "disabled", "unavailable", "unsupported",
                "region", "country", "policy", "identity", "signed", "scope", "permission", "client", "token", "expired",
                "account", "workspace", "eligible", "subscription", "usage", "quota", "model", "parameter", "required", "missing",
                "invalid", "denied", "unauthorized", "unrecognized", "cloudflare", "challenge", "not", "no", "cannot",
                "available", "integration", "agent", "registered", "allowlisted", "authorization", "signature", "audience",
                "issuer", "resource", "instructions", "input", "store", "stream", "temperature", "max_output_tokens", "previous_response_id"})
                if (java.util.regex.Pattern.compile("\\b" + word + "\\b").matcher(lower).find()) terms.put(word);
            safe.put("diagnosticTerms", terms);
            if (requestId != null && requestId.matches("req_[A-Za-z0-9_-]{8,96}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"))
                safe.put("requestId", requestId);
            return new Failure(status, code, safe);
        }
    }
    static final class Model {
        final String slug, name;
        Model(String slug, String name) { this.slug = slug; this.name = name; }
        @Override public String toString() { return name; }
    }
    private volatile HttpsURLConnection streaming;

    private static HttpsURLConnection open(String url, String access) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        configure(connection, access);
        return connection;
    }
    static void configure(HttpURLConnection connection, String access) {
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "application/json");
        if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
    }
    static void post(HttpURLConnection connection, String type, String payload) throws Exception {
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", type);
        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(body.length);
        try (java.io.OutputStream output = connection.getOutputStream()) { output.write(body); }
    }
    private static InputStream successful(HttpsURLConnection connection) throws Exception {
        int status = connection.getResponseCode();
        if (status != 200) {
            String raw = "";
            try {
                InputStream input = connection.getErrorStream();
                if (input != null) raw = read(input);
            } catch (Exception ignored) { raw = null; /* 원시 오류 본문·message는 진단에 전달하지 않는다. */ }
            throw Failure.describe(status, raw, connection.getHeaderField("x-request-id"));
        }
        return connection.getInputStream();
    }
    private static String read(InputStream input) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            for (int n; (n = stream.read(buffer)) >= 0;) {
                if (bytes.size() + n > 1048576) throw new IllegalArgumentException("HTTP response size");
                bytes.write(buffer, 0, n);
            }
            return bytes.toString("UTF-8");
        }
    }

    public String request(String path, Map<String, String> form) throws Exception {
        if (!Arrays.asList("/.well-known/jwks.json", "/api/accounts/oauth/token", "/api/accounts/oauth/revoke").contains(path))
            throw new IllegalArgumentException("auth endpoint");
        HttpsURLConnection connection = open(SiwcProtocol.ISSUER + path, null);
        try {
            if (form != null) post(connection, "application/x-www-form-urlencoded", SiwcProtocol.form(form));
            return read(successful(connection));
        } finally { connection.disconnect(); }
    }

    List<Model> models(String access) throws Exception {
        HttpsURLConnection connection = open(SiwcProtocol.RESOURCE + "/models", access);
        try {
            JSONArray models = new JSONObject(read(successful(connection))).getJSONArray("models");
            List<Model> result = new ArrayList<>();
            for (int i = 0; i < models.length(); i++) {
                JSONObject model = models.getJSONObject(i);
                if (!"list".equals(model.optString("visibility"))) continue;
                String slug = model.getString("slug"), name = model.getString("display_name");
                if (!slug.matches("[A-Za-z0-9._:/-]{1,160}") || name.isEmpty() || name.length() > 160
                    || name.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new IllegalArgumentException("model catalog");
                result.add(new Model(slug, name));
            }
            return result;
        } finally { connection.disconnect(); }
    }

    SiwcResponses.Result translate(String access, String model, BooleanSupplier cancelled, Consumer<String> delta) throws Exception {
        HttpsURLConnection connection = open(SiwcProtocol.RESOURCE + "/responses", access);
        streaming = connection;
        long started = android.os.SystemClock.elapsedRealtime();
        try {
            if (cancelled.getAsBoolean()) throw new java.util.concurrent.CancellationException();
            connection.setRequestProperty("Accept", "text/event-stream");
            post(connection, "application/json", SiwcResponses.body(model).toString());
            try (InputStream input = successful(connection)) {
                String type = connection.getContentType();
                if (type == null || !type.toLowerCase(java.util.Locale.ROOT).startsWith("text/event-stream"))
                    throw new IllegalArgumentException("not SSE");
                return SiwcResponses.consume(new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8)),
                    cancelled, delta, started);
            }
        } finally { streaming = null; connection.disconnect(); }
    }

    void cancelInference() {
        HttpsURLConnection active = streaming;
        if (active != null) active.disconnect();
    }
}
