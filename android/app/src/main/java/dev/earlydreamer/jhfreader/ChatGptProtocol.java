package dev.earlydreamer.jhfreader;

import java.math.BigInteger;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sign in with ChatGPT 공개 클라이언트 계약. 주소와 매개변수는 고정이며 외부 입력으로 바꾸지 않는다.
 * 오류 메시지에 토큰·코드·계정 식별자 같은 입력값을 넣지 않는다.
 */
final class ChatGptProtocol {
    static final String ISSUER = "https://auth.openai.com";
    static final String AUTHORIZE = ISSUER + "/api/accounts/authorize";
    static final String TOKEN = ISSUER + "/api/accounts/oauth/token";
    static final String REVOKE = ISSUER + "/api/accounts/oauth/revoke";
    static final String JWKS = ISSUER + "/.well-known/jwks.json";
    static final String RESOURCE = "https://api.openai.com/v1";
    static final String MODELS = RESOURCE + "/models";
    static final String RESPONSES = RESOURCE + "/responses";
    static final String SCOPES =
        "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    static final String PLAN_SCOPE = "chatgpt.tokens.use.direct";
    static final String DYNAMIC = "dynamic_agent_client";
    static final String APP_NAME = "JHF Novel Reader";
    static final String CALLBACK_PATH = "/auth/callback";

    /** 갱신 토큰을 더 쓸 수 없다는 공식 오류. 토큰을 지우고 다시 로그인해야 한다. */
    static final Set<String> TERMINAL_REFRESH = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired",
        "refresh_token_invalidated", "refresh_token_reused")));
    /** 앱에 전달해도 되는 오류 코드. 자유 문장은 전달하지 않는다. */
    static final Set<String> ERROR_CODES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "subscription_sharing_user_not_eligible", "subscription_sharing_usage_limit_exceeded",
        "subscription_sharing_usage_unavailable", "subscription_sharing_unsupported_capability",
        "subscription_sharing_route_not_supported", "subscription_sharing_invalid_user",
        "subscription_sharing_user_unavailable", "chatpass_v2_scope_not_authorized",
        "chatpass_v2_invalid_authorization_context", "model_not_found", "rate_limit_exceeded",
        "context_length_exceeded", "invalid_prompt", "server_error")));
    static final Set<String> ERROR_PARAMS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "model", "input", "instructions", "store", "stream", "text", "reasoning", "include")));
    /** Responses 요청에서 앱이 보낼 수 있는 키. temperature·출력 상한·이전 응답 ID는 SiwC가 받지 않는다. */
    static final Set<String> BODY_KEYS = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "model", "instructions", "input", "stream", "store", "reasoning", "text")));

    private ChatGptProtocol() { }

    static final class Invalid extends Exception {
        final String reason;
        Invalid(String reason) { super(reason); this.reason = reason; }
    }

    /** 사용자가 권한 동의를 거부했다. 연결을 저장하지 않는다. */
    static final class Denied extends Exception {
        Denied() { super("denied"); }
    }

    static String random() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return encode(bytes);
    }

    static String hostId() {
        return "urn:uuid:" + java.util.UUID.randomUUID();
    }

    private static final String ALPHABET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    /** 패딩 없는 base64url. minSdk 24에서 java.util.Base64를 쓰지 않고 JVM 검사도 같은 코드로 한다. */
    static String encode(byte[] value) {
        StringBuilder out = new StringBuilder((value.length * 4 + 2) / 3);
        for (int i = 0; i < value.length; i += 3) {
            int n = (value[i] & 0xff) << 16;
            if (i + 1 < value.length) n |= (value[i + 1] & 0xff) << 8;
            if (i + 2 < value.length) n |= value[i + 2] & 0xff;
            out.append(ALPHABET.charAt((n >> 18) & 63)).append(ALPHABET.charAt((n >> 12) & 63));
            if (i + 1 < value.length) out.append(ALPHABET.charAt((n >> 6) & 63));
            if (i + 2 < value.length) out.append(ALPHABET.charAt(n & 63));
        }
        return out.toString();
    }

    static byte[] decode(String value) throws Invalid {
        if (value == null || !value.matches("[A-Za-z0-9_-]+") || value.length() % 4 == 1)
            throw new Invalid("encoding");
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(value.length() * 3 / 4);
        int buffer = 0, bits = 0;
        for (int i = 0; i < value.length(); i++) {
            buffer = (buffer << 6) | ALPHABET.indexOf(value.charAt(i));
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                out.write((buffer >> bits) & 0xff);
            }
        }
        // 남은 비트가 0이 아니면 정규 인코딩이 아니다.
        if ((buffer & ((1 << bits) - 1)) != 0) throw new Invalid("encoding");
        return out.toByteArray();
    }

    static boolean equal(String left, String right) {
        return left != null && right != null && MessageDigest.isEqual(
            left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
    }

    static String challenge(String verifier) throws Exception {
        return encode(MessageDigest.getInstance("SHA-256")
            .digest(verifier.getBytes(StandardCharsets.US_ASCII)));
    }

    static String form(Map<String, String> fields) throws Exception {
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, String> field : fields.entrySet()) {
            if (result.length() > 0) result.append('&');
            result.append(URLEncoder.encode(field.getKey(), "UTF-8")).append('=')
                .append(URLEncoder.encode(field.getValue(), "UTF-8"));
        }
        return result.toString();
    }

    static String redirect(int port) {
        return "http://127.0.0.1:" + port + CALLBACK_PATH;
    }

    /** 첫 등록은 dynamic_agent_client와 앱 이름 힌트, 재로그인은 발급받은 client ID만 쓴다. */
    static String authorization(String host, String client, String redirect, String state,
                                String nonce, String verifier) throws Exception {
        if (!host.matches("urn:uuid:[0-9a-f-]{36}")) throw new Invalid("host");
        if (!DYNAMIC.equals(client) && !issuedClient(client)) throw new Invalid("client");
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("client_id", client);
        if (DYNAMIC.equals(client)) fields.put("agent_name_hint", APP_NAME);
        fields.put("ext_agent_host_id", host);
        fields.put("response_type", "code");
        fields.put("redirect_uri", redirect);
        fields.put("scope", SCOPES);
        fields.put("resource", RESOURCE);
        fields.put("state", state);
        fields.put("nonce", nonce);
        fields.put("code_challenge_method", "S256");
        fields.put("code_challenge", challenge(verifier));
        return AUTHORIZE + "?" + form(fields);
    }

    static boolean issuedClient(String client) {
        return client != null && client.matches("oaiapp_[A-Za-z0-9_-]{1,200}");
    }

    /** 콜백 대상의 경로·질의만 받는다. 중복 키·제어 문자·fragment는 거절한다. */
    static Map<String, String> query(String target) throws Exception {
        if (target == null || !target.startsWith(CALLBACK_PATH + "?") || target.length() > 8192
            || target.indexOf('#') >= 0) throw new Invalid("callback path");
        Map<String, String> result = new LinkedHashMap<>();
        for (String part : target.substring(CALLBACK_PATH.length() + 1).split("&", -1)) {
            String[] pair = part.split("=", 2);
            if (pair.length != 2) throw new Invalid("query");
            String key = URLDecoder.decode(pair[0], "UTF-8");
            String value = URLDecoder.decode(pair[1], "UTF-8");
            if (value.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new Invalid("query control");
            if (result.put(key, value) != null) throw new Invalid("duplicate query");
        }
        return result;
    }

    /**
     * state를 먼저 확인한 뒤 거부·코드·client ID를 판정한다. 반환값은 토큰 교환에 쓸 client ID다.
     * 새 등록이면 콜백의 발급 ID가 있어야 하고, 재로그인이면 저장한 ID와 같아야 한다.
     */
    static String callbackClient(Map<String, String> query, String state, String selected)
        throws Exception {
        if (!equal(state, query.get("state"))) throw new Invalid("state");
        if (query.containsKey("error")) throw new Denied();
        String code = query.get("code");
        if (code == null || code.isEmpty() || code.length() > 4096) throw new Invalid("code");
        String client = query.get("client_id");
        if (!DYNAMIC.equals(selected)) {
            if (client != null && !selected.equals(client)) throw new Invalid("client mismatch");
            return selected;
        }
        if (!issuedClient(client)) throw new Invalid("issued client missing");
        return client;
    }

    static boolean permits(JSONObject tokens) {
        return Arrays.asList(tokens.optString("scope", "").trim().split(" +")).contains(PLAN_SCOPE);
    }

    /** 공식 JWKS의 RS256 서명과 issuer·audience·만료·nonce를 확인하고 검증된 sub를 돌려준다. */
    static String identity(String jwt, JSONObject jwks, String client, String nonce, long nowSeconds)
        throws Exception {
        if (jwt == null || jwt.length() > 65536) throw new Invalid("token size");
        String[] parts = jwt.split("\\.", -1);
        if (parts.length != 3) throw new Invalid("token format");
        JSONObject header = new JSONObject(new String(decode(parts[0]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg")) || header.has("crit")) throw new Invalid("algorithm");
        String kid = header.optString("kid");
        JSONArray keys = jwks.getJSONArray("keys");
        JSONObject selected = null;
        for (int i = 0; i < keys.length(); i++) {
            JSONObject key = keys.getJSONObject(i);
            if (kid.equals(key.optString("kid")) && "RSA".equals(key.optString("kty"))
                && "sig".equals(key.optString("use", "sig"))
                && "RS256".equals(key.optString("alg", "RS256"))) {
                if (selected != null) throw new Invalid("ambiguous key");
                selected = key;
            }
        }
        if (selected == null) throw new Invalid("key missing");
        BigInteger modulus = new BigInteger(1, decode(selected.getString("n")));
        if (modulus.bitLength() < 2048) throw new Invalid("weak key");
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(
            modulus, new BigInteger(1, decode(selected.getString("e"))))));
        signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        if (!signature.verify(decode(parts[2]))) throw new Invalid("signature");
        JSONObject claims = new JSONObject(new String(decode(parts[1]), StandardCharsets.UTF_8));
        Object audience = claims.opt("aud");
        boolean audienceOk = client.equals(audience);
        if (audience instanceof JSONArray) {
            JSONArray all = (JSONArray) audience;
            for (int i = 0; i < all.length(); i++) if (client.equals(all.opt(i))) audienceOk = true;
            if (all.length() > 1 && !client.equals(claims.optString("azp"))) audienceOk = false;
        }
        if (!ISSUER.equals(claims.optString("iss")) || !audienceOk
            || claims.optLong("exp", 0) <= nowSeconds || claims.optLong("iat", 0) > nowSeconds + 60
            || (claims.has("nbf") && claims.getLong("nbf") > nowSeconds + 60)
            || (nonce != null && !equal(nonce, claims.optString("nonce", null))))
            throw new Invalid("claims");
        String subject = claims.optString("sub");
        if (subject.isEmpty() || subject.length() > 512) throw new Invalid("subject");
        return subject;
    }

    /** 표시 대상(visibility=list) 모델만 서버 순서대로 돌려준다. */
    static JSONArray models(String body) throws Exception {
        JSONArray models = new JSONObject(body).getJSONArray("models");
        JSONArray result = new JSONArray();
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < models.length(); i++) {
            JSONObject model = models.getJSONObject(i);
            if (!"list".equals(model.optString("visibility"))) continue;
            String slug = model.optString("slug"), name = model.optString("display_name", slug);
            if (!slug.matches("[A-Za-z0-9._:/-]{1,160}") || name.isEmpty() || name.length() > 160
                || name.matches("(?s).*[\\x00-\\x1f\\x7f].*") || !seen.add(slug))
                throw new Invalid("model catalog");
            result.put(new JSONObject().put("slug", slug).put("displayName", name));
        }
        return result;
    }

    /** 오류 본문에서 허용 어휘의 code·param만 남긴다. 서버 문장·detail·요청 ID는 버린다. */
    static JSONObject errorSummary(String raw) {
        Map<String, Object> error = new LinkedHashMap<>();
        try {
            JSONObject body = new JSONObject(raw == null ? "" : raw);
            JSONObject value = body.optJSONObject("error");
            if (value != null) {
                String code = value.optString("code");
                String param = value.optString("param");
                if (ERROR_CODES.contains(code)) error.put("code", code);
                if (ERROR_PARAMS.contains(param)) error.put("param", param);
            } else if (body.opt("detail") instanceof String) {
                error.put("detail", true);
            }
        } catch (JSONException ignored) {
            // 형식이 다른 오류 본문은 상태 코드만으로 판정한다.
        }
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("error", new JSONObject(error));
        return new JSONObject(summary);
    }

    /** 앱이 보낸 요청에서 허용한 키만 남기고 store:false·stream:true를 강제한다. */
    static JSONObject responsesBody(JSONObject input) throws Exception {
        if (input == null) throw new Invalid("body");
        JSONObject body = new JSONObject();
        for (Iterator<String> keys = input.keys(); keys.hasNext();) {
            String key = keys.next();
            if (!BODY_KEYS.contains(key)) throw new Invalid("body key");
            body.put(key, input.get(key));
        }
        if (!body.optString("model").matches("[A-Za-z0-9._:/-]{1,160}")) throw new Invalid("model");
        if (!(body.opt("input") instanceof JSONArray)) throw new Invalid("input");
        JSONArray items = body.getJSONArray("input");
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            String role = item == null ? "" : item.optString("role");
            if (!"user".equals(role) && !"assistant".equals(role) && !"developer".equals(role))
                throw new Invalid("input role");
        }
        body.put("store", false).put("stream", true);
        return body;
    }
}
