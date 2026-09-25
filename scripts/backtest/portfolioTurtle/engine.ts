// scripts/backtest/portfolioTurtle/engine.ts
// portfolio-turtle-v1 전용 실행기 — 순수(console/Math.random/Date.now 금지).
//
// 사용자의 실제 보유 83종목을 **한 계좌(공유 현금)**로 본다. 세 모드를 전부 같은 함수로 표현한다:
//   · B&H:       tradable(ticker) 항상 false → 신호평가 자체가 없어 시작 보유를 끝까지 들고만 간다.
//   · 팔기만:    reentryEnabled=false → 청산 신호는 그대로 작동하지만 재진입 신호를 평가하지 않는다
//                (한 번 팔리면 영원히 현금, 이자만 붙는다).
//   · 터틀 사이클: tradable=scope에 따라, reentryEnabled=true → 완전한 사이클.
//
// 체결 규약(동결, freshTurtleLifecycle/holdingsTurtleCycle과 동일):
//   · 신호는 D일 종가. 채널·MA·ATR트레일 전부 D일 봉 포함 규약은 각 방식 정의를 따른다(exitRules.ts).
//   · 주문은 다음 실제 거래일 시가에 체결. 클램프 금지. 갭 그대로.
//   · 같은 날: 매도 먼저 → 매수(신규진입·불타기) 나중. 동시 매수는 티커 오름차순 + 공통비율 λ.
//   · 우선순위: 손절(재매수분만) → 청산(W1~W4, 보유분·재매수분 공통).
//   · 보유분(HOLD_INITIAL)엔 2N 손절이 없다(매수가를 몰라도 되는 설계 — 청산선만).
//
// 가드 재사용: freshTurtleLifecycle/engine.ts의 checkCreateGuard/checkFillGuard/positionRiskOriginal을
// 그대로 재사용한다(파리티 테스트를 통과한 방식 재발명 금지). λ 이분탐색은 동일 알고리즘의 로컬 사본
// (freshTurtleLifecycle의 λ 로직이 export되어 있지 않아 재사용 불가 — 기존 관례와 동일한 이유).

import { applyDrawdownScaling } from '../../../utils/turtleEngine';
import { checkCreateGuard, checkFillGuard, positionRiskOriginal } from '../freshTurtleLifecycle/engine';
import { computeCostRates } from '../holdingsTurtleCycle/costs';
import type { ExitRuleConfig, SizingVariantConfig } from './configTypes';
import { fxAt, ownIdxOnOrBefore, PortfolioSecurity } from './data';
import {
  checkEntrySignal, checkExitSignal, initTrailState, isWarmedUp, TrailState, updateTrailState,
} from './exitRules';
import {
  roundQty, sizeFixedUnitCapDiv, sizeFixedUnitNoCap, sizeUnitWithRoom, SizingContext,
} from './sizing';
import type { FxTable } from '../lib/fx';

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ── 초기 보유 구성 ───────────────────────────────────────────────────────────

export interface InitialTickerHolding {
  ownIdxAtStart: number;
  qty: number;
  refPriceLocal: number;
  fxAtStart: number;
  valueKRW: number;
}

export interface InitialHoldingsResult {
  startCalIdx: number;
  perTicker: Map<string, InitialTickerHolding>;
  excludedTickers: { ticker: string; reason: string }[];
  /** 반올림 이후 실제로 배분된 총액(KRW) — totalBudgetKRW와의 차액은 초기 현금으로 남는다. */
  deployedKRW: number;
}

/**
 * 시작일 기준 초기 보유 구성 — CSV 현재비중을 그대로(가상으로) 적용한다.
 * tradable 대상은 지표(ATR·55채널·20채널·55채널·SMA50) 전부 유효해야 포함(어떤 청산방식을 쓰든 안전),
 * 비대상(scope 제외/B&H모드)은 가격만 있으면 포함한다. 미충족 종목은 그 시작일에서만 제외 후 비중 재정규화.
 */
export function buildInitialHoldings(
  securities: readonly PortfolioSecurity[],
  fx: FxTable,
  startCalIdx: number,
  totalBudgetKRW: number,
  tradable: (ticker: string) => boolean
): InitialHoldingsResult {
  const excluded: { ticker: string; reason: string }[] = [];
  const included: { sec: PortfolioSecurity; ownIdx: number; price: number; fxRate: number }[] = [];

  for (const sec of securities) {
    const ownIdx = ownIdxOnOrBefore(sec, startCalIdx);
    if (ownIdx < 0) { excluded.push({ ticker: sec.ticker, reason: 'not-listed-yet' }); continue; }
    if (tradable(sec.ticker)) {
      const warm = isNum(sec.atr[ownIdx]) && isNum(sec.highChannel55[ownIdx]) &&
        isNum(sec.lowChannel20[ownIdx]) && isNum(sec.lowChannel55[ownIdx]) && isNum(sec.sma50[ownIdx]);
      if (!warm) { excluded.push({ ticker: sec.ticker, reason: 'no-warmup' }); continue; }
    }
    const price = sec.ownClose[ownIdx];
    if (!isNum(price) || !(price > 0)) { excluded.push({ ticker: sec.ticker, reason: 'bad-start-price' }); continue; }
    const fxRate = fxAt(sec.currency, fx, startCalIdx);
    if (!isNum(fxRate) || !(fxRate > 0)) { excluded.push({ ticker: sec.ticker, reason: 'bad-fx' }); continue; }
    included.push({ sec, ownIdx, price, fxRate });
  }

  const totalWeight = included.reduce((s, x) => s + x.sec.weightPct, 0);
  const perTicker = new Map<string, InitialTickerHolding>();
  let deployedKRW = 0;
  for (const { sec, ownIdx, price, fxRate } of included) {
    const w = totalWeight > 0 ? sec.weightPct / totalWeight : 0;
    const targetKRW = totalBudgetKRW * w;
    const qty = roundQty(targetKRW / (price * fxRate), sec.isCryptoTicker);
    const valueKRW = qty * price * fxRate;
    perTicker.set(sec.ticker, { ownIdxAtStart: ownIdx, qty, refPriceLocal: price, fxAtStart: fxRate, valueKRW });
    deployedKRW += valueKRW;
  }
  return { startCalIdx, perTicker, excludedTickers: excluded, deployedKRW };
}

// ── 시뮬레이션 상태 ──────────────────────────────────────────────────────────

interface Unit {
  qty: number;
  fillPrice: number;   // 종목 통화
  nAtSignal: number;   // 종목 통화
  fxAtFill: number;
}

type HoldStatus = 'HOLD_INITIAL' | 'HOLD_REENTERED' | 'CASH';

interface HoldingState {
  status: HoldStatus;
  units: Unit[];
  stopPrice: number | null;      // HOLD_REENTERED 전용 공통 2N 손절가(원통화)
  trail: TrailState | null;      // exitRule=atrTrailing일 때만
  fixedUnitQty: number | null;   // G/C — 최초 계산 후 고정
  entryOwnIdx: number;           // 현재 보유 시작 own idx(트레일 초기화용)
  costBasisKRW: number;          // 현재 포지션 매입원가 합(비용 제외)
  buyCostsKRW: number;
  openedDate: string;
  /** 1R(KRW) = 최초 진입수량 × stopMultipleN × 진입N × 진입fx (freshTurtleLifecycle 관례). HOLD_INITIAL은 0(정의 없음). */
  rDenomKRW: number;
}

export interface PendingOrder {
  kind: 'stop' | 'exit' | 'entry' | 'pyramid';
  ticker: string;
  signalCalIdx: number;
  fillCalIdx: number;
  nAtSignal: number;
  equityAtSignalKRW: number;      // 위험기준 스냅샷(신호 시점) — 사이징·상한 계산에 사용
}

export interface CompletedTradeRecord {
  ticker: string;
  assetClass: string;
  kind: 'initial' | 'reentered';
  openedDate: string;
  closedDate: string;
  exitReason: 'stop' | 'exit';
  /** 매도 체결 수량(전 유닛 합) — 테스트·검증용. */
  qty: number;
  /** 매도 체결가(종목 통화, 다음 실제 거래일 시가). */
  exitPriceLocal: number;
  pnlKRW: number;
  /** pnl ÷ 1R. kind='reentered'에서만 의미 있음(HOLD_INITIAL은 매수가·손절이 없어 R 미정의 → null). */
  rMultiple: number | null;
}

export interface InvariantCounters {
  negativeCash: number;
  positionCapBreach: number;
  totalRiskBreach: number;
  maxUnitsBreach: number;
  duplicatePosition: number;
  duplicateOrder: number;
  sameBarFill: number;
  holidayFill: number;
}

function emptyInvariants(): InvariantCounters {
  return {
    negativeCash: 0, positionCapBreach: 0, totalRiskBreach: 0, maxUnitsBreach: 0,
    duplicatePosition: 0, duplicateOrder: 0, sameBarFill: 0, holidayFill: 0,
  };
}

export interface PortfolioRunResult {
  dates: string[];
  equityCurve: number[];
  finalEquityKRW: number;
  years: number;
  cagr: number;
  mdd: number;
  calmar: number;
  totalReentryFills: number;
  totalSellFills: number;
  completedRoundTrips: number;
  totalCostKRW: number;
  lambdaScaleDays: number;
  maxConcurrentReentered: number;
  avgCashPct: number;
  trades: CompletedTradeRecord[];
  invariants: InvariantCounters;
}

function maxDrawdown(curve: readonly number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of curve) {
    if (v > peak) peak = v;
    if (peak > 0) { const dd = (peak - v) / peak; if (dd > mdd) mdd = dd; }
  }
  return mdd;
}

function yearsBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`), tb = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return (tb - ta) / 86_400_000 / 365.2425;
}

export interface SimulateParams {
  securities: readonly PortfolioSecurity[];
  fx: FxTable;
  calendar: readonly string[];
  initial: InitialHoldingsResult;
  exitRule: ExitRuleConfig;
  stopMultipleN: number;
  sizing: SizingVariantConfig;
  /** 지정 시 sizing.positionCapPct 대신 사용(캡 민감도 5%/15%용). undefined면 sizing 값 그대로. */
  positionCapPctOverride?: number | null;
  reentryEnabled: boolean;
  tradable: (ticker: string) => boolean;
  /** holdingsTurtleCycle costTiers 규약 재사용: 1=기본, 2=2배. */
  costMultiplier: number;
  cashAnnualRatePct: number;
  maxTotalRiskPct: number;
  minOrderKRW: number;
  drawdownScaling: boolean;
  drawdownStepDown: number;
  drawdownReduce: number;
}

/** 리스크·상한 계산에 쓸 "명목" 평가액 — 드로다운 축소 켜짐이면 연초 기준자산 대비 감쇄 적용. */
function nominalEquity(
  params: SimulateParams, currentEquityKRW: number, yearStartEquityKRW: number
): number {
  if (!params.drawdownScaling) return currentEquityKRW;
  return applyDrawdownScaling(currentEquityKRW, yearStartEquityKRW, {
    stepDown: params.drawdownStepDown, reduce: params.drawdownReduce,
  });
}

export function simulatePortfolio(params: SimulateParams): PortfolioRunResult {
  const { securities, fx, calendar, initial } = params;
  const secByTicker = new Map(securities.map(s => [s.ticker, s]));
  const capPct = params.positionCapPctOverride !== undefined ? params.positionCapPctOverride : params.sizing.positionCapPct;

  let cash = 0; // 초기 배분 후 잔여(반올림 차액) — buildInitialHoldings가 deployedKRW로 이미 계산해뒀다.
  const holdings = new Map<string, HoldingState>();
  for (const [ticker, ih] of initial.perTicker) {
    holdings.set(ticker, {
      status: 'HOLD_INITIAL',
      units: [{ qty: ih.qty, fillPrice: ih.refPriceLocal, nAtSignal: 0, fxAtFill: ih.fxAtStart }],
      stopPrice: null,
      trail: params.exitRule.method === 'atrTrailing' && params.tradable(ticker)
        ? initTrailState(secByTicker.get(ticker)!, ih.ownIdxAtStart, params.exitRule.multiple)
        : null,
      fixedUnitQty: null,
      entryOwnIdx: ih.ownIdxAtStart,
      costBasisKRW: ih.valueKRW,
      buyCostsKRW: 0,
      openedDate: calendar[initial.startCalIdx],
      rDenomKRW: 0,
    });
  }

  const pending = new Map<string, PendingOrder>();
  const inv = emptyInvariants();
  const trades: CompletedTradeRecord[] = [];
  const dates: string[] = [];
  const equityCurve: number[] = [];
  const cashPctSamples: number[] = [];
  let totalReentryFills = 0, totalSellFills = 0, completedRoundTrips = 0, lambdaScaleDays = 0;
  let maxConcurrentReentered = 0;
  let totalCostKRW = 0;
  let prevCalIdx: number | null = null;
  let yearStartEquity = initial.deployedKRW;
  let lastYearKey = calendar[initial.startCalIdx].slice(0, 4);

  const cashRatePerDay = params.cashAnnualRatePct !== 0
    ? Math.pow(1 + params.cashAnnualRatePct / 100, 1 / 365.2425) - 1 : 0;

  const currentEquityKRW = (calIdx: number): number => {
    let posValue = 0;
    for (const [ticker, h] of holdings) {
      if (h.status === 'CASH') continue;
      const sec = secByTicker.get(ticker)!;
      const c = sec.closeForValuation[calIdx];
      if (!isNum(c)) continue;
      const fxRate = fxAt(sec.currency, fx, calIdx);
      const qty = h.units.reduce((s, u) => s + u.qty, 0);
      posValue += qty * c * fxRate;
    }
    return cash + posValue;
  };

  const totalOpenRiskKRW = (calIdx: number): number => {
    let s = 0;
    for (const [ticker, h] of holdings) {
      if (h.status !== 'HOLD_REENTERED' || h.stopPrice === null) continue;
      const sec = secByTicker.get(ticker)!;
      s += positionRiskOriginal(h.units, h.stopPrice) * fxAt(sec.currency, fx, calIdx);
    }
    return s;
  };

  for (let i = initial.startCalIdx; i < calendar.length; i++) {
    const today = calendar[i];

    // 0) 현금 이자(달력일 복리) — 전날부터 오늘까지 경과일만큼.
    if (cashRatePerDay !== 0 && prevCalIdx !== null && cash > 0) {
      const days = Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${calendar[prevCalIdx]}T00:00:00Z`)) / 86_400_000
      );
      if (days > 0) cash *= Math.pow(1 + cashRatePerDay, days);
    }
    prevCalIdx = i;

    // 연초 기준자산 갱신(드로다운 축소용) — 새 달력연도 진입 시 "그 해 첫 거래일 시작 평가액"으로 리셋.
    const yearKey = today.slice(0, 4);
    if (yearKey !== lastYearKey) {
      yearStartEquity = currentEquityKRW(i);
      lastYearKey = yearKey;
    }

    // ════════════════════════════════════════════════════════════════
    // 1) 매도 체결 (오늘 예정분) — 매수보다 먼저
    // ════════════════════════════════════════════════════════════════
    const tickersAsc = Array.from(holdings.keys()).sort();
    for (const ticker of tickersAsc) {
      const o = pending.get(ticker);
      if (!o || o.fillCalIdx !== i || (o.kind !== 'stop' && o.kind !== 'exit')) continue;
      const sec = secByTicker.get(ticker)!;
      const h = holdings.get(ticker)!;
      const ownIdx = sec.ownIdxOfCal[i];
      const g = checkFillGuard({
        kind: o.kind, signalCalIdx: o.signalCalIdx, fillCalIdx: o.fillCalIdx,
        ownIdxAtFill: ownIdx, hasPosition: h.status !== 'CASH',
      });
      if (g !== 'ok') {
        if (g === 'same-bar') inv.sameBarFill++; else if (g === 'holiday') inv.holidayFill++;
        pending.delete(ticker);
        continue;
      }
      const open = sec.ownOpen[ownIdx];
      if (!isNum(open) || !(open > 0)) { pending.delete(ticker); continue; }
      const fxRate = fxAt(sec.currency, fx, i);
      const qty = h.units.reduce((s, u) => s + u.qty, 0);
      const proceeds = qty * open * fxRate;
      const { sellRate } = computeCostRates(
        { currency: sec.currency, isCryptoTicker: sec.isCryptoTicker, isKrEtf: sec.isKrEtf }, today, params.costMultiplier
      );
      const cost = proceeds * sellRate;
      cash += proceeds - cost;
      totalCostKRW += cost;

      const pnl = proceeds - cost - h.costBasisKRW - h.buyCostsKRW;
      trades.push({
        ticker, assetClass: sec.assetClass, kind: h.status === 'HOLD_REENTERED' ? 'reentered' : 'initial',
        openedDate: h.openedDate, closedDate: today, exitReason: o.kind, qty, exitPriceLocal: open, pnlKRW: pnl,
        rMultiple: h.status === 'HOLD_REENTERED' && h.rDenomKRW > 0 ? pnl / h.rDenomKRW : null,
      });
      if (h.status === 'HOLD_REENTERED') completedRoundTrips++;
      totalSellFills++;

      holdings.set(ticker, {
        status: 'CASH', units: [], stopPrice: null, trail: null, fixedUnitQty: null,
        entryOwnIdx: -1, costBasisKRW: 0, buyCostsKRW: 0, openedDate: '', rDenomKRW: 0,
      });
      pending.delete(ticker);
    }

    // ════════════════════════════════════════════════════════════════
    // 2) 매수 체결 (신규진입·불타기) — 일괄 계산 + 공통 비율 λ
    // ════════════════════════════════════════════════════════════════
    interface Cand {
      ticker: string; sec: PortfolioSecurity; o: PendingOrder; open: number; fxRate: number;
      capQty: number; newStop: number; isFirstUnit: boolean;
    }
    const cands: Cand[] = [];
    for (const ticker of tickersAsc) {
      const o = pending.get(ticker);
      if (!o || o.fillCalIdx !== i || (o.kind !== 'entry' && o.kind !== 'pyramid')) continue;
      const sec = secByTicker.get(ticker)!;
      const h = holdings.get(ticker)!;
      const ownIdx = sec.ownIdxOfCal[i];
      const g = checkFillGuard({
        kind: o.kind, signalCalIdx: o.signalCalIdx, fillCalIdx: o.fillCalIdx,
        ownIdxAtFill: ownIdx, hasPosition: h.status === 'HOLD_REENTERED',
      });
      if (g !== 'ok') {
        if (g === 'same-bar') inv.sameBarFill++;
        else if (g === 'holiday') inv.holidayFill++;
        else if (g === 'duplicate-position') inv.duplicatePosition++;
        pending.delete(ticker);
        continue;
      }
      const open = sec.ownOpen[ownIdx];
      if (!isNum(open) || !(open > 0)) { pending.delete(ticker); continue; }
      const fxRate = fxAt(sec.currency, fx, i);
      const isFirstUnit = o.kind === 'entry';
      if (!isFirstUnit && h.units.length >= params.sizing.maxUnits) { pending.delete(ticker); continue; }

      const existingQty = h.status === 'HOLD_REENTERED' ? h.units.reduce((s, u) => s + u.qty, 0) : 0;
      const existingValueKRW = existingQty * open * fxRate;
      const ctx: SizingContext = { equityKRW: o.equityAtSignalKRW, riskPerUnitPct: params.sizing.riskPerUnitPct, positionCapPct: capPct, maxUnits: params.sizing.maxUnits };

      let rawQty: number;
      if (params.sizing.pyramid === 'fixed-cap-div4' || params.sizing.pyramid === 'fixed-first-entry') {
        if (isFirstUnit || h.fixedUnitQty === null) {
          const res = params.sizing.pyramid === 'fixed-cap-div4'
            ? sizeFixedUnitCapDiv(ctx, o.nAtSignal, open, fxRate)
            : sizeFixedUnitNoCap(ctx, o.nAtSignal, fxRate);
          rawQty = res.qty;
        } else {
          rawQty = h.fixedUnitQty;
        }
      } else {
        // 'none'(B, 1유닛뿐) · 'recompute-each-time'(A) 둘 다 매번 room 기반 계산
        rawQty = sizeUnitWithRoom(ctx, o.nAtSignal, open, fxRate, existingValueKRW).qty;
      }
      const capQty = roundQty(rawQty, sec.isCryptoTicker);
      // G/C의 고정크기 불타기 유닛은 room을 미리 안 깎으므로(설계상 "고정"), 오늘 가격 기준으로 상한을
      // 넘는지 별도로 재확인한다(freshTurtleLifecycle과 동일한 "오늘 가격으로 room 검사" 관례) —
      // 안 하면 상승 추세 중 누적된 기존 유닛이 오늘가로 재평가되며 상한을 형식상 넘는 오탐이 생긴다.
      if (!isFirstUnit && capPct !== null && (params.sizing.pyramid === 'fixed-cap-div4' || params.sizing.pyramid === 'fixed-first-entry')) {
        const capKRW = ctx.equityKRW * (capPct / 100);
        if (existingValueKRW + capQty * open * fxRate > capKRW + 1e-3) { pending.delete(ticker); continue; }
      }
      if (!(capQty > 0) || capQty * open * fxRate < params.minOrderKRW) { pending.delete(ticker); continue; }
      cands.push({ ticker, sec, o, open, fxRate, capQty, newStop: open - params.stopMultipleN * o.nAtSignal, isFirstUnit });
    }

    if (cands.length > 0) {
      const baseRisk = totalOpenRiskKRW(i);
      const riskEquity = equityCurve.length ? equityCurve[equityCurve.length - 1] : initial.deployedKRW;
      const riskCapKRW = nominalEquity(params, riskEquity, yearStartEquity) * (params.maxTotalRiskPct / 100);

      const qtysAt = (lambda: number): number[] =>
        cands.map(c => roundQty(Math.min(c.capQty, c.capQty * lambda), c.sec.isCryptoTicker));

      const feasible = (qtys: number[]): boolean => {
        let needCash = 0, riskAfter = baseRisk;
        for (let k = 0; k < cands.length; k++) {
          const c = cands[k], q = qtys[k];
          if (!(q > 0)) continue;
          const value = q * c.open * c.fxRate;
          const { buyRate } = computeCostRates({ currency: c.sec.currency, isCryptoTicker: c.sec.isCryptoTicker, isKrEtf: c.sec.isKrEtf }, today, params.costMultiplier);
          needCash += value * (1 + buyRate);
          const h = holdings.get(c.ticker)!;
          if (c.isFirstUnit) {
            riskAfter += q * (params.stopMultipleN * c.o.nAtSignal) * c.fxRate;
          } else {
            const oldRisk = h.stopPrice !== null ? positionRiskOriginal(h.units, h.stopPrice) * c.fxRate : 0;
            const newUnits = [...h.units, { qty: q, fillPrice: c.open, nAtSignal: c.o.nAtSignal, fxAtFill: c.fxRate }];
            riskAfter += positionRiskOriginal(newUnits, c.newStop) * c.fxRate - oldRisk;
          }
        }
        if (needCash > cash + 1e-6) return false;
        if (riskAfter > riskCapKRW + 1e-6) return false;
        return true;
      };

      let lambda = 1;
      const fullOk = feasible(qtysAt(1));
      if (!fullOk) {
        lambdaScaleDays++;
        let lo = 0, hi = 1;
        for (let it = 0; it < 60; it++) {
          const mid = (lo + hi) / 2;
          if (feasible(qtysAt(mid))) lo = mid; else hi = mid;
        }
        lambda = lo;
      }
      const finalQtys = qtysAt(lambda);

      for (let k = 0; k < cands.length; k++) {
        const c = cands[k];
        const q = finalQtys[k];
        pending.delete(c.ticker);
        if (!(q > 0) || q * c.open * c.fxRate < params.minOrderKRW) continue;
        const h = holdings.get(c.ticker)!;
        if (c.isFirstUnit && h.status === 'HOLD_REENTERED') { inv.duplicatePosition++; continue; }

        const value = q * c.open * c.fxRate;
        const { buyRate } = computeCostRates({ currency: c.sec.currency, isCryptoTicker: c.sec.isCryptoTicker, isKrEtf: c.sec.isKrEtf }, today, params.costMultiplier);
        const cost = value * buyRate;
        cash -= value + cost;
        totalCostKRW += cost;
        totalReentryFills++;

        const newUnit: Unit = { qty: q, fillPrice: c.open, nAtSignal: c.o.nAtSignal, fxAtFill: c.fxRate };
        if (c.isFirstUnit) {
          const fixedQty = params.sizing.pyramid === 'fixed-cap-div4' || params.sizing.pyramid === 'fixed-first-entry' ? q : null;
          holdings.set(c.ticker, {
            status: 'HOLD_REENTERED', units: [newUnit], stopPrice: c.newStop,
            trail: params.exitRule.method === 'atrTrailing' ? initTrailState(c.sec, c.sec.ownIdxOfCal[i], params.exitRule.multiple) : null,
            fixedUnitQty: fixedQty, entryOwnIdx: c.sec.ownIdxOfCal[i], costBasisKRW: value, buyCostsKRW: cost, openedDate: today,
            rDenomKRW: q * params.stopMultipleN * c.o.nAtSignal * c.fxRate,
          });
        } else {
          h.units.push(newUnit);
          h.stopPrice = c.newStop;
          h.costBasisKRW += value;
          h.buyCostsKRW += cost;
        }

        // ── 체결 직후 실제 상태 검사(AMENDED-1 패턴 재사용) ──
        const hh = holdings.get(c.ticker)!;
        const posValueKRW = hh.units.reduce((s, u) => s + u.qty, 0) * c.open * c.fxRate;
        if (capPct !== null && posValueKRW > c.o.equityAtSignalKRW * (capPct / 100) + 1e-3) inv.positionCapBreach++;
        if (totalOpenRiskKRW(i) > riskCapKRW + 1e-3) inv.totalRiskBreach++;
        if (cash < -1e-6) inv.negativeCash++;
        if (hh.units.length > params.sizing.maxUnits) inv.maxUnitsBreach++;
      }
    }

    // 하루 종료 시점 상태 검사
    if (cash < -1e-6) inv.negativeCash++;
    for (const [ticker, h] of holdings) {
      if (h.units.length > params.sizing.maxUnits) inv.maxUnitsBreach++;
      const po = pending.get(ticker);
      if (po && po.ticker !== ticker) inv.duplicateOrder++;
    }

    // ════════════════════════════════════════════════════════════════
    // 3) 트레일 상태 갱신 + 신호 판정(D일 종가) → 다음 실제 거래일 시가 주문 생성
    // ════════════════════════════════════════════════════════════════
    let reenteredCount = 0;
    for (const ticker of tickersAsc) {
      const h = holdings.get(ticker)!;
      if (h.status === 'HOLD_REENTERED') reenteredCount++;
      if (h.status === 'CASH' && !params.reentryEnabled) continue;
      if (h.status !== 'CASH' && !params.tradable(ticker)) continue; // B&H/코어제외 — 신호평가 자체가 없음
      const sec = secByTicker.get(ticker)!;
      const ownIdx = sec.ownIdxOfCal[i];
      if (ownIdx < 0) continue; // 오늘 그 종목은 휴장
      if (!isWarmedUp(params.exitRule, sec, ownIdx)) continue;
      const close = sec.ownClose[ownIdx];
      if (!isNum(close)) continue;

      if (h.status !== 'CASH' && params.exitRule.method === 'atrTrailing' && h.trail) {
        h.trail = updateTrailState(h.trail, sec, ownIdx, params.exitRule.multiple);
      }

      const nextOwn = ownIdx + 1;
      const fillCal = nextOwn < sec.calIdxOfOwn.length ? sec.calIdxOfOwn[nextOwn] : -1;
      if (fillCal < 0) continue; // 데이터 끝 — 예약 불가(강제청산 없음)
      const equitySnapshot = currentEquityKRW(i);

      const createOrder = (kind: PendingOrder['kind']): void => {
        const cg = checkCreateGuard({
          hasPending: pending.has(ticker), hasPosition: h.status !== 'CASH', kind,
          signalCalIdx: i, fillCalIdx: fillCal,
        });
        if (cg !== 'ok') {
          if (cg === 'duplicate-order') inv.duplicateOrder++;
          else if (cg === 'duplicate-position') inv.duplicatePosition++;
          else if (cg === 'same-bar') inv.sameBarFill++;
          return;
        }
        const n = sec.atr[ownIdx];
        pending.set(ticker, {
          kind, ticker, signalCalIdx: i, fillCalIdx: fillCal,
          nAtSignal: isNum(n) ? n : 0, equityAtSignalKRW: nominalEquity(params, equitySnapshot, yearStartEquity),
        });
      };

      if (h.status !== 'CASH') {
        if (h.status === 'HOLD_REENTERED' && h.stopPrice !== null && close <= h.stopPrice) {
          createOrder('stop');
          continue;
        }
        if (checkExitSignal(params.exitRule, sec, ownIdx, h.trail)) {
          createOrder('exit');
          continue;
        }
        if (h.status === 'HOLD_REENTERED' && params.sizing.pyramid !== 'none' && h.units.length < params.sizing.maxUnits) {
          const lastFill = h.units[h.units.length - 1];
          const step = params.sizing.pyramidStepN ?? 0.5;
          const n = sec.atr[ownIdx];
          if (isNum(n)) {
            const trigger = lastFill.fillPrice + step * n;
            if (close >= trigger) createOrder('pyramid');
          }
        }
      } else if (params.reentryEnabled && checkEntrySignal(sec, ownIdx)) {
        createOrder('entry');
      }
    }
    if (reenteredCount > maxConcurrentReentered) maxConcurrentReentered = reenteredCount;

    // ════════════════════════════════════════════════════════════════
    // 4) 평가
    // ════════════════════════════════════════════════════════════════
    const equity = currentEquityKRW(i);
    equityCurve.push(equity);
    dates.push(today);
    cashPctSamples.push(equity > 0 ? cash / equity : 0);
  }

  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1] : initial.deployedKRW;
  const years = dates.length ? yearsBetween(dates[0], dates[dates.length - 1]) : 0;
  const cagr = years > 0 && finalEquity > 0 && initial.deployedKRW > 0
    ? Math.pow(finalEquity / initial.deployedKRW, 1 / years) - 1 : 0;
  const mdd = maxDrawdown(equityCurve);

  return {
    dates, equityCurve, finalEquityKRW: finalEquity, years, cagr, mdd, calmar: mdd > 0 ? cagr / mdd : 0,
    totalReentryFills, totalSellFills, completedRoundTrips, totalCostKRW, lambdaScaleDays,
    maxConcurrentReentered, avgCashPct: cashPctSamples.length ? cashPctSamples.reduce((a, b) => a + b, 0) / cashPctSamples.length : 0,
    trades, invariants: inv,
  };
}
