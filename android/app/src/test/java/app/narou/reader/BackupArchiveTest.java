package app.narou.reader;

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
            if (fail) return false;
            last = value;
            return true;
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

    private int restore(byte[] archive, BackupArchive.Limits limits) throws Exception {
        return BackupArchive.restore(filesDir, new ByteArrayInputStream(archive), VALIDATOR, settings, limits);
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

    @Test public void failedSettingsSaveRollsBackToTheOldData() throws Exception {
        settings.fail = true;
        try {
            restore(zip("manifest.json", manifest(1), "settings.json", "{}", "narou-reader/library/new.json", "n"), BackupArchive.Limits.DEFAULT);
            fail("설정 저장 실패는 복원 실패여야 한다");
        } catch (IOException expected) {
            // 기대한 결과
        }
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertEquals("old position", read("narou-reader/positions/keep-2.json"));
        assertFalse(new File(filesDir, "narou-reader/library/new.json").exists());
        assertFalse(new File(filesDir, "narou-reader.restore").exists());
        assertFalse(new File(filesDir, "narou-reader.old").exists());
        assertEquals(Arrays.asList("narou-reader"), Arrays.asList(filesDir.list()));
    }

    @Test public void failureWhileMovingKeepsOldData() throws Exception {
        // 데이터 폴더 자리에 이미 .old가 있고 지울 수 없는 경우는 만들기 어렵다. 대신 잘못된 입력 뒤 재시도가 성공하는지 본다.
        assertRejected(zip("manifest.json", manifest(1), "../x", "x"));
        assertEquals(1, restore(zip("manifest.json", manifest(1), "narou-reader/works/w.json", "w"), BackupArchive.Limits.DEFAULT));
    }

    @Test public void leftoversAreCleanedOrRecovered() throws Exception {
        // 교체 도중 끊김: 데이터 폴더가 없고 .old만 남음 → 되돌린다.
        File live = new File(filesDir, "narou-reader");
        File old = new File(filesDir, "narou-reader.old");
        assertTrue(live.renameTo(old));
        new File(filesDir, "narou-reader.restore/narou-reader").mkdirs();
        BackupArchive.recoverInterruptedSwap(filesDir);
        BackupArchive.deleteLeftovers(filesDir);
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
        assertFalse(old.exists());
        assertFalse(new File(filesDir, "narou-reader.restore").exists());
        // 새 데이터가 이미 자리 잡은 뒤 끊김: .old는 지운다.
        File extra = new File(filesDir, "narou-reader.old/x");
        extra.getParentFile().mkdirs();
        Files.write(extra.toPath(), new byte[] {1});
        BackupArchive.recoverInterruptedSwap(filesDir);
        BackupArchive.deleteLeftovers(filesDir);
        assertFalse(old.exists());
        assertEquals("old chapter", read("narou-reader/chapters/keep-1.json"));
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
        int restored = BackupArchive.restore(
            target, new java.io.FileInputStream(zip), VALIDATOR, new Recorder(), BackupArchive.Limits.DEFAULT
        );
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
}
