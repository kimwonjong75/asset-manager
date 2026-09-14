// components/dashboard/HomeSnapshotCard.tsx
// 홈 우측 레일 최상단 "포트폴리오 스냅샷" — 총자산(크게)·원금·평가손익·수익률·조치 필요 건수.
// 렌더 전용: 통계는 DashboardView가 계정 필터만 적용한 자산(viewAssets)으로 이미 계산해서 넘긴다
// (자산구분 필터는 스냅샷에 영향 없음 — 2026-09-14 결정). 조치 필요 건수는
// utils/todayViewModel.actionNeededCount(전체 계정 계획 행) 결과라 셀 라벨에 "(전체 계정)"을 붙인다.

import React from 'react';
import ScopeChip from '../common/ScopeChip';

export interface HomeSnapshotCardProps {
  totalValue: number;
  totalPurchaseValue: number;
  totalGainLoss: number;
  totalReturn: number;
  /** 현재 계정 선택 라벨(통합/원종/유선) */
  accountLabel: string;
  /** 조치 필요 자산 수 — 전체 계정 기준 */
  actionNeeded: number;
}

const formatKRW = (value: number) =>
  value.toLocaleString('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 });

// 손익 색은 기존 StatCard 규약(text-success/text-danger)을 유지 — 앱 전역 색 전환은 Stage B.
const plColor = (v: number) => (v >= 0 ? 'text-success' : 'text-danger');

const HomeSnapshotCard: React.FC<HomeSnapshotCardProps> = ({
  totalValue,
  totalPurchaseValue,
  totalGainLoss,
  totalReturn,
  accountLabel,
  actionNeeded,
}) => (
  <section className="rounded-card bg-surface-elevated border border-border-subtle p-4" aria-label="포트폴리오 스냅샷">
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h2 className="text-sm font-semibold text-gray-300">포트폴리오</h2>
      <ScopeChip label={`계정: ${accountLabel}`} title="위 계정 선택을 따릅니다. 자산 구분 필터는 적용되지 않습니다." />
    </div>

    <p className="mt-3 text-xs text-gray-500">총자산</p>
    <p className="text-3xl font-bold text-white tabular-nums leading-tight break-all">{formatKRW(totalValue)}</p>
    <p className="mt-1 text-xs text-gray-400">
      원금 <span className="tabular-nums text-gray-300">{formatKRW(totalPurchaseValue)}</span>
    </p>

    <dl className="mt-4 grid grid-cols-2 gap-2">
      <div className="col-span-2 rounded-lg bg-surface-muted px-3 py-2">
        <dt className="text-xs text-gray-400">평가손익</dt>
        <dd className={`text-lg font-semibold tabular-nums ${plColor(totalGainLoss)}`}>{formatKRW(totalGainLoss)}</dd>
      </div>
      <div className="rounded-lg bg-surface-muted px-3 py-2">
        <dt className="text-xs text-gray-400">수익률</dt>
        <dd className={`text-lg font-semibold tabular-nums ${plColor(totalReturn)}`}>{totalReturn.toFixed(2)}%</dd>
      </div>
      <div className="rounded-lg bg-surface-muted px-3 py-2" title="긴급·오늘 실행 등급 + 시세 확인·손절주문 미등록 종목(자산 단위, 중복 제외)">
        <dt className="text-xs text-gray-400">조치 필요 (전체 계정)</dt>
        <dd className={`text-lg font-semibold tabular-nums ${actionNeeded > 0 ? 'text-amber-300' : 'text-gray-300'}`}>
          {actionNeeded}건
        </dd>
      </div>
    </dl>
  </section>
);

export default HomeSnapshotCard;
