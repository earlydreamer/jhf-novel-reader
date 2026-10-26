package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class SourceBrowserPolicyTest {
    @Test public void publicNavigationAndImportHaveIndependentBoundaries() {
        assertEquals("https://yomou.syosetu.com/search.php?word=%E9%BE%8D", SourceBrowserPolicy.browseUrl("https://yomou.syosetu.com/search.php?word=%E9%BE%8D"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://yomou.syosetu.com/search.php"));
        assertEquals("https://ncode.syosetu.com/n1234ab/2/", SourceBrowserPolicy.selectedUrl("https://ncode.syosetu.com/N1234AB/2#p2"));
        assertEquals("https://ncode.syosetu.com/n1234ab/?p=2", SourceBrowserPolicy.selectedUrl("https://ncode.syosetu.com/n1234ab/?p=2"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://ncode.syosetu.com/n1234ab/2/?p=2"));
    }
    @Test public void kakuyomuWorkAndEpisodeSelectionKeepsDigitStringIds() {
        assertEquals("https://kakuyomu.jp/works/16816452219389165420", SourceBrowserPolicy.selectedUrl("https://kakuyomu.jp/works/16816452219389165420/#top"));
        assertEquals("https://kakuyomu.jp/works/16816452219389165420/episodes/16816452219389165999", SourceBrowserPolicy.selectedUrl("https://kakuyomu.jp/works/16816452219389165420/episodes/16816452219389165999"));
        assertEquals("https://kakuyomu.jp/search?q=%E9%BE%8D", SourceBrowserPolicy.browseUrl("https://kakuyomu.jp/search?q=%E9%BE%8D"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://kakuyomu.jp/search?q=x"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://kakuyomu.jp/works/123?utm=x"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://kakuyomu.jp/works/0123"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://cdn-static.kakuyomu.jp/works/123"));
        assertNull(SourceBrowserPolicy.browseUrl("https://kakuyomu.jp.evil.test/works/123"));
    }
    @Test public void forgedSchemesHostsAndPathsAreRejectedBeforeRequests() {
        for (String value : new String[] { "http://syosetu.com/", "https://127.0.0.1/", "https://100.64.1.2/", "https://syosetu.com.evil.test/", "https://u:p@syosetu.com/", "https://syosetu.com:443/", "file:///etc/passwd", "content://app/", "javascript:alert(1)", "intent://open", "https://syosetu.com/../secret", "https://syosetu.com/%2e%2e/secret" }) {
            assertNull(value, SourceBrowserPolicy.browseUrl(value));
        }
        assertNull(SourceBrowserPolicy.selectedUrl("https://ncode.syosetu.com/n1234ab/0/"));
        assertNull(SourceBrowserPolicy.selectedUrl("https://ncode.syosetu.com/n1234ab/9007199254740992/"));
    }
    @Test public void forbiddenRedirectNeverReachesTheFetcher() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SourceBrowserLoader loader = new SourceBrowserLoader((uri, headers) -> {
            calls.incrementAndGet();
            return new SourceBrowserLoader.Resource(uri, 302, "text/html", "UTF-8", Collections.singletonMap("Location", "https://127.0.0.1/model"), new byte[0]);
        });
        assertEquals(403, loader.load(URI.create("https://syosetu.com/"), "GET").status);
        assertEquals(1, calls.get());
    }
    @Test public void allRedirectHopsAreValidatedAndCrossHostPublicRedirectsWork() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SourceBrowserLoader loader = new SourceBrowserLoader((uri, headers) -> {
            calls.incrementAndGet();
            if (uri.getHost().equals("syosetu.com")) return new SourceBrowserLoader.Resource(uri, 301, "text/html", "UTF-8", Collections.singletonMap("Location", "https://yomou.syosetu.com/rank/list/"), new byte[0]);
            return new SourceBrowserLoader.Resource(uri, 200, "text/html", "UTF-8", Collections.emptyMap(), "ranking".getBytes(StandardCharsets.UTF_8));
        });
        SourceBrowserLoader.Resource result = loader.load(URI.create("https://syosetu.com/"), "GET");
        assertEquals(200, result.status);
        assertEquals("https://yomou.syosetu.com/rank/list/", result.uri.toString());
        assertEquals(2, calls.get());
    }
    @Test public void initialForbiddenAndPostRequestsDoNotReachTheFetcher() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SourceBrowserLoader loader = new SourceBrowserLoader((uri, headers) -> { calls.incrementAndGet(); throw new AssertionError(); });
        assertEquals(403, loader.load(URI.create("https://127.0.0.1/"), "GET").status);
        assertEquals(403, loader.load(URI.create("https://syosetu.com/"), "POST").status);
        assertEquals(0, calls.get());
    }
    @Test public void redirectLoopsStopWithoutAnUnboundedRequestSequence() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SourceBrowserLoader loader = new SourceBrowserLoader((uri, headers) -> { calls.incrementAndGet(); return new SourceBrowserLoader.Resource(uri, 302, "text/html", "UTF-8", Collections.singletonMap("Location", "/"), new byte[0]); });
        assertEquals(403, loader.load(URI.create("https://syosetu.com/"), "GET").status);
        assertEquals(1, calls.get());
    }

    private static SourceBrowserLoader serving(Map<String, String> upstream) {
        return new SourceBrowserLoader((uri, headers) -> new SourceBrowserLoader.Resource(uri, 200, "font/woff", "UTF-8", upstream, new byte[0]));
    }
    @Test public void finalResponsesCarryProfileCspAndUpstreamAllowOriginOnly() throws Exception {
        Map<String, String> got = serving(Collections.singletonMap("Access-Control-Allow-Origin", "*")).load(URI.create("https://static.syosetu.com/icon.woff"), "GET").headers;
        assertEquals("*", got.get("Access-Control-Allow-Origin"));
        assertEquals(SourceSites.csp(URI.create("https://static.syosetu.com/")), got.get("Content-Security-Policy"));
        assertEquals("no-store", got.get("Cache-Control"));
        assertEquals(3, got.size());
    }
    @Test public void absentAllowOriginIsNeverSynthesized() throws Exception {
        Map<String, String> got = serving(Collections.emptyMap()).load(URI.create("https://syosetu.com/"), "GET").headers;
        assertFalse(got.containsKey("Access-Control-Allow-Origin"));
        assertEquals(2, got.size());
    }
    @Test public void onlyAllowedResponseHeadersSurvive() throws Exception {
        Map<String, String> upstream = new HashMap<>();
        upstream.put("Set-Cookie", "a=b");
        upstream.put("Content-Security-Policy", "script-src *");
        upstream.put("Location", "https://syosetu.com/elsewhere");
        Map<String, String> got = serving(upstream).load(URI.create("https://syosetu.com/"), "GET").headers;
        assertFalse(got.containsKey("Set-Cookie"));
        assertFalse(got.containsKey("Location"));
        assertEquals(SourceSites.csp(URI.create("https://syosetu.com/")), got.get("Content-Security-Policy"));
    }
    @Test public void deniedResponsesCarryScriptlessCsp() {
        String csp = SourceBrowserLoader.denied(URI.create("https://evil.test/")).headers.get("Content-Security-Policy");
        assertNotNull(csp);
        assertTrue(csp.endsWith("; script-src 'none'"));
    }
    @Test public void redirectedResponseUsesFinalUriPolicy() throws Exception {
        SourceBrowserLoader loader = new SourceBrowserLoader((uri, headers) -> {
            if (uri.getHost().equals("syosetu.com")) return new SourceBrowserLoader.Resource(uri, 301, "text/html", "UTF-8", Collections.singletonMap("Location", "https://yomou.syosetu.com/rank/top/"), new byte[0]);
            return new SourceBrowserLoader.Resource(uri, 200, "text/html", "UTF-8", Collections.emptyMap(), new byte[0]);
        });
        SourceBrowserLoader.Resource result = loader.load(URI.create("https://syosetu.com/"), "GET");
        assertEquals(SourceSites.csp(URI.create("https://yomou.syosetu.com/rank/top/")), result.headers.get("Content-Security-Policy"));
    }
    @Test public void pageHeadersAreFilteredByTheRequestSiteBeforeTheFetcher() throws Exception {
        AtomicReference<Map<String, String>> sent = new AtomicReference<>();
        SourceBrowserLoader loader = new SourceBrowserLoader((uri, headers) -> { sent.set(headers); return new SourceBrowserLoader.Resource(uri, 200, "text/html", "UTF-8", Collections.emptyMap(), new byte[0]); });
        Map<String, String> page = new HashMap<>();
        page.put("Content-Type", "application/json");
        page.put("Cookie", "a=b");
        page.put("Authorization", "Bearer x");
        loader.load(URI.create("https://syosetu.com/"), "GET", page);
        assertEquals(Collections.emptyMap(), sent.get());
    }
}
