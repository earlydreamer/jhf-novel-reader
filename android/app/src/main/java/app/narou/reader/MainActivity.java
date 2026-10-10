package app.narou.reader;

import android.animation.ObjectAnimator;
import android.content.res.Configuration;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.TypedValue;
import android.view.View;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    /** 스플래시를 붙잡아 둘 최대 시간. 웹이 신호를 못 보내도 이 시간 뒤에는 내려간다. */
    private static final long SPLASH_LIMIT_MS = 3000;
    private volatile boolean webReady;
    private long splashDeadline;
    private String resolvedTheme;

    @Override public void onCreate(Bundle savedInstanceState) {
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splashDeadline = SystemClock.uptimeMillis() + SPLASH_LIMIT_MS;
        splash.setKeepOnScreenCondition(
            () -> !webReady && SystemClock.uptimeMillis() < splashDeadline);
        splash.setOnExitAnimationListener(view -> {
            ObjectAnimator fade = ObjectAnimator.ofFloat(view.getView(), View.ALPHA, 1f, 0f);
            fade.setDuration(200);
            fade.addListener(new android.animation.AnimatorListenerAdapter() {
                @Override public void onAnimationEnd(android.animation.Animator animation) {
                    view.remove();
                }
            });
            fade.start();
        });
        registerPlugin(SourceBrowserPlugin.class);
        registerPlugin(ModelStreamPlugin.class);
        registerPlugin(OnDeviceEmbeddingPlugin.class);
        registerPlugin(ReaderThemePlugin.class);
        registerPlugin(ScreenAwakePlugin.class);
        registerPlugin(AppReadyPlugin.class);
        super.onCreate(savedInstanceState);
        WindowCompat.enableEdgeToEdge(getWindow());
    }

    void markReady() {
        webReady = true;
    }

    /** 앱이 마지막으로 적용한 테마(light/dark). 아직 없으면 null. */
    String resolvedTheme() {
        return resolvedTheme;
    }

    void applyResolvedTheme(String theme) {
        if (!"light".equals(theme) && !"dark".equals(theme)) {
            throw new IllegalArgumentException("Unsupported resolved theme");
        }
        resolvedTheme = theme;
        getTheme().applyStyle(themeStyle(), true);
        applyResolvedWindowBackground();
    }

    @Override
    public void onResume() {
        super.onResume();
        reapplyResolvedTheme();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        if (resolvedTheme != null) {
            View decorView = getWindow().getDecorView();
            // SystemBars reapplies its saved icon style from BridgeActivity's callback and paints
            // the current android:windowBackground. Run after those queued callbacks.
            decorView.post(this::reapplyResolvedTheme);
        }
    }

    private int themeStyle() {
        return "dark".equals(resolvedTheme)
            ? R.style.ReaderThemeOverlayDark
            : R.style.ReaderThemeOverlayLight;
    }

    private void reapplyResolvedTheme() {
        if (resolvedTheme == null) return;
        getTheme().applyStyle(themeStyle(), true);
        applyResolvedWindowBackground();
    }

    private void applyResolvedWindowBackground() {
        TypedValue background = new TypedValue();
        if (!getTheme().resolveAttribute(android.R.attr.windowBackground, background, true)) return;
        if (
            background.type >= TypedValue.TYPE_FIRST_COLOR_INT &&
            background.type <= TypedValue.TYPE_LAST_COLOR_INT
        ) {
            getWindow().getDecorView().setBackgroundColor(background.data);
        } else if (background.resourceId != 0) {
            getWindow().getDecorView().setBackgroundResource(background.resourceId);
        }
    }
}
