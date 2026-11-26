import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import './components.css';

export function TopAppBar({
  title,
  titleAs = 'h1',
  navigation,
  actions,
  revealTitleAfter,
}: {
  title: string;
  titleAs?: 'h1' | 'span';
  navigation?: ReactNode;
  actions?: ReactNode;
  /** 화면 안 제목의 선택자. 그 제목이 앱바 아래로 사라질 때까지 앱바 제목을 숨긴다(M3 관례). */
  revealTitleAfter?: string;
}): JSX.Element {
  const bar = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [titleShown, setTitleShown] = useState(true);
  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 0);
      const heading = revealTitleAfter ? document.querySelector(revealTitleAfter) : null;
      const barBottom = bar.current?.getBoundingClientRect().bottom ?? 0;
      // 제목을 찾지 못하면 앱바 제목을 그대로 보인다.
      setTitleShown(!heading || heading.getBoundingClientRect().bottom <= barBottom);
    };
    update();
    // 화면 제목은 앱바보다 늦게 그려질 수 있어 다음 프레임에 한 번 더 확인한다.
    const frame = requestAnimationFrame(update);
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
    };
  }, [revealTitleAfter, title]);
  const Title = titleAs;
  return (
    <header ref={bar} className="nr-top-app-bar" data-scrolled={scrolled}>
      {navigation && <span className="nr-top-app-bar__navigation">{navigation}</span>}
      <Title
        className={`nr-top-app-bar__title${titleShown ? '' : ' nr-top-app-bar__title--concealed'}`}
        aria-hidden={titleShown ? undefined : true}
      >
        {title}
      </Title>
      {actions && <span className="nr-top-app-bar__actions">{actions}</span>}
    </header>
  );
}
