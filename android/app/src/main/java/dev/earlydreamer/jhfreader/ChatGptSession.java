package dev.earlydreamer.jhfreader;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.LongSupplier;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * ChatGPT 계정 세션. 교환·갱신·철회를 같은 잠금으로 직렬화한다. 토큰은 Store에만 두고 호출자에게 access token만 준다.
 * 등록 정보(host ID·발급 client ID·검증된 계정)는 세션과 따로 보관해 연결 해제 뒤에도 같은 등록을 다시 쓴다.
 */
final class ChatGptSession {
    interface Store {
        JSONObject load() throws Exception;
        void save(JSONObject value) throws Exception;
        void clear() throws Exception;
    }

    static final class Response {
        final int status;
        final String body;
        Response(int status, String body) { this.status = status; this.body = body == null ? "" : body; }
    }

    interface Http {
        /** 응답을 받지 못하면 예외를 던진다. 받은 응답은 상태 코드와 함께 돌려준다. */
        Response form(String url, Map<String, String> fields) throws Exception;
        Response get(String url) throws Exception;
    }

    /** 다시 로그인해야 한다. reason: missing·expired·unknown. */
    static final class Reconnect extends Exception {
        final String reason;
        Reconnect(String reason) { super(reason); this.reason = reason; }
    }

    /** 계정에 플랜 사용 권한이 없다. */
    static final class NotEligible extends Exception {
        NotEligible() { super("not_eligible"); }
    }

    /** 서버가 응답했지만 처리하지 못했다. 토큰은 유지한다. */
    static final class Temporary extends Exception {
        final int status;
        Temporary(int status) { super("temporary"); this.status = status; }
    }

    /** 로그인 결과를 저장하지 못했다. reason은 고정 어휘다. */
    static final class Failed extends Exception {
        final String reason;
        Failed(String reason) { super(reason); this.reason = reason; }
    }

    static final class Begin {
        final String hostId;
        final String client;
        Begin(String hostId, String client) { this.hostId = hostId; this.client = client; }
    }

    /** 만료 5분 전부터 갱신한다. */
    static final long REFRESH_MARGIN_MS = 5 * 60 * 1000L;
    private static final Object LOCK = new Object();

    private final Store session;
    private final Store registration;
    private final Http http;
    private final LongSupplier clock;

    ChatGptSession(Store session, Store registration, Http http, LongSupplier clock) {
        this.session = session;
        this.registration = registration;
        this.http = http;
        this.clock = clock;
    }

    /** connected: 번역에 쓸 수 있음, reconnect: 다시 로그인해야 함, disconnected: 연결 없음. */
    String status() throws Exception {
        synchronized (LOCK) {
            JSONObject value = session.load();
            if (value == null) return "disconnected";
            return "ready".equals(value.optString("phase")) ? "connected" : "reconnect";
        }
    }

    /** 새 로그인을 준비한다. 사용 중인 연결이 있으면 먼저 해제해야 한다. */
    Begin begin() throws Exception {
        synchronized (LOCK) {
            JSONObject current = session.load();
            if (current != null && "ready".equals(current.optString("phase")))
                throw new Failed("already_connected");
            JSONObject value = registration.load();
            if (value == null) {
                value = new JSONObject().put("hostId", ChatGptProtocol.hostId());
                registration.save(value);
            }
            String client = value.optString("client", "");
            return new Begin(value.getString("hostId"),
                ChatGptProtocol.issuedClient(client) ? client : ChatGptProtocol.DYNAMIC);
        }
    }

    /**
     * 인가 코드를 교환하고 ID token을 검증한 뒤 세션을 저장한다. 교환 POST는 결과를 몰라도 다시 보내지 않는다.
     * 검증에 실패하거나 플랜 권한이 없으면 받은 refresh token을 철회하고 저장하지 않는다.
     */
    void complete(String client, String code, String verifier, String redirect, String nonce)
        throws Exception {
        synchronized (LOCK) {
            Map<String, String> fields = new LinkedHashMap<>();
            fields.put("grant_type", "authorization_code");
            fields.put("client_id", client);
            fields.put("code", code);
            fields.put("code_verifier", verifier);
            fields.put("redirect_uri", redirect);
            fields.put("resource", ChatGptProtocol.RESOURCE);
            Response exchanged;
            try {
                exchanged = http.form(ChatGptProtocol.TOKEN, fields);
            } catch (Exception unknown) {
                throw new Failed("exchange_unknown");
            }
            if (exchanged.status != 200) throw new Failed("exchange");
            JSONObject tokens;
            try {
                tokens = new JSONObject(exchanged.body);
            } catch (JSONException invalid) {
                throw new Failed("exchange");
            }
            String refresh = tokens.optString("refresh_token");
            try {
                if (tokens.optString("access_token").isEmpty() || refresh.isEmpty()
                    || !"bearer".equalsIgnoreCase(tokens.optString("token_type", "Bearer")))
                    throw new Failed("tokens");
                long expires = tokens.optLong("expires_in", 0);
                if (expires <= 0 || expires > 604800) throw new Failed("tokens");
                Response keys = http.get(ChatGptProtocol.JWKS);
                if (keys.status != 200) throw new Failed("identity");
                String subject;
                try {
                    subject = ChatGptProtocol.identity(tokens.optString("id_token", null),
                        new JSONObject(keys.body), client, nonce, clock.getAsLong() / 1000);
                } catch (ChatGptProtocol.Invalid | JSONException invalid) {
                    throw new Failed("identity");
                }
                JSONObject saved = registration.load();
                if (saved == null) throw new Failed("registration");
                String previous = saved.optString("subject", "");
                if (!previous.isEmpty() && !ChatGptProtocol.equal(previous, subject))
                    throw new Failed("account_mismatch");
                if (!ChatGptProtocol.permits(tokens)) throw new NotEligible();
                registration.save(saved.put("client", client).put("subject", subject));
                // 다시 로그인해야 했던 이전 세션은 철회를 시도한 뒤 새 세션으로 바꾼다.
                JSONObject stale = session.load();
                if (stale != null) revoke(stale.optString("client"), stale.optString("refresh_token"));
                session.clear();
                session.save(new JSONObject()
                    .put("client", client)
                    .put("access_token", tokens.getString("access_token"))
                    .put("refresh_token", refresh)
                    .put("scope", tokens.optString("scope"))
                    .put("expiresAt", clock.getAsLong() + expires * 1000)
                    .put("phase", "ready"));
            } catch (Exception rejected) {
                if (!refresh.isEmpty()) revoke(client, refresh);
                throw rejected;
            }
        }
    }

    /** 요청에 붙일 access token. 만료가 가까우면 먼저 갱신한다. */
    String access() throws Exception {
        synchronized (LOCK) {
            JSONObject value = session.load();
            if (value == null) throw new Reconnect("missing");
            if (!"ready".equals(value.optString("phase"))) throw new Reconnect("unknown");
            if (!ChatGptProtocol.permits(value)) throw new NotEligible();
            if (value.getLong("expiresAt") - clock.getAsLong() > REFRESH_MARGIN_MS)
                return value.getString("access_token");
            return refresh(value).getString("access_token");
        }
    }

    private JSONObject refresh(JSONObject old) throws Exception {
        // 회전 결과를 모르는 refresh token은 다시 쓰지 않는다. 프로세스가 끝나도 표식이 남는다.
        session.save(new JSONObject(old.toString()).put("phase", "refreshing"));
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("grant_type", "refresh_token");
        fields.put("client_id", old.getString("client"));
        fields.put("refresh_token", old.getString("refresh_token"));
        fields.put("resource", ChatGptProtocol.RESOURCE);
        Response response;
        try {
            response = http.form(ChatGptProtocol.TOKEN, fields);
        } catch (Exception unknown) {
            throw new Reconnect("unknown");
        }
        if (response.status != 200) {
            String code = "";
            try {
                code = new JSONObject(response.body).optString("error");
            } catch (JSONException ignored) {
                // 형식이 다른 오류는 상태 코드로 판정한다.
            }
            if (ChatGptProtocol.TERMINAL_REFRESH.contains(code)) {
                session.clear();
                throw new Reconnect("expired");
            }
            if (response.status >= 500) {
                // 서버가 처리하지 못했다고 답했으므로 회전하지 않은 것으로 보고 기존 토큰을 유지한다.
                session.save(old);
                throw new Temporary(response.status);
            }
            session.clear();
            throw new Reconnect("expired");
        }
        JSONObject next;
        try {
            next = new JSONObject(response.body);
        } catch (JSONException invalid) {
            throw new Reconnect("unknown");
        }
        long expires = next.optLong("expires_in", 0);
        if (next.optString("access_token").isEmpty() || expires <= 0 || expires > 604800)
            throw new Reconnect("unknown");
        JSONObject value = new JSONObject(old.toString())
            .put("access_token", next.getString("access_token"))
            .put("refresh_token", next.optString("refresh_token", old.getString("refresh_token")))
            .put("scope", next.has("scope") ? next.getString("scope") : old.optString("scope"))
            .put("expiresAt", clock.getAsLong() + expires * 1000)
            .put("phase", "ready");
        session.save(value);
        if (!ChatGptProtocol.permits(value)) throw new NotEligible();
        return value;
    }

    /** 응답이 연결 해제를 확인했을 때 저장한 세션을 지운다. 일시 오류로는 지우지 않는다. */
    void forget() throws Exception {
        synchronized (LOCK) {
            session.clear();
        }
    }

    /** 원격 철회를 시도한 뒤 로컬 세션을 지운다. 결과는 [revoked, hadSession]. */
    boolean[] disconnect() throws Exception {
        synchronized (LOCK) {
            JSONObject value = session.load();
            if (value == null) return new boolean[] {false, false};
            // 철회 도중 앱이 끝나도 번역에 다시 쓰지 않는다.
            session.save(new JSONObject(value.toString()).put("phase", "revoking"));
            boolean revoked = revoke(value.getString("client"), value.getString("refresh_token"));
            session.clear();
            return new boolean[] {revoked, true};
        }
    }

    /** 네트워크 실패·5xx는 짧게 물러난 뒤 두 번까지 다시 시도한다. 빈 200이 철회 확인이다. */
    private boolean revoke(String client, String refresh) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("token", refresh);
        fields.put("token_type_hint", "refresh_token");
        fields.put("client_id", client);
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                Response response = http.form(ChatGptProtocol.REVOKE, fields);
                if (response.status == 200) return true;
                if (response.status < 500) return false;
            } catch (Exception retry) {
                // 아래에서 물러난 뒤 다시 시도한다.
            }
            try {
                Thread.sleep(500L << attempt);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
}
