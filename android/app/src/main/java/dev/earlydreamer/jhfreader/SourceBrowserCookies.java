package dev.earlydreamer.jhfreader;

import java.io.IOException;
import java.net.CookieHandler;
import java.net.URI;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Capacitor's CapacitorCookies always installs a process-wide CookieHandler backed by the WebView cookie jar,
 * and HttpURLConnection consults it. Wrap it so source-site requests neither send nor store cookies, while the
 * app's own native HTTP keeps the original behaviour.
 */
final class SourceBrowserCookies extends CookieHandler {
    private final CookieHandler app;

    private SourceBrowserCookies(CookieHandler app) {
        this.app = app;
    }

    /** Idempotent. Call before each source browser session; a recreated Bridge may have replaced the default. */
    static synchronized void isolate() {
        CookieHandler current = CookieHandler.getDefault();
        if (!(current instanceof SourceBrowserCookies)) CookieHandler.setDefault(new SourceBrowserCookies(current));
    }

    private static boolean sourceSite(URI uri) {
        return uri != null && uri.getHost() != null && SourceSites.allHosts().contains(uri.getHost().toLowerCase(Locale.ROOT));
    }

    @Override public Map<String, List<String>> get(URI uri, Map<String, List<String>> requestHeaders) throws IOException {
        if (sourceSite(uri) || app == null) return Collections.emptyMap();
        return app.get(uri, requestHeaders);
    }

    @Override public void put(URI uri, Map<String, List<String>> responseHeaders) throws IOException {
        if (sourceSite(uri) || app == null) return;
        app.put(uri, responseHeaders);
    }
}
