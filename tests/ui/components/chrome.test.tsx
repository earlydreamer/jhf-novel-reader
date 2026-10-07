// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TopAppBar } from '../../../src/ui/components/TopAppBar';
import { IconButton } from '../../../src/ui/components/IconButton';
import { ExtendedFab } from '../../../src/ui/components/ExtendedFab';
import { FloatingToolbar } from '../../../src/ui/components/FloatingToolbar';
import { Switch } from '../../../src/ui/components/Switch';
import { LinearProgress } from '../../../src/ui/components/LinearProgress';
import { StatusPill } from '../../../src/ui/components/StatusPill';
import { SnackbarProvider, useSnackbar } from '../../../src/ui/components/Snackbar';
afterEach(cleanup);

describe('TopAppBar', () => {
  it('renders a heading title by default and plain text on request', () => {
    const { rerender } = render(<TopAppBar title="서재" />);
    expect(screen.getByRole('heading', { level: 1, name: '서재' })).toBeVisible();
    rerender(
      <TopAppBar
        title="목차"
        titleAs="span"
        navigation={<IconButton icon="arrow_back" label="뒤로 가기" />}
      />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('banner')).toHaveTextContent('목차');
    expect(screen.getByRole('button', { name: '뒤로 가기' })).toBeVisible();
  });
});

describe('ExtendedFab', () => {
  it('keeps its label as the accessible name when collapsed', () => {
    const onClick = vi.fn();
    const { rerender } = render(<ExtendedFab icon="check" label="작품 찾기" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: '작품 찾기' }));
    rerender(<ExtendedFab icon="check" label="작품 찾기" onClick={onClick} collapsed />);
    expect(screen.getByRole('button', { name: '작품 찾기' })).toHaveClass('nr-fab--collapsed');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('FloatingToolbar', () => {
  it('moves focus between its buttons with arrow keys and can be hidden', () => {
    const { rerender } = render(
      <FloatingToolbar label="읽기 도구">
        <IconButton icon="arrow_back" label="이전 화" />
        <IconButton icon="more_vert" label="목차" />
      </FloatingToolbar>,
    );
    const toolbar = screen.getByRole('toolbar', { name: '읽기 도구' });
    screen.getByRole('button', { name: '이전 화' }).focus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '목차' })).toHaveFocus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: '이전 화' })).toHaveFocus();
    rerender(
      <FloatingToolbar label="읽기 도구" hidden>
        <IconButton icon="arrow_back" label="이전 화" />
      </FloatingToolbar>,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.querySelector('.nr-toolbar')).toHaveAttribute('inert');
  });
});

describe('Switch', () => {
  it('is a labelled switch with a description', () => {
    const onChange = vi.fn();
    render(
      <Switch
        label="저장본이 없으면 자동으로 번역 시작"
        description="끄면 직접 시작해요."
        checked={false}
        onChange={onChange}
      />,
    );
    const control = screen.getByRole('switch', { name: '저장본이 없으면 자동으로 번역 시작' });
    expect(control).toHaveAccessibleDescription('끄면 직접 시작해요.');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('LinearProgress and StatusPill', () => {
  it('reports determinate progress and status with an action', () => {
    const onClick = vi.fn();
    render(
      <>
        <LinearProgress label="번역 진행" value={0.375} />
        <LinearProgress label="준비" />
        <StatusPill action={{ label: '중단', onClick }}>번역하는 중 · 3/8묶음</StatusPill>
      </>,
    );
    expect(screen.getByRole('progressbar', { name: '번역 진행' })).toHaveAttribute(
      'aria-valuenow',
      '38',
    );
    expect(screen.getByRole('progressbar', { name: '준비' })).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByRole('status')).toHaveTextContent('번역하는 중 · 3/8묶음');
    fireEvent.click(screen.getByRole('button', { name: '중단' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Snackbar', () => {
  it('shows queued messages one at a time in a live region without a status role', () => {
    vi.useFakeTimers();
    let show: ReturnType<typeof useSnackbar> = () => {};
    function Probe() {
      show = useSnackbar();
      return null;
    }
    render(
      <SnackbarProvider>
        <Probe />
      </SnackbarProvider>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    const undo = vi.fn();
    act(() => {
      show('서재에서 제거했어요');
      show('제목을 저장했어요', { label: '보기', onAction: undo });
    });
    expect(screen.getByText('서재에서 제거했어요')).toBeVisible();
    expect(screen.queryByText('제목을 저장했어요')).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('제목을 저장했어요')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '보기' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('제목을 저장했어요')).toBeNull();
    vi.useRealTimers();
  });
});
