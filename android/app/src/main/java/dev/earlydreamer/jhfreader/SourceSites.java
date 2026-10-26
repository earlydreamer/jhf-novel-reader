package dev.earlydreamer.jhfreader;

import java.net.URI;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 원문 탐색 사이트 프로필의 정본. 브라우저·loader·정책은 사이트별 분기 없이 이 목록만 읽는다.
 * 새 사이트는 ALL에 프로필 하나를 더한다. TS의 BROWSE_SITES와 id·시작 주소·호스트가 같아야 한다.
 */
final class SourceSites {
    private static final Pattern DEFAULT_VALUE = Pattern.compile("[\\x20-\\x7e]{1,128}");
    /** Credentials, protocol headers and the loader's own Accept/User-Agent are never page-controlled. */
    private static final Set<String> CREDENTIAL_HEADERS = new HashSet<>(Arrays.asList(
        "cookie", "cookie2", "authorization", "proxy-authorization", "host", "accept", "user-agent"));
    private static final Pattern NAROU_WORK = Pattern.compile("^/(n[0-9]{4}[a-z]{1,2})(?:/([1-9][0-9]*))?/?$", Pattern.CASE_INSENSITIVE);
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;

    static final class Site {
        final String id;
        final String startUrl;
        final Set<String> hosts;
        final boolean scripts;
        /** 소문자 헤더 이름 → 원래 표기와 허용 값. */
        private final Map<String, Map.Entry<String, Pattern>> headerRules = new LinkedHashMap<>();
        private final Function<URI, String> selection;

        Site(String id, String startUrl, Set<String> hosts, Map<String, Pattern> headerRules, boolean scripts, Function<URI, String> selection) {
            this.id = id;
            this.startUrl = startUrl;
            this.hosts = Collections.unmodifiableSet(new HashSet<>(hosts));
            this.scripts = scripts;
            this.selection = selection;
            for (Map.Entry<String, Pattern> rule : headerRules.entrySet()) {
                String key = rule.getKey().toLowerCase(Locale.ROOT);
                if (CREDENTIAL_HEADERS.contains(key)) throw new IllegalArgumentException("Credential header cannot be forwarded: " + rule.getKey());
                this.headerRules.put(key, new java.util.AbstractMap.SimpleImmutableEntry<>(rule.getKey(), rule.getValue()));
            }
        }

        /** browseUrl을 통과한 주소에서 앱으로 가져갈 작품·회차 주소. 아니면 null. */
        String selectedUrl(URI browsable) {
            return selection.apply(browsable);
        }

        /** 페이지 요청 헤더 중 이 사이트가 허용한 이름·값만 남긴다. */
        Map<String, String> forwardHeaders(Map<String, String> pageHeaders) {
            Map<String, String> forwarded = new LinkedHashMap<>();
            if (pageHeaders == null) return forwarded;
            for (Map.Entry<String, String> header : pageHeaders.entrySet()) {
                if (header.getKey() == null || header.getValue() == null) continue;
                Map.Entry<String, Pattern> rule = headerRules.get(header.getKey().toLowerCase(Locale.ROOT));
                if (rule != null && rule.getValue().matcher(header.getValue()).matches()) forwarded.put(rule.getKey(), header.getValue());
            }
            return forwarded;
        }
    }

    static final List<Site> ALL = Collections.unmodifiableList(Arrays.asList(
        new Site(
            "narou",
            "https://syosetu.com/",
            hosts("syosetu.com", "www.syosetu.com", "yomou.syosetu.com", "ncode.syosetu.com", "static.syosetu.com"),
            Collections.emptyMap(),
            true,
            SourceSites::narouSelection)
    ));

    private SourceSites() {}

    private static Set<String> hosts(String... values) {
        return new HashSet<>(Arrays.asList(values));
    }

    static Pattern defaultValue() {
        return DEFAULT_VALUE;
    }

    static Site forHost(String host) {
        if (host == null) return null;
        String normalized = host.toLowerCase(Locale.ROOT);
        for (Site site : ALL) {
            if (site.hosts.contains(normalized)) return site;
        }
        return null;
    }

    static Set<String> allHosts() {
        Set<String> all = new HashSet<>();
        for (Site site : ALL) all.addAll(site.hosts);
        return all;
    }

    /** 응답에 붙일 CSP. 페이지 통신을 loader가 보는 출처로만 묶고, 스크립트를 허용하지 않는 응답은 실행도 막는다. */
    static String csp(URI uri) {
        StringBuilder connect = new StringBuilder("connect-src");
        for (String host : new TreeSet<>(allHosts())) connect.append(" https://").append(host);
        Site site = forHost(uri == null ? null : uri.getHost());
        String policy = connect + "; worker-src 'none'; object-src 'none'";
        return site != null && site.scripts ? policy : policy + "; script-src 'none'";
    }

    private static String narouSelection(URI uri) {
        if (!"ncode.syosetu.com".equals(uri.getHost())) return null;
        Matcher path = NAROU_WORK.matcher(uri.getRawPath());
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
