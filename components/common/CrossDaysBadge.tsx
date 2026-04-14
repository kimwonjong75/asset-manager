import React from 'react';
import Tooltip from './Tooltip';

interface CrossDaysBadgeProps {
  /** 양수 = 골든크로스 N거래일 전, 음수 = 데드크로스 N거래일 전, null = 미표시 */
  crossDays: number | null | undefined;
}

const CrossDaysBadge: React.FC<CrossDaysBadgeProps> = ({ crossDays }) => {
  if (crossDays === null || crossDays === undefined) return null;

  const isDead = crossDays < 0;
  const days = Math.abs(crossDays);

  const label = isDead ? 'DC' : 'GC';
  const daysText = days === 0 ? '오늘' : `${days}일전`;
  const isRecent = days <= 5;

  const bgClass = isDead
    ? isRecent ? 'bg-purple-600 text-white' : 'bg-purple-900/60 text-purple-300'
    : isRecent ? 'bg-amber-600 text-white' : 'bg-amber-900/60 text-amber-300';

  const tooltipText = isDead
    ? `데드크로스 ${daysText} 발생 (단기MA < 장기MA)`
    : `골든크로스 ${daysText} 발생 (단기MA > 장기MA)`;

  return (
    <Tooltip content={tooltipText} position="top">
      <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold ${bgClass} whitespace-nowrap`}>
        {label} {daysText}
      </span>
    </Tooltip>
  );
};

export default CrossDaysBadge;
