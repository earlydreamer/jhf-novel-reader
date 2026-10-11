import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createBackupPlatform,
  recoverBackupBeforeStartup,
  type BackupPlugin,
} from '../../src/platform/backup';
import { createNativeStorageGate } from '../../src/storage/native';
import { digest } from '../../src/storage/journal';

const native = vi.hoisted(() => ({ isNative: true, platform: 'android' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.isNative,
    getPlatform: () => native.platform,
  },
  registerPlugin: vi.fn(() => ({})),
}));
const settings = JSON.stringify({ schemaVersion: 2, selection: null, fontSize: 18 });
function setup() {
  const stage = new Map<string, string>();
  const live = new Map([['library/index.0.json', 'healthy original']]);
  const gate = createNativeStorageGate();
  const plugin = {
    recoverRestore: vi.fn(async () => ({ ready: true as const })),
    export: vi.fn(async () => ({ saved: true, files: 12 })),
    prepareRestore: vi.fn(async () => ({
      prepared: true as const,
      token: 'one',
      files: stage.size,
      settings,
    })),
    listRestoreFiles: vi.fn(async () => ({ paths: [...stage.keys()], nextOffset: null })),
    readRestoreFile: vi.fn(async ({ path }: { path: string }) => ({
      text: stage.get(path) ?? null,
    })),
    commitRestore: vi.fn(async () => {
      live.clear();
      stage.forEach((v, k) => live.set(k, v));
      return { restored: true as const, files: stage.size };
    }),
    abortRestore: vi.fn(async () => {
      stage.clear();
    }),
  };
  return { stage, live, gate, plugin, backup: createBackupPlatform(plugin, gate) };
}
async function index(f: ReturnType<typeof setup>) {
  const payload = { versions: [], workIds: [], recent: [] },
    generation = 1;
  f.stage.set(
    'library/index.0.json',
    JSON.stringify({
      format: 1,
      generation,
      payload,
      checksum: await digest([1, generation, payload]),
    }),
  );
}
beforeEach(() => {
  native.isNative = true;
  native.platform = 'android';
});

describe('capacitor backup preflight', () => {
  it('requires explicit startup recovery readiness on Android and skips other platforms', async () => {
    const plugin = { recoverRestore: vi.fn(async () => ({ ready: true as const })) };
    await expect(recoverBackupBeforeStartup(plugin)).resolves.toBeUndefined();
    expect(plugin.recoverRestore).toHaveBeenCalledOnce();
    plugin.recoverRestore.mockRejectedValueOnce(new Error('restore_recovery_required'));
    await expect(recoverBackupBeforeStartup(plugin)).rejects.toThrow();
    plugin.recoverRestore.mockResolvedValueOnce({ ready: false } as never);
    await expect(recoverBackupBeforeStartup(plugin)).rejects.toThrow();
    native.isNative = false;
    await expect(recoverBackupBeforeStartup(plugin)).resolves.toBeUndefined();
    expect(plugin.recoverRestore).toHaveBeenCalledTimes(3);
  });
  it('is available only on native Android', () => {
    const f = setup();
    expect(f.backup.available()).toBe(true);
    native.platform = 'ios';
    expect(f.backup.available()).toBe(false);
    native.isNative = false;
    expect(f.backup.available()).toBe(false);
  });
  it('preserves export results and error behavior', async () => {
    const f = setup();
    await expect(f.backup.exportBackup()).resolves.toEqual({ kind: 'saved', files: 12 });
    f.plugin.export.mockResolvedValueOnce({ saved: false, files: 0 });
    await expect(f.backup.exportBackup()).resolves.toEqual({ kind: 'cancelled' });
    f.plugin.export.mockRejectedValueOnce(new Error('error'));
    await expect(f.backup.exportBackup()).resolves.toEqual({ kind: 'failed' });
  });
  it('rejects unusable application data before changing live files or settings', async () => {
    const f = setup();
    f.stage.set('library/index.0.json', 'not JSON');
    f.plugin.prepareRestore.mockResolvedValueOnce({
      prepared: true,
      token: 'one',
      files: 1,
      settings: '{}',
    });
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'invalid' });
    expect([...f.live.values()]).toEqual(['healthy original']);
    expect(f.plugin.commitRestore).not.toHaveBeenCalled();
    expect(f.stage.size).toBe(0);
  });
  it('commits only the validated prepared stage and holds the old runtime frozen', async () => {
    const f = setup();
    await index(f);
    const bytes = [...f.stage];
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'restored', files: 1 });
    expect([...f.live]).toEqual(bytes);
    let resumed = false;
    void f.gate.run(async () => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);
    expect(f.plugin.abortRestore).not.toHaveBeenCalled();
  });
  it('resumes writes after picker cancellation', async () => {
    const f = setup();
    f.plugin.prepareRestore.mockResolvedValueOnce({ prepared: false } as Awaited<
      ReturnType<BackupPlugin['prepareRestore']>
    > as never);
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'cancelled' });
    await f.gate.run(async () => {
      f.live.set('after', 'ok');
    });
    expect(f.live.get('after')).toBe('ok');
  });
  it('does not release parked writes until invalid stage abort has completed', async () => {
    const f = setup();
    f.stage.set('library/index.0.json', 'bad');
    let finishAbort!: () => void;
    f.plugin.abortRestore.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishAbort = resolve;
        }),
    );
    const restoring = f.backup.restoreBackup();
    let written = false;
    const write = f.gate.run(async () => {
      written = true;
    });
    await vi.waitFor(() => expect(finishAbort).toBeTypeOf('function'));
    expect(written).toBe(false);
    finishAbort();
    await restoring;
    await write;
    expect(written).toBe(true);
  });
  it('waits for an already-issued write before preparing restore', async () => {
    const f = setup();
    let finish!: () => void;
    const writing = f.gate.run(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const restoring = f.backup.restoreBackup();
    await Promise.resolve();
    expect(f.plugin.prepareRestore).not.toHaveBeenCalled();
    finish();
    await writing;
    await restoring;
    expect(f.plugin.prepareRestore).toHaveBeenCalledTimes(1);
  });
  it('keeps old writes frozen and requests reload after ambiguous commit rejection', async () => {
    const f = setup();
    await index(f);
    f.plugin.commitRestore.mockImplementationOnce(async () => {
      f.live.clear();
      throw new Error('response lost after replacement');
    });
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'reload_required' });
    let resumed = false;
    void f.gate.run(async () => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);
    expect(f.plugin.abortRestore).not.toHaveBeenCalled();
  });
  it('requests reload without claiming unchanged when stage cleanup fails', async () => {
    const f = setup();
    f.stage.set('library/index.0.json', 'bad');
    f.plugin.abortRestore.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'reload_required' });
    expect(f.plugin.commitRestore).not.toHaveBeenCalled();
  });
  it('maps staged read I/O failure to failure and releases after cleanup', async () => {
    const f = setup();
    await index(f);
    f.plugin.readRestoreFile.mockRejectedValueOnce(new Error('io'));
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'failed' });
    expect([...f.live.values()]).toEqual(['healthy original']);
    await expect(f.gate.run(async () => 'ready')).resolves.toBe('ready');
  });
  it('keeps the runtime parked when preparation cannot clean its native staging', async () => {
    const f = setup();
    f.plugin.prepareRestore.mockRejectedValueOnce(new Error('restore_restart_required'));
    await expect(f.backup.restoreBackup()).resolves.toEqual({ kind: 'reload_required' });
    let resumed = false;
    void f.gate.run(async () => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);
    expect(f.plugin.abortRestore).not.toHaveBeenCalled();
    expect([...f.live.values()]).toEqual(['healthy original']);
  });
});
