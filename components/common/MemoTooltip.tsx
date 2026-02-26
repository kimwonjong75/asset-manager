import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';

interface MemoTooltipProps {
  memo: string | undefined;
  children: React.ReactNode;
}

const MemoTooltip: React.FC<MemoTooltipProps> = ({ memo, children }) => {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const tooltipRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (memo) setVisible(true);
  }, [memo]);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setPos({ x: e.clientX, y: e.clientY });
  }, []);

  if (!memo) return <>{children}</>;

  // 뷰포트 경계를 고려한 위치 계산
  const tooltipWidth = 500;
  const tooltipOffset = 16;
  let left = pos.x + tooltipOffset;
  let top = pos.y + tooltipOffset;

  if (typeof window !== 'undefined') {
    // 오른쪽 넘침 → 왼쪽에 표시
    if (left + tooltipWidth > window.innerWidth - 8) {
      left = pos.x - tooltipWidth - tooltipOffset;
    }
    // 아래쪽 넘침 → 위에 표시
    const tooltipEl = tooltipRef.current;
    if (tooltipEl) {
      const h = tooltipEl.offsetHeight;
      if (top + h > window.innerHeight - 8) {
        top = pos.y - h - tooltipOffset;
      }
    }
  }

  return (
    <>
      <span
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
      >
        {children}
      </span>
      {visible && createPortal(
        <div
          ref={tooltipRef}
          className="fixed z-[9999] pointer-events-none"
          style={{ left, top }}
        >
          <div
            className="px-4 py-3 text-sm leading-relaxed text-gray-100 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl whitespace-pre-wrap break-words"
            style={{ maxWidth: tooltipWidth }}
          >
            <div className="space-y-0.5">
              {memo.split('\n').map((line, i) => (
                <p key={i} className={line.startsWith('-') || line.startsWith('·') ? 'pl-2 text-gray-300' : ''}>
                  {line || '\u00A0'}
                </p>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default MemoTooltip;
