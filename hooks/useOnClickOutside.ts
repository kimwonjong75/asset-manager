import { useEffect } from 'react';

export function useOnClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T>,
  handler: () => void,
  active: boolean = true
) {
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = event.target as Node | null;
      if (target && el.contains(target)) return;
      handler();
    };
    document.addEventListener('mousedown', listener, true);
    document.addEventListener('touchstart', listener, true);
    return () => {
      document.removeEventListener('mousedown', listener, true);
      document.removeEventListener('touchstart', listener, true);
    };
  }, [ref, handler, active]);
}

