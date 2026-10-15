package dev.earlydreamer.jhfreader;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigInteger;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.LinkedHashMap;
import java.util.Map;

/** debug 전용, 고정된 공식 public-client 계약. 오류에 입력값을 포함하지 않는다. */
final class SiwcProtocol {
    static final String ISSUER = "https://auth.openai.com";
    static final String RESOURCE = "https://api.openai.com/v1";
    static final String SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
    static final String DYNAMIC = "dynamic_agent_client";

    static String random() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return encode(bytes);
    }

    static String encode(byte[] value) {
        return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    static byte[] decode(String value) {
        if (!value.matches("[A-Za-z0-9_-]+")) throw new IllegalArgumentException("encoding");
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    static boolean equal(String left, String right) {
        return left != null && right != null && MessageDigest.isEqual(
            left.getBytes(StandardCharsets.UTF_8), right.getBytes(StandardCharsets.UTF_8));
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

    static String authorization(String host, String client, String redirect, String state,
                                String nonce, String verifier) throws Exception {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("client_id", client);
        if (DYNAMIC.equals(client)) fields.put("agent_name_hint", "JHF Novel Reader");
        fields.put("ext_agent_host_id", host);
        fields.put("response_type", "code");
        fields.put("redirect_uri", redirect);
        fields.put("scope", SCOPES);
        fields.put("resource", RESOURCE);
        fields.put("state", state);
        fields.put("nonce", nonce);
        fields.put("code_challenge_method", "S256");
        fields.put("code_challenge", encode(MessageDigest.getInstance("SHA-256")
            .digest(verifier.getBytes(StandardCharsets.US_ASCII))));
        return ISSUER + "/api/accounts/authorize?" + form(fields);
    }

    static Map<String, String> query(String target) throws Exception {
        if (!target.startsWith("/auth/callback?") || target.length() > 8192 || target.contains("#"))
            throw new IllegalArgumentException("callback path");
        Map<String, String> result = new LinkedHashMap<>();
        for (String part : target.substring(target.indexOf('?') + 1).split("&", -1)) {
            String[] pair = part.split("=", 2);
            if (pair.length != 2) throw new IllegalArgumentException("query");
            String key = URLDecoder.decode(pair[0], "UTF-8");
            String value = URLDecoder.decode(pair[1], "UTF-8");
            if (result.put(key, value) != null) throw new IllegalArgumentException("duplicate query");
            if (value.matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw new IllegalArgumentException("query control");
        }
        return result;
    }

    static String callbackClient(Map<String, String> query, String state, String selected) {
        if (!equal(state, query.get("state"))) throw new IllegalArgumentException("state");
        if (query.containsKey("error")) throw new IllegalArgumentException("authorization denied");
        if (!query.containsKey("code") || query.get("code").isEmpty()) throw new IllegalArgumentException("code");
        String client = query.get("client_id");
        if (!DYNAMIC.equals(selected)) {
            if (client != null && !selected.equals(client)) throw new IllegalArgumentException("client mismatch");
            return selected;
        }
        if (client == null || !client.matches("oaiapp_[A-Za-z0-9_-]{1,200}"))
            throw new IllegalArgumentException("issued client missing");
        return client;
    }

    static String identity(String jwt, JSONObject jwks, String client, String nonce, long now) throws Exception {
        if (jwt.length() > 65536) throw new IllegalArgumentException("token size");
        String[] parts = jwt.split("\\.", -1);
        if (parts.length != 3) throw new IllegalArgumentException("token format");
        JSONObject header = new JSONObject(new String(decode(parts[0]), StandardCharsets.UTF_8));
        if (!"RS256".equals(header.optString("alg")) || header.has("crit"))
            throw new IllegalArgumentException("algorithm");
        String kid = header.getString("kid");
        JSONArray keys = jwks.getJSONArray("keys");
        JSONObject selected = null;
        for (int i = 0; i < keys.length(); i++) {
            JSONObject key = keys.getJSONObject(i);
            if (kid.equals(key.optString("kid")) && "RSA".equals(key.optString("kty"))
                && "sig".equals(key.optString("use", "sig"))
                && "RS256".equals(key.optString("alg", "RS256"))) {
                if (selected != null) throw new IllegalArgumentException("ambiguous key");
                selected = key;
            }
        }
        if (selected == null) throw new IllegalArgumentException("key missing");
        BigInteger modulus = new BigInteger(1, decode(selected.getString("n")));
        if (modulus.bitLength() < 2048) throw new IllegalArgumentException("weak key");
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(
            modulus, new BigInteger(1, decode(selected.getString("e"))))));
        signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
        if (!signature.verify(decode(parts[2]))) throw new IllegalArgumentException("signature");
        JSONObject claims = new JSONObject(new String(decode(parts[1]), StandardCharsets.UTF_8));
        Object audience = claims.get("aud");
        boolean audOk = client.equals(audience);
        if (audience instanceof JSONArray) {
            JSONArray all = (JSONArray) audience;
            audOk = false;
            for (int i = 0; i < all.length(); i++) if (client.equals(all.get(i))) audOk = true;
            if (all.length() > 1 && !client.equals(claims.optString("azp"))) audOk = false;
        }
        if (!ISSUER.equals(claims.getString("iss")) || !audOk
            || claims.getLong("exp") <= now || claims.getLong("iat") > now + 60
            || (claims.has("nbf") && claims.getLong("nbf") > now)
            || !equal(nonce, claims.getString("nonce"))) throw new IllegalArgumentException("claims");
        String subject = claims.getString("sub");
        if (subject.isEmpty() || subject.length() > 512) throw new IllegalArgumentException("subject");
        return subject;
    }
}
