package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BackupRestoreTransactionTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    private static final class Death extends Error {}
    private static final class Settings implements BackupArchive.SettingsStore {
        String memory, disk;
        int failures;
        boolean throwing;
        Settings(String value) { memory = disk = value; }
        @Override public boolean commit(String value) {
            memory = value;
            if (failures-- > 0) {
                if (throwing) throw new IllegalStateException("synthetic preference failure");
                return false;
            }
            disk = value;
            return true;
        }
    }
    private File fixture(boolean hadLive) throws IOException {
        File root = temp.newFolder();
        if (hadLive) put(root, "narou-reader/body", "old");
        put(root, "narou-reader.restore/narou-reader/body", "new");
        return root;
    }
    private static void put(File root, String path, String value) throws IOException {
        File file = new File(root, path);
        file.getParentFile().mkdirs();
        Files.write(file.toPath(), value.getBytes(StandardCharsets.UTF_8));
    }
    private static String read(File root, String path) throws IOException {
        return new String(Files.readAllBytes(new File(root, path).toPath()), StandardCharsets.UTF_8);
    }
    private static void assertPair(File root, Settings settings, boolean hadLive, boolean committed, String oldSettings) throws IOException {
        assertEquals(committed ? "new settings" : oldSettings, settings.memory);
        assertEquals(settings.memory, settings.disk);
        if (committed || hadLive) assertEquals(committed ? "new" : "old", read(root, "narou-reader/body"));
        else assertFalse(new File(root, "narou-reader").exists());
        assertFalse(new File(root, "narou-reader.old").exists());
        assertFalse(new File(root, "narou-reader.restore").exists());
        assertFalse(BackupRestoreTransaction.pending(root));
    }

    @Test public void restartsAtEveryCommitBoundaryKeepAnEntireOldOrNewPair() throws Exception {
        String[] boundaries = {"UNDO-synced", "UNDO-recorded", "old-moved", "new-placed",
            "new-settings-saved", "COMMITTED-synced", "COMMITTED-recorded", "old-cleaned",
            "staging-cleaned", "temp-cleaned", "state-cleaned"};
        for (boolean hadLive : new boolean[] {true, false}) for (String previous : new String[] {"old settings", null}) {
            for (String boundary : boundaries) {
                if (!hadLive && boundary.equals("old-moved")) continue;
                File root = fixture(hadLive);
                Settings settings = new Settings(previous);
                BackupRestoreTransaction transaction = new BackupRestoreTransaction(root, settings, step -> {
                    if (boundary.equals(step)) throw new Death();
                });
                assertThrows(boundary, Death.class, () -> transaction.commit(previous, "new settings"));
                Settings restarted = new Settings(settings.disk);
                new BackupRestoreTransaction(root, restarted).recover();
                new BackupRestoreTransaction(root, restarted).recover();
                boolean committed = java.util.Arrays.asList("COMMITTED-recorded", "old-cleaned",
                    "staging-cleaned", "temp-cleaned", "state-cleaned").contains(boundary);
                assertPair(root, restarted, hadLive, committed, previous);
            }
        }
    }

    @Test public void rollbackCanItselfBeInterruptedAtEveryBoundaryAndRetried() throws Exception {
        for (String boundary : new String[] {"old-settings-saved", "new-returned", "old-restored",
            "ROLLED_BACK-synced", "ROLLED_BACK-recorded", "staging-cleaned", "temp-cleaned", "state-cleaned"}) {
            for (boolean hadLive : new boolean[] {true, false}) {
                if (!hadLive && boundary.equals("old-restored")) continue;
                File root = fixture(hadLive);
                Settings settings = new Settings("old settings");
                assertThrows(Death.class, () -> new BackupRestoreTransaction(root, settings, step -> {
                    if (step.equals("new-settings-saved")) throw new Death();
                }).commit("old settings", "new settings"));
                assertThrows(boundary, Death.class, () -> new BackupRestoreTransaction(root, settings, step -> {
                    if (step.equals(boundary)) throw new Death();
                }).recover());
                Settings restarted = new Settings(settings.disk);
                new BackupRestoreTransaction(root, restarted).recover();
                new BackupRestoreTransaction(root, restarted).recover();
                assertPair(root, restarted, hadLive, false, "old settings");
            }
        }
    }

    @Test public void falseAndExceptionAfterMemoryMutationExplicitlyRestoreOldSettingsIncludingNull() throws Exception {
        for (boolean throwing : new boolean[] {false, true}) for (String previous : new String[] {"old settings", null}) {
            File root = fixture(true);
            Settings settings = new Settings(previous);
            settings.failures = 1;
            settings.throwing = throwing;
            assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings).commit(previous, "new settings"));
            assertPair(root, settings, true, false, previous);
        }
    }

    @Test public void failedRollbackSettingsCommitRetainsUndoAndOriginalTreeUntilRetry() throws Exception {
        File root = fixture(true);
        Settings settings = new Settings("old settings");
        settings.failures = 2;
        assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings).commit("old settings", "new settings"));
        assertEquals("old", read(root, "narou-reader.old/body"));
        assertEquals("new", read(root, "narou-reader/body"));
        assertTrue(BackupRestoreTransaction.pending(root));
        new BackupRestoreTransaction(root, settings).recover();
        assertPair(root, settings, true, false, "old settings");
    }

    @Test public void corruptStateCannotBeMistakenForACommittedTransaction() throws Exception {
        File root = fixture(true);
        Settings settings = new Settings("old settings");
        assertThrows(Death.class, () -> new BackupRestoreTransaction(root, settings, step -> {
            if (step.equals("new-placed")) throw new Death();
        }).commit("old settings", "new settings"));
        File state = new File(root, BackupRestoreTransaction.STATE);
        byte[] bytes = Files.readAllBytes(state.toPath());
        bytes[4] = 1; // 손상으로 UNDO가 COMMITTED처럼 보이는 경우.
        Files.write(state.toPath(), bytes);
        assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings).recover());
        assertEquals("old", read(root, "narou-reader.old/body"));
        assertEquals("new", read(root, "narou-reader/body"));
        assertEquals("old settings", settings.memory);
    }

    @Test public void unmarkedOldDirectoryIsNeverDiscardedEvenWithLivePresent() throws Exception {
        File root = fixture(true);
        put(root, "narou-reader.old/body", "unmarked original");
        Settings settings = new Settings("unknown old settings");
        assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings).recover());
        assertEquals("unmarked original", read(root, "narou-reader.old/body"));
        assertEquals("old", read(root, "narou-reader/body"));
    }

    @Test public void ordinaryExceptionsAtRenameAndMarkerBoundariesResolveTheRecordedPair() throws Exception {
        for (String boundary : new String[] {"UNDO-recorded", "old-moved", "new-placed",
            "new-settings-saved", "COMMITTED-synced", "COMMITTED-recorded"}) {
            File root = fixture(true);
            Settings settings = new Settings("old settings");
            assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings, step -> {
                if (step.equals(boundary)) throw new IOException("synthetic operation failure");
            }).commit("old settings", "new settings"));
            new BackupRestoreTransaction(root, settings).recover();
            assertPair(root, settings, true, boundary.equals("COMMITTED-recorded"), "old settings");
        }
    }

    @Test public void terminalCleanupFailureKeepsItsDecisionAcrossRepeatedRecovery() throws Exception {
        for (boolean committed : new boolean[] {true, false}) {
            File root = fixture(true);
            Settings settings = new Settings("old settings");
            if (!committed) settings.failures = 1;
            File blocked = new File(root, committed ? "narou-reader.old" : "narou-reader.restore/narou-reader");
            try {
                assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings, step -> {
                    if (step.equals(committed ? "COMMITTED-recorded" : "ROLLED_BACK-recorded")) {
                        assertTrue(blocked.setWritable(false, false));
                    }
                }).commit("old settings", "new settings"));
                assertTrue(BackupRestoreTransaction.pending(root));
                assertEquals(committed ? "new" : "old", read(root, "narou-reader/body"));
                assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings).recover());
            } finally {
                assertTrue(blocked.setWritable(true, false));
            }
            new BackupRestoreTransaction(root, settings).recover();
            new BackupRestoreTransaction(root, settings).recover();
            assertPair(root, settings, true, committed, "old settings");
        }
    }

    @Test public void failureDeletingTheFinalMarkerNeverRollsBackCommittedData() throws Exception {
        File root = fixture(true);
        Settings settings = new Settings("old settings");
        try {
            assertThrows(IOException.class, () -> new BackupRestoreTransaction(root, settings, step -> {
                if (step.equals("staging-cleaned")) assertTrue(root.setWritable(false, false));
            }).commit("old settings", "new settings"));
            assertTrue(BackupRestoreTransaction.pending(root));
            assertEquals("new", read(root, "narou-reader/body"));
        } finally {
            assertTrue(root.setWritable(true, false));
        }
        new BackupRestoreTransaction(root, settings).recover();
        assertPair(root, settings, true, true, "old settings");
    }
}
