// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopAppBar } from '../../../src/ui/components/TopAppBar';
import { IconButton } from '../../../src/ui/components/IconButton';
import { ExtendedFab } from '../../../src/ui/components/ExtendedFab';
import { FloatingToolbar } from '../../../src/ui/components/FloatingToolbar';
import { Switch } from '../../../src/ui/components/Switch';
import { LinearProgress } from '../../../src/ui/components/LinearProgress';
import { StatusPill } from '../../../src/ui/components/StatusPill';
import {
  SnackbarProvider,
  useSnackbar,
  useSnackbarOffset,
} from '../../../src/ui/components/Snackbar';
afterEach(cleanup);

function providerWith(offset: number) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SnackbarProvider offset={offset}>{children}</SnackbarProvider>;
  };
}

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

  it('화면 제목이 앱바 아래로 사라질 때까지 앱바 제목을 숨긴다', () => {
    const heading = document.createElement('h1');
    heading.className = 'page-heading';
    document.body.append(heading);
    let headingBottom = 200;
    heading.getBoundingClientRect = () => ({ bottom: headingBottom }) as DOMRect;
    render(<TopAppBar title="합성 작품" titleAs="span" revealTitleAfter=".page-heading" />);
    const title = document.querySelector('.nr-top-app-bar__title')!;
    expect(title).toHaveClass('nr-top-app-bar__title--concealed');
    expect(title).toHaveAttribute('aria-hidden', 'true');

    headingBottom = -10;
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(title).not.toHaveClass('nr-top-app-bar__title--concealed');
    expect(title).not.toHaveAttribute('aria-hidden');
    heading.remove();
  });

  it('창이 아닌 내부 영역이 스크롤돼도 앱바 제목을 다시 판정한다', () => {
    const article = document.createElement('article');
    const heading = document.createElement('h1');
    heading.className = 'inner-heading';
    article.append(heading);
    document.body.append(article);
    let headingBottom = 200;
    heading.getBoundingClientRect = () => ({ bottom: headingBottom }) as DOMRect;
    render(<TopAppBar title="1화 제목" titleAs="span" revealTitleAfter=".inner-heading" />);
    const title = document.querySelector('.nr-top-app-bar__title')!;
    expect(title).toHaveClass('nr-top-app-bar__title--concealed');

    headingBottom = -10;
    act(() => {
      article.dispatchEvent(new Event('scroll'));
    });
    expect(title).not.toHaveClass('nr-top-app-bar__title--concealed');
    article.remove();
  });

  it('지정한 화면 제목이 없으면 앱바 제목을 그대로 보인다', () => {
    render(<TopAppBar title="합성 작품" titleAs="span" revealTitleAfter=".missing" />);
    expect(document.querySelector('.nr-top-app-bar__title')).not.toHaveClass(
      'nr-top-app-bar__title--concealed',
    );
  });

  it('화면 안 제목을 기준으로 받으면 판정 전 첫 렌더부터 앱바 제목을 숨긴다 (#463)', () => {
    const markup = renderToStaticMarkup(
      <TopAppBar title="합성 작품" titleAs="span" revealTitleAfter=".page-heading" />,
    );
    expect(markup).toContain('nr-top-app-bar__title--concealed');
  });

  it('앱바가 유지된 채 화면이 바뀌면 제목 요소를 새로 만들어 숨긴 상태로 시작한다 (#463)', () => {
    const heading = document.createElement('h1');
    heading.className = 'page-heading';
    document.body.append(heading);
    heading.getBoundingClientRect = () => ({ bottom: 200 }) as DOMRect;
    const { rerender } = render(<TopAppBar title="서재" titleAs="span" />);
    const homeTitle = document.querySelector('.nr-top-app-bar__title')!;
    expect(homeTitle).not.toHaveClass('nr-top-app-bar__title--concealed');

    rerender(<TopAppBar title="합성 작품" titleAs="span" revealTitleAfter=".page-heading" />);
    const workTitle = document.querySelector('.nr-top-app-bar__title')!;
    // 같은 요소의 클래스만 바꾸면 opacity 전환으로 보였다가 사라진다.
    expect(workTitle).not.toBe(homeTitle);
    expect(workTitle).toHaveClass('nr-top-app-bar__title--concealed');
    heading.remove();
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

  it('className을 루트 툴바 요소에 붙인다', () => {
    render(
      <FloatingToolbar label="읽기 도구" className="nr-reader-toolbar">
        <IconButton icon="arrow_back" label="이전 화" />
      </FloatingToolbar>,
    );
    expect(screen.getByRole('toolbar', { name: '읽기 도구' })).toHaveClass(
      'nr-toolbar',
      'nr-reader-toolbar',
    );
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
    fireEvent.click(screen.getByText('끄면 직접 시작해요.'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('LinearProgress', () => {
  it('treats a non-finite value as indeterminate', () => {
    render(<LinearProgress label="계산 중" value={NaN} />);
    expect(screen.getByRole('progressbar', { name: '계산 중' })).not.toHaveAttribute(
      'aria-valuenow',
    );
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

  it('re-opens the region as a manual popover on each new message so it stays above open modals', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let show: ReturnType<typeof useSnackbar> = () => {};
    function Probe() {
      show = useSnackbar();
      return null;
    }
    Object.defineProperties(HTMLElement.prototype, {
      showPopover: {
        configurable: true,
        value: () => {
          calls.push('show');
        },
      },
      hidePopover: {
        configurable: true,
        value: () => {
          calls.push('hide');
        },
      },
    });
    try {
      render(
        <SnackbarProvider>
          <Probe />
        </SnackbarProvider>,
      );
      expect(document.querySelector('.nr-snackbar-region')).toHaveAttribute('popover', 'manual');
      expect(calls).toEqual(['show']);
      calls.length = 0;
      act(() => show('첫 메시지'));
      expect(calls).toEqual(['hide', 'show']);
      calls.length = 0;
      act(() => show('둘째 메시지'));
      expect(calls).toEqual([]);
      act(() => vi.advanceTimersByTime(4000));
      expect(calls).toEqual(['hide', 'show']);
    } finally {
      delete (HTMLElement.prototype as Partial<HTMLElement>).showPopover;
      delete (HTMLElement.prototype as Partial<HTMLElement>).hidePopover;
      vi.useRealTimers();
    }
  });

  it('lets a screen raise the offset above the provider offset and restores it on unmount', () => {
    const region = () => document.querySelector<HTMLElement>('.nr-snackbar-region')!;
    const offsetValue = () => region().style.getPropertyValue('--nr-snackbar-offset');
    const live = { mounted: true };
    const view = renderHook(() => useSnackbarOffset(72), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <SnackbarProvider>{live.mounted ? children : null}</SnackbarProvider>
      ),
    });
    expect(offsetValue()).toBe('72px');
    live.mounted = false;
    view.rerender();
    expect(offsetValue()).toBe('0px');
    cleanup();

    renderHook(() => useSnackbarOffset(20), { wrapper: providerWith(64) });
    expect(offsetValue()).toBe('64px');
    cleanup();

    renderHook(() => useSnackbarOffset(72), { wrapper: providerWith(64) });
    expect(offsetValue()).toBe('72px');
  });

  it('does nothing when no provider is mounted', () => {
    expect(() => renderHook(() => useSnackbarOffset(72))).not.toThrow();
  });
});
