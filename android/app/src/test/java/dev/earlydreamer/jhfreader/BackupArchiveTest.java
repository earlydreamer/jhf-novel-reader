package dev.earlydreamer.jhfreader;

import static org.junit.Assert.*;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class BackupArchiveTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();

    private File filesDir;
    private final Recorder settings = new Recorder();

    /** org.json 없이 manifest·settings 검사를 흉내 낸다. 실제 검사는 BackupPlugin.JsonValidator. */
    private static final BackupArchive.Validator VALIDATOR = new BackupArchive.Validator() {
        @Override public long manifestFiles(String text) throws BackupArchive.InvalidBackupException {
            java.util.regex.Matcher m = Pattern.compile(
                "\\{\"format\":\"jhf-novel-reader-backup\",\"version\":1,\"files\":(\\d+)\\}"
            ).matcher(text);
            if (!m.matches()) throw new BackupArchive.InvalidBackupException("bad manifest");
            return Long.parseLong(m.group(1));
        }

        @Override public void settings(String text) throws BackupArchive.InvalidBackupException {
            if (!text.startsWith("{")) throw new BackupArchive.InvalidBackupException("bad settings");
        }
    };

    private static final class Recorder implements BackupArchive.SettingsStore {
        boolean fail;
        int calls;
        String last = "unset";

        @Override public boolean commit(String value) {
            calls++;
            last = value;
            return !fail;
        }
    }

    @Before public void setUp() throws IOException {
        filesDir = temp.newFolder("files");
        put("chapters", "keep-1.json", "old chapter");
        put("positions", "keep-2.json", "old position");
    }

    private void put(String folder, String name, String body) throws IOException {
        File dir = new File(filesDir, "narou-reader/" + folder);
        dir.mkdirs();
        Files.write(new File(dir, name).toPath(), body.getBytes(StandardCharsets.UTF_8));
    }

    private static String manifest(int files) {
        return "{\"format\":\"jhf-novel-reader-backup\",\"version\":1,\"files\":" + files + "}";
    }

    private static byte[] zip(String... namesAndBodies) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            for (int i = 0; i < namesAndBodies.length; i += 2) {
                out.putNextEntry(new ZipEntry(namesAndBodies[i]));
                out.write(namesAndBodies[i + 1].getBytes(StandardCharsets.UTF_8));
                out.closeEntry();
            }
        }
        return bytes.toByteArray();
    }

    private static byte[] renameBytes(byte[] archive, String from, String to) {
        String text = new String(archive, StandardCharsets.ISO_8859_1);
        assertTrue(text.contains(from));
        return text.replace(from, to).getBytes(StandardCharsets.ISO_8859_1);
    }

    private BackupArchive.PreparedRestore prepare(byte[] archive) throws Exception {
        return BackupArchive.prepare(filesDir, new ByteArrayInputStream(archive), VALIDATOR,
            BackupArchive.Limits.DEFAULT, HostStateMarkerReplacer::replace);
    }

    private int restore(byte[] archive, BackupArchive.Limits limits) throws Exception {
        BackupArchive.PreparedRestore prepared = BackupArchive.prepare(filesDir, new ByteArrayInputStream(archive),
            VALIDATOR, limits, HostStateMarkerReplacer::replace);
        return prepared.commit(prepared.token, settings.last, settings);
    }

    private void assertRejected(byte[] archive) throws Exception {
        assertRejected(archive, BackupArchive.Limits.DEFAULT);
    }

    private void assertRejected(byte[] archive, BackupArchive.Limits limits) throws Exception {
        try {
            restore(archive, limits);
            fail("복원이 거부되어야 한다");
        } catch (BackupArchive.InvalidBackupException expected) {
            // 기대한 결과
        }
        assertOldDataIntact();
    }

    private void assertOldDataIntact() throws IOException {
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertEquals("old position", read("narou-reader/positions/keep-2.json"));
        assertFalse(new File(filesDir, "narou-reader.restore").exists());
        assertFalse(new File(filesDir, "narou-reader.old").exists());
        assertEquals(0, settings.calls);
        assertEquals(Arrays.asList("narou-reader"), Arrays.asList(filesDir.list()));
    }

    private String read(String path) throws IOException {
        return new String(Files.readAllBytes(new File(filesDir, path).toPath()), StandardCharsets.UTF_8);
    }

    @Test public void preparingDoesNotReplaceLiveDataBeforeContentValidation() throws Exception {
        byte[] archive = zip(
            "manifest.json", manifest(1),
            "settings.json", "{\"fontSize\":20}",
            "narou-reader/library/index.json", "invalid schema"
        );
        BackupArchive.PreparedRestore prepared = prepare(archive);
        assertEquals(1, prepared.files);
        assertEquals("{\"fontSize\":20}", prepared.settings);
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertEquals("old position", read("narou-reader/positions/keep-2.json"));
        assertFalse(new File(filesDir, "narou-reader/library/index.json").exists());
        assertFalse(new File(filesDir, "narou-reader.old").exists());
        assertEquals(0, settings.calls);
        assertEquals("invalid schema", read("narou-reader.restore/narou-reader/library/index.json"));
    }

    @Test public void abortOnlyDeletesStagingAndCannotReuseTheToken() throws Exception {
        BackupArchive.PreparedRestore prepared = prepare(zip("manifest.json", manifest(1),
            "settings.json", "{}", "narou-reader/library/index.json", "new"));
        prepared.abort(prepared.token);
        assertOldDataIntact();
        assertThrows(IOException.class, () -> prepared.abort(prepared.token));
        assertThrows(IOException.class, () -> prepared.commit(prepared.token, settings.last, settings));
        assertThrows(IOException.class, () -> prepared.read(prepared.token, "library/index.json"));
    }

    @Test public void commitUsesExactlyThePreparedBytesAndInvalidatesTheToken() throws Exception {
        byte[] archive = zip("manifest.json", manifest(1), "settings.json", "{}",
            "narou-reader/library/index.json", "prepared bytes");
        BackupArchive.PreparedRestore prepared = prepare(archive);
        Arrays.fill(archive, (byte) 0);
        assertEquals("prepared bytes", prepared.read(prepared.token, "library/index.json"));
        assertEquals(1, prepared.commit(prepared.token, settings.last, settings));
        assertEquals("prepared bytes", read("narou-reader/library/index.json"));
        assertEquals("{}", settings.last);
        assertThrows(IOException.class, () -> prepared.commit(prepared.token, settings.last, settings));
        assertThrows(IOException.class, () -> prepared.list(prepared.token, 0));
    }

    @Test public void preparedPathsArePagedWithoutReadingAllBodies() throws Exception {
        String[] entries = new String[2 + 600 * 2];
        entries[0] = "manifest.json";
        entries[1] = manifest(600);
        for (int i = 0; i < 600; i++) {
            entries[2 + i * 2] = "narou-reader/chapters/" + String.format(java.util.Locale.US, "%04d.json", i);
            entries[3 + i * 2] = "body-" + i;
        }
        BackupArchive.PreparedRestore prepared = prepare(zip(entries));
        BackupArchive.RestorePage first = prepared.list(prepared.token, 0);
        assertEquals(256, first.paths.size());
        assertEquals("chapters/0000.json", first.paths.get(0));
        assertEquals(Integer.valueOf(256), first.nextOffset);
        BackupArchive.RestorePage second = prepared.list(prepared.token, first.nextOffset);
        assertEquals(256, second.paths.size());
        assertEquals(Integer.valueOf(512), second.nextOffset);
        BackupArchive.RestorePage last = prepared.list(prepared.token, second.nextOffset);
        assertEquals(88, last.paths.size());
        assertNull(last.nextOffset);
        assertTrue(prepared.list(prepared.token, 600).paths.isEmpty());
        assertThrows(IOException.class, () -> prepared.list(prepared.token, -1));
        assertThrows(IOException.class, () -> prepared.list(prepared.token, 601));
        assertThrows(UnsupportedOperationException.class, () -> first.paths.add("chapters/forged.json"));
        prepared.abort(prepared.token);
    }

    @Test public void rejectsStaleTokensAndOverlappingPreparationWithoutChangingEitherTree() throws Exception {
        byte[] archive = zip("manifest.json", manifest(1), "narou-reader/library/index.json", "prepared");
        BackupArchive.PreparedRestore prepared = prepare(archive);
        assertThrows(IOException.class, () -> prepare(archive));
        assertThrows(IOException.class, () -> prepared.list("stale", 0));
        assertThrows(IOException.class, () -> prepared.read(null, "library/index.json"));
        assertThrows(IOException.class, () -> prepared.commit("stale", settings.last, settings));
        assertThrows(IOException.class, () -> prepared.abort("stale"));
        assertEquals("prepared", prepared.read(prepared.token, "library/index.json"));
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertEquals(0, settings.calls);
        prepared.abort(prepared.token);
    }

    @Test public void stagedReadsRejectTraversalAndCanonicalEscapeAndEnforceByteLimit() throws Exception {
        BackupArchive.PreparedRestore prepared = BackupArchive.prepare(filesDir,
            new ByteArrayInputStream(zip("manifest.json", manifest(1), "narou-reader/library/index.json", "12345")),
            VALIDATOR, new BackupArchive.Limits(5, 1024, 10, 1024), HostStateMarkerReplacer::replace);
        for (String path : new String[] {"../manifest.json", "/library/index.json", "library/../index.json",
            "library/index.json/extra", "library/..", "narou-reader/library/index.json", "library/a\\b.json"}) {
            assertThrows(path, IOException.class, () -> prepared.read(prepared.token, path));
        }
        assertNull(prepared.read(prepared.token, "library/missing.json"));
        File staged = new File(filesDir, "narou-reader.restore/narou-reader/library/index.json");
        Files.write(staged.toPath(), "123456".getBytes(StandardCharsets.UTF_8));
        assertThrows(IOException.class, () -> prepared.read(prepared.token, "library/index.json"));
        Files.delete(staged.toPath());
        Files.createSymbolicLink(staged.toPath(), new File(filesDir, "narou-reader/chapters/keep-1.json").toPath());
        assertThrows(IOException.class, () -> prepared.read(prepared.token, "library/index.json"));
        Files.delete(staged.toPath());
        prepared.abort(prepared.token);
        assertOldDataIntact();
    }

    @Test public void failedPrepareCleanupPreventsAReplacementSession() throws Exception {
        byte[] archive = zip("narou-reader/library/index.json", "staged", "manifest.json", manifest(1));
        File folder = new File(filesDir, "narou-reader.restore/narou-reader/library");
        BackupArchive.Validator invalid = new BackupArchive.Validator() {
            @Override public long manifestFiles(String text) throws BackupArchive.InvalidBackupException {
                assertTrue(folder.setWritable(false, false));
                throw new BackupArchive.InvalidBackupException("invalid manifest");
            }
            @Override public void settings(String text) {}
        };
        try {
            BackupArchive.InvalidBackupException failure = assertThrows(BackupArchive.InvalidBackupException.class,
                () -> BackupArchive.prepare(filesDir, new ByteArrayInputStream(archive), invalid, BackupArchive.Limits.DEFAULT));
            assertEquals(1, failure.getSuppressed().length);
            assertEquals("cannot remove restore staging", failure.getSuppressed()[0].getMessage());
            assertThrows(IOException.class, () -> prepare(archive));
            assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
            assertEquals("staged", read("narou-reader.restore/narou-reader/library/index.json"));
            assertEquals(0, settings.calls);
        } finally {
            assertTrue(folder.setWritable(true, false));
        }
    }

    @Test public void preparingDoesNotCleanOrRecoverAPreexistingOldTree() throws Exception {
        File oldFile = new File(filesDir, "narou-reader.old/old.json");
        oldFile.getParentFile().mkdirs();
        Files.write(oldFile.toPath(), "retained".getBytes(StandardCharsets.UTF_8));
        assertThrows(IOException.class, () -> prepare(zip("manifest.json", manifest(0))));
        assertEquals("retained", read("narou-reader.old/old.json"));
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertFalse(new File(filesDir, "narou-reader.restore").exists());
        assertEquals(0, settings.calls);
    }

    @Test public void failedAbortBlocksCommitAndNewPreparationUntilCleanupSucceeds() throws Exception {
        byte[] archive = zip("manifest.json", manifest(1), "narou-reader/library/index.json", "staged");
        BackupArchive.PreparedRestore prepared = prepare(archive);
        File folder = new File(filesDir, "narou-reader.restore/narou-reader/library");
        assertTrue(folder.setWritable(false, false));
        try {
            assertThrows(IOException.class, () -> prepared.abort(prepared.token));
            assertThrows(IOException.class, () -> prepared.commit(prepared.token, settings.last, settings));
            assertThrows(IOException.class, () -> prepare(archive));
            assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
            assertEquals(0, settings.calls);
        } finally {
            assertTrue(folder.setWritable(true, false));
        }
        prepared.abort(prepared.token);
        assertOldDataIntact();
    }

    @Test public void restoreReplacesDataAndSettings() throws Exception {
        byte[] archive = zip(
            "manifest.json", manifest(2),
            "settings.json", "{\"fontSize\":20}",
            "narou-reader/library/index.json", "lib",
            "narou-reader/titles/t-1.json", "title"
        );
        assertEquals(2, restore(archive, BackupArchive.Limits.DEFAULT));
        assertEquals("lib", read("narou-reader/library/index.json"));
        assertEquals("title", read("narou-reader/titles/t-1.json"));
        assertFalse(new File(filesDir, "narou-reader/chapters/keep-1.json").exists());
        assertEquals("{\"fontSize\":20}", settings.last);
        assertEquals(Arrays.asList("narou-reader"), Arrays.asList(filesDir.list()));
    }

    @Test public void restoreWithoutSettingsClearsTheKey() throws Exception {
        assertEquals(0, restore(zip("manifest.json", manifest(0)), BackupArchive.Limits.DEFAULT));
        assertNull(settings.last);
        assertEquals(1, settings.calls);
        assertTrue(new File(filesDir, "narou-reader").isDirectory());
        assertEquals(0, new File(filesDir, "narou-reader").list().length);
    }

    @Test public void restoreWorksWhenNoDataExistsYet() throws Exception {
        BackupArchive.deleteRecursively(new File(filesDir, "narou-reader"));
        assertEquals(1, restore(zip("manifest.json", manifest(1), "narou-reader/works/w.json", "w"), BackupArchive.Limits.DEFAULT));
        assertEquals("w", read("narou-reader/works/w.json"));
    }

    @Test public void rejectsUnsafeOrUnknownEntryNames() throws Exception {
        String[] bad = {
            "../evil.txt",
            "narou-reader/../evil.txt",
            "narou-reader/chapters/../../evil.txt",
            "narou-reader/chapters/..",
            "narou-reader/chapters/.",
            "/narou-reader/chapters/a.json",
            "narou-reader//chapters/a.json",
            "narou-reader/chapters/sub/a.json",
            "narou-reader/chapters/a b.json",
            "narou-reader/chapters/가.json",
            "narou-reader/chapters/a.json\n",
            "narou-reader/chapters\\a.json",
            "narou-reader/models/a.json",
            "narou-reader-models/model.litertlm",
            "narou-reader/chapters/",
            "narou-reader/",
            "other.txt",
            "settings.json.bak",
        };
        for (String name : bad) {
            assertRejected(zip("manifest.json", manifest(1), name, "x"));
            assertRejected(zip("manifest.json", manifest(0), name, "x"));
        }
    }

    @Test public void rejectsDirectoryAndDuplicateEntries() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream out = new ZipOutputStream(bytes)) {
            out.putNextEntry(new ZipEntry("manifest.json"));
            out.write(manifest(0).getBytes(StandardCharsets.UTF_8));
            out.closeEntry();
            out.putNextEntry(new ZipEntry("narou-reader/chapters/"));
            out.closeEntry();
        }
        assertRejected(bytes.toByteArray());
        // ZipOutputStream은 같은 이름을 만들어 주지 않으므로, 이름이 같은 길이인 두 항목을 만든 뒤 바이트를 바꾼다.
        assertRejected(renameBytes(zip(
            "manifest.json", manifest(2),
            "narou-reader/chapters/a.json", "1",
            "narou-reader/chapters/b.json", "2"
        ), "chapters/b.json", "chapters/a.json"));
        assertRejected(renameBytes(zip(
            "manifest.json", manifest(0),
            "manifest.jsoX", manifest(0)
        ), "manifest.jsoX", "manifest.json"));
    }

    @Test public void rejectsBadManifest() throws Exception {
        assertRejected(zip("narou-reader/chapters/a.json", "1"));
        assertRejected(zip("manifest.json", "{\"format\":\"other\",\"version\":1,\"files\":0}"));
        assertRejected(zip("manifest.json", "{\"format\":\"jhf-novel-reader-backup\",\"version\":2,\"files\":0}"));
        assertRejected(zip("manifest.json", "not json"));
        // 항목 경계에서 잘린 백업: manifest가 말하는 파일 수와 다르다.
        assertRejected(zip("manifest.json", manifest(2), "narou-reader/chapters/a.json", "1"));
        assertRejected(zip("manifest.json", manifest(0), "narou-reader/chapters/a.json", "1"));
    }

    @Test public void rejectsBadSettings() throws Exception {
        assertRejected(zip("manifest.json", manifest(0), "settings.json", "[1]"));
    }

    @Test public void rejectsNonZipAndTruncatedZip() throws Exception {
        assertRejected("this is not a zip".getBytes(StandardCharsets.UTF_8));
        assertRejected(new byte[0]);
        java.util.Random random = new java.util.Random(7);
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < 3000; i++) body.append((char) ('a' + random.nextInt(26)));
        byte[] full = zip("manifest.json", manifest(1), "narou-reader/chapters/a.json", body.toString());
        // 항목 데이터 한가운데에서 끊긴 파일
        assertRejected(Arrays.copyOf(full, full.length / 2));
    }

    @Test public void rejectsOversizedEntriesTotalAndEntryCount() throws Exception {
        BackupArchive.Limits small = new BackupArchive.Limits(10, 25, 3, 1024);
        // 항목 하나가 상한 초과
        assertRejected(zip("manifest.json", manifest(1), "narou-reader/chapters/a.json", "01234567890"), small);
        // 항목은 작아도 전체가 상한 초과
        assertRejected(zip(
            "manifest.json", manifest(3),
            "narou-reader/chapters/a.json", "0123456789",
            "narou-reader/chapters/b.json", "0123456789",
            "narou-reader/chapters/c.json", "0123456789"
        ), new BackupArchive.Limits(10, 25, 10, 1024));
        // 항목 수 초과
        assertRejected(zip(
            "manifest.json", manifest(3),
            "narou-reader/chapters/a.json", "1",
            "narou-reader/chapters/b.json", "1",
            "narou-reader/chapters/c.json", "1"
        ), small);
        // manifest·settings 상한
        assertRejected(zip("manifest.json", manifest(0), "settings.json", "{" + " ".repeat(2000) + "}"), small);
    }

    @Test public void limitsAreCountedByActualBytesNotDeclaredSize() throws Exception {
        // 압축률이 큰 항목: 풀면 상한을 넘는다.
        byte[] bomb = zip("manifest.json", manifest(1), "narou-reader/chapters/a.json", "0".repeat(100_000));
        assertTrue(bomb.length < 2_000);
        assertRejected(bomb, new BackupArchive.Limits(50_000, 1_000_000, 100, 1024));
    }

    @Test public void repeatedSettingsFailureRetainsOriginalFilesAndUndoUntilRecovery() throws Exception {
        settings.fail = true;
        assertThrows(IOException.class, () -> restore(zip("manifest.json", manifest(1), "settings.json", "{}",
            "narou-reader/library/new.json", "new"), BackupArchive.Limits.DEFAULT));
        assertEquals("old chapter", read("narou-reader.old/chapters/keep-1.json"));
        assertEquals("new", read("narou-reader/library/new.json"));
        assertTrue(BackupRestoreTransaction.pending(filesDir));
        assertEquals(2, settings.calls);
        settings.fail = false;
        HostStateMarkerReplacer.transaction(filesDir, settings).recover();
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertEquals("unset", settings.last);
        assertFalse(BackupRestoreTransaction.pending(filesDir));
    }

    @Test public void settingsFailureCanChangeMemoryAndLeavesSessionUnusable() throws Exception {
        byte[] archive = zip("manifest.json", manifest(1), "settings.json", "{}", "narou-reader/library/new.json", "new");
        BackupArchive.PreparedRestore prepared = prepare(archive);
        String[] memory = {"old settings"};
        IOException failure = assertThrows(IOException.class, () -> prepared.commit(prepared.token, "old settings", value -> {
            memory[0] = value;
            return false;
        }));
        assertNotNull(failure.getCause());
        assertEquals("old settings", memory[0]);
        assertEquals("old chapter", read("narou-reader.old/chapters/keep-1.json"));
        assertThrows(IOException.class, () -> prepared.abort(prepared.token));
        assertThrows(IOException.class, () -> prepared.commit(prepared.token, settings.last, settings));
        assertThrows(IOException.class, () -> prepared.list(prepared.token, 0));
        assertThrows(IOException.class, () -> prepare(archive));
    }

    @Test public void failedSettingsCommitRestoresThePreviousMemoryValue() throws Exception {
        class MemoryStore implements BackupArchive.SettingsStore {
            String value = "old settings";
            int calls;
            public String read() { return value; }
            @Override public boolean commit(String next) {
                value = next;
                return ++calls != 1;
            }
        }
        MemoryStore store = new MemoryStore();
        BackupArchive.PreparedRestore prepared = prepare(zip("manifest.json", manifest(1),
            "settings.json", "{}", "narou-reader/library/new.json", "new"));
        assertThrows(IOException.class, () -> prepared.commit(prepared.token, store.read(), store));
        assertEquals("old settings", store.value);
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
    }

    @Test public void processDeathBeforeSettingsCommitPreservesTheOldPairOnRestart() throws Exception {
        BackupArchive.PreparedRestore prepared = prepare(zip("manifest.json", manifest(1),
            "settings.json", "{}", "narou-reader/library/new.json", "new"));
        assertThrows(AssertionError.class, () -> prepared.commit(prepared.token, "old settings", value -> {
            throw new AssertionError("synthetic process death after new tree placement");
        }));
        HostStateMarkerReplacer.transaction(filesDir, settings).recover();
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertFalse(new File(filesDir, "narou-reader/library/new.json").exists());
        assertEquals("old settings", settings.last);
    }

    @Test public void rollbackFailureRetainsTheOldTreeAndReportsUncertainty() throws Exception {
        BackupArchive.PreparedRestore prepared = prepare(zip("manifest.json", manifest(1), "settings.json", "{}",
            "narou-reader/library/new.json", "new"));
        IOException failure = assertThrows(IOException.class, () -> prepared.commit(prepared.token, "old settings", value -> {
            // 새 트리를 다시 임시 위치로 옮기는 rename을 확실하게 실패시킨다.
            File blocker = new File(filesDir, "narou-reader.restore/narou-reader/blocker");
            blocker.getParentFile().mkdirs();
            try {
                Files.write(blocker.toPath(), new byte[] {1});
            } catch (IOException unexpected) {
                throw new IllegalStateException(unexpected);
            }
            return false;
        }));
        assertNotNull(failure.getCause());
        assertEquals("old chapter", read("narou-reader.old/chapters/keep-1.json"));
        assertEquals("old position", read("narou-reader.old/positions/keep-2.json"));
        assertEquals("new", read("narou-reader/library/new.json"));
        assertTrue(new File(filesDir, "narou-reader.restore/narou-reader/blocker").exists());
        assertThrows(IOException.class, () -> prepared.abort(prepared.token));
    }

    @Test public void placementFailureRestoresOriginalTreeWithoutDeletingTheStage() throws Exception {
        BackupArchive.PreparedRestore prepared = prepare(zip("manifest.json", manifest(1), "narou-reader/library/new.json", "new"));
        File stage = new File(filesDir, "narou-reader.restore");
        assertTrue(stage.setWritable(false, false));
        try {
            IOException failure = assertThrows(IOException.class, () -> prepared.commit(prepared.token, settings.last, settings));
            assertNotNull(failure.getCause());
            assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
            assertTrue(BackupRestoreTransaction.pending(filesDir));
            assertFalse(new File(filesDir, "narou-reader.old").exists());
            assertEquals(1, settings.calls);
        } finally {
            assertTrue(stage.setWritable(true, false));
        }
    }

    @Test public void failureWhileMovingKeepsOldData() throws Exception {
        // 데이터 폴더 자리에 이미 .old가 있고 지울 수 없는 경우는 만들기 어렵다. 대신 잘못된 입력 뒤 재시도가 성공하는지 본다.
        assertRejected(zip("manifest.json", manifest(1), "../x", "x"));
        assertEquals(1, restore(zip("manifest.json", manifest(1), "narou-reader/works/w.json", "w"), BackupArchive.Limits.DEFAULT));
    }

    @Test public void unmarkedOldDataIsNotGuessedOrCleanedAtStartup() throws Exception {
        File live = new File(filesDir, "narou-reader");
        File old = new File(filesDir, "narou-reader.old");
        assertTrue(live.renameTo(old));
        new File(filesDir, "narou-reader.restore/narou-reader").mkdirs();
        assertThrows(IOException.class, () -> HostStateMarkerReplacer.transaction(filesDir, settings).recover());
        assertEquals("old chapter", read("narou-reader.old/chapters/keep-1.json"));
        assertTrue(new File(filesDir, "narou-reader.restore").exists());
        assertEquals(0, settings.calls);
    }

    @Test public void writeThenRestoreRoundTripsAndSkipsUnlistedFiles() throws Exception {
        put("chapters", "bad name.json", "skip");
        put("chapters", "..tmp", "keepdots");
        File stray = new File(filesDir, "narou-reader/unknown");
        stray.mkdirs();
        Files.write(new File(stray, "a.json").toPath(), new byte[] {1});
        Files.write(new File(filesDir, "narou-reader/loose.json").toPath(), new byte[] {1});
        File zip = new File(temp.getRoot(), "backup.zip");
        int count = BackupArchive.write(
            new File(filesDir, "narou-reader"), "{\"a\":1}", BackupArchiveTest::manifest, zip, BackupArchive.Limits.DEFAULT
        );
        assertEquals(3, count);

        File target = temp.newFolder("other");
        BackupArchive.PreparedRestore prepared = BackupArchive.prepare(
            target, new java.io.FileInputStream(zip), VALIDATOR, BackupArchive.Limits.DEFAULT,
            HostStateMarkerReplacer::replace
        );
        int restored = prepared.commit(prepared.token, null, new Recorder());
        assertEquals(3, restored);
        assertEquals("old chapter", new String(Files.readAllBytes(new File(target, "narou-reader/chapters/keep-1.json").toPath()), StandardCharsets.UTF_8));
        assertEquals("keepdots", new String(Files.readAllBytes(new File(target, "narou-reader/chapters/..tmp").toPath()), StandardCharsets.UTF_8));
        assertFalse(new File(target, "narou-reader/chapters/bad name.json").exists());
        assertFalse(new File(target, "narou-reader/unknown").exists());
        assertFalse(new File(target, "narou-reader/loose.json").exists());
    }

    @Test public void writeRefusesWhatRestoreWouldRefuse() throws Exception {
        File zip = new File(temp.getRoot(), "big.zip");
        try {
            BackupArchive.write(new File(filesDir, "narou-reader"), null, BackupArchiveTest::manifest, zip, new BackupArchive.Limits(5, 1000, 100, 1024));
            fail("상한을 넘는 파일은 담지 않는다");
        } catch (IOException expected) {
            // 기대한 결과
        }
    }

    @Test public void exportCountsMetadataBytesEvenWithoutDataFiles() throws Exception {
        File empty = temp.newFolder("empty");
        for (String value : new String[] {null, "{\"label\":\"한글🙂\"}"}) {
            long bytes = manifest(0).getBytes(StandardCharsets.UTF_8).length
                + (value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length);
            File zip = new File(temp.getRoot(), value == null ? "without-settings.zip" : "with-settings.zip");
            BackupArchive.Limits limits = new BackupArchive.Limits(1024, bytes - 1, 10, 1024);
            assertThrows(IOException.class, () -> BackupArchive.write(empty, value, BackupArchiveTest::manifest, zip, limits));
            assertFalse("메타데이터만으로 초과하면 출력 파일을 열지 않는다", zip.exists());
        }
    }

    @Test public void exportAndExtractAgreeAtExactUtf8TotalByteBoundaries() throws Exception {
        File data = new File(filesDir, "narou-reader");
        String extra = ",\"name\":\"한글🙂\"";
        String metadata = manifest(2).replace("}", extra + "}");
        BackupArchive.Validator unicodeValidator = new BackupArchive.Validator() {
            @Override public long manifestFiles(String text) throws BackupArchive.InvalidBackupException {
                return VALIDATOR.manifestFiles(text.replace(extra, ""));
            }
            @Override public void settings(String text) throws BackupArchive.InvalidBackupException { VALIDATOR.settings(text); }
        };
        for (String value : new String[] {null, "{\"label\":\"설정🙂\"}"}) {
            long bytes = metadata.getBytes(StandardCharsets.UTF_8).length
                + (value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length)
                + "old chapter".getBytes(StandardCharsets.UTF_8).length
                + "old position".getBytes(StandardCharsets.UTF_8).length;
            for (int margin : new int[] {-1, 0, 1}) {
                BackupArchive.Limits limits = new BackupArchive.Limits(1024, bytes + margin, 10, 1024);
                File zip = new File(temp.newFolder(), "boundary.zip");
                if (margin < 0) {
                    assertThrows(IOException.class, () -> BackupArchive.write(data, value, count -> metadata, zip, limits));
                } else {
                    assertEquals(2, BackupArchive.write(data, value, count -> metadata, zip, limits));
                    try (java.io.FileInputStream in = new java.io.FileInputStream(zip)) {
                        BackupArchive.Extracted restored = BackupArchive.extract(in, temp.newFolder(), unicodeValidator, limits);
                        assertEquals(2, restored.files);
                        assertEquals(value, restored.settings);
                    }
                }
            }
        }
    }

    @Test public void fileGrowthAfterEnumerationCannotBypassAggregateExportLimit() throws Exception {
        File data = new File(filesDir, "narou-reader");
        long initialBytes = manifest(2).getBytes(StandardCharsets.UTF_8).length + 11 + 12;
        BackupArchive.Limits limits = new BackupArchive.Limits(64, initialBytes, 10, 1024);
        File zip = new File(temp.getRoot(), "grown.zip");
        BackupArchive.ManifestFactory growing = count -> {
            try {
                Files.write(new File(data, "chapters/keep-1.json").toPath(), ("old chapter" + "x".repeat(20)).getBytes(StandardCharsets.UTF_8));
            } catch (IOException failure) { throw new AssertionError(failure); }
            return manifest(count);
        };
        assertThrows(IOException.class, () -> BackupArchive.write(data, null, growing, zip, limits));
        assertTrue(new File(data, "chapters/keep-1.json").length() < limits.entryBytes);
    }

    @Test public void exportUsesTransferredSizeWhenFilesShrinkAfterEnumeration() throws Exception {
        File data = new File(filesDir, "narou-reader");
        put("chapters", "keep-1.json", "x".repeat(200));
        long actualBytes = manifest(2).getBytes(StandardCharsets.UTF_8).length + 1 + 12;
        BackupArchive.Limits limits = new BackupArchive.Limits(1024, actualBytes, 10, 1024);
        File zip = new File(temp.getRoot(), "shrunk.zip");
        BackupArchive.ManifestFactory shrinking = count -> {
            try { Files.write(new File(data, "chapters/keep-1.json").toPath(), new byte[] {'x'}); }
            catch (IOException failure) { throw new AssertionError(failure); }
            return manifest(count);
        };
        assertEquals(2, BackupArchive.write(data, null, shrinking, zip, limits));
        try (java.io.FileInputStream in = new java.io.FileInputStream(zip)) {
            assertEquals(2, BackupArchive.extract(in, temp.newFolder(), VALIDATOR, limits).files);
        }
    }
}
