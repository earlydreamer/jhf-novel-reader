// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { WorkScreen } from '../../src/ui/WorkScreen';
import { BatchPanel } from '../../src/ui/BatchPanel';
import type { BatchState, BatchRecord } from '../../src/translation/batch';
import type { WorkPage } from '../../src/contracts/reading';
afterEach(cleanup);
it('shows the fetched TOC ordinal range without suggesting the first chapter is selected', () => {
  render(
    <WorkScreen
      work={{
        workId: 'n1234ab',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
        title: '合成作品',
        pageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
        nextPageUrl: 'https://ncode.syosetu.com/n1234ab/?p=3',
        complete: false,
        chapters: [
          {
            workId: 'n1234ab',
            chapterId: 'n1234ab/101',
            canonicalUrl: 'https://ncode.syosetu.com/n1234ab/101/',
            ordinal: 101,
            title: '百一話',
          },
          {
            workId: 'n1234ab',
            chapterId: 'n1234ab/102',
            canonicalUrl: 'https://ncode.syosetu.com/n1234ab/102/',
            ordinal: 102,
            title: '百二話',
          },
        ],
      }}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
    />,
  );
  expect(screen.getByText('102화까지 확인했어요 · 0화 저장됨')).toBeTruthy();
  expect(screen.queryByText('선택한 회차')).toBeNull();
  expect(screen.getByRole('heading', { name: '회차 목록' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '이어서 읽기' })).toBeTruthy();
  cleanup();
});
it('counts unique saved chapters and preserves a partial TOC beginning at ordinal 101', () => {
  const work: WorkPage = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
    nextPageUrl: 'https://ncode.syosetu.com/n1234ab/?p=3',
    complete: false,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/101',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/101/',
        ordinal: 101,
        title: '百一話',
      },
    ],
  };
  render(
    <WorkScreen
      work={work}
      busy={false}
      savedChapterIds={['n1234ab/101', 'n1234ab/101']}
      onSelect={() => {}}
      onLoadMore={() => {}}
    />,
  );
  expect(screen.getByText('101화까지 확인했어요 · 1화 저장됨')).toBeTruthy();
});
it('shows the total chapter count once the whole TOC is loaded', () => {
  render(
    <WorkScreen
      work={{
        workId: 'n1234ab',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
        title: '合成作品',
        pageUrl: 'https://ncode.syosetu.com/n1234ab/?p=5',
        nextPageUrl: null,
        complete: true,
        chapters: [
          {
            workId: 'n1234ab',
            chapterId: 'n1234ab/1',
            canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
            ordinal: 1,
            title: '一話',
          },
          {
            workId: 'n1234ab',
            chapterId: 'n1234ab/9',
            canonicalUrl: 'https://ncode.syosetu.com/n1234ab/9/',
            ordinal: 9,
            title: '九話',
          },
        ],
      }}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
    />,
  );
  expect(screen.getByText('전체 2화 · 0화 저장됨')).toBeTruthy();
  cleanup();
});

it('opens the same chapter action sheet from the sibling menu and a long press', async () => {
  const work = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/?p=2',
    nextPageUrl: null,
    complete: true,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/101',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/101/',
        ordinal: 101,
        title: '百一話',
      },
    ],
  };
  const onTranslate = vi.fn(async (_key?: string) => {});
  const onSave = vi.fn(async (_key: string, _target: string) => {});
  const titles = { entries: [], busy: false, onTranslate, onSave };
  render(
    <WorkScreen
      work={work}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
      titles={titles}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '101화 메뉴' }));
  const sheet = screen.getByRole('dialog', { name: '101화 메뉴' });
  expect(within(sheet).getByRole('button', { name: '제목 번역하기' })).toBeTruthy();
  expect(within(sheet).getByRole('button', { name: '제목 직접 수정하기' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '원문 사이트에서 보기' }).getAttribute('href')).toBe(
    'https://ncode.syosetu.com/n1234ab/101/',
  );
  fireEvent.click(screen.getByRole('button', { name: '제목 번역하기' }));
  expect(onTranslate).toHaveBeenCalledWith('n1234ab/101');
  expect(screen.queryByRole('dialog', { name: '101화 메뉴' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '101화 메뉴' }));
  fireEvent.click(screen.getByRole('button', { name: '제목 직접 수정하기' }));
  expect(screen.queryByRole('dialog', { name: '101화 메뉴' })).toBeNull();
  fireEvent.change(screen.getByLabelText('101화 제목 번역문'), {
    target: { value: '직접 편집한 회차명' },
  });
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  expect(onSave).toHaveBeenCalledWith('n1234ab/101', '직접 편집한 회차명');
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '회차 제목 직접 수정하기' })).toBeNull(),
  );
  fireEvent.click(screen.getByRole('button', { name: '101화 메뉴' }));
  fireEvent.keyDown(screen.getByRole('dialog', { name: '101화 메뉴' }), { key: 'Escape' });
  fireEvent.contextMenu(screen.getByText('101화').closest('.nr-list-item')!, {
    clientX: 200,
    clientY: 100,
  });
  expect(screen.getByRole('dialog', { name: '101화 메뉴' })).toBeTruthy();
});

it('shows every chapter sheet action as a sheet row with saved-title state and keeps input on save failure', async () => {
  const work = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/101',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/101/',
        ordinal: 101,
        title: '百一話',
      },
    ],
  };
  const onTranslate = vi.fn(async (_key?: string) => {});
  const onSave = vi.fn(async (_key: string, _target: string) => {
    throw new Error('save failed');
  });
  const titles = {
    entries: [
      {
        key: 'n1234ab/101',
        source: '百一話',
        target: '직접 쓴 회차명',
        origin: 'user' as const,
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
    busy: false,
    onTranslate,
    onSave,
  };
  render(
    <WorkScreen
      work={work}
      busy={false}
      savedChapterIds={['n1234ab/101']}
      onSelect={() => {}}
      onLoadMore={() => {}}
      titles={titles}
      onRemoveChapter={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '101화 메뉴' }));
  const sheet = screen.getByRole('dialog', { name: '101화 메뉴' });
  const retranslate = within(sheet).getByRole('button', { name: '제목 다시 번역하기' });
  const edit = within(sheet).getByRole('button', { name: /제목 직접 수정하기/ });
  const source = within(sheet).getByRole('link', { name: '원문 사이트에서 보기' });
  const remove = within(sheet).getByRole('button', { name: '이 화 저장본 삭제하기' });
  for (const row of [retranslate, edit, source, remove]) {
    expect(row.classList.contains('nr-sheet-action')).toBe(true);
  }
  expect(remove.classList.contains('nr-sheet-action--danger')).toBe(true);
  expect(
    within(sheet).getByText('직접 수정됨').classList.contains('nr-sheet-action__supporting'),
  ).toBe(true);
  fireEvent.click(edit);
  const input = screen.getByLabelText('101화 제목 번역문') as HTMLInputElement;
  expect(input.value).toBe('직접 쓴 회차명');
  fireEvent.change(input, { target: { value: '실패할 입력' } });
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    '제목을 저장하지 못했어요. 입력한 내용은 그대로 남아 있어요.',
  );
  expect((screen.getByLabelText('101화 제목 번역문') as HTMLInputElement).value).toBe(
    '실패할 입력',
  );
});

it('marks only the verified actual recent chapter as current, never the selected route chapter', () => {
  const work = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [1, 2].map((ordinal) => ({
      workId: 'n1234ab',
      chapterId: `n1234ab/${ordinal}`,
      canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
      ordinal,
      title: `第${ordinal}話`,
    })),
  };
  render(
    <WorkScreen
      work={work}
      selectedChapterId="n1234ab/1"
      recentChapterId="n1234ab/2"
      recentStatus="verified"
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
    />,
  );
  const selectedRow = screen.getByText('第1話').closest('li');
  const recentRow = screen.getByText('第2話').closest('li');
  expect(selectedRow?.querySelector('[aria-current]')).toBeNull();
  expect(recentRow?.querySelector('[aria-current="true"]')).toBeTruthy();
  expect(recentRow?.textContent).toContain('읽는 중');
});

it('does not substitute a selected row when the verified recent chapter is outside the loaded page', () => {
  const work = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [1, 2].map((ordinal) => ({
      workId: 'n1234ab',
      chapterId: `n1234ab/${ordinal}`,
      canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
      ordinal,
      title: `第${ordinal}話`,
    })),
  };
  render(
    <WorkScreen
      work={work}
      selectedChapterId="n1234ab/1"
      recentChapterId="n1234ab/101"
      recentStatus="verified"
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
    />,
  );
  expect(
    screen
      .getByRole('button', { name: '1화 第1話' })
      .closest('li')
      ?.querySelector('[aria-current]'),
  ).toBeNull();
  expect(
    screen
      .getByRole('button', { name: '2화 第2話' })
      .closest('li')
      ?.querySelector('[aria-current]'),
  ).toBeNull();
  expect(screen.getByText('최근 읽은 회차는 현재 목차 범위에 없어요.')).toBeTruthy();
});

it('scrolls to the actual recent row once per WorkScreen entry, not on saved-state rerenders', () => {
  const original = HTMLElement.prototype.scrollIntoView;
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
  const work = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [1, 2].map((ordinal) => ({
      workId: 'n1234ab',
      chapterId: `n1234ab/${ordinal}`,
      canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
      ordinal,
      title: `第${ordinal}話`,
    })),
  };
  const props = {
    work,
    selectedChapterId: 'n1234ab/1',
    recentChapterId: 'n1234ab/2',
    recentStatus: 'verified' as const,
    busy: false,
    savedChapterIds: [] as string[],
    onSelect: () => {},
    onLoadMore: () => {},
  };
  const view = render(<WorkScreen {...props} />);
  expect(scroll).toHaveBeenCalledTimes(1);
  view.rerender(<WorkScreen {...props} savedChapterIds={['n1234ab/2']} />);
  expect(scroll).toHaveBeenCalledTimes(1);
  view.rerender(<WorkScreen {...props} recentChapterId="n1234ab/1" />);
  expect(scroll).toHaveBeenCalledTimes(1);
  view.unmount();
  if (original)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: original,
    });
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

it('shows preparing progress only for preparingWorkId when the previous record belongs elsewhere', () => {
  const work = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/1',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
        ordinal: 1,
        title: '一話',
      },
    ],
  };
  const previous = {
    ...work,
    workId: 'n9999zz',
    canonicalUrl: 'https://ncode.syosetu.com/n9999zz/',
    chapters: [{ ...work.chapters[0]!, workId: 'n9999zz', chapterId: 'n9999zz/1' }],
  };
  const batch = {
    active: true,
    preparing: true,
    preparingWorkId: work.workId,
    error: '이전 작품 오류',
    scanProgress: { completed: 1, total: 3 },
    chapterProgress: { completed: 1, total: 2 },
    record: {
      schemaVersion: 1,
      id: 'old-record',
      createdAt: '2026-10-08T00:00:00Z',
      work: previous,
      selection: {
        connection: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:1234',
          revision: 1,
        },
        modelId: 'fixture',
      },
      chapters: previous.chapters,
      retranslate: false,
      alreadySaved: 0,
      cursor: 0,
      completed: 0,
      skipped: 0,
      phase: 'running',
    },
  } as BatchState;
  const onCancelBatch = vi.fn();
  const { rerender } = render(
    <WorkScreen
      work={work}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
      batch={batch}
      onCancelBatch={onCancelBatch}
    />,
  );
  expect(screen.getByText('미리 번역 대상을 확인하고 있어요')).toBeTruthy();
  expect(screen.queryByText('이전 작품 오류')).toBeNull();
  expect(screen.queryByText(/1\/3화/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /진행 보기/ }));
  expect(screen.getByRole('dialog', { name: '미리 번역하기' })).toBeTruthy();
  expect(screen.queryByText('old-record')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '중단' }));
  expect(onCancelBatch).toHaveBeenCalledTimes(1);
  cleanup();
  const onOtherCancel = vi.fn();
  render(
    <WorkScreen
      work={previous}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
      batch={batch}
      onCancelBatch={onOtherCancel}
    />,
  );
  expect(screen.queryByText('미리 번역 대상을 확인하고 있어요')).toBeNull();
  expect(screen.queryByRole('button', { name: '중단' })).toBeNull();
  expect(onOtherCancel).not.toHaveBeenCalled();
});

it('preserves same-owner batch and review drafts across close, then resets for a new record and work', () => {
  const workA: WorkPage = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品 A',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/1',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
        ordinal: 1,
        title: '一話',
      },
    ],
  };
  const workB: WorkPage = {
    ...workA,
    workId: 'n9999zz',
    canonicalUrl: 'https://ncode.syosetu.com/n9999zz/',
    title: '合成作品 B',
    chapters: [
      {
        ...workA.chapters[0]!,
        workId: 'n9999zz',
        chapterId: 'n9999zz/1',
        canonicalUrl: 'https://ncode.syosetu.com/n9999zz/1/',
      },
    ],
  };
  const candidates = Array.from({ length: 21 }, (_, i) => ({
    source: `合成${i}`,
    kind: 'katakana' as const,
    count: 2,
    chapterIds: [workA.chapters[0]!.chapterId],
  }));
  const makeBatch = (id: string, work: WorkPage): BatchState => ({
    active: false,
    preparing: false,
    error: null,
    record: {
      schemaVersion: 1,
      id,
      createdAt: '2026-10-08T00:00:00Z',
      work,
      selection: {
        connection: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:1234',
          revision: 1,
        },
        modelId: 'fixture',
      },
      chapters: work.chapters,
      retranslate: false,
      alreadySaved: 0,
      cursor: 0,
      completed: 0,
      skipped: 0,
      phase: 'prepared',
      scan: { status: 'review', candidates },
    } as BatchRecord,
  });
  function Harness({ work, batch }: { work: WorkPage; batch: BatchState }) {
    const [request, setRequest] = useState<{ dialog: 'batch'; id: number; workId: string } | null>(
      null,
    );
    const [sequence, setSequence] = useState(0);
    const handleRequest = useCallback(
      (id: number) => setRequest((current) => (current?.id === id ? null : current)),
      [],
    );
    return (
      <>
        <button
          type="button"
          onClick={() => {
            const id = sequence + 1;
            setSequence(id);
            setRequest({ dialog: 'batch', id, workId: work.workId });
          }}
        >
          미리 번역 열기
        </button>
        <WorkScreen
          key={work.workId}
          work={work}
          busy={false}
          batchAvailable
          savedChapterIds={[]}
          onSelect={() => {}}
          onLoadMore={() => {}}
          dialogRequest={request}
          onDialogRequestHandled={handleRequest}
          batch={batch}
        />
      </>
    );
  }
  const { rerender } = render(<Harness work={workA} batch={makeBatch('record-a', workA)} />);
  fireEvent.click(screen.getByRole('button', { name: '미리 번역 열기' }));
  let dialog = screen.getByRole('dialog', { name: '미리 번역하기' });
  let dialogUI = within(dialog);
  const start = dialogUI.getByLabelText('시작 회차');
  fireEvent.change(start, { target: { value: '3' } });
  fireEvent.change(dialogUI.getByLabelText('끝 회차'), { target: { value: '9' } });
  fireEvent.click(dialogUI.getByLabelText('이미 번역한 회차도 다시 번역'));
  fireEvent.click(dialogUI.getByLabelText('合成0 사용'));
  fireEvent.change(dialogUI.getByLabelText('合成0 한국어 표기'), { target: { value: '가온' } });
  fireEvent.click(dialogUI.getByRole('button', { name: '다음 후보' }));
  expect(dialogUI.getByText('2/2')).toBeTruthy();
  fireEvent.click(dialogUI.getByRole('button', { name: '닫기' }));
  fireEvent.click(screen.getByRole('button', { name: '미리 번역 열기' }));
  dialog = screen.getByRole('dialog', { name: '미리 번역하기' });
  dialogUI = within(dialog);
  expect((dialogUI.getByLabelText('시작 회차') as HTMLInputElement).value).toBe('3');
  expect((dialogUI.getByLabelText('끝 회차') as HTMLInputElement).value).toBe('9');
  expect(
    (dialogUI.getByLabelText('이미 번역한 회차도 다시 번역') as HTMLInputElement).checked,
  ).toBe(true);
  expect(dialogUI.getByText('2/2')).toBeTruthy();
  fireEvent.click(dialogUI.getByRole('button', { name: '이전 후보' }));
  expect((dialogUI.getByLabelText('合成0 사용') as HTMLInputElement).checked).toBe(true);
  expect((dialogUI.getByLabelText('合成0 한국어 표기') as HTMLInputElement).value).toBe('가온');
  rerender(<Harness work={workA} batch={makeBatch('record-b', workA)} />);
  dialog = screen.getByRole('dialog', { name: '미리 번역하기' });
  dialogUI = within(dialog);
  expect((dialogUI.getByLabelText('시작 회차') as HTMLInputElement).value).toBe('1');
  expect((dialogUI.getByLabelText('끝 회차') as HTMLInputElement).value).toBe('');
  expect(
    (dialogUI.getByLabelText('이미 번역한 회차도 다시 번역') as HTMLInputElement).checked,
  ).toBe(false);
  expect(dialogUI.getByText('1/2')).toBeTruthy();
  expect((dialogUI.getByLabelText('合成0 사용') as HTMLInputElement).checked).toBe(false);
  rerender(<Harness work={workB} batch={makeBatch('record-b', workB)} />);
  fireEvent.click(screen.getByRole('button', { name: '미리 번역 열기' }));
  dialog = screen.getByRole('dialog', { name: '미리 번역하기' });
  dialogUI = within(dialog);
  expect((dialogUI.getByLabelText('시작 회차') as HTMLInputElement).value).toBe('1');
  expect((dialogUI.getByLabelText('끝 회차') as HTMLInputElement).value).toBe('');
  expect(
    (dialogUI.getByLabelText('이미 번역한 회차도 다시 번역') as HTMLInputElement).checked,
  ).toBe(false);
});

it('keeps explicit global blockers on batch start actions', async () => {
  const work: WorkPage = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/1',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
        ordinal: 1,
        title: '一話',
      },
    ],
  };
  const record = {
    schemaVersion: 1,
    id: 'record-a',
    createdAt: '2026-10-08T00:00:00Z',
    work,
    selection: {
      connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 1 },
      modelId: 'fixture',
    },
    chapters: work.chapters,
    retranslate: false,
    alreadySaved: 0,
    cursor: 0,
    completed: 0,
    skipped: 0,
    phase: 'prepared',
    scan: { status: 'confirmed', candidates: [] },
  } as BatchRecord;
  const onRunBatch = vi.fn();
  render(
    <WorkScreen
      work={work}
      busy={false}
      batchAvailable
      batchGlobalBlocked
      batch={{ active: false, preparing: false, error: null, record }}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
      onRunBatch={onRunBatch}
      dialogRequest={{ dialog: 'batch', id: 1, workId: work.workId }}
    />,
  );
  const start = await screen.findByRole('button', { name: '확인한 회차 번역 시작' });
  expect((start as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(start);
  expect(onRunBatch).not.toHaveBeenCalled();
});
it('미리 번역 확정 범위는 경로형 모델 ID를 읽을 수 있는 이름으로 보여 준다 (#197)', () => {
  const work: WorkPage = {
    workId: 'n1234ab',
    canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
    title: '合成作品',
    pageUrl: 'https://ncode.syosetu.com/n1234ab/',
    nextPageUrl: null,
    complete: true,
    chapters: [
      {
        workId: 'n1234ab',
        chapterId: 'n1234ab/1',
        canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
        ordinal: 1,
        title: '一話',
      },
    ],
  };
  const batch = {
    active: false,
    preparing: false,
    error: null,
    record: {
      schemaVersion: 1,
      id: 'record-model-name',
      createdAt: '2026-10-08T00:00:00Z',
      work,
      selection: {
        connection: {
          provider: 'openai-compatible',
          baseUrl: 'http://localhost:1234',
          revision: 1,
        },
        modelId: 'D:\\models\\hymt2-7b.gguf',
      },
      chapters: work.chapters,
      retranslate: false,
      alreadySaved: 0,
      cursor: 0,
      completed: 0,
      skipped: 0,
      phase: 'prepared',
    },
  } as BatchState;
  render(<BatchPanel workId="n1234ab" batch={batch} batchAvailable />);
  expect(screen.getByText('모델: hymt2-7b')).toBeTruthy();
  expect(screen.queryByText(/hymt2-7b\.gguf/)).toBeNull();
  cleanup();
});
