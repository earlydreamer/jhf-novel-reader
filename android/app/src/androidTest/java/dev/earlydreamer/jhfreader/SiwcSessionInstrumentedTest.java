package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** 실제 계정과 분리된 합성 토큰, 테스트 전용 Keystore alias만 사용한다. */
@RunWith(AndroidJUnit4.class)
public class SiwcSessionInstrumentedTest {
    private static SiwcVault vault() {
        return new SiwcVault(InstrumentationRegistry.getInstrumentation().getTargetContext(),
            "test-" + UUID.randomUUID().toString().substring(0, 8));
    }
    private static JSONObject tokens(long expires) throws Exception {
        return new JSONObject().put("access_token", "synthetic-access-secret").put("refresh_token", "synthetic-refresh-secret")
            .put("id_token", "synthetic-id-secret").put("token_type", "Bearer")
            .put("scope", SiwcProtocol.SCOPES).put("expires_in", expires);
    }
    private interface Checked { void run() throws Exception; }
    private static void fails(Checked action) throws Exception {
        try { action.run(); fail("invalid operation succeeded"); } catch (Exception expected) { }
    }
    private static byte[] bytes(SiwcVault vault) throws Exception {
        try (FileInputStream input = new FileInputStream(vault.file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            for (int n; (n = input.read(buffer)) >= 0;) output.write(buffer, 0, n);
            return output.toByteArray();
        }
    }

    @Test public void ciphertextSurvivesReopenAndTamperingFailsClosed() throws Exception {
        SiwcVault vault = vault();
        try {
            vault.save(tokens(3600));
            String stored = new String(bytes(vault), StandardCharsets.ISO_8859_1);
            assertFalse(stored.contains("synthetic-access-secret"));
            assertFalse(stored.contains("synthetic-refresh-secret"));
            assertFalse(stored.contains("synthetic-id-secret"));
            SiwcVault reopened = new SiwcVault(InstrumentationRegistry.getInstrumentation().getTargetContext(),
                vault.file.getName().substring(5, vault.file.getName().length() - 4));
            assertEquals("synthetic-access-secret", reopened.load().getString("access_token"));
            byte[] corrupt = bytes(vault);
            corrupt[corrupt.length - 1] ^= 1;
            try (FileOutputStream output = new FileOutputStream(vault.file)) { output.write(corrupt); }
            fails(vault::load);
        } finally { vault.destroyTestKey(); }
    }

    @Test public void missingKeystoreKeyNeverFallsBackToPlaintextOrReplacement() throws Exception {
        SiwcVault vault = vault();
        try {
            vault.save(tokens(3600));
            byte[] ciphertext = bytes(vault);
            vault.destroyTestKey();
            try (FileOutputStream output = new FileOutputStream(vault.file)) { output.write(ciphertext); }
            fails(vault::load);
            fails(vault::load);
        } finally { vault.destroyTestKey(); }
    }

    @Test public void restoredSessionIsBoundToClientAndVerifiedSubject() throws Exception {
        SiwcVault vault = vault();
        try {
            SiwcSession session = new SiwcSession(vault, (path, form) -> { throw new AssertionError("no HTTP expected"); });
            session.install("oaiapp_test", "synthetic-sub", tokens(3600), 1000);
            fails(() -> session.restore("oaiapp_other", "synthetic-sub"));
            fails(() -> session.restore("oaiapp_test", "another-sub"));
            assertEquals("synthetic-sub", session.restore("oaiapp_test", "synthetic-sub").getString("subject"));
            fails(() -> session.install("oaiapp_other", "another-sub", tokens(3600), 1000));
        } finally { vault.destroyTestKey(); }
    }

    @Test public void simultaneousExpiryRefreshesOnceAndPersistsLatestRotation() throws Exception {
        SiwcVault vault = vault();
        ExecutorService threads = Executors.newFixedThreadPool(2);
        try {
            AtomicInteger calls = new AtomicInteger();
            SiwcSession session = new SiwcSession(vault, (path, form) -> {
                assertEquals("/api/accounts/oauth/token", path);
                assertEquals("synthetic-refresh-secret", form.get("refresh_token"));
                assertEquals("oaiapp_test", form.get("client_id"));
                assertFalse(form.containsKey("scope"));
                calls.incrementAndGet();
                return new JSONObject().put("access_token", "synthetic-access-rotated")
                    .put("refresh_token", "synthetic-refresh-rotated").put("token_type", "Bearer")
                    .put("expires_in", 3600).toString();
            });
            session.install("oaiapp_test", "synthetic-sub", tokens(1), 1000);
            Future<JSONObject> a = threads.submit(() -> session.fresh("oaiapp_test", "synthetic-sub", 1002, false));
            Future<JSONObject> b = threads.submit(() -> session.fresh("oaiapp_test", "synthetic-sub", 1002, false));
            assertEquals("synthetic-access-rotated", a.get(5, TimeUnit.SECONDS).getString("access_token"));
            assertEquals("synthetic-access-rotated", b.get(5, TimeUnit.SECONDS).getString("access_token"));
            assertEquals(1, calls.get());
            assertEquals("synthetic-refresh-rotated", vault.load().getString("refresh_token"));
            assertEquals("ready", vault.load().getString("phase"));
        } finally { threads.shutdownNow(); vault.destroyTestKey(); }
    }

    @Test public void unknownRefreshBlocksReuseAcrossReloadButAllowsExplicitLocalDisconnect() throws Exception {
        SiwcVault vault = vault();
        try {
            AtomicInteger refreshes = new AtomicInteger();
            SiwcSession session = new SiwcSession(vault, (path, form) -> {
                if (path.endsWith("/token")) refreshes.incrementAndGet();
                throw new java.io.IOException("synthetic dropped connection");
            });
            session.install("oaiapp_test", "synthetic-sub", tokens(1), 1000);
            fails(() -> session.fresh("oaiapp_test", "synthetic-sub", 1002, false));
            fails(() -> session.fresh("oaiapp_test", "synthetic-sub", 1002, false));
            fails(() -> session.restore("oaiapp_test", "synthetic-sub"));
            assertEquals(1, refreshes.get());
            assertEquals("refreshing", vault.load().getString("phase"));
            assertFalse(session.disconnect());
            assertNull(vault.load());
        } finally { vault.destroyTestKey(); }
    }

    @Test public void rotatedTokenIsUsedForRevocationWhenIdentityValidationFails() throws Exception {
        SiwcVault vault = vault();
        try {
            AtomicInteger revocations = new AtomicInteger();
            SiwcSession session = new SiwcSession(vault, (path, form) -> {
                if (path.endsWith("/token")) return tokens(3600).put("refresh_token", "synthetic-new-refresh")
                    .put("id_token", "invalid.jwt.signature").toString();
                if (path.endsWith("jwks.json")) return "{\"keys\":[]}";
                assertEquals("synthetic-new-refresh", form.get("token"));
                revocations.incrementAndGet();
                return "";
            });
            session.install("oaiapp_test", "synthetic-sub", tokens(1), 1000);
            fails(() -> session.fresh("oaiapp_test", "synthetic-sub", 1002, true));
            fails(() -> session.restore("oaiapp_test", "synthetic-sub"));
            assertTrue(session.disconnect());
            assertEquals(1, revocations.get());
            assertNull(vault.load());
        } finally { vault.destroyTestKey(); }
    }

    @Test public void inferenceAttemptCannotBeRepeatedAfterReload() throws Exception {
        SiwcVault vault = vault();
        try {
            SiwcSession session = new SiwcSession(vault, (path, form) -> { throw new AssertionError("no HTTP expected"); });
            session.install("oaiapp_test", "synthetic-sub", tokens(3600), 1000);
            session.markInference("oaiapp_test", "synthetic-sub");
            SiwcSession reloaded = new SiwcSession(vault, (path, form) -> { throw new AssertionError("no HTTP expected"); });
            fails(() -> reloaded.markInference("oaiapp_test", "synthetic-sub"));
            assertTrue(reloaded.restore("oaiapp_test", "synthetic-sub").getBoolean("inferenceAttempted"));
        } finally { vault.destroyTestKey(); }
    }

    @Test public void absentSessionNeverClaimsRemoteRevocationWasConfirmed() throws Exception {
        SiwcVault vault = vault();
        try {
            AtomicInteger calls = new AtomicInteger();
            SiwcSession session = new SiwcSession(vault, (path, form) -> { calls.incrementAndGet(); return ""; });
            assertFalse(session.disconnect());
            assertEquals(0, calls.get());
        } finally { vault.destroyTestKey(); }
    }

    @Test public void explicitDiagnosticBudgetSurvivesRotationAndNeverResetsConsumedAttempts() throws Exception {
        SiwcVault vault = vault();
        try {
            SiwcSession session = new SiwcSession(vault, (path, form) -> new JSONObject()
                .put("access_token", "synthetic-new-access").put("refresh_token", "synthetic-new-refresh")
                .put("token_type", "Bearer").put("expires_in", 3600).toString());
            session.install("oaiapp_test", "synthetic-sub", tokens(3600), 1000);
            assertEquals(1, session.markInference("oaiapp_test", "synthetic-sub"));
            fails(() -> session.markInference("oaiapp_test", "synthetic-sub"));
            session.allowAdditionalDiagnostics("oaiapp_test", "synthetic-sub");
            session.fresh("oaiapp_test", "synthetic-sub", 1001, true);
            assertEquals(2, session.markInference("oaiapp_test", "synthetic-sub"));
            assertEquals(3, session.markInference("oaiapp_test", "synthetic-sub"));
            session.allowAdditionalDiagnostics("oaiapp_test", "synthetic-sub");
            fails(() -> session.markInference("oaiapp_test", "synthetic-sub"));
            assertEquals(3, vault.load().getInt("inferenceAttempts"));
        } finally { vault.destroyTestKey(); }
    }
}
