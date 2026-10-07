import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type CSSProperties,
} from 'react';
import './components.css';

type SnackbarAction = { label: string; onAction(): void };
type Message = { id: number; text: string; action?: SnackbarAction };
type Show = (text: string, action?: SnackbarAction) => void;
const SnackbarContext = createContext<Show>(() => {});

export function SnackbarProvider({
  children,
  offset = 0,
}: {
  children: ReactNode;
  offset?: number;
}): JSX.Element {
  const [queue, setQueue] = useState<Message[]>([]);
  const next = useRef(0);
  const show = useCallback<Show>((text, action) => {
    next.current += 1;
    const id = next.current;
    setQueue((current) => [...current, { id, text, ...(action ? { action } : {}) }]);
  }, []);
  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(
      () => setQueue((items) => items.slice(1)),
      current.action ? 8000 : 4000,
    );
    return () => clearTimeout(timer);
  }, [current]);
  return (
    <SnackbarContext.Provider value={show}>
      {children}
      {/* 역할 없는 live 영역: 화면의 role="status" 질의와 겹치지 않는다. */}
      <div
        className="nr-snackbar-region"
        aria-live="polite"
        aria-atomic="true"
        style={{ '--nr-snackbar-offset': `${offset}px` } as CSSProperties}
      >
        {current && (
          <div className="nr-snackbar" key={current.id}>
            <span className="nr-snackbar__text">{current.text}</span>
            {current.action && (
              <button
                type="button"
                className="nr-snackbar__action"
                onClick={() => {
                  current.action!.onAction();
                  setQueue((items) => items.slice(1));
                }}
              >
                {current.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): Show {
  return useContext(SnackbarContext);
}
