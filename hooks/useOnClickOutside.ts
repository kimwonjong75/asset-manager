import { useEffect } from 'react';

export function useOnClickOutside<T extends HTMLElement>(
  // React 19의 `useRef<T>(null)`은 `RefObject<T | null>`을 돌려준다.
  // 본문이 이미 `if (!el) return`으로 null을 처리하므로 null 허용이 실제 동작과 일치한다.
  ref: React.RefObject<T | null>,
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

