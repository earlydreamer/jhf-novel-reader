package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import java.net.CookieHandler;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;

public class SourceBrowserCookiesTest {
    /** Stands in for Capacitor's process-wide CookieHandler backed by the WebView cookie jar. */
    private static final class RecordingJar extends CookieHandler {
        final List<String> gets = new ArrayList<>();
        final List<String> puts = new ArrayList<>();
        @Override public Map<String, List<String>> get(URI uri, Map<String, List<String>> requestHeaders) {
            gets.add(uri.getHost());
            return Collections.singletonMap("Cookie", Collections.singletonList("uid=1"));
        }
        @Override public void put(URI uri, Map<String, List<String>> responseHeaders) {
            puts.add(uri.getHost());
        }
    }

    private CookieHandler original;
    private RecordingJar jar;

    @Before public void installAppJar() {
        original = CookieHandler.getDefault();
        jar = new RecordingJar();
        CookieHandler.setDefault(jar);
    }

    @After public void restore() {
        CookieHandler.setDefault(original);
    }

    @Test public void profileHostsNeverReadOrWriteTheAppCookieJar() throws Exception {
        SourceBrowserCookies.isolate();
        CookieHandler handler = CookieHandler.getDefault();
        assertEquals(Collections.emptyMap(), handler.get(URI.create("https://ncode.syosetu.com/n1234ab/"), Collections.emptyMap()));
        handler.put(URI.create("https://syosetu.com/"), Collections.singletonMap("Set-Cookie", Collections.singletonList("uid=2")));
        assertEquals(Collections.emptyList(), jar.gets);
        assertEquals(Collections.emptyList(), jar.puts);
    }

    @Test public void otherHostsStillUseTheAppCookieJar() throws Exception {
        SourceBrowserCookies.isolate();
        CookieHandler handler = CookieHandler.getDefault();
        assertEquals("uid=1", handler.get(URI.create("https://model.example/v1"), Collections.emptyMap()).get("Cookie").get(0));
        handler.put(URI.create("https://model.example/v1"), Collections.emptyMap());
        assertEquals(Collections.singletonList("model.example"), jar.gets);
        assertEquals(Collections.singletonList("model.example"), jar.puts);
    }

    @Test public void isolationIsIdempotent() {
        SourceBrowserCookies.isolate();
        CookieHandler first = CookieHandler.getDefault();
        SourceBrowserCookies.isolate();
        assertSame(first, CookieHandler.getDefault());
    }

    @Test public void productionLoaderIsolatesCookiesWhenCreated() {
        new SourceBrowserLoader("test-agent");
        assertTrue(CookieHandler.getDefault() instanceof SourceBrowserCookies);
    }
}
