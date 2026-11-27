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
  // 제목이나 기준 제목이 바뀌면 새 화면으로 본다. 화면 안 제목이 있으면 숨긴 채 시작해,
  // 판정 전에 보였던 제목이 전환 효과로 사라지는 깜빡임을 막는다(#463).
  const titleKey = `${revealTitleAfter ?? ''}\n${title}`;
  const [titleState, setTitleState] = useState({ key: titleKey, shown: !revealTitleAfter });
  const titleShown = titleState.key === titleKey ? titleState.shown : !revealTitleAfter;
  useEffect(() => {
    const update = () => {
      setScrolled(window.scrollY > 0);
      const heading = revealTitleAfter ? document.querySelector(revealTitleAfter) : null;
      const barBottom = bar.current?.getBoundingClientRect().bottom ?? 0;
      // 제목을 찾지 못하면 앱바 제목을 그대로 보인다.
      const shown = !heading || heading.getBoundingClientRect().bottom <= barBottom;
      setTitleState((current) =>
        current.key === titleKey && current.shown === shown ? current : { key: titleKey, shown },
      );
    };
    update();
    // 화면 제목은 앱바보다 늦게 그려질 수 있어 다음 프레임에 한 번 더 확인한다.
    const frame = requestAnimationFrame(update);
    // 리더처럼 창이 아닌 내부 영역이 스크롤되는 화면도 따라가도록 캡처 단계에서 듣는다.
    window.addEventListener('scroll', update, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, { capture: true });
    };
  }, [revealTitleAfter, titleKey]);
  const Title = titleAs;
  return (
    <header ref={bar} className="nr-top-app-bar" data-scrolled={scrolled}>
      {navigation && <span className="nr-top-app-bar__navigation">{navigation}</span>}
      {/* 서재→목차처럼 앱바가 유지되는 화면 전환에서도 제목 요소를 새로 만들어 숨김 전환 효과를 건너뛴다. */}
      <Title
        key={titleKey}
        className={`nr-top-app-bar__title${titleShown ? '' : ' nr-top-app-bar__title--concealed'}`}
        aria-hidden={titleShown ? undefined : true}
      >
        {title}
      </Title>
      {actions && <span className="nr-top-app-bar__actions">{actions}</span>}
    </header>
  );
}
