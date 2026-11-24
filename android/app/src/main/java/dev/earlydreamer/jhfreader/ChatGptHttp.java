package dev.earlydreamer.jhfreader;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import javax.net.ssl.HttpsURLConnection;

/** 고정된 OpenAI HTTPS 주소만 연다. 리디렉션·캐시·쿠키·자동 재전송·다른 제공자 대체가 없다. */
final class ChatGptHttp implements ChatGptSession.Http {
    private static final List<String> FORM_URLS = Arrays.asList(
        ChatGptProtocol.TOKEN, ChatGptProtocol.REVOKE);
    private static final List<String> GET_URLS = Arrays.asList(ChatGptProtocol.JWKS);
    private static final int MAX_BODY = 1_048_576;
    private static final int MAX_STREAM_CHARS = 16_000_000;
    private static final int MAX_LINE_CHARS = 1_000_000;

    private static HttpsURLConnection open(String url, String access) throws IOException {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Cookie", "");
        if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
        return connection;
    }

    private static void post(HttpURLConnection connection, String type, String payload) throws IOException {
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", type);
        byte[] body = payload.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(body.length);
        try (OutputStream output = connection.getOutputStream()) { output.write(body); }
    }

    private static String read(InputStream input) throws IOException {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            for (int n; (n = stream.read(buffer)) >= 0;) {
                if (bytes.size() + n > MAX_BODY) throw new IOException("response size");
                bytes.write(buffer, 0, n);
            }
            return bytes.toString("UTF-8");
        }
    }

    private static ChatGptSession.Response settle(HttpsURLConnection connection) throws IOException {
        int status = connection.getResponseCode();
        InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        return new ChatGptSession.Response(status, read(input));
    }

    @Override public ChatGptSession.Response form(String url, Map<String, String> fields) throws Exception {
        if (!FORM_URLS.contains(url)) throw new IllegalArgumentException("auth endpoint");
        HttpsURLConnection connection = open(url, null);
        try {
            post(connection, "application/x-www-form-urlencoded", ChatGptProtocol.form(fields));
            return settle(connection);
        } finally {
            connection.disconnect();
        }
    }

    @Override public ChatGptSession.Response get(String url) throws Exception {
        if (!GET_URLS.contains(url)) throw new IllegalArgumentException("auth endpoint");
        HttpsURLConnection connection = open(url, null);
        try {
            return settle(connection);
        } finally {
            connection.disconnect();
        }
    }

    ChatGptSession.Response models(String access) throws Exception {
        HttpsURLConnection connection = open(ChatGptProtocol.MODELS, access);
        try {
            return settle(connection);
        } finally {
            connection.disconnect();
        }
    }

    /**
     * Responses 스트림. 줄 단위로 넘기고, 끝나면 상태 코드와 함께 돌려준다. 오류 본문은 허용 어휘만 남긴다.
     * 서버가 Content-Type을 주지 않는 경우가 있어 형식 판정은 본문 해석에 맡긴다.
     */
    ChatGptSession.Response stream(String access, String body, BooleanSupplier cancelled,
                                   Consumer<HttpURLConnection> started, Consumer<String> line)
        throws Exception {
        HttpsURLConnection connection = open(ChatGptProtocol.RESPONSES, access);
        started.accept(connection);
        try {
            // 첫 바이트·다음 줄을 120초 넘게 못 받으면 멈춘 요청으로 본다.
            connection.setReadTimeout(120000);
            connection.setRequestProperty("Accept", "text/event-stream");
            if (cancelled.getAsBoolean()) throw new InterruptedException();
            post(connection, "application/json", body);
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) {
                String raw;
                try {
                    raw = read(connection.getErrorStream());
                } catch (IOException unreadable) {
                    raw = "";
                }
                return new ChatGptSession.Response(status, ChatGptProtocol.errorSummary(raw).toString());
            }
            StringBuilder all = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                ModelStreamPlugin.BoundedLineReader lines = new ModelStreamPlugin.BoundedLineReader(reader);
                String value;
                while ((value = lines.readLine(
                    Math.min(MAX_LINE_CHARS, MAX_STREAM_CHARS - all.length() - 1))) != null) {
                    if (cancelled.getAsBoolean()) throw new InterruptedException();
                    all.append(value).append('\n');
                    line.accept(value + "\n");
                }
            }
            if (cancelled.getAsBoolean()) throw new InterruptedException();
            return new ChatGptSession.Response(status, all.toString());
        } finally {
            connection.disconnect();
        }
    }
}
