import { Capacitor, registerPlugin } from '@capacitor/core';

export type EmbeddingStatus = {
  installed: boolean;
  bytes: number;
  loaded: boolean;
  downloading: boolean;
};

export const EMBEDDING_ERROR_CODES = [
  'busy',
  'cancelled',
  'verify',
  'network',
  'io',
  'not_installed',
  'invalid',
  'engine',
] as const;
export type EmbeddingErrorCode = (typeof EMBEDDING_ERROR_CODES)[number];

/** 네이티브 플러그인의 reject 코드를 담는 오류. 알 수 없는 코드는 engine으로 본다. */
export class EmbeddingError extends Error {
  constructor(readonly code: EmbeddingErrorCode) {
    super(code);
    this.name = 'EmbeddingError';
  }
}

export interface OnDeviceEmbedding {
  /** 네이티브 앱에서만 true */
  available(): boolean;
  status(): Promise<EmbeddingStatus>;
  download(onProgress: (received: number, total: number) => void): Promise<void>;
  cancelDownload(): Promise<void>;
  unload(): Promise<void>;
  remove(): Promise<void>;
  /** 정규화된 256차원 벡터 */
  embed(texts: readonly string[]): Promise<number[][]>;
}

interface OnDeviceEmbeddingPlugin {
  status(): Promise<EmbeddingStatus>;
  download(): Promise<void>;
  cancelDownload(): Promise<void>;
  unload(): Promise<void>;
  remove(): Promise<void>;
  embed(options: { texts: string[] }): Promise<{ vectors: number[][] }>;
  addListener(
    event: 'downloadProgress',
    listener: (data: { received: number; total: number }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

const NativeEmbedding = registerPlugin<OnDeviceEmbeddingPlugin>('OnDeviceEmbedding');

async function native<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const known = EMBEDDING_ERROR_CODES.find((item) => item === code);
    throw new EmbeddingError(known ?? 'engine');
  }
}

export const capacitorEmbedding: OnDeviceEmbedding = {
  available: () => Capacitor.isNativePlatform(),
  status: () => native(() => NativeEmbedding.status()),
  async download(onProgress) {
    // 진행 리스너는 내려받는 동안만 붙였다가 성공이든 실패든 뗀다.
    const handle = await native(() =>
      NativeEmbedding.addListener('downloadProgress', (data) =>
        onProgress(data.received, data.total),
      ),
    );
    try {
      await native(() => NativeEmbedding.download());
    } finally {
      await handle.remove();
    }
  },
  cancelDownload: () => native(() => NativeEmbedding.cancelDownload()),
  unload: () => native(() => NativeEmbedding.unload()),
  remove: () => native(() => NativeEmbedding.remove()),
  async embed(texts) {
    const result = await native(() => NativeEmbedding.embed({ texts: [...texts] }));
    return result.vectors;
  },
};

/** 네이티브가 아닌 곳. 상태는 비어 있고 내려받기와 임베딩은 쓸 수 없다. */
export const noEmbedding: OnDeviceEmbedding = {
  available: () => false,
  status: async () => ({ installed: false, bytes: 0, loaded: false, downloading: false }),
  download: async () => {
    throw new EmbeddingError('engine');
  },
  cancelDownload: async () => {},
  unload: async () => {},
  remove: async () => {},
  embed: async () => {
    throw new EmbeddingError('engine');
  },
};
