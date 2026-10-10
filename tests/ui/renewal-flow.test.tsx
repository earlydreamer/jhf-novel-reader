// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Application } from '../../src/app/Application';
import * as controllers from '../../src/app/renewalController';
import type { RenewalDependencies } from '../../src/app/renewalController';
import { ReaderError } from '../../src/contracts';
import type { CompletedTranslation, ModelChoice, WorkPage } from '../../src/contracts/reading';
import { capacitorShell } from '../../src/platform/shell';
import { StorageError } from '../../src/storage/errors';
import type { ReadingBackground } from '../../src/storage/settings';

function chooseShellMenu(item: string) {
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

function revealReaderBars() {
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
}

function chooseReaderMenu(item: string) {
  revealReaderBars();
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

// 이 파일의 기존 생명주기 검증은 사용자가 자동 시작을 끈 수동 모드에서 실행한다.
function manualController(dependencies?: RenewalDependencies) {
  const controller = controllers.createRenewalController(dependencies);
  controller.changeAutoTranslate(false);
  const initialize = controller.initialize;
  controller.initialize = async () => {
    await initialize();
    controller.changeAutoTranslate(false);
  };
  return controller;
}

const chapters = [1, 2].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
}));
const page: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters,
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};
const saved: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'saved-v1',
  source: {
    ...chapters[0]!,
    sourceHash: 'hash',
    paragraphs: [{ id: 'source-1', text: '原文', ruby: [] }],
    prevUrl: null,
    nextUrl: chapters[1]!.canonicalUrl,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>原文</p>',
  },
  text: '저장된 한국어 본문',
  blocks: [{ id: 'translated-1', text: '저장된 한국어 본문' }],
  createdAt: '2026-10-04T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'connection',
    modelId: 'fixture-hymt2',
    contractVersion: 'plain-v1',
    promptVersion: 'hymt2-ko-v1',
    languageDirection: 'ja-ko',
  },
};
function fixture(hasSaved = false) {
  const generate = vi.fn(async () => ({ text: '새 한국어', finishReason: 'complete' as const }));
  const dependencies: RenewalDependencies = {
    library: {
      saveWorkPage: vi.fn(async () => {}),
      listWorkIds: vi.fn(async () => [page.workId]),
      readWork: vi.fn(async () => [page]),
      listRecent: vi.fn(async () => []),
      listVersions: vi.fn(async (chapterId) =>
        hasSaved && chapterId === saved.source.chapterId ? [saved] : [],
      ),
      readVersion: vi.fn(async (id) => (id === saved.versionId ? saved : null)),
      commitVersion: vi.fn(async () => {}),
      savePosition: vi.fn(async () => {}),
      readPosition: vi.fn(async () => null),
    },
    source: { getWorkPage: vi.fn(async () => page), getChapter: vi.fn(async () => saved.source) },
    connect: vi.fn(async () => ({
      listModels: vi.fn(async () => [
        { id: 'fixture-hymt2', displayName: 'HyMT2 synthetic', supportsGeneration: true },
      ]),
      translateChapter: generate,
    })),
  };
  return { dependencies, generate };
}
async function setup(hasSaved = false, translationAvailable = false) {
  expect(controllers).toHaveProperty('createRenewalController');
  const value = fixture(hasSaved);
  if (translationAvailable) {
    Object.assign(value.dependencies, {
      startTranslation: async (
        chapter: Parameters<NonNullable<RenewalDependencies['startTranslation']>>[0],
        model: Parameters<NonNullable<RenewalDependencies['startTranslation']>>[1],
        session: Parameters<NonNullable<RenewalDependencies['startTranslation']>>[2],
      ) => {
        await session.translateChapter(
          {
            token: {
              requestId: 'fixture-request',
              chapterId: chapter.chapterId,
              settingsRevision: model.connection.revision,
            },
            source: saved.source,
            languageDirection: 'ja-ko',
            contractVersion: 'plain-v1',
            promptVersion: 'hymt2-ko-v1',
          },
          new AbortController().signal,
        );
      },
    });
  }
  const controller = manualController(value.dependencies);
  render(<Application controller={controller} />);
  await screen.findByRole('heading', { name: '서재' });
  fireEvent.click(screen.getByRole('button', { name: 'URL로 열기' }));
  fireEvent.change(screen.getByLabelText('작품 또는 회차 URL'), {
    target: { value: page.canonicalUrl },
  });
  fireEvent.click(screen.getByRole('button', { name: '열기' }));
  await screen.findByRole('heading', { name: page.title });
  return { ...value, controller };
}
afterEach(cleanup);

describe('automatic chapter dispatch and position writes', () => {
  it('continues from this work only after verifying recent ownership and restores its exact position', async () => {
    const value = fixture(true);
    const position = {
      workId: page.workId,
      chapterId: saved.source.chapterId,
      versionId: saved.versionId,
      blockId: 'translated-1',
      offset: 37,
    };
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn(async () => [
        {
          workId: page.workId,
          chapterId: saved.source.chapterId,
          versionId: saved.versionId,
          updatedAt: '2026-10-08T00:00:00Z',
        },
      ]),
      readPosition: vi.fn(async () => position),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('verified'));
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('reader');
    expect(controller.getSnapshot().version?.versionId).toBe(saved.versionId);
    expect(controller.getSnapshot().position).toEqual(position);
    controller.dispose();
  });

  it('refreshes the actual recent chapter after opening a saved chapter and returning to its TOC', async () => {
    const value = fixture(true);
    const savedB: CompletedTranslation = {
      ...saved,
      versionId: 'saved-v2',
      source: { ...saved.source, ...chapters[1]! } as CompletedTranslation['source'],
    };
    const recentA = {
      workId: page.workId,
      chapterId: saved.source.chapterId,
      versionId: saved.versionId,
      updatedAt: '2026-10-08T00:00:00Z',
    };
    const recentB = {
      workId: page.workId,
      chapterId: savedB.source.chapterId,
      versionId: savedB.versionId,
      updatedAt: '2026-10-08T00:01:00Z',
    };
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn(async () => [recentA]),
      listVersions: vi.fn(async (chapterId: string) =>
        chapterId === saved.source.chapterId
          ? [saved]
          : chapterId === savedB.source.chapterId
            ? [savedB]
            : [],
      ),
      readVersion: vi.fn(async (versionId: string) =>
        versionId === saved.versionId ? saved : versionId === savedB.versionId ? savedB : null,
      ),
      readPosition: vi.fn(async () => null),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('verified'));
    await controller.selectChapter(chapters[1]!);
    expect(controller.getSnapshot().route.kind).toBe('reader');
    expect(controller.getSnapshot().version?.versionId).toBe(savedB.versionId);
    vi.mocked(value.dependencies.library!.listRecent).mockResolvedValue([recentB]);
    controller.back();
    await vi.waitFor(() =>
      expect(controller.getSnapshot().workRecent).toMatchObject({
        status: 'verified',
        chapterId: savedB.source.chapterId,
        versionId: savedB.versionId,
      }),
    );
    expect(controller.getSnapshot().route.kind).toBe('work');
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('reader');
    expect(controller.getSnapshot().version?.versionId).toBe(savedB.versionId);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('treats a recent source mismatch as absent and selects the loaded minimum ordinal', async () => {
    const value = fixture(true);
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn(async () => [
        {
          workId: page.workId,
          chapterId: chapters[1]!.chapterId,
          versionId: saved.versionId,
          updatedAt: '2026-10-08T00:00:00Z',
        },
      ]),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('none'));
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('reader');
    expect(controller.getSnapshot().chapter?.chapterId).toBe(chapters[0]!.chapterId);
    controller.dispose();
  });

  it.each([
    ['workId', { workId: 'other-work' }],
    ['chapterId', { chapterId: 'n9999aa/1' }],
    ['versionId', { versionId: 'other-version' }],
    ['blockId', { blockId: 'missing-block' }],
  ])(
    'classifies a stored position with a foreign %s as an error without fallback',
    async (_field, mismatch) => {
      const value = fixture(true);
      const position = {
        workId: page.workId,
        chapterId: saved.source.chapterId,
        versionId: saved.versionId,
        blockId: 'translated-1',
        offset: 5,
        ...mismatch,
      };
      Object.assign(value.dependencies.library!, {
        listRecent: vi.fn(async () => [
          {
            workId: page.workId,
            chapterId: saved.source.chapterId,
            versionId: saved.versionId,
            updatedAt: '2026-10-08T00:00:00Z',
          },
        ]),
        readPosition: vi.fn(async () => position),
      });
      const controller = manualController(value.dependencies);
      await controller.openWork(page.canonicalUrl);
      await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('error'));
      await controller.continueReadingFromWork(page.workId);
      expect(controller.getSnapshot().route.kind).toBe('work');
      expect(controller.getSnapshot().chapter).toBeNull();
      expect(value.generate).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it.each([
    [
      'recent list read',
      (value: ReturnType<typeof fixture>) => {
        vi.mocked(value.dependencies.library!.listRecent).mockRejectedValue(
          new Error('recent read failed'),
        );
      },
    ],
    [
      'version read',
      (value: ReturnType<typeof fixture>) => {
        vi.mocked(value.dependencies.library!.listRecent).mockResolvedValue([
          {
            workId: page.workId,
            chapterId: saved.source.chapterId,
            versionId: saved.versionId,
            updatedAt: '2026-10-08T00:00:00Z',
          },
        ]);
        vi.mocked(value.dependencies.library!.readVersion).mockRejectedValue(
          new Error('version read failed'),
        );
      },
    ],
  ])('classifies %s failures as error without fallback or translation', async (_name, failRead) => {
    const value = fixture(true);
    failRead(value);
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('error'));
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('work');
    expect(controller.getSnapshot().chapter).toBeNull();
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('ignores a late missing version after leaving the work route', async () => {
    const value = fixture(true);
    const recent = [
      {
        workId: page.workId,
        chapterId: saved.source.chapterId,
        versionId: saved.versionId,
        updatedAt: '2026-10-08T00:00:00Z',
      },
    ];
    let resolveLate!: (version: CompletedTranslation | null) => void;
    const lateRead = new Promise<CompletedTranslation | null>((resolve) => {
      resolveLate = resolve;
    });
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn(async () => recent),
      readVersion: vi.fn().mockResolvedValueOnce(saved).mockReturnValueOnce(lateRead),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('verified'));
    const continuing = controller.continueReadingFromWork(page.workId);
    await vi.waitFor(() =>
      expect(value.dependencies.library!.readVersion).toHaveBeenCalledTimes(2),
    );
    controller.navigate({ kind: 'home' });
    resolveLate(null);
    await continuing;
    expect(controller.getSnapshot().route.kind).toBe('home');
    expect(controller.getSnapshot().chapter).toBeNull();
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('uses ordinal 101 as the first loaded chapter for a partial TOC fallback', async () => {
    const value = fixture();
    const chapter101 = { ...chapters[0]!, chapterId: `${page.workId}/101`, ordinal: 101 };
    const partialPage: WorkPage = {
      ...page,
      chapters: [chapter101],
      nextPageUrl: `${page.canonicalUrl}?p=2`,
      complete: false,
    };
    vi.mocked(value.dependencies.source!.getWorkPage).mockResolvedValue(partialPage);
    Object.assign(value.dependencies.library!, { listRecent: vi.fn(async () => []) });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('none'));
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('translation');
    expect(controller.getSnapshot().chapter?.chapterId).toBe(chapter101.chapterId);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('retries recent verification without navigation or translation, then permits the next continue action', async () => {
    const value = fixture(true);
    const recentRow = [
      {
        workId: page.workId,
        chapterId: saved.source.chapterId,
        versionId: saved.versionId,
        updatedAt: '2026-10-08T00:00:00Z',
      },
    ];
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn(async () => recentRow),
      readPosition: vi
        .fn()
        .mockRejectedValueOnce(new Error('storage read failed'))
        .mockResolvedValue(null),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('error'));
    const originalRoute = controller.getSnapshot().route;
    const originalChapter = controller.getSnapshot().chapter;
    const readPosition = value.dependencies.library!.readPosition as ReturnType<typeof vi.fn>;
    expect(value.generate).not.toHaveBeenCalled();
    await controller.retryWorkRecent(page.workId);
    expect(readPosition).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().workRecent?.status).toBe('verified');
    expect(controller.getSnapshot().route).toEqual(originalRoute);
    expect(controller.getSnapshot().chapter).toEqual(originalChapter);
    expect(value.generate).not.toHaveBeenCalled();
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('reader');
    expect(controller.getSnapshot().version?.versionId).toBe(saved.versionId);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('does not let a late recent read overwrite a newer visit to the same work', async () => {
    const value = fixture(true);
    let releaseOld!: (
      rows: { workId: string; chapterId: string; versionId: string; updatedAt: string }[],
    ) => void;
    const oldRead = new Promise<
      { workId: string; chapterId: string; versionId: string; updatedAt: string }[]
    >((resolve) => {
      releaseOld = resolve;
    });
    const recent = [
      {
        workId: page.workId,
        chapterId: saved.source.chapterId,
        versionId: saved.versionId,
        updatedAt: '2026-10-08T00:00:00Z',
      },
    ];
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn().mockReturnValueOnce(oldRead).mockResolvedValue(recent),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    controller.navigate({ kind: 'home' });
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('verified'));
    releaseOld([]);
    await Promise.resolve();
    expect(controller.getSnapshot().workRecent?.status).toBe('verified');
    const verifiedRecent = controller.getSnapshot().workRecent;
    expect(verifiedRecent?.status).toBe('verified');
    if (verifiedRecent?.status === 'verified')
      expect(verifiedRecent.versionId).toBe(saved.versionId);
    controller.dispose();
  });

  it('keeps the CTA disabled while recent verification is loading, then uses the none fallback', async () => {
    const value = fixture();
    let releaseRecent!: (rows: []) => void;
    const pendingRecent = new Promise<[]>((resolve) => {
      releaseRecent = resolve;
    });
    Object.assign(value.dependencies.library!, { listRecent: vi.fn(async () => []) });
    const controller = manualController(value.dependencies);
    await controller.initialize();
    vi.mocked(value.dependencies.library!.listRecent).mockReturnValueOnce(pendingRecent);
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    const continueButton = screen.getByRole('button', { name: '이어서 읽기' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(continueButton);
    expect(controller.getSnapshot().route.kind).toBe('work');
    releaseRecent([]);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('none'));
    fireEvent.click(continueButton);
    await vi.waitFor(() => expect(controller.getSnapshot().route.kind).toBe('translation'));
    expect(controller.getSnapshot().chapter?.chapterId).toBe(chapters[0]!.chapterId);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('opens a verified version at its beginning when its valid stored position is null', async () => {
    const value = fixture(true);
    Object.assign(value.dependencies.library!, {
      listRecent: vi.fn(async () => [
        {
          workId: page.workId,
          chapterId: saved.source.chapterId,
          versionId: saved.versionId,
          updatedAt: '2026-10-08T00:00:00Z',
        },
      ]),
      readPosition: vi.fn(async () => null),
    });
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    await vi.waitFor(() => expect(controller.getSnapshot().workRecent?.status).toBe('verified'));
    await controller.continueReadingFromWork(page.workId);
    expect(controller.getSnapshot().route.kind).toBe('reader');
    expect(controller.getSnapshot().version?.versionId).toBe(saved.versionId);
    expect(controller.getSnapshot().position).toBeNull();
    controller.dispose();
  });

  it('defaults to automatic start but never starts on initialization, catalog or opening a saved version', async () => {
    const value = fixture(true);
    const start = vi.fn(async () => {});
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      startTranslation: start,
    });
    await controller.initialize();
    expect(controller.getSnapshot().autoTranslate).toBe(true);
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:1234',
    });
    await controller.checkConnection();
    controller.chooseModel('fixture-hymt2');
    await controller.continueReading(saved.versionId);
    expect(start).not.toHaveBeenCalled();
    await controller.selectChapter(chapters[1]!);
    expect(start).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it('drops automatic intent when navigation changes during restored connection verification', async () => {
    const value = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = vi.fn(async () => {});
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      startTranslation: start,
      settings: {
        readReadingSettings: async () => ({
          schemaVersion: 2,
          fontSize: 18,
          selection: {
            connection: {
              provider: 'openai-compatible',
              baseUrl: 'http://localhost:1234',
              revision: 1,
            },
            modelId: 'fixture-hymt2',
          },
        }),
        saveReadingSettings: async () => {},
      },
      connect: async () => {
        await gate;
        return {
          listModels: async () => [
            { id: 'fixture-hymt2', displayName: 'fixture', supportsGeneration: true },
          ],
          translateChapter: value.generate,
        };
      },
    });
    await controller.initialize();
    await controller.openWork(page.canonicalUrl);
    const selection = controller.selectChapter(chapters[1]!);
    await vi.waitFor(() => expect(controller.getSnapshot().catalogStatus).toBe('checking'));
    controller.navigate({ kind: 'home' });
    release();
    await selection;
    expect(start).not.toHaveBeenCalled();
    expect(controller.getSnapshot().route.kind).toBe('home');
    controller.dispose();
  });
  it('waits for actual settlement before starting the newly selected unsaved chapter', async () => {
    const value = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const start = vi
      .fn()
      .mockImplementationOnce(() => gate)
      .mockResolvedValue(undefined);
    const controller = controllers.createRenewalController({
      ...value.dependencies,
      startTranslation: start,
    });
    await controller.initialize();
    await controller.openWork(page.canonicalUrl);
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:1234',
    });
    await controller.checkConnection();
    controller.chooseModel('fixture-hymt2');
    await controller.selectChapter(chapters[0]!);
    await controller.selectChapter(chapters[1]!);
    expect(start).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect(start.mock.calls[1]![0].chapterId).toBe(chapters[1]!.chapterId);
    controller.dispose();
  });
  it('coalesces scroll bursts into the in-flight position and the latest position', async () => {
    const value = fixture(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi
      .fn()
      .mockImplementationOnce(() => gate)
      .mockResolvedValue(undefined);
    value.dependencies.library!.savePosition = write;
    const controller = controllers.createRenewalController(value.dependencies);
    await controller.initialize();
    await controller.continueReading(saved.versionId);
    const pending = Array.from({ length: 50 }, (_, offset) =>
      controller.savePosition(saved.blocks[0]!.id, offset),
    );
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await Promise.all(pending);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0].offset).toBe(49);
    controller.dispose();
  });
  it('keeps a successful position write successful when refreshing recent reads fails', async () => {
    const value = fixture(true);
    const recent = [
      {
        workId: page.workId,
        chapterId: saved.source.chapterId,
        versionId: saved.versionId,
        updatedAt: saved.createdAt,
      },
    ];
    const listRecent = vi.fn(async () => recent);
    Object.assign(value.dependencies.library!, { listRecent });
    const controller = manualController(value.dependencies);
    await controller.initialize();
    await controller.continueReading(saved.versionId);
    listRecent.mockRejectedValueOnce(new Error('recent read failure'));

    await expect(controller.savePosition(saved.blocks[0]!.id, 23)).resolves.toBeUndefined();

    expect(value.dependencies.library!.savePosition).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().position?.offset).toBe(23);
    expect(controller.getSnapshot().recent).toEqual(recent);
    expect(controller.getSnapshot().error).toBe('최근 읽은 목록을 새로 고치지 못했어요.');
    controller.dispose();
  });
});
describe('renewal first reading screens', () => {
  function restoredFixture(hasSaved = false) {
    const value = fixture(hasSaved);
    Object.assign(value.dependencies, {
      settings: {
        readReadingSettings: async () => ({
          schemaVersion: 2,
          fontSize: 18,
          selection: {
            connection: {
              provider: 'openai-compatible',
              baseUrl: 'http://192.0.2.1:1234',
              revision: 1,
            },
            modelId: 'fixture-hymt2',
          },
        }),
        saveReadingSettings: vi.fn(async () => {}),
      },
      startTranslation: vi.fn(async () => {}),
    });
    return value;
  }
  it('checks the restored model on selecting an unsaved chapter, without generation', async () => {
    const value = restoredFixture();
    const controller = manualController(value.dependencies);
    await controller.initialize();
    expect(value.dependencies.connect).not.toHaveBeenCalled();
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    fireEvent.click(screen.getByRole('button', { name: '2화 제목' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeEnabled(),
    );
    expect(controller.getSnapshot().selectedModelId).toBe('fixture-hymt2');
    expect(value.dependencies.connect).toHaveBeenCalledTimes(1);
    expect(value.dependencies.startTranslation).not.toHaveBeenCalled();
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('keeps saved chapter reading offline and checks only when moving to an unsaved chapter', async () => {
    const value = restoredFixture(true);
    const controller = manualController(value.dependencies);
    await controller.initialize();
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    expect(value.dependencies.connect).not.toHaveBeenCalled();
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '다음 화' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeEnabled(),
    );
    expect(value.dependencies.connect).toHaveBeenCalledTimes(1);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('retains the restored model on connection failure and retries from the chapter screen', async () => {
    const { ReaderError } = await import('../../src/contracts');
    const value = restoredFixture();
    const connect = value.dependencies.connect as ReturnType<typeof vi.fn>;
    connect.mockRejectedValueOnce(new ReaderError('connection'));
    const controller = manualController(value.dependencies);
    await controller.initialize();
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    fireEvent.click(screen.getByRole('button', { name: '2화 제목' }));
    await waitFor(() => expect(controller.getSnapshot().catalogStatus).toBe('connection'));
    expect(controller.getSnapshot().selectedModelId).toBe('fixture-hymt2');
    expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '연결 다시 확인' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeEnabled(),
    );
    expect(connect).toHaveBeenCalledTimes(2);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('shows connection progress without allowing duplicate checks or reopening a departed chapter', async () => {
    const value = restoredFixture();
    let release!: () => void;
    const listing = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connect = value.dependencies.connect as ReturnType<typeof vi.fn>;
    connect.mockImplementation(async () => {
      await listing;
      return {
        listModels: async () => [
          { id: 'fixture-hymt2', displayName: 'HyMT2 synthetic', supportsGeneration: true },
        ],
        translateChapter: value.generate,
      };
    });
    const controller = manualController(value.dependencies);
    await controller.initialize();
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    fireEvent.click(screen.getByRole('button', { name: '2화 제목' }));
    await screen.findByText('저장된 연결의 서버와 모델 목록을 확인하고 있어요.');
    expect(screen.getByRole('button', { name: '연결 다시 확인' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeDisabled();
    chooseReaderMenu('서재로 가기');
    release();
    await waitFor(() => expect(controller.getSnapshot().catalogStatus).toBe('connected'));
    expect(controller.getSnapshot().route.kind).toBe('home');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('does not replace a restored missing model with another available model', async () => {
    const value = restoredFixture();
    (value.dependencies.connect as ReturnType<typeof vi.fn>).mockResolvedValue({
      listModels: async () => [
        { id: 'different-model', displayName: 'Other model', supportsGeneration: true },
      ],
      translateChapter: value.generate,
    });
    const controller = manualController(value.dependencies);
    await controller.initialize();
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    fireEvent.click(screen.getByRole('button', { name: '2화 제목' }));
    await waitFor(() => expect(controller.getSnapshot().catalogStatus).toBe('model_missing'));
    expect(controller.getSnapshot().selectedModelId).toBeNull();
    expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeDisabled();
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('open_work_does_not_translate', async () => {
    const value = await setup();
    expect(value.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByRole('heading', { name: '1화 제목' });
    expect(value.generate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeDisabled();
  });
  it('saved_chapter_opens_without_settings', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    expect(value.dependencies.connect).not.toHaveBeenCalled();
    expect(value.generate).not.toHaveBeenCalled();
  });
  it('settings_returns_to_selected_chapter', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: '2화 제목' }));
    await screen.findByRole('heading', { name: '2화 제목' });
    fireEvent.click(screen.getByRole('button', { name: '연결 설정' }));
    await screen.findByRole('heading', { name: '설정' });
    fireEvent.click(screen.getByRole('button', { name: '뒤로 가기' }));
    expect(screen.getByRole('heading', { name: '2화 제목' })).toBeVisible();
  });
  it('reader_has_no_settings_panel', async () => {
    await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    expect(screen.queryByLabelText('API 기본 주소')).toBeNull();
    expect(
      screen.getByRole('region', { name: '몰입형 리더' }).querySelector('.nr-toolbar'),
    ).toHaveAttribute('inert');
    revealReaderBars();
    expect(screen.getByRole('button', { name: '목차' })).toBeVisible();
  });
  it('no_budget_or_prefetch_controls', async () => {
    await setup();
    chooseShellMenu('설정');
    expect(screen.queryByText(/예산|미리 번역/)).toBeNull();
    expect(screen.queryByLabelText('모델 이름')).toBeNull();
    expect(screen.getByRole('button', { name: '모델 선택 전' })).toHaveTextContent('선택 전');
  });
  it('uses_real_catalog_selection_and_explicit_translation_action', async () => {
    const value = await setup(false, true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByRole('heading', { name: '1화 제목' });
    fireEvent.click(screen.getByRole('button', { name: '연결 설정' }));
    fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: '192.168.1.2' } });
    fireEvent.change(screen.getByLabelText('포트'), { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: '연결 확인하기' }));
    await screen.findByText('모델 목록을 확인했어요. 번역 호환성은 아직 확인하지 않았어요.');
    fireEvent.click(screen.getByRole('button', { name: '모델 선택 전' }));
    fireEvent.click(screen.getByRole('radio', { name: 'HyMT2 synthetic' }));
    fireEvent.click(screen.getByRole('button', { name: '뒤로 가기' }));
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '이 화 번역하기' }));
    await waitFor(() => expect(value.generate).toHaveBeenCalledTimes(1));
  });
});

describe('renewal controller boundaries', () => {
  it('ignores model list responses from a superseded endpoint', async () => {
    const value = fixture();
    let release:
      | ((
          value: readonly { id: string; displayName: string; supportsGeneration: boolean }[],
        ) => void)
      | undefined;
    const listing = new Promise<
      readonly { id: string; displayName: string; supportsGeneration: boolean }[]
    >((resolve) => {
      release = resolve;
    });
    const controller = manualController({
      ...value.dependencies,
      connect: async () => ({ listModels: async () => listing, translateChapter: value.generate }),
    });
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    const pending = controller.checkConnection();
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.3:1234/v1',
    });
    release?.([{ id: 'stale', displayName: 'Stale', supportsGeneration: true }]);
    await pending;
    expect(controller.getSnapshot().models).toEqual([]);
    expect(controller.getSnapshot().selectedModelId).toBeNull();
  });
  it('does not replace a missing selected model on catalog refresh', async () => {
    const value = fixture();
    let models = [{ id: 'first', displayName: 'First', supportsGeneration: true }];
    const controller = manualController({
      ...value.dependencies,
      connect: async () => ({ listModels: async () => models, translateChapter: value.generate }),
    });
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection();
    controller.chooseModel('first');
    models = [{ id: 'different', displayName: 'Different', supportsGeneration: true }];
    await controller.checkConnection();
    expect(controller.getSnapshot().selectedModelId).toBeNull();
    expect(controller.getSnapshot().catalogStatus).toBe('model_missing');
  });
  it('navigation prevents a late work response from replacing the current screen', async () => {
    const value = fixture();
    let release: ((value: WorkPage) => void) | undefined;
    const loading = new Promise<WorkPage>((resolve) => {
      release = resolve;
    });
    const controller = manualController({
      ...value.dependencies,
      source: { getWorkPage: async () => loading, getChapter: async () => saved.source },
    });
    const pending = controller.openWork(page.canonicalUrl);
    controller.navigate({ kind: 'settings' });
    release?.(page);
    await pending;
    expect(controller.getSnapshot().route).toEqual({ kind: 'settings' });
    expect(controller.getSnapshot().busy).toBe(false);
  });
  it('same chapter selection repeated while loading pushes one route', async () => {
    const value = fixture();
    const controller = manualController(value.dependencies);
    await controller.openWork(page.canonicalUrl);
    const first = controller.selectChapter(chapters[0]!);
    const second = controller.selectChapter(chapters[0]!);
    await Promise.all([first, second]);
    controller.back();
    expect(controller.getSnapshot().route.kind).toBe('work');
  });
  it('production is unavailable rather than fabricated source or catalog data', async () => {
    const controller = manualController();
    render(<Application controller={controller} />);
    expect(screen.getByRole('button', { name: '작품 찾기' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '작품 찾기' }));
    expect(
      await screen.findByText('작품 찾기를 아직 사용할 수 없어요. URL로 열어 주세요.'),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '설정' }));
    expect(screen.getByRole('button', { name: '연결 확인하기' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('아직 사용할 수 없어요');
    expect(controller.getSnapshot().models).toEqual([]);
  });
});

describe('renewal reading affordances', () => {
  it('shows a changed-source notice and an explicit refresh action without generating automatically', async () => {
    const value = fixture(true);
    const controller = manualController({
      ...value.dependencies,
      source: {
        getWorkPage: async () => page,
        getChapter: async () => ({
          ...saved.source,
          captureKind: 'fetched' as const,
          fetchedAt: '2026-10-05T00:00:00Z',
          sourceHash: 'changed-source',
          rawHtml: '<p>변경된 원문</p>',
        }),
      },
    });
    render(<Application controller={controller} />);
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);

    expect(await screen.findByText('원문이 바뀌었어요.')).toBeVisible();
    expect(screen.getByRole('button', { name: '새 원문으로 번역하기' })).toBeVisible();
    expect(value.generate).not.toHaveBeenCalled();
  });
  it('shows saved status in the work contents before choosing a chapter', async () => {
    await setup(true);
    expect(
      screen.getByRole('button', { name: '1화 제목' }).closest('.nr-list-item'),
    ).toHaveTextContent('저장됨');
  });
  it('reader defaults to 18px and clamps font controls to 10 through 48px', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    const article = await screen.findByRole('article', { name: '번역 본문' });
    expect(
      (article.parentElement as HTMLElement).style.getPropertyValue('--nr-reading-font-rem'),
    ).toBe('1.125');
    value.controller.changeFontSize(49);
    expect(value.controller.getSnapshot().fontSize).toBe(18);
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '보기 설정' }));
    for (let index = 0; index < 3; index += 1)
      fireEvent.click(screen.getByRole('button', { name: '글자 크기 키우기' }));
    expect(
      (article.parentElement as HTMLElement).style.getPropertyValue('--nr-reading-font-rem'),
    ).toBe('1.5');
  });
  it('returns to the top when no translation position has been saved', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    const article = await screen.findByRole('article', { name: '번역 본문' });
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '원문 보기' }));
    article.scrollTop = 300;
    fireEvent.scroll(article);
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '번역 보기' }));
    expect(article.scrollTop).toBe(0);
    expect(value.dependencies.library!.savePosition).not.toHaveBeenCalled();
  });
  it('returns to the latest translation position after scrolling the original', async () => {
    const offsetTop = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(20);
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    const article = await screen.findByRole('article', { name: '번역 본문' });
    article.scrollTop = 357;
    fireEvent.scroll(article);
    await waitFor(() =>
      expect(value.dependencies.library!.savePosition).toHaveBeenCalledWith(
        expect.objectContaining({ blockId: 'translated-1', offset: 337 }),
      ),
    );

    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '원문 보기' }));
    article.scrollTop = 0;
    fireEvent.scroll(article);
    expect(value.dependencies.library!.savePosition).toHaveBeenCalledTimes(1);
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '번역 보기' }));
    offsetTop.mockRestore();
    expect(article.scrollTop).toBe(357);
  });
  it('next unsaved chapter enters a waiting screen without a model request', async () => {
    const value = await setup(true);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '다음 화' }));
    await screen.findByRole('heading', { name: '2화 제목' });
    expect(screen.getByRole('button', { name: '이 화 번역하기' })).toBeDisabled();
    expect(value.generate).not.toHaveBeenCalled();
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '목차로 돌아가기' }));
    expect(screen.getByRole('heading', { name: page.title })).toBeVisible();
    expect(screen.queryByText('저장된 한국어 본문')).toBeNull();
  });
});

describe('renewal connection failures', () => {
  it.each([
    ['auth', 'auth'],
    ['connection', 'connection'],
    ['model_list', 'model_list'],
    ['storage', 'storage'],
    ['timeout_unknown', 'connection'],
  ] as const)('distinguishes %s without exposing server errors', async (code, status) => {
    const { ReaderError } = await import('../../src/contracts');
    const value = fixture();
    const controller = manualController({
      ...value.dependencies,
      connect: async () => {
        throw new ReaderError(code);
      },
    });
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection('secret-not-in-snapshot');
    expect(controller.getSnapshot().catalogStatus).toBe(status);
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('secret-not-in-snapshot');
  });
  it('shows an actionable secure-storage failure in connection settings', async () => {
    const { StorageError } = await import('../../src/storage/errors');
    const value = fixture();
    const controller = manualController({
      ...value.dependencies,
      connect: async () => {
        throw new StorageError('secure');
      },
    });
    controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'http://192.0.2.1/v1' });
    await controller.checkConnection('private-secret-canary');
    controller.navigate({ kind: 'settings' });
    render(<Application controller={controller} />);
    expect(
      screen.getByText(/인증값을 기기의 보안 저장소에 저장하거나 읽지 못했어요/),
    ).toBeVisible();
    expect(
      screen.queryByText('모델 목록을 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.'),
    ).toBeNull();
    expect(screen.getByLabelText('인증값 (선택)')).toHaveValue('');
    expect(document.body.textContent).not.toContain('private-secret-canary');
    expect(value.generate).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('invalid endpoint is a connection error rather than a model catalog error', async () => {
    const value = fixture();
    const controller = manualController(value.dependencies);
    controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'not-a-url' });
    await controller.checkConnection();
    expect(controller.getSnapshot().catalogStatus).toBe('connection');
    expect(value.dependencies.connect).not.toHaveBeenCalled();
  });
  it('refreshing a model list prevents translation through the stale session', async () => {
    const value = fixture();
    let release: (() => void) | undefined;
    let calls = 0;
    const start = vi.fn(async () => {});
    const controller = manualController({
      ...value.dependencies,
      startTranslation: start,
      connect: async () => {
        calls++;
        if (calls > 1)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return {
          listModels: async () => [{ id: 'model', displayName: 'Model', supportsGeneration: true }],
          translateChapter: value.generate,
        };
      },
    });
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection();
    controller.chooseModel('model');
    const refreshing = controller.checkConnection();
    await controller.translate();
    expect(start).not.toHaveBeenCalled();
    release?.();
    await refreshing;
  });
});

describe('renewal connection check result', () => {
  const url = 'http://192.168.1.2:1234/v1';
  const generation = { id: 'generation', displayName: 'Generation', supportsGeneration: true };
  const embedding = { id: 'embedding', displayName: 'Embedding', supportsGeneration: false };

  it('returns the generation model count without a problem on success', async () => {
    const value = fixture();
    const controller = manualController({
      ...value.dependencies,
      connect: async () => ({
        listModels: async () => [
          generation,
          embedding,
          { id: 'second', displayName: 'Second', supportsGeneration: true },
        ],
        translateChapter: value.generate,
      }),
    });
    controller.changeConnection({ provider: 'openai-compatible', baseUrl: url });

    await expect(controller.checkConnection()).resolves.toEqual({
      kind: 'done',
      status: 'connected',
      modelCount: 2,
      problem: null,
    });
    expect(controller.getSnapshot().catalogProblem).toBeNull();
  });

  it.each([
    [
      'invalid address',
      () => new ReaderError('connection'),
      'connection',
      { reason: 'invalid_url' },
    ],
    [
      'network timeout',
      () => new ReaderError('timeout_unknown', 'unknown'),
      'connection',
      { reason: 'network' },
    ],
    [
      'HTTP 404',
      () => new ReaderError('connection', 'received', 404),
      'connection',
      { reason: 'http', httpStatus: 404 },
    ],
    [
      'redirect',
      () => new ReaderError('connection', 'received', 302),
      'connection',
      { reason: 'redirect', httpStatus: 302 },
    ],
    [
      'mismatched response address',
      () => new ReaderError('connection', 'received', 200),
      'connection',
      { reason: 'redirect' },
    ],
    [
      'HTTP 503',
      () => new ReaderError('connection', 'received', 503),
      'connection',
      { reason: 'http', httpStatus: 503 },
    ],
    [
      'auth rejected',
      () => new ReaderError('auth', 'received', 401),
      'auth',
      { reason: 'auth_rejected', httpStatus: 401 },
    ],
    ['auth missing', () => new ReaderError('auth'), 'auth', { reason: 'auth_missing' }],
    ['secure storage', () => new StorageError('secure'), 'storage', { reason: 'storage' }],
    [
      'bad model list',
      () => new ReaderError('model_list', 'received'),
      'model_list',
      { reason: 'bad_response' },
    ],
    ['unexpected error', () => new Error('synthetic'), 'model_list', { reason: 'unknown' }],
  ] as const)(
    'classifies the %s failure without exposing the address or secret',
    async (_label, error, status, problem) => {
      const value = fixture();
      const controller = manualController({
        ...value.dependencies,
        connect: async () => {
          throw error();
        },
      });
      controller.changeConnection({ provider: 'openai-compatible', baseUrl: url });

      await expect(controller.checkConnection('private-secret-canary')).resolves.toEqual({
        kind: 'done',
        status,
        modelCount: 0,
        problem,
      });
      expect(controller.getSnapshot().catalogProblem).toEqual(problem);
      expect(JSON.stringify(controller.getSnapshot())).not.toContain('private-secret-canary');
    },
  );

  it('rejects a malformed address before sending a request', async () => {
    const connect = vi.fn();
    const controller = manualController({ connect });
    controller.changeConnection({ provider: 'openai-compatible', baseUrl: 'not a url' });

    await expect(controller.checkConnection()).resolves.toEqual({
      kind: 'done',
      status: 'connection',
      modelCount: 0,
      problem: { reason: 'invalid_url' },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)(
    'reports a superseded check when a newer connection replaces a %s',
    async (mode) => {
      const value = fixture();
      let settle!: (models: readonly ModelChoice[]) => void;
      let fail!: (error: unknown) => void;
      const listing = new Promise<readonly ModelChoice[]>((resolve, reject) => {
        settle = resolve;
        fail = reject;
      });
      const controller = manualController({
        ...value.dependencies,
        connect: async () => ({
          listModels: async () => listing,
          translateChapter: value.generate,
        }),
      });
      controller.changeConnection({ provider: 'openai-compatible', baseUrl: url });
      const pending = controller.checkConnection();
      controller.changeConnection({
        provider: 'openai-compatible',
        baseUrl: 'http://192.168.1.3:1234/v1',
      });
      if (mode === 'success') settle([generation]);
      else fail(new ReaderError('connection', 'received', 503));

      await expect(pending).resolves.toEqual({ kind: 'superseded' });
    },
  );

  it('reports why a check was skipped instead of starting one', async () => {
    await expect(controllers.createRenewalController().checkConnection()).resolves.toEqual({
      kind: 'skipped',
      reason: 'unavailable',
    });

    const connect = vi.fn(async () => {
      throw new ReaderError('connection', 'received', 500);
    });
    const waiting = controllers.createRenewalController({
      connect,
      lifecycle: { isActive: async () => true, subscribe: async () => async () => {} },
    });
    await expect(waiting.checkConnection()).resolves.toEqual({
      kind: 'skipped',
      reason: 'not_ready',
    });

    const batch = {
      active: true,
      initialize: async () => {},
      setForeground: () => {},
      getSnapshot: () => ({ active: true }),
      subscribe: () => () => {},
      clearWork: () => true,
      dispose: () => {},
    } as unknown as NonNullable<RenewalDependencies['batch']>;
    const busy = controllers.createRenewalController({ connect, batch });
    await expect(busy.checkConnection()).resolves.toEqual({ kind: 'skipped', reason: 'busy' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('clears the failure reason when a new check starts or the connection changes', async () => {
    const value = fixture();
    let attempts = 0;
    const controller = manualController({
      ...value.dependencies,
      connect: async () => {
        attempts += 1;
        if (attempts === 1) throw new ReaderError('auth', 'received', 401);
        return new Promise<never>(() => {});
      },
    });
    controller.changeConnection({ provider: 'openai-compatible', baseUrl: url });
    await controller.checkConnection();
    expect(controller.getSnapshot().catalogProblem).toEqual({
      reason: 'auth_rejected',
      httpStatus: 401,
    });

    void controller.checkConnection();
    expect(controller.getSnapshot().catalogProblem).toBeNull();

    controller.changeConnection({ provider: 'openai-compatible', baseUrl: url });
    expect(controller.getSnapshot().catalogProblem).toBeNull();
  });
});

describe('route restoration across works', () => {
  it('restores the original reader contents after visiting another work', async () => {
    const value = fixture(true);
    const otherPage: WorkPage = {
      ...page,
      workId: 'n9999ab',
      title: '다른 작품',
      canonicalUrl: 'https://ncode.syosetu.com/n9999ab/',
      chapters: [],
    };
    const controller = manualController({
      ...value.dependencies,
      source: {
        getWorkPage: async (url) => (url === otherPage.canonicalUrl ? otherPage : page),
        getChapter: async () => saved.source,
      },
    });
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);
    controller.navigate({ kind: 'home' });
    await controller.openWork(otherPage.canonicalUrl);
    controller.back();
    controller.back();
    expect(controller.getSnapshot().route).toEqual({ kind: 'reader', versionId: saved.versionId });
    expect(controller.getSnapshot().work?.workId).toBe(page.workId);
    expect(controller.getSnapshot().chapter?.chapterId).toBe(saved.source.chapterId);
    render(<Application controller={controller} />);
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '목차' }));
    expect(
      screen.getByRole('button', { name: '1화 제목' }).closest('.nr-list-item'),
    ).toHaveTextContent('저장됨');
    expect(controller.getSnapshot().savedChapterIds).toEqual([saved.source.chapterId]);
  });
});

describe('review P1: translation ownership survives navigation', () => {
  function deferredRequest() {
    let resolve: (() => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return {
      promise,
      resolve: () => resolve?.(),
      reject: () => reject?.(new Error('Synthetic late failure')),
    };
  }
  async function activeFixture() {
    const value = fixture();
    const request = deferredRequest();
    const start = vi.fn(async () => request.promise);
    const controller = manualController({
      ...value.dependencies,
      startTranslation: start,
    });
    await controller.openWork(page.canonicalUrl);
    await controller.selectChapter(chapters[0]!);
    controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.2:1234/v1',
    });
    await controller.checkConnection();
    controller.chooseModel('fixture-hymt2');
    const pending = controller.translate();
    return { controller, request, pending, start };
  }
  it.each([0, 1])(
    'prevents a second dispatch after selecting chapter index %s while the first request is unresolved',
    async (index) => {
      const value = await activeFixture();
      value.controller.back();
      await value.controller.selectChapter(chapters[index]!);
      const second = value.controller.translate();
      const dispatchCount = value.start.mock.calls.length;
      expect(value.controller.getSnapshot().translationActive).toBe(true);
      value.request.resolve();
      await Promise.all([value.pending, second]);
      expect(dispatchCount).toBe(1);
      expect(value.controller.getSnapshot().translationActive).toBe(false);
    },
  );
  it('ignores a late failure from the previous chapter', async () => {
    const value = await activeFixture();
    value.controller.back();
    await value.controller.selectChapter(chapters[1]!);
    value.request.reject();
    await value.pending;
    expect(value.controller.getSnapshot().chapter?.chapterId).toBe(chapters[1]!.chapterId);
    expect(value.controller.getSnapshot().translation.phase).toBe('idle');
    expect(value.controller.getSnapshot().translation.error).toBeUndefined();
  });
  it('ignores a late failure after settings changed and the chapter was reselected', async () => {
    const value = await activeFixture();
    value.controller.changeConnection({
      provider: 'openai-compatible',
      baseUrl: 'http://192.168.1.3:1234/v1',
    });
    value.controller.back();
    await value.controller.selectChapter(chapters[0]!);
    value.request.reject();
    await value.pending;
    expect(value.controller.getSnapshot().translation.phase).toBe('idle');
    expect(value.controller.getSnapshot().translation.error).toBeUndefined();
  });
  it('reports a failure for the currently owned request and releases the latch', async () => {
    const value = await activeFixture();
    value.request.reject();
    await value.pending;
    expect(value.controller.getSnapshot().translation.phase).toBe('failed');
    expect(value.controller.getSnapshot().translationActive).toBe(false);
  });
  it('releases the global latch only after settlement so the next explicit action can run', async () => {
    const value = await activeFixture();
    value.controller.back();
    await value.controller.selectChapter(chapters[1]!);
    value.request.resolve();
    await value.pending;
    await value.controller.translate();
    expect(value.start).toHaveBeenCalledTimes(2);
  });
});

it('shows each skipped legacy record without blocking saved reading or exposing its endpoint', async () => {
  const value = fixture(true);
  const controller = manualController({
    ...value.dependencies,
    migrateLegacy: async () => ({
      migrated: 1,
      skipped: 3,
      warnings: [
        { cacheKey: 'v1-' + 'a'.repeat(64), reason: 'unfinished' },
        { cacheKey: 'v1-' + 'b'.repeat(64), reason: 'unreadable' },
        { cacheKey: 'v1-' + 'c'.repeat(64), reason: 'missing' },
      ],
    }),
  });
  render(<Application controller={controller} />);
  const summary = await screen.findByText('이전 데이터 일부를 찾지 못했어요');
  const notice = summary.closest('details')!;
  fireEvent.click(summary);
  expect(notice).toHaveTextContent('기록 aaaaaaaaaaaa: 완료되지 않은 번역이에요.');
  expect(notice).toHaveTextContent('기록 bbbbbbbbbbbb: 손상되었거나 지원하지 않는 형식이에요.');
  expect(notice).toHaveTextContent('기록 cccccccccccc: 저장 파일을 찾을 수 없어요.');
  await controller.continueReading(saved.versionId);
  expect(await screen.findByText(saved.text)).toBeVisible();
  expect(value.generate).not.toHaveBeenCalled();
  controller.dispose();
});

describe('review P2: library-only continuation restores saved metadata', () => {
  it('shows the saved marker after cold-start offline continue reading and contents navigation', async () => {
    const value = fixture(true);
    const controller = manualController({ library: value.dependencies.library });
    render(<Application controller={controller} />);
    await controller.continueReading(saved.versionId);
    await screen.findByText(saved.text);
    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '목차' }));
    expect(screen.getByRole('heading', { name: page.title })).toBeVisible();
    expect(
      screen.getByRole('button', { name: '1화 제목' }).closest('.nr-list-item'),
    ).toHaveTextContent('저장됨');
    expect(controller.getSnapshot().savedChapterIds).toEqual([saved.source.chapterId]);
    expect(value.dependencies.connect).not.toHaveBeenCalled();
    expect(value.dependencies.source?.getWorkPage).not.toHaveBeenCalled();
  });
});

describe('reading background follows the reader color scheme (#173)', () => {
  afterEach(() => vi.restoreAllMocks());

  async function openSavedChapter(theme: 'light' | 'dark', background: ReadingBackground) {
    const value = await setup(true);
    const bars = vi.spyOn(capacitorShell, 'setSystemBarsTheme');
    value.controller.changeTheme(theme);
    value.controller.changeReadingBackground(background);
    fireEvent.click(screen.getByRole('button', { name: '1화 제목' }));
    await screen.findByText('저장된 한국어 본문');
    return { ...value, bars };
  }

  it('검정 독서 배경은 앱 테마가 밝아도 리더에서 다크 체계를 쓰고 목차로 나가면 앱 테마로 돌아와요', async () => {
    const value = await openSavedChapter('light', 'black');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(value.bars).toHaveBeenLastCalledWith('dark');

    revealReaderBars();
    fireEvent.click(screen.getByRole('button', { name: '목차' }));
    await screen.findByRole('heading', { name: '합성 작품' });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(value.bars).toHaveBeenLastCalledWith('light');
  });

  it('세피아 독서 배경은 앱 테마가 어두워도 리더에서 라이트 체계를 써요', async () => {
    const value = await openSavedChapter('dark', 'sepia');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(value.bars).toHaveBeenLastCalledWith('light');
  });

  it('theme 독서 배경은 리더에서도 앱 테마를 그대로 써요', async () => {
    const value = await openSavedChapter('dark', 'theme');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(value.bars).toHaveBeenLastCalledWith('dark');
  });
});
