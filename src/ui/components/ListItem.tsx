import type { JSX, ReactNode } from 'react';

export function ListItem({
  headline,
  supporting,
  leading,
  trailing,
  onClick,
  current = false,
  lang,
}: {
  headline: ReactNode;
  supporting?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick(): void;
  current?: boolean;
  lang?: string;
}): JSX.Element {
  const classes = ['nr-list-item'];
  if (supporting) classes.push('nr-list-item--two-line');
  if (current) classes.push('nr-list-item--current');
  return (
    <div className={classes.join(' ')}>
      <button
        type="button"
        className="nr-list-item__main"
        aria-current={current ? 'true' : undefined}
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
              <span className="nr-list-item__supporting">{supporting}</span>
            </>
          )}
        </span>
      </button>
      {trailing && <span className="nr-list-item__trailing">{trailing}</span>}
    </div>
  );
}
