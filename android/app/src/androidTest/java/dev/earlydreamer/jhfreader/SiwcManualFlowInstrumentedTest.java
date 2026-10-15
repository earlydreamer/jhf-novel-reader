package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.Spinner;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.concurrent.atomic.AtomicReference;

/** 사용자 로그인 뒤에만 명시적으로 실행하는 실제 계정 검증. 기본 실행에서는 skip한다. */
@RunWith(AndroidJUnit4.class)
public class SiwcManualFlowInstrumentedTest {
    private final android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private SiwcProbeActivity activity;

    private static View find(View view, String text) {
        if (view instanceof Button && text.contentEquals(((Button) view).getText())) return view;
        if (view instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                View found = find(group.getChildAt(i), text);
                if (found != null) return found;
            }
        }
        return null;
    }
    private Button button(String text) {
        AtomicReference<Button> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> result.set((Button) find(activity.getWindow().getDecorView(), text)));
        assertNotNull("probe control unavailable", result.get());
        return result.get();
    }
    private void click(String text) {
        Button control = button(text);
        instrumentation.runOnMainSync(() -> {
            assertTrue("probe still busy", control.isEnabled());
            assertTrue(control.performClick());
        });
    }
    private void idle(long timeout) throws Exception {
        long end = android.os.SystemClock.elapsedRealtime() + timeout;
        Button control = button("보호 저장 연결 복원");
        while (android.os.SystemClock.elapsedRealtime() < end) {
            AtomicReference<Boolean> enabled = new AtomicReference<>(false);
            instrumentation.runOnMainSync(() -> enabled.set(control.isEnabled()));
            if (enabled.get()) return;
            Thread.sleep(100);
        }
        fail("probe operation timeout");
    }
    private JSONObject report(String name) throws Exception {
        Context context = instrumentation.getTargetContext();
        File file = new File(context.getNoBackupFilesDir(), "siwc-" + name + "-result.json");
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];
            for (int n; (n = input.read(buffer)) >= 0;) {
                if (bytes.size() + n > 8192) throw new IllegalArgumentException("safe report size");
                bytes.write(buffer, 0, n);
            }
            return new JSONObject(bytes.toString("UTF-8"));
        }
    }
    private void record(JSONObject safe) throws Exception {
        android.util.AtomicFile file = new android.util.AtomicFile(new File(
            instrumentation.getTargetContext().getNoBackupFilesDir(), "siwc-manual-result.json"));
        java.io.FileOutputStream output = file.startWrite();
        try {
            output.write(safe.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) { file.failWrite(output); throw error; }
    }
    private static Spinner spinner(View view) {
        if (view instanceof Spinner) return (Spinner) view;
        if (view instanceof ViewGroup) {
            for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
                Spinner found = spinner(((ViewGroup) view).getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
    }

    @Test public void explicitlyRequestedStoredSessionRefreshSyntheticInferenceAndDisconnect() throws Exception {
        assumeTrue("manual account flow disabled", "true".equals(
            InstrumentationRegistry.getArguments().getString("siwcManualFlow")));
        assertEquals("dev.earlydreamer.jhfreader.issue307", instrumentation.getTargetContext().getPackageName());
        assertTrue("complete user login first", report("probe").getBoolean("protectedSessionStored"));
        assertFalse("preserve earlier inference evidence before another manual flow", new File(
            instrumentation.getTargetContext().getNoBackupFilesDir(), "siwc-inference-result.json").exists());
        AtomicReference<SiwcProbeActivity> resumed = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            for (Activity candidate : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))
                if (candidate instanceof SiwcProbeActivity) resumed.set((SiwcProbeActivity) candidate);
        });
        activity = resumed.get();
        if (activity == null) activity = (SiwcProbeActivity) instrumentation.startActivitySync(new Intent(
            instrumentation.getTargetContext(), SiwcProbeActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        JSONObject safe = new JSONObject().put("restore", false).put("refresh", false).put("inferenceCompleted", false)
            .put("localCleared", false).put("revocationConfirmed", false).put("restoreRejectedAfterDisconnect", false);
        record(safe);
        try {
            click("보호 저장 연결 복원"); idle(10000);
            assertEquals("restore", report("session").getString("operation"));
            assertTrue(report("session").getBoolean("success"));
            safe.put("restore", true); record(safe);
            click("토큰 갱신 검증 1회"); idle(90000);
            assertEquals("refresh", report("session").getString("operation"));
            assertTrue(report("session").getBoolean("success"));
            safe.put("refresh", true); record(safe);
            click("계정 모델 목록 읽기"); idle(90000);
            assertEquals("models", report("session").getString("operation"));
            assertTrue(report("session").getBoolean("success"));
            safe.put("modelCount", report("session").getInt("modelCount")); record(safe);
            instrumentation.runOnMainSync(() -> {
                Spinner picker = spinner(activity.getWindow().getDecorView());
                assertNotNull(picker);
                assertTrue(picker.getCount() > 0);
                int selected = 0;
                for (int i = 0; i < picker.getCount(); i++)
                    if ("gpt-6.1-sol".equals(((SiwcHttp.Model) picker.getItemAtPosition(i)).slug)) selected = i;
                picker.setSelection(selected);
            });
            click("합성 문단 번역 1회 · 공유 한도 사용"); idle(155000);
            JSONObject inference = report("inference");
            assertTrue(inference.getBoolean("completed"));
            assertTrue(inference.getInt("textChars") > 0);
            safe.put("inferenceCompleted", true); record(safe);
        } finally {
            // 실패하더라도 두 번째 추론 요청은 만들지 않고 연결 해제만 시도한다.
            idle(45000);
            click("연결 해제 · 원격 철회와 로컬 삭제"); idle(60000);
            JSONObject disconnected = report("session");
            safe.put("localCleared", disconnected.optBoolean("localCleared"))
                .put("revocationConfirmed", disconnected.optBoolean("revocationConfirmed"));
            record(safe);
        }
        assertEquals("disconnect", report("session").getString("operation"));
        assertTrue(report("session").getBoolean("localCleared"));
        assertTrue(report("session").getBoolean("revocationConfirmed"));
        click("보호 저장 연결 복원"); idle(10000);
        assertFalse("session should not restore after disconnect", report("session").getBoolean("success"));
        safe.put("restoreRejectedAfterDisconnect", true); record(safe);
    }
}
