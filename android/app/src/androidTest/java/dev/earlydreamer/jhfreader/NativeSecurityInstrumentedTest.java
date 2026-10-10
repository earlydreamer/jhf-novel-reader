package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.res.XmlResourceParser;
import android.security.NetworkSecurityPolicy;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.plugin.util.CapacitorHttpUrlConnection;
import com.getcapacitor.plugin.util.HttpRequestHandler.HttpURLConnectionBuilder;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.xmlpull.v1.XmlPullParser;

/** Device-only checks. Compiling this class is not evidence that these tests ran. */
@RunWith(AndroidJUnit4.class)
public class NativeSecurityInstrumentedTest {
    private static final int TIMEOUT_MS = 3000;
    private static final String DUMMY_AUTHORIZATION = "Bearer synthetic-instrumentation-token";

    private Context appContext() {
        return InstrumentationRegistry.getInstrumentation().getTargetContext();
    }

    @Test
    public void targetAppPolicyAllowsRuntimeModelHostsButRejectsSourceCleartext() {
        assertEquals("dev.earlydreamer.jhfreader", appContext().getPackageName());
        NetworkSecurityPolicy policy = NetworkSecurityPolicy.getInstance();
        // These are policy lookups only: no DNS resolution or external request occurs.
        for (String host : Arrays.asList("127.0.0.1", "192.168.50.10", "100.64.10.20", "chosen-model.example.test")) {
            assertTrue("Runtime model host must permit cleartext: " + host, policy.isCleartextTrafficPermitted(host));
        }
        for (String host : Arrays.asList("syosetu.com", "ncode.syosetu.com", "nested.ncode.syosetu.com")) {
            assertFalse("Source domain must reject cleartext: " + host, policy.isCleartextTrafficPermitted(host));
        }
    }

    @Test
    public void targetAppDisablesBackupAndPackagesAllPrivateDataExclusions() throws Exception {
        ApplicationInfo info = appContext().getApplicationInfo();
        assertEquals(36, info.targetSdkVersion);
        assertEquals(0, info.flags & ApplicationInfo.FLAG_ALLOW_BACKUP);
        assertBackupExcludes("backup_rules", null);
        assertBackupExcludes("data_extraction_rules", "cloud-backup");
        assertBackupExcludes("data_extraction_rules", "device-transfer");
    }

    @Test
    public void packagedBridgeConfigKeepsBundledUiAndNativeHttpSeparated() {
        CapConfig config = CapConfig.loadDefault(appContext());
        assertEquals("https", config.getAndroidScheme());
        assertNull(config.getServerUrl());
        assertTrue(config.getAllowNavigation() == null || config.getAllowNavigation().length == 0);
        assertFalse(config.isMixedContentAllowed());
        assertFalse(config.isLoggingEnabled());
        assertFalse(config.getPluginConfiguration("CapacitorHttp").getBoolean("enabled", false));
    }

    @Test(timeout = 15000)
    public void capacitorNativeConnectionPostsSyntheticJsonOverLoopbackHttp() throws Exception {
        try (LoopbackServer server = new LoopbackServer("200 OK", null)) {
            CapacitorHttpUrlConnection connection = connection(server.url(), true, true);
            try {
                postSyntheticBody(connection);
                assertEquals(200, connection.getResponseCode());
                String request = server.awaitRequest();
                assertTrue(request.startsWith("POST /fixture HTTP/1.1\r\n"));
                assertTrue(request.contains("Authorization: " + DUMMY_AUTHORIZATION + "\r\n"));
                assertTrue(request.endsWith("{\"synthetic\":true}"));
            } finally {
                connection.disconnect();
            }
        }
    }

    @Test(timeout = 15000)
    public void disabledRedirectsNeverSendRequestOrAuthorizationTo307Receiver() throws Exception {
        try (LoopbackServer receiver = new LoopbackServer("200 OK", null);
             LoopbackServer redirect = new LoopbackServer("307 Temporary Redirect", receiver.url())) {
            CapacitorHttpUrlConnection connection = connection(redirect.url(), true, true);
            try {
                assertFalse(connection.getHttpConnection().getInstanceFollowRedirects());
                postSyntheticBody(connection);
                assertEquals(307, connection.getResponseCode());
                assertEquals(redirect.url(), connection.getHttpConnection().getURL());
                assertTrue(redirect.awaitRequest().contains("Authorization: " + DUMMY_AUTHORIZATION + "\r\n"));
                // The synchronous native response has settled. No second request may arrive.
                receiver.assertNoRequest();
            } finally {
                connection.disconnect();
            }
        }
    }

    @Test(timeout = 15000)
    public void redirectFixtureReceivesRequestWhenNativeRedirectsAreEnabled() throws Exception {
        // Positive control: ensures the receiver can detect real redirects, without credentials.
        try (LoopbackServer receiver = new LoopbackServer("200 OK", null);
             LoopbackServer redirect = new LoopbackServer("307 Temporary Redirect", receiver.url())) {
            CapacitorHttpUrlConnection connection = connection(redirect.url(), false, false);
            try {
                assertEquals(200, connection.getResponseCode());
                assertTrue(redirect.awaitRequest().startsWith("GET /fixture HTTP/1.1\r\n"));
                assertTrue(receiver.awaitRequest().startsWith("GET /fixture HTTP/1.1\r\n"));
            } finally {
                connection.disconnect();
            }
        }
    }

    private CapacitorHttpUrlConnection connection(URL url, boolean disableRedirects, boolean authenticatedPost) throws IOException {
        JSObject headers = new JSObject();
        if (authenticatedPost) {
            headers.put("Authorization", DUMMY_AUTHORIZATION);
            headers.put("Content-Type", "application/json");
        }
        return new HttpURLConnectionBuilder()
            .setUrl(url)
            .setMethod(authenticatedPost ? "POST" : "GET")
            .setHeaders(headers)
            .setDisableRedirects(disableRedirects)
            .setConnectTimeout(TIMEOUT_MS)
            .setReadTimeout(TIMEOUT_MS)
            .openConnection()
            .build();
    }

    private void postSyntheticBody(CapacitorHttpUrlConnection connection) throws IOException {
        connection.setDoOutput(true);
        // Keep HttpURLConnection's buffered mode, as in Capacitor JSON requests. Streaming
        // mode itself can disable replay and would weaken this redirect regression check.
        try (java.io.OutputStream output = connection.getHttpConnection().getOutputStream()) {
            output.write("{\"synthetic\":true}".getBytes(StandardCharsets.UTF_8));
        }
    }

    private void assertBackupExcludes(String resourceName, String section) throws Exception {
        int resourceId = appContext().getResources().getIdentifier(resourceName, "xml", appContext().getPackageName());
        assertNotEquals("Missing compiled backup resource", 0, resourceId);
        Set<String> excluded = new HashSet<>();
        boolean inSection = section == null;
        boolean foundSection = inSection;
        try (XmlResourceParser parser = appContext().getResources().getXml(resourceId)) {
            for (int event = parser.getEventType(); event != XmlPullParser.END_DOCUMENT; event = parser.next()) {
                if (event == XmlPullParser.START_TAG) {
                    if (section != null && section.equals(parser.getName())) {
                        inSection = true;
                        foundSection = true;
                    } else if (inSection && "exclude".equals(parser.getName()) && ".".equals(parser.getAttributeValue(null, "path"))) {
                        excluded.add(parser.getAttributeValue(null, "domain"));
                    }
                } else if (event == XmlPullParser.END_TAG && section != null && section.equals(parser.getName())) {
                    inSection = false;
                }
            }
        }
        assertTrue("Missing backup section: " + section, foundSection);
        assertTrue(excluded.containsAll(Arrays.asList("root", "file", "database", "sharedpref", "external")));
    }

    /** Single-request HTTP fixture bound only to the instrumented device's loopback. */
    private static final class LoopbackServer implements AutoCloseable {
        private final ServerSocket server = new ServerSocket();
        private final BlockingQueue<String> requests = new LinkedBlockingQueue<>();
        private final AtomicReference<Throwable> failure = new AtomicReference<>();
        private final Thread worker;
        private volatile boolean closing;
        private volatile Socket active;

        LoopbackServer(String status, URL location) throws IOException {
            server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            server.setSoTimeout(TIMEOUT_MS * 2);
            worker = new Thread(() -> {
                try (Socket socket = server.accept()) {
                    active = socket;
                    socket.setSoTimeout(TIMEOUT_MS);
                    requests.add(readRequest(socket.getInputStream()));
                    String response = "HTTP/1.1 " + status + "\r\nContent-Length: 0\r\nConnection: close\r\n";
                    if (location != null) response += "Location: " + location + "\r\n";
                    socket.getOutputStream().write((response + "\r\n").getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().flush();
                } catch (Throwable error) {
                    if (!closing) failure.set(error);
                }
            }, "narou-loopback-http-fixture");
            worker.setDaemon(true);
            worker.start();
        }

        URL url() throws IOException {
            return new URL("http://127.0.0.1:" + server.getLocalPort() + "/fixture");
        }

        String awaitRequest() throws InterruptedException {
            String request = requests.poll(TIMEOUT_MS, TimeUnit.MILLISECONDS);
            assertHealthy();
            assertNotNull("Loopback fixture received no request", request);
            return request;
        }

        void assertNoRequest() throws InterruptedException {
            assertNull("Redirect receiver must receive no request, including credentials", requests.poll(500, TimeUnit.MILLISECONDS));
            assertHealthy();
        }

        private void assertHealthy() {
            Throwable error = failure.get();
            if (error != null) throw new AssertionError("Loopback fixture failed", error);
        }

        private static String readRequest(InputStream input) throws IOException {
            ByteArrayOutputStream request = new ByteArrayOutputStream();
            int trailing = 0;
            while (trailing != 0x0d0a0d0a) {
                int next = input.read();
                if (next == -1 || request.size() >= 65536) throw new IOException("Incomplete or oversized fixture request");
                request.write(next);
                trailing = (trailing << 8) | next;
            }
            String headers = request.toString(StandardCharsets.US_ASCII.name());
            int contentLength = 0;
            for (String header : headers.split("\r\n")) {
                if (header.regionMatches(true, 0, "Content-Length:", 0, 15)) contentLength = Integer.parseInt(header.substring(15).trim());
            }
            if (contentLength < 0 || contentLength > 65536) throw new IOException("Invalid fixture content length");
            for (int count = 0; count < contentLength; count++) {
                int next = input.read();
                if (next == -1) throw new IOException("Incomplete fixture request body");
                request.write(next);
            }
            return request.toString(StandardCharsets.UTF_8.name());
        }

        @Override
        public void close() throws Exception {
            closing = true;
            server.close();
            Socket socket = active;
            if (socket != null) socket.close();
            worker.join(TIMEOUT_MS);
            assertFalse("Loopback fixture thread did not stop", worker.isAlive());
            assertHealthy();
        }
    }
}
