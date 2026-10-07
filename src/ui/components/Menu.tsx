import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react';
import { useBackHandler } from '../shell/backStack';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import './components.css';

export interface MenuItem {
  label: string;
  onSelect(): void;
  tone?: 'danger';
  icon?: IconName;
}

export function Menu({
  label,
  items,
  icon = 'more_vert',
}: {
  label: string;
  items: readonly MenuItem[];
  icon?: IconName;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }, []);
  useBackHandler(open, () => close());
  useLayoutEffect(() => {
    if (!open || !list.current) return;
    const rect = list.current.getBoundingClientRect();
    setUpward(rect.bottom > window.innerHeight && rect.top > rect.height);
    list.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, close]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = [
      ...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => {
      event.preventDefault();
      entries[(next + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
    else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') close(false);
  }
  return (
    <div className="nr-menu-anchor">
      <IconButton
        ref={trigger}
        icon={icon}
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      />
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={`nr-menu${upward ? ' nr-menu--up' : ''}`}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`nr-menu__item${item.tone ? ` nr-menu__item--${item.tone}` : ''}`}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} size={20} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
