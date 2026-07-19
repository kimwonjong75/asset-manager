import React, { useState } from 'react';
import type { EnrichedAsset } from '../../types/ui';
import { useStockReview } from '../../hooks/useStockReview';
import StockReviewPanel from './StockReviewPanel';

// StockReviewAccordion — "종목 검토 펼치기/접기" 토글 + 패널을 묶은 컨테이너.
// 토글 상태를 보유하고 useStockReview(로딩/영구결측/ViewModel 판정)를 호출한다.
// 4개 배선처(포트폴리오·관심종목 × 데스크톱·모바일)가 차트 아래에 이 컴포넌트만 렌더한다.
// (관심종목 데스크톱은 map 내부라 행별 훅 호출이 불가 → 자식 컴포넌트로 캡슐화해 rules-of-hooks 준수.)

interface StockReviewAccordionProps {
  /** 포트폴리오는 실제 EnrichedAsset, 관심종목은 watchlistToPseudoAsset(item) 결과 */
  asset: EnrichedAsset;
  source: 'portfolio' | 'watchlist';
  displayName: string;
  /** 토글 버튼을 감싸는 래퍼 패딩 (배선처별 상이) */
  className?: string;
}

const StockReviewAccordion: React.FC<StockReviewAccordionProps> = ({ asset, source, displayName, className }) => {
  const [open, setOpen] = useState(false);
  const state = useStockReview({ asset, source, displayName, enabled: open });

  return (
    <div className={className}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="mt-1 text-xs font-medium text-primary-light hover:underline"
      >
        {open ? '종목 검토 접기' : '종목 검토 펼치기'}
      </button>
      {open && <StockReviewPanel state={state} />}
    </div>
  );
};

export default StockReviewAccordion;
