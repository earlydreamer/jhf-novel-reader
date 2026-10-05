package app.narou.reader;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.view.View;
import android.webkit.ClientCertRequest;
import android.webkit.GeolocationPermissions;
import android.webkit.HttpAuthHandler;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import java.io.ByteArrayInputStream;
import java.net.URI;

/** A standalone WebView, never a BridgeActivity. Site content cannot invoke app plugins. */
public final class SourceBrowserActivity extends AppCompatActivity {
    static final int BROWSER_ID = View.generateViewId();
    static final int OPEN_ID = View.generateViewId();
    static final int BACK_ID = View.generateViewId();
    static final int CLOSE_ID = View.generateViewId();
    public static final String START_URL = "startUrl";
    public static final String SELECTED_URL = "selectedUrl";
    private WebView browser;
    private Button open;
    private Button back;
    private TextView status;
    private String selectedUrl;
    private SourceBrowserLoader loader;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        back = button("뒤로", BACK_ID);
        back.setOnClickListener(view -> goBack());
        open = button("이 작품 열기", OPEN_ID);
        open.setEnabled(false);
        open.setOnClickListener(view -> selectCurrentWork());
        Button close = button("닫기", CLOSE_ID);
        close.setOnClickListener(view -> finish());
        toolbar.addView(back);
        toolbar.addView(open, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
        toolbar.addView(close);
        screen.addView(toolbar);
        status = new TextView(this);
        status.setPadding(16, 8, 16, 8);
        status.setText("작품을 찾은 뒤 ‘이 작품 열기’를 누르세요. 사이트 스크립트와 로그인은 지원하지 않습니다.");
        screen.addView(status);
        browser = new WebView(this);
        browser.setId(BROWSER_ID);
        screen.addView(browser, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        ViewCompat.setOnApplyWindowInsetsListener(screen, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        setContentView(screen);
        ViewCompat.requestApplyInsets(screen);
        configureBrowser();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { goBack(); }
        });
        String start = SourceBrowserPolicy.browseUrl(getIntent().getStringExtra(START_URL));
        if (start == null) {
            status.setText("지원하지 않는 탐색 주소입니다.");
            back.setEnabled(false);
        } else if (savedInstanceState == null || browser.restoreState(savedInstanceState) == null) {
            browser.loadUrl(start);
        }
    }

    private Button button(String text, int id) {
        Button button = new Button(this);
        button.setId(id);
        button.setText(text);
        button.setContentDescription(text);
        return button;
    }

    @SuppressWarnings("deprecation") // Explicitly disable legacy file-origin privileges on supported WebViews.
    private void configureBrowser() {
        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(false);
        settings.setBlockNetworkLoads(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setDomStorageEnabled(false);
        settings.setGeolocationEnabled(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        browser.removeJavascriptInterface("searchBoxJavaBridge_");
        browser.removeJavascriptInterface("accessibility");
        browser.removeJavascriptInterface("accessibilityTraversal");
        loader = new SourceBrowserLoader(WebSettings.getDefaultUserAgent(this));
        browser.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            status.setText("앱 내 탐색에서는 다운로드를 지원하지 않습니다."));
        browser.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) { callback.invoke(origin, false, false); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) { callback.onReceiveValue(null); return true; }
        });
        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if ("GET".equals(request.getMethod()) && SourceBrowserPolicy.browseUrl(url) != null) return false;
                if (request.isForMainFrame() && request.hasGesture()) offerExternal(url);
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                URI input;
                try { input = URI.create(request.getUrl().toString()); }
                catch (IllegalArgumentException invalid) { return blockedResponse(); }
                try {
                    SourceBrowserLoader.Resource resource = loader.load(input, request.getMethod());
                    if (request.isForMainFrame() && resource.status >= 200 && resource.status < 300 && !resource.uri.equals(input)) {
                        // WebResourceResponse cannot express 3xx. Restart only a validated final main URL,
                        // so relative links and the trusted toolbar use the actual destination.
                        view.post(() -> {
                            if (!isFinishing() && !isDestroyed() && input.toString().equals(view.getUrl())) view.loadUrl(resource.uri.toString());
                        });
                        return blockedResponse();
                    }
                    return new WebResourceResponse(resource.mimeType, resource.encoding,
                        resource.status, resource.status >= 400 ? "Unavailable" : "OK", resource.headers,
                        new ByteArrayInputStream(resource.body));
                } catch (Exception unavailable) {
                    // Never fall through to WebView's unfiltered network loader after failure.
                    if (request.isForMainFrame()) view.post(() -> status.setText("페이지를 불러오지 못했습니다. 뒤로 가거나 탐색을 다시 열어 주세요."));
                    return blockedResponse();
                }
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                selectedUrl = null;
                open.setEnabled(false);
            }
            @Override public void onPageFinished(WebView view, String url) {
                selectedUrl = SourceBrowserPolicy.selectedUrl(view.getUrl());
                open.setEnabled(selectedUrl != null);
                back.setEnabled(view.canGoBack());
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) { handler.cancel(); }
            @Override public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) { request.cancel(); }
        });
    }

    private WebResourceResponse blockedResponse() {
        SourceBrowserLoader.Resource denied = SourceBrowserLoader.denied(URI.create("https://syosetu.com/"));
        return new WebResourceResponse(denied.mimeType, denied.encoding, 403, "Blocked", denied.headers, new ByteArrayInputStream(denied.body));
    }

    private void selectCurrentWork() {
        String current = SourceBrowserPolicy.selectedUrl(browser.getUrl());
        if (current == null || !current.equals(selectedUrl)) return;
        setResult(RESULT_OK, new Intent().putExtra(SELECTED_URL, current));
        finish();
    }

    private void goBack() {
        if (browser.canGoBack()) browser.goBack();
        else finish();
    }

    private void offerExternal(String url) {
        URI uri;
        try { uri = URI.create(url); }
        catch (IllegalArgumentException invalid) { return; }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null) return;
        new AlertDialog.Builder(this)
            .setTitle("외부 링크")
            .setMessage(url)
            .setNegativeButton("취소", null)
            .setPositiveButton("외부 브라우저에서 열기", (dialog, which) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
                catch (ActivityNotFoundException unavailable) { status.setText("외부 브라우저를 찾지 못했습니다."); }
            }).show();
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        browser.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override protected void onDestroy() {
        if (browser != null) {
            browser.stopLoading();
            browser.destroy();
        }
        super.onDestroy();
    }
}
