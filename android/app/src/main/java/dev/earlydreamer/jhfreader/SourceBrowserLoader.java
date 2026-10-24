package dev.earlydreamer.jhfreader;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Collections;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/**
 * Anonymous browser GETs only. No model transport, auth headers, cookie store or automatic redirects.
 * Page scripts run, so every final response carries the site profile CSP that keeps page connections inside this loader.
 */
public final class SourceBrowserLoader {
    private static final int MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final Pattern CHARSET = Pattern.compile("(?:^|;)\\s*charset\\s*=\\s*\"?([^;\\s\"]+)", Pattern.CASE_INSENSITIVE);
    private final Fetcher fetcher;

    interface Fetcher {
        /** requestHeaders는 사이트 프로필이 허용한 페이지 헤더뿐이다. */
        Resource fetch(URI uri, Map<String, String> requestHeaders) throws IOException;
    }

    static final class Resource {
        final URI uri;
        final int status;
        final String mimeType;
        final String encoding;
        final Map<String, String> headers;
        final byte[] body;

        Resource(URI uri, int status, String mimeType, String encoding, Map<String, String> headers, byte[] body) {
            this.uri = uri;
            this.status = status;
            this.mimeType = mimeType;
            this.encoding = encoding;
            this.headers = headers;
            this.body = body;
        }
    }

    public SourceBrowserLoader(String userAgent) {
        this((uri, headers) -> fetchHttps(uri, userAgent, headers));
    }

    SourceBrowserLoader(Fetcher fetcher) {
        this.fetcher = fetcher;
    }

    Resource load(URI input, String method) throws IOException {
        return load(input, method, Collections.emptyMap());
    }

    Resource load(URI input, String method, Map<String, String> pageHeaders) throws IOException {
        if (!"GET".equals(method)) return denied(input);
        SourceSites.Site origin = SourceSites.forHost(input.getHost());
        URI current = input;
        Set<String> visited = new HashSet<>();
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            String safe = SourceBrowserPolicy.browseUrl(current.toString());
            if (safe == null || !visited.add(safe)) return denied(current);
            current = URI.create(safe);
            // A redirect into another site profile drops the page headers instead of re-filtering them.
            SourceSites.Site site = SourceSites.forHost(current.getHost());
            Map<String, String> forwarded = site != null && site == origin ? site.forwardHeaders(pageHeaders) : Collections.emptyMap();
            Resource result = fetcher.fetch(current, forwarded);
            if (result.status < 300 || result.status >= 400) return finalResponse(result);
            if (redirects == MAX_REDIRECTS || !isRedirectStatus(result.status)) return denied(current);
            String location = header(result.headers, "Location");
            if (location == null) return denied(current);
            try { current = current.resolve(location); }
            catch (IllegalArgumentException invalid) { return denied(current); }
            // Every subsequent destination is checked before fetcher sees it.
        }
        return denied(current);
    }

    private static boolean isRedirectStatus(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }

    static Resource denied(URI uri) {
        return new Resource(uri, 403, "text/plain", "UTF-8", responseHeaders(uri, null), "이 주소나 요청 방식은 앱 안 탐색에서 지원하지 않아요.".getBytes(StandardCharsets.UTF_8));
    }

    /** Only no-store, the profile CSP and the origin server's CORS allowance reach the WebView. */
    private static Resource finalResponse(Resource result) {
        return new Resource(result.uri, result.status, result.mimeType, result.encoding,
            responseHeaders(result.uri, header(result.headers, "Access-Control-Allow-Origin")), result.body);
    }

    private static Map<String, String> responseHeaders(URI uri, String allowOrigin) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("Content-Security-Policy", SourceSites.csp(uri));
        if (allowOrigin != null) headers.put("Access-Control-Allow-Origin", allowOrigin);
        return headers;
    }

    private static String header(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey())) return entry.getValue();
        }
        return null;
    }

    private static Resource fetchHttps(URI uri, String userAgent, Map<String, String> requestHeaders) throws IOException {
        HttpsURLConnection connection = (HttpsURLConnection) uri.toURL().openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("GET");
        connection.setUseCaches(false);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,image/*,text/css,*/*;q=0.8");
        connection.setRequestProperty("User-Agent", userAgent);
        for (Map.Entry<String, String> header : requestHeaders.entrySet()) connection.setRequestProperty(header.getKey(), header.getValue());
        try {
            int status = connection.getResponseCode();
            Map<String, String> headers = new HashMap<>();
            String location = connection.getHeaderField("Location");
            if (location != null) headers.put("Location", location);
            String allowOrigin = connection.getHeaderField("Access-Control-Allow-Origin");
            if (allowOrigin != null) headers.put("Access-Control-Allow-Origin", allowOrigin);
            String contentType = connection.getContentType();
            String mime = contentType == null ? "application/octet-stream" : contentType.split(";", 2)[0].trim();
            Matcher charset = CHARSET.matcher(contentType == null ? "" : contentType);
            String encoding = charset.find() ? charset.group(1) : "UTF-8";
            if (status >= 300 && status < 400) return new Resource(uri, status, mime, encoding, headers, new byte[0]);
            if (connection.getContentLengthLong() > MAX_RESOURCE_BYTES) throw new IOException("Resource exceeds browser limit");
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            if (stream != null) {
                try (InputStream input = stream) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (body.size() + count > MAX_RESOURCE_BYTES) throw new IOException("Resource exceeds browser limit");
                        body.write(buffer, 0, count);
                    }
                }
            }
            return new Resource(uri, status, mime, encoding, headers, body.toByteArray());
        } finally {
            connection.disconnect();
        }
    }
}
