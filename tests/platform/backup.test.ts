import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capacitorBackup } from '../../src/platform/backup';

const native = vi.hoisted(() => ({ isNative: true, platform: 'android' }));
const plugin = vi.hoisted(() => ({ export: vi.fn(), restore: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform,
  },
  registerPlugin: vi.fn(() => plugin),
}));

beforeEach(() => {
  native.isNative = true;
  native.platform = 'android';
  vi.clearAllMocks();
});

describe('capacitorBackup', () => {
  it('안드로이드 앱에서만 available이다', () => {
    expect(capacitorBackup.available()).toBe(true);
    native.platform = 'ios';
    expect(capacitorBackup.available()).toBe(false);
    native.isNative = false;
    native.platform = 'web';
    expect(capacitorBackup.available()).toBe(false);
  });

  it('저장하면 담은 파일 수를, 취소하면 cancelled를 돌려준다', async () => {
    plugin.export.mockResolvedValueOnce({ saved: true, files: 12, bytes: 3400 });
    await expect(capacitorBackup.exportBackup()).resolves.toEqual({ kind: 'saved', files: 12 });
    plugin.export.mockResolvedValueOnce({ saved: true });
    await expect(capacitorBackup.exportBackup()).resolves.toEqual({ kind: 'saved', files: 0 });
    plugin.export.mockResolvedValueOnce({ saved: false });
    await expect(capacitorBackup.exportBackup()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('내보내기 오류는 모두 failed다', async () => {
    plugin.export.mockRejectedValueOnce(new Error('backup_failed'));
    await expect(capacitorBackup.exportBackup()).resolves.toEqual({ kind: 'failed' });
    plugin.export.mockRejectedValueOnce('unexpected');
    await expect(capacitorBackup.exportBackup()).resolves.toEqual({ kind: 'failed' });
  });

  it('복원하면 파일 수를, 취소하면 cancelled를 돌려준다', async () => {
    plugin.restore.mockResolvedValueOnce({ restored: true, files: 7 });
    await expect(capacitorBackup.restoreBackup()).resolves.toEqual({ kind: 'restored', files: 7 });
    plugin.restore.mockResolvedValueOnce({ restored: false });
    await expect(capacitorBackup.restoreBackup()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('backup_invalid는 invalid, 그 밖의 오류는 failed로 바꾼다', async () => {
    plugin.restore.mockRejectedValueOnce(new Error('backup_invalid'));
    await expect(capacitorBackup.restoreBackup()).resolves.toEqual({ kind: 'invalid' });
    plugin.restore.mockRejectedValueOnce(new Error('restore_failed'));
    await expect(capacitorBackup.restoreBackup()).resolves.toEqual({ kind: 'failed' });
    plugin.restore.mockRejectedValueOnce(undefined);
    await expect(capacitorBackup.restoreBackup()).resolves.toEqual({ kind: 'failed' });
  });
});
