

import React from 'react';
import type { SoldPLBreakdownRow } from '../utils/soldPLBreakdown';

interface StatCardProps {
  title: string;
  value: string;
  isProfit?: boolean;
  tooltip?: string;
  onClick?: () => void;
  isAlert?: boolean;
  size?: 'normal' | 'small';
  /** 값 아래 보조 표기(라벨 좌 / 금액 우, 2줄 이내 권장). 미지정·빈 배열이면 기존 카드와 동일 */
  breakdown?: SoldPLBreakdownRow[];
}

const StatCard: React.FC<StatCardProps> = ({ title, value, isProfit, tooltip, onClick, isAlert, size = 'normal', breakdown }) => {
  const valueColor = isAlert
    ? 'text-yellow-400'
    : isProfit === undefined 
    ? 'text-white' 
    : isProfit 
    ? 'text-success' 
    : 'text-danger';

  const containerClasses = `bg-gray-800 ${size === 'small' ? 'p-3' : 'p-6'} rounded-lg shadow-lg ${onClick ? 'cursor-pointer hover:bg-gray-700 transition-colors' : ''}`;
  const titleClasses = `font-medium uppercase tracking-wider ${size === 'small' ? 'text-xs' : 'text-sm'} ${isAlert ? 'text-yellow-400' : 'text-gray-400'}`;
  const valueClasses = `font-bold ${size === 'small' ? 'text-2xl mt-1' : 'text-3xl mt-2'} ${valueColor}`;


  // 카드 높이 증가를 최소화 — 구분선 없이 붙이고 leading-snug로 행간 압축.
  // whitespace-nowrap으로 2줄 높이를 고정하고, 좁아지면 라벨만 말줄임(아래 truncate)으로 흡수한다.
  // 줄바꿈 허용 시 3줄이 되어 "여백 최소" 요구가 깨지고, nowrap만 두면 카드 밖으로 넘친다.
  const breakdownClasses = `leading-snug whitespace-nowrap ${size === 'small' ? 'mt-1 text-[11px]' : 'mt-1.5 text-xs'}`;

  return (
    <div className={containerClasses} title={tooltip} onClick={onClick}>
      <h3 className={titleClasses}>{title}</h3>
      <p className={valueClasses}>{value}</p>
      {breakdown && breakdown.length > 0 && (
        <div className={breakdownClasses}>
          {breakdown.map(row => (
            <div key={row.label} className="flex justify-between gap-2">
              {/* 좁은 폭에서는 라벨만 말줄임 — 금액(shrink-0)은 절대 잘리지 않는다 */}
              <span className="text-gray-500 min-w-0 truncate" title={row.label}>{row.label}</span>
              <span className={`shrink-0 ${row.tone === 'profit' ? 'text-success' : 'text-danger'}`}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StatCard;