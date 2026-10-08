import type { CSSProperties, JSX } from 'react';
import arrowBack from '../icons/arrow_back.svg';
import check from '../icons/check.svg';
import close from '../icons/close.svg';
import deleteIcon from '../icons/delete.svg';
import moreVert from '../icons/more_vert.svg';
import settings from '../icons/settings.svg';
import link from '../icons/link.svg';
import search from '../icons/search.svg';
import './components.css';

// Material Symbols Outlined(Apache-2.0)에서 쓰는 아이콘만 복사해 둔다. 새 아이콘은 같은 방법으로 추가한다.
const icons = {
  arrow_back: arrowBack,
  check,
  close,
  delete: deleteIcon,
  link,
  more_vert: moreVert,
  search,
  settings,
} as const;
export type IconName = keyof typeof icons;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }): JSX.Element {
  const style = {
    '--nr-icon': `url("${icons[name]}")`,
    '--nr-icon-size': `${size}px`,
  } as CSSProperties;
  return <span className="nr-icon" aria-hidden="true" data-icon={name} style={style} />;
}
