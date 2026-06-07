import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** 툴팁 내용 (문자열 또는 JSX) */
  content: React.ReactNode;
  /** 자식 요소 (hover 대상) */
  children: React.ReactNode;
  /** 툴팁 위치 */
  position?: 'top' | 'bottom' | 'left' | 'right';
  /** 추가 CSS 클래스 */
  className?: string;
  /** 툴팁 최대 너비 (기본: 400px) */
  maxWidth?: number;
  /** 줄바꿈 허용 여부 (기본: false) - 메모 등 긴 텍스트에 사용 */
  wrap?: boolean;
}

interface TooltipCoords {
  top: number;
  left: number;
  transform: string;
}

/** trigger와 툴팁 사이 간격 (기존 Tailwind mb-2/mt-2 = 8px) */
const GAP = 8;

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  className = '',
  maxWidth = 400,
  wrap = false,
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<TooltipCoords | null>(null);

  // 화살표 위치별 CSS (툴팁 박스 기준, 기존 외형 그대로 유지)
  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900 border-y-transparent border-l-transparent',
  };

  // trigger 요소 기준으로 fixed 좌표/transform 계산
  const computeCoords = useCallback((): TooltipCoords | null => {
    const el = triggerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    switch (position) {
      case 'bottom':
        return { top: rect.bottom + GAP, left: cx, transform: 'translate(-50%, 0)' };
      case 'left':
        return { top: cy, left: rect.left - GAP, transform: 'translate(-100%, -50%)' };
      case 'right':
        return { top: cy, left: rect.right + GAP, transform: 'translate(0, -50%)' };
      case 'top':
      default:
        return { top: rect.top - GAP, left: cx, transform: 'translate(-50%, -100%)' };
    }
  }, [position]);

  const show = useCallback(() => {
    setCoords(computeCoords());
  }, [computeCoords]);

  const hide = useCallback(() => {
    setCoords(null);
  }, []);

  // 표시 중 스크롤/리사이즈 시 fixed 툴팁이 trigger와 어긋나므로 닫는다
  useEffect(() => {
    if (!coords) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [coords, hide]);

  // content가 없으면 children만 반환
  if (!content) {
    return <>{children}</>;
  }

  return (
    <div
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {coords &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{ top: coords.top, left: coords.left, transform: coords.transform }}
          >
            <div
              className={`
                relative w-max
                px-3.5 py-2.5 text-sm leading-relaxed text-gray-100 bg-gray-900 border border-gray-600 rounded-lg shadow-xl
                text-left
                ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'}
              `}
              style={{ maxWidth: wrap ? 340 : maxWidth }}
              role="tooltip"
            >
              {content}
              <div className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`} />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default Tooltip;
