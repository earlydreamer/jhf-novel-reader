package app.narou.reader;

/** 원문 탐색 화면 색. 값은 src/ui/theme/tokens.css와 같고 SourceBrowserThemeTest가 대조한다. */
final class SourceBrowserTheme {
    static final String EXTRA = "theme";
    final boolean dark;
    final int surface, onSurface, onSurfaceVariant, outlineVariant, primary, primaryFill, onPrimary;

    private SourceBrowserTheme(boolean dark, int surface, int onSurface, int onSurfaceVariant,
                               int outlineVariant, int primary, int primaryFill, int onPrimary) {
        this.dark = dark;
        this.surface = surface;
        this.onSurface = onSurface;
        this.onSurfaceVariant = onSurfaceVariant;
        this.outlineVariant = outlineVariant;
        this.primary = primary;
        this.primaryFill = primaryFill;
        this.onPrimary = onPrimary;
    }

    /** 앱이 해석한 테마를 우선하고, 없거나 알 수 없는 값이면 시스템 야간 모드를 따른다. */
    static boolean isDark(String requested, boolean systemNight) {
        if ("dark".equals(requested)) return true;
        if ("light".equals(requested)) return false;
        return systemNight;
    }

    static SourceBrowserTheme of(boolean dark) {
        return dark
            ? new SourceBrowserTheme(true, 0xFF13131B, 0xFFEEEEF6, 0xFFC9C9DC, 0xFF464659, 0xFFD2D3FF, 0xFFD2D3FF, 0xFF1A1B55)
            : new SourceBrowserTheme(false, 0xFFFAFAFD, 0xFF1A1A28, 0xFF45465C, 0xFFC9C9DA, 0xFF3F4199, 0xFF6667AB, 0xFFFFFFFF);
    }

    /** M3 비활성 색: on-surface의 38%(글자)·12%(채움). */
    static int alpha(int color, float alpha) {
        return (Math.round(alpha * 255) << 24) | (color & 0x00FFFFFF);
    }
}
