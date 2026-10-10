import { describe, expect, it, vi } from 'vitest';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import {
  EmbeddingError,
  type EmbeddingStatus,
  type OnDeviceEmbedding,
} from '../../src/platform/embedding';
import type { ReadingSettings } from '../../src/storage/settings';

const MB = 1048576;
const MODEL_BYTES = 164626432;
const VERIFY_MESSAGE = '내려받은 판정 모델이 올바르지 않아 지웠어요. 다시 시도해 주세요.';
const NETWORK_MESSAGE = '판정 모델을 내려받지 못했어요. 연결을 확인하고 다시 시도해 주세요.';
const REMOVE_MESSAGE = '판정 모델을 지우지 못했어요. 다시 시도해 주세요.';

const absent: EmbeddingStatus = { installed: false, bytes: 0, loaded: false, downloading: false };
const present: EmbeddingStatus = {
  installed: true,
  bytes: MODEL_BYTES,
  loaded: false,
  downloading: false,
};

type Progress = (received: number, total: number) => void;

/** 가짜 OnDeviceEmbedding. 기본은 내려받기가 바로 성공하고 상태를 설치됨으로 바꾼다. */
function fakePort(overrides: Partial<OnDeviceEmbedding> & { initial?: EmbeddingStatus } = {}) {
  let installed = (overrides.initial ?? absent).installed;
  const port = {
    available: vi.fn(() => true),
    status: vi.fn(async (): Promise<EmbeddingStatus> => (installed ? present : absent)),
    download: vi.fn(async (_onProgress: Progress) => {
      installed = true;
    }),
    cancelDownload: vi.fn(async () => {}),
    unload: vi.fn(async () => {}),
    remove: vi.fn(async () => {
      installed = false;
    }),
    embed: vi.fn(async (_texts: readonly string[]) => [] as number[][]),
    /** 커스텀 내려받기가 파일을 만든 뒤 상태 조회가 설치됨을 보이게 한다. */
    setInstalled: (value: boolean) => {
      installed = value;
    },
    ...overrides,
  };
  return port;
}

type FakePort = ReturnType<typeof fakePort>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function openApp(
  options: {
    embedding?: FakePort;
    saved?: Partial<ReadingSettings>;
    onTermDecisionChange?: (enabled: boolean) => void;
  } = {},
) {
  const saveReadingSettings = vi.fn(async (_value: ReadingSettings) => {});
  const dependencies: RenewalDependencies = {
    embedding: options.embedding,
    onTermDecisionChange: options.onTermDecisionChange,
    settings: {
      readReadingSettings: async () => ({
        schemaVersion: 2,
        selection: null,
        fontSize: 18,
        ...options.saved,
      }),
      saveReadingSettings,
    },
  };
  const controller = createRenewalController(dependencies);
  await controller.initialize();
  if (options.embedding)
    await vi.waitFor(() => expect(controller.getSnapshot().embeddingModel).not.toBeNull());
  return { controller, saveReadingSettings };
}

describe('기기 판정 모델 상태 복원', () => {
  it('네이티브 임베딩이 있을 때만 쓸 수 있고 상태는 읽은 뒤에 채운다', async () => {
    expect(createRenewalController().getSnapshot()).toMatchObject({
      embeddingAvailable: false,
      onDeviceEmbedding: false,
      embeddingModel: null,
    });
    expect(
      createRenewalController({ embedding: fakePort({ available: () => false }) }).getSnapshot()
        .embeddingAvailable,
    ).toBe(false);

    const { controller } = await openApp({ embedding: fakePort() });
    expect(controller.getSnapshot()).toMatchObject({
      embeddingAvailable: true,
      onDeviceEmbedding: false,
      embeddingModel: { installed: false, bytes: 0, downloading: false },
    });
  });

  it('설치되지 않았는데 켜진 토글이 저장돼 있으면 끄고 저장을 고친다', async () => {
    const { controller, saveReadingSettings } = await openApp({
      embedding: fakePort(),
      saved: { onDeviceEmbedding: true },
    });
    expect(controller.getSnapshot().onDeviceEmbedding).toBe(false);
    await vi.waitFor(() => expect(saveReadingSettings).toHaveBeenCalled());
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('onDeviceEmbedding');
  });

  it('설치된 모델이면 저장된 토글을 그대로 둔다', async () => {
    const { controller, saveReadingSettings } = await openApp({
      embedding: fakePort({ initial: present }),
      saved: { onDeviceEmbedding: true },
    });
    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: true,
      embeddingModel: { installed: true, bytes: MODEL_BYTES },
    });
    expect(saveReadingSettings).not.toHaveBeenCalled();
  });
});

describe('기기 판정 모델 켜기', () => {
  it('설치돼 있으면 내려받지 않고 토글만 켜서 저장한다', async () => {
    const embedding = fakePort({ initial: present });
    const { controller, saveReadingSettings } = await openApp({ embedding });

    await controller.enableOnDeviceEmbedding();

    expect(embedding.download).not.toHaveBeenCalled();
    expect(controller.getSnapshot().onDeviceEmbedding).toBe(true);
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).toMatchObject({ onDeviceEmbedding: true });
  });

  it('설치 전에 켜면 진행률을 알리고 성공하면 모델과 토글을 갱신해 저장한다', async () => {
    const gate = deferred();
    const embedding: FakePort = fakePort({
      download: vi.fn(async (onProgress: Progress) => {
        onProgress(50 * MB, MODEL_BYTES);
        await gate.promise;
        embedding.setInstalled(true);
      }),
    });
    const { controller, saveReadingSettings } = await openApp({ embedding });

    const pending = controller.enableOnDeviceEmbedding();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().embeddingModel).toMatchObject({
        downloading: true,
        progress: { received: 50 * MB, total: MODEL_BYTES },
      }),
    );
    expect(controller.getSnapshot().onDeviceEmbedding).toBe(false);

    gate.resolve();
    await pending;

    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: true,
      embeddingModel: { installed: true, downloading: false },
    });
    expect(controller.getSnapshot().embeddingModel?.progress).toBeUndefined();
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).toMatchObject({ onDeviceEmbedding: true });
  });

  it('취소로 끝나면 오류 없이 토글을 끈 채 둔다', async () => {
    const embedding = fakePort({
      download: vi.fn(async () => {
        throw new EmbeddingError('cancelled');
      }),
    });
    const { controller, saveReadingSettings } = await openApp({ embedding });

    await controller.enableOnDeviceEmbedding();

    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: false,
      embeddingModel: { installed: false, downloading: false },
    });
    expect(controller.getSnapshot().embeddingModel?.error).toBeUndefined();
    expect(saveReadingSettings).not.toHaveBeenCalled();
  });

  it('검증에 실패하면 지웠다는 안내를 남기고 토글을 끈다', async () => {
    const embedding = fakePort({
      download: vi.fn(async () => {
        throw new EmbeddingError('verify');
      }),
    });
    const { controller } = await openApp({ embedding });

    await controller.enableOnDeviceEmbedding();

    expect(controller.getSnapshot().onDeviceEmbedding).toBe(false);
    expect(controller.getSnapshot().embeddingModel?.error).toBe(VERIFY_MESSAGE);
    expect(controller.getSnapshot().embeddingModel?.downloading).toBe(false);
  });

  it('그 밖의 실패는 연결을 확인하라는 안내를 남긴다', async () => {
    const embedding = fakePort({
      download: vi.fn(async () => {
        throw new EmbeddingError('network');
      }),
    });
    const { controller } = await openApp({ embedding });

    await controller.enableOnDeviceEmbedding();

    expect(controller.getSnapshot().onDeviceEmbedding).toBe(false);
    expect(controller.getSnapshot().embeddingModel?.error).toBe(NETWORK_MESSAGE);
  });

  it('임베딩을 쓸 수 없으면 아무 일도 하지 않는다', async () => {
    const embedding = fakePort({ available: () => false });
    const { controller } = await openApp({ embedding });

    await controller.enableOnDeviceEmbedding();

    expect(embedding.download).not.toHaveBeenCalled();
    expect(controller.getSnapshot().onDeviceEmbedding).toBe(false);
  });
});

describe('기기 판정 모델 중단·끄기·지우기', () => {
  it('중단 버튼은 받는 중인 내려받기를 취소하고 토글을 끈 채 둔다', async () => {
    let fail: (() => void) | null = null;
    const embedding = fakePort({
      download: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = () => reject(new EmbeddingError('cancelled'));
          }),
      ),
      cancelDownload: vi.fn(async () => fail?.()),
    });
    const { controller } = await openApp({ embedding });

    const pending = controller.enableOnDeviceEmbedding();
    await vi.waitFor(() => expect(controller.getSnapshot().embeddingModel?.downloading).toBe(true));

    await controller.cancelEmbeddingDownload();
    await pending;

    expect(embedding.cancelDownload).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: false,
      embeddingModel: { downloading: false },
    });
    expect(controller.getSnapshot().embeddingModel?.error).toBeUndefined();
  });

  it('끄면 파일을 지우지 않고 판정 모델을 내리며 토글을 저장한다', async () => {
    const embedding = fakePort({ initial: present });
    const { controller, saveReadingSettings } = await openApp({
      embedding,
      saved: { onDeviceEmbedding: true },
    });

    await controller.disableOnDeviceEmbedding();

    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: false,
      embeddingModel: { installed: true },
    });
    expect(embedding.unload).toHaveBeenCalledTimes(1);
    expect(embedding.remove).not.toHaveBeenCalled();
    expect(embedding.cancelDownload).not.toHaveBeenCalled();
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('onDeviceEmbedding');
  });

  it('받는 중에 끄면 내려받기를 취소하고 오류 없이 끈 상태가 된다', async () => {
    let fail: (() => void) | null = null;
    const embedding = fakePort({
      download: vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = () => reject(new EmbeddingError('cancelled'));
          }),
      ),
      cancelDownload: vi.fn(async () => fail?.()),
    });
    const { controller } = await openApp({ embedding });

    const pending = controller.enableOnDeviceEmbedding();
    await vi.waitFor(() => expect(controller.getSnapshot().embeddingModel?.downloading).toBe(true));

    await controller.disableOnDeviceEmbedding();
    await pending;

    expect(embedding.cancelDownload).toHaveBeenCalledTimes(1);
    expect(embedding.unload).toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: false,
      embeddingModel: { downloading: false },
    });
    expect(controller.getSnapshot().embeddingModel?.error).toBeUndefined();
  });

  it('받는 중에 끈 뒤 내려받기가 성공해도 토글은 다시 켜지지 않는다', async () => {
    const gate = deferred();
    const embedding = fakePort({
      download: vi.fn(async () => {
        await gate.promise;
      }),
    });
    const { controller } = await openApp({ embedding });

    const pending = controller.enableOnDeviceEmbedding();
    await vi.waitFor(() => expect(controller.getSnapshot().embeddingModel?.downloading).toBe(true));
    await controller.disableOnDeviceEmbedding();

    gate.resolve();
    await pending;

    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: false,
      embeddingModel: { downloading: false },
    });
  });

  it('지우면 모델 파일을 지우고 토글을 끈다', async () => {
    const embedding = fakePort({ initial: present });
    const { controller, saveReadingSettings } = await openApp({
      embedding,
      saved: { onDeviceEmbedding: true },
    });

    await controller.removeEmbeddingModel();

    expect(embedding.remove).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: false,
      embeddingModel: { installed: false, bytes: 0 },
    });
    expect(saveReadingSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty('onDeviceEmbedding');
  });

  it('지우기에 실패하면 안내를 남기고 설치 상태와 토글을 그대로 둔다', async () => {
    const embedding = fakePort({
      initial: present,
      remove: vi.fn(async () => {
        throw new EmbeddingError('io');
      }),
    });
    const { controller } = await openApp({
      embedding,
      saved: { onDeviceEmbedding: true },
    });

    await controller.removeEmbeddingModel();

    expect(controller.getSnapshot()).toMatchObject({
      onDeviceEmbedding: true,
      embeddingModel: { installed: true, error: REMOVE_MESSAGE },
    });
  });
});

describe('기기 판정 문 동기화', () => {
  it('설치된 모델을 저장된 토글로 복원하면 판정 문을 한 번 켠다', async () => {
    const onTermDecisionChange = vi.fn();
    await openApp({
      embedding: fakePort({ initial: present }),
      saved: { onDeviceEmbedding: true },
      onTermDecisionChange,
    });

    expect(onTermDecisionChange.mock.calls).toEqual([[true]]);
  });

  it('설치되지 않은 저장 토글은 판정 문을 켜지 않는다', async () => {
    const onTermDecisionChange = vi.fn();
    await openApp({
      embedding: fakePort(),
      saved: { onDeviceEmbedding: true },
      onTermDecisionChange,
    });

    expect(onTermDecisionChange).not.toHaveBeenCalled();
  });

  it('켜기·끄기·지우기에 맞춰 바꾸고 같은 값은 다시 부르지 않는다', async () => {
    const onTermDecisionChange = vi.fn();
    const { controller } = await openApp({
      embedding: fakePort({ initial: present }),
      onTermDecisionChange,
    });

    await controller.enableOnDeviceEmbedding();
    await controller.enableOnDeviceEmbedding();
    controller.changeAutoTranslate(false);
    await controller.disableOnDeviceEmbedding();
    await controller.disableOnDeviceEmbedding();
    await controller.enableOnDeviceEmbedding();
    await controller.removeEmbeddingModel();

    expect(onTermDecisionChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('내려받기가 끝나 켜지면 판정 문을 켜고, 실패하면 켜지 않는다', async () => {
    const onTermDecisionChange = vi.fn();
    const { controller } = await openApp({ embedding: fakePort(), onTermDecisionChange });
    await controller.enableOnDeviceEmbedding();
    expect(onTermDecisionChange.mock.calls).toEqual([[true]]);

    const failing = vi.fn();
    const failed = await openApp({
      embedding: fakePort({
        download: vi.fn(async () => {
          throw new EmbeddingError('network');
        }),
      }),
      onTermDecisionChange: failing,
    });
    await failed.controller.enableOnDeviceEmbedding();
    expect(failing).not.toHaveBeenCalled();
  });
});
