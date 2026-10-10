package dev.earlydreamer.jhfreader;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 백업 파일 만들기·백업에서 복원하기(#269). 서재·번역·용어집·읽기 위치(files/narou-reader)와
 * 읽기 설정을 zip 하나로 묶는다. API 키(보안 저장소)와 판정 모델은 넣지 않는다.
 * 무거운 일은 단일 백그라운드 스레드에서 하고, 파일 선택 화면은 시스템 문서 선택기를 쓴다.
 */
@CapacitorPlugin(name = "Backup")
public final class BackupPlugin extends Plugin {
    private static final String PREFERENCES = "CapacitorStorage";
    private static final String SETTINGS_KEY = "narou-reader.reading-settings.v2";
    private static final String CACHE_ZIP = "jhf-backup-export.zip";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    // 내보내기·복원은 한 번에 하나만 한다. 준비된 복원은 commit/abort가 끝날 때까지 잡는다.
    private final AtomicBoolean busy = new AtomicBoolean(false);
    // 내보내기에서 파일 선택 화면이 돌아올 때까지 캐시 zip의 정보를 들고 있는다.
    private volatile File pendingZip;
    private volatile int pendingFiles;
    // 아래 세션은 단일 executor에서만 읽고 바꾼다. URI는 준비 뒤 보관하거나 다시 열지 않는다.
    private BackupArchive.PreparedRestore pendingRestore;

    @Override
    public void load() {
        File filesDir = getContext().getFilesDir();
        // 데이터 폴더가 없는데 .old가 남았다면 교체 도중 끊긴 것이다. 웹이 읽기 전에 이름만 되돌린다.
        BackupArchive.recoverInterruptedSwap(filesDir);
        executor.execute(() -> {
            BackupArchive.deleteLeftovers(filesDir);
            new File(getContext().getCacheDir(), CACHE_ZIP).delete();
        });
    }

    @PluginMethod
    public void export(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("backup_failed");
            return;
        }
        executor.execute(() -> {
            File zip = new File(getContext().getCacheDir(), CACHE_ZIP);
            try {
                File dataRoot = new File(getContext().getFilesDir(), BackupArchive.DATA_DIR);
                pendingFiles = BackupArchive.write(dataRoot, readSettings(), this::manifest, zip, BackupArchive.Limits.DEFAULT);
                pendingZip = zip;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/zip")
                    .putExtra(Intent.EXTRA_TITLE, "jhf-backup-" + stamp("yyyyMMdd-HHmm", null) + ".zip");
                startActivityForResult(call, intent, "exportResult");
            } catch (Exception failure) {
                finishExport(zip);
                call.reject("backup_failed");
            }
        });
    }

    @ActivityCallback
    private void exportResult(PluginCall call, ActivityResult result) {
        File zip = pendingZip;
        if (call == null || zip == null) {
            finishExport(zip);
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            finishExport(zip);
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            finishExport(zip);
            call.reject("backup_failed");
            return;
        }
        int files = pendingFiles;
        executor.execute(() -> {
            try {
                long bytes = copyTo(zip, uri);
                JSObject response = new JSObject();
                response.put("saved", true);
                response.put("files", files);
                response.put("bytes", bytes);
                finishExport(zip);
                call.resolve(response);
            } catch (Exception failure) {
                finishExport(zip);
                call.reject("backup_failed");
            }
        });
    }

    @PluginMethod
    public void prepareRestore(PluginCall call) {
        if (!busy.compareAndSet(false, true)) {
            call.reject("restore_failed");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"application/zip", "application/octet-stream"});
        try {
            startActivityForResult(call, intent, "prepareRestoreResult");
        } catch (RuntimeException unavailable) {
            busy.set(false);
            call.reject("restore_failed");
        }
    }

    @ActivityCallback
    private void prepareRestoreResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            busy.set(false);
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            busy.set(false);
            JSObject response = new JSObject();
            response.put("prepared", false);
            call.resolve(response);
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            busy.set(false);
            call.reject("restore_failed");
            return;
        }
        executor.execute(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) throw new IOException("cannot open backup");
                pendingRestore = BackupArchive.prepare(
                    getContext().getFilesDir(), in, new JsonValidator(), BackupArchive.Limits.DEFAULT
                );
            } catch (Exception failure) {
                // InputStream.close까지 실패한 경우에도 임시 트리만 정리한다.
                if (pendingRestore != null) {
                    try {
                        pendingRestore.abort(pendingRestore.token);
                        pendingRestore = null;
                    } catch (IOException cleanupFailure) {
                        failure.addSuppressed(cleanupFailure);
                    }
                }
                boolean stagingRemains = new File(getContext().getFilesDir(), BackupArchive.RESTORE_DIR).exists();
                boolean restartRequired = pendingRestore != null || stagingRemains;
                busy.set(restartRequired);
                // 토큰을 돌려주기 전 정리가 실패해도 웹이 기존 런타임을 재개하지 않게 알린다.
                call.reject(restartRequired ? "restore_restart_required"
                    : failure instanceof BackupArchive.InvalidBackupException ? "backup_invalid" : "restore_failed");
                return;
            }
            JSObject response = new JSObject();
            response.put("prepared", true);
            response.put("token", pendingRestore.token);
            response.put("files", pendingRestore.files);
            response.put("settings", pendingRestore.settings == null ? JSONObject.NULL : pendingRestore.settings);
            call.resolve(response);
        });
    }

    @PluginMethod
    public void listRestoreFiles(PluginCall call) {
        executor.execute(() -> {
            try {
                Integer offset = call.getInt("offset");
                if (offset == null) throw new IOException("invalid restore offset");
                BackupArchive.RestorePage page = restoreSession().list(call.getString("token"), offset);
                JSObject response = new JSObject();
                response.put("paths", new JSArray(page.paths));
                response.put("nextOffset", page.nextOffset == null ? JSONObject.NULL : page.nextOffset);
                call.resolve(response);
            } catch (Exception failure) {
                call.reject("restore_failed");
            }
        });
    }

    @PluginMethod
    public void readRestoreFile(PluginCall call) {
        executor.execute(() -> {
            try {
                String text = restoreSession().read(call.getString("token"), call.getString("path"));
                JSObject response = new JSObject();
                response.put("text", text == null ? JSONObject.NULL : text);
                call.resolve(response);
            } catch (Exception failure) {
                call.reject("restore_failed");
            }
        });
    }

    @PluginMethod
    public void commitRestore(PluginCall call) {
        executor.execute(() -> {
            try {
                int files = restoreSession().commit(call.getString("token"), this::saveSettings);
                pendingRestore = null;
                busy.set(false);
                JSObject response = new JSObject();
                response.put("restored", true);
                response.put("files", files);
                call.resolve(response);
            } catch (Exception failure) {
                // 교체·설정 저장 실패는 결과가 불확실하다. 전체 앱 재시작까지 세션과 잠금을 유지한다.
                call.reject("restore_failed");
            }
        });
    }

    @PluginMethod
    public void abortRestore(PluginCall call) {
        executor.execute(() -> {
            try {
                restoreSession().abort(call.getString("token"));
                pendingRestore = null;
                busy.set(false);
                call.resolve(new JSObject());
            } catch (Exception failure) {
                // 정리하지 못한 임시 트리를 다른 준비 작업이 덮어쓰지 못하게 한다.
                call.reject("restore_failed");
            }
        });
    }

    private BackupArchive.PreparedRestore restoreSession() throws IOException {
        if (pendingRestore == null) throw new IOException("no prepared restore session");
        return pendingRestore;
    }

    private void finishExport(File zip) {
        if (zip != null) zip.delete();
        pendingZip = null;
        busy.set(false);
    }

    private long copyTo(File zip, Uri uri) throws IOException {
        try (InputStream in = new FileInputStream(zip);
             OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
            if (out == null) throw new IOException("cannot open destination");
            byte[] buffer = new byte[64 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
                total += read;
            }
            out.flush();
            return total;
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private String readSettings() {
        return preferences().getString(SETTINGS_KEY, null);
    }

    private boolean saveSettings(String value) {
        SharedPreferences.Editor editor = preferences().edit();
        if (value == null) editor.remove(SETTINGS_KEY); else editor.putString(SETTINGS_KEY, value);
        return editor.commit();
    }

    private String manifest(int files) {
        try {
            String packageName = getContext().getPackageName();
            String versionName = getContext().getPackageManager().getPackageInfo(packageName, 0).versionName;
            return new JSONObject()
                .put("format", BackupArchive.FORMAT)
                .put("version", BackupArchive.VERSION)
                .put("createdAt", stamp("yyyy-MM-dd'T'HH:mm:ss'Z'", TimeZone.getTimeZone("UTC")))
                .put("appVersion", versionName == null ? "" : versionName)
                .put("packageName", packageName)
                .put("files", files)
                .toString();
        } catch (JSONException | PackageManager.NameNotFoundException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static String stamp(String pattern, TimeZone zone) {
        SimpleDateFormat format = new SimpleDateFormat(pattern, Locale.US);
        if (zone != null) format.setTimeZone(zone);
        return format.format(new Date());
    }

    /** manifest의 format·version과 settings의 JSON 형식을 org.json으로 검사한다. */
    private static final class JsonValidator implements BackupArchive.Validator {
        @Override
        public long manifestFiles(String text) throws BackupArchive.InvalidBackupException {
            try {
                JSONObject manifest = new JSONObject(text);
                Object version = manifest.opt("version");
                Object files = manifest.opt("files");
                boolean versionOk = (version instanceof Integer || version instanceof Long)
                    && ((Number) version).longValue() == BackupArchive.VERSION;
                boolean filesOk = (files instanceof Integer || files instanceof Long) && ((Number) files).longValue() >= 0;
                if (!BackupArchive.FORMAT.equals(manifest.opt("format")) || !versionOk || !filesOk) {
                    throw new BackupArchive.InvalidBackupException("bad manifest");
                }
                return ((Number) files).longValue();
            } catch (JSONException broken) {
                throw new BackupArchive.InvalidBackupException("bad manifest");
            }
        }

        @Override
        public void settings(String text) throws BackupArchive.InvalidBackupException {
            try {
                new JSONObject(text);
            } catch (JSONException broken) {
                throw new BackupArchive.InvalidBackupException("bad settings");
            }
        }
    }
}
