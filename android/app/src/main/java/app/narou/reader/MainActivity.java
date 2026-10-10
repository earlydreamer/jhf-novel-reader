package app.narou.reader;

import android.content.res.Configuration;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private String resolvedTheme;

    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SourceBrowserPlugin.class);
        registerPlugin(ModelStreamPlugin.class);
        registerPlugin(ReaderThemePlugin.class);
        registerPlugin(ScreenAwakePlugin.class);
        super.onCreate(savedInstanceState);
        WindowCompat.enableEdgeToEdge(getWindow());
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
