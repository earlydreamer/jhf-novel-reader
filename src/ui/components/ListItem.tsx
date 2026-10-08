import type { JSX, MouseEvent, ReactNode } from 'react';

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
}): JSX.Element {
  const classes = ['nr-list-item'];
  if (supporting) classes.push('nr-list-item--two-line');
  if (current) classes.push('nr-list-item--current');
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
      </button>
      {trailing && <span className="nr-list-item__trailing">{trailing}</span>}
    </div>
  );
}
