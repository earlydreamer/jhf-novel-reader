package dev.earlydreamer.jhfreader;

import android.system.ErrnoException;
import android.system.Os;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;

/** 복원 한 건의 undo 기록. 완료 표식 전에는 파일과 설정을 함께 이전 값으로 돌린다. */
final class BackupRestoreTransaction {
    static final String STATE = "narou-reader.restore-state";
    static final String TEMP = STATE + ".tmp";
    private static final int MAGIC = 0x4a484631;
    private static final int MAX_SETTINGS = 1024 * 1024;
    private enum Phase { UNDO, COMMITTED, ROLLED_BACK }

    /** 실제 파일 작업 직후 중단을 주입하는 JVM 시험 경계. 제품 경로는 아무 일도 하지 않는다. */
    interface Checkpoint { void after(String step) throws IOException; }
    /** 상태 마커의 원자 교체 경계. 제품은 Android Os.rename, JVM 테스트는 호스트 NIO를 쓴다. */
    interface StateMarkerReplacer { void replace(File source, File destination) throws IOException; }
    private final File directory;
    private final BackupArchive.SettingsStore settings;
    private final Checkpoint checkpoint;
    private final StateMarkerReplacer stateMarkerReplacer;

    BackupRestoreTransaction(File directory, BackupArchive.SettingsStore settings) {
        this(directory, settings, step -> {}, BackupRestoreTransaction::renameOnAndroid);
    }

    BackupRestoreTransaction(File directory, BackupArchive.SettingsStore settings, Checkpoint checkpoint) {
        this(directory, settings, checkpoint, BackupRestoreTransaction::renameOnAndroid);
    }

    BackupRestoreTransaction(File directory, BackupArchive.SettingsStore settings, Checkpoint checkpoint,
                            StateMarkerReplacer stateMarkerReplacer) {
        this.directory = directory;
        this.settings = settings;
        this.checkpoint = checkpoint;
        this.stateMarkerReplacer = stateMarkerReplacer;
    }

    private File file(String name) { return new File(directory, name); }
    private File staged() { return new File(file(BackupArchive.RESTORE_DIR), BackupArchive.DATA_DIR); }

    static boolean pending(File directory) {
        return new File(directory, STATE).exists() || new File(directory, TEMP).exists();
    }

    void commit(String previousSettings, String nextSettings) throws IOException {
        File live = file(BackupArchive.DATA_DIR), old = file(BackupArchive.OLD_DIR);
        if (pending(directory) || old.exists()) throw new IOException("restore recovery pending");
        requireDirectory(staged());
        if (live.exists()) requireDirectory(live);
        Record undo = new Record(Phase.UNDO, live.exists(), previousSettings);
        try {
            write(undo);
            if (undo.hadLive) move(live, old, "old-moved");
            move(staged(), live, "new-placed");
            save(nextSettings, "new-settings-saved");
            write(undo.with(Phase.COMMITTED));
        } catch (IOException | RuntimeException failure) {
            try {
                // 표식 rename이 성공한 뒤 오류가 나도 기록된 단계만 따른다.
                recover();
            } catch (IOException | RuntimeException recoveryFailure) {
                failure.addSuppressed(recoveryFailure);
            }
            throw new IOException("restore transaction failed", failure);
        }
        recover();
    }

    void recover() throws IOException {
        File state = file(STATE), old = file(BackupArchive.OLD_DIR), live = file(BackupArchive.DATA_DIR);
        if (!state.exists()) {
            // 구버전의 .old에는 이전 설정 기록이 없다. 어느 쪽도 추측해서 지우지 않는다.
            if (old.exists()) throw new IOException("unmarked previous restore requires recovery");
            remove(file(TEMP), "temp-cleaned");
            remove(file(BackupArchive.RESTORE_DIR), "staging-cleaned");
            return;
        }
        Record record = read();
        if (record.phase == Phase.UNDO) {
            validateUndo(record);
            // commit(false)는 이미 메모리를 바꿨을 수 있어 반드시 이전 값을 다시 commit한다.
            save(record.settings, "old-settings-saved");
            if (old.exists()) {
                if (live.exists()) move(live, staged(), "new-returned");
                move(old, live, "old-restored");
            } else if (!record.hadLive && live.exists()) {
                move(live, staged(), "new-returned");
            }
            // 이 단계까지 새 트리를 staging에 보존한다. 또 중단돼도 UNDO 배치가 유지된다.
            record = record.with(Phase.ROLLED_BACK);
            write(record);
        }
        if (record.phase == Phase.COMMITTED) {
            requireDirectory(live);
            if (staged().exists()) throw new IOException("unexpected committed staging");
            remove(old, "old-cleaned");
        } else {
            if (old.exists() || record.hadLive != live.exists()) throw new IOException("incomplete rollback");
            if (record.hadLive) requireDirectory(live);
        }
        remove(file(BackupArchive.RESTORE_DIR), "staging-cleaned");
        remove(file(TEMP), "temp-cleaned");
        // 기록은 마지막에 지운다. 정리 중 중단되어도 완료/롤백 완료를 뒤집지 않는다.
        remove(state, "state-cleaned");
    }

    private void validateUndo(Record record) throws IOException {
        File old = file(BackupArchive.OLD_DIR), live = file(BackupArchive.DATA_DIR), staged = staged();
        if (old.exists()) {
            requireDirectory(old);
            if (!record.hadLive || live.exists() == staged.exists()) throw new IOException("ambiguous restore layout");
        } else if (record.hadLive) {
            if (!live.exists() || !staged.exists()) throw new IOException("missing original data");
        } else if (live.exists() == staged.exists()) {
            throw new IOException("ambiguous empty original");
        }
        if (live.exists()) requireDirectory(live);
        if (staged.exists()) requireDirectory(staged);
    }

    private void save(String value, String step) throws IOException {
        if (!settings.commit(value)) throw new IOException("cannot persist restore settings");
        checkpoint.after(step);
    }

    private void move(File from, File to, String step) throws IOException {
        if (to.exists() || !from.renameTo(to)) throw new IOException("cannot move restore data");
        checkpoint.after(step);
    }

    private void remove(File target, String step) throws IOException {
        BackupArchive.deleteRecursively(target);
        if (target.exists()) throw new IOException("cannot clean restore transaction");
        checkpoint.after(step);
    }

    private static void requireDirectory(File directory) throws IOException {
        if (!directory.isDirectory() || !directory.getAbsoluteFile().equals(directory.getCanonicalFile())) {
            throw new IOException("invalid restore directory");
        }
    }

    private void write(Record record) throws IOException {
        byte[] value = record.settings == null ? null : record.settings.getBytes(StandardCharsets.UTF_8);
        if (value != null && value.length > MAX_SETTINGS) throw new IOException("previous settings too large");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(bytes)) {
            out.writeInt(MAGIC);
            out.writeByte(record.phase.ordinal());
            out.writeBoolean(record.hadLive);
            out.writeInt(value == null ? -1 : value.length);
            if (value != null) out.write(value);
            out.flush();
        }
        byte[] payload = bytes.toByteArray();
        try (FileOutputStream file = new FileOutputStream(file(TEMP))) {
            file.write(payload);
            file.write(checksum(payload));
            file.getFD().sync();
        }
        checkpoint.after(record.phase + "-synced");
        stateMarkerReplacer.replace(file(TEMP), file(STATE));
        checkpoint.after(record.phase + "-recorded");
    }

    private static void renameOnAndroid(File source, File destination) throws IOException {
        try {
            Os.rename(source.getAbsolutePath(), destination.getAbsolutePath());
        } catch (ErrnoException failure) {
            throw new IOException("cannot persist restore state", failure);
        }
    }

    private Record read() throws IOException {
        File state = file(STATE);
        if (!state.isFile() || !state.getAbsoluteFile().equals(state.getCanonicalFile())
            || state.length() > MAX_SETTINGS + 42L) throw new IOException("invalid restore state");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (FileInputStream in = new FileInputStream(state)) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) != -1) {
                if (bytes.size() + count > MAX_SETTINGS + 42) throw new IOException("restore state too large");
                bytes.write(buffer, 0, count);
            }
        }
        byte[] all = bytes.toByteArray();
        if (all.length < 42) throw new IOException("truncated restore state");
        byte[] payload = Arrays.copyOf(all, all.length - 32);
        if (!MessageDigest.isEqual(checksum(payload), Arrays.copyOfRange(all, payload.length, all.length))) {
            throw new IOException("corrupt restore state");
        }
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(payload))) {
            if (in.readInt() != MAGIC) throw new IOException("unknown restore state");
            int phase = in.readUnsignedByte(), hadLive = in.readUnsignedByte(), length = in.readInt();
            if (phase >= Phase.values().length || hadLive > 1 || length < -1 || length > MAX_SETTINGS) {
                throw new IOException("invalid restore state");
            }
            byte[] value = length < 0 ? null : new byte[length];
            if (value != null) in.readFully(value);
            if (in.read() != -1) throw new IOException("trailing restore state");
            return new Record(Phase.values()[phase], hadLive == 1,
                value == null ? null : new String(value, StandardCharsets.UTF_8));
        }
    }

    private static byte[] checksum(byte[] value) throws IOException {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IOException("checksum unavailable", unavailable);
        }
    }

    private static final class Record {
        final Phase phase;
        final boolean hadLive;
        final String settings;
        Record(Phase phase, boolean hadLive, String settings) {
            this.phase = phase;
            this.hadLive = hadLive;
            this.settings = settings;
        }
        Record with(Phase next) { return new Record(next, hadLive, settings); }
    }
}
