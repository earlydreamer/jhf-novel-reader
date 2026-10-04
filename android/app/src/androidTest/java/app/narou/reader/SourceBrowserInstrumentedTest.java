package app.narou.reader;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.pressKey;
import static androidx.test.espresso.matcher.ViewMatchers.withId;
import android.webkit.WebView;
import android.widget.Button;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Synthetic device fixtures only. Compilation is not an executed security check. */
@RunWith(AndroidJUnit4.class)
public class SourceBrowserInstrumentedTest {
    private ActivityScenario<SourceBrowserActivity> launchWithoutNetwork() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        // Missing trusted start URL fails closed. Test fixture loading occurs below, on the UI thread.
        return ActivityScenario.launch(new Intent(context, SourceBrowserActivity.class));
    }

    @Test public void isolatedWebViewHasNoPageBridgeOrLocalAccess() throws Exception {
        try (ActivityScenario<SourceBrowserActivity> scenario = launchWithoutNetwork()) {
            AtomicReference<WebView> browser = new AtomicReference<>();
            scenario.onActivity(activity -> {
                WebView view = activity.findViewById(SourceBrowserActivity.BROWSER_ID);
                browser.set(view);
                assertFalse(view.getSettings().getJavaScriptEnabled());
                assertTrue(view.getSettings().getBlockNetworkLoads());
                assertFalse(view.getSettings().getAllowFileAccess());
                assertFalse(view.getSettings().getAllowContentAccess());
                assertFalse(view.getSettings().getAllowFileAccessFromFileURLs());
                assertFalse(view.getSettings().getAllowUniversalAccessFromFileURLs());
                assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW, view.getSettings().getMixedContentMode());
                view.loadDataWithBaseURL("https://syosetu.com/fixture/", "<html><head><title>Fixture</title></head><body><script>document.title='page-script-executed';</script><iframe srcdoc=\"<script>parent.Capacitor.Plugins.SourceBrowser.open({})</script>\"></iframe></body></html>", "text/html", "UTF-8", null);
            });
            awaitTitle(scenario, "Fixture");
            AtomicReference<String> bridge = new AtomicReference<>();
            CountDownLatch inspected = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                // Instrumentation temporarily enables evaluation only after confirming that page
                // scripts did not execute. Production never enables JavaScript or evaluates code.
                browser.get().getSettings().setJavaScriptEnabled(true);
                browser.get().evaluateJavascript("JSON.stringify([typeof Capacitor,typeof capacitor,typeof cordova,typeof Android,typeof window.webkit])", value -> {
                    bridge.set(value);
                    browser.get().getSettings().setJavaScriptEnabled(false);
                    inspected.countDown();
                });
            });
            assertTrue(inspected.await(3, TimeUnit.SECONDS));
            assertEquals("\"[\\\"undefined\\\",\\\"undefined\\\",\\\"undefined\\\",\\\"undefined\\\",\\\"undefined\\\"]\"", bridge.get());
        }
    }

    @Test public void forbiddenSubresourcesAndPageScriptsSendNoConnectionToControlledTarget() throws Exception {
        try (ConnectionCounter target = new ConnectionCounter(); ActivityScenario<SourceBrowserActivity> scenario = launchWithoutNetwork()) {
            target.positiveControl();
            String destination = "https://127.0.0.1:" + target.port() + "/model";
            String html = "<html><head><title>Forbidden fixture</title></head><body><img src='" + destination + "'><iframe src='" + destination + "'></iframe><script>fetch('" + destination + "');new WebSocket('wss://127.0.0.1:" + target.port() + "/model');</script></body></html>";
            scenario.onActivity(activity -> {
                WebView view = activity.findViewById(SourceBrowserActivity.BROWSER_ID);
                view.loadDataWithBaseURL("https://syosetu.com/fixture/", html, "text/html", "UTF-8", null);
            });
            awaitTitle(scenario, "Forbidden fixture");
            Thread.sleep(500);
            assertEquals("Forbidden target received a connection", 1, target.count.get());
        }
    }

    @Test public void nonHttpsAndForgedNativeSelectionStayDisabled() {
        try (ActivityScenario<SourceBrowserActivity> scenario = launchWithoutNetwork()) {
            scenario.onActivity(activity -> {
                Button open = activity.findViewById(SourceBrowserActivity.OPEN_ID);
                assertFalse(open.isEnabled());
                for (String url : new String[] { "file:///etc/passwd", "content://app/private", "javascript:alert(1)", "intent://open", "https://ncode.syosetu.com.evil.test/n1234ab/", "https://ncode.syosetu.com/n1234ab/2/?p=2" }) {
                    assertNull(SourceBrowserPolicy.selectedUrl(url));
                }
                assertNotNull(activity.findViewById(SourceBrowserActivity.BACK_ID));
                assertNotNull(activity.findViewById(SourceBrowserActivity.CLOSE_ID));
            });
        }
    }

    @Test public void htmlSearchRankingLinksAndNativeBackKeepTheirHistory() throws Exception {
        List<String> requests = new CopyOnWriteArrayList<>();
        SourceBrowserLoader fixtureLoader = new SourceBrowserLoader(uri -> {
            requests.add(uri.toString());
            String title;
            String body;
            if (uri.getHost().equals("ncode.syosetu.com")) {
                title = "Work fixture";
                body = "<h1>合成作品</h1>";
            } else if (uri.getPath().equals("/fixture/rank")) {
                title = "Ranking fixture";
                body = "<a href='https://ncode.syosetu.com/n1234ab/'>合成作品</a>";
            } else if (uri.getPath().equals("/search.php") && uri.getQuery() != null) {
                title = "Search results fixture";
                body = "<a href='https://ncode.syosetu.com/n1234ab/2/'>検索結果</a>";
            } else if (uri.getPath().equals("/search.php")) {
                title = "Search fixture";
                body = "<form method='get' action='/search.php'><input name='word' value='syntheticword'><input type='submit' value='検索'></form>";
            } else {
                title = "Home fixture";
                body = "<a href='https://yomou.syosetu.com/fixture/rank'>ランキング</a>";
            }
            byte[] html = ("<html><head><title>" + title + "</title></head><body>" + body + "</body></html>").getBytes(StandardCharsets.UTF_8);
            return new SourceBrowserLoader.Resource(uri, 200, "text/html", "UTF-8", Collections.emptyMap(), html);
        });
        try (ActivityScenario<SourceBrowserActivity> scenario = launchWithoutNetwork()) {
            scenario.onActivity(activity -> {
                try {
                    // Replace the ordinary constructor-injected transport only in the fixture.
                    // No test controls or JavaScript bridge are added to production code.
                    java.lang.reflect.Field field = SourceBrowserActivity.class.getDeclaredField("loader");
                    field.setAccessible(true);
                    field.set(activity, fixtureLoader);
                } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
                WebView view = activity.findViewById(SourceBrowserActivity.BROWSER_ID);
                view.loadUrl("https://syosetu.com/fixture/home");
                view.requestFocus();
            });
            awaitTitle(scenario, "Home fixture");
            onView(withId(SourceBrowserActivity.BROWSER_ID)).perform(pressKey(KeyEvent.KEYCODE_TAB), pressKey(KeyEvent.KEYCODE_ENTER));
            awaitTitle(scenario, "Ranking fixture");
            onView(withId(SourceBrowserActivity.BROWSER_ID)).perform(pressKey(KeyEvent.KEYCODE_TAB), pressKey(KeyEvent.KEYCODE_ENTER));
            awaitTitle(scenario, "Work fixture");
            scenario.onActivity(activity -> {
                assertTrue(((Button) activity.findViewById(SourceBrowserActivity.OPEN_ID)).isEnabled());
                activity.findViewById(SourceBrowserActivity.BACK_ID).performClick();
            });
            awaitTitle(scenario, "Ranking fixture");
            scenario.onActivity(activity -> ((WebView) activity.findViewById(SourceBrowserActivity.BROWSER_ID)).loadUrl("https://yomou.syosetu.com/search.php"));
            awaitTitle(scenario, "Search fixture");
            onView(withId(SourceBrowserActivity.BROWSER_ID)).perform(pressKey(KeyEvent.KEYCODE_TAB), pressKey(KeyEvent.KEYCODE_TAB), pressKey(KeyEvent.KEYCODE_ENTER));
            awaitTitle(scenario, "Search results fixture");
            assertTrue(requests.contains("https://yomou.syosetu.com/search.php?word=syntheticword"));
        }
    }

    @Test public void interceptedRedirectCannotConnectToControlledForbiddenTarget() throws Exception {
        try (ConnectionCounter target = new ConnectionCounter()) {
            target.positiveControl();
            SourceBrowserLoader fixtureLoader = new SourceBrowserLoader(uri -> {
                if (!uri.getHost().equals("syosetu.com")) {
                    try (Socket forbidden = new Socket("127.0.0.1", target.port())) {
                        throw new AssertionError("A forbidden redirect reached the fetcher");
                    }
                }
                return new SourceBrowserLoader.Resource(uri, 302, "text/html", "UTF-8", Collections.singletonMap("Location", "https://127.0.0.1:" + target.port() + "/model"), new byte[0]);
            });
            assertEquals(403, fixtureLoader.load(URI.create("https://syosetu.com/fixture/redirect"), "GET").status);
            Thread.sleep(500);
            assertEquals(1, target.count.get());
        }
    }

    private void awaitTitle(ActivityScenario<SourceBrowserActivity> scenario, String wanted) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        AtomicReference<String> title = new AtomicReference<>();
        do {
            scenario.onActivity(activity -> title.set(((WebView) activity.findViewById(SourceBrowserActivity.BROWSER_ID)).getTitle()));
            if (wanted.equals(title.get())) return;
            Thread.sleep(20);
        } while (System.nanoTime() < deadline);
        fail("Synthetic page did not settle: " + title.get());
    }

    private static final class ConnectionCounter implements AutoCloseable {
        final ServerSocket server;
        final AtomicInteger count = new AtomicInteger();
        final Thread thread;
        volatile boolean closed;
        ConnectionCounter() throws Exception {
            server = new ServerSocket();
            server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            thread = new Thread(() -> {
                while (!closed) {
                    try (Socket accepted = server.accept()) { count.incrementAndGet(); }
                    catch (Exception error) { if (!closed) throw new AssertionError(error); }
                }
            }, "source-browser-forbidden-target");
            thread.start();
        }
        int port() { return server.getLocalPort(); }
        void positiveControl() throws Exception {
            try (Socket connection = new Socket("127.0.0.1", port())) {
                long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
                while (count.get() == 0 && System.nanoTime() < deadline) Thread.sleep(10);
                assertEquals("Counter positive control failed", 1, count.get());
            }
        }
        @Override public void close() throws Exception {
            closed = true;
            server.close();
            thread.join(3000);
            assertFalse(thread.isAlive());
        }
    }
}
