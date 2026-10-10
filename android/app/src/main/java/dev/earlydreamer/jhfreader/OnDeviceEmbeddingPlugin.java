package dev.earlydreamer.jhfreader;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.ai.edge.litertlm.ActivationDataType;
import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.EmbeddingEngine;
import com.google.ai.edge.litertlm.EmbeddingEngineConfig;
import com.google.ai.edge.litertlm.EmbeddingOptions;
import com.google.ai.edge.litertlm.EmbeddingResponse;
import com.google.ai.edge.litertlm.InputData;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 기기 임베딩(EmbeddingGemma 2, LiteRT-LM). 모델 내려받기·검증·로드·임베딩을 맡는다.
 * 무거운 일은 모두 단일 백그라운드 스레드에서 한다. 메인 스레드는 플래그만 읽고 쓰며,
 * 받는 중의 status는 파일을 읽지 않는다.
 */
@CapacitorPlugin(name = "OnDeviceEmbedding")
public final class OnDeviceEmbeddingPlugin extends Plugin {
    static final String MODEL_URL = "https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm/resolve/9be6e8b90982095dc05c2bd162e4b954ee4dbac7/embeddinggemma-2-text-270m.litertlm";
    static final long MODEL_BYTES = 164_626_432L;
    static final String MODEL_SHA256 = "2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb";

    private static final String MODEL_DIRECTORY = "narou-reader-models";
    private static final String MODEL_FILE = "embeddinggemma-2-text-270m.litertlm";
    private static final int EMBEDDING_SIZE = 256;
    private static final int MAX_TEXTS = 128;
    private static final int MAX_TEXT_LENGTH = 2000;
    private static final long PROGRESS_INTERVAL_NANOS = 500_000_000L;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloadBusy = new AtomicBoolean(false);
    private volatile boolean cancelRequested;
    private volatile HttpURLConnection downloadConnection;
    // 생성·사용·해제는 모두 executor 스레드에서 한다. 메인 스레드는 null 여부만 읽는다.
    private volatile EmbeddingEngine engine;

    @PluginMethod
    public void status(PluginCall call) {
        if (downloadBusy.get()) {
            // 받는 중에는 executor가 막혀 있으므로 파일을 읽지 않고 바로 답한다.
            call.resolve(statusObject(false, 0, engine != null, true));
            return;
        }
        executor.execute(() -> {
            boolean installed = isInstalled();
            call.resolve(statusObject(installed, installed ? MODEL_BYTES : 0, engine != null, false));
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!downloadBusy.compareAndSet(false, true)) {
            fail(call, "busy");
            return;
        }
        cancelRequested = false;
        executor.execute(() -> {
            String failure;
            try {
                failure = runDownload();
            } finally {
                downloadBusy.set(false);
            }
            if (failure == null) call.resolve(); else fail(call, failure);
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        stopDownload();
        call.resolve();
    }

    @PluginMethod
    public void unload(PluginCall call) {
        executor.execute(() -> {
            closeEngine();
            call.resolve();
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        stopDownload();
        executor.execute(() -> {
            closeEngine();
            File part = partFile();
            if (part.exists()) part.delete();
            File model = modelFile();
            if (model.exists() && !model.delete()) {
                fail(call, "io");
                return;
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void embed(PluginCall call) {
        JSArray array = call.getArray("texts");
        if (array == null || array.length() < 1 || array.length() > MAX_TEXTS) {
            fail(call, "invalid");
            return;
        }
        List<String> texts = new ArrayList<>(array.length());
        for (int i = 0; i < array.length(); i++) {
            Object item = array.opt(i);
            if (!(item instanceof String) || ((String) item).length() > MAX_TEXT_LENGTH) {
                fail(call, "invalid");
                return;
            }
            texts.add((String) item);
        }
        executor.execute(() -> runEmbed(call, texts));
    }

    @Override
    protected void handleOnPause() {
        // 백그라운드에서는 모델 메모리를 돌려준다. 파일은 남긴다.
        executor.execute(this::closeEngine);
    }

    @Override
    protected void handleOnDestroy() {
        stopDownload();
        executor.shutdownNow();
    }

    /** 다운로드 한 번. 성공이면 null, 실패면 reject 코드를 돌려준다. executor 스레드에서만 부른다. */
    private String runDownload() {
        if (isInstalled()) return null;
        File part = partFile();
        File directory = part.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) return "io";
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            return "io";
        }
        OutputStream output;
        try {
            output = new FileOutputStream(part);
        } catch (IOException error) {
            return "io";
        }
        HttpURLConnection connection = null;
        boolean finished = false;
        long received = 0;
        long lastNotice = 0;
        try {
            connection = (HttpURLConnection) new URL(MODEL_URL).openConnection();
            downloadConnection = connection;
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (cancelRequested) return "cancelled";
            int status = connection.getResponseCode();
            // 리다이렉트를 따라간 최종 주소만 본다. HF는 CDN으로 넘기므로 호스트는 HF 계열만 허용한다.
            URL resolved = connection.getURL();
            if (cancelRequested) return "cancelled";
            if (status != HttpURLConnection.HTTP_OK || !"https".equals(resolved.getProtocol()) || !isModelHost(resolved.getHost())) {
                return "network";
            }
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[65536];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (cancelRequested) return "cancelled";
                    if (read > MODEL_BYTES - received) return "verify";
                    try {
                        output.write(buffer, 0, read);
                    } catch (IOException error) {
                        return "io";
                    }
                    digest.update(buffer, 0, read);
                    received += read;
                    long now = System.nanoTime();
                    if (now - lastNotice >= PROGRESS_INTERVAL_NANOS) {
                        lastNotice = now;
                        notifyDownloadProgress(received);
                    }
                }
            }
            try {
                output.close();
            } catch (IOException error) {
                return "io";
            }
            if (cancelRequested) return "cancelled";
            if (received != MODEL_BYTES || !MODEL_SHA256.equals(hex(digest.digest()))) return "verify";
            File model = modelFile();
            if (model.exists() && !model.delete()) return "io";
            if (!part.renameTo(model)) return "io";
            finished = true;
            return null;
        } catch (IOException error) {
            return cancelRequested ? "cancelled" : "network";
        } catch (RuntimeException error) {
            return "io";
        } finally {
            downloadConnection = null;
            if (connection != null) connection.disconnect();
            try {
                output.close();
            } catch (IOException ignored) {
                // 이미 닫혔거나 실패가 확정된 뒤다. 아래에서 .part를 지운다.
            }
            if (!finished && part.exists()) part.delete();
        }
    }

    /** 임베딩 한 번. 엔진이 없으면 만들고, 실패하면 엔진을 닫아 다음 호출에서 다시 만든다. */
    private void runEmbed(PluginCall call, List<String> texts) {
        if (!isInstalled()) {
            fail(call, "not_installed");
            return;
        }
        JSObject result;
        try {
            if (engine == null) startEngine();
            List<List<InputData>> batch = new ArrayList<>(texts.size());
            for (String text : texts) {
                batch.add(Collections.<InputData>singletonList(new InputData.Text(text)));
            }
            long started = System.nanoTime();
            List<EmbeddingResponse> responses = engine.computeEmbeddingBatch(
                batch,
                new EmbeddingOptions(true, null, EMBEDDING_SIZE)
            );
            long ms = (System.nanoTime() - started) / 1_000_000L;
            if (responses.size() != texts.size()) throw new IllegalStateException("embedding count");
            JSArray vectors = new JSArray();
            for (EmbeddingResponse response : responses) {
                JSArray row = new JSArray();
                for (float value : response.getEmbedding()) row.put((double) value);
                vectors.put(row);
            }
            result = new JSObject();
            result.put("vectors", vectors);
            result.put("ms", ms);
        } catch (Exception | LinkageError error) {
            closeEngine();
            String message = error.getMessage() == null ? "engine" : error.getMessage();
            call.reject(message, "engine");
            return;
        }
        call.resolve(result);
    }

    private void startEngine() {
        File cache = new File(getContext().getCacheDir(), "litertlm");
        if (!cache.isDirectory() && !cache.mkdirs()) throw new IllegalStateException("cache directory");
        EmbeddingEngineConfig config = new EmbeddingEngineConfig(
            modelFile().getAbsolutePath(),
            new Backend.CPU(null, null),
            null,
            null,
            cache.getAbsolutePath(),
            null,
            null,
            null,
            ActivationDataType.FLOAT32
        );
        // 실패 시 closeEngine이 닫을 수 있도록 먼저 연결한다.
        EmbeddingEngine created = new EmbeddingEngine(config);
        engine = created;
        created.initialize();
    }

    private void closeEngine() {
        EmbeddingEngine current = engine;
        engine = null;
        if (current == null) return;
        try {
            current.close();
        } catch (Exception ignored) {
            // 해제 실패는 복구할 방법이 없다. 참조는 이미 비웠다.
        }
    }

    /** 받는 중이면 연결을 끊고 취소를 표시한다. 다운로드 스레드가 .part를 지우고 끝낸다. */
    private void stopDownload() {
        cancelRequested = true;
        HttpURLConnection connection = downloadConnection;
        if (connection != null) connection.disconnect();
    }

    private void notifyDownloadProgress(long received) {
        JSObject data = new JSObject();
        data.put("received", received);
        data.put("total", MODEL_BYTES);
        notifyListeners("downloadProgress", data);
    }

    private boolean isInstalled() {
        File model = modelFile();
        return model.isFile() && model.length() == MODEL_BYTES;
    }

    private File modelDirectory() {
        return new File(getContext().getFilesDir(), MODEL_DIRECTORY);
    }

    private File modelFile() {
        return new File(modelDirectory(), MODEL_FILE);
    }

    private File partFile() {
        return new File(modelDirectory(), MODEL_FILE + ".part");
    }

    /** HF 본가와 CDN 호스트(*.hf.co, *.huggingface.co)만 허용한다. */
    static boolean isModelHost(String host) {
        if (host == null) return false;
        String lower = host.toLowerCase(Locale.ROOT);
        return "huggingface.co".equals(lower) || lower.endsWith(".huggingface.co") || lower.endsWith(".hf.co");
    }

    private static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) text.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return text.toString();
    }

    private static JSObject statusObject(boolean installed, long bytes, boolean loaded, boolean downloading) {
        JSObject result = new JSObject();
        result.put("installed", installed);
        result.put("bytes", bytes);
        result.put("loaded", loaded);
        result.put("downloading", downloading);
        return result;
    }

    private static void fail(PluginCall call, String code) {
        call.reject(code, code);
    }
}
