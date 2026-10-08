// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { BottomSheet, Dialog } from '../../../src/ui/components/Modal';
import { Button } from '../../../src/ui/components/Button';
import { pushBackHandler, runTopBackHandler } from '../../../src/ui/shell/backStack';
afterEach(cleanup);

function Harness({ sheet = false, onClose }: { sheet?: boolean; onClose?(): void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose?.();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        열기
      </button>
      {sheet ? (
        <BottomSheet open={open} title="13화" onClose={close}>
          <button type="button">제목 번역하기</button>
        </BottomSheet>
      ) : (
        <Dialog
          open={open}
          title="작품 B를 서재에서 제거할까요?"
          onClose={close}
          actions={
            <>
              <Button variant="text" onClick={close}>
                닫기
              </Button>
              <Button variant="text" tone="danger">
                제거하기
              </Button>
            </>
          }
        >
          <p>삭제한 내용은 되돌릴 수 없어요.</p>
        </Dialog>
      )}
    </>
  );
}

// 뒤로 가기 핸들러는 상태를 바꾸므로 act 안에서 실행해 렌더 결과를 반영한다.
function runBackInAct(): boolean {
  let handled = false;
  act(() => {
    handled = runTopBackHandler();
  });
  return handled;
}

function mockHitTarget(target: Element): () => void {
  const previous = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => target,
  });
  return () => {
    if (previous) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previous,
      });
    } else Reflect.deleteProperty(document, 'elementFromPoint');
  };
}

function fireBackdropTap(dialog: HTMLElement, hit: Element = dialog, pointerId = 7): void {
  const restoreHitTarget = mockHitTarget(hit);
  fireEvent.pointerDown(dialog, { pointerId, clientX: 1, clientY: 1 });
  fireEvent.pointerUp(dialog, { pointerId, clientX: 1, clientY: 1 });
  fireEvent.click(dialog, { detail: 1, pointerId });
  restoreHitTarget();
}

describe('backStack', () => {
  it('runs the most recent handler first and unregisters', () => {
    const calls: string[] = [];
    const removeA = pushBackHandler(() => calls.push('a'));
    const removeB = pushBackHandler(() => calls.push('b'));
    expect(runTopBackHandler()).toBe(true);
    removeB();
    expect(runTopBackHandler()).toBe(true);
    removeA();
    expect(runTopBackHandler()).toBe(false);
    expect(calls).toEqual(['b', 'a']);
  });
});

describe.each([false, true])('modal surface (sheet=%s)', (sheet) => {
  const title = sheet ? '13화' : '작품 B를 서재에서 제거할까요?';
  it('opens labelled by its title, focuses the title and restores focus on close', () => {
    render(<Harness sheet={sheet} />);
    const opener = screen.getByRole('button', { name: '열기' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: title });
    expect(dialog).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: title })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
  it('closes from the system back handler while open', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    expect(runBackInAct()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runBackInAct()).toBe(false);
  });
  it('closes once when a pointer starts and ends on the scrim', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog', { name: title });
    fireBackdropTap(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not treat a click without a pointer gesture as a scrim dismissal', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog', { name: title });
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeVisible();
  });

  it('ignores the compatibility click retargeted from an outside long-press', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    const opener = screen.getByRole('button', { name: '열기' });
    fireEvent.pointerDown(opener, { pointerId: 11, clientX: 12, clientY: 12 });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: title });

    // 롱프레스의 pointerdown은 article/opener에서 시작했고, 새 dialog에는 release/click만 도착한다.
    fireEvent.pointerUp(dialog, { pointerId: 11, clientX: 12, clientY: 12 });
    fireEvent.mouseDown(dialog);
    fireEvent.mouseUp(dialog);
    fireEvent.click(dialog, { detail: 1, pointerId: 11 });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: title })).toBeVisible();
  });

  it('does not close when a pointer starts inside and releases on the scrim', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog', { name: title });
    const surface = dialog.querySelector('.nr-modal__surface')!;
    const restoreHitTarget = mockHitTarget(dialog);
    fireEvent.pointerDown(surface, { pointerId: 12 });
    fireEvent.pointerUp(dialog, { pointerId: 12, clientX: 1, clientY: 1 });
    fireEvent.click(dialog, { detail: 1, pointerId: 12 });
    restoreHitTarget();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: title })).toBeVisible();
  });

  it('does not close when a scrim gesture releases inside the surface', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog', { name: title });
    const surface = dialog.querySelector('.nr-modal__surface')!;
    const restoreHitTarget = mockHitTarget(surface);
    fireEvent.pointerDown(dialog, { pointerId: 13 });
    fireEvent.pointerUp(dialog, { pointerId: 13, clientX: 1, clientY: 1 });
    fireEvent.click(dialog, { detail: 1, pointerId: 13 });
    restoreHitTarget();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: title })).toBeVisible();
  });

  it('clears a canceled backdrop gesture before a later click', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    const dialog = screen.getByRole('dialog', { name: title });
    fireEvent.pointerDown(dialog, { pointerId: 14 });
    fireEvent.pointerCancel(dialog, { pointerId: 14 });
    fireEvent.click(dialog, { detail: 1, pointerId: 14 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not carry a backdrop gesture across close and reopen', () => {
    const onClose = vi.fn();
    render(<Harness sheet={sheet} onClose={onClose} />);
    const opener = screen.getByRole('button', { name: '열기' });
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: title });
    const restoreHitTarget = mockHitTarget(dialog);
    fireEvent.pointerDown(dialog, { pointerId: 15 });
    fireEvent.pointerUp(dialog, { pointerId: 15, clientX: 1, clientY: 1 });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('dialog', { name: title }), {
      detail: 1,
      pointerId: 15,
    });
    restoreHitTarget();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: title })).toBeVisible();
  });
});

it('full-screen dialog has a close icon and a confirm action', () => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <Dialog
      open
      title="용어집 편집하기"
      onClose={onClose}
      fullScreen={{ confirmLabel: '저장하기', onConfirm }}
    >
      <p>본문</p>
    </Dialog>,
  );
  fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Escape in a nested dialog closes only the inner dialog', () => {
  const outer = vi.fn();
  const inner = vi.fn();
  render(
    <Dialog open title="바깥 대화상자" onClose={outer}>
      <Dialog open title="안쪽 대화상자" onClose={inner}>
        <p>안쪽 본문</p>
      </Dialog>
    </Dialog>,
  );
  fireEvent.keyDown(screen.getByRole('dialog', { name: '안쪽 대화상자' }), { key: 'Escape' });
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
});

it('keeps opted-in content mounted while hiding it from roles, focus order and back handling', () => {
  function Persistent() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          용어집 열기
        </button>
        <Dialog
          open={open}
          title="작품 용어집"
          onClose={() => setOpen(false)}
          keepMounted
          fullScreen
        >
          <label>
            용어 입력
            <input aria-label="용어 입력" />
          </label>
        </Dialog>
      </>
    );
  }
  const { container } = render(<Persistent />);
  const opener = screen.getByRole('button', { name: '용어집 열기' });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.change(screen.getByRole('textbox', { name: '용어 입력' }), {
    target: { value: '왕도' },
  });
  const openDialog = screen.getByRole('dialog', { name: '작품 용어집' });
  fireEvent.keyDown(openDialog, { key: 'Escape' });
  const closed = container.querySelector('dialog')!;
  expect(closed).toHaveAttribute('hidden');
  expect(closed).toHaveAttribute('inert');
  expect(closed).not.toHaveAttribute('open');
  expect(closed).not.toHaveAttribute('aria-modal');
  expect(screen.queryByRole('dialog', { name: '작품 용어집' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: '용어 입력' })).toBeNull();
  expect(opener).toHaveFocus();
  expect(runBackInAct()).toBe(false);
  fireEvent.click(opener);
  expect(screen.getByRole('textbox', { name: '용어 입력' })).toHaveValue('왕도');
});

it('full-screen close-only mode remains compatible and basic dialogs still unmount', () => {
  const { rerender, container } = render(
    <Dialog open title="대화상자" onClose={() => {}}>
      <p>임시 내용</p>
    </Dialog>,
  );
  expect(screen.getByRole('dialog', { name: '대화상자' })).toBeTruthy();
  rerender(
    <Dialog open={false} title="대화상자" onClose={() => {}}>
      <p>임시 내용</p>
    </Dialog>,
  );
  expect(container.querySelector('dialog')).toBeNull();
  rerender(
    <Dialog open title="전체 화면" onClose={() => {}} fullScreen>
      <p>전체 화면 내용</p>
    </Dialog>,
  );
  expect(screen.getByRole('dialog', { name: '전체 화면' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '저장하기' })).toBeNull();
});

it('native cancel in a nested dialog closes only the inner dialog', () => {
  const outer = vi.fn();
  const inner = vi.fn();
  render(
    <Dialog open title="바깥 대화상자" onClose={outer}>
      <Dialog open title="안쪽 대화상자" onClose={inner}>
        <p>안쪽 본문</p>
      </Dialog>
    </Dialog>,
  );
  const nestedDialog = screen.getByRole('dialog', { name: '안쪽 대화상자' });
  fireEvent(nestedDialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
});
