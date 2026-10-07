import type { JSX, KeyboardEvent, ReactNode } from 'react';
import './components.css';

export function FloatingToolbar({
  label,
  children,
  hidden = false,
}: {
  label: string;
  children: ReactNode;
  hidden?: boolean;
}): JSX.Element {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    event.preventDefault();
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  }
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={`nr-toolbar${hidden ? ' nr-toolbar--hidden' : ''}`}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
