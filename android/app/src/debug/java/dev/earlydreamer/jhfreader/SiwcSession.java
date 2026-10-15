package dev.earlydreamer.jhfreader;

import org.json.JSONObject;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/** 단일 프로세스 debug 앱의 교환·회전·철회를 같은 잠금으로 직렬화한다. */
final class SiwcSession {
    static final Object LOCK = new Object();
    interface Auth { String request(String path, Map<String, String> form) throws Exception; }
    private final SiwcVault vault;
    private final Auth auth;

    SiwcSession(SiwcVault vault, Auth auth) { this.vault = vault; this.auth = auth; }

    static boolean permits(JSONObject tokens) {
        return Arrays.asList(tokens.optString("scope", "").split(" +")).contains("chatgpt.tokens.use.direct")
            && "Bearer".equalsIgnoreCase(tokens.optString("token_type"))
            && !tokens.optString("access_token").isEmpty();
    }

    void install(String client, String subject, JSONObject tokens, long now) throws Exception {
        synchronized (LOCK) {
            JSONObject old = vault.load();
            if (old != null) throw new IllegalStateException("disconnect existing session first");
            if (!permits(tokens) || tokens.optString("refresh_token").isEmpty())
                throw new IllegalArgumentException("plan session missing");
            long expires = tokens.getLong("expires_in");
            if (expires <= 0 || expires > 604800) throw new IllegalArgumentException("expiry");
            JSONObject value = new JSONObject(tokens.toString()).put("client", client).put("subject", subject)
                .put("expiresAt", now + expires).put("phase", "ready").put("inferenceAttempted", false);
            vault.save(value);
        }
    }

    JSONObject restore(String client, String subject) throws Exception {
        synchronized (LOCK) {
            JSONObject value = vault.load();
            if (value == null) throw new IllegalStateException("not connected");
            if (!client.equals(value.getString("client")) || !SiwcProtocol.equal(subject, value.getString("subject")))
                throw new IllegalStateException("account mismatch");
            if (!"ready".equals(value.getString("phase"))) throw new IllegalStateException("reauthorization required");
            return value;
        }
    }

    JSONObject fresh(String client, String subject, long now, boolean force) throws Exception {
        synchronized (LOCK) {
            JSONObject old = restore(client, subject);
            if (!force && old.getLong("expiresAt") > now + 60) return old;
            // 회전 결과가 불명인 refresh token을 재사용하지 않는다. 프로세스 종료 뒤에도 표식을 유지한다.
            vault.save(new JSONObject(old.toString()).put("phase", "refreshing"));
            Map<String, String> form = new LinkedHashMap<>();
            form.put("grant_type", "refresh_token");
            form.put("client_id", client);
            form.put("refresh_token", old.getString("refresh_token"));
            form.put("resource", SiwcProtocol.RESOURCE);
            JSONObject next = new JSONObject(auth.request("/api/accounts/oauth/token", form));
            if (!next.has("scope")) next.put("scope", old.getString("scope"));
            if (!next.has("refresh_token")) next.put("refresh_token", old.getString("refresh_token"));
            if (!permits(next) || next.optString("refresh_token").isEmpty()) throw new IllegalArgumentException("refresh grant");
            long expires = next.getLong("expires_in");
            if (expires <= 0 || expires > 604800) throw new IllegalArgumentException("refresh expiry");
            // 새 회전 토큰을 검증 전에도 보호 저장하여, 검증 실패 시 명시적 철회에만 사용한다.
            JSONObject pending = new JSONObject(old.toString()).put("phase", "refreshing")
                .put("access_token", next.getString("access_token")).put("refresh_token", next.getString("refresh_token"));
            vault.save(pending);
            if (next.has("id_token")) {
                String verified = SiwcProtocol.identity(next.getString("id_token"),
                    new JSONObject(auth.request("/.well-known/jwks.json", null)), client, null, now);
                if (!SiwcProtocol.equal(subject, verified)) throw new IllegalArgumentException("refreshed account mismatch");
            } else { next.put("id_token", old.getString("id_token")); }
            next.put("client", client).put("subject", subject).put("expiresAt", now + expires)
                .put("phase", "ready").put("inferenceAttempted", old.getBoolean("inferenceAttempted"));
            vault.save(next);
            return next;
        }
    }

    void markInference(String client, String subject) throws Exception {
        synchronized (LOCK) {
            JSONObject value = restore(client, subject);
            if (value.getBoolean("inferenceAttempted")) throw new IllegalStateException("inference already attempted");
            vault.save(value.put("inferenceAttempted", true));
        }
    }

    boolean disconnect() throws Exception {
        synchronized (LOCK) {
            JSONObject value = vault.load();
            if (value == null) return false;
            // 철회 도중 종료돼도 추론에 복귀하지 않는다.
            vault.save(new JSONObject(value.toString()).put("phase", "revoking"));
            boolean revoked = false;
            try {
                Map<String, String> form = new LinkedHashMap<>();
                form.put("client_id", value.getString("client"));
                form.put("token", value.getString("refresh_token"));
                form.put("token_type_hint", "refresh_token");
                auth.request("/api/accounts/oauth/revoke", form);
                revoked = true;
            } catch (Exception ignored) { /* 원격 철회 미확인을 반환값으로 구분한다. */ }
            vault.clear();
            return revoked;
        }
    }
}
