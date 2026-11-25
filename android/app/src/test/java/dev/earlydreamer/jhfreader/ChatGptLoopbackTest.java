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
import java.util.concurrent.CountDownLatch;
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

    private static String page(int port, String target) throws Exception {
        try (Socket socket = new Socket("127.0.0.1", port)) {
            OutputStream output = socket.getOutputStream();
            output.write(("GET " + target + " HTTP/1.1\r\nHost: 127.0.0.1:" + port + "\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            output.flush();
            return new String(socket.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test public void answersRepeatedCallbackDuringGraceThenCloses() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            ChatGptLoopback loopback = new ChatGptLoopback("dev.example.app://chatgpt");
            int port = loopback.port();
            Future<Map<String, String>> result = executor.submit(() -> loopback.await("good", 10_000));
            String first = page(port, "/auth/callback?state=good&code=c1");
            assertTrue(first.startsWith("HTTP/1.1 200"));
            assertTrue(first.contains("href='dev.example.app://chatgpt'>앱으로 돌아가기</a>"));
            assertEquals("c1", result.get(5, TimeUnit.SECONDS).get("code"));

            CountDownLatch done = new CountDownLatch(1);
            loopback.linger("good", 1_000, done::countDown);
            assertTrue(loopback.lingering());
            assertTrue(page(port, "/auth/callback?state=good&code=c1").startsWith("HTTP/1.1 200"));
            assertTrue(page(port, "/auth/callback?state=old&code=c1").startsWith("HTTP/1.1 400"));
            assertTrue(done.await(5, TimeUnit.SECONDS));
            assertThrows(Exception.class, () -> page(port, "/auth/callback?state=good&code=c1"));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test public void deniedCallbackDoesNotShowSuccessPage() throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try (ChatGptLoopback loopback = new ChatGptLoopback("dev.example.app://chatgpt")) {
            int port = loopback.port();
            Future<Map<String, String>> result = executor.submit(() -> loopback.await("good", 10_000));
            String shown = page(port, "/auth/callback?state=good&error=access_denied");
            assertTrue(shown.startsWith("HTTP/1.1 200"));
            assertTrue(shown.contains("ChatGPT에 로그인하지 않았어요"));
            assertTrue(!shown.contains("로그인을 마쳤어요"));
            assertTrue(shown.contains("href='dev.example.app://chatgpt'>앱으로 돌아가기</a>"));
            assertEquals("access_denied", result.get(5, TimeUnit.SECONDS).get("error"));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test public void closeEndsGraceAndRejectsUnsafeReturnLink() throws Exception {
        ChatGptLoopback loopback = new ChatGptLoopback();
        CountDownLatch done = new CountDownLatch(1);
        loopback.linger("s", 60_000, done::countDown);
        loopback.close();
        assertTrue(done.await(5, TimeUnit.SECONDS));
        assertThrows(IllegalArgumentException.class, () -> new ChatGptLoopback("javascript:alert(1)"));
        assertThrows(IllegalArgumentException.class, () -> new ChatGptLoopback("app://x'><script>"));
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
