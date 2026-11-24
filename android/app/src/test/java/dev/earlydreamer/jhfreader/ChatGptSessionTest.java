package dev.earlydreamer.jhfreader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.security.KeyPair;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

public class ChatGptSessionTest {
    private static final String CLIENT = "oaiapp_client123";
    private static final String SCOPE = "openid offline_access chatgpt.tokens.use.direct";

    static final class Memory implements ChatGptSession.Store {
        JSONObject value;
        @Override public JSONObject load() throws Exception {
            return value == null ? null : new JSONObject(value.toString());
        }
        @Override public void save(JSONObject next) throws Exception { value = new JSONObject(next.toString()); }
        @Override public void clear() { value = null; }
    }

    /** 순서대로 응답한다. null은 응답을 받지 못한 경우다. */
    static final class Fake implements ChatGptSession.Http {
        final Deque<ChatGptSession.Response> forms = new ArrayDeque<>();
        final List<String> urls = new ArrayList<>();
        final List<Map<String, String>> bodies = new ArrayList<>();
        String jwks;
        @Override public ChatGptSession.Response form(String url, Map<String, String> fields) throws Exception {
            urls.add(url);
            bodies.add(fields);
            ChatGptSession.Response next = forms.poll();
            if (next == null) throw new java.io.IOException("no response");
            return next;
        }
        @Override public ChatGptSession.Response get(String url) {
            urls.add(url);
            return new ChatGptSession.Response(200, jwks);
        }
    }

    private Memory session;
    private Memory registration;
    private Fake http;
    private long now;
    private KeyPair pair;
    private ChatGptSession account;

    @Before public void setUp() throws Exception {
        session = new Memory();
        registration = new Memory();
        http = new Fake();
        now = 1_800_000_000_000L;
        pair = ChatGptProtocolTest.rsa();
        http.jwks = ChatGptProtocolTest.jwks(pair, "k1").toString();
        account = new ChatGptSession(session, registration, http, () -> now);
    }

    private String idToken(String subject) throws Exception {
        return ChatGptProtocolTest.jwt(pair, "k1", new JSONObject().put("iss", ChatGptProtocol.ISSUER)
            .put("aud", CLIENT).put("sub", subject).put("exp", now / 1000 + 600)
            .put("iat", now / 1000).put("nonce", "n"));
    }

    private ChatGptSession.Response tokens(String access, String refresh, String scope, String subject)
        throws Exception {
        JSONObject value = new JSONObject().put("access_token", access).put("token_type", "Bearer")
            .put("expires_in", 3600).put("scope", scope);
        if (refresh != null) value.put("refresh_token", refresh);
        if (subject != null) value.put("id_token", idToken(subject));
        return new ChatGptSession.Response(200, value.toString());
    }

    private void connect() throws Exception {
        ChatGptSession.Begin begin = account.begin();
        assertEquals(ChatGptProtocol.DYNAMIC, begin.client);
        http.forms.add(tokens("a1", "r1", SCOPE, "user-1"));
        account.complete(CLIENT, "code", "verifier", "http://127.0.0.1:1/auth/callback", "n");
    }

    @Test public void signInStoresSessionAndReusesIssuedClient() throws Exception {
        connect();
        assertEquals("connected", account.status());
        assertEquals("a1", account.access());
        assertEquals("authorization_code", http.bodies.get(0).get("grant_type"));
        assertEquals("verifier", http.bodies.get(0).get("code_verifier"));
        assertEquals(ChatGptProtocol.RESOURCE, http.bodies.get(0).get("resource"));
        assertEquals(CLIENT, registration.value.getString("client"));
        assertThrows(ChatGptSession.Failed.class, () -> account.begin());
        String host = registration.value.getString("hostId");

        http.forms.add(new ChatGptSession.Response(200, ""));
        assertTrue(account.disconnect()[0]);
        ChatGptSession.Begin again = account.begin();
        assertEquals(CLIENT, again.client);
        assertEquals(host, again.hostId);
    }

    @Test public void missingPlanScopeRevokesWithoutSaving() throws Exception {
        account.begin();
        http.forms.add(tokens("a1", "r1", "openid offline_access", "user-1"));
        http.forms.add(new ChatGptSession.Response(200, ""));
        assertThrows(ChatGptSession.NotEligible.class, () ->
            account.complete(CLIENT, "code", "v", "http://127.0.0.1:1/auth/callback", "n"));
        assertNull(session.value);
        assertEquals(ChatGptProtocol.REVOKE, http.urls.get(http.urls.size() - 1));
        assertEquals("r1", http.bodies.get(http.bodies.size() - 1).get("token"));
        assertEquals("disconnected", account.status());
    }

    @Test public void differentAccountOnReturningClientIsRejectedAndRevoked() throws Exception {
        connect();
        http.forms.add(new ChatGptSession.Response(200, ""));
        account.disconnect();
        account.begin();
        http.forms.add(tokens("a2", "r2", SCOPE, "user-2"));
        http.forms.add(new ChatGptSession.Response(200, ""));
        ChatGptSession.Failed error = assertThrows(ChatGptSession.Failed.class, () ->
            account.complete(CLIENT, "code", "v", "http://127.0.0.1:1/auth/callback", "n"));
        assertEquals("account_mismatch", error.reason);
        assertNull(session.value);
    }

    @Test public void unknownExchangeIsNotResent() throws Exception {
        account.begin();
        ChatGptSession.Failed error = assertThrows(ChatGptSession.Failed.class, () ->
            account.complete(CLIENT, "code", "v", "http://127.0.0.1:1/auth/callback", "n"));
        assertEquals("exchange_unknown", error.reason);
        assertEquals(1, http.urls.size());
        assertNull(session.value);
    }

    @Test public void refreshRotatesTokensNearExpiry() throws Exception {
        connect();
        now += 3600_000L - ChatGptSession.REFRESH_MARGIN_MS + 1;
        http.forms.add(tokens("a2", "r2", SCOPE, null));
        assertEquals("a2", account.access());
        Map<String, String> refresh = http.bodies.get(http.bodies.size() - 1);
        assertEquals("refresh_token", refresh.get("grant_type"));
        assertEquals("r1", refresh.get("refresh_token"));
        assertEquals(CLIENT, refresh.get("client_id"));
        assertFalse(refresh.containsKey("scope"));
        assertEquals("r2", session.value.getString("refresh_token"));
        assertEquals("a2", account.access());
    }

    @Test public void unknownRefreshRequiresReconnectWithoutReusingOldToken() throws Exception {
        connect();
        now += 3600_000L;
        int before = http.urls.size();
        ChatGptSession.Reconnect error = assertThrows(ChatGptSession.Reconnect.class, () -> account.access());
        assertEquals("unknown", error.reason);
        assertEquals("reconnect", account.status());
        assertThrows(ChatGptSession.Reconnect.class, () -> account.access());
        assertEquals(before + 1, http.urls.size());
    }

    @Test public void terminalRefreshErrorClearsSessionButServerErrorKeepsIt() throws Exception {
        connect();
        now += 3600_000L;
        http.forms.add(new ChatGptSession.Response(503, "{}"));
        assertThrows(ChatGptSession.Temporary.class, () -> account.access());
        assertEquals("connected", account.status());
        assertEquals("r1", session.value.getString("refresh_token"));

        http.forms.add(new ChatGptSession.Response(400, "{\"error\":\"refresh_token_reused\"}"));
        ChatGptSession.Reconnect error = assertThrows(ChatGptSession.Reconnect.class, () -> account.access());
        assertEquals("expired", error.reason);
        assertNull(session.value);
        assertEquals("disconnected", account.status());
    }

    @Test public void disconnectReportsUnconfirmedRevocationAndStillClears() throws Exception {
        connect();
        http.forms.add(new ChatGptSession.Response(400, "{}"));
        boolean[] result = account.disconnect();
        assertFalse(result[0]);
        assertTrue(result[1]);
        assertNull(session.value);
        assertThrows(ChatGptSession.Reconnect.class, () -> account.access());
        boolean[] none = account.disconnect();
        assertFalse(none[1]);
    }
}
