package dev.earlydreamer.jhfreader;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.Reader;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Responses SSE 전용. delta나 EOF를 완료 응답으로 승격하지 않는다. */
final class SiwcResponses {
    static final class ProtocolFailure extends IllegalArgumentException {
        final JSONObject details;
        ProtocolFailure(String reason, JSONObject details) { super(reason); this.details = details; }
    }
    static JSONObject guard(Exception error) throws Exception {
        JSONObject result = new JSONObject();
        String message = error.getMessage();
        String[] messages = {"model slug", "stream size", "SSE line size", "event mismatch", "text size", "final text size",
            "completed status mismatch", "completed response mismatch", "not SSE"};
        String[] codes = {"model_slug", "stream_limit", "line_limit", "event_mismatch", "delta_text_limit", "final_text_limit",
            "completed_status", "completed_id", "content_type"};
        String reason = "unclassified";
        for (int i = 0; i < messages.length; i++) if (messages[i].equals(message)) reason = codes[i];
        result.put("reason", reason);
        if (error instanceof ProtocolFailure) result.put("details", ((ProtocolFailure) error).details);
        for (StackTraceElement frame : error.getStackTrace()) {
            String prefix = "dev.earlydreamer.jhfreader.";
            if (!frame.getClassName().startsWith(prefix)) continue;
            String component = frame.getClassName().substring(prefix.length());
            if (!java.util.Arrays.asList("SiwcHttp", "SiwcResponses", "SiwcSession", "SiwcVault", "SiwcProbeActivity", "SiwcLoopback", "SiwcProtocol").contains(component)) continue;
            result.put("component", component).put("method", frame.getMethodName()).put("line", frame.getLineNumber());
            break;
        }
        return result;
    }
    private static String eventName(String event) {
        return java.util.Arrays.asList("message", "error", "response.created", "response.in_progress", "response.completed",
            "response.failed", "response.incomplete", "response.output_text.delta", "response.output_text.done",
            "response.output_item.added", "response.output_item.done", "response.content_part.added", "response.content_part.done")
            .contains(event) ? event : "other";
    }
    static String safeCode(String code) {
        return java.util.Arrays.asList("subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable",
            "subscription_sharing_user_not_eligible", "subscription_sharing_unsupported_capability", "subscription_sharing_route_not_supported",
            "subscription_sharing_invalid_user", "subscription_sharing_user_unavailable", "chatpass_v2_scope_not_authorized",
            "chatpass_v2_invalid_authorization_context", "invalid_grant", "invalid_refresh_token", "token_expired",
            "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused", "invalid_client",
            "rate_limit_exceeded", "insufficient_quota", "model_not_found", "invalid_request_error", "invalid_api_key",
            "permission_denied", "authentication_error", "unsupported_parameter", "server_error", "access_denied")
            .contains(code) ? code : "unclassified";
    }
    static String safeParam(String parameter) {
        return java.util.Arrays.asList("model", "input", "instructions", "store", "stream", "temperature", "top_p",
            "max_output_tokens", "previous_response_id", "service_tier", "reasoning", "tools", "include", "client_id",
            "resource", "scope", "grant_type").contains(parameter) ? parameter : "unclassified";
    }
    static final class Failure extends Exception {
        final String event, code, parameter;
        Failure(String event, String code) { this(event, code, ""); }
        Failure(String event, String code, String parameter) {
            this.event = event; this.code = safeCode(code); this.parameter = safeParam(parameter);
        }
    }
    static final String SYNTHETIC = "朝の図書館は静かだった。窓から柔らかな光が差し込んでいた。";
    static JSONObject body(String model) throws Exception {
        if (!model.matches("[A-Za-z0-9._:/-]{1,160}")) throw new IllegalArgumentException("model slug");
        return new JSONObject().put("model", model).put("store", false).put("stream", true)
            .put("instructions", "다음 일본어 합성 문단을 자연스러운 한국어로 번역해. 번역문만 출력해.")
            .put("input", new JSONArray().put(new JSONObject().put("role", "user").put("content", SYNTHETIC)));
    }

    static final class Result {
        final String text;
        final long firstMs, totalMs, inputTokens, outputTokens;
        Result(String text, long first, long total, long input, long output) {
            this.text = text; firstMs = first; totalMs = total; inputTokens = input; outputTokens = output;
        }
    }

    private static String line(Reader input, int[] budget) throws Exception {
        StringBuilder value = new StringBuilder();
        for (;;) {
            int ch = input.read();
            if (ch < 0) return value.length() == 0 ? null : value.toString();
            if (--budget[0] < 0) throw new ProtocolFailure("stream size", new JSONObject().put("charsRead", 2097152 - budget[0]));
            if (value.length() > 131072) throw new ProtocolFailure("SSE line size", new JSONObject().put("lineChars", value.length()));
            if (ch == '\n') return value.toString();
            if (ch != '\r') value.append((char) ch);
        }
    }

    static Result consume(Reader input, BooleanSupplier cancelled, Consumer<String> delta, long started) throws Exception {
        StringBuilder data = new StringBuilder(), partial = new StringBuilder();
        String event = "", responseId = null;
        int[] budget = {2097152};
        long first = -1;
        int frames = 0;
        for (;;) {
            if (cancelled.getAsBoolean()) throw new java.util.concurrent.CancellationException();
            if (android.os.SystemClock.elapsedRealtime() - started > 120000) throw new java.util.concurrent.TimeoutException();
            String line = line(input, budget);
            if (line == null) throw new Failure("stream_eof", "");
            if (line.startsWith("event:")) event = line.substring(6).trim();
            else if (line.startsWith("data:")) {
                if (data.length() > 0) data.append('\n');
                data.append(line.substring(5).trim());
            } else if (line.isEmpty() && data.length() > 0) {
                String payload = data.toString();
                data.setLength(0);
                if ("[DONE]".equals(payload)) throw new Failure("done_without_completed", "");
                JSONObject frame = new JSONObject(payload);
                String type = frame.getString("type");
                frames++;
                if (!event.isEmpty() && !event.equals(type)) throw new ProtocolFailure("event mismatch", new JSONObject()
                    .put("sseEvent", eventName(event)).put("dataType", eventName(type)).put("frames", frames)
                    .put("charsRead", 2097152 - budget[0]));
                event = "";
                if ("response.created".equals(type)) responseId = frame.getJSONObject("response").getString("id");
                else if ("response.output_text.delta".equals(type)) {
                    if (first < 0) first = android.os.SystemClock.elapsedRealtime() - started;
                    partial.append(frame.getString("delta"));
                    if (partial.length() > 32768) throw new ProtocolFailure("text size", new JSONObject().put("textChars", partial.length()).put("frames", frames));
                    delta.accept(partial.toString());
                } else if ("response.failed".equals(type) || "response.incomplete".equals(type) || "error".equals(type)) {
                    JSONObject response = frame.optJSONObject("response");
                    JSONObject error = response == null ? frame.optJSONObject("error") : response.optJSONObject("error");
                    throw new Failure(type, error == null ? frame.optString("code") : error.optString("code"),
                        error == null ? frame.optString("param") : error.optString("param"));
                } else if ("response.completed".equals(type)) {
                    JSONObject response = frame.getJSONObject("response");
                    if (!"completed".equals(response.getString("status"))) throw new ProtocolFailure("completed status mismatch", new JSONObject().put("frames", frames));
                    if (responseId != null && !responseId.equals(response.getString("id")))
                        throw new ProtocolFailure("completed response mismatch", new JSONObject().put("frames", frames).put("idsMatch", false));
                    StringBuilder text = new StringBuilder();
                    JSONArray output = response.getJSONArray("output");
                    for (int i = 0; i < output.length(); i++) {
                        JSONObject item = output.getJSONObject(i);
                        if (!"message".equals(item.optString("type")) || !"assistant".equals(item.optString("role"))) continue;
                        JSONArray content = item.getJSONArray("content");
                        for (int j = 0; j < content.length(); j++) {
                            JSONObject part = content.getJSONObject(j);
                            if ("output_text".equals(part.optString("type"))) text.append(part.getString("text"));
                            if (text.length() > 32768) throw new ProtocolFailure("final text size", new JSONObject().put("textChars", text.length()).put("frames", frames));
                        }
                    }
                    if (text.toString().trim().isEmpty() || cancelled.getAsBoolean())
                        throw new IllegalStateException("no completed translation");
                    JSONObject usage = response.optJSONObject("usage");
                    return new Result(text.toString(), first, android.os.SystemClock.elapsedRealtime() - started,
                        usage == null ? -1 : Math.max(-1, usage.optLong("input_tokens", -1)),
                        usage == null ? -1 : Math.max(-1, usage.optLong("output_tokens", -1)));
                }
            } else if (line.isEmpty()) event = "";
        }
    }
}
