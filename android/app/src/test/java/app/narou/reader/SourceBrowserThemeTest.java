package app.narou.reader;

import static org.junit.Assert.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.Test;

public class SourceBrowserThemeTest {
    @Test public void appThemeWinsAndSystemIsTheFallback() {
        assertTrue(SourceBrowserTheme.isDark("dark", false));
        assertFalse(SourceBrowserTheme.isDark("light", true));
        assertTrue(SourceBrowserTheme.isDark(null, true));
        assertFalse(SourceBrowserTheme.isDark(null, false));
        assertFalse(SourceBrowserTheme.isDark("sepia", false));
    }

    @Test public void colorsMatchTheWebTokens() throws IOException {
        String css = new String(Files.readAllBytes(tokens()), StandardCharsets.UTF_8);
        String light = block(css, ":root {");
        String dark = block(css, ":root[data-theme='dark'] {");
        assertTokens(light, SourceBrowserTheme.of(false));
        assertTokens(dark, SourceBrowserTheme.of(true));
    }

    private static void assertTokens(String block, SourceBrowserTheme theme) {
        assertEquals(token(block, "surface"), theme.surface);
        assertEquals(token(block, "on-surface"), theme.onSurface);
        assertEquals(token(block, "on-surface-variant"), theme.onSurfaceVariant);
        assertEquals(token(block, "outline-variant"), theme.outlineVariant);
        assertEquals(token(block, "primary"), theme.primary);
        assertEquals(token(block, "primary-fill"), theme.primaryFill);
        assertEquals(token(block, "on-primary"), theme.onPrimary);
    }

    private static Path tokens() {
        // Gradle 단위 테스트의 작업 디렉터리는 android/app이다.
        Path path = Paths.get("..", "..", "src", "ui", "theme", "tokens.css");
        assertTrue("tokens.css를 찾지 못했다: " + path.toAbsolutePath(), Files.exists(path));
        return path;
    }

    private static String block(String css, String opener) {
        int start = css.indexOf(opener);
        assertTrue("블록을 찾지 못했다: " + opener, start >= 0);
        int end = css.indexOf('}', start);
        return css.substring(start, end);
    }

    private static int token(String block, String name) {
        Matcher matcher = Pattern.compile("(?m)^\s*--" + Pattern.quote(name) + ":\s*#([0-9a-fA-F]{6});").matcher(block);
        assertTrue("토큰이 없다: --" + name, matcher.find());
        return 0xFF000000 | Integer.parseInt(matcher.group(1), 16);
    }
}
