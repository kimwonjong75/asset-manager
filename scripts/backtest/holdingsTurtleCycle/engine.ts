// scripts/backtest/holdingsTurtleCycle/engine.ts
// holdings-turtle-cycle-v1 전용 실행기 — 순수(console/Math.random/Date.now 금지).
//
// 완전한 터틀 사이클: 보유분이 청산선 아래로 마감 → 매도 → 현금 대기 → 신고가 돌파 시 재매수
//   → 재매수분은 2N 손절/청산선으로 매도 → 반복. 보유분(시작일 포지션)은 매수가를 모르므로 손절 없음(청산선만).
//
// 체결 규약(동결, freshTurtleLifecycle/onboardingPolicy와 동일):
//   · 신호는 D일 종가로 판정. 채널은 D일 봉 제외.
//   · 주문은 다음 실제 거래일 시가에 체결. 클램프 금지(max/min 보정 없음). 갭 그대로 반영.
//   · 같은 날: 매도 체결 먼저 → (동일 종목이므로 같은 날 재매수 신호도 그 다음에 평가).
//   · 우선순위: 손절(재매수분만) → 채널청산.
//
// 사이징(§리서치 범위 결정): 위험기반 사이징 없음 — 매도 시 전량 현금화, 재매수 시 그 현금 100% 투입.
//   B&H와 1:1 비교가 목적이라 수량 대신 **정규화 자본비율**(시작일=1.0)로 추적한다. 환율 불필요(주석 참고, data.ts).

import { SecurityData } from './data';
import { computeCostRates, CostInputs } from './costs';

export interface VariantRules {
  id: string;
  name: string;
  /** 재진입(신고가 돌파) 판정에 쓰는 고가 채널 lookback. */
  entryLookback: number;
  /** 매도(채널청산) 판정에 쓰는 저가 채널 lookback. 보유분·재매수분 공통. */
  exitLookback: number;
  /** N = ATR(atrPeriod). 이번 연구에서는 3변형 전부 20 고정. */
  atrPeriod: number;
  /** 재매수분 손절 = 체결가 − stopMultipleN × 신호일 N. */
  stopMultipleN: number;
}

export type SkipReason = 'no-warmup' | 'bad-start-price';

export interface FillLog {
  date: string;
  kind: 'buy' | 'sell';
  reason: 'stop' | 'exit' | 'entry';
  /** 체결가 — 다음 유효 거래일 시가(클램프 없음, 갭 그대로). */
  price: number;
}

export interface CellResult {
  ticker: string;
  startDate: string;
  startIdx: number;
  endDate: string;
  years: number;
  bhFinalRatio: number;
  bhCagr: number;
  bhMdd: number;
  bhWorst50: boolean;
  turtleFinalRatio: number;
  turtleCagr: number;
  turtleMdd: number;
  turtleWorst50: boolean;
  /** 터틀/B&H 최종가치 비율. */
  finalRatioRatio: number;
  turtleBeatsBh: boolean;
  timeInMarketPct: number;
  /** 재진입(매수) 체결 수. */
  roundTrips: number;
  /** 재진입 중 창(윈도) 안에서 다시 청산까지 완료된 수. */
  completedRoundTrips: number;
  /** 매도 후 20거래일 안에 더 높은 가격으로 재매수된 수. */
  whipsaws: number;
  /** 최초 보유분이 청산된 날짜(없으면 끝까지 보유 — null). */
  initialExitDate: string | null;
  /** 창 종료 시 상태(보유/현금) — 강제청산 없음. */
  finalState: 'HOLD_INITIAL' | 'HOLD_REENTERED' | 'CASH';
  /** 체결 로그(검증·리포트용). */
  fills: FillLog[];
  /** opts.includeSeries=true일 때만 채워짐 — 날짜별 B&H/터틀 정규화 자본비율 전체 시계열(에피소드 분해 등). */
  series?: { dates: string[]; bh: number[]; turtle: number[] };
}

export type SkipRecord = { skip: true; reason: SkipReason };

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function minOf(xs: number[]): number {
  let m = Infinity;
  for (const v of xs) if (v < m) m = v;
  return m;
}

function maxDrawdownFromRatios(ratios: number[]): number {
  let peak = -Infinity, mdd = 0;
  for (const v of ratios) {
    if (v > peak) peak = v;
    if (peak > 0) { const dd = (peak - v) / peak; if (dd > mdd) mdd = dd; }
  }
  return mdd;
}

/** 실제 경과일 ÷ 365.2425 (거래봉수×252 금지 — RULES §13-1/§13-2 교훈). */
export function yearsBetweenIso(aISO: string, bISO: string): number {
  const a = Date.parse(`${aISO}T00:00:00Z`), b = Date.parse(`${bISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return (b - a) / 86_400_000 / 365.2425;
}

interface PendingOrder {
  kind: 'sell' | 'buy';
  reason: 'stop' | 'exit' | 'entry';
  signalIdx: number;
  fillIdx: number;
}

export interface SimulateCellOptions {
  /**
   * 매도 후 현금 대기 중 적용할 연이율(%, 단리 아님 — 달력일 복리, 365.2425 기준). 기본 0(무이자).
   * 신호(채널 돌파)는 가격만으로 결정되므로 이자 유무가 매매 타이밍에 영향을 주지 않는다 —
   * 자본비율 계산에만 얹는 오버레이. §과제 "현금 이자 0%/2.5% 두 가지 보고" 용.
   */
  cashAnnualRatePct?: number;
  /** true면 CellResult.series에 날짜별 B&H/터틀 비율 전체를 채운다(에피소드 분해용). 기본 false(그리드 실행 시 메모리 절약). */
  includeSeries?: boolean;
  /**
   * 지정 시 이 own 인덱스까지만 시뮬레이션한다(고정기간 롤링창 비교용, "그 시점까지" 마크투마켓 —
   * 강제청산이 아니라 그 인덱스 시점의 상태·비율을 그대로 반환). 이 인덱스를 넘어서는 체결은 예약하지
   * 않는다(창 밖 미래 데이터 누출 금지). 미지정 시 데이터 끝까지(기존 동작과 동일, 하위호환).
   */
  maxEndIdx?: number;
}

/**
 * 한 셀(종목 × 시작일 × 변형 × 비용단계) 시뮬레이션.
 * @param startIdx 시작일의 own 인덱스 — "이 날 이 종목을 보유 중"이라 가정.
 */
export function simulateCell(
  sec: SecurityData,
  startIdx: number,
  rules: VariantRules,
  costMultiplier: number,
  opts: SimulateCellOptions = {}
): CellResult | SkipRecord {
  const n = sec.ownDates.length;
  const hiArr = sec.highChannel[rules.entryLookback];
  const loArr = sec.lowChannel[rules.exitLookback];
  if (!hiArr || !loArr) return { skip: true, reason: 'no-warmup' };
  if (!isNum(sec.atr[startIdx]) || !isNum(hiArr[startIdx]) || !isNum(loArr[startIdx])) {
    return { skip: true, reason: 'no-warmup' };
  }
  const startClose = sec.ownClose[startIdx];
  if (!isNum(startClose) || !(startClose > 0)) return { skip: true, reason: 'bad-start-price' };

  const costInputs: CostInputs = {
    currency: sec.currency, isCryptoTicker: sec.isCryptoTicker, isKrEtf: sec.isKrEtf,
  };

  // maxEndIdx 지정 시 그 인덱스까지만(고정기간 롤링창) — 시작일 이전으로 클램프하지 않는다.
  const lastIdx = opts.maxEndIdx !== undefined ? Math.max(startIdx, Math.min(opts.maxEndIdx, n - 1)) : n - 1;
  const cashAnnualRatePct = opts.cashAnnualRatePct ?? 0;
  // 달력일 복리 일변화율(365.2425 기준, 기존 CAGR 환산 관례와 동일 분모).
  const cashRatePerDay = cashAnnualRatePct !== 0 ? Math.pow(1 + cashAnnualRatePct / 100, 1 / 365.2425) - 1 : 0;

  // ── B&H 경로 (그 시점까지 보유, 비용 없음 — 매수·매도를 안 하므로 거래비용 자체가 없다) ──
  const bhRatios: number[] = [];
  for (let i = startIdx; i <= lastIdx; i++) {
    const c = sec.ownClose[i];
    bhRatios.push(isNum(c) ? c / startClose : (bhRatios.length ? bhRatios[bhRatios.length - 1] : 1));
  }
  const bhFinal = bhRatios[bhRatios.length - 1];
  const bhMdd = maxDrawdownFromRatios(bhRatios);
  const bhWorst50 = minOf(bhRatios) <= 0.5;

  // ── 터틀 사이클 경로 ──
  type State = 'HOLD_INITIAL' | 'HOLD_REENTERED' | 'CASH';
  let state: State = 'HOLD_INITIAL';
  let capitalRatio = 1;
  let refPrice = startClose;
  let stopPrice: number | null = null;
  let pending: PendingOrder | null = null;

  const turtleRatios: number[] = [];
  const fills: FillLog[] = [];
  let daysInMarket = 0;
  let roundTrips = 0, completedRoundTrips = 0, whipsaws = 0;
  let initialExitDate: string | null = null;
  let lastSellIdx: number | null = null;
  let lastSellPrice: number | null = null;
  let prevDate: string | null = null;

  for (let i = startIdx; i <= lastIdx; i++) {
    // 0) 현금 이자 반영(옵션) — 직전 봉부터 오늘까지 CASH 상태였던 달력일수만큼 복리 반영.
    //    신호(가격 채널)는 capitalRatio와 무관하므로 매매 타이밍에는 영향이 없다(순수 오버레이).
    if (cashRatePerDay !== 0 && state === 'CASH' && prevDate !== null) {
      const days = Math.round((Date.parse(`${sec.ownDates[i]}T00:00:00Z`) - Date.parse(`${prevDate}T00:00:00Z`)) / 86_400_000);
      if (days > 0) capitalRatio *= Math.pow(1 + cashRatePerDay, days);
    }
    prevDate = sec.ownDates[i];

    // 1) 오늘 예정된 체결 처리 (종목당 대기주문 1건뿐 — 매도/매수 겹칠 일 없음)
    if (pending && pending.fillIdx === i) {
      const openPx = sec.ownOpen[i];
      if (isNum(openPx) && openPx > 0) {
        const dateISO = sec.ownDates[i];
        const { buyRate, sellRate } = computeCostRates(costInputs, dateISO, costMultiplier);
        if (pending.kind === 'sell') {
          const grossRatio = capitalRatio * (openPx / refPrice);
          capitalRatio = grossRatio * (1 - sellRate);
          if (state === 'HOLD_REENTERED') completedRoundTrips++;
          else initialExitDate = dateISO;
          lastSellIdx = i; lastSellPrice = openPx;
          state = 'CASH'; stopPrice = null;
        } else {
          capitalRatio = capitalRatio * (1 - buyRate);
          refPrice = openPx;
          const nAtSignal = sec.atr[pending.signalIdx];
          stopPrice = isNum(nAtSignal) ? openPx - rules.stopMultipleN * nAtSignal : null;
          state = 'HOLD_REENTERED';
          roundTrips++;
          if (lastSellIdx !== null && lastSellPrice !== null && i - lastSellIdx <= 20 && openPx > lastSellPrice) {
            whipsaws++;
          }
        }
        fills.push({ date: dateISO, kind: pending.kind, reason: pending.reason, price: openPx });
      }
      pending = null;
    }

    // 2) 오늘 평가 (종가 기준)
    const closeToday = sec.ownClose[i];
    if (state !== 'CASH') {
      turtleRatios.push(isNum(closeToday) ? capitalRatio * (closeToday / refPrice) : capitalRatio);
      daysInMarket++;
    } else {
      turtleRatios.push(capitalRatio);
    }

    // 3) 신호 판정 (오늘 종가 기준) → 다음 유효 거래일 시가 체결 예약. 마지막 봉(또는 창 끝)이면
    //    예약하지 않는다(강제청산 없음 · maxEndIdx 지정 시 창 밖 체결로 정보가 누출되지 않도록 lastIdx로 제한).
    if (!pending && isNum(closeToday) && i + 1 <= lastIdx) {
      if (state === 'HOLD_REENTERED' && isNum(stopPrice) && closeToday <= (stopPrice as number)) {
        pending = { kind: 'sell', reason: 'stop', signalIdx: i, fillIdx: i + 1 };
      } else if (state !== 'CASH') {
        const loVal = loArr[i];
        if (isNum(loVal) && closeToday <= loVal) pending = { kind: 'sell', reason: 'exit', signalIdx: i, fillIdx: i + 1 };
      } else {
        const hiVal = hiArr[i];
        if (isNum(hiVal) && closeToday >= hiVal) pending = { kind: 'buy', reason: 'entry', signalIdx: i, fillIdx: i + 1 };
      }
    }
  }

  const turtleFinal = turtleRatios[turtleRatios.length - 1];
  const turtleMdd = maxDrawdownFromRatios(turtleRatios);
  const turtleWorst50 = minOf(turtleRatios) <= 0.5;

  const startDateISO = sec.ownDates[startIdx];
  const endDateISO = sec.ownDates[lastIdx];
  const years = yearsBetweenIso(startDateISO, endDateISO);
  const horizonBars = lastIdx - startIdx + 1;

  const annualize = (finalRatio: number): number => {
    if (!(years > 0) || !(finalRatio > 0)) return 0;
    return Math.pow(finalRatio, 1 / years) - 1;
  };

  const result: CellResult = {
    ticker: sec.ticker, startDate: startDateISO, startIdx, endDate: endDateISO, years,
    bhFinalRatio: bhFinal, bhCagr: annualize(bhFinal), bhMdd, bhWorst50,
    turtleFinalRatio: turtleFinal, turtleCagr: annualize(turtleFinal), turtleMdd, turtleWorst50,
    finalRatioRatio: bhFinal > 0 ? turtleFinal / bhFinal : (turtleFinal > 0 ? Infinity : 0),
    turtleBeatsBh: turtleFinal > bhFinal,
    timeInMarketPct: horizonBars > 0 ? (daysInMarket / horizonBars) * 100 : 0,
    roundTrips, completedRoundTrips, whipsaws, initialExitDate,
    finalState: state,
    fills,
  };
  if (opts.includeSeries) {
    result.series = { dates: sec.ownDates.slice(startIdx, lastIdx + 1), bh: bhRatios, turtle: turtleRatios };
  }
  return result;
}

export function isSkip(r: CellResult | SkipRecord): r is SkipRecord {
  return (r as SkipRecord).skip === true;
}

/** 종목의 월 첫 실제 거래일 인덱스(구간 내) — onboardingPolicy.monthlyFirstTradingDays와 동일 알고리즘. */
export function monthlyFirstTradingDayIndices(dates: string[], startISO: string, endISO: string): number[] {
  const out: number[] = [];
  let lastKey = '';
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    if (d < startISO || d > endISO) continue;
    const key = d.slice(0, 7);
    if (key !== lastKey) { out.push(i); lastKey = key; }
  }
  return out;
}

export interface LatestChannelStatus {
  ticker: string;
  asOfDate: string;
  latestClose: number;
  exitLow: number | null;
  entryHigh: number | null;
  belowExit: boolean | null;
  /** 재진입선까지 남은 거리(%). 양수=재진입선이 위(더 올라야 함). */
  distanceToEntryPct: number | null;
}

/** 최신 데이터 기준 한 변형의 채널 상태 — 종목별_결과.md "청산선 위/아래·재진입선까지 거리" 용. */
export function latestChannelStatus(sec: SecurityData, rules: VariantRules): LatestChannelStatus {
  const i = sec.ownDates.length - 1;
  const close = sec.ownClose[i];
  const hiArr = sec.highChannel[rules.entryLookback];
  const loArr = sec.lowChannel[rules.exitLookback];
  const exitLow = loArr ? loArr[i] : null;
  const entryHigh = hiArr ? hiArr[i] : null;
  return {
    ticker: sec.ticker,
    asOfDate: sec.ownDates[i],
    latestClose: isNum(close) ? close : NaN,
    exitLow: isNum(exitLow) ? exitLow : null,
    entryHigh: isNum(entryHigh) ? entryHigh : null,
    belowExit: isNum(close) && isNum(exitLow) ? close <= exitLow : null,
    distanceToEntryPct: isNum(close) && isNum(entryHigh) && close > 0 ? ((entryHigh - close) / close) * 100 : null,
  };
}
