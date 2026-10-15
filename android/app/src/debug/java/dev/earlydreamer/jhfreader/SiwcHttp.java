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
        Failure(int status) { this.status = status; }
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
        if (status != 200) throw new Failure(status);
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
