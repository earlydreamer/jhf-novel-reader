package app.narou.reader;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.pressKey;
import androidx.test.espresso.action.GeneralClickAction;
import androidx.test.espresso.action.Press;
import androidx.test.espresso.action.Tap;
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
import java.io.IOException;
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

    @Test public void blockedSchemesAndForgedHostsCannotReturnAnUnsupportedSelectionAfterValidWork() throws Exception {
        String workUrl = "https://ncode.syosetu.com/n1234ab/2/";
        String[] unsupported = {
            "file:///etc/passwd",
            "content://app.narou.reader/private",
            "javascript:document.title='forged'",
            "intent://open",
            "https://ncode.syosetu.com.evil.test/n1234ab/"
        };
        for (String destination : unsupported) {
            List<String> requests = new CopyOnWriteArrayList<>();
            SourceBrowserLoader fixtureLoader = new SourceBrowserLoader(uri -> {
                requests.add(uri.toString());
                if (!workUrl.equals(uri.toString())) return SourceBrowserLoader.denied(uri);
                return fixturePage(uri, "Valid work fixture", "<a href=\"" + destination + "\">Unsupported destination</a>");
            });
            try (ActivityScenario<SourceBrowserActivity> scenario = launchForResultWithoutNetwork()) {
                installFixture(scenario, fixtureLoader, workUrl);
                awaitBrowserState(scenario, workUrl, true);
                tapFirstLink();
                if (destination.startsWith("https:")) {
                    onView(androidx.test.espresso.matcher.ViewMatchers.withText("취소"))
                        .perform(androidx.test.espresso.action.ViewActions.click());
                }
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
                // No unsupported native network/file request may reach the fixture transport.
                assertEquals(Collections.singletonList(workUrl), requests);
                AtomicReference<Boolean> retainedWork = new AtomicReference<>();
                scenario.onActivity(activity -> {
                    WebView view = activity.findViewById(SourceBrowserActivity.BROWSER_ID);
                    Button open = activity.findViewById(SourceBrowserActivity.OPEN_ID);
                    boolean retained = workUrl.equals(view.getUrl());
                    retainedWork.set(retained);
                    if (retained) {
                        assertEquals("Blocked navigation must not execute a javascript: URL", "Valid work fixture", view.getTitle());
                        assertTrue("The original supported work remains selectable", open.isEnabled());
                        open.performClick();
                    } else {
                        assertNull("Unsupported navigation must not become importable", SourceBrowserPolicy.selectedUrl(view.getUrl()));
                        assertFalse(open.isEnabled());
                        // Invoke the actual native listener even though a user tap is disabled.
                        // It must not finish or return a stale/forged selection.
                        open.performClick();
                        assertFalse(activity.isFinishing());
                        activity.findViewById(SourceBrowserActivity.CLOSE_ID).performClick();
                    }
                });
                Instrumentation.ActivityResult result = scenario.getResult();
                awaitDestroyed(scenario);
                if (retainedWork.get()) {
                    assertEquals(Activity.RESULT_OK, result.getResultCode());
                    assertNotNull(result.getResultData());
                    assertEquals(workUrl, result.getResultData().getStringExtra(SourceBrowserActivity.SELECTED_URL));
                } else {
                    assertEquals(Activity.RESULT_CANCELED, result.getResultCode());
                    assertNull(result.getResultData());
                }
            }
        }
    }

    @Test public void unsupportedEpisodeQueryClearsPriorNativeSelectionAndReturnsCancellation() throws Exception {
        String workUrl = "https://ncode.syosetu.com/n1234ab/2/";
        String unsupported = workUrl + "?p=2";
        List<String> requests = new CopyOnWriteArrayList<>();
        SourceBrowserLoader fixtureLoader = new SourceBrowserLoader(uri -> {
            requests.add(uri.toString());
            if (uri.toString().equals(workUrl)) {
                return fixturePage(uri, "Valid work fixture", "<a href='" + unsupported + "'>Invalid episode query</a>");
            }
            return fixturePage(uri, "Unsupported query fixture", "<p>Source browsing URL is not an import URL.</p>");
        });
        try (ActivityScenario<SourceBrowserActivity> scenario = launchForResultWithoutNetwork()) {
            installFixture(scenario, fixtureLoader, workUrl);
            awaitBrowserState(scenario, workUrl, true);
            tapFirstLink();
            awaitBrowserState(scenario, unsupported, false);
            assertEquals(java.util.Arrays.asList(workUrl, unsupported), requests);
            scenario.onActivity(activity -> {
                Button open = activity.findViewById(SourceBrowserActivity.OPEN_ID);
                assertFalse(open.isEnabled());
                open.performClick();
                assertFalse("Stale valid-work selection must not finish the activity", activity.isFinishing());
                activity.findViewById(SourceBrowserActivity.CLOSE_ID).performClick();
            });
            Instrumentation.ActivityResult result = scenario.getResult();
            awaitDestroyed(scenario);
            assertEquals(Activity.RESULT_CANCELED, result.getResultCode());
            assertNull(result.getResultData());
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

    @Test public void mainFrameRedirectFlowsThroughProductionWebViewClientWithoutForbiddenConnection() throws Exception {
        try (ConnectionCounter target = new ConnectionCounter();
             ActivityScenario<SourceBrowserActivity> scenario = launchForResultWithoutNetwork()) {
            target.positiveControl();
            String home = "https://syosetu.com/fixture/home";
            String redirect = "https://yomou.syosetu.com/fixture/main-redirect";
            String deniedPageIcon = "https://yomou.syosetu.com/favicon.ico";
            String forbidden = "https://127.0.0.1:" + target.port() + "/model";
            List<String> requests = new CopyOnWriteArrayList<>();
            SourceBrowserLoader fixtureLoader = new SourceBrowserLoader(uri -> {
                requests.add(uri.toString());
                if (uri.toString().equals(home)) {
                    return fixturePage(uri, "Main redirect fixture", "<a href='" + redirect + "'>Redirected page</a>");
                }
                if (uri.toString().equals(redirect)) return fixtureRedirect(uri, forbidden);
                if (uri.toString().equals(deniedPageIcon)) return SourceBrowserLoader.denied(uri);
                connectForbiddenIfReached(uri, target);
                throw new IOException("Unexpected fixture destination");
            });
            installFixture(scenario, fixtureLoader, home);
            awaitBrowserState(scenario, home, false);
            tapFirstLink();
            awaitBrowserState(scenario, redirect, false);
            // A blocked redirect has no HTML icon declaration. This WebView may request its
            // exact same-origin favicon; every other extra destination must still fail.
            assertEquals("Observed fixture requests: " + requests,
                java.util.Arrays.asList(home, redirect),
                requests.stream().filter(url -> !url.equals(deniedPageIcon))
                    .collect(java.util.stream.Collectors.toList()));
            target.assertNoConnectionsAfterControl();
            scenario.onActivity(activity -> {
                Button open = activity.findViewById(SourceBrowserActivity.OPEN_ID);
                assertFalse(open.isEnabled());
                open.performClick();
                assertFalse(activity.isFinishing());
                activity.findViewById(SourceBrowserActivity.CLOSE_ID).performClick();
            });
            assertEquals(Activity.RESULT_CANCELED, scenario.getResult().getResultCode());
            awaitDestroyed(scenario);
            assertNull(scenario.getResult().getResultData());
        }
    }

    @Test public void subresourceRedirectsFlowThroughProductionWebViewClientWithoutForbiddenConnection() throws Exception {
        try (ConnectionCounter target = new ConnectionCounter();
             ActivityScenario<SourceBrowserActivity> scenario = launchWithoutNetwork()) {
            target.positiveControl();
            String workUrl = "https://ncode.syosetu.com/n1234ab/2/";
            String image = "https://static.syosetu.com/fixture/redirected-image";
            String frame = "https://yomou.syosetu.com/fixture/redirected-frame";
            String forbidden = "https://127.0.0.1:" + target.port() + "/model";
            List<String> requests = new CopyOnWriteArrayList<>();
            SourceBrowserLoader fixtureLoader = new SourceBrowserLoader(uri -> {
                requests.add(uri.toString());
                if (uri.toString().equals(workUrl)) {
                    return fixturePage(uri, "Subresource redirect fixture", "<img src='" + image + "'><iframe src='" + frame + "'></iframe>");
                }
                if (uri.toString().equals(image) || uri.toString().equals(frame)) return fixtureRedirect(uri, forbidden);
                connectForbiddenIfReached(uri, target);
                throw new IOException("Unexpected fixture destination");
            });
            installFixture(scenario, fixtureLoader, workUrl);
            awaitBrowserState(scenario, workUrl, true);
            assertEquals(3, requests.size());
            assertTrue(requests.contains(workUrl));
            assertTrue("The actual WebView image request must enter the production client", requests.contains(image));
            assertTrue("The actual WebView iframe request must enter the production client", requests.contains(frame));
            target.assertNoConnectionsAfterControl();
            scenario.onActivity(activity -> {
                assertEquals(workUrl, ((WebView) activity.findViewById(SourceBrowserActivity.BROWSER_ID)).getUrl());
                assertTrue(((Button) activity.findViewById(SourceBrowserActivity.OPEN_ID)).isEnabled());
            });
        }
    }

    private ActivityScenario<SourceBrowserActivity> launchForResultWithoutNetwork() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        return ActivityScenario.launchActivityForResult(new Intent(context, SourceBrowserActivity.class));
    }

    private void installFixture(ActivityScenario<SourceBrowserActivity> scenario, SourceBrowserLoader fixtureLoader, String startUrl) {
        scenario.onActivity(activity -> {
            try {
                // Test-only replacement of the anonymous transport. The production WebViewClient,
                // URL policy, toolbar and result handling are unchanged and exercised normally.
                java.lang.reflect.Field field = SourceBrowserActivity.class.getDeclaredField("loader");
                field.setAccessible(true);
                field.set(activity, fixtureLoader);
            } catch (ReflectiveOperationException failure) {
                throw new AssertionError(failure);
            }
            WebView view = activity.findViewById(SourceBrowserActivity.BROWSER_ID);
            view.loadUrl(startUrl);
            view.requestFocus();
        });
    }

    private SourceBrowserLoader.Resource fixturePage(URI uri, String title, String body) {
        // Declare an inline icon so WebView does not add an unrelated /favicon.ico request.
        // Exact request-list and forbidden-target assertions remain unchanged.
        byte[] html = ("<html><head><meta name='viewport' content='width=device-width,initial-scale=1'><link rel='icon' href='data:,'><style>body{margin:0}a{display:block;min-height:48px}</style><title>" + title + "</title></head><body>" + body + "</body></html>").getBytes(StandardCharsets.UTF_8);
        return new SourceBrowserLoader.Resource(uri, 200, "text/html", "UTF-8", Collections.emptyMap(), html);
    }

    private SourceBrowserLoader.Resource fixtureRedirect(URI uri, String destination) {
        return new SourceBrowserLoader.Resource(uri, 302, "text/html", "UTF-8", Collections.singletonMap("Location", destination), new byte[0]);
    }

    private void connectForbiddenIfReached(URI uri, ConnectionCounter target) throws IOException {
        if (uri.getHost().equals("127.0.0.1")) {
            // Positive failure detector: an accidentally forwarded destination makes a real
            // controlled loopback connection before the fixture reports failure.
            try (Socket forbidden = new Socket("127.0.0.1", target.port())) {
                throw new IOException("Forbidden redirect reached the fixture transport");
            }
        }
    }

    private void awaitDestroyed(ActivityScenario<SourceBrowserActivity> scenario) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (scenario.getState() != androidx.lifecycle.Lifecycle.State.DESTROYED
            && System.nanoTime() < deadline) Thread.sleep(20);
        // The result can arrive before onDestroy. Do not race cleanup's empty-activity launch.
        assertEquals(androidx.lifecycle.Lifecycle.State.DESTROYED, scenario.getState());
    }

    private void tapFirstLink() {
        // fixturePage puts its first link in the top 48 CSS-pixel row. Use a real
        // touch gesture: keyboard activation does not reliably set hasGesture().
        onView(withId(SourceBrowserActivity.BROWSER_ID))
            .perform(new GeneralClickAction(Tap.SINGLE, view -> {
                int[] origin = new int[2];
                view.getLocationOnScreen(origin);
                float density = view.getResources().getDisplayMetrics().density;
                return new float[] { origin[0] + view.getWidth() / 2f, origin[1] + 24f * density };
            }, Press.FINGER));
    }

    private void awaitBrowserState(ActivityScenario<SourceBrowserActivity> scenario, String expectedUrl, boolean importEnabled) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        AtomicReference<Boolean> settled = new AtomicReference<>(false);
        do {
            scenario.onActivity(activity -> {
                WebView view = activity.findViewById(SourceBrowserActivity.BROWSER_ID);
                Button open = activity.findViewById(SourceBrowserActivity.OPEN_ID);
                settled.set(expectedUrl.equals(view.getUrl()) && view.getProgress() == 100 && open.isEnabled() == importEnabled);
            });
            if (settled.get()) return;
            Thread.sleep(20);
        } while (System.nanoTime() < deadline);
        fail("Production browser did not settle at " + expectedUrl + " with expected native selection state");
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
        final AtomicReference<Throwable> failure = new AtomicReference<>();
        ConnectionCounter() throws Exception {
            server = new ServerSocket();
            server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            thread = new Thread(() -> {
                while (!closed) {
                    try (Socket accepted = server.accept()) { count.incrementAndGet(); }
                    catch (Exception error) { if (!closed) failure.set(error); break; }
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
        void assertNoConnectionsAfterControl() throws Exception {
            Thread.sleep(500);
            assertNull("Forbidden-target counter failed", failure.get());
            assertTrue("Forbidden-target counter stopped", thread.isAlive());
            assertEquals("Forbidden destination received a connection", 1, count.get());
        }
        @Override public void close() throws Exception {
            closed = true;
            server.close();
            thread.join(3000);
            assertFalse(thread.isAlive());
            assertNull("Forbidden-target counter failed", failure.get());
        }
    }
}
