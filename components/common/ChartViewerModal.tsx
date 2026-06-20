import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import AssetTrendChart, { AssetTrendChartProps } from '../AssetTrendChart';

interface ChartViewerModalProps extends AssetTrendChartProps {
  onClose: () => void;
}

/**
 * 개별 차트 전체화면 뷰어 — `AssetTrendChart`를 fillParent로 크게 렌더.
 * 포트폴리오 테이블/모바일 카드/관심종목에서 공용으로 호출.
 * Esc·백드롭 클릭으로 닫힘, 열려 있는 동안 body 스크롤 잠금.
 */
const ChartViewerModal: React.FC<ChartViewerModalProps> = ({ onClose, ...chartProps }) => {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full h-full sm:w-[95vw] sm:h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-1.5 right-1.5 z-20 p-1.5 rounded-full bg-gray-700/80 hover:bg-gray-600 text-gray-200 transition-colors"
          title="닫기 (Esc)"
          aria-label="차트 닫기"
        >
          <X className="h-5 w-5" />
        </button>
        <AssetTrendChart {...chartProps} fillParent />
      </div>
    </div>,
    document.body
  );
};

export default ChartViewerModal;
