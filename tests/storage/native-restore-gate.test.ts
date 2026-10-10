import { expect, it } from 'vitest';
import {
  createNativeStorageGate,
  createNativePrivateFiles,
  createNativePreferences,
} from '../../src/storage/native';
import { createBatchScanStore } from '../../src/translation/batchScanStore';

function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

it('same-turn pause waits for an already-issued native write', async () => {
  const gate = createNativeStorageGate(),
    pending = deferred();
  let issued = false,
    drained = false;
  const write = gate.run(async () => {
    issued = true;
    await pending.promise;
  });
  const pause = gate.pause().then((resume) => {
    drained = true;
    return resume;
  });
  expect(issued).toBe(true);
  await tick();
  expect(drained).toBe(false);
  pending.finish();
  await write;
  const resume = await pause;
  expect(drained).toBe(true);
  resume();
});

it('parks all native adapter factories, preferences and direct batch cache writes/removes', async () => {
  const gate = createNativeStorageGate(),
    calls: string[] = [];
  const backend = {
    readFile: async () => {
      calls.push('read');
      return { data: '{}' };
    },
    readdir: async () => {
      calls.push('list');
      return { files: [] };
    },
    writeFile: async () => {
      calls.push('write');
      return { uri: '' };
    },
    deleteFile: async () => {
      calls.push('remove');
    },
  };
  const first = createNativePrivateFiles(backend, () => 'android', gate);
  const second = createNativePrivateFiles(backend, () => 'android', gate);
  const preferences = createNativePreferences(
    {
      get: async () => {
        calls.push('get');
        return { value: null };
      },
      set: async () => {
        calls.push('set');
      },
      remove: async () => {
        calls.push('delete-setting');
      },
    },
    () => 'android',
    gate,
  );
  const resume = await gate.pause();
  const scans = createBatchScanStore(second),
    id = '00000000-0000-0000-0000-000000000001';
  const pending = [
    first.read('library/index.0.json'),
    second.write('versions/x.0.json', '{}'),
    first.list!('chapters'),
    preferences.get({ key: 'test' }),
    preferences.set({ key: 'test', value: 'x' }),
    preferences.remove!({ key: 'test' }),
    scans.write(id, 0, { chapterId: 'n1234aa/1', paragraphs: [] }),
    scans.clear(id, 1),
  ];
  await tick();
  expect(calls).toEqual([]);
  resume();
  await Promise.all(pending);
  expect(calls.sort()).toEqual(
    ['read', 'write', 'list', 'get', 'set', 'delete-setting', 'write', 'remove'].sort(),
  );
});

it('rechecks a newly acquired pause before a parked call can dispatch', async () => {
  const gate = createNativeStorageGate(),
    calls: string[] = [];
  const resume = await gate.pause();
  const pending = gate.run(async () => {
    calls.push('write');
  });
  resume();
  const resumeAgain = await gate.pause();
  await tick();
  expect(calls).toEqual([]);
  resumeAgain();
  await pending;
  expect(calls).toEqual(['write']);
});
