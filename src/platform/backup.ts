import { Capacitor, registerPlugin } from '@capacitor/core';

interface BackupPlugin {
  export(): Promise<{ saved: boolean; files?: number; bytes?: number }>;
  restore(): Promise<{ restored: boolean; files?: number }>;
}
const Native = registerPlugin<BackupPlugin>('Backup');

export type BackupResult =
  | { kind: 'saved'; files: number }
  | { kind: 'restored'; files: number }
  | { kind: 'cancelled' }
  | { kind: 'invalid' }
  | { kind: 'failed' };

export interface BackupPlatform {
  available(): boolean;
  exportBackup(): Promise<BackupResult>;
  restoreBackup(): Promise<BackupResult>;
}

/** 백업은 안드로이드에서만 쓴다. 실패 코드는 화면 문구로 바꿀 수 있게 종류만 돌려준다. */
export const capacitorBackup: BackupPlatform = {
  available: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  async exportBackup() {
    try {
      const result = await Native.export();
      return result.saved ? { kind: 'saved', files: result.files ?? 0 } : { kind: 'cancelled' };
    } catch {
      return { kind: 'failed' };
    }
  },
  async restoreBackup() {
    try {
      const result = await Native.restore();
      return result.restored
        ? { kind: 'restored', files: result.files ?? 0 }
        : { kind: 'cancelled' };
    } catch (error) {
      const message = (error as { message?: string })?.message;
      return message === 'backup_invalid' ? { kind: 'invalid' } : { kind: 'failed' };
    }
  },
};
