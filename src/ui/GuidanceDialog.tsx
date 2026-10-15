import { useLayoutEffect, useRef, useState, type JSX } from 'react';
import { GuidancePanel, type GuidancePanelProps, type GuidancePanelState } from './GuidancePanel';
import { Dialog } from './components/Modal';
import { Button } from './components/Button';

/** 작품 화면은 닫힌 초안을 유지하고, 리더는 버리기 확인 뒤 닫는다. 저장 규칙은 공유한다. */
export function GuidanceDialog({
  open = true,
  retainDraftOnClose = false,
  onClose,
  ...panel
}: GuidancePanelProps & {
  open?: boolean;
  retainDraftOnClose?: boolean;
  onClose(): void;
}): JSX.Element {
  const body = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GuidancePanelState>({
    dirty: false,
    saving: false,
    canSave: false,
  });
  const [discard, setDiscard] = useState(false);
  const latestState = useRef(state);
  useLayoutEffect(() => {
    latestState.current = state;
  }, [state]);
  function requestClose(): void {
    if (latestState.current.saving) return;
    if (latestState.current.dirty && !retainDraftOnClose) setDiscard(true);
    else onClose();
  }
  return (
    <>
      <Dialog
        open={open}
        keepMounted
        title="작품 용어집"
        onClose={requestClose}
        fullScreen={{
          confirmLabel: '저장하기',
          confirmDisabled: !state.canSave,
          onConfirm: () =>
            body.current?.querySelector<HTMLButtonElement>('[data-guidance-save]')?.click(),
        }}
      >
        <div ref={body}>
          <GuidancePanel {...panel} onStateChange={setState} />
        </div>
      </Dialog>
      <Dialog
        open={discard}
        title="변경 사항을 버릴까요?"
        onClose={() => setDiscard(false)}
        actions={
          <>
            <Button variant="text" onClick={() => setDiscard(false)}>
              계속 편집하기
            </Button>
            <Button variant="text" onClick={onClose}>
              변경 버리고 닫기
            </Button>
          </>
        }
      >
        <p>저장하지 않은 변경 사항은 사라져요. 저장한 용어집은 그대로 남아요.</p>
      </Dialog>
    </>
  );
}
