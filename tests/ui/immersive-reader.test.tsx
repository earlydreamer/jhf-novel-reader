// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { ReaderError } from '../../src/contracts';
import type { CompletedTranslation, ChapterRef, WorkPage } from '../../src/contracts/reading';
import { runTopBackHandler } from '../../src/ui/shell/backStack';
import { ImmersiveReader, type ImmersiveReaderProps } from '../../src/ui/ImmersiveReader';
import { source } from '../providers/wholeChapterFixture';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const chapter: ChapterRef = {
  workId: source.workId,
  chapterId: source.chapterId,
  canonicalUrl: source.canonicalUrl,
  title: source.title,
  ordinal: 1,
};

const work: WorkPage = {
  workId: source.workId,
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '작품',
  chapters: [chapter],
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};

function completed(overrides: Partial<CompletedTranslation> = {}): CompletedTranslation {
  return {
    schemaVersion: 2,
    versionId: 'saved-v1',
    source,
    text: '첫 번역\n\n둘째 번역',
    blocks: [
      { id: 'b1', text: '첫 번역' },
      { id: 'b2', text: '둘째 번역' },
    ],
    createdAt: '2026-10-08T00:00:00Z',
    provenance: {
      provider: 'openai-compatible',
      connectionId: 'synthetic',
      modelId: 'synthetic',
      contractVersion: 'plain-v1',
      promptVersion: 'hymt2-ko-v1',
      languageDirection: 'ja-ko',
    },
    ...overrides,
  };
}

function props(overrides: Partial<ImmersiveReaderProps> = {}): ImmersiveReaderProps {
  return {
    route: 'reader',
    chapter,
    work,
    version: completed(),
    position: null,
    translation: { phase: 'idle', elapsedMs: 0 },
    translationActive: false,
    paragraphRepair: false,
    translationAvailable: true,
    selectedModelId: 'synthetic',
    connected: true,
    catalogStatus: 'connected',
    connectionConfigured: true,
    fontSize: 18,
    readingBackground: 'theme',
    lineHeight: 1.8,
    showOriginal: false,
    sourceChange: 'idle',
    busy: false,
    retryParagraphsAvailable: true,
    onBack: vi.fn(),
    onShowOriginal: vi.fn(),
    onFontSize: vi.fn(),
    onReadingBackground: vi.fn(),
    onLineHeight: vi.fn(),
    onPreviewPosition: vi.fn(),
    onPosition: vi.fn(),
    onAdjacent: vi.fn(),
    onTranslate: vi.fn(),
    onCancel: vi.fn(),
    onRetry: vi.fn(),
    onRetrySave: vi.fn(),
    onRetryParagraphs: vi.fn(),
    onSettings: vi.fn(),
    onCheckConnection: vi.fn(),
    onRefreshSource: vi.fn(),
    onOpenSaved: vi.fn(),
    onGoHome: vi.fn(),
    ...overrides,
  };
}

test('immersive bars are inert while hidden, keyboard reveal opens them, and Back closes an overlay before hiding bars', () => {
  render(<ImmersiveReader {...props()} />);

  const appbar = document.querySelector<HTMLElement>('.nr-immersive-appbar')!;
  const toolbar = document.querySelector<HTMLElement>('.nr-toolbar')!;
  expect(appbar).toHaveAttribute('inert');
  expect(appbar).toHaveAttribute('aria-hidden', 'true');
  expect(toolbar).toHaveAttribute('inert');
  expect(toolbar).toHaveAttribute('aria-hidden', 'true');

  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  expect(screen.getByRole('button', { name: '목차로 돌아가기' })).toHaveFocus();
  expect(appbar).not.toHaveAttribute('inert');
  expect(screen.getByRole('toolbar', { name: '읽기 도구' })).not.toHaveAttribute('inert');

  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toBeInTheDocument();
  act(() => expect(runTopBackHandler()).toBe(true));
  expect(screen.queryByRole('menuitem', { name: '서재로 가기' })).not.toBeInTheDocument();
  expect(screen.getByRole('toolbar', { name: '읽기 도구' })).not.toHaveAttribute('inert');

  fireEvent.click(screen.getByRole('button', { name: '보기 설정' }));
  expect(screen.getByRole('dialog', { name: '보기 설정' })).toBeInTheDocument();
  act(() => expect(runTopBackHandler()).toBe(true));
  expect(screen.queryByRole('dialog', { name: '보기 설정' })).not.toBeInTheDocument();
  expect(screen.getByRole('toolbar', { name: '읽기 도구' })).not.toHaveAttribute('inert');
  act(() => expect(runTopBackHandler()).toBe(true));
  expect(document.querySelector('.nr-toolbar')).toHaveAttribute('inert');
});

test('a valid saved translation with mismatched source paragraph count remains readable with whole-original toggle', () => {
  const onPosition = vi.fn();
  const value = completed({ blocks: [{ id: 'merged', text: '두 문단을 합친 저장 번역' }] });
  const view = render(<ImmersiveReader {...props({ version: value, onPosition })} />);

  expect(screen.getByRole('article', { name: '번역 본문' })).toHaveTextContent(
    '두 문단을 합친 저장 번역',
  );
  expect(screen.getByRole('note')).toHaveTextContent('원문 전체는 앱바에서 전환할 수 있어요.');
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  expect(
    screen.queryByRole('menuitem', { name: '문단 골라 다시 번역하기' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('menuitem', { name: '실패한 문단 다시 번역하기' }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: '원문 보기' }));
  const rerenderedProps = props({ version: value, onPosition, showOriginal: true });
  view.rerender(<ImmersiveReader {...rerenderedProps} />);
  const original = screen.getByRole('article', { name: '원문 본문' });
  expect(original).toHaveTextContent('基底');
  expect(original).toHaveTextContent('二');
  expect(original.querySelectorAll('[data-reader-index]')).toHaveLength(source.paragraphs.length);
  const callsBeforeOriginalScroll = onPosition.mock.calls.length;
  original.scrollTop = 20;
  fireEvent.scroll(original);
  expect(onPosition).toHaveBeenCalledTimes(callsBeforeOriginalScroll);
});

test.each([
  [
    'foreign work',
    completed({
      versionId: 'pending-foreign-work',
      source: { ...source, workId: 'foreign-work' },
    }),
  ],
  [
    'foreign repair base',
    completed({
      versionId: 'pending-foreign-base',
      provenance: {
        ...completed().provenance,
        repair: { baseVersionId: 'other-base', paragraphIndexes: [0] },
      },
    }),
  ],
])(
  'a %s pending-save cannot lend its live preview to the current translation',
  (_label, foreignPending) => {
    const pendingSave = {
      ...foreignPending,
      text: 'foreign pending result',
      blocks: [{ id: 'foreign-block', text: 'foreign pending result' }],
    };
    render(
      <ImmersiveReader
        {...props({
          route: 'translation',
          translationActive: false,
          version: completed(),
          translation: {
            phase: 'failed',
            elapsedMs: 0,
            token: {
              requestId: 'current-request',
              chapterId: chapter.chapterId,
              settingsRevision: 1,
            },
            preview: 'foreign pending result',
            pendingSave,
          },
        })}
      />,
    );

    const article = screen.getByRole('article', { name: '번역 본문' });
    expect(article).toHaveTextContent('첫 번역');
    expect(article).not.toHaveTextContent('foreign pending result');
    expect(
      screen.queryByText('저장 전 미리보기 · 도착한 문단부터 읽을 수 있어요.'),
    ).not.toBeInTheDocument();
  },
);

test('font size is expressed in rem and quality heuristics stay distinct from confirmed failed paragraphs', () => {
  const value = completed({
    blocks: [
      { id: 'b1', text: '첫 번역' },
      { id: 'b2', text: '둘째 번역' },
      { id: 'b3', text: '셋째 번역' },
    ],
    failedParagraphs: [0],
    quality: { ruleVersion: 'deterministic-v1', japaneseBlocks: [1], missingTerms: [] },
  });
  render(<ImmersiveReader {...props({ version: value, fontSize: 19 })} />);

  expect(screen.getByRole('region', { name: '몰입형 리더' })).toHaveStyle({
    '--nr-reading-font-rem': '1.1875',
  });
  expect(screen.getByText('번역하지 못해 원문으로 남겼어요.')).toBeInTheDocument();
  expect(screen.getAllByText('실패한 문단 다시 번역하기')).toHaveLength(1);
  expect(screen.getByText('일본어가 남아 있는지 확인해 주세요.')).toBeInTheDocument();
  expect(
    screen.getByText('일본어가 남은 문단은 번역 확인 결과에서 살펴봐 주세요.'),
  ).toBeInTheDocument();
});

test('paragraph original action scrolls after the original DOM commit and preserves both reader anchors', () => {
  const version = completed({
    blocks: [
      { id: 'b1', text: '첫 번역' },
      { id: 'b2', text: '빈 자리' },
      { id: 'b3', text: '셋째 번역' },
    ],
  });
  const onPosition = vi.fn();
  const offsetTop = vi
    .spyOn(HTMLElement.prototype, 'offsetTop', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return Number(this.dataset.readerIndex ?? 0) * 100;
    });
  function ControlledReader() {
    const [showOriginal, setShowOriginal] = useState(false);
    return (
      <ImmersiveReader
        {...props({ version, showOriginal, onShowOriginal: setShowOriginal, onPosition })}
      />
    );
  }
  vi.useFakeTimers();
  render(<ControlledReader />);
  const article = screen.getByRole('article', { name: '번역 본문' });
  article.scrollTop = 225;
  fireEvent.scroll(article);
  expect(onPosition).toHaveBeenCalledWith('b3', 25);

  fireEvent.pointerDown(article.querySelector('[data-reader-index="2"]')!, {
    clientX: 20,
    clientY: 20,
  });
  act(() => vi.advanceTimersByTime(500));
  fireEvent.click(screen.getByRole('button', { name: '이 문단 원문 보기' }));

  const original = screen.getByRole('article', { name: '원문 본문' });
  expect(original).toBe(article);
  expect(original.scrollTop).toBe(200);
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '번역 보기' }));
  expect(screen.getByRole('article', { name: '번역 본문' })).toBe(article);
  expect(article.scrollTop).toBe(225);
  expect(onPosition).toHaveBeenCalledTimes(1);
  offsetTop.mockRestore();
});

test('saved translation information uses the displayed version provenance and does not invent elapsed time', () => {
  const version = completed({
    provenance: {
      provider: 'gemini',
      connectionId: 'older-connection',
      modelId: 'saved-model',
      contractVersion: 'plain-v1',
      promptVersion: 'hymt2-ko-v1',
      languageDirection: 'ja-ko',
    },
  });
  render(
    <ImmersiveReader
      {...props({
        version,
        selectedModelId: 'current-model',
        translation: { phase: 'idle', elapsedMs: 987_000 },
      })}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '번역 정보 보기' }));
  const info = screen.getByRole('dialog', { name: '번역 정보' });
  expect(info).toHaveTextContent('제공자: Google Gemini');
  expect(info).toHaveTextContent('모델: saved-model');
  expect(info).toHaveTextContent('경과 시간: 기록 없음');
  expect(info).not.toHaveTextContent('current-model');
  expect(info).not.toHaveTextContent('987');
});

test('legacy saved quality without a quality record stays explicitly unrecorded and retains heuristic limits', () => {
  const version = completed({ quality: undefined });
  render(<ImmersiveReader {...props({ version })} />);

  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.click(screen.getByRole('menuitem', { name: '번역 확인 결과 보기' }));
  const sheet = screen.getByRole('dialog', { name: '번역 확인 결과' });
  expect(sheet).toHaveTextContent('가나가 남은 문단 0개 · 용어 확인 기록 없음');
  expect(sheet).toHaveTextContent('용어 확인 기록이 없어 가나 잔존만 확인했어요.');
  expect(sheet).toHaveTextContent('한자만 남은 일본어');
  expect(sheet).not.toHaveTextContent('확정 표기 미발견 0개');
  expect(sheet).not.toHaveTextContent('이 확인 규칙에서 발견한 항목이 없어요.');
});

test('settings preserve legacy font values while changing the selected reading presentation', () => {
  const onFontSize = vi.fn();
  const onReadingBackground = vi.fn();
  const onLineHeight = vi.fn();
  render(
    <ImmersiveReader {...props({ fontSize: 47, onFontSize, onReadingBackground, onLineHeight })} />,
  );

  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '보기 설정' }));
  expect(screen.getByText('47px')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '글자 크기 키우기' }));
  expect(onFontSize).toHaveBeenCalledWith(48);
  fireEvent.click(screen.getByRole('button', { name: '세피아' }));
  fireEvent.click(screen.getByRole('button', { name: '2' }));
  expect(onReadingBackground).toHaveBeenCalledWith('sepia');
  expect(onLineHeight).toHaveBeenCalledWith(2);
});

test('all active translation phases keep an explicit stop action available', () => {
  render(
    <ImmersiveReader
      {...props({
        route: 'translation',
        translation: { phase: 'validating', elapsedMs: 1200 },
        translationActive: true,
      })}
    />,
  );
  expect(screen.getByRole('button', { name: '중단' })).toBeInTheDocument();
});

test('center tap toggles bars while scroll direction hides and reveals them', () => {
  render(<ImmersiveReader {...props()} />);
  const article = screen.getByRole('article', { name: '번역 본문' });
  const appbar = document.querySelector('.nr-immersive-appbar');
  vi.spyOn(article, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 100,
    bottom: 800,
    width: 100,
    height: 800,
    toJSON: () => ({}),
  } as DOMRect);

  fireEvent.click(article, { clientX: 50 });
  expect(appbar).not.toHaveAttribute('inert');
  fireEvent.click(article, { clientX: 10 });
  fireEvent.click(article, { clientX: 90 });
  expect(appbar).not.toHaveAttribute('inert');

  article.scrollTop = 24;
  fireEvent.scroll(article);
  expect(appbar).toHaveAttribute('inert');
  article.scrollTop = 8;
  fireEvent.scroll(article);
  expect(appbar).not.toHaveAttribute('inert');
});

test('preview keeps empty paragraph indexes and reports the actual scrolled row offset', () => {
  const onPreviewPosition = vi.fn();
  render(
    <ImmersiveReader
      {...props({
        route: 'translation',
        version: null,
        translation: {
          phase: 'translating',
          elapsedMs: 20,
          token: { requestId: 'preview', chapterId: chapter.chapterId, settingsRevision: 1 },
          preview: '\n\n도착한 문단',
        },
        translationActive: true,
        onPreviewPosition,
      })}
    />,
  );
  const article = screen.getByRole('article', { name: '번역 미리보기' });
  const rows = article.querySelectorAll<HTMLElement>('[data-reader-index]');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveAttribute('data-reader-index', '0');
  expect(rows[1]).toHaveAttribute('data-reader-index', '1');
  Object.defineProperty(rows[1], 'offsetTop', { value: 120 });
  article.scrollTop = 135;
  fireEvent.scroll(article);
  expect(onPreviewPosition).toHaveBeenCalledWith(1, 15);
});

test('live preview from a different chapter is not rendered in the current translation route', () => {
  const unrelatedSave = completed({
    source: { ...source, workId: 'other-work', chapterId: 'other-work/9' },
  });
  render(
    <ImmersiveReader
      {...props({
        route: 'translation',
        version: null,
        translation: {
          phase: 'failed',
          elapsedMs: 20,
          token: { requestId: 'stale', chapterId: 'another-work/9', settingsRevision: 1 },
          preview: '다른 회차의 미리보기',
          pendingSave: unrelatedSave,
        },
      })}
    />,
  );

  const article = screen.getByRole('article', { name: '번역 미리보기' });
  expect(article).not.toHaveTextContent('다른 회차의 미리보기');
  expect(article).toHaveTextContent('번역을 시작하면 이 화면에서 읽을 수 있어요.');
});

test('a different saved version with no durable position does not reuse the prior original anchor', () => {
  const first = completed({ versionId: 'saved-a' });
  const second = completed({
    versionId: 'saved-b',
    blocks: [{ id: 'new-block', text: '새 저장본' }],
  });
  const view = render(<ImmersiveReader {...props({ version: first, showOriginal: true })} />);
  const original = screen.getByRole('article', { name: '원문 본문' });
  original.scrollTop = 44;
  fireEvent.scroll(original);

  view.rerender(<ImmersiveReader {...props({ version: second, showOriginal: true })} />);
  fireEvent.click(screen.getByRole('button', { name: '읽기 메뉴 열기' }));
  fireEvent.click(screen.getByRole('button', { name: '번역 보기' }));
  view.rerender(<ImmersiveReader {...props({ version: second, showOriginal: false })} />);
  fireEvent.click(screen.getByRole('button', { name: '원문 보기' }));
  view.rerender(<ImmersiveReader {...props({ version: second, showOriginal: true })} />);
  expect(screen.getByRole('article', { name: '원문 본문' }).scrollTop).toBe(0);
});

test('long press opens paragraph actions, swallows its follow-up click, and retries only the chosen index', async () => {
  const onRetryParagraphs = vi.fn();
  const value = completed({
    blocks: [
      { id: 'b1', text: '첫 번역' },
      { id: 'b2', text: '둘째 번역' },
      { id: 'b3', text: '셋째 번역' },
    ],
  });
  render(<ImmersiveReader {...props({ version: value, onRetryParagraphs })} />);
  const paragraph = screen.getByText('첫 번역').closest('p')!;
  const appbar = document.querySelector('.nr-immersive-appbar');
  vi.useFakeTimers();

  fireEvent.pointerDown(paragraph, { clientX: 10, clientY: 10, pointerId: 1 });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  const paragraphDialog = screen.getByRole('dialog', { name: '문단 작업' });
  expect(paragraphDialog).toBeInTheDocument();
  fireEvent.pointerUp(paragraph, { pointerId: 1 });
  fireEvent.mouseDown(paragraphDialog);
  fireEvent.mouseUp(paragraphDialog);
  fireEvent.click(paragraphDialog, { detail: 1, pointerId: 1 });
  expect(screen.getByRole('dialog', { name: '문단 작업' })).toBeVisible();
  fireEvent.click(paragraph, { clientX: 50 });
  expect(appbar).toHaveAttribute('inert');
  fireEvent.click(screen.getByRole('button', { name: '이 문단 다시 번역하기' }));
  expect(onRetryParagraphs).toHaveBeenCalledTimes(1);
  expect(onRetryParagraphs).toHaveBeenCalledWith([0]);

  fireEvent.pointerDown(paragraph, { clientX: 10, clientY: 10, pointerId: 2 });
  fireEvent.pointerMove(paragraph, { clientX: 30, clientY: 10, pointerId: 2 });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByRole('dialog', { name: '문단 작업' })).not.toBeInTheDocument();
  fireEvent.pointerDown(paragraph, { clientX: 10, clientY: 10, pointerId: 3 });
  fireEvent.pointerCancel(paragraph, { pointerId: 3 });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByRole('dialog', { name: '문단 작업' })).not.toBeInTheDocument();
  fireEvent.pointerDown(paragraph, { clientX: 10, clientY: 10, pointerId: 4 });
  fireEvent.pointerUp(paragraph, { pointerId: 4 });
  fireEvent.click(paragraph, { clientX: 50 });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(screen.queryByRole('dialog', { name: '문단 작업' })).not.toBeInTheDocument();
  expect(onRetryParagraphs).toHaveBeenCalledTimes(1);
});

test('source access failures keep their specific guidance and explicit retry action', () => {
  const onRefreshSource = vi.fn();
  const onRetry = vi.fn();
  render(
    <ImmersiveReader
      {...props({
        route: 'translation',
        version: null,
        translation: {
          phase: 'failed',
          elapsedMs: 0,
          error: new ReaderError('source_access', 'not_sent'),
        },
        onRetry,
        onRefreshSource,
      })}
    />,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('선택한 회차에 접근하지 못했어요.');
  fireEvent.click(screen.getByRole('button', { name: '원문 다시 확인하고 번역하기' }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(onRefreshSource).not.toHaveBeenCalled();
});

test('원문 변경 안내는 번역 본문 안에서 회차 제목보다 앞에 놓인다', () => {
  render(<ImmersiveReader {...props({ sourceChange: 'unavailable' })} />);

  const article = screen.getByRole('article', { name: '번역 본문' });
  const notice = screen.getByText('원문 변경을 확인하지 못했어요.');
  const heading = screen.getByRole('heading', { level: 1 });
  expect(notice).toHaveAttribute('role', 'status');
  expect(article).toContainElement(notice);
  expect(notice.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('번역 실패 카드도 번역 본문 안에 표시된다', () => {
  render(
    <ImmersiveReader
      {...props({
        route: 'translation',
        version: null,
        translation: {
          phase: 'failed',
          elapsedMs: 0,
          error: new ReaderError('source_access', 'not_sent'),
        },
      })}
    />,
  );

  const article = screen.getByRole('article', { name: '번역 미리보기' });
  expect(article).toContainElement(screen.getByRole('alert'));
  expect(screen.getByRole('alert')).toHaveTextContent('선택한 회차에 접근하지 못했어요.');
});

test('안내가 없으면 리더 안내 컨테이너를 렌더하지 않는다', () => {
  render(<ImmersiveReader {...props()} />);

  expect(document.querySelector('.nr-reader-notices')).toBeNull();
});
