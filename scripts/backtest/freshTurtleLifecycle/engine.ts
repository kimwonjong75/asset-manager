// scripts/backtest/freshTurtleLifecycle/engine.ts
// fresh-turtle-lifecycle-v1 전용 실행기 — 순수(console/Math.random/Date.now 금지).
// SatelliteTurtleSim 은 참고만 하고 재사용하지 않는다(체결 규약이 다르다).
//
// 체결 규약(동결):
//   · 신호는 D일 종가로 판정. 채널은 D일 봉 제외.
//   · 주문은 **해당 종목의 다음 실제 거래일 시가**에 체결. max(open,돌파선)·min(open,손절선) 보정 금지.
//   · 갭은 실제 손익에 그대로 반영. 휴장일 신호·체결 없음.
//   · 대기주문은 체결 전 현금·포지션·오픈위험을 바꾸지 않는다.
//   · 같은 날: 매도 체결 → 신규진입·불타기 매수 순.
//   · 신호 우선순위: 손절 → 20일 청산 → 불타기. 매도 대기 중인 포지션에는 불타기 주문 없음.
//   · 종목별 중복 포지션·중복 대기주문 금지.
//   · 같은 날 여러 매수: 선착순 금지 — 티커 오름차순 정렬 후 공통 비율 λ 로 하향(수량 내림).

import { SecurityData, fxAt } from './data';
import type { FxTable } from '../lib/fx';

export interface StrategyRules {
  entryLookback: number;
  exitLookback: number;
  atrPeriod: number;
  stopMultipleN: number;
  pyramidStepN: number;
  riskPerUnitPct: number;
  maxTotalRiskPct: number;
  positionValueCapPct: number;
  maxUnitsPerPosition: number;
  pyramidEnabled: boolean;
  budgetKRW: number;
  initialCashKRW: number;
  costOneWay: number;
}

export type OrderKind = 'stop' | 'exit' | 'entry' | 'pyramid';
export type BlockReason =
  | 'warmup' | 'insufficient-cash' | 'insufficient-budget' | 'total-risk-limit'
  | 'position-cap' | 'duplicate-order' | 'no-next-open' | 'safety-qty-zero';

interface Unit {
  qty: number;
  fillPrice: number;   // 종목 통화
  nAtSignal: number;   // 종목 통화
  fxAtFill: number;
}

interface Position {
  ticker: string;
  units: Unit[];
  stopPrice: number;      // 공통 손절가 (종목 통화)
  rDenomKRW: number;      // 1R = 첫 진입수량 × 2N × 체결일 환율
  costBasisKRW: number;   // 배정 예산 (비용 제외)
  buyCostsKRW: number;
  openedDate: string;
  pyramidCount: number;
}

interface PendingOrder {
  kind: OrderKind;
  ticker: string;
  signalDate: string;
  signalCalIdx: number;  // 같은 봉 체결 탐지용
  fillOwnIdx: number;
  fillCalIdx: number;
  nAtSignal: number;
  proposedQty: number;   // 매수 전용
  triggerPrice: number;
}

export interface CompletedTrade {
  ticker: string;
  openedDate: string;
  closedDate: string;
  exitKind: 'stop' | 'exit';
  units: number;
  netPnlKRW: number;
  r: number;
  rDenomKRW: number;
}

export interface FillRecord {
  date: string;
  ticker: string;
  kind: OrderKind;
  qty: number;
  price: number;
  fx: number;
  costKRW: number;
}

export interface SignalFlow {
  priceCondition: Record<OrderKind, number>;
  orderCreated: Record<OrderKind, number>;
  filled: Record<OrderKind, number>;
  blocked: Record<BlockReason, number>;
}

export interface Invariants {
  negativeCash: number;
  negativeBudget: number;
  positionCapBreach: number;
  totalRiskBreach: number;
  maxUnitsBreach: number;
  duplicatePosition: number;
  duplicateOrder: number;
  sameBarFill: number;
  holidayFill: number;
}

export interface RunResult {
  equityCurve: number[];
  dates: string[];
  finalEquityKRW: number;
  cagr: number;
  totalReturn: number;
  mdd: number;
  calmar: number;
  trades: CompletedTrade[];
  fills: FillRecord[];
  flow: SignalFlow;
  invariants: Invariants;
  totalCostKRW: number;
  meanExposure: number;
  unrealizedKRW: number;
  openPositionsAtEnd: { ticker: string; units: number; unrealizedKRW: number }[];
  pyramidFills: number;
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// ── 가드 (AMENDED-1 #2) ─────────────────────────────────────────────────────
// 엔진 내부에서만 쓰면 정상 흐름상 도달 불가라 "죽은 카운터"와 구분되지 않는다.
// 순수 함수로 분리해 **테스트가 직접 위반 입력을 넣어** 탐지 경로가 살아있음을 증명한다.

export type CreateGuard = 'ok' | 'duplicate-order' | 'duplicate-position' | 'same-bar';

/** 주문 생성 가드 — 덮어쓰기·중복 포지션·같은 봉 예약을 거부한다. */
export function checkCreateGuard(p: {
  hasPending: boolean; hasPosition: boolean; kind: OrderKind;
  signalCalIdx: number; fillCalIdx: number;
}): CreateGuard {
  if (p.hasPending) return 'duplicate-order';
  if (p.kind === 'entry' && p.hasPosition) return 'duplicate-position';
  if (p.fillCalIdx <= p.signalCalIdx) return 'same-bar';
  return 'ok';
}

export type FillGuard = 'ok' | 'same-bar' | 'holiday' | 'duplicate-position' | 'orphan-pyramid';

/** 체결 가드 — 같은 봉·휴장일·중복 포지션(현금 차감 전)·부모 없는 불타기를 거부한다. */
export function checkFillGuard(p: {
  kind: OrderKind; signalCalIdx: number; fillCalIdx: number;
  ownIdxAtFill: number; hasPosition: boolean;
}): FillGuard {
  if (p.fillCalIdx <= p.signalCalIdx) return 'same-bar';
  if (p.ownIdxAtFill < 0) return 'holiday';
  if (p.kind === 'entry' && p.hasPosition) return 'duplicate-position';
  if (p.kind === 'pyramid' && !p.hasPosition) return 'orphan-pyramid';
  return 'ok';
}

function roundQty(q: number, fractional: boolean): number {
  if (!(q > 0)) return 0;
  return fractional ? Math.floor(q * 1e8) / 1e8 : Math.floor(q);
}

/** 포지션 원통화 오픈위험 = max(0, Σ qty×(체결가 − 공통손절가)). */
export function positionRiskOriginal(units: Unit[], stopPrice: number): number {
  return Math.max(0, units.reduce((s, u) => s + u.qty * (u.fillPrice - stopPrice), 0));
}

function emptyFlow(): SignalFlow {
  const z = (): Record<OrderKind, number> => ({ stop: 0, exit: 0, entry: 0, pyramid: 0 });
  return {
    priceCondition: z(), orderCreated: z(), filled: z(),
    blocked: {
      warmup: 0, 'insufficient-cash': 0, 'insufficient-budget': 0, 'total-risk-limit': 0,
      'position-cap': 0, 'duplicate-order': 0, 'no-next-open': 0, 'safety-qty-zero': 0,
    },
  };
}

function maxDrawdown(curve: number[]): number {
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

/**
 * 백테스트 실행.
 * @param windowStart/windowEnd 거래 허용 구간 (이전 데이터는 지표 워밍업 전용, 포지션 이월 없음)
 */
export function runBacktest(params: {
  calendar: string[];
  securities: SecurityData[];
  fx: FxTable;
  rules: StrategyRules;
  windowStart: string;
  windowEnd: string;
}): RunResult {
  const { calendar, securities, fx, rules } = params;
  // 결정론·입력순서 무관: 티커 오름차순 고정
  const secs = [...securities].sort((a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0));
  const secByTicker = new Map(secs.map(s => [s.ticker, s]));

  let cash = rules.initialCashKRW;
  const positions = new Map<string, Position>();
  const pending = new Map<string, PendingOrder>(); // 티커당 최대 1건 (중복 대기주문 금지)
  const trades: CompletedTrade[] = [];
  const fills: FillRecord[] = [];
  const flow = emptyFlow();
  const inv: Invariants = {
    negativeCash: 0, negativeBudget: 0, positionCapBreach: 0, totalRiskBreach: 0,
    maxUnitsBreach: 0, duplicatePosition: 0, duplicateOrder: 0, sameBarFill: 0, holidayFill: 0,
  };
  let totalCostKRW = 0;
  const equityCurve: number[] = [];
  const curveDates: string[] = [];
  const exposures: number[] = [];

  const deployedKRW = (): number => {
    let s = 0;
    for (const p of positions.values()) s += p.costBasisKRW;
    return s;
  };
  const totalOpenRiskKRW = (calIdx: number): number => {
    let s = 0;
    for (const p of positions.values()) {
      const sec = secByTicker.get(p.ticker)!;
      s += positionRiskOriginal(p.units, p.stopPrice) * fxAt(sec, fx, calIdx);
    }
    return s;
  };
  const positionValueKRW = (p: Position, price: number, fxRate: number): number =>
    p.units.reduce((s, u) => s + u.qty, 0) * price * fxRate;

  const riskCapKRW = rules.budgetKRW * (rules.maxTotalRiskPct / 100);
  const posCapKRW = rules.budgetKRW * (rules.positionValueCapPct / 100);
  const unitRiskKRW = rules.budgetKRW * (rules.riskPerUnitPct / 100);

  const inWindow = (d: string): boolean => d >= params.windowStart && d <= params.windowEnd;

  for (let i = 0; i < calendar.length; i++) {
    const today = calendar[i];
    if (!inWindow(today)) {
      // 구간 밖: 거래 없음. 지표는 이미 종목 자신의 전 구간에서 계산돼 있다.
      continue;
    }

    // ════════════════════════════════════════════════════════════════
    // 1) 매도 체결 (오늘 예정분) — 매수보다 먼저
    // ════════════════════════════════════════════════════════════════
    for (const sec of secs) {
      const o = pending.get(sec.ticker);
      if (!o || o.fillCalIdx !== i) continue;
      if (o.kind !== 'stop' && o.kind !== 'exit') continue;

      const ownIdx = sec.ownIdxOfCal[i];
      const g = checkFillGuard({
        kind: o.kind, signalCalIdx: o.signalCalIdx, fillCalIdx: o.fillCalIdx,
        ownIdxAtFill: ownIdx, hasPosition: positions.has(sec.ticker),
      });
      if (g !== 'ok') {   // 위반 시 카운터만 올리고 넘어가지 않는다 — 체결 자체를 막는다
        if (g === 'same-bar') inv.sameBarFill++;
        else if (g === 'holiday') inv.holidayFill++;
        pending.delete(sec.ticker);
        continue;
      }
      const open = sec.ownOpen[ownIdx];
      if (!isNum(open) || !(open > 0)) {
        pending.delete(sec.ticker); flow.blocked['no-next-open']++; continue;
      }
      const p = positions.get(sec.ticker);
      if (!p) { pending.delete(sec.ticker); continue; }

      const fxRate = fxAt(sec, fx, i);
      const qty = p.units.reduce((s, u) => s + u.qty, 0);
      const proceeds = qty * open * fxRate;
      const cost = proceeds * rules.costOneWay;
      cash += proceeds - cost;
      totalCostKRW += cost;

      const netPnl = proceeds - cost - p.costBasisKRW - p.buyCostsKRW;
      trades.push({
        ticker: p.ticker, openedDate: p.openedDate, closedDate: today,
        exitKind: o.kind, units: p.units.length,
        netPnlKRW: netPnl, r: p.rDenomKRW > 0 ? netPnl / p.rDenomKRW : 0, rDenomKRW: p.rDenomKRW,
      });
      fills.push({ date: today, ticker: p.ticker, kind: o.kind, qty, price: open, fx: fxRate, costKRW: cost });
      flow.filled[o.kind]++;
      positions.delete(sec.ticker);
      pending.delete(sec.ticker);
    }

    // ════════════════════════════════════════════════════════════════
    // 2) 매수 체결 (신규진입·불타기) — 일괄 계산 + 공통 비율 λ 하향
    // ════════════════════════════════════════════════════════════════
    interface Cand {
      sec: SecurityData; o: PendingOrder; open: number; fxRate: number;
      capQty: number;     // 개별 상한(25%·최대유닛) 적용 후 상한 수량
      newStop: number;
    }
    const cands: Cand[] = [];
    for (const sec of secs) {                                   // 티커 오름차순 — 입력 순서 무관
      const o = pending.get(sec.ticker);
      if (!o || o.fillCalIdx !== i) continue;
      if (o.kind !== 'entry' && o.kind !== 'pyramid') continue;

      const ownIdx = sec.ownIdxOfCal[i];
      const p = positions.get(sec.ticker);
      // 중복 포지션 검사는 **현금 차감 전** (가드 함수 내부에서 수행)
      const g = checkFillGuard({
        kind: o.kind, signalCalIdx: o.signalCalIdx, fillCalIdx: o.fillCalIdx,
        ownIdxAtFill: ownIdx, hasPosition: p != null,
      });
      if (g !== 'ok') {
        if (g === 'same-bar') inv.sameBarFill++;
        else if (g === 'holiday') inv.holidayFill++;
        else if (g === 'duplicate-position') inv.duplicatePosition++;
        else if (g === 'orphan-pyramid') flow.blocked['safety-qty-zero']++;
        pending.delete(sec.ticker);
        continue;
      }
      const open = sec.ownOpen[ownIdx];
      if (!isNum(open) || !(open > 0)) {
        pending.delete(sec.ticker); flow.blocked['no-next-open']++; continue;
      }
      const fxRate = fxAt(sec, fx, i);

      // 최대 유닛
      const curUnits = p ? p.units.length : 0;
      if (curUnits >= rules.maxUnitsPerPosition) {
        pending.delete(sec.ticker); flow.blocked['position-cap']++; continue;
      }
      // 25% 상한: 포지션 전체 시가 ≤ budget×25%
      const existingQty = p ? p.units.reduce((s, u) => s + u.qty, 0) : 0;
      const roomKRW = posCapKRW - existingQty * open * fxRate;
      if (!(roomKRW > 0)) {
        pending.delete(sec.ticker); flow.blocked['position-cap']++; continue;
      }
      const capQty = roundQty(Math.min(o.proposedQty, roomKRW / (open * fxRate)), sec.isCrypto);
      if (!(capQty > 0)) {
        pending.delete(sec.ticker); flow.blocked['safety-qty-zero']++; continue;
      }
      cands.push({ sec, o, open, fxRate, capQty, newStop: open - rules.stopMultipleN * o.nAtSignal });
    }

    if (cands.length > 0) {
      const baseRisk = totalOpenRiskKRW(i);
      const baseDeployed = deployedKRW();

      const qtysAt = (lambda: number): number[] =>
        cands.map(c => roundQty(Math.min(c.capQty, c.capQty * lambda), c.sec.isCrypto));

      const feasible = (qtys: number[]): { ok: boolean; reason?: BlockReason } => {
        let needCash = 0, needBudget = 0, riskAfter = baseRisk;
        for (let k = 0; k < cands.length; k++) {
          const c = cands[k], q = qtys[k];
          if (!(q > 0)) continue;
          const value = q * c.open * c.fxRate;
          needCash += value * (1 + rules.costOneWay);
          needBudget += value;
          const p = positions.get(c.sec.ticker);
          if (c.o.kind === 'entry') {
            riskAfter += q * (rules.stopMultipleN * c.o.nAtSignal) * c.fxRate;
          } else if (p) {
            const oldRisk = positionRiskOriginal(p.units, p.stopPrice) * c.fxRate;
            const newUnits: Unit[] = [...p.units, { qty: q, fillPrice: c.open, nAtSignal: c.o.nAtSignal, fxAtFill: c.fxRate }];
            riskAfter += positionRiskOriginal(newUnits, c.newStop) * c.fxRate - oldRisk;
          }
        }
        if (needCash > cash + 1e-9) return { ok: false, reason: 'insufficient-cash' };
        if (baseDeployed + needBudget > rules.budgetKRW + 1e-9) return { ok: false, reason: 'insufficient-budget' };
        if (riskAfter > riskCapKRW + 1e-9) return { ok: false, reason: 'total-risk-limit' };
        return { ok: true };
      };

      // λ 이분탐색 (수량 내림 → 실행가능성은 λ 에 단조) — 입력 순서 무관·결정론
      let lambda = 1;
      let firstFail: BlockReason | undefined;
      const full = feasible(qtysAt(1));
      if (!full.ok) {
        firstFail = full.reason;
        let lo = 0, hi = 1;
        for (let it = 0; it < 60; it++) {
          const mid = (lo + hi) / 2;
          if (feasible(qtysAt(mid)).ok) lo = mid; else hi = mid;
        }
        lambda = lo;
      }
      const finalQtys = qtysAt(lambda);

      for (let k = 0; k < cands.length; k++) {
        const c = cands[k];
        const q = finalQtys[k];
        pending.delete(c.sec.ticker);
        if (!(q > 0)) {
          flow.blocked[firstFail ?? 'safety-qty-zero']++;
          continue;
        }
        const p = positions.get(c.sec.ticker);
        // 중복 포지션 최종 가드 — **현금 차감 전** (위반 시 체결을 막는다)
        if (c.o.kind === 'entry' && p) { inv.duplicatePosition++; continue; }

        const value = q * c.open * c.fxRate;
        const cost = value * rules.costOneWay;
        cash -= value + cost;
        totalCostKRW += cost;

        if (c.o.kind === 'entry') {
          positions.set(c.sec.ticker, {
            ticker: c.sec.ticker,
            units: [{ qty: q, fillPrice: c.open, nAtSignal: c.o.nAtSignal, fxAtFill: c.fxRate }],
            stopPrice: c.newStop,
            rDenomKRW: q * rules.stopMultipleN * c.o.nAtSignal * c.fxRate,
            costBasisKRW: value, buyCostsKRW: cost, openedDate: today, pyramidCount: 0,
          });
        } else if (p) {
          p.units.push({ qty: q, fillPrice: c.open, nAtSignal: c.o.nAtSignal, fxAtFill: c.fxRate });
          p.stopPrice = c.newStop;   // 실제 불타기 체결가 − 2×신호일 N → 전체 공통 손절가
          p.costBasisKRW += value;
          p.buyCostsKRW += cost;
          p.pyramidCount++;
        }
        fills.push({ date: today, ticker: c.sec.ticker, kind: c.o.kind, qty: q, price: c.open, fx: c.fxRate, costKRW: cost });
        flow.filled[c.o.kind]++;

        // ── 매수 체결 **직후** 실제 상태 검사 (AMENDED-1 #2 — 사전검사가 옳다면 0이어야 한다) ──
        const pp = positions.get(c.sec.ticker)!;
        // 해당 포지션 전체 시가(체결가 기준) ≤ 위성예산 25%
        if (positionValueKRW(pp, c.open, c.fxRate) > posCapKRW + 1e-6) inv.positionCapBreach++;
        // 총 오픈위험 ≤ 12%
        if (totalOpenRiskKRW(i) > riskCapKRW + 1e-6) inv.totalRiskBreach++;
        // 현금·잔여예산 음수 금지
        if (cash < -1e-6) inv.negativeCash++;
        if (rules.budgetKRW - deployedKRW() < -1e-6) inv.negativeBudget++;
        // 최대 유닛
        if (pp.units.length > rules.maxUnitsPerPosition) inv.maxUnitsBreach++;
      }
    }

    // 하루 종료 시점 상태 검사 (매도 포함 전체)
    if (cash < -1e-6) inv.negativeCash++;
    if (rules.budgetKRW - deployedKRW() < -1e-6) inv.negativeBudget++;
    for (const p of positions.values()) {
      if (p.units.length > rules.maxUnitsPerPosition) inv.maxUnitsBreach++;
      // 티커당 포지션은 Map 키로 1개가 보장되나, 대기주문과의 정합도 확인
      const po = pending.get(p.ticker);
      if (po && po.ticker !== p.ticker) inv.duplicateOrder++;
    }

    // ════════════════════════════════════════════════════════════════
    // 3) 신호 판정 (D일 종가) → 다음 실제 거래일 시가 주문 생성
    // ════════════════════════════════════════════════════════════════
    for (const sec of secs) {
      const ownIdx = sec.ownIdxOfCal[i];
      if (ownIdx < 0) continue;                       // 휴장 → 신호 없음
      const close = sec.ownClose[ownIdx];
      if (!isNum(close)) continue;

      // 워밍업: 자기 거래일 기준 55봉 선행 + ATR20 + 채널
      const n = sec.atr[ownIdx];
      const hi55 = sec.ch55High[ownIdx];
      const lo20 = sec.ch20Low[ownIdx];
      const warm = ownIdx >= rules.entryLookback && isNum(n) && n > 0 && isNum(hi55) && isNum(lo20);

      const p = positions.get(sec.ticker);
      const hasPending = pending.has(sec.ticker);

      if (!warm) {
        if (!p) flow.blocked['warmup']++;
        continue;
      }

      const nextOwn = ownIdx + 1;
      const fillCal = nextOwn < sec.calIdxOfOwn.length ? sec.calIdxOfOwn[nextOwn] : -1;

      /**
       * 주문 생성. **덮어쓰기 방지 가드 내장** — Map 이라 중복이 불가능하다는 것에 기대지 않고,
       * 이미 대기주문이 있으면 생성 자체를 거부하고 duplicateOrder 를 올린다(AMENDED-1 #2).
       */
      const create = (kind: OrderKind, proposedQty: number, trigger: number): boolean => {
        const cg = checkCreateGuard({
          hasPending: pending.has(sec.ticker), hasPosition: positions.has(sec.ticker),
          kind, signalCalIdx: i, fillCalIdx: fillCal,
        });
        if (cg !== 'ok') {
          if (cg === 'duplicate-order') inv.duplicateOrder++;
          else if (cg === 'duplicate-position') inv.duplicatePosition++;
          else if (cg === 'same-bar') inv.sameBarFill++;
          return false;
        }
        flow.orderCreated[kind]++;
        pending.set(sec.ticker, {
          kind, ticker: sec.ticker, signalDate: today, signalCalIdx: i,
          fillOwnIdx: nextOwn, fillCalIdx: fillCal, nAtSignal: n as number,
          proposedQty, triggerPrice: trigger,
        });
        return true;
      };

      if (p) {
        // 우선순위: 손절 → 20일 청산 → 불타기
        if (close <= p.stopPrice) {
          flow.priceCondition.stop++;
          if (hasPending) { flow.blocked['duplicate-order']++; continue; }
          if (fillCal < 0) { flow.blocked['no-next-open']++; continue; }
          create('stop', 0, p.stopPrice);
          continue;
        }
        if (close <= (lo20 as number)) {
          flow.priceCondition.exit++;
          if (hasPending) { flow.blocked['duplicate-order']++; continue; }
          if (fillCal < 0) { flow.blocked['no-next-open']++; continue; }
          create('exit', 0, lo20 as number);
          continue;
        }
        if (rules.pyramidEnabled && p.units.length < rules.maxUnitsPerPosition) {
          const lastFill = p.units[p.units.length - 1].fillPrice;
          const trigger = lastFill + rules.pyramidStepN * (n as number);
          if (close >= trigger) {
            flow.priceCondition.pyramid++;
            // 매도 대기 중인 포지션에는 불타기 주문 금지
            if (hasPending) { flow.blocked['duplicate-order']++; continue; }
            if (fillCal < 0) { flow.blocked['no-next-open']++; continue; }
            const fxRate = fxAt(sec, fx, i);
            const qty = roundQty(unitRiskKRW / ((n as number) * fxRate), sec.isCrypto);
            if (!(qty > 0)) { flow.blocked['safety-qty-zero']++; continue; }
            create('pyramid', qty, trigger);
          }
        }
      } else {
        if (close >= (hi55 as number)) {
          flow.priceCondition.entry++;
          if (hasPending) { flow.blocked['duplicate-order']++; continue; }
          if (fillCal < 0) { flow.blocked['no-next-open']++; continue; }
          const fxRate = fxAt(sec, fx, i);
          const qty = roundQty(unitRiskKRW / ((n as number) * fxRate), sec.isCrypto);
          if (!(qty > 0)) { flow.blocked['safety-qty-zero']++; continue; }
          create('entry', qty, hi55 as number);
        }
      }
    }

    // ════════════════════════════════════════════════════════════════
    // 4) 평가 (현금 + 포지션 시가) — 평가용 종가 carry-forward 허용
    // ════════════════════════════════════════════════════════════════
    let posValue = 0;
    for (const p of positions.values()) {
      const sec = secByTicker.get(p.ticker)!;
      const c = sec.closeForValuation[i];
      if (isNum(c)) posValue += positionValueKRW(p, c, fxAt(sec, fx, i));
    }
    const equity = cash + posValue;
    equityCurve.push(equity);
    curveDates.push(today);
    exposures.push(equity > 0 ? posValue / equity : 0);
  }

  // ── 종료 처리: 강제청산 없음. 미실현만 분리 기록 ──
  let lastIdx = -1;
  for (let i = calendar.length - 1; i >= 0; i--) { if (inWindow(calendar[i])) { lastIdx = i; break; } }
  const openAtEnd: { ticker: string; units: number; unrealizedKRW: number }[] = [];
  let unrealized = 0;
  for (const p of positions.values()) {
    const sec = secByTicker.get(p.ticker)!;
    const c = lastIdx >= 0 ? sec.closeForValuation[lastIdx] : null;
    const v = isNum(c) ? positionValueKRW(p, c, fxAt(sec, fx, lastIdx)) : p.costBasisKRW;
    const u = v - p.costBasisKRW - p.buyCostsKRW;
    unrealized += u;
    openAtEnd.push({ ticker: p.ticker, units: p.units.length, unrealizedKRW: u });
  }

  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1] : rules.initialCashKRW;
  const years = curveDates.length ? yearsBetween(curveDates[0], curveDates[curveDates.length - 1]) : 0;
  const totalReturn = finalEquity / rules.initialCashKRW - 1;
  const cagr = years > 0 && finalEquity > 0 ? Math.pow(finalEquity / rules.initialCashKRW, 1 / years) - 1 : 0;
  const mdd = maxDrawdown(equityCurve);

  return {
    equityCurve, dates: curveDates, finalEquityKRW: finalEquity,
    cagr, totalReturn, mdd, calmar: mdd > 0 ? cagr / mdd : 0,
    trades, fills, flow, invariants: inv, totalCostKRW,
    meanExposure: exposures.length ? exposures.reduce((a, b) => a + b, 0) / exposures.length : 0,
    unrealizedKRW: unrealized,
    openPositionsAtEnd: openAtEnd.sort((a, b) => (a.ticker < b.ticker ? -1 : 1)),
    pyramidFills: fills.filter(f => f.kind === 'pyramid').length,
  };
}
