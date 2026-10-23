package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicInteger;
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
        SourceBrowserLoader loader = new SourceBrowserLoader(uri -> {
            calls.incrementAndGet();
            return new SourceBrowserLoader.Resource(uri, 302, "text/html", "UTF-8", Collections.singletonMap("Location", "https://127.0.0.1/model"), new byte[0]);
        });
        assertEquals(403, loader.load(URI.create("https://syosetu.com/"), "GET").status);
        assertEquals(1, calls.get());
    }
    @Test public void allRedirectHopsAreValidatedAndCrossHostPublicRedirectsWork() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SourceBrowserLoader loader = new SourceBrowserLoader(uri -> {
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
        SourceBrowserLoader loader = new SourceBrowserLoader(uri -> { calls.incrementAndGet(); throw new AssertionError(); });
        assertEquals(403, loader.load(URI.create("https://127.0.0.1/"), "GET").status);
        assertEquals(403, loader.load(URI.create("https://syosetu.com/"), "POST").status);
        assertEquals(0, calls.get());
    }
    @Test public void redirectLoopsStopWithoutAnUnboundedRequestSequence() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        SourceBrowserLoader loader = new SourceBrowserLoader(uri -> { calls.incrementAndGet(); return new SourceBrowserLoader.Resource(uri, 302, "text/html", "UTF-8", Collections.singletonMap("Location", "/"), new byte[0]); });
        assertEquals(403, loader.load(URI.create("https://syosetu.com/"), "GET").status);
        assertEquals(1, calls.get());
    }
}
