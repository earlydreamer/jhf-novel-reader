package dev.earlydreamer.jhfreader;

import java.net.URI;
import java.util.Locale;

/** Browsing privileges are deliberately separate from work/chapter extraction. Site differences live in SourceSites. */
public final class SourceBrowserPolicy {
    static final String SITE_UNAVAILABLE = "사이트가 접속을 막았거나 응답하지 않아요. 잠시 뒤 다시 열어 주세요.";

    private SourceBrowserPolicy() {}

    /** 주 프레임 응답 상태에 대한 상태 줄 안내. 사이트가 막거나 실패한 응답만 알리고, 앱의 차단은 사이트 탓으로 돌리지 않는다. */
    static String mainFrameNotice(URI finalUri, int status) {
        if (finalUri == null || SourceSites.forHost(finalUri.getHost()) == null) return null;
        return status == 403 || status == 429 || status >= 500 ? SITE_UNAVAILABLE : null;
    }

    public static String browseUrl(String input) {
        if (input == null || input.matches(".*[\\\\\\x00-\\x20\\x7f].*")) return null;
        try {
            URI uri = new URI(input);
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null
                || !SourceSites.allHosts().contains(host.toLowerCase(Locale.ROOT))
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
        SourceSites.Site site = SourceSites.forHost(uri.getHost());
        return site == null ? null : site.selectedUrl(uri);
    }
}
