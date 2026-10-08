import { useId, useLayoutEffect, useRef, type JSX, type ReactNode } from 'react';
import { useBackHandler } from '../shell/backStack';
import { Button } from './Button';
import { IconButton } from './IconButton';
import './components.css';

interface SurfaceProps {
  open: boolean;
  title: string;
  onClose(): void;
  className: string;
  children: ReactNode;
  header?(titleId: string): ReactNode;
  keepMounted?: boolean;
}

function ModalSurface({
  open,
  title,
  onClose,
  className,
  children,
  header,
  keepMounted = false,
}: SurfaceProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useBackHandler(open, onClose);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!open) {
      if (element.open && typeof element.close === 'function') element.close();
      element.removeAttribute('open');
      element.setAttribute('hidden', '');
      element.setAttribute('inert', '');
      element.removeAttribute('aria-modal');
      return;
    }
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 실제 WebView는 showModal로 최상위 레이어·배경 비활성을 얻는다. jsdom에는 없어서 open 속성으로 대체한다.
    if (typeof element.showModal === 'function') {
      if (!element.open) element.showModal();
    } else element.setAttribute('open', '');
    element.removeAttribute('hidden');
    element.removeAttribute('inert');
    element.setAttribute('aria-modal', 'true');
    element.querySelector<HTMLElement>('.nr-modal__title')?.focus();
    return () => {
      if (typeof element.close === 'function' && element.open) element.close();
      else element.removeAttribute('open');
      opener?.focus();
    };
  }, [open]);
  if (!open && !keepMounted) return null;
  return (
    <dialog
      ref={dialog}
      className={`nr-modal ${className}`}
      aria-labelledby={titleId}
      aria-modal={open ? 'true' : undefined}
      hidden={!open}
      inert={!open}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          // 중첩된 대화상자에서 Esc를 처리한 뒤 바깥 대화상자까지 닫히지 않도록 전파를 멈춘다.
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="nr-modal__surface">
        {header ? (
          header(titleId)
        ) : (
          <h2 id={titleId} tabIndex={-1} className="nr-modal__title">
            {title}
          </h2>
        )}
        {children}
      </div>
    </dialog>
  );
}

export interface DialogProps {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  actions?: ReactNode;
  fullScreen?: boolean | { confirmLabel?: string; onConfirm?(): void; confirmDisabled?: boolean };
  keepMounted?: boolean;
}
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
  fullScreen,
  keepMounted = false,
}: DialogProps): JSX.Element | null {
  const isFullScreen = !!fullScreen;
  const fullScreenConfirm = typeof fullScreen === 'object' ? fullScreen : undefined;
  if (isFullScreen)
    return (
      <ModalSurface
        open={open}
        title={title}
        onClose={onClose}
        className="nr-dialog nr-dialog--fullscreen"
        keepMounted={keepMounted}
        header={(titleId) => (
          <div className="nr-dialog__header">
            <IconButton icon="close" label="닫기" onClick={onClose} />
            <h2 id={titleId} tabIndex={-1} className="nr-modal__title">
              {title}
            </h2>
            {fullScreenConfirm?.confirmLabel && fullScreenConfirm.onConfirm && (
              <Button
                variant="text"
                disabled={fullScreenConfirm.confirmDisabled}
                onClick={fullScreenConfirm.onConfirm}
              >
                {fullScreenConfirm.confirmLabel}
              </Button>
            )}
          </div>
        )}
      >
        <div className="nr-dialog__body">{children}</div>
      </ModalSurface>
    );
  return (
    <ModalSurface
      open={open}
      title={title}
      onClose={onClose}
      className="nr-dialog"
      keepMounted={keepMounted}
    >
      <div className="nr-dialog__body">{children}</div>
      {actions && <div className="nr-dialog__actions">{actions}</div>}
    </ModalSurface>
  );
}

export function BottomSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
}): JSX.Element | null {
  return (
    <ModalSurface open={open} title={title} onClose={onClose} className="nr-sheet">
      <span className="nr-sheet__handle" aria-hidden="true" />
      {children}
    </ModalSurface>
  );
}
