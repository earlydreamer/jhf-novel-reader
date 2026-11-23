package dev.earlydreamer.jhfreader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class ChatGptProtocolTest {
    private static final String CLIENT = "oaiapp_client123";
    private static final String HOST = "urn:uuid:123e4567-e89b-12d3-a456-426614174000";
    private static final long NOW = 1_800_000_000L;

    @Test public void base64UrlMatchesJdkWithoutPadding() throws Exception {
        Random random = new Random(7);
        for (int length = 0; length < 70; length++) {
            byte[] value = new byte[length];
            random.nextBytes(value);
            String expected = Base64.getUrlEncoder().withoutPadding().encodeToString(value);
            assertEquals(expected, ChatGptProtocol.encode(value));
            if (length > 0) assertTrue(Arrays.equals(value, ChatGptProtocol.decode(expected)));
        }
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.decode("ab="));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.decode("abcde"));
        // 남는 비트가 0이 아닌 비정규 인코딩은 거절한다.
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.decode("AB"));
    }

    @Test public void pkceChallengeMatchesRfc7636Vector() throws Exception {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            ChatGptProtocol.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }

    @Test public void firstAuthorizationRegistersWithNameHintAndLoopbackRedirect() throws Exception {
        String url = ChatGptProtocol.authorization(HOST, ChatGptProtocol.DYNAMIC,
            ChatGptProtocol.redirect(43123), "state", "nonce", "verifier");
        assertTrue(url.startsWith("https://auth.openai.com/api/accounts/authorize?client_id=dynamic_agent_client&"));
        assertTrue(url.contains("agent_name_hint=JHF+Novel+Reader"));
        assertTrue(url.contains("ext_agent_host_id=urn%3Auuid%3A123e4567"));
        assertTrue(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fauth%2Fcallback"));
        assertTrue(url.contains("scope=openid+profile+email+offline_access+resource.invoke+chatgpt.tokens.use.direct"));
        assertTrue(url.contains("resource=https%3A%2F%2Fapi.openai.com%2Fv1"));
        assertTrue(url.contains("code_challenge_method=S256"));
        assertFalse(url.contains("localhost"));
    }

    @Test public void returningAuthorizationReusesIssuedClientWithoutNameHint() throws Exception {
        String url = ChatGptProtocol.authorization(HOST, CLIENT, ChatGptProtocol.redirect(1), "s", "n", "v");
        assertTrue(url.contains("client_id=" + CLIENT));
        assertFalse(url.contains("agent_name_hint"));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.authorization("host", CLIENT, ChatGptProtocol.redirect(1), "s", "n", "v"));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.authorization(HOST, "other", ChatGptProtocol.redirect(1), "s", "n", "v"));
    }

    @Test public void callbackQueryRejectsDuplicatesControlsFragmentsAndOtherPaths() throws Exception {
        assertEquals("abc", ChatGptProtocol.query("/auth/callback?code=abc&state=s").get("code"));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.query("/auth/callback?state=a&state=b"));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.query("/auth/callback?state=%0a"));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.query("/auth/callback?state=s#x"));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.query("/callback?state=s"));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.query("/auth/callback?flag"));
    }

    @Test public void callbackChecksStateBeforeDenialAndValidatesIssuedClient() throws Exception {
        Map<String, String> denied = new LinkedHashMap<>();
        denied.put("state", "s");
        denied.put("error", "access_denied");
        assertThrows(ChatGptProtocol.Denied.class, () -> ChatGptProtocol.callbackClient(denied, "s", CLIENT));
        // state가 다르면 거부 응답도 이 시도의 결과로 보지 않는다.
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.callbackClient(denied, "x", CLIENT));

        Map<String, String> first = new LinkedHashMap<>();
        first.put("state", "s");
        first.put("code", "c");
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.callbackClient(first, "s", ChatGptProtocol.DYNAMIC));
        first.put("client_id", CLIENT);
        assertEquals(CLIENT, ChatGptProtocol.callbackClient(first, "s", ChatGptProtocol.DYNAMIC));

        Map<String, String> returning = new LinkedHashMap<>();
        returning.put("state", "s");
        returning.put("code", "c");
        assertEquals(CLIENT, ChatGptProtocol.callbackClient(returning, "s", CLIENT));
        returning.put("client_id", "oaiapp_other");
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.callbackClient(returning, "s", CLIENT));
    }

    static KeyPair rsa() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    static JSONObject jwks(KeyPair pair, String kid) throws Exception {
        RSAPublicKey key = (RSAPublicKey) pair.getPublic();
        return new JSONObject().put("keys", new JSONArray().put(new JSONObject()
            .put("kty", "RSA").put("kid", kid).put("use", "sig").put("alg", "RS256")
            .put("n", ChatGptProtocol.encode(unsigned(key.getModulus().toByteArray())))
            .put("e", ChatGptProtocol.encode(unsigned(key.getPublicExponent().toByteArray())))));
    }

    private static byte[] unsigned(byte[] value) {
        return value.length > 1 && value[0] == 0 ? Arrays.copyOfRange(value, 1, value.length) : value;
    }

    static String jwt(KeyPair pair, String kid, JSONObject claims) throws Exception {
        String header = ChatGptProtocol.encode(new JSONObject().put("alg", "RS256").put("kid", kid)
            .toString().getBytes(StandardCharsets.UTF_8));
        String payload = ChatGptProtocol.encode(claims.toString().getBytes(StandardCharsets.UTF_8));
        Signature signer = Signature.getInstance("SHA256withRSA");
        signer.initSign(pair.getPrivate());
        signer.update((header + "." + payload).getBytes(StandardCharsets.US_ASCII));
        return header + "." + payload + "." + ChatGptProtocol.encode(signer.sign());
    }

    static JSONObject claims(String nonce) throws Exception {
        return new JSONObject().put("iss", ChatGptProtocol.ISSUER).put("aud", CLIENT)
            .put("sub", "user-1").put("exp", NOW + 600).put("iat", NOW).put("nonce", nonce);
    }

    @Test public void identityAcceptsOnlySignedMatchingClaims() throws Exception {
        KeyPair pair = rsa();
        JSONObject keys = jwks(pair, "k1");
        assertEquals("user-1", ChatGptProtocol.identity(jwt(pair, "k1", claims("n")), keys, CLIENT, "n", NOW));

        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(jwt(pair, "k1", claims("n")), keys, CLIENT, "other", NOW));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(jwt(pair, "k1", claims("n")), keys, "oaiapp_other", "n", NOW));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(jwt(pair, "k1", claims("n")), keys, CLIENT, "n", NOW + 601));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(jwt(pair, "k1", claims("n").put("iss", "https://evil.example")),
                keys, CLIENT, "n", NOW));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(jwt(pair, "missing", claims("n")), keys, CLIENT, "n", NOW));
        KeyPair other = rsa();
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(jwt(other, "k1", claims("n")), keys, CLIENT, "n", NOW));

        String[] parts = jwt(pair, "k1", claims("n")).split("\\.");
        String none = ChatGptProtocol.encode("{\"alg\":\"none\",\"kid\":\"k1\"}".getBytes(StandardCharsets.UTF_8));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.identity(none + "." + parts[1] + "." + parts[2], keys, CLIENT, "n", NOW));
    }

    @Test public void planUsageRequiresDirectTokenScope() throws Exception {
        assertTrue(ChatGptProtocol.permits(new JSONObject().put("scope", "openid chatgpt.tokens.use.direct")));
        assertFalse(ChatGptProtocol.permits(new JSONObject().put("scope", "openid offline_access")));
        assertFalse(ChatGptProtocol.permits(new JSONObject()));
    }

    @Test public void modelListKeepsListedModelsInServerOrder() throws Exception {
        JSONArray models = ChatGptProtocol.models(new JSONObject().put("models", new JSONArray()
            .put(new JSONObject().put("slug", "gpt-b").put("display_name", "GPT B").put("visibility", "list"))
            .put(new JSONObject().put("slug", "gpt-hidden").put("display_name", "H").put("visibility", "hide"))
            .put(new JSONObject().put("slug", "gpt-a").put("display_name", "GPT A").put("visibility", "list")))
            .toString());
        assertEquals(2, models.length());
        assertEquals("gpt-b", models.getJSONObject(0).getString("slug"));
        assertEquals("GPT A", models.getJSONObject(1).getString("displayName"));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.models(new JSONObject()
            .put("models", new JSONArray().put(new JSONObject().put("slug", "a b").put("visibility", "list")))
            .toString()));
    }

    @Test public void errorSummaryKeepsOnlyKnownCodeAndParameter() throws Exception {
        JSONObject known = ChatGptProtocol.errorSummary(new JSONObject().put("error", new JSONObject()
            .put("code", "subscription_sharing_usage_limit_exceeded").put("param", "model")
            .put("message", "user@example.com private text")).toString());
        JSONObject error = known.getJSONObject("error");
        assertEquals(2, error.length());
        assertEquals("subscription_sharing_usage_limit_exceeded", error.getString("code"));
        assertEquals("model", error.getString("param"));
        assertFalse(known.toString().contains("example.com"));
        assertEquals("{\"error\":{\"detail\":true}}",
            ChatGptProtocol.errorSummary("{\"detail\":\"Direct routing disabled for user 42\"}").toString());
        assertEquals("{\"error\":{}}",
            ChatGptProtocol.errorSummary("{\"error\":{\"code\":\"free text\",\"param\":\"x\"}}").toString());
        assertEquals("{\"error\":{}}", ChatGptProtocol.errorSummary("<html>").toString());
    }

    @Test public void responsesBodyAllowsOnlySupportedFieldsAndForcesStreaming() throws Exception {
        JSONObject input = new JSONObject().put("model", "gpt-6.1-sol").put("instructions", "번역")
            .put("input", new JSONArray().put(new JSONObject().put("role", "user").put("content", "本文")))
            .put("store", true).put("stream", false);
        JSONObject body = ChatGptProtocol.responsesBody(input);
        assertFalse(body.getBoolean("store"));
        assertTrue(body.getBoolean("stream"));
        for (String key : new String[] {"temperature", "max_output_tokens", "previous_response_id", "metadata"})
            assertThrows(ChatGptProtocol.Invalid.class, () ->
                ChatGptProtocol.responsesBody(new JSONObject(input.toString()).put(key, 1)));
        assertThrows(ChatGptProtocol.Invalid.class, () -> ChatGptProtocol.responsesBody(
            new JSONObject(input.toString()).put("input", new JSONArray()
                .put(new JSONObject().put("role", "system").put("content", "x")))));
        assertThrows(ChatGptProtocol.Invalid.class, () ->
            ChatGptProtocol.responsesBody(new JSONObject(input.toString()).put("model", "a b")));
    }
}
