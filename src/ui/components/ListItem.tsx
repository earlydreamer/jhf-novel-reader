import type { JSX, MouseEvent, ReactNode } from 'react';
import { Icon } from './Icon';

export function ListItem({
  headline,
  supporting,
  leading,
  trailing,
  onClick,
  current = false,
  lang,
  disabled = false,
  onContextMenu,
  mainLabel,
  supportingId,
  navigates = false,
}: {
  headline: ReactNode;
  supporting?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick(): void;
  current?: boolean;
  lang?: string;
  disabled?: boolean;
  onContextMenu?(event: MouseEvent<HTMLDivElement>): void;
  mainLabel?: string;
  supportingId?: string;
  navigates?: boolean;
}): JSX.Element {
  const classes = ['nr-list-item'];
  if (supporting) classes.push('nr-list-item--two-line');
  if (current) classes.push('nr-list-item--current');
  if (navigates) classes.push('nr-list-item--navigates');
  return (
    <div className={classes.join(' ')} onContextMenu={onContextMenu}>
      <button
        type="button"
        className="nr-list-item__main"
        aria-current={current ? 'true' : undefined}
        aria-label={mainLabel}
        aria-describedby={supporting && supportingId ? supportingId : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {leading && <span className="nr-list-item__leading">{leading}</span>}
        <span className="nr-list-item__text">
          <span className="nr-list-item__headline" lang={lang}>
            {headline}
          </span>
          {supporting && (
            <>
              {' '}
              <span id={supportingId} className="nr-list-item__supporting">
                {supporting}
              </span>
            </>
          )}
        </span>
        {navigates && (
          <span className="nr-list-item__chevron">
            <Icon name="chevron_right" />
          </span>
        )}
      </button>
      {trailing && <span className="nr-list-item__trailing">{trailing}</span>}
    </div>
  );
}
