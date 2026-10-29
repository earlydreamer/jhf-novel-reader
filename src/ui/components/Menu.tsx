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
import { ExtendedFab } from './ExtendedFab';
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
  fab = false,
  onOpenChange,
}: {
  label: string;
  items: readonly MenuItem[];
  icon?: IconName;
  /** 열기 버튼을 화면 하단의 ExtendedFab으로 그린다. 목록은 버튼 위로 펼친다. */
  fab?: boolean;
  onOpenChange?(open: boolean): void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [upward, setUpward] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      onOpenChange?.(false);
      // 다음에 열 때 아래로 먼저 펼쳐 실제 넘침을 다시 재도록 위치 상태를 되돌린다.
      setUpward(false);
      if (restoreFocus) trigger.current?.focus();
    },
    [onOpenChange],
  );
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
    const entries = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
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
      // 메뉴가 대화상자 안에 있어도 Esc는 메뉴만 닫는다.
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') close(false);
  }
  const toggle = () => {
    if (open) close();
    else {
      setOpen(true);
      onOpenChange?.(true);
    }
  };
  return (
    <div className={`nr-menu-anchor${fab ? ' nr-menu-anchor--fab' : ''}`}>
      {fab ? (
        <ExtendedFab
          ref={trigger}
          icon={icon}
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        />
      ) : (
        <IconButton
          ref={trigger}
          icon={icon}
          label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        />
      )}
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={`nr-menu${upward || fab ? ' nr-menu--up' : ''}`}
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
