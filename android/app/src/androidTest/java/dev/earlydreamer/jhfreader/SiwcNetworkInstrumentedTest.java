package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/** 같은 Android 전송 계층·고정 길이 POST 설정을 합성 loopback에서 검증한다. */
@RunWith(AndroidJUnit4.class)
public class SiwcNetworkInstrumentedTest {
    private static void receive(Socket socket) throws Exception {
        socket.setSoTimeout(3000);
        BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
        assertTrue(input.readLine().startsWith("POST /synthetic "));
        int length = -1;
        boolean bearer = false;
        for (String line; !(line = input.readLine()).isEmpty();) {
            if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
            if (line.equals("Authorization: Bearer synthetic-only")) bearer = true;
        }
        assertTrue(bearer);
        assertEquals(9, length);
        char[] body = new char[length];
        int read = 0;
        while (read < length) {
            int n = input.read(body, read, length - read);
            assertTrue(n > 0);
            read += n;
        }
        assertEquals("synthetic", new String(body));
    }
    private static HttpURLConnection connection(ServerSocket server) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://127.0.0.1:" + server.getLocalPort() + "/synthetic").openConnection();
        SiwcHttp.configure(connection, "synthetic-only");
        return connection;
    }

    @Test public void droppedConnectionAfterFullPostDoesNotReplayBody() throws Exception {
        ExecutorService worker = Executors.newSingleThreadExecutor();
        try (ServerSocket server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))) {
            server.setSoTimeout(2000);
            Future<Integer> count = worker.submit(() -> {
                try (Socket first = server.accept()) { receive(first); first.setSoLinger(true, 0); }
                try (Socket replay = server.accept()) { return 2; }
                catch (SocketTimeoutException expected) { return 1; }
            });
            HttpURLConnection connection = connection(server);
            try {
                SiwcHttp.post(connection, "text/plain", "synthetic");
                try { connection.getResponseCode(); fail("dropped response accepted"); }
                catch (java.io.IOException expected) { }
                assertEquals(1, (int) count.get(5, TimeUnit.SECONDS));
            } finally { connection.disconnect(); }
        } finally { worker.shutdownNow(); }
    }

    @Test public void redirectAndUnauthorizedDoNotForwardBearerOrReplayPost() throws Exception {
        for (int status : new int[]{307, 401}) {
            ExecutorService worker = Executors.newSingleThreadExecutor();
            try (ServerSocket server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
                 ServerSocket foreign = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))) {
                server.setSoTimeout(2000);
                foreign.setSoTimeout(600);
                Future<Integer> count = worker.submit(() -> {
                    try (Socket first = server.accept()) {
                        receive(first);
                        first.getOutputStream().write(("HTTP/1.1 " + status + " Synthetic\r\nContent-Length: 0\r\n"
                            + "Location: http://127.0.0.1:" + foreign.getLocalPort() + "/leak\r\nConnection: close\r\n\r\n")
                            .getBytes(StandardCharsets.US_ASCII));
                    }
                    server.setSoTimeout(600);
                    try (Socket replay = server.accept()) { return 2; }
                    catch (SocketTimeoutException expected) { return 1; }
                });
                HttpURLConnection connection = connection(server);
                try {
                    SiwcHttp.post(connection, "text/plain", "synthetic");
                    assertEquals(status, connection.getResponseCode());
                    assertEquals(1, (int) count.get(5, TimeUnit.SECONDS));
                    try (Socket leak = foreign.accept()) { fail("bearer forwarded to foreign server"); }
                    catch (SocketTimeoutException expected) { }
                } finally { connection.disconnect(); }
            } finally { worker.shutdownNow(); }
        }
    }
}
