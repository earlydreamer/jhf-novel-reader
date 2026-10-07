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
  it('closes when the scrim (the dialog element itself) is clicked', () => {
    render(<Harness sheet={sheet} />);
    fireEvent.click(screen.getByRole('button', { name: '열기' }));
    fireEvent.click(screen.getByRole('dialog', { name: title }));
    expect(screen.queryByRole('dialog')).toBeNull();
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
