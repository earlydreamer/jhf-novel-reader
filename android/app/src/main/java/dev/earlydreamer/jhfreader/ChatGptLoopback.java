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
 * 콜백을 받은 뒤에도 잠시 열어 두어, 브라우저가 같은 콜백을 다시 열면 연결 거부 대신 완료 페이지를 보여 준다.
 */
final class ChatGptLoopback implements AutoCloseable {
    private final ServerSocket server;
    private final String returnUrl;
    private volatile Socket accepted;
    private volatile boolean closed;
    private volatile boolean lingering;

    /** returnUrl은 완료 페이지의 앱 복귀 링크다. 없으면 링크를 넣지 않는다. */
    ChatGptLoopback(String returnUrl) throws Exception {
        if (returnUrl != null && !returnUrl.matches("[a-z][a-z0-9.+-]*://[a-z0-9/-]*"))
            throw new IllegalArgumentException("return url");
        this.returnUrl = returnUrl;
        server = new ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"));
        server.setSoTimeout(250);
    }

    ChatGptLoopback() throws Exception { this(null); }

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
                Map<String, String> query = serve(socket, state);
                if (query != null && !closed) return query;
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

    /**
     * 콜백을 받은 뒤 millis 동안 같은 콜백에 완료 페이지로 답하고 닫는다. 그 사이 close()를 부르면 바로 닫는다.
     * 닫은 뒤 done을 부른다.
     */
    void linger(String state, long millis, Runnable done) {
        lingering = true;
        Thread thread = new Thread(() -> {
            long deadline = System.nanoTime() + millis * 1_000_000L;
            try {
                while (!closed && System.nanoTime() < deadline) {
                    try (Socket socket = server.accept()) {
                        accepted = socket;
                        serve(socket, state);
                    } catch (Exception ignored) {
                        // 제한 시간 확인을 위해 깨어나거나, 닫혀서 끝난다.
                    } finally {
                        accepted = null;
                    }
                }
            } finally {
                close();
                done.run();
            }
        }, "chatgpt-loopback-linger");
        thread.setDaemon(true);
        thread.start();
    }

    boolean lingering() { return lingering; }

    /** 요청 하나에 답하고, state가 맞는 콜백이면 질의를 돌려준다. */
    private Map<String, String> serve(Socket socket, String state) throws Exception {
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
        respond(socket, matched, matched && query.containsKey("error"));
        return matched ? query : null;
    }

    /** 앱 디자인 토큰(src/ui/theme/tokens.css)의 라이트·다크 색을 쓴다. 스크립트와 외부 자원은 없다. */
    private static final String PAGE_STYLE = "<style>"
        + ":root{color-scheme:light dark;--bg:#fafafd;--card:#ffffff;--fg:#1a1a28;--sub:#45465c;"
        + "--line:#c9c9da;--pri:#3f4199;--on-pri:#ffffff;--tint:#e3e3fa;--err:#901c16;--err-tint:#fce4e2}"
        + "@media (prefers-color-scheme:dark){:root{--bg:#13131b;--card:#1f1f2a;--fg:#eeeef6;--sub:#c9c9dc;"
        + "--line:#464659;--pri:#d2d3ff;--on-pri:#1a1b55;--tint:#3b3c8f;--err:#ffc4bc;--err-tint:#8c0009}}"
        + "*{box-sizing:border-box}"
        + "body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;"
        + "background:var(--bg);color:var(--fg);word-break:keep-all;font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif}"
        + "main{width:100%;max-width:360px;padding:32px 24px;border-radius:28px;background:var(--card);"
        + "border:1px solid var(--line);text-align:center}"
        + ".mark{width:56px;height:56px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;"
        + "justify-content:center;background:var(--tint);color:var(--pri)}"
        + ".mark.err{background:var(--err-tint);color:var(--err)}"
        + ".app{margin:0 0 8px;font-size:13px;color:var(--sub)}"
        + "h1{margin:0 0 12px;font-size:22px;line-height:1.35;font-weight:700}"
        + "p.body{margin:0;font-size:15px;line-height:1.6;color:var(--sub)}"
        + "a.btn{display:block;margin-top:28px;padding:14px 20px;border-radius:999px;background:var(--pri);"
        + "color:var(--on-pri);font-size:16px;font-weight:600;text-decoration:none}"
        + "</style>";

    private static String page(String mark, String title, String body, String action) {
        return "<!doctype html><html lang=ko><meta charset=utf-8>"
            + "<meta name=viewport content='width=device-width,initial-scale=1'>"
            + "<title>JHF Novel Reader</title>" + PAGE_STYLE + "<main>" + mark
            + "<p class=app>JHF Novel Reader</p><h1>" + title + "</h1><p class=body>" + body + "</p>"
            + action + "</main></html>";
    }

    private static final String CHECK = "<div class=mark aria-hidden=true><svg width=28 height=28 viewBox='0 0 24 24'"
        + " fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round stroke-linejoin=round>"
        + "<path d='M5 12.5l4.5 4.5L19 7.5'/></svg></div>";
    private static final String CROSS = "<div class='mark err' aria-hidden=true><svg width=28 height=28"
        + " viewBox='0 0 24 24' fill=none stroke=currentColor stroke-width=2.5 stroke-linecap=round>"
        + "<path d='M7 7l10 10M17 7L7 17'/></svg></div>";

    private void respond(Socket socket, boolean matched, boolean refused) {
        String back = returnUrl == null ? "" : "<a class=btn href='" + returnUrl + "'>앱으로 돌아가기</a>";
        String html;
        if (!matched) {
            html = page(CROSS, "잘못된 요청이에요", "앱에서 로그인을 다시 시작해 주세요.", "");
        } else if (refused) {
            html = page(CROSS, "ChatGPT에 로그인하지 않았어요",
                returnUrl == null ? "이 창을 닫고 앱으로 돌아가 주세요." : "앱으로 돌아가 다시 시도할 수 있어요.", back);
        } else {
            html = page(CHECK, "ChatGPT 로그인을 마쳤어요",
                returnUrl == null ? "이 창을 닫고 앱으로 돌아가 주세요." : "앱으로 돌아가면 연결이 끝나요.", back);
        }
        byte[] body = html.getBytes(StandardCharsets.UTF_8);
        try {
            socket.getOutputStream().write(((matched ? "HTTP/1.1 200 OK" : "HTTP/1.1 400 Bad Request")
                + "\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                + "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'\r\n"
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
