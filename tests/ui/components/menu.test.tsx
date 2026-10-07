// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
