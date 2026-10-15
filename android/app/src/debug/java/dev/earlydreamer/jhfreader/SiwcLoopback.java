package dev.earlydreamer.jhfreader;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.CancellationException;

/** Activity.onPause 동안 유지하되, 취소·종료·5분 제한에 닫는 일회용 loopback. */
final class SiwcLoopback implements AutoCloseable {
    private final ServerSocket server;
    private volatile Socket accepted;
    private volatile boolean closed;

    SiwcLoopback() throws Exception {
        server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        server.setSoTimeout(250);
    }

    String redirect() { return "http://127.0.0.1:" + server.getLocalPort() + "/auth/callback"; }

    private static String line(InputStream input, int[] budget) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        while (--budget[0] >= 0) {
            int value = input.read();
            if (value < 0) throw new IllegalArgumentException("incomplete HTTP");
            if (value == '\n') {
                byte[] data = bytes.toByteArray();
                if (data.length == 0 || data[data.length - 1] != '\r') throw new IllegalArgumentException("HTTP lines");
                return new String(data, 0, data.length - 1, StandardCharsets.US_ASCII);
            }
            if (value > 127) throw new IllegalArgumentException("HTTP encoding");
            bytes.write(value);
        }
        throw new IllegalArgumentException("HTTP size");
    }

    Map<String, String> await(String state, long deadlineMillis) throws Exception {
        while (!closed && android.os.SystemClock.elapsedRealtime() < deadlineMillis) {
            try (Socket socket = server.accept()) {
                accepted = socket;
                socket.setSoTimeout(800);
                boolean matched = false;
                Map<String, String> query = null;
                try {
                    int[] budget = {12288};
                    String[] request = line(socket.getInputStream(), budget).split(" ", -1);
                    if (request.length != 3 || !"GET".equals(request[0]) || !"HTTP/1.1".equals(request[2]))
                        throw new IllegalArgumentException("HTTP request");
                    String host = null;
                    for (String header; !(header = line(socket.getInputStream(), budget)).isEmpty();) {
                        int colon = header.indexOf(':');
                        if (colon < 1) throw new IllegalArgumentException("HTTP header");
                        String name = header.substring(0, colon).toLowerCase(java.util.Locale.ROOT);
                        if ("host".equals(name)) {
                            if (host != null) throw new IllegalArgumentException("duplicate host");
                            host = header.substring(colon + 1).trim();
                        }
                        if ("transfer-encoding".equals(name) || "content-length".equals(name))
                            throw new IllegalArgumentException("HTTP body");
                    }
                    if (!("127.0.0.1:" + server.getLocalPort()).equals(host)) throw new IllegalArgumentException("host");
                    query = SiwcProtocol.query(request[1]);
                    matched = SiwcProtocol.equal(state, query.get("state"));
                } catch (Exception ignored) { /* 요청 URL·헤더·코드는 기록하지 않는다. */ }
                byte[] body = (matched
                    ? "<!doctype html><meta name=viewport content='width=device-width'><title>JHF</title><p>Callback received. Return to JHF SiwC probe to check the result.</p>"
                    : "<!doctype html><title>JHF</title><p>Invalid callback.</p>").getBytes(StandardCharsets.UTF_8);
                try {
                    socket.getOutputStream().write(((matched ? "HTTP/1.1 200 OK" : "HTTP/1.1 400 Bad Request")
                        + "\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                        + "Content-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nReferrer-Policy: no-referrer\r\n"
                        + "Connection: close\r\nContent-Length: " + body.length + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(body);
                    socket.getOutputStream().flush();
                } catch (Exception ignored) { /* 콜백 처리 뒤 브라우저 연결 단절은 재교환 사유가 아니다. */ }
                if (matched && !closed) {
                    close();
                    return query;
                }
            } catch (SocketTimeoutException ignored) {
                // 잘못된 요청과 느린 연결은 현재 시도를 인증하지 않는다.
            } finally { accepted = null; }
        }
        if (closed) throw new CancellationException();
        close();
        throw new java.util.concurrent.TimeoutException();
    }

    public void close() {
        closed = true;
        try { server.close(); } catch (Exception ignored) { }
        Socket socket = accepted;
        if (socket != null) try { socket.close(); } catch (Exception ignored) { }
    }
}
