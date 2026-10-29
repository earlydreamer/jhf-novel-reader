// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Dialog } from '../../../src/ui/components/Modal';
import { Menu } from '../../../src/ui/components/Menu';
import { runTopBackHandler } from '../../../src/ui/shell/backStack';
afterEach(cleanup);

function setup() {
  const home = vi.fn();
  const remove = vi.fn();
  render(
    <>
      <Menu
        label="더보기"
        items={[
          { label: '서재로 가기', onSelect: home },
          { label: '서재에서 제거하기', onSelect: remove, tone: 'danger' },
        ]}
      />
      <p>바깥</p>
    </>,
  );
  return { home, remove, trigger: screen.getByRole('button', { name: '더보기' }) };
}

// 뒤로 가기 핸들러는 상태를 바꾸므로 act 안에서 실행해 렌더 결과를 반영한다.
function runBackInAct(): boolean {
  let handled = false;
  act(() => {
    handled = runTopBackHandler();
  });
  return handled;
}

it('opens a labelled menu, focuses the first item and selects with click', () => {
  const { home, trigger } = setup();
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: '더보기' })).toBeVisible();
  expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toHaveFocus();
  fireEvent.click(screen.getByRole('menuitem', { name: '서재로 가기' }));
  expect(home).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('moves with arrow keys and closes with Escape back to the trigger', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  const menu = screen.getByRole('menu');
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: '서재에서 제거하기' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowDown' });
  expect(screen.getByRole('menuitem', { name: '서재로 가기' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'ArrowUp' });
  expect(screen.getByRole('menuitem', { name: '서재에서 제거하기' })).toHaveFocus();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(trigger).toHaveFocus();
});

it('closes on an outside pointer and on the system back handler', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByText('바깥'));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  expect(runBackInAct()).toBe(true);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('marks destructive items', () => {
  const { trigger } = setup();
  fireEvent.click(trigger);
  expect(screen.getByRole('menuitem', { name: '서재에서 제거하기' })).toHaveClass(
    'nr-menu__item--danger',
  );
});

it('flips upward on every open near the bottom edge', () => {
  // jsdom에는 레이아웃이 없어서 메뉴 위치를 흉내 낸다. 아래로 열면 화면 밖으로 넘치고, 위로 열면 트리거 위에 붙는다.
  const bottom = window.innerHeight;
  const height = 200;
  const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ): DOMRect {
    if (!this.classList.contains('nr-menu')) return { top: 0, bottom: 0, height: 0 } as DOMRect;
    const top = this.classList.contains('nr-menu--up') ? bottom - 40 - height : bottom;
    return { top, bottom: top + height, height } as DOMRect;
  });
  try {
    render(<Menu label="더보기" items={[{ label: '서재로 가기', onSelect: () => {} }]} />);
    const trigger = screen.getByRole('button', { name: '더보기' });
    for (let round = 0; round < 2; round += 1) {
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).toHaveClass('nr-menu--up');
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    }
  } finally {
    spy.mockRestore();
  }
});

it('Escape on a menu inside a dialog closes only the menu', () => {
  const onClose = vi.fn();
  render(
    <Dialog open title="작품 B를 서재에서 제거할까요?" onClose={onClose}>
      <Menu label="더보기" items={[{ label: '서재로 가기', onSelect: () => {} }]} />
    </Dialog>,
  );
  fireEvent.click(screen.getByRole('button', { name: '더보기' }));
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('dialog', { name: '작품 B를 서재에서 제거할까요?' })).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});

it('FAB 열기 버튼은 보이는 이름표를 쓰고 목록을 위로 펼친다', () => {
  const pick = vi.fn();
  render(
    <Menu fab label="작품 찾기" icon="search" items={[{ label: '나로우', onSelect: pick }]} />,
  );
  const trigger = screen.getByRole('button', { name: '작품 찾기' });
  expect(trigger).toHaveClass('nr-fab');
  expect(trigger.closest('.nr-menu-anchor')).toHaveClass('nr-menu-anchor--fab');
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('menu', { name: '작품 찾기' })).toHaveClass('nr-menu--up');
  fireEvent.click(screen.getByRole('menuitem', { name: '나로우' }));
  expect(pick).toHaveBeenCalledTimes(1);
  expect(trigger).toHaveFocus();
});
