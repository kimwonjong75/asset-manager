// scripts/backtest/coreStopLoss/lib/sellRuleEngine.ts
// 레그별 연속 상태기계(매도규칙) 시뮬레이터 — 연구 전용(앱/백엔드 무접촉), 순수 함수.
//
// 앱의 단일종목 매매계획 UI(방식/손절폭/익절배수/마지막 매도선/불타기)를 그대로 모델링한다.
// lib/portfolioEngine.ts(정기 리밸런싱 모델)와 달리 여기서는 리밸런싱이 없다:
//   - 지평 시작일에 한 번만 전체 배분(레그별 rescaledWeight × 총자산)
//   - 이후 각 레그는 완전히 독립적으로 진입/손절/익절/불타기/추세이탈/재진입을 반복
//   - 레그가 청산되면 그 현금은 **그 레그 안에서만** 유휴(연 0%)로 대기하다가
//     같은 레그가 재진입할 때 전액 재투입된다(레그 간 재배분 없음 = 복리는 레그 단위).
//
// 손절폭은 레그별로 다르다: stopLossPct_i = 허용손실(1%) / rescaledWeight_i.
// (비중이 큰 레그일수록 손절이 타이트하고, 작은 레그일수록 넓다 — 1% 최대손실 등가.)
//
// 하루 우선순위(레그당 하루 1행동): 손절 → 익절(절반) → 불타기 → 추세이탈(MA 하향돌파).
// 플랫 상태에서는 재진입(MA 상향 재돌파)만 점검한다.

import type { EquityPoint, ClosedTrade } from '../../lib/metrics';
import { simpleMovingAverage } from './movingAverage';

export interface SellRuleLeg {
  symbol: string;
  label: string;
  /** 공통 캘린더에 정렬된 KRW 환산 값(직전값 carry-forward, 데이터 시작 전은 null). */
  krwValues: (number | null)[];
  /** 재정규화된 목표 비중(0.109 = 10.9%). */
  weight: number;
  /** 레그별 손절폭(0.0917 = 9.17%). */
  stopLossPct: number;
}

export interface SellRuleParams {
  calendar: string[];
  startIndex: number;
  endIndex: number;
  /** 익절배수. null이면 부분익절 없음. 2/3/4 → 진입가 × (1 + 손절폭 × 배수)에서 보유수량 절반 매도. */
  profitTakeMultiple: number | null;
  /** 마지막 매도선(추세이탈) 이동평균 기간. 10/20/50. */
  finalExitMAPeriod: number;
  /** 불타기 간격(0.10 = 10%). null이면 불타기 없음. */
  pyramidIntervalPct: number | null;
  /** 불타기 최대 추가매수 횟수. */
  maxPyramidAdds: number;
  /** 한 진입 사이클에서 그 레그가 쓸 수 있는 총 매수금액 상한(원배분 대비 배수). */
  pyramidCostCapMultiple: number;
  initialEquity: number;
  /** 투자 예산 비율(0.96). 나머지는 손대지 않는 예비현금(연 0%). */
  investedBudget: number;
}

export interface SellRuleLegStat {
  symbol: string;
  label: string;
  weightPct: number;
  stopLossPct: number;
  stopOuts: number;
  trendExits: number;
  profitTakes: number;
  pyramidAdds: number;
  /** 현금 부족/상한으로 실제 체결되지 않은 불타기 트리거 수. */
  pyramidSkipped: number;
  reentries: number;
  /** 시뮬레이션 구간 중 포지션 없이(현금 유휴) 보낸 거래일 수. */
  idleDays: number;
  /** 종료 시점에 포지션 보유 중인가. */
  endsActive: boolean;
  /** 종료 시점 그 레그의 총 가치(보유평가 + 유휴현금). */
  finalValueKRW: number;
  realizedPnlKRW: number;
}

export interface SellRuleResult {
  equity: EquityPoint[];
  trades: ClosedTrade[];
  legStats: SellRuleLegStat[];
  totalStopOuts: number;
  totalTrendExits: number;
  totalProfitTakes: number;
  totalPyramidAdds: number;
  totalPyramidSkipped: number;
  totalReentries: number;
  /** 예비현금(초기자산 × (1 − investedBudget)) — 전 구간 불변. */
  reserveCash: number;
}

interface LegState {
  active: boolean;
  quantity: number;
  /** 현재 보유분의 총 취득원가(KRW). 평균단가 = costBasis / quantity. */
  costBasis: number;
  /** 이번 사이클의 최초 진입가(불타기 후 손절선을 이 값으로 끌어올린다). */
  entryPrice: number;
  entryDate: string;
  stopPrice: number;
  takeProfitPrice: number | null;
  halfSold: boolean;
  pyramidCount: number;
  /** 이번 사이클 최초 진입에 쓴 금액(불타기 1회차 크기 산정 기준). */
  originalCost: number;
  /** 이번 사이클 누적 매수금액(상한 점검용). */
  cycleCost: number;
  /** 이 레그가 들고 있는 유휴현금. */
  cash: number;
}

function priceAt(leg: SellRuleLeg, i: number): number | null {
  const v = leg.krwValues[i];
  return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
}

/**
 * 원래 목표비중 리스트를 투자예산에 맞춰 비례 재정규화하고, 레그별 손절폭을 도출한다.
 * @param originalWeightsPct 사용자의 원래 비중(%) 목록 — 합이 investedBudget과 달라도 된다.
 * @param investedBudget 투자예산 비율(0.96)
 * @param riskPerTrade 1회 허용손실 비율(0.01)
 */
export function computeLegSizing(
  originalWeightsPct: number[],
  investedBudget: number,
  riskPerTrade: number
): Array<{ originalWeightPct: number; rescaledWeight: number; stopLossPct: number }> {
  if (originalWeightsPct.length === 0) throw new Error('computeLegSizing: 비중 목록 비어 있음');
  const total = originalWeightsPct.reduce((a, b) => a + b, 0);
  if (!(total > 0)) throw new Error(`computeLegSizing: 비중 합이 0 이하 (${total})`);
  if (!(investedBudget > 0) || !(riskPerTrade > 0)) {
    throw new Error('computeLegSizing: investedBudget/riskPerTrade는 양수여야 함');
  }
  return originalWeightsPct.map(w => {
    if (!(w > 0)) throw new Error(`computeLegSizing: 개별 비중이 0 이하 (${w})`);
    const rescaled = (w / total) * investedBudget;
    const stop = riskPerTrade / rescaled;
    if (!(stop > 0) || !isFinite(stop)) {
      throw new Error(`computeLegSizing: 손절폭 계산 이상 (weight=${w}, stop=${stop})`);
    }
    return { originalWeightPct: w, rescaledWeight: rescaled, stopLossPct: stop };
  });
}

export function runSellRulePortfolio(legs: SellRuleLeg[], params: SellRuleParams): SellRuleResult {
  const {
    calendar,
    startIndex,
    endIndex,
    profitTakeMultiple,
    finalExitMAPeriod,
    pyramidIntervalPct,
    maxPyramidAdds,
    pyramidCostCapMultiple,
    initialEquity,
    investedBudget,
  } = params;

  if (legs.length === 0) throw new Error('legs 비어 있음');
  if (!(startIndex >= 0) || endIndex >= calendar.length || startIndex >= endIndex) {
    throw new Error(`잘못된 구간: start=${startIndex} end=${endIndex} len=${calendar.length}`);
  }
  if (startIndex < 1) throw new Error('startIndex는 1 이상이어야 함(전일 대비 교차 판정 필요)');

  const maSeries = legs.map(l => simpleMovingAverage(l.krwValues, finalExitMAPeriod));

  // ── 페일-클로즈 사전점검 ────────────────────────────────────
  // 시작일/전일에 가격과 MA가 모두 있어야 한다. carry-forward 특성상 한 번 유효해지면
  // 이후로는 결측이 생기지 않으므로, 여기만 통과하면 루프 안에서 결측은 버그를 의미한다.
  for (let k = 0; k < legs.length; k++) {
    const leg = legs[k];
    for (const i of [startIndex - 1, startIndex]) {
      if (priceAt(leg, i) === null) {
        throw new Error(`${leg.symbol}: ${calendar[i]} 가격 결측 — 구간 커버 실패`);
      }
      const ma = maSeries[k][i];
      if (typeof ma !== 'number' || !isFinite(ma)) {
        throw new Error(
          `${leg.symbol}: ${calendar[i]} ${finalExitMAPeriod}일 이동평균 미확보 — 구간 커버 실패`
        );
      }
    }
  }

  const reserveCash = initialEquity * (1 - investedBudget);
  const states: LegState[] = [];
  const legStats: SellRuleLegStat[] = legs.map(l => ({
    symbol: l.symbol,
    label: l.label,
    weightPct: l.weight * 100,
    stopLossPct: l.stopLossPct * 100,
    stopOuts: 0,
    trendExits: 0,
    profitTakes: 0,
    pyramidAdds: 0,
    pyramidSkipped: 0,
    reentries: 0,
    idleDays: 0,
    endsActive: false,
    finalValueKRW: 0,
    realizedPnlKRW: 0,
  }));
  const trades: ClosedTrade[] = [];
  const equity: EquityPoint[] = [];

  let totalStopOuts = 0;
  let totalTrendExits = 0;
  let totalProfitTakes = 0;
  let totalPyramidAdds = 0;
  let totalPyramidSkipped = 0;
  let totalReentries = 0;

  /** 새 진입(최초 또는 재진입). budget 전액을 그 레그에 투입한다. */
  const enter = (k: number, i: number, budget: number): void => {
    const leg = legs[k];
    const p = priceAt(leg, i);
    if (p === null) throw new Error(`${leg.symbol}: ${calendar[i]} 진입가 결측`);
    const qty = budget / p;
    states[k] = {
      active: true,
      quantity: qty,
      costBasis: budget,
      entryPrice: p,
      entryDate: calendar[i],
      stopPrice: p * (1 - leg.stopLossPct),
      takeProfitPrice:
        profitTakeMultiple === null ? null : p * (1 + leg.stopLossPct * profitTakeMultiple),
      halfSold: false,
      pyramidCount: 0,
      originalCost: budget,
      cycleCost: budget,
      cash: 0,
    };
  };

  /** 보유분 일부/전부 매도. 실현손익을 기록하고 대금을 그 레그 현금으로 넣는다. */
  const sell = (k: number, i: number, qty: number): number => {
    const st = states[k];
    const leg = legs[k];
    const p = priceAt(leg, i);
    if (p === null) throw new Error(`${leg.symbol}: ${calendar[i]} 가격 결측(보유 중)`);
    const avgCost = st.costBasis / st.quantity;
    const proceeds = qty * p;
    const pnl = qty * (p - avgCost);
    st.quantity -= qty;
    st.costBasis -= qty * avgCost;
    st.cash += proceeds;
    trades.push({
      ticker: leg.symbol,
      openDate: st.entryDate,
      closeDate: calendar[i],
      pnlKRW: pnl,
    });
    legStats[k].realizedPnlKRW += pnl;
    return pnl;
  };

  const closeAll = (k: number, i: number): void => {
    const st = states[k];
    sell(k, i, st.quantity);
    st.active = false;
    st.quantity = 0;
    st.costBasis = 0;
    st.takeProfitPrice = null;
  };

  const legValueAt = (k: number, i: number): number => {
    const st = states[k];
    if (!st.active) return st.cash;
    const p = priceAt(legs[k], i);
    if (p === null) throw new Error(`${legs[k].symbol}: ${calendar[i]} 가격 결측(보유 중)`);
    return st.quantity * p + st.cash;
  };

  const totalEquityAt = (i: number): number => {
    let sum = reserveCash;
    for (let k = 0; k < legs.length; k++) sum += legValueAt(k, i);
    return sum;
  };

  // ── 시작일 진입 ─────────────────────────────────────────────
  for (let k = 0; k < legs.length; k++) {
    states.push({
      active: false,
      quantity: 0,
      costBasis: 0,
      entryPrice: 0,
      entryDate: '',
      stopPrice: 0,
      takeProfitPrice: null,
      halfSold: false,
      pyramidCount: 0,
      originalCost: 0,
      cycleCost: 0,
      cash: 0,
    });
    enter(k, startIndex, initialEquity * legs[k].weight);
  }
  equity.push({ date: calendar[startIndex], value: totalEquityAt(startIndex) });

  // ── 일별 루프 ───────────────────────────────────────────────
  for (let i = startIndex + 1; i <= endIndex; i++) {
    for (let k = 0; k < legs.length; k++) {
      const leg = legs[k];
      const st = states[k];
      const p = priceAt(leg, i);
      if (p === null) {
        throw new Error(`${leg.symbol}: ${calendar[i]} 가격 결측 — 페일클로즈`);
      }
      const ma = maSeries[k][i];
      const maPrev = maSeries[k][i - 1];
      const pPrev = priceAt(leg, i - 1);
      if (typeof ma !== 'number' || typeof maPrev !== 'number' || pPrev === null) {
        throw new Error(`${leg.symbol}: ${calendar[i]} MA/전일가 결측 — 페일클로즈`);
      }

      if (!st.active) {
        // 재진입: MA 상향 재돌파(오늘 종가 ≥ MA, 전일 종가 < 전일 MA).
        if (p >= ma && pPrev < maPrev && st.cash > 0) {
          const budget = st.cash;
          st.cash = 0;
          enter(k, i, budget);
          legStats[k].reentries += 1;
          totalReentries += 1;
        } else {
          legStats[k].idleDays += 1;
        }
        continue;
      }

      // 1) 손절
      if (p <= st.stopPrice) {
        closeAll(k, i);
        legStats[k].stopOuts += 1;
        totalStopOuts += 1;
        continue;
      }

      // 2) 부분익절(사이클당 1회)
      if (st.takeProfitPrice !== null && !st.halfSold && p >= st.takeProfitPrice) {
        sell(k, i, st.quantity * 0.5);
        st.halfSold = true;
        legStats[k].profitTakes += 1;
        totalProfitTakes += 1;
        continue;
      }

      // 3) 불타기
      if (pyramidIntervalPct !== null && st.pyramidCount < maxPyramidAdds) {
        const nextLevel = st.pyramidCount + 1;
        const trigger = st.entryPrice * Math.pow(1 + pyramidIntervalPct, nextLevel);
        if (p >= trigger) {
          // 레벨은 한 번 도달하면 소진된다(현금 부족으로 못 사도 재점화하지 않는다).
          st.pyramidCount = nextLevel;
          const desired = st.originalCost * Math.pow(0.5, nextLevel);
          const capRoom = st.originalCost * pyramidCostCapMultiple - st.cycleCost;
          const spend = Math.min(desired, st.cash, Math.max(capRoom, 0));
          if (spend > 0) {
            st.quantity += spend / p;
            st.costBasis += spend;
            st.cash -= spend;
            st.cycleCost += spend;
            // 손절선을 최초 진입가(본전)까지 끌어올린다. 내리지 않고, 현재가 위로도 올리지 않는다.
            st.stopPrice = Math.max(st.stopPrice, Math.min(st.entryPrice, p));
            legStats[k].pyramidAdds += 1;
            totalPyramidAdds += 1;
          } else {
            legStats[k].pyramidSkipped += 1;
            totalPyramidSkipped += 1;
          }
          continue;
        }
      }

      // 4) 마지막 매도선(추세이탈): MA 하향돌파 시 잔량 전량 매도
      if (p < ma && pPrev >= maPrev) {
        closeAll(k, i);
        legStats[k].trendExits += 1;
        totalTrendExits += 1;
        continue;
      }
    }
    equity.push({ date: calendar[i], value: totalEquityAt(i) });
  }

  for (let k = 0; k < legs.length; k++) {
    legStats[k].endsActive = states[k].active;
    legStats[k].finalValueKRW = legValueAt(k, endIndex);
  }

  return {
    equity,
    trades,
    legStats,
    totalStopOuts,
    totalTrendExits,
    totalProfitTakes,
    totalPyramidAdds,
    totalPyramidSkipped,
    totalReentries,
    reserveCash,
  };
}
