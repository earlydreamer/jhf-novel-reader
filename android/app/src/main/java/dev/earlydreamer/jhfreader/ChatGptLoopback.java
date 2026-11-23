package dev.earlydreamer.jhfreader;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CancellationException;
import java.util.concurrent.TimeoutException;

/**
 * 로그인 한 번에 쓰는 127.0.0.1 콜백 수신기. 브라우저로 전환해도 닫지 않고,
 * 유효한 콜백을 한 번 받거나 취소·제한 시간·앱 종료 때 닫는다. 잘못된 요청은 인증하지 않고 다음 요청을 기다린다.
 */
final class ChatGptLoopback implements AutoCloseable {
    private final ServerSocket server;
    private volatile Socket accepted;
    private volatile boolean closed;

    ChatGptLoopback() throws Exception {
        server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        server.setSoTimeout(250);
    }

    int port() { return server.getLocalPort(); }

    String redirect() { return ChatGptProtocol.redirect(port()); }

    private static String line(InputStream input, int[] budget) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        while (--budget[0] >= 0) {
            int value = input.read();
            if (value < 0) throw new ChatGptProtocol.Invalid("incomplete HTTP");
            if (value == '\n') {
                byte[] data = bytes.toByteArray();
                if (data.length == 0 || data[data.length - 1] != '\r')
                    throw new ChatGptProtocol.Invalid("HTTP lines");
                return new String(data, 0, data.length - 1, StandardCharsets.US_ASCII);
            }
            if (value > 127) throw new ChatGptProtocol.Invalid("HTTP encoding");
            bytes.write(value);
        }
        throw new ChatGptProtocol.Invalid("HTTP size");
    }

    /** state가 맞는 콜백의 질의를 돌려준다. 거부 응답도 state가 맞으면 돌려주고 판정은 호출자가 한다. */
    Map<String, String> await(String state, long timeoutMillis) throws Exception {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        while (!closed && System.nanoTime() < deadline) {
            try (Socket socket = server.accept()) {
                accepted = socket;
                socket.setSoTimeout(800);
                boolean matched = false;
                Map<String, String> query = null;
                try {
                    int[] budget = {12288};
                    String[] request = line(socket.getInputStream(), budget).split(" ", -1);
                    if (request.length != 3 || !"GET".equals(request[0]) || !"HTTP/1.1".equals(request[2]))
                        throw new ChatGptProtocol.Invalid("HTTP request");
                    String host = null;
                    for (String header; !(header = line(socket.getInputStream(), budget)).isEmpty();) {
                        int colon = header.indexOf(':');
                        if (colon < 1) throw new ChatGptProtocol.Invalid("HTTP header");
                        String name = header.substring(0, colon).toLowerCase(Locale.ROOT);
                        if ("host".equals(name)) {
                            if (host != null) throw new ChatGptProtocol.Invalid("duplicate host");
                            host = header.substring(colon + 1).trim();
                        }
                        if ("transfer-encoding".equals(name) || "content-length".equals(name))
                            throw new ChatGptProtocol.Invalid("HTTP body");
                    }
                    if (!("127.0.0.1:" + port()).equals(host)) throw new ChatGptProtocol.Invalid("host");
                    query = ChatGptProtocol.query(request[1]);
                    matched = ChatGptProtocol.equal(state, query.get("state"));
                } catch (Exception ignored) {
                    // 요청 주소·헤더·코드는 기록하지 않는다.
                }
                respond(socket, matched);
                if (matched && !closed) {
                    close();
                    return query;
                }
            } catch (SocketTimeoutException ignored) {
                // 기다리는 동안 짧게 깨어나 취소와 제한 시간을 확인한다.
            } catch (java.io.IOException closing) {
                // 취소로 수신기를 닫으면 accept가 소켓 예외로 끝난다. 닫지 않았는데 난 오류는 그대로 알린다.
                if (!closed) throw closing;
            } finally {
                accepted = null;
            }
        }
        boolean cancelled = closed;
        close();
        if (cancelled) throw new CancellationException();
        throw new TimeoutException();
    }

    private static void respond(Socket socket, boolean matched) {
        byte[] body = (matched
            ? "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                + "<title>JHF Novel Reader</title><p>로그인을 마쳤어요. 앱으로 돌아가 주세요.</p>"
            : "<!doctype html><meta charset=utf-8><title>JHF Novel Reader</title><p>잘못된 요청이에요.</p>")
            .getBytes(StandardCharsets.UTF_8);
        try {
            socket.getOutputStream().write(((matched ? "HTTP/1.1 200 OK" : "HTTP/1.1 400 Bad Request")
                + "\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                + "Content-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\n"
                + "Referrer-Policy: no-referrer\r\nConnection: close\r\nContent-Length: " + body.length
                + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().write(body);
            socket.getOutputStream().flush();
        } catch (Exception ignored) {
            // 콜백을 받은 뒤 브라우저 연결이 끊겨도 다시 교환하지 않는다.
        }
    }

    @Override public void close() {
        closed = true;
        try { server.close(); } catch (Exception ignored) { }
        Socket socket = accepted;
        if (socket != null) try { socket.close(); } catch (Exception ignored) { }
    }
}
