import { useEffect, useRef } from 'react';

// 시스템 뒤로 가기를 받을 오버레이(메뉴·시트·대화상자·리더 바)를 LIFO로 쌓는다.
const handlers: (() => void)[] = [];

export function pushBackHandler(handler: () => void): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function runTopBackHandler(): boolean {
  const top = handlers[handlers.length - 1];
  if (!top) return false;
  top();
  return true;
}

export function useBackHandler(active: boolean, handler: () => void): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => (active ? pushBackHandler(() => latest.current()) : undefined), [active]);
}
