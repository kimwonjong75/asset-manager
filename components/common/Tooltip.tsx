import React from 'react';

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

const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  position = 'top',
  className = '',
  maxWidth = 400,
  wrap = false,
}) => {
  // content가 없으면 children만 반환
  if (!content) {
    return <>{children}</>;
  }

  // 위치별 CSS 클래스
  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  // 화살표 위치별 CSS
  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-gray-900 border-x-transparent border-b-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-gray-900 border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-gray-900 border-y-transparent border-r-transparent',
    right: 'right-full top-1/2 -translate-y-1/2 border-r-gray-900 border-y-transparent border-l-transparent',
  };

  return (
    <div className={`relative inline-flex group/tooltip ${className}`}>
      {children}
      <div
        className={`
          absolute ${positionClasses[position]} z-50 w-max
          px-3.5 py-2.5 text-sm leading-relaxed text-gray-100 bg-gray-900 border border-gray-600 rounded-lg shadow-xl
          opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible
          transition-opacity duration-100 ease-out
          pointer-events-none text-left
          ${wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-nowrap'}
        `}
        style={{ maxWidth: wrap ? 340 : maxWidth }}
        role="tooltip"
      >
        {content}
        <div
          className={`absolute w-0 h-0 border-4 ${arrowClasses[position]}`}
        />
      </div>
    </div>
  );
};

export default Tooltip;
