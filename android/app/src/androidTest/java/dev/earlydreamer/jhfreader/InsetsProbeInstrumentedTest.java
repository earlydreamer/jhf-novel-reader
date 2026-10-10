package dev.earlydreamer.jhfreader;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Instrumentation;
import android.content.Context;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.Bridge;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Read-only inset probe for the explicitly suffixed .devicecheck2 target. This test must not be
 * run against a production, .test, or legacy .devicecheck installation.
 */
@RunWith(AndroidJUnit4.class)
public final class InsetsProbeInstrumentedTest {
    private static final String TARGET_APP_ID = "dev.earlydreamer.jhfreader.devicecheck2";
    private static final String TEST_APP_ID = "dev.earlydreamer.jhfreader.devicecheck2.insetsprobe.test";
    private static final String RUN_ARGUMENT = "nrInsetsProbe";
    private static final String TARGET_ARGUMENT = "nrInsetsProbeTarget";
    private static final long READY_TIMEOUT_MS = 4000;
    private static final long SETTLE_TIMEOUT_MS = 3000;
    private static final long JS_TIMEOUT_MS = 1000;
    private static final long JS_READY_TIMEOUT_MS = 4000;
    private static final long SAMPLE_INTERVAL_MS = 100;
    private static final int STABLE_SAMPLE_COUNT = 3;

    private static final String JS_METRICS =
        "(() => {"
            + "const number = value => { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : null; };"
            + "let probe = null;"
            + "let envSafeAreaBottomCssPx = null;"
            + "try {"
            + "probe = document.createElement('div');"
            + "probe.style.cssText = 'position:fixed;left:-10000px;top:0;display:block;visibility:hidden;pointer-events:none;box-sizing:content-box;width:1px;height:0;padding-bottom:env(safe-area-inset-bottom, 0px);';"
            + "document.documentElement.appendChild(probe);"
            + "envSafeAreaBottomCssPx = number(getComputedStyle(probe).paddingBottom);"
            + "} catch (_) { envSafeAreaBottomCssPx = null; }"
            + "finally { if (probe) probe.remove(); }"
            + "const root = document.documentElement; const rootStyle = getComputedStyle(root);"
            + "const library = document.querySelector('.nr-library');"
            + "const fab = document.querySelector('.nr-fab'); const fabStyle = fab ? getComputedStyle(fab) : null;"
            + "const rect = fab ? fab.getBoundingClientRect() : null; const vv = window.visualViewport;"
            + "const payload = {"
            + "envSafeAreaBottomCssPx,"
            + "libraryScreenPresent: Boolean(library), documentReady: document.readyState === 'interactive' || document.readyState === 'complete',"
            + "fontsReady: !document.fonts || document.fonts.status === 'loaded',"
            + "safeAreaInsetTopCssPx: number(rootStyle.getPropertyValue('--safe-area-inset-top')),"
            + "safeAreaInsetBottomCssPx: number(rootStyle.getPropertyValue('--safe-area-inset-bottom')),"
            + "insetTopCssPx: number(rootStyle.getPropertyValue('--inset-top')),"
            + "insetBottomCssPx: number(rootStyle.getPropertyValue('--inset-bottom')),"
            + "fabPresent: Boolean(fab), fabBottomCssPx: fabStyle ? number(fabStyle.bottom) : null,"
            + "fabRect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,"
            + "innerHeightCssPx: window.innerHeight,"
            + "visualViewport: vv ? { height: vv.height, offsetTop: vv.offsetTop, offsetBottom: vv.offsetTop + vv.height, scale: vv.scale } : null,"
            + "devicePixelRatio: window.devicePixelRatio,"
            + "screenCssPx: { width: screen.width, height: screen.height },"
            + "clientCssPx: { width: root.clientWidth, height: root.clientHeight }"
            + "};"
            + "return payload;"
            + "})()";

    @Test(timeout = 20000)
    public void readOnlyBaselineEmitsAllowlistedMetrics() throws Exception {
        assertProbeInvocationAllowed(null);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = awaitReady(scenario);
            JSONObject partialNativeSnapshot = readNativeSnapshotOnUi(scenario);
            JsSnapshotResult jsResult = ready ? awaitJsReadySnapshot(scenario) : new JsSnapshotResult(null, false, 0);
            boolean nativeReadyAfterWebViewReady = jsResult.ready && awaitReady(scenario);
            JSONObject nativeSnapshot = nativeReadyAfterWebViewReady ? readNativeSnapshotOnUi(scenario) : partialNativeSnapshot;
            JSONObject jsSnapshot = jsResult.snapshot;
            JSONObject report = new JSONObject();
            report.put("schema", "nr-insets-probe/v1");
            report.put("phase", "baseline");
            report.put("packageId", TARGET_APP_ID);
            report.put("ready", ready);
            report.put("webViewReady", jsResult.ready);
            report.put("webViewReadySamples", jsResult.samples);
            report.put("nativeReadyAfterWebViewReady", nativeReadyAfterWebViewReady);
            report.put("nativeSnapshotAfterWebViewReady", nativeReadyAfterWebViewReady);
            report.put("requestTarget", "none");
            report.put("requestCount", 0);
            report.put("native", nativeSnapshot);
            putNullable(report, "webView", jsSnapshot);
            emitAllowlistedStatus(report);
            assertTrue("probe baseline did not reach a laid out root with insets", ready);
            assertTrue("Home WebView metrics did not reach readiness", jsResult.ready);
            assertTrue("native insets were not ready after Home WebView readiness", nativeReadyAfterWebViewReady);
        }
    }

    @Test(timeout = 25000)
    public void baselineThenDecorRequestSettledAfter() throws Exception {
        runRequestComparison("decor");
    }

    @Test(timeout = 25000)
    public void baselineThenWebViewRequestSettledAfter() throws Exception {
        runRequestComparison("webView");
    }

    private void runRequestComparison(String requestTarget) throws Exception {
        assertProbeInvocationAllowed(requestTarget);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            boolean ready = awaitReady(scenario);
            JSONObject partialBaselineNative = readNativeSnapshotOnUi(scenario);
            JsSnapshotResult baselineJsResult = ready ? awaitJsReadySnapshot(scenario) : new JsSnapshotResult(null, false, 0);
            boolean nativeReadyAfterWebViewReady = baselineJsResult.ready && awaitReady(scenario);
            JSONObject baselineNative = nativeReadyAfterWebViewReady ? readNativeSnapshotOnUi(scenario) : partialBaselineNative;
            JSONObject baselineJs = baselineJsResult.snapshot;
            if (!ready) {
                emitComparisonStatus(requestTarget, 0, false, nativeReadyAfterWebViewReady, baselineNative, baselineJsResult, null, new JsSnapshotResult(null, false, 0), 0);
                assertTrue("probe baseline did not reach a laid out root with insets", false);
            }
            if (!baselineJsResult.ready) {
                emitComparisonStatus(requestTarget, 0, false, nativeReadyAfterWebViewReady, baselineNative, baselineJsResult, null, new JsSnapshotResult(null, false, 0), 0);
                assertTrue("Home WebView baseline metrics did not reach readiness", false);
            }
            if (!nativeReadyAfterWebViewReady) {
                emitComparisonStatus(requestTarget, 0, false, false, baselineNative, baselineJsResult, null, new JsSnapshotResult(null, false, 0), 0);
                assertTrue("native insets were not ready after Home WebView readiness", nativeReadyAfterWebViewReady);
            }

            boolean requestIssued = requestApplyInsetsOnceOnUi(scenario, requestTarget);
            if (!requestIssued) {
                emitComparisonStatus(requestTarget, 0, false, nativeReadyAfterWebViewReady, baselineNative, baselineJsResult, null, new JsSnapshotResult(null, false, 0), 0);
                assertTrue("selected inset target was unavailable", requestIssued);
            }
            SettledSnapshot settled = awaitSettledAfterRequest(scenario);
            JsSnapshotResult afterJsResult = settled.ready && settled.settled ? awaitJsReadySnapshot(scenario) : new JsSnapshotResult(null, false, 0);
            emitComparisonStatus(requestTarget, 1, settled.ready && settled.settled, nativeReadyAfterWebViewReady, baselineNative, baselineJsResult, settled.snapshot, afterJsResult, settled.stableSamples);
            assertTrue("probe after snapshot did not settle with root insets", settled.ready && settled.settled);
            assertTrue("Home WebView after metrics did not reach readiness", afterJsResult.ready);
        }
    }

    /** Validate both package identities and invocation flags before any target Activity is launched. */
    private void assertProbeInvocationAllowed(String expectedRequestTarget) {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Bundle arguments = InstrumentationRegistry.getArguments();
        Assume.assumeTrue("opt-in inset probe is not requested", arguments.containsKey(RUN_ARGUMENT));
        assertEquals("nrInsetsProbe=true is required when explicitly invoked", "true", arguments.getString(RUN_ARGUMENT));
        Context targetContext = instrumentation.getTargetContext();
        Context instrumentationContext = instrumentation.getContext();

        assertEquals("unexpected instrumentation target; refusing to launch ActivityScenario", TARGET_APP_ID, targetContext.getPackageName());
        assertEquals("unexpected test APK identity; refusing to launch ActivityScenario", TEST_APP_ID, instrumentationContext.getPackageName());
        if (expectedRequestTarget == null) {
            assertTrue("baseline must not carry a request target", !arguments.containsKey(TARGET_ARGUMENT));
        } else {
            assertEquals("request target must select exactly one view", expectedRequestTarget, arguments.getString(TARGET_ARGUMENT));
        }
    }

    private boolean awaitReady(ActivityScenario<MainActivity> scenario) {
        long deadline = SystemClock.elapsedRealtime() + READY_TIMEOUT_MS;
        AtomicReference<Boolean> ready = new AtomicReference<>(false);
        while (SystemClock.elapsedRealtime() < deadline) {
            scenario.onActivity(activity -> ready.set(isReady(activity)));
            if (Boolean.TRUE.equals(ready.get())) return true;
            SystemClock.sleep(SAMPLE_INTERVAL_MS);
        }
        return false;
    }

    private boolean isReady(MainActivity activity) {
        View decor = activity.getWindow().getDecorView();
        WebView webView = webView(activity);
        return decor.isAttachedToWindow()
            && decor.isLaidOut()
            && decor.getWidth() > 0
            && decor.getHeight() > 0
            && decor.getRootWindowInsets() != null
            && ViewCompat.getRootWindowInsets(decor) != null
            && webView != null
            && webView.isAttachedToWindow()
            && webView.isLaidOut()
            && webView.getWidth() > 0
            && webView.getHeight() > 0;
    }

    private JSONObject readNativeSnapshotOnUi(ActivityScenario<MainActivity> scenario) throws JSONException {
        AtomicReference<JSONObject> snapshot = new AtomicReference<>();
        AtomicReference<JSONException> failure = new AtomicReference<>();
        scenario.onActivity(activity -> {
            try {
                snapshot.set(readNativeSnapshot(activity));
            } catch (JSONException error) {
                failure.set(error);
            }
        });
        if (failure.get() != null) throw new JSONException("numeric native snapshot encoding failed");
        if (snapshot.get() == null) throw new JSONException("numeric native snapshot was unavailable");
        return snapshot.get();
    }

    private JSONObject readNativeSnapshot(MainActivity activity) throws JSONException {
        Window window = activity.getWindow();
        View decor = window.getDecorView();
        WebView webView = webView(activity);
        WindowInsets platformInsets = decor.getRootWindowInsets();
        WindowInsetsCompat compatInsets = ViewCompat.getRootWindowInsets(decor);
        JSONObject snapshot = new JSONObject();
        snapshot.put("capturedUptimeMs", SystemClock.elapsedRealtime());
        snapshot.put("rootInsetsAvailable", platformInsets != null);
        snapshot.put("compatInsetsAvailable", compatInsets != null);
        putNullable(snapshot, "platformSystemWindowInsetsPx", platformInsets == null ? null : platformSystemInsets(platformInsets));
        putNullable(snapshot, "platformStableInsetsPx", platformInsets == null ? null : platformStableInsets(platformInsets));
        putNullable(snapshot, "compat", compatInsets == null ? null : compatInsetSnapshot(compatInsets));

        snapshot.put("decorPaddingPx", padding(decor));
        putNullable(snapshot, "decorScreenFramePx", viewFrameOnScreen(decor));
        putNullable(snapshot, "webViewScreenFramePx", viewFrameOnScreen(webView));
        snapshot.put("webViewPresent", webView != null);
        putNullable(snapshot, "visibleDisplayFramePx", visibleDisplayFrame(decor));

        Point realDisplaySize = new Point();
        Display display = activity.getWindowManager().getDefaultDisplay();
        display.getRealSize(realDisplaySize);
        if (realDisplaySize.x > 0 && realDisplaySize.y > 0) {
            JSONObject displaySize = new JSONObject();
            displaySize.put("width", realDisplaySize.x);
            displaySize.put("height", realDisplaySize.y);
            snapshot.put("displayRealSizePx", displaySize);
        } else snapshot.put("displayRealSizePx", JSONObject.NULL);

        JSONObject density = new JSONObject();
        density.put("density", activity.getResources().getDisplayMetrics().density);
        density.put("densityDpi", activity.getResources().getDisplayMetrics().densityDpi);
        snapshot.put("displayDensity", density);

        WindowManager.LayoutParams attributes = window.getAttributes();
        snapshot.put("windowFlags", attributes.flags);
        snapshot.put("softInputMode", attributes.softInputMode);
        snapshot.put("decorSystemUiVisibility", decor.getSystemUiVisibility());
        if (webView != null) snapshot.put("webViewPaddingPx", padding(webView));
        else snapshot.put("webViewPaddingPx", JSONObject.NULL);
        return snapshot;
    }

    @SuppressWarnings("deprecation")
    private JSONObject platformSystemInsets(WindowInsets insets) throws JSONException {
        JSONObject edges = new JSONObject();
        edges.put("left", insets.getSystemWindowInsetLeft());
        edges.put("top", insets.getSystemWindowInsetTop());
        edges.put("right", insets.getSystemWindowInsetRight());
        edges.put("bottom", insets.getSystemWindowInsetBottom());
        return edges;
    }

    @SuppressWarnings("deprecation")
    private JSONObject platformStableInsets(WindowInsets insets) throws JSONException {
        JSONObject edges = new JSONObject();
        edges.put("left", insets.getStableInsetLeft());
        edges.put("top", insets.getStableInsetTop());
        edges.put("right", insets.getStableInsetRight());
        edges.put("bottom", insets.getStableInsetBottom());
        return edges;
    }

    private JSONObject compatInsetSnapshot(WindowInsetsCompat insets) throws JSONException {
        int systemBarsAndCutout = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        int navigationBars = WindowInsetsCompat.Type.navigationBars();
        int statusBars = WindowInsetsCompat.Type.statusBars();
        int ime = WindowInsetsCompat.Type.ime();
        JSONObject result = new JSONObject();
        result.put("systemBarsAndCutoutCurrentPx", edgeInsets(insets.getInsets(systemBarsAndCutout)));
        result.put("systemBarsCurrentPx", edgeInsets(insets.getInsets(WindowInsetsCompat.Type.systemBars())));
        result.put("navigationBarsCurrentPx", edgeInsets(insets.getInsets(navigationBars)));
        result.put("navigationBarsIgnoringVisibilityPx", edgeInsets(insets.getInsetsIgnoringVisibility(navigationBars)));
        result.put("displayCutoutCurrentPx", edgeInsets(insets.getInsets(WindowInsetsCompat.Type.displayCutout())));
        result.put("imeCurrentPx", edgeInsets(insets.getInsets(ime)));
        JSONObject visibility = new JSONObject();
        visibility.put("statusBars", insets.isVisible(statusBars));
        visibility.put("navigationBars", insets.isVisible(navigationBars));
        visibility.put("ime", insets.isVisible(ime));
        result.put("visible", visibility);
        return result;
    }

    private JSONObject edgeInsets(Insets insets) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("left", insets.left);
        result.put("top", insets.top);
        result.put("right", insets.right);
        result.put("bottom", insets.bottom);
        return result;
    }

    private JSONObject padding(View view) throws JSONException {
        JSONObject result = new JSONObject();
        result.put("left", view.getPaddingLeft());
        result.put("top", view.getPaddingTop());
        result.put("right", view.getPaddingRight());
        result.put("bottom", view.getPaddingBottom());
        return result;
    }

    private JSONObject viewFrameOnScreen(View view) throws JSONException {
        if (view == null || !view.isLaidOut() || view.getWidth() <= 0 || view.getHeight() <= 0) return null;
        int[] location = new int[2];
        view.getLocationOnScreen(location);
        JSONObject frame = new JSONObject();
        frame.put("left", location[0]);
        frame.put("top", location[1]);
        frame.put("right", location[0] + view.getWidth());
        frame.put("bottom", location[1] + view.getHeight());
        frame.put("width", view.getWidth());
        frame.put("height", view.getHeight());
        return frame;
    }

    private JSONObject visibleDisplayFrame(View decor) throws JSONException {
        if (!decor.isLaidOut() || decor.getWidth() <= 0 || decor.getHeight() <= 0) return null;
        Rect rect = new Rect();
        decor.getWindowVisibleDisplayFrame(rect);
        JSONObject frame = new JSONObject();
        frame.put("left", rect.left);
        frame.put("top", rect.top);
        frame.put("right", rect.right);
        frame.put("bottom", rect.bottom);
        frame.put("width", rect.width());
        frame.put("height", rect.height());
        return frame;
    }

    private boolean requestApplyInsetsOnceOnUi(ActivityScenario<MainActivity> scenario, String requestTarget) {
        AtomicReference<Boolean> issued = new AtomicReference<>(false);
        scenario.onActivity(activity -> {
            View decor = activity.getWindow().getDecorView();
            WebView webView = webView(activity);
            if ("decor".equals(requestTarget)) {
                decor.requestApplyInsets();
                issued.set(true);
            } else if ("webView".equals(requestTarget) && webView != null) {
                webView.requestApplyInsets();
                issued.set(true);
            }
        });
        return Boolean.TRUE.equals(issued.get());
    }

    private SettledSnapshot awaitSettledAfterRequest(ActivityScenario<MainActivity> scenario) throws JSONException {
        long deadline = SystemClock.elapsedRealtime() + SETTLE_TIMEOUT_MS;
        String previousFingerprint = null;
        int consecutiveStableSamples = 0;
        JSONObject latest = null;
        boolean ready = false;
        while (SystemClock.elapsedRealtime() < deadline) {
            AtomicReference<Boolean> sampleReady = new AtomicReference<>(false);
            AtomicReference<JSONObject> sample = new AtomicReference<>();
            AtomicReference<JSONException> failure = new AtomicReference<>();
            scenario.onActivity(activity -> {
                boolean currentReady = isReady(activity);
                sampleReady.set(currentReady);
                try {
                    sample.set(readNativeSnapshot(activity));
                } catch (JSONException error) {
                    failure.set(error);
                }
            });
            if (failure.get() != null) throw new JSONException("numeric native snapshot encoding failed");
            ready = Boolean.TRUE.equals(sampleReady.get());
            latest = sample.get();
            if (ready && latest != null) {
                String fingerprint = stabilityFingerprint(latest);
                if (Objects.equals(previousFingerprint, fingerprint)) consecutiveStableSamples++;
                else consecutiveStableSamples = 1;
                previousFingerprint = fingerprint;
                if (consecutiveStableSamples >= STABLE_SAMPLE_COUNT) {
                    return new SettledSnapshot(true, true, latest, consecutiveStableSamples);
                }
            } else {
                previousFingerprint = null;
                consecutiveStableSamples = 0;
            }
            SystemClock.sleep(SAMPLE_INTERVAL_MS);
        }
        return new SettledSnapshot(ready, false, latest, consecutiveStableSamples);
    }

    private String stabilityFingerprint(JSONObject snapshot) {
        return snapshot.opt("platformSystemWindowInsetsPx")
            + "|" + snapshot.opt("platformStableInsetsPx")
            + "|" + snapshot.opt("compat")
            + "|" + snapshot.opt("decorPaddingPx")
            + "|" + snapshot.opt("webViewPaddingPx")
            + "|" + snapshot.opt("decorScreenFramePx")
            + "|" + snapshot.opt("webViewScreenFramePx")
            + "|" + snapshot.opt("visibleDisplayFramePx")
            + "|" + snapshot.opt("windowFlags")
            + "|" + snapshot.opt("softInputMode")
            + "|" + snapshot.opt("decorSystemUiVisibility");
    }

    private JsSnapshotResult awaitJsReadySnapshot(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + JS_READY_TIMEOUT_MS;
        JSONObject latest = null;
        int samples = 0;
        while (SystemClock.elapsedRealtime() < deadline) {
            latest = readJsSnapshotOnce(scenario);
            samples++;
            if (isJsReady(latest)) return new JsSnapshotResult(latest, true, samples);
            SystemClock.sleep(SAMPLE_INTERVAL_MS);
        }
        return new JsSnapshotResult(latest, false, samples);
    }

    private boolean isJsReady(JSONObject snapshot) {
        if (snapshot == null) return false;
        JSONObject viewport = snapshot.optJSONObject("visualViewport");
        JSONObject fabRect = snapshot.optJSONObject("fabRect");
        JSONObject screen = snapshot.optJSONObject("screenCssPx");
        JSONObject client = snapshot.optJSONObject("clientCssPx");
        return snapshot.optBoolean("libraryScreenPresent")
            && snapshot.optBoolean("fabPresent")
            && snapshot.optBoolean("documentReady")
            && snapshot.optBoolean("fontsReady")
            && positiveNumber(snapshot, "devicePixelRatio")
            && positiveNumber(snapshot, "innerHeightCssPx")
            && finiteNumber(snapshot, "envSafeAreaBottomCssPx")
            && finiteNumber(snapshot, "safeAreaInsetTopCssPx")
            && finiteNumber(snapshot, "safeAreaInsetBottomCssPx")
            && finiteNumber(snapshot, "insetTopCssPx")
            && finiteNumber(snapshot, "insetBottomCssPx")
            && finiteNumber(snapshot, "fabBottomCssPx")
            && fabRect != null && positiveNumber(fabRect, "width") && positiveNumber(fabRect, "height")
            && finiteNumber(fabRect, "left") && finiteNumber(fabRect, "right") && finiteNumber(fabRect, "top") && finiteNumber(fabRect, "bottom")
            && viewport != null && positiveNumber(viewport, "height") && finiteNumber(viewport, "offsetTop") && finiteNumber(viewport, "offsetBottom") && positiveNumber(viewport, "scale")
            && screen != null && positiveNumber(screen, "width") && positiveNumber(screen, "height")
            && client != null && positiveNumber(client, "width") && positiveNumber(client, "height");
    }

    private boolean positiveNumber(JSONObject values, String key) {
        return finiteNumber(values, key) && values.optDouble(key) > 0;
    }

    private boolean finiteNumber(JSONObject values, String key) {
        if (values == null || !values.has(key) || values.isNull(key)) return false;
        Object value = values.opt(key);
        return value instanceof Number && Double.isFinite(((Number) value).doubleValue());
    }

    private JSONObject readJsSnapshotOnce(ActivityScenario<MainActivity> scenario) throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<String> callbackValue = new AtomicReference<>();
        AtomicReference<Long> callbackReceivedUptimeMs = new AtomicReference<>();
        AtomicBoolean callbackActive = new AtomicBoolean(true);
        scenario.onActivity(activity -> {
            WebView webView = webView(activity);
            if (webView == null) {
                if (callbackActive.get()) completed.countDown();
                return;
            }
            webView.evaluateJavascript(JS_METRICS, value -> {
                if (callbackActive.get()) {
                    callbackValue.set(value);
                    callbackReceivedUptimeMs.set(SystemClock.elapsedRealtime());
                    completed.countDown();
                }
            });
        });
        boolean received;
        try {
            received = completed.await(JS_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } finally {
            callbackActive.set(false);
        }
        if (!received) return null;
        String value = callbackValue.get();
        if (value == null || "null".equals(value)) return null;
        try {
            Object parsed = new JSONTokener(value).nextValue();
            if (!(parsed instanceof JSONObject)) return null;
            JSONObject allowed = allowlistedJsValues((JSONObject) parsed);
            Long receivedAt = callbackReceivedUptimeMs.get();
            if (receivedAt != null) allowed.put("callbackReceivedUptimeMs", receivedAt);
            return allowed;
        } catch (JSONException ignored) {
            return null;
        }
    }

    private WebView webView(MainActivity activity) {
        Bridge bridge = activity.getBridge();
        return bridge == null ? null : bridge.getWebView();
    }

    private void emitComparisonStatus(
        String target,
        int requestCount,
        boolean nativeSettled,
        boolean baselineNativeReadyAfterWebViewReady,
        JSONObject baselineNative,
        JsSnapshotResult baselineJs,
        JSONObject afterNative,
        JsSnapshotResult afterJsResult,
        int stableSamples
    ) throws JSONException {
        JSONObject report = new JSONObject();
        report.put("schema", "nr-insets-probe/v1");
        report.put("phase", "request-comparison");
        report.put("packageId", TARGET_APP_ID);
        report.put("requestTarget", target);
        report.put("requestCount", requestCount);
        report.put("nativeSettled", nativeSettled);
        report.put("stableSampleCount", stableSamples);
        report.put("baselineNative", baselineNative);
        report.put("baselineNativeReadyAfterWebViewReady", baselineNativeReadyAfterWebViewReady);
        report.put("baselineNativeSnapshotAfterWebViewReady", baselineNativeReadyAfterWebViewReady);
        putNullable(report, "baselineWebView", baselineJs.snapshot);
        report.put("baselineWebViewReady", baselineJs.ready);
        report.put("baselineWebViewReadySamples", baselineJs.samples);
        putNullable(report, "afterNative", afterNative);
        putNullable(report, "afterWebView", afterJsResult.snapshot);
        report.put("afterWebViewReady", afterJsResult.ready);
        report.put("afterWebViewReadySamples", afterJsResult.samples);
        report.put("requestCompletionMeansCallbackObserved", false);
        report.put("sameNativeInsets", nativeSettled && afterNative != null && nativeInsetsFingerprint(baselineNative).equals(nativeInsetsFingerprint(afterNative)));
        report.put("sameWebViewInsetsAndFab", afterJsResult.ready && baselineJs.snapshot != null && afterJsResult.snapshot != null && jsInsetsFingerprint(baselineJs.snapshot).equals(jsInsetsFingerprint(afterJsResult.snapshot)));
        emitAllowlistedStatus(report);
    }

    private String nativeInsetsFingerprint(JSONObject snapshot) {
        if (snapshot == null) return "null";
        return snapshot.opt("platformSystemWindowInsetsPx")
            + "|" + snapshot.opt("platformStableInsetsPx")
            + "|" + snapshot.opt("compat");
    }

    private String jsInsetsFingerprint(JSONObject snapshot) {
        if (snapshot == null) return "null";
        return snapshot.opt("envSafeAreaBottomCssPx")
            + "|" + snapshot.opt("safeAreaInsetTopCssPx")
            + "|" + snapshot.opt("safeAreaInsetBottomCssPx")
            + "|" + snapshot.opt("insetTopCssPx")
            + "|" + snapshot.opt("insetBottomCssPx")
            + "|" + snapshot.opt("fabRect");
    }

    private void emitAllowlistedStatus(JSONObject report) {
        Bundle status = new Bundle();
        status.putString("nrInsetsProbe", report.toString());
        InstrumentationRegistry.getInstrumentation().sendStatus(0, status);
    }

    private static void putNullable(JSONObject target, String key, Object value) throws JSONException {
        target.put(key, value == null ? JSONObject.NULL : value);
    }

    private static JSONObject allowlistedJsValues(JSONObject source) throws JSONException {
        JSONObject allowed = new JSONObject();
        allowed.put("libraryScreenPresent", source.optBoolean("libraryScreenPresent", false));
        allowed.put("documentReady", source.optBoolean("documentReady", false));
        allowed.put("fontsReady", source.optBoolean("fontsReady", false));
        copyNumber(source, allowed, "envSafeAreaBottomCssPx");
        copyNumber(source, allowed, "safeAreaInsetTopCssPx");
        copyNumber(source, allowed, "safeAreaInsetBottomCssPx");
        copyNumber(source, allowed, "insetTopCssPx");
        copyNumber(source, allowed, "insetBottomCssPx");
        allowed.put("fabPresent", source.optBoolean("fabPresent", false));
        copyNumber(source, allowed, "fabBottomCssPx");
        JSONObject rect = source.optJSONObject("fabRect");
        if (rect == null) allowed.put("fabRect", JSONObject.NULL);
        else {
            JSONObject allowedRect = new JSONObject();
            for (String key : new String[] { "left", "right", "top", "bottom", "width", "height" }) copyNumber(rect, allowedRect, key);
            allowed.put("fabRect", allowedRect);
        }
        copyNumber(source, allowed, "innerHeightCssPx");
        JSONObject viewport = source.optJSONObject("visualViewport");
        if (viewport == null) allowed.put("visualViewport", JSONObject.NULL);
        else {
            JSONObject allowedViewport = new JSONObject();
            for (String key : new String[] { "height", "offsetTop", "offsetBottom", "scale" }) copyNumber(viewport, allowedViewport, key);
            allowed.put("visualViewport", allowedViewport);
        }
        copyNumber(source, allowed, "devicePixelRatio");
        copyDimensions(source, allowed, "screenCssPx");
        copyDimensions(source, allowed, "clientCssPx");
        return allowed;
    }

    private static void copyDimensions(JSONObject source, JSONObject target, String key) throws JSONException {
        JSONObject dimensions = source.optJSONObject(key);
        if (dimensions == null) {
            target.put(key, JSONObject.NULL);
            return;
        }
        JSONObject allowed = new JSONObject();
        copyNumber(dimensions, allowed, "width");
        copyNumber(dimensions, allowed, "height");
        target.put(key, allowed);
    }

    private static void copyNumber(JSONObject source, JSONObject target, String key) throws JSONException {
        if (!source.has(key) || source.isNull(key)) target.put(key, JSONObject.NULL);
        else target.put(key, source.getDouble(key));
    }

    private static final class JsSnapshotResult {
        final JSONObject snapshot;
        final boolean ready;
        final int samples;

        JsSnapshotResult(JSONObject snapshot, boolean ready, int samples) {
            this.snapshot = snapshot;
            this.ready = ready;
            this.samples = samples;
        }
    }

    private static final class SettledSnapshot {
        final boolean ready;
        final boolean settled;
        final JSONObject snapshot;
        final int stableSamples;

        SettledSnapshot(boolean ready, boolean settled, JSONObject snapshot, int stableSamples) {
            this.ready = ready;
            this.settled = settled;
            this.snapshot = snapshot;
            this.stableSamples = stableSamples;
        }
    }

}
