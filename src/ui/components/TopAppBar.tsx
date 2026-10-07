import { useEffect, useState, type JSX, type ReactNode } from 'react';
import './components.css';

export function TopAppBar({
  title,
  titleAs = 'h1',
  navigation,
  actions,
}: {
  title: string;
  titleAs?: 'h1' | 'span';
  navigation?: ReactNode;
  actions?: ReactNode;
}): JSX.Element {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const Title = titleAs;
  return (
    <header className="nr-top-app-bar" data-scrolled={scrolled}>
      {navigation && <span className="nr-top-app-bar__navigation">{navigation}</span>}
      <Title className="nr-top-app-bar__title">{title}</Title>
      {actions && <span className="nr-top-app-bar__actions">{actions}</span>}
    </header>
  );
}
