// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Application } from '../../src/app/Application';
import { createRenewalController, type RenewalDependencies } from '../../src/app/renewalController';
import type {
  ChapterRef,
  CompletedTranslation,
  ProviderSession,
  WorkPage,
} from '../../src/contracts/reading';
import type {
  GuidanceDraft,
  GuidanceRepository,
  GuidanceTerm,
  WorkGuidance,
} from '../../src/translation/guidance';
import type { TermScanChange, TermScanResult } from '../../src/translation/termScanRun';

type TermScan = NonNullable<RenewalDependencies['termScan']>;

afterEach(cleanup);

const chapters: ChapterRef[] = [1, 2].map((ordinal) => ({
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
const version: CompletedTranslation = {
  schemaVersion: 2,
  versionId: 'saved-1',
  source: {
    ...chapters[0]!,
    sourceHash: 'hash-0',
    paragraphs: [{ id: 'source-0', text: '原文', ruby: [] }],
    prevUrl: null,
    nextUrl: null,
    captureKind: 'fetched',
    fetchedAt: '2026-10-04T00:00:00Z',
    rawHtml: '<p>原文</p>',
  },
  text: '저장된 한국어 본문',
  blocks: [{ id: 'translated-0', text: '저장된 한국어 본문' }],
  createdAt: '2026-10-04T00:00:00Z',
  provenance: {
    provider: 'openai-compatible',
    connectionId: 'connection',
    modelId: 'fixture',
    contractVersion: 'plain-v1',
    promptVersion: 'fixture',
    languageDirection: 'ja-ko',
  },
};

const existing: GuidanceTerm = {
  source: '合成',
  target: '합성',
  aliases: [],
  category: '',
  note: '',
};
const added: GuidanceTerm = {
  source: 'アルベルト',
  target: '알베르트',
  aliases: [],
  category: '인명',
  note: '',
  origin: 'scan',
};
const change: TermScanChange = {
  source: 'アルベルト',
  role: 'new',
  after: '알베르트',
  kind: 'real',
  category: '인명',
  confidence: 'high',
  reason: '근거',
  evidence: [],
};

/** 저장된 용어집 한 벌. 정밀스캔 결과는 이 저장소에 쓰고, 화면은 다시 읽어야 바뀐 내용을 본다. */
function guidanceStore(initial: GuidanceTerm[]): GuidanceRepository {
  let terms = initial;
  return {
    read: vi.fn(async (workId: string): Promise<WorkGuidance> => ({
      schemaVersion: 1,
      workId,
      hash: 'hash',
      terms: terms.map((item) => ({ ...item, aliases: [...item.aliases] })),
      voices: [],
    })),
    save: vi.fn(async (workId: string, draft: GuidanceDraft): Promise<WorkGuidance> => {
      terms = draft.terms;
      return { ...draft, schemaVersion: 1, workId, hash: 'hash' };
    }),
  };
}

/** 스캔이 용어집에 새 항목을 저장하고 그 결과를 돌려주는 가짜 스캔. */
function scanAddingTerm(guidance: GuidanceRepository): TermScan {
  return vi.fn<TermScan>(async ({ workId }) => {
    const current = (await guidance.read(workId))?.terms ?? [];
    await guidance.save(workId, { terms: [...current, added], voices: [] });
    return { applied: [change], confirmed: 0, suggestions: [], partial: false };
  });
}

function fixtureLibrary() {
  return {
    saveWorkPage: vi.fn(async () => {}),
    listWorkIds: vi.fn(async () => [page.workId]),
    readWork: vi.fn(async () => [page]),
    listRecent: vi.fn(async () => []),
    listVersions: vi.fn(async (chapterId: string) =>
      chapterId === chapters[0]!.chapterId ? [version] : [],
    ),
    readVersion: vi.fn(async () => version),
    commitVersion: vi.fn(async () => {}),
    savePosition: vi.fn(async () => {}),
    readPosition: vi.fn(async () => null),
    removeWork: vi.fn(async () => ({
      removed: false,
      cleanupComplete: false,
      remainingInventory: [],
    })),
  } as never;
}

async function connectedApp(
  deps: Partial<RenewalDependencies>,
  provider: 'openai-compatible' | 'gemini' = 'openai-compatible',
) {
  const session: ProviderSession = {
    listModels: async () => [
      { id: 'local', displayName: 'local', supportsGeneration: true, contextTokens: 8192 },
    ],
    translateChapter: vi.fn(async () => ({ text: '', finishReason: 'complete' as const })),
  };
  const app = createRenewalController({
    library: fixtureLibrary(),
    source: { getWorkPage: async () => page, getChapter: async () => version.source } as never,
    connect: async () => session,
    ...deps,
  });
  await app.initialize();
  app.changeConnection({
    provider,
    baseUrl:
      provider === 'gemini' ? 'https://generativelanguage.googleapis.com' : 'http://localhost:1234',
  });
  await app.checkConnection();
  app.chooseModel('local');
  await app.openWork(page.canonicalUrl);
  return app;
}

it('OpenAI 호환 연결에서는 더보기 메뉴에 용어 정밀스캔을 두고 누르면 대화상자를 연다', async () => {
  const app = await connectedApp({
    guidance: guidanceStore([existing]),
    termScan: vi.fn<TermScan>(),
  });
  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어 정밀스캔' }));
  const dialog = screen.getByRole('dialog', { name: '용어 정밀스캔' });
  expect(within(dialog).getByRole('button', { name: '정밀스캔 시작하기' })).toBeEnabled();
  app.dispose();
});

it('Gemini 연결에서는 용어 정밀스캔 메뉴를 두지 않는다', async () => {
  const app = await connectedApp(
    { guidance: guidanceStore([existing]), termScan: vi.fn<TermScan>() },
    'gemini',
  );
  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  expect(screen.getByRole('menuitem', { name: '용어집 편집하기' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: '용어 정밀스캔' })).toBeNull();
  app.dispose();
});

it('정밀스캔이 끝나면 닫아 두었던 용어집도 바뀐 내용을 다시 읽는다', async () => {
  const guidance = guidanceStore([existing]);
  const app = await connectedApp({ guidance, termScan: scanAddingTerm(guidance) });
  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어집 편집하기' }));
  expect(await screen.findByDisplayValue('合成')).toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole('dialog', { name: '작품 용어집' })).getByRole('button', {
      name: '닫기',
    }),
  );

  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어 정밀스캔' }));
  fireEvent.click(screen.getByRole('button', { name: '정밀스캔 시작하기' }));
  await screen.findByText('바꾼 용어 1개 · 확인한 용어 0개 · 제안 0개');
  fireEvent.click(
    within(screen.getByRole('dialog', { name: '용어 정밀스캔' })).getByRole('button', {
      name: '닫기',
    }),
  );

  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어집 편집하기' }));
  expect(await screen.findByDisplayValue('アルベルト')).toBeInTheDocument();
  app.dispose();
});

const emptyResult: TermScanResult = { applied: [], confirmed: 0, suggestions: [], partial: false };

/** release를 부를 때까지 스캔이 끝나지 않는 가짜 스캔. 진행 중 상태를 만든다. */
function gatedScan(result: TermScanResult = emptyResult) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const scan = vi.fn<TermScan>(async () => {
    await gate;
    return result;
  });
  return { scan, release: () => release() };
}

it('진행 중에 대화상자를 닫으면 스캔이 계속 돈다는 안내를 띄운다', async () => {
  const gate = gatedScan();
  const app = await connectedApp({ guidance: guidanceStore([existing]), termScan: gate.scan });
  render(<Application controller={app} />);
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '용어 정밀스캔' }));
  fireEvent.click(screen.getByRole('button', { name: '정밀스캔 시작하기' }));
  const dialog = screen.getByRole('dialog', { name: '용어 정밀스캔' });
  await within(dialog).findByRole('button', { name: '중단' });
  fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }));
  expect(
    await screen.findByText(
      '정밀스캔은 계속 진행돼요. 메뉴의 ‘용어 정밀스캔’에서 다시 볼 수 있어요.',
    ),
  ).toBeInTheDocument();
  gate.release();
  await waitFor(() => expect(app.getSnapshot().termScan?.phase).toBe('done'));
  app.dispose();
});
