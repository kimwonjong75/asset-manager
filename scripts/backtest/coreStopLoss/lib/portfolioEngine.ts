// scripts/backtest/coreStopLoss/lib/portfolioEngine.ts
// 코어(정적배분) + 종목별 1% 최대손실 손절 시뮬레이터 — 연구 전용(순수 함수).
//
// 포지션 사이징은 앱의 utils/positionSizing.ts `calculatePositionSize`를 그대로 미러링한다:
//   투자비중 = 허용손실% / 손절폭%   (예: 1% / 7% = 14.29%)
//   레버리지 미허용(allowLeverage=false) → 단일 종목이 총자산 100%를 넘을 수 없다.
// 그 위에 포트폴리오 예산 제약을 얹는다:
//   14개 레그 원시비중 합이 투자예산(96%)을 넘으면 **비례 축소**해 정확히 96%로 맞춘다.
//   나머지 4%(GRVT 채권펀드 제외분)는 현금(수익률 0%)으로 남는다.
//
// 손절: 종가가 stopPrice(= 진입가 × (1 − 손절폭)) 이하로 내려가면 그 레그를 전량 현금화.
//       다음 정기 리밸런싱까지 현금(0%)으로 대기하고, 리밸런싱 때 재진입한다.
// 리밸런싱: 반기(1월/7월) 첫 거래일 — scripts/backtest/lib/rebalanceDates.ts 재사용.

import type { EquityPoint, ClosedTrade } from '../../lib/metrics';

export interface EngineLeg {
  symbol: string;
  label: string;
  /** 공통 캘린더에 정렬된 KRW 환산 값(직전값 carry-forward, 데이터 시작 전은 null). */
  krwValues: (number | null)[];
  /** 실제 상품 데이터 시작일(그 이전은 프록시 합성 구간). */
  realFirstDate: string;
  proxySymbol: string | null;
}

export interface EngineParams {
  /** 전체 공통 거래일 캘린더. */
  calendar: string[];
  /** 시뮬레이션 시작 인덱스(진입일). */
  startIndex: number;
  /** 시뮬레이션 종료 인덱스(포함). */
  endIndex: number;
  /** 손절폭 (0.07 = 7%). */
  stopLossPercent: number;
  /** 1회 허용손실 비율 (0.01 = 1%). */
  riskPercentPerTrade: number;
  /** 투자 예산 비율 (0.96 = 96%, 나머지는 현금). */
  investedBudget: number;
  /** 리밸런싱 인덱스(캘린더 전체 기준). startIndex 이하/endIndex 초과는 무시된다. */
  rebalanceIndices: number[];
  initialEquity: number;
}

export interface LegStat {
  symbol: string;
  label: string;
  stopOutCount: number;
  realizedLossKRW: number;
}

export interface RebalanceSnapshot {
  date: string;
  weightSum: number; // 배분 직후 투자비중 합 (≈ investedBudget)
  cashRatio: number;
  equity: number;
}

export interface EngineResult {
  equity: EquityPoint[];
  trades: ClosedTrade[];
  legStats: LegStat[];
  rebalances: RebalanceSnapshot[];
  /** 단일 레그 비중이 100%를 넘어 캡에 걸린 횟수(레버리지 방지). */
  cappedCount: number;
}

/**
 * 원시 투자비중(허용손실%/손절폭%)을 계산하고, 100% 캡 + 예산(96%) 비례 축소를 적용한다.
 * 모든 레그의 손절폭이 동일하므로 실제로는 균등 비중이 되지만,
 * 레그별 손절폭을 다르게 확장할 여지를 남겨 일반형으로 구현한다.
 */
export function computeTargetWeights(
  legCount: number,
  stopLossPercent: number,
  riskPercentPerTrade: number,
  investedBudget: number
): { weights: number[]; cappedCount: number } {
  if (!(stopLossPercent > 0)) throw new Error('stopLossPercent must be > 0');
  const rawSingle = riskPercentPerTrade / stopLossPercent;
  // 앱과 동일: allowLeverage=false → 단일 포지션은 총자산(=1.0)을 넘을 수 없다.
  const capped = rawSingle > 1;
  const single = capped ? 1 : rawSingle;
  const raw = new Array<number>(legCount).fill(single);
  const sum = raw.reduce((a, b) => a + b, 0);
  const scale = sum > investedBudget ? investedBudget / sum : 1;
  return {
    weights: raw.map(w => w * scale),
    cappedCount: capped ? legCount : 0,
  };
}

interface LegState {
  quantity: number; // 보유 "수량"(지수 단위)
  entryPrice: number;
  stopPrice: number;
  entryDate: string;
  active: boolean;
}

export function runPortfolio(legs: EngineLeg[], params: EngineParams): EngineResult {
  const {
    calendar,
    startIndex,
    endIndex,
    stopLossPercent,
    riskPercentPerTrade,
    investedBudget,
    rebalanceIndices,
    initialEquity,
  } = params;

  if (legs.length === 0) throw new Error('legs 비어 있음');
  if (!(startIndex >= 0) || endIndex >= calendar.length || startIndex >= endIndex) {
    throw new Error(`잘못된 구간: start=${startIndex} end=${endIndex} len=${calendar.length}`);
  }

  // 페일-클로즈: 시작일에 값이 없는 레그가 하나라도 있으면 즉시 실패(조용한 오답 금지).
  for (const leg of legs) {
    const v = leg.krwValues[startIndex];
    if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
      throw new Error(`${leg.symbol}: 시작일 ${calendar[startIndex]} 값 없음 — 구간 커버 실패`);
    }
  }

  const { weights, cappedCount } = computeTargetWeights(
    legs.length,
    stopLossPercent,
    riskPercentPerTrade,
    investedBudget
  );

  const states: LegState[] = legs.map(() => ({
    quantity: 0,
    entryPrice: 0,
    stopPrice: 0,
    entryDate: '',
    active: false,
  }));
  const legStats: LegStat[] = legs.map(l => ({
    symbol: l.symbol,
    label: l.label,
    stopOutCount: 0,
    realizedLossKRW: 0,
  }));

  let cash = 0;
  const equity: EquityPoint[] = [];
  const trades: ClosedTrade[] = [];
  const rebalances: RebalanceSnapshot[] = [];

  const priceAt = (legIdx: number, i: number): number | null => {
    const v = legs[legIdx].krwValues[i];
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
  };

  const totalEquityAt = (i: number): number => {
    let sum = cash;
    for (let k = 0; k < legs.length; k++) {
      if (!states[k].active) continue;
      const p = priceAt(k, i);
      // active인데 값이 없으면 직전 값이 carry-forward 되므로 정상적으로 발생하지 않는다.
      if (p === null) throw new Error(`${legs[k].symbol}: ${calendar[i]} 가격 결측(보유 중)`);
      sum += states[k].quantity * p;
    }
    return sum;
  };

  const rebalanceAt = (i: number, equityNow: number): void => {
    const date = calendar[i];
    let invested = 0;
    for (let k = 0; k < legs.length; k++) {
      const p = priceAt(k, i);
      if (p === null) {
        throw new Error(`${legs[k].symbol}: 리밸런싱일 ${date} 가격 결측 — 구간 커버 실패`);
      }
      const alloc = equityNow * weights[k];
      states[k] = {
        quantity: alloc / p,
        entryPrice: p,
        stopPrice: p * (1 - stopLossPercent),
        entryDate: date,
        active: true,
      };
      invested += alloc;
    }
    cash = equityNow - invested;
    rebalances.push({
      date,
      weightSum: equityNow > 0 ? invested / equityNow : 0,
      cashRatio: equityNow > 0 ? cash / equityNow : 0,
      equity: equityNow,
    });
  };

  const rebalanceSet = new Set(
    rebalanceIndices.filter(i => i > startIndex && i <= endIndex)
  );

  // ── 시작일 진입 ─────────────────────────────────────────────
  cash = initialEquity;
  rebalanceAt(startIndex, initialEquity);
  equity.push({ date: calendar[startIndex], value: totalEquityAt(startIndex) });

  // ── 일별 루프 ───────────────────────────────────────────────
  for (let i = startIndex + 1; i <= endIndex; i++) {
    if (rebalanceSet.has(i)) {
      const eq = totalEquityAt(i);
      rebalanceAt(i, eq);
    } else {
      // 손절 점검 (종가 기준)
      for (let k = 0; k < legs.length; k++) {
        const st = states[k];
        if (!st.active) continue;
        const p = priceAt(k, i);
        if (p === null) continue;
        if (p <= st.stopPrice) {
          const proceeds = st.quantity * p;
          const pnl = st.quantity * (p - st.entryPrice);
          cash += proceeds;
          st.active = false;
          st.quantity = 0;
          trades.push({
            ticker: legs[k].symbol,
            openDate: st.entryDate,
            closeDate: calendar[i],
            pnlKRW: pnl,
          });
          legStats[k].stopOutCount += 1;
          legStats[k].realizedLossKRW += pnl;
        }
      }
    }
    equity.push({ date: calendar[i], value: totalEquityAt(i) });
  }

  return { equity, trades, legStats, rebalances, cappedCount };
}
