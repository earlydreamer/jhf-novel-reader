// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorkScreen } from '../../src/ui/WorkScreen';
import type { WorkPage } from '../../src/contracts/reading';
import { TermScanPanel, type TermScanPanelProps } from '../../src/ui/TermScanPanel';
import type { RenewalSnapshot } from '../../src/app/renewalController';
import type { TermScanChange, TermScanResult } from '../../src/translation/termScanRun';

type ScanState = NonNullable<RenewalSnapshot['termScan']>;

afterEach(cleanup);

const lowNew: TermScanChange = {
  source: 'アルベルト',
  role: 'new',
  after: '알베르트',
  kind: 'real',
  category: '인명',
  confidence: 'low',
  reason: '한자 뜻과 문맥이 엇갈려요.',
  kanaFlag: true,
  evidence: [{ kind: 'model', note: '모델 표기 대조' }],
};
const highRecheck: TermScanChange = {
  source: '甲',
  role: 'recheck',
  before: '옛표기',
  after: '새표기',
  kind: 'real',
  category: '인명',
  confidence: 'high',
  reason: '문맥상 같은 인물이에요.',
  evidence: [],
};
const suggestion: TermScanChange = {
  source: '乙',
  role: 'suggest',
  before: '구표기',
  after: '신표기',
  kind: 'real',
  category: '지명',
  confidence: 'medium',
  reason: '사람이 고친 표기라 바꾸지 않았어요.',
  evidence: [],
};
const result: TermScanResult = {
  applied: [lowNew, highRecheck],
  confirmed: 3,
  suggestions: [suggestion],
  partial: false,
};
const done: ScanState = { workId: 'n1234ab', phase: 'done', result, handled: [] };

function renderPanel(overrides: Partial<TermScanPanelProps> = {}): TermScanPanelProps {
  const props: TermScanPanelProps = {
    workId: 'n1234ab',
    savedCount: 3,
    state: null,
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onRevert: vi.fn(),
    onApplySuggestion: vi.fn(),
    sources: { wikipedia: false, namuwiki: false },
    ...overrides,
  };
  render(<TermScanPanel {...props} />);
  return props;
}

test('시작 전에는 설명과 시작 버튼을 보이고 누르면 시작을 요청한다', () => {
  const props = renderPanel();
  expect(
    screen.getByText(
      '저장된 회차 3화의 원문에서 이름·별명을 모아, 모델이 문맥과 한자 뜻을 보고 표기를 다시 정해요. 바뀐 용어는 용어집에 바로 반영되고, 직접 고친 용어는 바꾸지 않고 제안만 보여 줘요.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByText('모델 요청이 여러 번 나가서 몇 분 걸릴 수 있어요.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '정밀스캔 시작하기' }));
  expect(props.onStart).toHaveBeenCalledTimes(1);
});

test('저장된 회차가 없으면 시작 버튼을 막는다', () => {
  renderPanel({ savedCount: 0 });
  expect(screen.getByRole('button', { name: '정밀스캔 시작하기' })).toBeDisabled();
});

test('다른 작품의 스캔 상태는 이 작품의 시작 전 화면으로 본다', () => {
  renderPanel({ state: { ...done, workId: 'n9999zz', phase: 'running', handled: [] } });
  expect(screen.getByRole('button', { name: '정밀스캔 시작하기' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '중단' })).toBeNull();
});

test.each([
  [{ stage: 'collect' as const, done: 2, total: 5 }, '저장된 회차를 읽고 있어요 · 2/5'],
  [{ stage: 'judge' as const, done: 4, total: 9 }, '용어를 판정하고 있어요 · 4/9'],
  [{ stage: 'save' as const, done: 0, total: 0 }, '용어집에 반영하고 있어요'],
])('진행 단계 %j는 문구와 진행 막대를 보이고 중단을 요청한다', (progress, text) => {
  const props = renderPanel({
    state: { workId: 'n1234ab', phase: 'running', progress, handled: [] },
  });
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '중단' }));
  expect(props.onCancel).toHaveBeenCalledTimes(1);
});

test('모르는 진행 단계는 문구 없이 진행 막대만 보인다', () => {
  renderPanel({
    state: {
      workId: 'n1234ab',
      phase: 'running',
      progress: { stage: 'mystery' as never, done: 1, total: 2 },
      handled: [],
    },
  });
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByText(/읽고 있어요|판정하고 있어요|반영하고 있어요/)).toBeNull();
});

test('완료 화면은 요약과 바꾼 용어 목록을 신뢰도 낮은 순서로 보여 준다', () => {
  renderPanel({ state: done });
  expect(screen.getByText('바꾼 용어 2개 · 확인한 용어 3개 · 제안 1개')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '바꾼 용어' })).toBeInTheDocument();
  const first = screen.getByText('アルベルト').closest('li')!;
  expect(within(first).getByText('アルベルト')).toBeInTheDocument();
  expect(within(first).getByText('새로 추가 → 알베르트')).toBeInTheDocument();
  expect(within(first).getByText('신뢰도 낮음')).toHaveClass(
    'nr-scan-confidence',
    'nr-scan-confidence--low',
  );
  expect(within(first).getByText('발음 확인 필요')).toBeInTheDocument();
  expect(within(first).getByText('한자 뜻과 문맥이 엇갈려요.')).toBeInTheDocument();
  expect(within(first).getByText('모델 표기 대조')).toBeInTheDocument();
  const second = screen.getByText('甲').closest('li')!;
  expect(within(second).getByText('甲')).toBeInTheDocument();
  expect(within(second).getByText('옛표기 → 새표기')).toBeInTheDocument();
  expect(within(second).getByText('신뢰도 높음')).toHaveClass('nr-scan-confidence--high');
  expect(within(second).queryByText('발음 확인 필요')).toBeNull();
});

test('되돌리기는 원본을 넘기고 처리한 항목은 되돌렸어요로 막는다', () => {
  const props = renderPanel({ state: done });
  const first = screen.getByText('アルベルト').closest('li')!;
  fireEvent.click(within(first).getByRole('button', { name: '되돌리기' }));
  expect(props.onRevert).toHaveBeenCalledWith('アルベルト');
  cleanup();
  renderPanel({ state: { ...done, handled: ['アルベルト'] } });
  const handled = screen.getByText('アルベルト').closest('li')!;
  expect(within(handled).getByRole('button', { name: '되돌렸어요' })).toBeDisabled();
});

test('직접 고친 용어의 제안을 보여 주고 제안 적용을 요청하며 처리하면 적용했어요로 막는다', () => {
  const props = renderPanel({ state: done });
  expect(screen.getByRole('heading', { name: '확인이 필요한 제안' })).toBeInTheDocument();
  expect(screen.getByText('지금 구표기 · 제안 신표기')).toBeInTheDocument();
  expect(screen.getByText('사람이 고친 표기라 바꾸지 않았어요.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '제안 적용' }));
  expect(props.onApplySuggestion).toHaveBeenCalledWith('乙');
  cleanup();
  renderPanel({ state: { ...done, handled: ['乙'] } });
  expect(screen.getByRole('button', { name: '적용했어요' })).toBeDisabled();
});

test('제안이 없으면 제안 섹션을 두지 않는다', () => {
  renderPanel({ state: { ...done, result: { ...result, suggestions: [] } } });
  expect(screen.queryByRole('heading', { name: '확인이 필요한 제안' })).toBeNull();
});

test('일부 판정이 실패했으면 상태 알림으로 알린다', () => {
  renderPanel({ state: { ...done, result: { ...result, partial: true } } });
  expect(screen.getByRole('status')).toHaveTextContent(
    '일부 판정 요청이 실패해서 나머지 결과만 반영했어요.',
  );
});

test('완료 화면 끝에는 리더 안내와 다시 정밀스캔하기 버튼이 있다', () => {
  const props = renderPanel({ state: done });
  expect(
    screen.getByText(
      '이미 번역한 회차는 리더 메뉴의 ‘이 화 다시 번역하기’로 새 용어집을 적용할 수 있어요.',
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 정밀스캔하기' }));
  expect(props.onStart).toHaveBeenCalledTimes(1);
});

test('실패하면 오류를 알리고 다시 시도하기로 다시 시작한다', () => {
  const props = renderPanel({
    state: { workId: 'n1234ab', phase: 'failed', error: '연결을 확인해 주세요.', handled: [] },
  });
  expect(screen.getByRole('alert')).toHaveTextContent('연결을 확인해 주세요.');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도하기' }));
  expect(props.onStart).toHaveBeenCalledTimes(1);
});

test('취소하면 용어집이 바뀌지 않았다고 알리고 다시 시작하기로 다시 시작한다', () => {
  const props = renderPanel({ state: { workId: 'n1234ab', phase: 'cancelled', handled: [] } });
  expect(screen.getByText('정밀스캔을 중단했어요. 용어집은 바뀌지 않았어요.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 시작하기' }));
  expect(props.onStart).toHaveBeenCalledTimes(1);
});

test('확인이 필요한 제안에도 신뢰도·발음 배지와 근거를 바꾼 용어와 같게 보여 준다', () => {
  const unsure: TermScanChange = {
    source: '丙',
    role: 'suggest',
    before: '옛',
    after: '새',
    kind: 'real',
    category: '인명',
    confidence: 'low',
    reason: '재스캔에서 확신이 낮아 바꾸지 않았어요.',
    kanaFlag: true,
    evidence: [{ kind: 'wikipedia', note: '위키백과 표기' }],
  };
  renderPanel({
    state: { ...done, result: { ...result, applied: [], suggestions: [unsure] } },
  });
  const item = screen.getByText('丙').closest('li')!;
  expect(within(item).getByText('지금 옛 · 제안 새')).toBeInTheDocument();
  expect(within(item).getByText('신뢰도 낮음')).toHaveClass('nr-scan-confidence--low');
  expect(within(item).getByText('발음 확인 필요')).toBeInTheDocument();
  expect(within(item).getByText('위키백과 표기')).toBeInTheDocument();
  expect(within(item).getByRole('button', { name: '제안 적용' })).toBeInTheDocument();
});

test('정밀스캔이 다시 끝나면 처리 수가 그대로여도 열어 둔 용어집을 다시 읽는다', async () => {
  const onRead = vi.fn(async () => null);
  const view = (termScan: ScanState | null) => (
    <WorkScreen
      work={workPage}
      busy={false}
      savedChapterIds={[]}
      onSelect={() => {}}
      onLoadMore={() => {}}
      guidance={{ locked: false, onRead, onSave: vi.fn() }}
      termScan={termScan}
    />
  );
  const rendered = render(view(null));
  await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1));
  rendered.rerender(view({ ...done, result: { ...result } }));
  await waitFor(() => expect(onRead.mock.calls.length).toBeGreaterThanOrEqual(2));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const before = onRead.mock.calls.length;
  rendered.rerender(view({ ...done, result: { ...result } }));
  await waitFor(() => expect(onRead.mock.calls.length).toBeGreaterThan(before));
});

const workPage: WorkPage = {
  workId: 'n1234ab',
  canonicalUrl: 'https://ncode.syosetu.com/n1234ab/',
  title: '합성 작품',
  pageUrl: 'https://ncode.syosetu.com/n1234ab/',
  nextPageUrl: null,
  complete: true,
  chapters: [
    {
      workId: 'n1234ab',
      chapterId: 'n1234ab/1',
      canonicalUrl: 'https://ncode.syosetu.com/n1234ab/1/',
      ordinal: 1,
      title: '1화 제목',
    },
  ],
};

test.each([
  [
    { wikipedia: true, namuwiki: false },
    '켜 둔 외부 조회(위키백과·위키데이터)에는 용어 이름만 보내요.',
  ],
  [{ wikipedia: false, namuwiki: true }, '켜 둔 외부 조회(나무위키)에는 용어 이름만 보내요.'],
  [
    { wikipedia: true, namuwiki: true },
    '켜 둔 외부 조회(위키백과·위키데이터, 나무위키)에는 용어 이름만 보내요.',
  ],
])('시작 전 켜 둔 조회 출처 %j를 알린다', (sources, text) => {
  renderPanel({ sources });
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(
    screen.queryByText(
      '설정에서 위키백과·나무위키 조회를 켜면 실존 인물과 작품 이름을 더 정확히 찾을 수 있어요.',
    ),
  ).toBeNull();
});

test('외부 조회를 하나도 켜지 않았으면 설정 안내를 보인다', () => {
  renderPanel();
  expect(
    screen.getByText(
      '설정에서 위키백과·나무위키 조회를 켜면 실존 인물과 작품 이름을 더 정확히 찾을 수 있어요.',
    ),
  ).toBeInTheDocument();
});

test('외부 조회 단계는 완료 수를 보여 준다', () => {
  renderPanel({
    state: {
      workId: 'n1234ab',
      phase: 'running',
      progress: { stage: 'lookup', done: 1, total: 2 },
      handled: [],
    },
  });
  expect(screen.getByText('외부 사전에서 찾아보고 있어요 · 1/2')).toBeInTheDocument();
});

test.each([
  [['wikipedia'] as const, '위키백과·위키데이터 조회가 안 돼서 그 근거 없이 판정했어요.'],
  [['namuwiki'] as const, '나무위키 조회가 안 돼서 그 근거 없이 판정했어요.'],
  [
    ['wikipedia', 'namuwiki'] as const,
    '위키백과·위키데이터, 나무위키 조회가 안 돼서 그 근거 없이 판정했어요.',
  ],
])('조회가 실패한 출처 %j는 완료 화면에서 알린다', (lookupFailed, text) => {
  renderPanel({ state: { ...done, result: { ...result, lookupFailed: [...lookupFailed] } } });
  expect(screen.getByRole('status')).toHaveTextContent(text);
});

test('실패한 조회가 없으면 조회 실패 알림을 두지 않는다', () => {
  renderPanel({ state: done });
  expect(screen.queryByText(/조회가 안 돼서/)).toBeNull();
});

test('출처가 있는 근거는 링크로 열고 출처가 없는 근거는 글만 보인다', () => {
  const linked: TermScanChange = {
    ...suggestion,
    evidence: [
      {
        kind: 'wikipedia',
        url: 'https://ko.wikipedia.org/wiki/%EC%82%AC%EC%9D%B4%ED%86%A0_%EB%8F%84%EC%82%B0',
        note: '위키백과: 사이토 도산',
      },
      { kind: 'model', note: '판정 3/3' },
    ],
  };
  renderPanel({
    state: { ...done, result: { ...result, applied: [], suggestions: [linked] } },
  });
  const link = screen.getByRole('link', { name: '위키백과: 사이토 도산' });
  expect(link).toHaveAttribute(
    'href',
    'https://ko.wikipedia.org/wiki/%EC%82%AC%EC%9D%B4%ED%86%A0_%EB%8F%84%EC%82%B0',
  );
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noreferrer');
  expect(screen.queryByRole('link', { name: '판정 3/3' })).toBeNull();
  expect(screen.getByText('판정 3/3')).toBeInTheDocument();
});
