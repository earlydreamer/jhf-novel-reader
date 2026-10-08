package app.narou.reader;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.InsetDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
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
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
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
    private SourceBrowserTheme theme;

    @Override public void onCreate(Bundle savedInstanceState) {
        boolean systemNight = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        theme = SourceBrowserTheme.of(SourceBrowserTheme.isDark(getIntent().getStringExtra(SourceBrowserTheme.EXTRA), systemNight));
        // 대화상자 등 AppCompat 위젯도 같은 테마를 쓰게 한다. super.onCreate 전이라 재생성되지 않는다.
        getDelegate().setLocalNightMode(theme.dark ? AppCompatDelegate.MODE_NIGHT_YES : AppCompatDelegate.MODE_NIGHT_NO);
        super.onCreate(savedInstanceState);
        setResult(RESULT_CANCELED);
        LinearLayout screen = new LinearLayout(this);
        screen.setOrientation(LinearLayout.VERTICAL);
        screen.setBackgroundColor(theme.surface);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setMinimumHeight(dp(64));
        toolbar.setPadding(dp(4), 0, dp(4), 0);
        toolbar.setBackgroundColor(theme.surface);
        back = button("뒤로 가기", BACK_ID);
        back.setOnClickListener(view -> goBack());
        open = button("이 작품 열기", OPEN_ID);
        fill(open);
        open.setEnabled(false);
        open.setOnClickListener(view -> selectCurrentWork());
        Button close = button("닫기", CLOSE_ID);
        close.setOnClickListener(view -> finish());
        toolbar.addView(back);
        View spacer = new View(this);
        toolbar.addView(spacer, new LinearLayout.LayoutParams(0, 1, 1));
        toolbar.addView(open);
        toolbar.addView(close);
        screen.addView(toolbar);
        status = new TextView(this);
        status.setPadding(dp(16), dp(8), dp(16), dp(8));
        status.setTextColor(theme.onSurfaceVariant);
        status.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        status.setText("작품을 찾은 뒤 ‘이 작품 열기’를 눌러 주세요. 사이트 스크립트와 로그인은 지원하지 않아요.");
        screen.addView(status);
        View divider = new View(this);
        divider.setBackgroundColor(theme.outlineVariant);
        screen.addView(divider, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, Math.max(1, dp(1))));
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
        applySystemBars();
        configureBrowser();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { goBack(); }
        });
        String start = SourceBrowserPolicy.browseUrl(getIntent().getStringExtra(START_URL));
        if (start == null) {
            status.setText("지원하지 않는 탐색 주소예요.");
            back.setEnabled(false);
        } else if (savedInstanceState == null || browser.restoreState(savedInstanceState) == null) {
            browser.loadUrl(start);
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** M3 텍스트 버튼: 48dp 터치 영역, primary 글자, 리플 배경. */
    private Button button(String text, int id) {
        Button button = new Button(this);
        button.setId(id);
        button.setText(text);
        button.setContentDescription(text);
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        button.setMinimumHeight(dp(48));
        button.setMinWidth(dp(48));
        button.setMinimumWidth(dp(48));
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        button.setTextColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { SourceBrowserTheme.alpha(theme.onSurface, 0.38f), theme.primary }));
        TypedValue ripple = new TypedValue();
        if (getTheme().resolveAttribute(android.R.attr.selectableItemBackground, ripple, true))
            button.setBackgroundResource(ripple.resourceId);
        button.setStateListAnimator(null);
        return button;
    }

    /** M3 채움 버튼(주 행동): 40dp 높이 알약 모양, 터치 영역은 48dp를 유지한다. */
    private void fill(Button button) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(20));
        shape.setColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { SourceBrowserTheme.alpha(theme.onSurface, 0.12f), theme.primaryFill }));
        InsetDrawable inset = new InsetDrawable(shape, 0, dp(4), 0, dp(4));
        button.setBackground(new RippleDrawable(
            ColorStateList.valueOf(SourceBrowserTheme.alpha(theme.onPrimary, 0.10f)), inset, null));
        button.setTextColor(new ColorStateList(
            new int[][] { new int[] { -android.R.attr.state_enabled }, new int[] {} },
            new int[] { SourceBrowserTheme.alpha(theme.onSurface, 0.38f), theme.onPrimary }));
        button.setPadding(dp(16), 0, dp(16), 0);
    }

    /** 시스템 바 색과 아이콘 밝기를 탐색 화면 테마에 맞춘다. */
    @SuppressWarnings("deprecation") // 시스템 바 색 설정은 API 35에서 deprecated지만 minSdk 24 기기에는 필요하다.
    private void applySystemBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(!theme.dark);
        getWindow().setStatusBarColor(theme.surface);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            bars.setAppearanceLightNavigationBars(!theme.dark);
            getWindow().setNavigationBarColor(theme.surface);
        }
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
            status.setText("앱 안 탐색에서는 다운로드를 지원하지 않아요."));
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
                    if (request.isForMainFrame()) view.post(() -> status.setText("페이지를 불러오지 못했어요. 뒤로 가거나 탐색을 다시 열어 주세요."));
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
        AlertDialog dialog = new AlertDialog.Builder(this)
            .setTitle("외부 브라우저에서 열까요?")
            .setMessage(url)
            .setNegativeButton("닫기", null)
            .setPositiveButton("열기", (d, which) -> {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); }
                catch (ActivityNotFoundException unavailable) { status.setText("외부 브라우저를 찾지 못했어요."); }
            }).create();
        dialog.setOnShowListener(shown -> {
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(theme.primary);
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(theme.primary);
        });
        dialog.show();
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
