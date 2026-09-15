// components/watchlist/BuyReadinessMarks.tsx
// 관심종목 '매수 점검' 표시 — "충족 수/3" + 조건별 PassMark 3개. 렌더 전용(계산은 utils/stockReview.computeBuyReadiness).
// 매수 추천이 아니다 — 설명 문구는 types/stockReview BUY_READINESS_TOOLTIP(헤더·모바일 정렬 바 툴팁).
// 데스크탑 표 셀과 모바일 카드가 같은 컴포넌트를 쓴다.

import React from 'react';
import PassMark from '../common/PassMark';
import { BUY_READINESS_LABEL, type BuyReadiness } from '../../types/stockReview';

interface BuyReadinessMarksProps {
  readiness: BuyReadiness | null;
  /** 모바일 카드처럼 컬럼 헤더가 없는 곳에서 '매수 점검' 라벨을 앞에 붙인다 */
  showLabel?: boolean;
  className?: string;
}

const BuyReadinessMarks: React.FC<BuyReadinessMarksProps> = ({ readiness, showLabel = false, className = '' }) => {
  const label = showLabel ? <span className="text-gray-400">{BUY_READINESS_LABEL}</span> : null;

  if (!readiness) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        {label}
        <span className="text-gray-500" aria-hidden="true">-</span>
        <span className="sr-only">매수 점검 데이터 준비 전 또는 미지원</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      {label}
      <span className="font-medium tabular-nums text-gray-200">
        {readiness.met}/{readiness.total}
        <span className="sr-only"> 조건 충족</span>
      </span>
      <span className="inline-flex items-center">
        {readiness.conditions.map(c => (
          <span key={c.key} className="inline-flex" title={c.label}>
            <span className="sr-only">{c.label}:</span>
            <PassMark state={c.state} size="sm" />
          </span>
        ))}
      </span>
    </span>
  );
};

export default BuyReadinessMarks;
