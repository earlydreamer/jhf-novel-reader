package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** 합성 키/HTTP만 사용. 실제 인증·브라우저 동의·OpenAI 요청은 절대 시작하지 않는다. */
@RunWith(AndroidJUnit4.class)
public class SiwcProbeInstrumentedTest {
    private interface Checked { void run() throws Exception; }
    private static void rejects(Checked action) throws Exception {
        try { action.run(); fail("invalid input accepted"); }
        catch (IllegalArgumentException | org.json.JSONException | java.security.SignatureException expected) { }
    }

    @Test public void authorizationUsesExactLoopbackAndFreshPkce() throws Exception {
        String verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        String url = SiwcProtocol.authorization("urn:uuid:synthetic", SiwcProtocol.DYNAMIC,
            "http://127.0.0.1:1455/auth/callback", "synthetic-state", "synthetic-nonce", verifier);
        assertTrue(url.startsWith(SiwcProtocol.ISSUER + "/api/accounts/authorize?"));
        assertTrue(url.contains("code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
        assertTrue(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback"));
        assertTrue(url.contains("agent_name_hint=JHF+Novel+Reader"));
        assertFalse(SiwcProtocol.random().equals(SiwcProtocol.random()));
        assertFalse(SiwcProtocol.authorization("host", "oaiapp_saved", "redirect", "state", "nonce", verifier)
            .contains("agent_name_hint"));
    }

    @Test public void callbackRejectsStaleStateDuplicateFieldsAndClientMixing() throws Exception {
        Map<String, String> query = SiwcProtocol.query("/auth/callback?code=synthetic&state=current&client_id=oaiapp_test");
        assertEquals("oaiapp_test", SiwcProtocol.callbackClient(query, "current", SiwcProtocol.DYNAMIC));
        rejects(() -> SiwcProtocol.callbackClient(query, "old", SiwcProtocol.DYNAMIC));
        rejects(() -> SiwcProtocol.callbackClient(query, "current", "oaiapp_other"));
        rejects(() -> SiwcProtocol.query("/auth/callback?state=one&%73tate=two"));
        rejects(() -> SiwcProtocol.query("/callback?state=current"));
        rejects(() -> SiwcProtocol.query("/auth/callback?code=%0d%0a"));
        rejects(() -> SiwcProtocol.callbackClient(SiwcProtocol.query("/auth/callback?state=current&code=x"), "current", SiwcProtocol.DYNAMIC));
        rejects(() -> SiwcProtocol.callbackClient(SiwcProtocol.query("/auth/callback?state=current&error=access_denied&code=x"), "current", "oaiapp_test"));
        assertEquals("oaiapp_test", SiwcProtocol.callbackClient(
            SiwcProtocol.query("/auth/callback?state=current&code=x"), "current", "oaiapp_test"));
    }

    private static String get(int port, String host, String path) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            socket.setSoTimeout(3000);
            socket.getOutputStream().write(("GET " + path + " HTTP/1.1\r\nHost: " + host + "\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            for (int n; (n = socket.getInputStream().read(buffer)) >= 0;) bytes.write(buffer, 0, n);
            return bytes.toString("UTF-8");
        }
    }

    @Test public void loopbackIgnoresForeignHostAndStateThenConsumesOnce() throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (SiwcLoopback listener = new SiwcLoopback()) {
            int port = new URI(listener.redirect()).getPort();
            Future<Map<String, String>> future = worker.submit(() -> listener.await("current", android.os.SystemClock.elapsedRealtime() + 10000));
            assertTrue(get(port, "localhost:" + port, "/auth/callback?state=current&code=secret").contains("400 Bad Request"));
            assertTrue(get(port, "127.0.0.1:" + port, "/auth/callback?state=old&code=secret").contains("400 Bad Request"));
            assertFalse(future.isDone());
            String response = get(port, "127.0.0.1:" + port, "/auth/callback?state=current&code=secret&client_id=oaiapp_test");
            assertTrue(response.contains("200 OK"));
            assertTrue(response.contains("Cache-Control: no-store"));
            assertFalse(response.contains("secret"));
            assertFalse(response.contains("current"));
            assertEquals("secret", future.get(3, TimeUnit.SECONDS).get("code"));
            try { new Socket("127.0.0.1", port).close(); fail("listener still open"); }
            catch (java.io.IOException expected) { }
        } finally { worker.shutdownNow(); }
    }

    @Test public void cancellationAndTimeoutCloseListenerWithoutCallback() throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (SiwcLoopback listener = new SiwcLoopback()) {
            Future<?> future = worker.submit(() -> {
                try { listener.await("state", android.os.SystemClock.elapsedRealtime() + 10000); fail("cancel accepted"); }
                catch (Exception expected) { }
            });
            listener.close();
            future.get(3, TimeUnit.SECONDS);
        } finally { worker.shutdownNow(); }
        try (SiwcLoopback listener = new SiwcLoopback()) {
            int port = new URI(listener.redirect()).getPort();
            try { listener.await("state", android.os.SystemClock.elapsedRealtime()); fail("timeout accepted"); }
            catch (java.util.concurrent.TimeoutException expected) { }
            try { new Socket("127.0.0.1", port).close(); fail("timed out listener open"); }
            catch (java.io.IOException expected) { }
        }
    }

    private static String token(KeyPair pair, JSONObject claims, String algorithm) throws Exception {
        String header = SiwcProtocol.encode(new JSONObject().put("alg", algorithm).put("kid", "synthetic")
            .toString().getBytes(StandardCharsets.UTF_8));
        String payload = SiwcProtocol.encode(claims.toString().getBytes(StandardCharsets.UTF_8));
        String message = header + "." + payload;
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(pair.getPrivate());
        signature.update(message.getBytes(StandardCharsets.US_ASCII));
        return message + "." + SiwcProtocol.encode(signature.sign());
    }

    @Test public void idTokenRequiresTrustedSignatureIssuerAudienceExpiryAndNonce() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        RSAPublicKey key = (RSAPublicKey) pair.getPublic();
        JSONObject jwks = new JSONObject().put("keys", new JSONArray().put(new JSONObject()
            .put("kty", "RSA").put("kid", "synthetic").put("alg", "RS256").put("use", "sig")
            .put("n", SiwcProtocol.encode(key.getModulus().toByteArray()))
            .put("e", SiwcProtocol.encode(key.getPublicExponent().toByteArray()))));
        JSONObject claims = new JSONObject().put("iss", SiwcProtocol.ISSUER).put("aud", "oaiapp_test")
            .put("sub", "synthetic-subject").put("exp", 2000).put("iat", 900).put("nonce", "expected");
        assertEquals("synthetic-subject", SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_test", "expected", 1000));
        rejects(() -> SiwcProtocol.identity(token(pair, claims, "none"), jwks, "oaiapp_test", "expected", 1000));
        rejects(() -> SiwcProtocol.identity(token(generator.generateKeyPair(), claims, "RS256"), jwks, "oaiapp_test", "expected", 1000));
        rejects(() -> SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_test", "wrong", 1000));
        rejects(() -> SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_other", "expected", 1000));
        rejects(() -> SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_test", "expected", 2000));
        claims.put("iss", "https://example.test");
        rejects(() -> SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_test", "expected", 1000));
        claims.put("iss", SiwcProtocol.ISSUER).put("aud", new JSONArray().put("oaiapp_test").put("other"));
        rejects(() -> SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_test", "expected", 1000));
        claims.put("azp", "oaiapp_test");
        assertEquals("synthetic-subject", SiwcProtocol.identity(token(pair, claims, "RS256"), jwks, "oaiapp_test", "expected", 1000));
    }
}
