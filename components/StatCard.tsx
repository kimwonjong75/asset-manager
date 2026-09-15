

import React from 'react';
import type { SoldPLBreakdownRow } from '../utils/soldPLBreakdown';
import { directionTextClassOf, type Direction } from '../utils/directionTone';

interface StatCardProps {
  title: string;
  value: string;
  /** 값 색 — Stage B 색 규약(빨강=오름·이익 / 파랑=내림·손실 / 회색=0). isProfit보다 우선 */
  direction?: Direction;
  /** @deprecated direction 사용. true→up(빨강), false→down(파랑) 으로 매핑된다 */
  isProfit?: boolean;
  tooltip?: string;
  onClick?: () => void;
  isAlert?: boolean;
  size?: 'normal' | 'small';
  /** 값 아래 보조 표기(라벨 좌 / 금액 우, 2줄 이내 권장). 미지정·빈 배열이면 기존 카드와 동일 */
  breakdown?: SoldPLBreakdownRow[];
}

const StatCard: React.FC<StatCardProps> = ({ title, value, direction, isProfit, tooltip, onClick, isAlert, size = 'normal', breakdown }) => {
  const valueColor = isAlert
    ? 'text-amber-300'
    : direction !== undefined
    ? directionTextClassOf(direction)
    : isProfit === undefined
    ? 'text-white'
    : isProfit
    ? 'text-up'
    : 'text-down';

  // Stage C 표면 규약 — 카드 그림자 없음, surface 토큰 + 얇은 테두리
  const containerClasses = `bg-surface-elevated border border-border-subtle ${size === 'small' ? 'p-3' : 'p-5'} rounded-card ${onClick ? 'cursor-pointer hover:bg-surface-muted transition-colors' : ''}`;
  const titleClasses = `font-medium uppercase tracking-wider ${size === 'small' ? 'text-xs' : 'text-sm'} ${isAlert ? 'text-amber-300' : 'text-gray-400'}`;
  const valueClasses = `font-bold ${size === 'small' ? 'text-2xl mt-1' : 'text-3xl mt-2'} ${valueColor}`;


  // 카드 높이 증가를 최소화 — 구분선 없이 붙이고 leading-snug로 행간 압축.
  // whitespace-nowrap으로 2줄 높이를 고정하고, 좁아지면 라벨만 말줄임(아래 truncate)으로 흡수한다.
  // 줄바꿈 허용 시 3줄이 되어 "여백 최소" 요구가 깨지고, nowrap만 두면 카드 밖으로 넘친다.
  const breakdownClasses = `leading-snug whitespace-nowrap ${size === 'small' ? 'mt-1 text-xs' : 'mt-1.5 text-xs'}`;

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
              <span className={`shrink-0 ${row.tone === 'profit' ? 'text-up' : 'text-down'}`}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StatCard;