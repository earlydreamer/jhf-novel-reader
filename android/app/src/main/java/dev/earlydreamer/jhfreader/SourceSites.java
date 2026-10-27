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
    // Kakuyomu IDs exceed long precision, so they stay digit strings.
    private static final Pattern KAKUYOMU_WORK = Pattern.compile("^/works/([1-9][0-9]{0,29})(?:/episodes/([1-9][0-9]{0,29}))?/?$");
    // pixiv IDs stay digit strings like the app's pixiv-s<ID>/pixiv-n<ID> work IDs.
    private static final Pattern PIXIV_SERIES = Pattern.compile("^/novel/series/([1-9][0-9]{0,19})/?$");
    private static final Pattern PIXIV_SHOW_QUERY = Pattern.compile("^id=([1-9][0-9]{0,19})$");
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
            SourceSites::narouSelection),
        new Site(
            "kakuyomu",
            "https://kakuyomu.jp/",
            hosts("kakuyomu.jp", "cdn-static.kakuyomu.jp"),
            kakuyomuHeaders(),
            true,
            SourceSites::kakuyomuSelection),
        new Site(
            "pixiv",
            "https://www.pixiv.net/novel",
            hosts("www.pixiv.net", "s.pximg.net", "i.pximg.net", "embed.pixiv.net"),
            Collections.emptyMap(),
            true,
            SourceSites::pixivSelection)
    ));

    /** Built once from ALL; profiles are fixed at class load, so per-request rebuilding is unnecessary. */
    private static final Set<String> ALL_HOSTS = collectHosts();
    private static final String BASE_CSP = baseCsp();

    private static Set<String> collectHosts() {
        Set<String> all = new HashSet<>();
        for (Site site : ALL) all.addAll(site.hosts);
        return Collections.unmodifiableSet(all);
    }

    private static String baseCsp() {
        StringBuilder connect = new StringBuilder("connect-src");
        for (String host : new TreeSet<>(ALL_HOSTS)) connect.append(" https://").append(host);
        return connect + "; worker-src 'none'; object-src 'none'";
    }

    private SourceSites() {}

    private static Set<String> hosts(String... values) {
        return new HashSet<>(Arrays.asList(values));
    }

    /** Page GraphQL GETs are refused (HTTP 400) without Apollo's CSRF-preflight headers. */
    private static Map<String, Pattern> kakuyomuHeaders() {
        Map<String, Pattern> rules = new LinkedHashMap<>();
        rules.put("Content-Type", Pattern.compile("application/json(?:;\\s*charset=[A-Za-z0-9-]+)?", Pattern.CASE_INSENSITIVE));
        rules.put("apollo-require-preflight", DEFAULT_VALUE);
        rules.put("x-apollo-operation-name", DEFAULT_VALUE);
        return rules;
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
        return ALL_HOSTS;
    }

    /** 응답에 붙일 CSP. 페이지 통신을 loader가 보는 출처로만 묶고, 스크립트를 허용하지 않는 응답은 실행도 막는다. */
    static String csp(URI uri) {
        Site site = forHost(uri == null ? null : uri.getHost());
        return site != null && site.scripts ? BASE_CSP : BASE_CSP + "; script-src 'none'";
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

    private static String kakuyomuSelection(URI uri) {
        if (!"kakuyomu.jp".equals(uri.getHost()) || uri.getRawQuery() != null) return null;
        Matcher path = KAKUYOMU_WORK.matcher(uri.getRawPath());
        if (!path.matches()) return null;
        String episode = path.group(2);
        return "https://kakuyomu.jp/works/" + path.group(1) + (episode == null ? "" : "/episodes/" + episode);
    }

    /** 소설 회차·단독 작품(show.php)과 시리즈 주소만 앱으로 가져간다. 단독인지 시리즈 회차인지는 앱이 조회로 판별한다. */
    private static String pixivSelection(URI uri) {
        if (!"www.pixiv.net".equals(uri.getHost())) return null;
        String path = uri.getRawPath();
        String query = uri.getRawQuery();
        Matcher series = PIXIV_SERIES.matcher(path);
        if (series.matches()) return query == null ? "https://www.pixiv.net/novel/series/" + series.group(1) : null;
        if (!"/novel/show.php".equals(path) || query == null) return null;
        Matcher novel = PIXIV_SHOW_QUERY.matcher(query);
        return novel.matches() ? "https://www.pixiv.net/novel/show.php?id=" + novel.group(1) : null;
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
