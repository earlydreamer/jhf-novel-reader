package dev.earlydreamer.jhfreader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.Test;

public class ChatGptLoopbackTest {
    private static String send(int port, String host, String target) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            OutputStream output = socket.getOutputStream();
            output.write(("GET " + target + " HTTP/1.1\r\nHost: " + host + "\r\nConnection: close\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            output.flush();
            InputStream input = socket.getInputStream();
            byte[] head = new byte[12];
            int read = 0;
            while (read < head.length) {
                int n = input.read(head, read, head.length - read);
                if (n < 0) break;
                read += n;
            }
            return new String(head, 0, read, StandardCharsets.US_ASCII);
        }
    }

    @Test public void ignoresWrongHostAndStaleStateThenAcceptsOneValidCallback() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try (ChatGptLoopback loopback = new ChatGptLoopback()) {
            int port = loopback.port();
            assertTrue(loopback.redirect().matches("http://127\\.0\\.0\\.1:\\d+/auth/callback"));
            Future<Map<String, String>> result = executor.submit(() -> loopback.await("good", 10_000));
            assertEquals("HTTP/1.1 400", send(port, "localhost:" + port, "/auth/callback?state=good&code=c"));
            assertEquals("HTTP/1.1 400", send(port, "127.0.0.1:" + port, "/auth/callback?state=old&code=c"));
            assertEquals("HTTP/1.1 400", send(port, "127.0.0.1:" + port, "/callback?state=good&code=c"));
            assertEquals("HTTP/1.1 200", send(port, "127.0.0.1:" + port, "/auth/callback?state=good&code=c1"));
            assertEquals("c1", result.get(5, TimeUnit.SECONDS).get("code"));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test public void cancelAndTimeoutCloseTheListener() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            ChatGptLoopback cancelled = new ChatGptLoopback();
            Future<Map<String, String>> waiting = executor.submit(() -> cancelled.await("s", 10_000));
            Thread.sleep(100);
            cancelled.close();
            Exception error = assertThrows(Exception.class, () -> waiting.get(5, TimeUnit.SECONDS));
            assertTrue(error.getCause() instanceof CancellationException);
            assertThrows(Exception.class, () -> send(cancelled.port(), "127.0.0.1:" + cancelled.port(), "/"));

            ChatGptLoopback late = new ChatGptLoopback();
            assertThrows(TimeoutException.class, () -> late.await("s", 300));
            assertThrows(Exception.class, () -> send(late.port(), "127.0.0.1:" + late.port(), "/"));
        } finally {
            executor.shutdownNow();
        }
    }
}
