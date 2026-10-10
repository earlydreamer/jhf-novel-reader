import { Capacitor, registerPlugin } from '@capacitor/core';
import { validateBackupSnapshot } from '../storage/backupValidation';
import { StorageError } from '../storage/errors';
import { nativeStorageGate, type NativeStorageGate } from '../storage/native';
import { check } from '../storage/validation';

export interface BackupPlugin {
  export(): Promise<{ saved: boolean; files?: number; bytes?: number }>;
  prepareRestore(): Promise<
    | { prepared: false }
    | {
        prepared: true;
        token: string;
        files: number;
        settings: string | null;
      }
  >;
  listRestoreFiles(options: { token: string; offset: number }): Promise<{
    paths: string[];
    nextOffset: number | null;
  }>;
  readRestoreFile(options: { token: string; path: string }): Promise<{ text: string | null }>;
  commitRestore(options: { token: string }): Promise<{ restored: true; files: number }>;
  abortRestore(options: { token: string }): Promise<unknown>;
}
const Native = registerPlugin<BackupPlugin>('Backup');

export type BackupResult =
  | { kind: 'saved'; files: number }
  | { kind: 'restored'; files: number }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'failed' }
  | { kind: 'reload_required' };

export interface BackupPlatform {
  available(): boolean;
  exportBackup(): Promise<BackupResult>;
  restoreBackup(): Promise<BackupResult>;
}

function failureResult(error: unknown): BackupResult {
  if ((error as { message?: string })?.message === 'restore_restart_required')
    return { kind: 'reload_required' };
  if (
    error instanceof StorageError &&
    ['invalid', 'corrupt', 'unsupported_schema'].includes(error.reason)
  )
    return { kind: 'invalid' };
  return (error as { message?: string })?.message === 'backup_invalid'
    ? { kind: 'invalid' }
    : { kind: 'failed' };
}

/** Native prepares immutable bytes; only this validated application view may commit them. */
export function createBackupPlatform(
  plugin: BackupPlugin,
  gate: NativeStorageGate = nativeStorageGate,
): BackupPlatform {
  return {
    available: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
    async exportBackup() {
      try {
        const result = await plugin.export();
        return result.saved ? { kind: 'saved', files: result.files ?? 0 } : { kind: 'cancelled' };
      } catch {
        return { kind: 'failed' };
      }
    },
    async restoreBackup() {
      let resume: (() => void) | undefined;
      let token: string | undefined;
      let commitStarted = false;
      let result: BackupResult;
      try {
        resume = await gate.pause();
        const prepared = await plugin.prepareRestore();
        if (!prepared.prepared) result = { kind: 'cancelled' };
        else {
          token = prepared.token;
          check(typeof token === 'string' && token.length > 0);
          check(
            Number.isSafeInteger(prepared.files) &&
              prepared.files >= 0 &&
              prepared.files <= 200_000,
          );
          check(prepared.settings === null || typeof prepared.settings === 'string');
          const paths: string[] = [];
          let offset = 0;
          while (true) {
            const page = await plugin.listRestoreFiles({ token, offset });
            check(
              Array.isArray(page.paths) &&
                page.paths.length <= 256 &&
                page.paths.every((path) => typeof path === 'string'),
            );
            paths.push(...page.paths);
            check(paths.length <= prepared.files);
            if (page.nextOffset === null) break;
            check(
              Number.isSafeInteger(page.nextOffset) &&
                page.nextOffset > offset &&
                page.nextOffset === paths.length,
            );
            offset = page.nextOffset;
          }
          check(paths.length === prepared.files);
          const sessionToken = token;
          await validateBackupSnapshot({
            paths,
            settings: prepared.settings,
            async read(path) {
              const value = await plugin.readRestoreFile({ token: sessionToken, path });
              if (value.text !== null && typeof value.text !== 'string')
                throw new StorageError('io');
              return value.text;
            },
          });
          commitStarted = true;
          const committed = await plugin.commitRestore({ token });
          if (committed.restored !== true || committed.files !== prepared.files)
            throw new StorageError('io');
          result = { kind: 'restored', files: committed.files };
        }
      } catch (error) {
        result = commitStarted ? { kind: 'reload_required' } : failureResult(error);
      }
      if (!commitStarted && result.kind !== 'reload_required') {
        try {
          if (token) await plugin.abortRestore({ token });
          resume?.();
        } catch {
          // A native session may still own staging. Keep this runtime parked;
          // the UI reloads and explains that a full app restart may be required.
          result = { kind: 'reload_required' };
        }
      }
      // Never release old-state writers after commit dispatch, even on bridge rejection.
      return result;
    },
  };
}

export const capacitorBackup = createBackupPlatform(Native);
