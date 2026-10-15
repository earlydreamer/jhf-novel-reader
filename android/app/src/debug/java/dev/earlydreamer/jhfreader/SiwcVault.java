package dev.earlydreamer.jhfreader;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** debug PoC만 사용하는 native 저장. JS 브리지·일반 설정에 토큰을 전달하지 않는다. */
final class SiwcVault {
    final File file;
    private final String alias;
    private final byte[] aad;

    SiwcVault(Context context, String name) {
        if (!name.matches("[a-z0-9-]{1,40}")) throw new IllegalArgumentException("vault name");
        file = new File(context.getNoBackupFilesDir(), "siwc-" + name + ".bin");
        alias = "jhf.siwc.debug." + name;
        aad = (context.getPackageName() + "/" + alias + "/v1").getBytes(StandardCharsets.UTF_8);
    }

    private SecretKey key(boolean create) throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        if (!keys.containsAlias(alias)) {
            if (!create) throw new IllegalStateException("key unavailable");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) keys.getKey(alias, null);
    }

    synchronized void save(JSONObject credentials) throws Exception {
        byte[] plain = credentials.toString().getBytes(StandardCharsets.UTF_8);
        if (plain.length > 131072) throw new IllegalArgumentException("credential size");
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            cipher.updateAAD(aad);
            byte[] iv = cipher.getIV();
            if (iv.length != 12) throw new IllegalStateException("IV length");
            byte[] encrypted = cipher.doFinal(plain);
            AtomicFile target = new AtomicFile(file);
            FileOutputStream output = target.startWrite();
            try {
                output.write(1);
                output.write(iv);
                output.write(encrypted);
                target.finishWrite(output);
            } catch (Exception error) { target.failWrite(output); throw error; }
        } finally { Arrays.fill(plain, (byte) 0); }
    }

    synchronized JSONObject load() throws Exception {
        if (!file.exists() && !new File(file.getPath() + ".bak").exists()) return null;
        byte[] stored;
        try (FileInputStream input = new AtomicFile(file).openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            for (int count; (count = input.read(buffer)) >= 0;) {
                if (output.size() + count > 131200) throw new IllegalArgumentException("vault size");
                output.write(buffer, 0, count);
            }
            stored = output.toByteArray();
        }
        if (stored.length < 30 || stored[0] != 1) throw new IllegalArgumentException("vault format");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, Arrays.copyOfRange(stored, 1, 13)));
        cipher.updateAAD(aad);
        byte[] plain = cipher.doFinal(Arrays.copyOfRange(stored, 13, stored.length));
        try { return new JSONObject(new String(plain, StandardCharsets.UTF_8)); }
        finally { Arrays.fill(plain, (byte) 0); }
    }

    synchronized void clear() throws Exception {
        new AtomicFile(file).delete();
        if (file.exists() || new File(file.getPath() + ".bak").exists() || new File(file.getPath() + ".new").exists())
            throw new IllegalStateException("credential removal failed");
    }

    // 합성 계측 검사에서만 쓰며 실제 세션 키를 삭제하지 않는다.
    synchronized void destroyTestKey() throws Exception {
        if (!alias.contains("test-")) throw new IllegalStateException("not a test key");
        clear();
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        keys.deleteEntry(alias);
    }
}
