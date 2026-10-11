package dev.earlydreamer.jhfreader;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Host JVM implementation used only by temporary-directory backup/restore tests. */
final class HostStateMarkerReplacer {
    private HostStateMarkerReplacer() {}

    static void replace(File source, File destination) throws IOException {
        try {
            Files.move(source.toPath(), destination.toPath(),
                StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException failure) {
            throw new IOException("cannot persist restore state", failure);
        }
    }

    static BackupRestoreTransaction transaction(File directory, BackupArchive.SettingsStore settings) {
        return transaction(directory, settings, step -> {});
    }

    static BackupRestoreTransaction transaction(File directory, BackupArchive.SettingsStore settings,
                                                BackupRestoreTransaction.Checkpoint checkpoint) {
        return new BackupRestoreTransaction(directory, settings, checkpoint, HostStateMarkerReplacer::replace);
    }
}
