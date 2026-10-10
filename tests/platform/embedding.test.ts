import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddingError, capacitorEmbedding, noEmbedding } from '../../src/platform/embedding';

const native = vi.hoisted(() => ({ isNative: true }));
const plugin = vi.hoisted(() => ({
  status: vi.fn(),
  download: vi.fn(),
  cancelDownload: vi.fn(),
  unload: vi.fn(),
  remove: vi.fn(),
  embed: vi.fn(),
  addListener: vi.fn(),
  listeners: new Map<string, (data: unknown) => void>(),
  removed: [] as string[],
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.isNative },
  registerPlugin: vi.fn(() => plugin),
}));

function nativeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  native.isNative = true;
  plugin.listeners.clear();
  plugin.removed.length = 0;
  vi.clearAllMocks();
  plugin.addListener.mockImplementation(
    async (event: string, listener: (data: unknown) => void) => {
      plugin.listeners.set(event, listener);
      return {
        remove: async () => {
          plugin.removed.push(event);
          plugin.listeners.delete(event);
        },
      };
    },
  );
});

describe('capacitorEmbedding', () => {
  it('네이티브 앱에서만 available이다', () => {
    expect(capacitorEmbedding.available()).toBe(true);
    native.isNative = false;
    expect(capacitorEmbedding.available()).toBe(false);
  });

  it('상태 응답을 그대로 돌려준다', async () => {
    plugin.status.mockResolvedValue({
      installed: true,
      bytes: 164626432,
      loaded: false,
      downloading: false,
    });
    await expect(capacitorEmbedding.status()).resolves.toEqual({
      installed: true,
      bytes: 164626432,
      loaded: false,
      downloading: false,
    });
  });

  it('내려받는 동안만 downloadProgress 리스너를 붙이고 끝나면 뗀다', async () => {
    const onProgress = vi.fn();
    plugin.download.mockImplementation(async () => {
      expect(plugin.listeners.has('downloadProgress')).toBe(true);
      plugin.listeners.get('downloadProgress')?.({ received: 10, total: 100 });
    });

    await capacitorEmbedding.download(onProgress);

    expect(onProgress).toHaveBeenCalledWith(10, 100);
    expect(plugin.listeners.has('downloadProgress')).toBe(false);
    expect(plugin.removed).toEqual(['downloadProgress']);
  });

  it('내려받기가 실패해도 진행 리스너를 뗀다', async () => {
    plugin.download.mockRejectedValue(nativeError('network'));

    await expect(capacitorEmbedding.download(() => {})).rejects.toMatchObject({ code: 'network' });
    expect(plugin.removed).toEqual(['downloadProgress']);
  });

  it('네이티브 reject 코드를 EmbeddingError.code로 바꾼다', async () => {
    const codes = [
      'busy',
      'cancelled',
      'verify',
      'network',
      'io',
      'not_installed',
      'invalid',
      'engine',
    ] as const;
    for (const code of codes) {
      plugin.download.mockRejectedValueOnce(nativeError(code));
      const failure = await capacitorEmbedding.download(() => {}).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EmbeddingError);
      expect((failure as EmbeddingError).code).toBe(code);
    }
  });

  it('알 수 없는 네이티브 코드는 engine으로 본다', async () => {
    plugin.embed.mockRejectedValue(nativeError('something_new'));
    const failure = await capacitorEmbedding.embed(['테스트']).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbeddingError);
    expect((failure as EmbeddingError).code).toBe('engine');
  });

  it('임베딩 응답의 벡터를 돌려준다', async () => {
    plugin.embed.mockResolvedValue({ vectors: [[0.5, 0.5]], ms: 3 });
    await expect(capacitorEmbedding.embed(['이름'])).resolves.toEqual([[0.5, 0.5]]);
    expect(plugin.embed).toHaveBeenCalledWith({ texts: ['이름'] });
  });

  it('해제와 파일 삭제 호출을 플러그인에 넘긴다', async () => {
    await capacitorEmbedding.cancelDownload();
    await capacitorEmbedding.unload();
    await capacitorEmbedding.remove();
    expect(plugin.cancelDownload).toHaveBeenCalledTimes(1);
    expect(plugin.unload).toHaveBeenCalledTimes(1);
    expect(plugin.remove).toHaveBeenCalledTimes(1);
  });
});

describe('noEmbedding', () => {
  it('사용할 수 없고 상태는 빈 값이다', async () => {
    expect(noEmbedding.available()).toBe(false);
    await expect(noEmbedding.status()).resolves.toEqual({
      installed: false,
      bytes: 0,
      loaded: false,
      downloading: false,
    });
    await expect(noEmbedding.download(() => {})).rejects.toBeInstanceOf(EmbeddingError);
    await expect(noEmbedding.embed(['이름'])).rejects.toBeInstanceOf(EmbeddingError);
    expect(plugin.download).not.toHaveBeenCalled();
  });
});
