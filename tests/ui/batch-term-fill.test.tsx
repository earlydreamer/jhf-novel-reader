// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BatchPanel, type BatchPanelProps } from '../../src/ui/BatchPanel';
import type { RenewalSnapshot } from '../../src/app/renewalController';
import type { BatchRecord, BatchState } from '../../src/translation/batch';
import type { RangeJudgeResult, TermScanChange } from '../../src/translation/termScanRun';
import type { WorkPage } from '../../src/contracts/reading';

afterEach(cleanup);

type BatchFill = RenewalSnapshot['batchFill'];

const chapters = [1, 2].map((ordinal) => ({
  workId: 'n1234ab',
  chapterId: `n1234ab/${ordinal}`,
  canonicalUrl: `https://ncode.syosetu.com/n1234ab/${ordinal}/`,
  title: `${ordinal}화 제목`,
  ordinal,
}));
const work: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  chapters,
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
};

function reviewRecord(candidates = THREE): BatchRecord {
  return {
    schemaVersion: 1,
    id: 'batch-1',
    createdAt: '2026-10-10T00:00:00Z',
    work,
    selection: {
      connection: { provider: 'openai-compatible', baseUrl: 'http://localhost:1234', revision: 1 },
      modelId: 'local',
    },
    chapters,
    retranslate: false,
    alreadySaved: 0,
    cursor: 0,
    completed: 0,
    skipped: 0,
    phase: 'prepared',
    scan: { status: 'review', candidates },
  };
}
const THREE = [
  { source: 'アルベルト', kind: 'ruby' as const, count: 3, chapterIds: ['n1234ab/1'] },
  { source: 'ミカエル', kind: 'katakana' as const, count: 2, chapterIds: ['n1234ab/2'] },
  { source: 'サーバー', kind: 'katakana' as const, count: 2, chapterIds: ['n1234ab/2'] },
];

function change(overrides: Partial<TermScanChange> & Pick<TermScanChange, 'source' | 'after'>) {
  return {
    role: 'new',
    kind: 'real',
    category: '고유명사',
    confidence: 'high',
    reason: '인명',
    evidence: [],
    ...overrides,
  } as TermScanChange;
}

function doneFill(result: RangeJudgeResult, recordId = 'batch-1'): BatchFill {
  return { recordId, phase: 'done', result };
}

function panelProps(overrides: Partial<BatchPanelProps> = {}): BatchPanelProps {
  const batch: BatchState = {
    record: reviewRecord(),
    active: false,
    preparing: false,
    error: null,
  };
  return {
    workId: 'n1234ab',
    batch,
    batchAvailable: true,
    fillAllowed: true,
    batchFill: null,
    onFillBatch: vi.fn(),
    onCancelBatchFill: vi.fn(),
    onScanBatch: vi.fn(),
    onConfirmBatchCandidates: vi.fn(),
    ...overrides,
  };
}

const FILL_BUTTON = '정밀스캔으로 표기 채우기';

test('정밀스캔 채우기 버튼은 허용되고 후보가 있을 때만 보이며 누르면 채우기를 요청한다', () => {
  const props = panelProps();
  const { unmount } = render(<BatchPanel {...props} />);
  expect(
    screen.getByText(
      '모델이 원문 문맥과 한자 뜻을 보고 후보 표기를 채워요. 채운 표기는 확정하기 전에 고칠 수 있어요.',
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: FILL_BUTTON }));
  expect(props.onFillBatch).toHaveBeenCalledTimes(1);
  unmount();

  const hidden = render(<BatchPanel {...panelProps({ fillAllowed: false })} />);
  expect(screen.queryByRole('button', { name: FILL_BUTTON })).not.toBeInTheDocument();
  hidden.unmount();

  render(
    <BatchPanel
      {...panelProps({
        batch: { record: reviewRecord([]), active: false, preparing: false, error: null },
      })}
    />,
  );
  expect(screen.queryByRole('button', { name: FILL_BUTTON })).not.toBeInTheDocument();
});

test('진행 중에는 단계 문구와 진행 막대를 보이고 중단은 채우기 취소를 요청한다', () => {
  const props = panelProps({
    batchFill: {
      recordId: 'batch-1',
      phase: 'running',
      progress: { stage: 'judge', done: 1, total: 6 },
    },
  });
  render(<BatchPanel {...props} />);
  expect(screen.getByRole('progressbar', { name: '용어를 판정하고 있어요 · 1/6' })).toBeVisible();
  expect(screen.getByText('용어를 판정하고 있어요 · 1/6')).toBeVisible();
  expect(screen.queryByRole('button', { name: FILL_BUTTON })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '중단' }));
  expect(props.onCancelBatchFill).toHaveBeenCalledTimes(1);
});

test('완료된 결과는 제안을 후보 칸에 채우고 낮은 신뢰도와 일반어는 체크하지 않는다', () => {
  render(
    <BatchPanel
      {...panelProps({
        batchFill: doneFill({
          suggestions: [
            change({ source: 'アルベルト', after: '알베르트', confidence: 'high' }),
            change({
              source: 'ミカエル',
              after: '미카엘',
              confidence: 'low',
              reason: '음독 의심',
              kanaFlag: true,
            }),
          ],
          common: ['サーバー'],
          partial: false,
          skipped: 0,
          counts: { candidates: 3, common: 1, unchanged: 0, unanswered: 0 },
        }),
      })}
    />,
  );
  expect(screen.getByText('표기 2개를 채웠어요 · 일반어로 판정 1개')).toBeVisible();
  expect(screen.getByLabelText('アルベルト 한국어 표기')).toHaveValue('알베르트');
  expect(screen.getByLabelText('アルベルト 사용')).toBeChecked();
  expect(screen.getByLabelText('ミカエル 한국어 표기')).toHaveValue('미카엘');
  expect(screen.getByLabelText('ミカエル 사용')).not.toBeChecked();
  expect(screen.getByText('신뢰도 높음')).toBeVisible();
  expect(screen.getByText('신뢰도 낮음')).toBeVisible();
  expect(screen.getByText('발음 확인 필요')).toBeVisible();
  expect(screen.getByText('음독 의심')).toBeVisible();
  expect(screen.getByText('일반어로 판정했어요')).toBeVisible();
  expect(screen.getByLabelText('サーバー 사용')).not.toBeChecked();
  expect(screen.getByRole('button', { name: '다시 채우기' })).toBeVisible();
});

test('사용자가 고친 칸과 직접 바꾼 체크는 다시 채워도 그대로 두고, 새 결과는 다시 적용된다', () => {
  const first = doneFill({
    suggestions: [
      change({ source: 'アルベルト', after: '알베르트' }),
      change({ source: 'ミカエル', after: '미카엘', confidence: 'low' }),
    ],
    common: [],
    partial: false,
    skipped: 0,
    counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 0 },
  });
  const props = panelProps({ batchFill: first });
  const { rerender } = render(<BatchPanel {...props} />);
  fireEvent.change(screen.getByLabelText('アルベルト 한국어 표기'), {
    target: { value: '사용자표기' },
  });
  fireEvent.click(screen.getByLabelText('ミカエル 사용'));

  const second = doneFill({
    suggestions: [
      change({ source: 'アルベルト', after: '알버트' }),
      change({ source: 'ミカエル', after: '미카일', confidence: 'low' }),
    ],
    common: [],
    partial: false,
    skipped: 0,
    counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 0 },
  });
  rerender(<BatchPanel {...props} batchFill={second} />);

  expect(screen.getByLabelText('アルベルト 한국어 표기')).toHaveValue('사용자표기');
  expect(screen.getByLabelText('ミカエル 한국어 표기')).toHaveValue('미카일');
  expect(screen.getByLabelText('ミカエル 사용')).toBeChecked();
  expect(screen.getByLabelText('アルベルト 사용')).toBeChecked();

  fireEvent.click(screen.getByRole('button', { name: '다시 채우기' }));
  expect(props.onFillBatch).toHaveBeenCalledTimes(1);
});

test('판정 결과의 확인 문구는 답 없는 이름, 일부 실패, 조회 실패를 알린다', () => {
  render(
    <BatchPanel
      {...panelProps({
        batchFill: doneFill({
          suggestions: [],
          common: [],
          partial: true,
          skipped: 0,
          lookupFailed: ['wikipedia'],
          counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 2 },
        }),
      })}
    />,
  );
  expect(screen.getByText('모델이 답하지 않은 이름이 2개 있어요.')).toHaveAttribute(
    'role',
    'status',
  );
  expect(screen.getByText('일부 판정 요청이 실패해서 나머지 결과만 채웠어요.')).toHaveAttribute(
    'role',
    'status',
  );
  expect(
    screen.getByText('위키백과·위키데이터 조회가 안 돼서 그 근거 없이 판정했어요.'),
  ).toHaveAttribute('role', 'status');
});

test('실패와 중단은 각각 안내와 다시 시도 버튼을 보이고, 다른 기록의 결과는 무시한다', () => {
  const failed = panelProps({
    batchFill: {
      recordId: 'batch-1',
      phase: 'failed',
      error: '정밀스캔으로 표기를 채우지 못했어요. 연결을 확인하고 다시 시도해 주세요.',
    },
  });
  const { unmount } = render(<BatchPanel {...failed} />);
  expect(screen.getByRole('alert')).toHaveTextContent('정밀스캔으로 표기를 채우지 못했어요.');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도하기' }));
  expect(failed.onFillBatch).toHaveBeenCalledTimes(1);
  unmount();

  const cancelled = panelProps({ batchFill: { recordId: 'batch-1', phase: 'cancelled' } });
  const second = render(<BatchPanel {...cancelled} />);
  expect(screen.getByText('표기 채우기를 중단했어요.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '다시 채우기' }));
  expect(cancelled.onFillBatch).toHaveBeenCalledTimes(1);
  second.unmount();

  render(
    <BatchPanel
      {...panelProps({
        batchFill: doneFill(
          {
            suggestions: [change({ source: 'アルベルト', after: '알베르트' })],
            common: [],
            partial: false,
            skipped: 0,
            counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 0 },
          },
          'other-record',
        ),
      })}
    />,
  );
  expect(screen.queryByText(/표기 1개를 채웠어요/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: FILL_BUTTON })).toBeVisible();
});

test('다시 채우기에서 일반어로 바뀐 후보는 자동으로 채운 표기가 비고 체크가 풀린다', () => {
  const first = doneFill({
    suggestions: [
      change({ source: 'アルベルト', after: '알베르트' }),
      change({ source: 'ミカエル', after: '미카엘' }),
    ],
    common: [],
    partial: false,
    skipped: 0,
    counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 0 },
  });
  const props = panelProps({ batchFill: first });
  const { rerender } = render(<BatchPanel {...props} />);
  expect(screen.getByLabelText('アルベルト 사용')).toBeChecked();
  expect(screen.getByLabelText('アルベルト 한국어 표기')).toHaveValue('알베르트');

  const second = doneFill({
    suggestions: [change({ source: 'ミカエル', after: '미카엘' })],
    common: ['アルベルト'],
    partial: false,
    skipped: 0,
    counts: { candidates: 3, common: 1, unchanged: 0, unanswered: 0 },
  });
  rerender(<BatchPanel {...props} batchFill={second} />);

  expect(screen.getByLabelText('アルベルト 한국어 표기')).toHaveValue('');
  expect(screen.getByLabelText('アルベルト 사용')).not.toBeChecked();
  expect(screen.getByText('일반어로 판정했어요')).toBeVisible();
  expect(screen.getByLabelText('ミカエル 한국어 표기')).toHaveValue('미카엘');
  expect(screen.getByLabelText('ミカエル 사용')).toBeChecked();
});

test('일반어로 바뀐 후보라도 사용자가 고친 표기와 직접 바꾼 체크는 그대로다', () => {
  const first = doneFill({
    suggestions: [
      change({ source: 'アルベルト', after: '알베르트' }),
      change({ source: 'ミカエル', after: '미카엘', confidence: 'low' }),
    ],
    common: [],
    partial: false,
    skipped: 0,
    counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 0 },
  });
  const props = panelProps({ batchFill: first });
  const { rerender } = render(<BatchPanel {...props} />);
  fireEvent.change(screen.getByLabelText('アルベルト 한국어 표기'), {
    target: { value: '사용자표기' },
  });
  expect(screen.getByLabelText('ミカエル 사용')).not.toBeChecked();
  fireEvent.click(screen.getByLabelText('ミカエル 사용'));

  const second = doneFill({
    suggestions: [],
    common: ['アルベルト', 'ミカエル'],
    partial: false,
    skipped: 0,
    counts: { candidates: 3, common: 2, unchanged: 0, unanswered: 0 },
  });
  rerender(<BatchPanel {...props} batchFill={second} />);

  expect(screen.getByLabelText('アルベルト 한국어 표기')).toHaveValue('사용자표기');
  expect(screen.getByLabelText('アルベルト 사용')).not.toBeChecked();
  expect(screen.getByLabelText('ミカエル 한국어 표기')).toHaveValue('');
  expect(screen.getByLabelText('ミカエル 사용')).toBeChecked();
});

test('이름 상한으로 판정하지 못한 후보가 있으면 완료 구역에 안내하고, 없으면 안내하지 않는다', () => {
  const capped = doneFill({
    suggestions: [change({ source: 'アルベルト', after: '알베르트' })],
    common: [],
    partial: false,
    skipped: 5,
    counts: { candidates: 200, common: 0, unchanged: 0, unanswered: 0 },
  });
  const { unmount } = render(<BatchPanel {...panelProps({ batchFill: capped })} />);
  expect(
    screen.getByText(
      '이번에 판정하지 못한 후보가 5개 있어요. 한 번에 등장 횟수가 많은 200개까지 판정해요. 나머지는 직접 확인해 주세요.',
    ),
  ).toHaveAttribute('role', 'status');
  unmount();

  render(
    <BatchPanel
      {...panelProps({
        batchFill: doneFill({
          suggestions: [change({ source: 'アルベルト', after: '알베르트' })],
          common: [],
          partial: false,
          skipped: 0,
          counts: { candidates: 3, common: 0, unchanged: 0, unanswered: 0 },
        }),
      })}
    />,
  );
  expect(screen.queryByText(/판정하지 못한 후보가/)).not.toBeInTheDocument();
});

function recordWith(overrides: Partial<BatchRecord>): BatchRecord {
  return { ...reviewRecord(), ...overrides };
}

function renderRecord(record: BatchRecord, props: Partial<BatchPanelProps> = {}) {
  return panelProps({
    batch: { record, active: false, preparing: false, error: null },
    onRunBatch: vi.fn(),
    ...props,
  });
}

test('확인 필요 상태는 로컬 서버면 재요청 비용 없는 문구와 재개 버튼을 보인다', () => {
  const props = renderRecord(recordWith({ phase: 'unknown', scan: undefined }));
  render(<BatchPanel {...props} />);
  expect(
    screen.getByText(
      '서버에서 응답을 받지 못했어요. 한 번 다시 보냈지만 결과를 확인하지 못했어요. 재개하면 이 회차를 다시 요청해요.',
    ),
  ).toBeVisible();
  expect(screen.queryByText(/비용이 생길 수/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '일괄 번역 재개' }));
  expect(props.onRunBatch).toHaveBeenCalledWith(true);
  expect(
    screen.getByText(
      '재개하지 않으려면 위에서 범위를 새로 확인해 주세요. 완료한 회차는 그대로 남아요.',
    ),
  ).toBeVisible();
});

test('확인 필요 상태는 Gemini 연결이면 중복·비용 문구와 기존 버튼 문구를 보인다', () => {
  const props = renderRecord(
    recordWith({
      phase: 'unknown',
      scan: undefined,
      selection: {
        connection: {
          provider: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com',
          revision: 1,
        },
        modelId: 'gemini-2.5-flash',
      },
    }),
  );
  render(<BatchPanel {...props} />);
  expect(
    screen.getByText(
      '이전 요청 결과를 확인할 수 없어요. 다시 요청하면 중복으로 처리되거나 비용이 생길 수 있어요.',
    ),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: '중복 처리 가능성을 확인하고 일괄 번역 재개' }),
  );
  expect(props.onRunBatch).toHaveBeenCalledWith(true);
});

test('중단 상태는 범위를 새로 확인하라는 안내를 재개 버튼 다음에 보인다', () => {
  render(<BatchPanel {...renderRecord(recordWith({ phase: 'paused', scan: undefined }))} />);
  expect(screen.getByText('일괄 번역이 중단됐어요. 완료본은 그대로 남아 있어요.')).toBeVisible();
  expect(screen.getByText('재개하지 않으려면 위에서 범위를 새로 확인해 주세요.')).toBeVisible();
});

test('이미 저장한 회차 안내는 같은 모델·용어집 조건을 밝힌다', () => {
  render(<BatchPanel {...renderRecord(recordWith({ alreadySaved: 2 }))} />);
  expect(screen.getByText('같은 모델·용어집으로 이미 저장한 2화는 건너뛰어요.')).toBeVisible();
});
