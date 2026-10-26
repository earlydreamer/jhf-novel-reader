package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import java.net.URI;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.regex.Pattern;
import org.junit.Test;

public class SourceSitesTest {
    @Test public void narouProfileOwnsItsHostsAndAllowsScripts() {
        SourceSites.Site narou = SourceSites.forHost("ncode.syosetu.com");
        assertEquals("narou", narou.id);
        assertEquals("https://syosetu.com/", narou.startUrl);
        assertTrue(narou.scripts);
        assertEquals(new HashSet<>(Arrays.asList("syosetu.com", "www.syosetu.com", "yomou.syosetu.com", "ncode.syosetu.com", "static.syosetu.com")), SourceSites.allHosts());
        assertNull(SourceSites.forHost("api.syosetu.com"));
    }

    @Test public void cspListsEveryProfileHostAndLimitsScriptsOutsideProfiles() {
        String narou = SourceSites.csp(URI.create("https://yomou.syosetu.com/rank/top/"));
        assertEquals("connect-src https://ncode.syosetu.com https://static.syosetu.com https://syosetu.com https://www.syosetu.com https://yomou.syosetu.com; worker-src 'none'; object-src 'none'", narou);
        assertTrue(SourceSites.csp(URI.create("https://evil.test/")).endsWith("; script-src 'none'"));
    }

    @Test public void headerRulesRejectCredentialsAndFilterCaseInsensitively() {
        try {
            new SourceSites.Site("x", "https://x.test/", Collections.singleton("x.test"), Collections.singletonMap("Cookie", SourceSites.defaultValue()), true, uri -> null);
            fail("Cookie must never be forwardable");
        } catch (IllegalArgumentException expected) {
            // 자격 증명 헤더는 허용 목록에 넣을 수 없다.
        }
        SourceSites.Site site = new SourceSites.Site("x", "https://x.test/", Collections.singleton("x.test"), Collections.singletonMap("Content-Type", Pattern.compile("application/json")), true, uri -> null);
        Map<String, String> page = new HashMap<>();
        page.put("content-type", "application/json");
        page.put("Cookie", "a=b");
        page.put("X-Other", "1");
        assertEquals(Collections.singletonMap("Content-Type", "application/json"), site.forwardHeaders(page));
        assertEquals(Collections.emptyMap(), site.forwardHeaders(Collections.singletonMap("Content-Type", "text/plain")));
        assertEquals(Collections.emptyMap(), SourceSites.forHost("syosetu.com").forwardHeaders(page));
    }

    @Test public void defaultHeaderValueIsPrintableAsciiUpTo128() {
        Pattern value = SourceSites.defaultValue();
        assertTrue(value.matcher("true").matches());
        assertFalse(value.matcher("").matches());
        assertFalse(value.matcher("a\r\nb").matches());
        assertFalse(value.matcher(new String(new char[129]).replace('\0', 'a')).matches());
    }

    @Test public void protocolAndCredentialHeadersCanNeverBeAllowlisted() {
        for (String name : new String[] { "Proxy-Authorization", "Cookie2", "Host", "Accept", "User-Agent" }) {
            try {
                new SourceSites.Site("x", "https://x.test/", Collections.singleton("x.test"), Collections.singletonMap(name, SourceSites.defaultValue()), true, uri -> null);
                fail(name + " must not be forwardable");
            } catch (IllegalArgumentException expected) {
                // 자격 증명·프로토콜 헤더와 loader가 정하는 헤더는 페이지가 바꿀 수 없다.
            }
        }
    }
}
