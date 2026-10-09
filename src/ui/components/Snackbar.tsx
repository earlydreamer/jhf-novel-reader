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
const SnackbarOffsetContext = createContext<(px: number) => void>(() => {});

export function SnackbarProvider({
  children,
  offset = 0,
}: {
  children: ReactNode;
  offset?: number;
}): JSX.Element {
  const [queue, setQueue] = useState<Message[]>([]);
  const [screenOffset, setScreenOffset] = useState(0);
  const effectiveOffset = Math.max(offset, screenOffset);
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
      <SnackbarOffsetContext.Provider value={setScreenOffset}>
        {children}
        {/* 역할 없는 live 영역: 화면의 role="status" 질의와 겹치지 않는다. */}
        <div
          className="nr-snackbar-region"
          aria-live="polite"
          aria-atomic="true"
          style={{ '--nr-snackbar-offset': `${effectiveOffset}px` } as CSSProperties}
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
      </SnackbarOffsetContext.Provider>
    </SnackbarContext.Provider>
  );
}

export function useSnackbar(): Show {
  return useContext(SnackbarContext);
}

/** 화면이 스낵바 아래에 비워 둘 높이(px)를 알린다. 언마운트하면 0으로 돌아간다. M3: 스낵바는 하단 바·FAB 위에 띄운다. */
export function useSnackbarOffset(px: number): void {
  const setOffset = useContext(SnackbarOffsetContext);
  useEffect(() => {
    setOffset(px);
    return () => setOffset(0);
  }, [px, setOffset]);
}
