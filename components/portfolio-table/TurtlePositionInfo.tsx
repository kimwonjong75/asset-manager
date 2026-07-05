// components/portfolio-table/TurtlePositionInfo.tsx
// ---------------------------------------------------------------------------
// 터틀 오픈 포지션 읽기 전용 표시 스트립 (Phase 2b-5, 렌더 전용).
// 데스크탑 테이블 행·모바일 카드가 공유하는 단일 표시 컴포넌트.
//
// 표시 규칙(D6): 진입/손절/N/불타기 트리거는 **종목 통화(원통화)**, 리스크는 **KRW**.
//   환율 미확보(외화 rate 없음)면 리스크를 "환율 대기"로 — 0/과소값 표시 금지(fail-safe).
// **읽기 전용** — 손절선/유닛/트리거를 편집하는 UI는 만들지 않는다(계산은 터틀 엔진 소관).

import React from 'react';
import { TurtlePositionView } from '../../utils/turtlePositionView';
import { formatOriginalCurrency, formatKRW } from './utils';

interface Props {
  view: TurtlePositionView;
}

const Field: React.FC<{ label: string; children: React.ReactNode; tone?: string }> = ({ label, children, tone }) => (
  <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
    <span className="text-gray-500">{label}</span>
    <span className={`font-medium ${tone ?? 'text-gray-200'}`}>{children}</span>
  </span>
);

const TurtlePositionInfo: React.FC<Props> = ({ view }) => {
  const ccy = view.currency;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-400">
      <span className="inline-flex items-center gap-1 font-semibold text-purple-300" title="터틀(위성) 포지션 — 읽기 전용">
        <span role="img" aria-label="터틀">🐢</span>포지션
      </span>
      <Field label="유닛">{view.unitsCount}/{view.maxUnits}</Field>
      <Field label="진입">{formatOriginalCurrency(view.entryPrice, ccy)}</Field>
      <Field label="손절" tone="text-red-300">{formatOriginalCurrency(view.stopPrice, ccy)}</Field>
      <Field label="N">{formatOriginalCurrency(view.nAtLastFill, ccy)}</Field>
      <Field label="불타기" tone="text-sky-300">
        {view.pyramidTriggerPrice != null ? formatOriginalCurrency(view.pyramidTriggerPrice, ccy) : '상한 도달'}
      </Field>
      <Field label="리스크" tone={view.riskKRW != null ? 'text-amber-300' : 'text-gray-500'}>
        {view.riskKRW != null ? formatKRW(view.riskKRW) : '환율 대기'}
      </Field>
    </div>
  );
};

export default TurtlePositionInfo;
