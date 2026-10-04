package app.narou.reader;

import java.net.URI;
import java.util.Locale;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Browsing privileges are deliberately separate from work/chapter extraction. */
public final class SourceBrowserPolicy {
    private static final Set<String> HOSTS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "syosetu.com", "www.syosetu.com", "yomou.syosetu.com",
        "ncode.syosetu.com", "static.syosetu.com"
    )));
    private static final Pattern WORK = Pattern.compile("^/(n[0-9]{4}[a-z]{1,2})(?:/([1-9][0-9]*))?/?$", Pattern.CASE_INSENSITIVE);
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;

    private SourceBrowserPolicy() {}

    public static String browseUrl(String input) {
        if (input == null || input.matches(".*[\\\\\\x00-\\x20\\x7f].*")) return null;
        try {
            URI uri = new URI(input);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                || !HOSTS.contains(host.toLowerCase(Locale.ROOT))
                || uri.getRawUserInfo() != null || uri.getPort() != -1) return null;
            String path = uri.getRawPath();
            if (path == null || path.isEmpty()) path = "/";
            if (path.matches(".*(?:^|/)\\.{1,2}(?:/|$).*") || path.toLowerCase(Locale.ROOT).matches(".*%(?:2e|2f|5c|00|0a|0d).*")) return null;
            return "https://" + host.toLowerCase(Locale.ROOT) + path
                + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
        } catch (Exception invalid) {
            return null;
        }
    }

    public static String selectedUrl(String input) {
        String browsable = browseUrl(input);
        if (browsable == null) return null;
        URI uri = URI.create(browsable);
        if (!"ncode.syosetu.com".equals(uri.getHost())) return null;
        Matcher path = WORK.matcher(uri.getRawPath());
        if (!path.matches()) return null;
        String chapter = path.group(2);
        if (chapter != null && !positiveSafeInteger(chapter)) return null;
        String query = uri.getRawQuery();
        if (query != null && (chapter != null || !query.matches("p=[1-9][0-9]*") || !positiveSafeInteger(query.substring(2)))) return null;
        return "https://ncode.syosetu.com/" + path.group(1).toLowerCase(Locale.ROOT) + "/"
            + (chapter == null ? "" : chapter + "/")
            + (query == null ? "" : "?" + query);
    }

    private static boolean positiveSafeInteger(String input) {
        try {
            long value = Long.parseLong(input);
            return value > 0 && value <= MAX_SAFE_INTEGER;
        } catch (NumberFormatException invalid) {
            return false;
        }
    }
}
