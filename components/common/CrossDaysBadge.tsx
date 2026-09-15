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

  // Stage D2 — 교차는 위험이 아니라 지표 상태 → 스마트 필터 칩(골든/데드크로스 = bg-primary-dark)과 같은 중립 처리.
  // GC/DC 는 색이 아니라 라벨('GC'/'DC')과 툴팁 문구로 구분한다(빨강/파랑은 가격 방향, 주황은 위험 전용).
  // 최근(5거래일 이내) = bg-primary-dark + 흰 글자 6.29 · 지난 교차 = bg-surface-muted + text-gray-300 9.48 (AA 통과).
  const bgClass = isRecent ? 'bg-primary-dark text-white' : 'bg-surface-muted text-gray-300';

  const tooltipText = isDead
    ? `데드크로스 ${daysText} 발생 (단기MA < 장기MA)`
    : `골든크로스 ${daysText} 발생 (단기MA > 장기MA)`;

  return (
    <Tooltip content={tooltipText} position="top">
      <span
        className={`inline-block ml-1 text-xs px-1.5 py-0.5 rounded font-bold ${bgClass} whitespace-nowrap origin-center`}
        style={{ transform: 'scaleY(0.8)' }}
      >
        {label} {daysText}
      </span>
    </Tooltip>
  );
};

export default CrossDaysBadge;
