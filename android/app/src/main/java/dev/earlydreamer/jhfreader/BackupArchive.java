package dev.earlydreamer.jhfreader;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * 백업 zip의 만들기·검사·풀기·교체. 안드로이드 API에 기대지 않아 JVM 단위 시험으로 확인한다.
 * 복원은 임시 폴더에 풀어 모두 검사한 뒤에만 기존 데이터와 바꾼다.
 */
final class BackupArchive {
    static final String FORMAT = "jhf-novel-reader-backup";
    static final int VERSION = 1;
    static final String MANIFEST = "manifest.json";
    static final String SETTINGS = "settings.json";
    static final String DATA_DIR = "narou-reader";
    static final String RESTORE_DIR = "narou-reader.restore";
    static final String OLD_DIR = "narou-reader.old";

    static final String[] FOLDERS = {
        "chapters", "positions", "library", "versions", "reading",
        "works", "attempts", "batches", "guidance", "titles",
    };
    private static final Pattern FILE_NAME = Pattern.compile("[a-zA-Z0-9.-]+");
    private static final Pattern DATA_ENTRY = Pattern.compile(
        "narou-reader/(chapters|positions|library|versions|reading|works|attempts|batches|guidance|titles)/([a-zA-Z0-9.-]+)"
    );

    /** 항목 하나 64MB, 전체 1GB, 항목 200,000개. manifest·settings는 1MB. */
    static final class Limits {
        final long entryBytes;
        final long totalBytes;
        final int entries;
        final long jsonBytes;

        Limits(long entryBytes, long totalBytes, int entries, long jsonBytes) {
            this.entryBytes = entryBytes;
            this.totalBytes = totalBytes;
            this.entries = entries;
            this.jsonBytes = jsonBytes;
        }

        static final Limits DEFAULT = new Limits(64L * 1024 * 1024, 1024L * 1024 * 1024, 200_000, 1024L * 1024);
    }

    /** 백업 파일이 이 앱의 형식이 아닐 때. 화면에는 "이 앱의 백업 파일이 아니에요"로 나간다. */
    static final class InvalidBackupException extends Exception {
        InvalidBackupException(String message) {
            super(message);
        }
    }

    /** manifest·settings의 JSON 검사. org.json은 안드로이드에만 있어 바깥에서 넣는다. */
    interface Validator {
        /** format·version이 맞는지 보고 manifest.files 값을 돌려준다. 틀리면 InvalidBackupException. */
        long manifestFiles(String text) throws InvalidBackupException;

        /** JSON 객체로 읽히지 않으면 InvalidBackupException. */
        void settings(String text) throws InvalidBackupException;
    }

    /** 설정 저장소(SharedPreferences) 접근. value가 null이면 키를 지운다. */
    interface SettingsStore {
        boolean commit(String value);
    }

    interface ManifestFactory {
        String create(int files);
    }

    static final class Extracted {
        final int files;
        final String settings;
        final List<String> paths;

        Extracted(int files, String settings, List<String> paths) {
            this.files = files;
            this.settings = settings;
            this.paths = Collections.unmodifiableList(new ArrayList<>(paths));
        }
    }

    /** 검증 중인 파일은 이 세션만 소유한다. 라이브 데이터 교체는 commit에서만 한다. */
    static final class PreparedRestore {
        final String token = UUID.randomUUID().toString();
        final int files;
        final String settings;
        private final File filesDir;
        private final File root;
        private final Limits limits;
        private final List<String> paths;
        private State state = State.PREPARED;

        private enum State { PREPARED, ABORTING, COMMITTING, FINISHED, FAILED }

        private PreparedRestore(File filesDir, Extracted extracted, Limits limits) throws IOException {
            this.filesDir = filesDir;
            this.root = new File(filesDir, RESTORE_DIR).getCanonicalFile();
            this.limits = limits;
            files = extracted.files;
            settings = extracted.settings;
            paths = extracted.paths;
        }

        private void requireToken(String candidate) throws IOException {
            if (!token.equals(candidate)) throw new IOException("invalid restore token");
        }

        private void requirePrepared(String candidate) throws IOException {
            requireToken(candidate);
            if (state != State.PREPARED) throw new IOException("restore session is no longer prepared");
            if (!root.isDirectory() || !root.equals(root.getCanonicalFile())) throw new IOException("restore staging changed");
        }

        synchronized RestorePage list(String candidate, int offset) throws IOException {
            requirePrepared(candidate);
            if (offset < 0 || offset > paths.size()) throw new IOException("invalid restore offset");
            int end = Math.min(offset + 256, paths.size());
            return new RestorePage(paths.subList(offset, end), end < paths.size() ? end : null);
        }

        synchronized String read(String candidate, String path) throws IOException {
            requirePrepared(candidate);
            if (path == null) throw new IOException("invalid restore path");
            Matcher match = DATA_ENTRY.matcher(DATA_DIR + "/" + path);
            if (!match.matches() || !isFileName(match.group(2))) throw new IOException("invalid restore path");
            File dataRoot = new File(root, DATA_DIR);
            File target = new File(dataRoot, path);
            String canonical = target.getCanonicalPath();
            if (!canonical.startsWith(dataRoot.getAbsolutePath() + File.separator)
                || !canonical.equals(target.getAbsolutePath())) throw new IOException("outside restore staging");
            if (Collections.binarySearch(paths, path) < 0 || !target.isFile()) return null;
            try (InputStream input = new BufferedInputStream(new FileInputStream(target))) {
                return new String(readSmall(input, limits.entryBytes, new byte[64 * 1024]), StandardCharsets.UTF_8);
            } catch (InvalidBackupException tooLarge) {
                throw new IOException("restore file too large", tooLarge);
            }
        }

        synchronized void abort(String candidate) throws IOException {
            requireToken(candidate);
            if (state != State.PREPARED && state != State.ABORTING) throw new IOException("cannot abort restore session");
            state = State.ABORTING;
            deleteRecursively(root);
            if (root.exists()) throw new IOException("cannot remove restore staging");
            state = State.FINISHED;
        }

        /** 교체를 시작한 뒤 실패하면 설정·파일 결과가 불확실할 수 있다. 세션을 재사용하지 않는다. */
        synchronized int commit(String candidate, String previousSettings, SettingsStore store) throws IOException {
            requirePrepared(candidate);
            state = State.COMMITTING;
            try {
                new BackupRestoreTransaction(filesDir, store).commit(previousSettings, settings);
                state = State.FINISHED;
                return files;
            } catch (IOException | RuntimeException failure) {
                state = State.FAILED;
                throw failure;
            }
        }
    }

    static final class RestorePage {
        final List<String> paths;
        final Integer nextOffset;

        RestorePage(List<String> paths, Integer nextOffset) {
            this.paths = Collections.unmodifiableList(new ArrayList<>(paths));
            this.nextOffset = nextOffset;
        }
    }

    private BackupArchive() {}

    // ---- 만들기 ----

    private static final class Item {
        final String entry;
        final File file;

        Item(String entry, File file) {
            this.entry = entry;
            this.file = file;
        }
    }

    static boolean isFileName(String name) {
        return FILE_NAME.matcher(name).matches() && !".".equals(name) && !"..".equals(name);
    }

    /** zip을 만들고 담은 데이터 파일 수를 돌려준다. 복원이 거부할 크기면 만들지 않고 IOException. */
    static int write(File dataRoot, String settings, ManifestFactory manifest, File zip, Limits limits)
        throws IOException {
        List<Item> items = new ArrayList<>();
        long total = 0;
        for (String folder : FOLDERS) {
            File[] children = new File(dataRoot, folder).listFiles();
            if (children == null) continue;
            for (File child : children) {
                if (!child.isFile() || !isFileName(child.getName())) continue;
                long length = child.length();
                if (length > limits.entryBytes) throw new IOException("file too large");
                total += length;
                if (total > limits.totalBytes) throw new IOException("backup too large");
                items.add(new Item(DATA_DIR + "/" + folder + "/" + child.getName(), child));
            }
        }
        if (items.size() + 2 > limits.entries) throw new IOException("too many files");
        byte[] manifestBytes = manifest.create(items.size()).getBytes(StandardCharsets.UTF_8);
        byte[] settingsBytes = settings == null ? null : settings.getBytes(StandardCharsets.UTF_8);
        if (manifestBytes.length > limits.jsonBytes) throw new IOException("manifest too large");
        if (settingsBytes != null && settingsBytes.length > limits.jsonBytes) throw new IOException("settings too large");

        byte[] buffer = new byte[64 * 1024];
        try (ZipOutputStream out = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(zip)))) {
            put(out, MANIFEST, manifestBytes);
            if (settingsBytes != null) put(out, SETTINGS, settingsBytes);
            for (Item item : items) {
                out.putNextEntry(new ZipEntry(item.entry));
                long written = 0;
                try (InputStream in = new FileInputStream(item.file)) {
                    int read;
                    while ((read = in.read(buffer)) > 0) {
                        written += read;
                        // 만드는 동안 파일이 커졌어도 복원이 거부할 크기는 담지 않는다.
                        if (written > limits.entryBytes) throw new IOException("file too large");
                        out.write(buffer, 0, read);
                    }
                }
                out.closeEntry();
            }
        }
        return items.size();
    }

    private static void put(ZipOutputStream out, String name, byte[] bytes) throws IOException {
        out.putNextEntry(new ZipEntry(name));
        out.write(bytes);
        out.closeEntry();
    }

    // ---- 풀기·검사 ----

    /**
     * root 아래에 풀고 검사한다. root/narou-reader는 파일이 없어도 만든다.
     * 검사를 어기면 InvalidBackupException. 정리(root 삭제)는 부르는 쪽이 한다.
     */
    static Extracted extract(InputStream source, File root, Validator validator, Limits limits)
        throws IOException, InvalidBackupException {
        File dataRoot = new File(root, DATA_DIR);
        if (!dataRoot.mkdirs() && !dataRoot.isDirectory()) throw new IOException("cannot create restore folder");
        String rootPath = root.getCanonicalPath() + File.separator;
        Set<String> seen = new HashSet<>();
        byte[] buffer = new byte[64 * 1024];
        long total = 0;
        int entries = 0;
        int files = 0;
        List<String> paths = new ArrayList<>();
        Long manifestFiles = null;
        String settings = null;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(source))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++entries > limits.entries) throw new InvalidBackupException("too many entries");
                String name = entry.getName();
                // 디렉터리 항목도 허용하지 않는다. 이 앱이 만든 백업에는 파일 항목만 있다.
                if (entry.isDirectory() || !seen.add(name)) throw new InvalidBackupException("bad entry");
                if (MANIFEST.equals(name) || SETTINGS.equals(name)) {
                    byte[] bytes = readSmall(zip, limits.jsonBytes, buffer);
                    total += bytes.length;
                    if (total > limits.totalBytes) throw new InvalidBackupException("too large");
                    String text = new String(bytes, StandardCharsets.UTF_8);
                    if (MANIFEST.equals(name)) {
                        manifestFiles = validator.manifestFiles(text);
                    } else {
                        validator.settings(text);
                        settings = text;
                    }
                    continue;
                }
                Matcher match = DATA_ENTRY.matcher(name);
                if (!match.matches() || !isFileName(match.group(2))) throw new InvalidBackupException("bad entry name");
                File target = new File(dataRoot, match.group(1) + File.separator + match.group(2));
                // 이름 검사가 1차 방어이고, 풀리는 실제 위치가 root 안인지 한 번 더 본다.
                if (!target.getCanonicalPath().startsWith(rootPath)) throw new InvalidBackupException("outside root");
                File parent = target.getParentFile();
                if (!parent.mkdirs() && !parent.isDirectory()) throw new IOException("cannot create folder");
                long size = 0;
                try (OutputStream out = new BufferedOutputStream(new FileOutputStream(target))) {
                    int read;
                    while ((read = zip.read(buffer)) > 0) {
                        size += read;
                        total += read;
                        if (size > limits.entryBytes || total > limits.totalBytes) {
                            throw new InvalidBackupException("too large");
                        }
                        out.write(buffer, 0, read);
                    }
                }
                paths.add(match.group(1) + "/" + match.group(2));
                files++;
            }
        } catch (ZipException | EOFException | IllegalArgumentException broken) {
            // 압축이 깨졌거나 도중에 끊긴 파일, 해석할 수 없는 항목 이름.
            throw new InvalidBackupException("broken zip");
        }
        if (manifestFiles == null) throw new InvalidBackupException("no manifest");
        // 항목 경계에서 잘린 zip은 ZipInputStream이 오류 없이 끝내므로 파일 수로 잡는다.
        if (manifestFiles != files) throw new InvalidBackupException("file count mismatch");
        Collections.sort(paths);
        return new Extracted(files, settings, paths);
    }

    private static byte[] readSmall(InputStream in, long max, byte[] buffer) throws IOException, InvalidBackupException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        int read;
        while ((read = in.read(buffer)) > 0) {
            if (out.size() + read > max) throw new InvalidBackupException("json too large");
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    /** 준비 실패와 취소는 임시 폴더만 건드린다. 복구·교체·설정 저장을 하지 않는다. */
    static PreparedRestore prepare(File filesDir, InputStream source, Validator validator, Limits limits)
        throws IOException, InvalidBackupException {
        File root = new File(filesDir, RESTORE_DIR);
        if (root.exists() || new File(filesDir, OLD_DIR).exists() || BackupRestoreTransaction.pending(filesDir)) throw new IOException("restore already pending");
        try {
            return new PreparedRestore(filesDir, extract(source, root, validator, limits), limits);
        } catch (IOException | InvalidBackupException | RuntimeException failure) {
            deleteRecursively(root);
            if (root.exists()) failure.addSuppressed(new IOException("cannot remove restore staging"));
            throw failure;
        }
    }

    static void deleteRecursively(File target) {
        File[] children = target.isDirectory() ? target.listFiles() : null;
        if (children != null) for (File child : children) deleteRecursively(child);
        target.delete();
    }
}
