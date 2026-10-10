import { describe, expect, it } from 'vitest';
import { StorageError } from '../../src/storage/errors';
import type { PrivateFiles } from '../../src/storage/journal';
import { createNativePrivateFiles } from '../../src/storage/native';
import { createBatchScanStore } from '../../src/translation/batchScanStore';

const RECORD = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const chapter = {
  chapterId: 'n1234ab/1',
  paragraphs: [{ text: 'アルベルトは歩く', ruby: [{ start: 0, end: 5, reading: 'あるべると' }] }],
};

function memoryFiles(options: { remove?: boolean } = {}) {
  const data = new Map<string, string>();
  const files: PrivateFiles = {
    read: async (path) => data.get(path) ?? null,
    write: async (path, text) => {
      data.set(path, text);
    },
    ...(options.remove === false
      ? {}
      : {
          remove: async (path: string) => {
            data.delete(path);
          },
        }),
  };
  return { data, files };
}

describe('범위 스캔 원문 저장소', () => {
  it('쓴 회차를 같은 모양으로 다시 읽는다', async () => {
    const { data, files } = memoryFiles();
    const store = createBatchScanStore(files);

    await store.write(RECORD, 0, chapter);

    expect(data.has(`batches/scan-${RECORD}-0.json`)).toBe(true);
    expect(await store.read(RECORD, 0)).toEqual(chapter);
  });

  it('없는 파일은 null이다', async () => {
    const store = createBatchScanStore(memoryFiles().files);

    expect(await store.read(RECORD, 4)).toBeNull();
  });

  it('형식이 틀리거나 깨진 저장본은 null로 돌려서 그 회차를 다시 받게 한다', async () => {
    const { data, files } = memoryFiles();
    const store = createBatchScanStore(files);
    const path = `batches/scan-${RECORD}-0.json`;

    data.set(path, '{not json');
    expect(await store.read(RECORD, 0)).toBeNull();

    data.set(path, JSON.stringify({ chapterId: 'n1234ab/1', paragraphs: 'x' }));
    expect(await store.read(RECORD, 0)).toBeNull();

    data.set(
      path,
      JSON.stringify({
        chapterId: 'n1234ab/1',
        paragraphs: [{ text: 'ab', ruby: [{ start: 0, end: 9, reading: 'x' }] }],
      }),
    );
    expect(await store.read(RECORD, 0)).toBeNull();
  });

  it('UUID가 아닌 기록 식별자는 StorageError로 거부한다', async () => {
    const store = createBatchScanStore(memoryFiles().files);

    await expect(store.read('../secret', 0)).rejects.toBeInstanceOf(StorageError);
    await expect(store.write('../secret', 0, chapter)).rejects.toBeInstanceOf(StorageError);
    await expect(store.clear('not-a-uuid', 1)).rejects.toBeInstanceOf(StorageError);
  });

  it('clear는 개수만큼의 회차 파일만 지운다', async () => {
    const { data, files } = memoryFiles();
    const store = createBatchScanStore(files);
    for (const index of [0, 1, 2, 3]) await store.write(RECORD, index, chapter);

    await store.clear(RECORD, 3);

    expect([...data.keys()]).toEqual([`batches/scan-${RECORD}-3.json`]);
  });

  it('remove가 없으면 clear는 아무것도 하지 않고, 없는 파일 오류는 무시한다', async () => {
    const plain = memoryFiles({ remove: false });
    const plainStore = createBatchScanStore(plain.files);
    await plainStore.write(RECORD, 0, chapter);
    await expect(plainStore.clear(RECORD, 1)).resolves.toBeUndefined();
    expect(await plainStore.read(RECORD, 0)).toEqual(chapter);

    const failing: PrivateFiles = {
      ...memoryFiles().files,
      remove: async () => {
        throw new Error('missing');
      },
    };
    await expect(createBatchScanStore(failing).clear(RECORD, 2)).resolves.toBeUndefined();
  });
});

describe('안드로이드 개인 저장소 어댑터', () => {
  it('허용 목록을 통과해서 쓴 회차를 다시 읽고 지울 수 있다', async () => {
    const stored = new Map<string, string>();
    const backend = {
      async readFile({ path }: { path: string }) {
        const data = stored.get(path);
        if (data === undefined)
          throw Object.assign(new Error('missing'), { code: 'OS-PLUG-FILE-0008' });
        return { data };
      },
      async writeFile({ path, data }: { path: string; data: string }) {
        stored.set(path, data);
        return { uri: path };
      },
      async readdir() {
        return { files: [] };
      },
      async deleteFile({ path }: { path: string }) {
        stored.delete(path);
      },
    };
    const files = createNativePrivateFiles(
      backend as unknown as Parameters<typeof createNativePrivateFiles>[0],
      () => 'android',
    );
    const store = createBatchScanStore(files);

    await store.write(RECORD, 0, chapter);

    expect(await store.read(RECORD, 0)).toEqual(chapter);
    expect([...stored.keys()]).toEqual([`narou-reader/batches/scan-${RECORD}-0.json`]);

    await store.clear(RECORD, 1);
    expect(await store.read(RECORD, 0)).toBeNull();
  });
});
