// scripts/backtest/core6SignalRotationV3/portfolio/simulate.ts
// 코어 6종 신호 로테이션 V3 — 포트폴리오 시뮬레이터. 순수 함수(파일·네트워크·시계·난수 없음).
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §2·§3·§5·§11(구현 명확화)·§12·§16,
//           V2 §9·§10·§11·§12, V1 §7(C절)·§7.1·§9.
//
// ── 입력 ────────────────────────────────────────────────────────────────────
//   Panel(정렬된 총수익 조정 OHLC) + 미리 계산된 SignalSeries(비중과 무관) + SimConfig.
//   신호는 i일 종가 확정 상태이고, 이 모듈이 i+1 세션 시가 이후의 체결 시점을 책임진다.
//
// ── 결정 사항(사양이 모호했던 곳 — 보고서에도 같은 내용) ─────────────────────
//  1. 비용: 모든 체결금액(amount=수량×시가)에 편도 c 를 **별도 비용으로 현금에서 차감**한다.
//     매수 지불액 = amount×(1+c), 매도 수취액 = amount×(1−c). 체결가는 시가 그대로(클램프 없음).
//     "희망 매수액"은 항상 비용 제외 amount 기준이고, 필요현금 = amount×(1+c).
//  2. 최초 매수: startIndex 시가에 w_i×initialCapital 을 희망액으로 두고 공통 λ 를 적용한다 →
//     비용이 있으면 λ=1/(1+c) 가 되어 현금이 0 으로 끝난다(총 지출=초기자본).
//  3. 재진입 희망액(ROTATE/ROTATE_PYRAMID): min(w_i, cap_i)×V_t − 현재보유평가(결정일 종가 기준 V_t).
//     희망액(예산)은 결정일에 고정하고 체결 때 바꾸지 않는다. 체결 때는 시가 평가액 기준 상한 여유로만 자른다.
//  4. 재진입 자금조달: 가용현금 F = 현금 − 이미 예약된 미체결 매수 필요현금. F 가 충분하면 i+1 시가 즉시 매수,
//     부족하면 부족분 S 를 총액 S/(1−c) 만큼 **다른 active·보유 자산을 목표비중 비례 water-filling(보유평가 한도)**
//     으로 i+1 시가에 축소 매도하고 재진입 매수는 i+2 시가에 체결한다. 같은 날 재진입/불타기가 여러 건이면 묶음 단위
//     (한 건이라도 축소가 필요하면 묶음 전체가 i+2). 축소 대상에서 제외: 같은 날 매수 대상 자산, OUT, 매도 예약 자산.
//     축소 주문이 거래 불가 세션이면 건너뛰고(대기하지 않음) 매수는 공통 λ 로 줄어든다.
//  5. 로테이션: 신호 매도의 실제 순대금 P 는 다음 세션(s+1) 시가에 분배한다. 분배액=min(P, 현금−예약현금).
//     수혜 자산 = 그 시점 상태 IN · 매도예약 없음 · 미체결 매수 없음 · 불타기 캠페인 진행 중 아님 · 거래 가능 ·
//     시가 평가 상한 여유>0 인 자산. 분배는 목표비중 비례 water-filling(여유=cap×V_open−보유평가), 초과분은 현금.
//     수혜 자산이 상태상 있으나 전부 거래 불가면 다음 세션으로 대기, 없으면 현금(P 소멸).
//  6. 주문 순서(같은 시가): ①취소(결정 시점에 이미 반영) ②매도(신호 매도·축소) ③현금 확정 ④재진입+분배+최초매수
//     (공통 λ) ⑤불타기(남은 현금에 λ) ⑥상한 여유·최소주문(1만원 미만 생략) 재검사 후 체결, 잔액은 현금.
//     최소주문 생략은 매수·축소에만 적용하고 신호 전량매도에는 적용하지 않는다(찌꺼기 방지).
//  7. 불타기(D): 재진입 캠페인에만. 유닛=희망액(재진입 희망액 확정 시점 고정)의 8/15,4/15,2/15,1/15.
//     단계 문턱은 마지막 **실제 체결가**(시가) 기준: '0.5N'=+0.5×ATR20, '4N'=+4×ATR20, '10pct'=×1.10, ATR20 은
//     평가일(D) 종가 확정 값. 종가≥문턱이면 다음 세션 시가에 예약(하루 한 단계, 신규 평가는 직전 단계 체결 후).
//     추가매수 자금도 재진입과 같은 방식(현금 우선, 부족분 비례 축소, 우선순위는 재진입 다음)으로 마련한다.
//     줄거나 못 산 유닛은 보충하지 않고 단계만 소진한다(마지막 체결가 불변). 매도 신호가 나면 남은 전량 매도 +
//     미체결 추가매수 취소. 캠페인이 진행 중인 자산은 다른 자산의 로테이션 분배를 받지 않는다.
//  8. 현금이자: 직전 세션 → 현재 세션 사이 달력일수 d 에 대해 현금(및 CASH 모드 칸 현금)에
//     (1 + annualCashRate[직전 세션]/365)^d 를 곱한다(현재 세션 시가 거래 직전에 적립). 신호 매도 대금도
//     체결 후부터 현금이므로 이자를 받는다. 예약·미체결 주문은 이자에 영향을 주지 않는다.
//  9. CASH(B): 칸 독립. 자산별 칸 현금(slotCash)에 그 자산 매도 순대금을 쌓고, 재진입 신호 때 **그 칸 현금 전부**
//     (비용 제외 금액 = slotCash/(1+c))로 같은 자산을 다시 산다. 다른 칸 현금·다른 자산 축소·상한은 쓰지 않는다
//     → 결과가 비중의 선형 결합이다(§19). BH 와 신호가 없으면 동일.
// 10. 신호 상태: 시뮬레이터는 최초 상태를 모두 IN 으로 두고 startIndex 이후의 sellEvent/reentryEvent 만 따른다
//     (워밍업 상태를 소급하지 않음). valid=false 인 날의 이벤트는 무시.
// 11. 거래 가능 세션 = 시가가 유한한 양수 + source≠'absent' + fresh=true. 불가하면 다음 가능 세션까지 대기한다
//     (신호 매도, 재진입·불타기 매수, 최초 매수). 평가는 마지막 유효 종가를 이월한다.
// 12. 회계 보정: 입력 배열 순서와 무관하도록 모든 순회는 종목코드 오름차순.

import type { AssetCode, Panel, SignalSeries } from '../types';
import { ASSET_CODES } from '../types';
import { solveLambda, waterFill } from './alloc';

export type TradeReason = 'initial' | 'signal_sell' | 'reentry' | 'trim' | 'rotation_buy' | 'pyramid';

export interface SimConfig {
  mode: 'BH' | 'CASH' | 'ROTATE' | 'ROTATE_PYRAMID';
  weights: Record<AssetCode, number>;
  capMultiplier: number;
  capAbsolute: number;
  costOneWay: number;
  initialCapital: number;
  minOrderKRW: number;
  startIndex: number;
  endIndex: number;
  annualCashRate: number[];
  pyramid?: { interval: '0.5N' | '4N' | '10pct' };
}

export interface Trade {
  /** 체결 세션 인덱스(Panel.dates 기준). */
  index: number;
  date: string;
  code: AssetCode;
  side: 'BUY' | 'SELL';
  /** 연속(소수) 수량. */
  qty: number;
  /** 체결가 = 그 세션 시가(조정 단위). */
  price: number;
  /** 체결금액 = qty×price (비용 제외). */
  amount: number;
  /** 편도 비용(원) = amount×costOneWay. 현금에서 별도 차감/차감 후 수취. */
  cost: number;
  reason: TradeReason;
}

export interface Campaign {
  code: AssetCode;
  /** 매도 신호가 확정된 세션(종가). */
  sellSignalIndex: number;
  /** 매도가 체결된 세션(없으면 아직 미체결). */
  sellIndex: number | null;
  /** 재진입 신호 세션. */
  reentrySignalIndex: number | null;
  /** 재진입 첫 매수가 실제로 체결된 세션. */
  reentryIndex: number | null;
  /** 재진입 매수가 체결되면 true(미재진입 캠페인은 false). */
  completed: boolean;
  /** 재진입 이후 실제 체결된 불타기 추가매수 횟수. */
  pyramidFills: number;
}

export interface SimResult {
  dates: string[];
  equity: number[];
  cashWeight: number[];
  trades: Trade[];
  campaigns: Campaign[];
  contributions: Record<AssetCode, number>;
  turnover: number;
  sellEventCount: number;
  reentryEventCount: number;
  assetsWithSells: AssetCode[];
  invariantViolations: string[];
  /** 현금이자 누계(원). 자산별 기여 합 + cashInterest = 최종 평가액 − 초기자본. */
  cashInterest: number;
  /** 위반은 아니지만 알아야 할 사항(예: startIndex 시점에 신호가 이미 inactive 인 자산). */
  warnings: string[];
}

type IntentKind = 'initial' | 'reentry' | 'cash_reentry' | 'pyramid';
type DesireKind = IntentKind | 'rotation';

interface PyramidState {
  units: number[];
  /** 소진된 단계 수(재진입 1단계 처리 후 1). */
  stage: number;
  lastFill: number | null;
  pending: boolean;
  active: boolean;
  campaign: Campaign | null;
}

interface AssetRt {
  code: AssetCode;
  w: number;
  cap: number;
  qty: number;
  /** 이 자산 매매 현금흐름 누계(매수 −(금액+비용), 매도 +(금액−비용)). */
  flow: number;
  lastClose: number | null;
  state: 'IN' | 'OUT';
  sellPending: boolean;
  campaign: Campaign | null;
  pyr: PyramidState | null;
  /** CASH 모드 전용 칸 현금. */
  slotCash: number;
}

interface Intent {
  code: AssetCode;
  kind: IntentKind;
  dueIndex: number;
  /** 비용 제외 희망 매수금액(결정 시점에 고정). cash_reentry 는 체결 때 칸 현금으로 정한다. */
  notional: number;
  /** 예약 현금 = notional×(1+c). */
  needCash: number;
}

interface Pool {
  dueIndex: number;
  net: number;
}

interface TrimOrder {
  code: AssetCode;
  dueIndex: number;
  notional: number;
}

interface Desire {
  code: AssetCode;
  kind: DesireKind;
  notional: number;
  intent: Intent | null;
}

const PYRAMID_UNIT_NUMERATORS = [8, 4, 2, 1];
const PYRAMID_UNIT_DENOMINATOR = 15;
const MAX_VIOLATIONS = 50;

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function dayNumber(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000;
}

export function simulate(
  panel: Panel,
  signals: Partial<Record<AssetCode, SignalSeries>>,
  config: SimConfig,
): SimResult {
  const { mode } = config;
  const c = config.costOneWay;
  const minOrder = config.minOrderKRW;
  const pyramidMode = mode === 'ROTATE_PYRAMID';
  const rotateMode = mode === 'ROTATE' || mode === 'ROTATE_PYRAMID';
  const startIndex = config.startIndex;
  const endIndex = config.endIndex;

  if (!(endIndex >= startIndex) || endIndex >= panel.dates.length || startIndex < 0) {
    throw new Error(`simulate: invalid index range ${startIndex}..${endIndex} (sessions=${panel.dates.length})`);
  }
  if (config.annualCashRate.length < endIndex) {
    throw new Error('simulate: annualCashRate shorter than endIndex');
  }
  if (pyramidMode && !config.pyramid) throw new Error('simulate: ROTATE_PYRAMID requires config.pyramid');

  // 모든 순회는 종목코드 오름차순(입력 객체의 키 순서에 의존하지 않는다).
  const codes: AssetCode[] = ASSET_CODES.filter(code => (config.weights[code] ?? 0) > 0)
    .slice()
    .sort();
  if (codes.length === 0) throw new Error('simulate: no asset with positive weight');
  if (mode !== 'BH') {
    for (const code of codes) {
      if (!signals[code]) throw new Error(`simulate: missing signal series for ${code}`);
    }
  }

  const violations: string[] = [];
  const warnings: string[] = [];
  const violate = (msg: string): void => {
    if (violations.length < MAX_VIOLATIONS) violations.push(msg);
  };

  const rt = new Map<AssetCode, AssetRt>();
  for (const code of codes) {
    const w = config.weights[code];
    rt.set(code, {
      code,
      w,
      cap: Math.min(config.capMultiplier * w, config.capAbsolute),
      qty: 0,
      flow: 0,
      lastClose: null,
      state: 'IN',
      sellPending: false,
      campaign: null,
      pyr: null,
      slotCash: 0,
    });
  }
  const A = (code: AssetCode): AssetRt => {
    const a = rt.get(code);
    if (!a) throw new Error(`simulate: unknown asset ${code}`);
    return a;
  };

  if (mode !== 'BH') {
    for (const code of codes) {
      const sig = signals[code];
      if (sig && sig.valid[startIndex] && !sig.active[startIndex] && !sig.sellEvent[startIndex]) {
        warnings.push(`${code}: signal inactive at startIndex — simulator starts IN and follows later events only`);
      }
    }
  }

  let cash = config.initialCapital;
  let interestTotal = 0;
  let tradeAmountSum = 0;
  let sellEventCount = 0;
  let reentryEventCount = 0;
  const assetsWithSellsSet = new Set<AssetCode>();
  const trades: Trade[] = [];
  const campaigns: Campaign[] = [];
  let intents: Intent[] = [];
  let pools: Pool[] = [];
  let trimOrders: TrimOrder[] = [];

  const equityOut: number[] = [];
  const cashWeightOut: number[] = [];
  const datesOut: string[] = [];

  // ── 가격 접근 ─────────────────────────────────────────────────────────────
  const tradable = (code: AssetCode, s: number): boolean => {
    const b = panel.assets[code];
    const o = b.open[s];
    return isNum(o) && o > 0 && b.source[s] !== 'absent' && b.fresh[s] === true;
  };
  const openPx = (code: AssetCode, s: number): number => panel.assets[code].open[s] as number;
  const markPx = (a: AssetRt): number => a.lastClose ?? 0;

  const holdingsValueAtMark = (): number => {
    let v = 0;
    for (const code of codes) {
      const a = A(code);
      v += a.qty * markPx(a);
    }
    return v;
  };

  // ── 체결 ─────────────────────────────────────────────────────────────────
  const execBuy = (a: AssetRt, s: number, notional: number, reason: TradeReason): void => {
    const price = openPx(a.code, s);
    const qty = notional / price;
    const cost = notional * c;
    cash -= notional + cost;
    a.qty += qty;
    a.flow -= notional + cost;
    tradeAmountSum += notional;
    trades.push({ index: s, date: panel.dates[s], code: a.code, side: 'BUY', qty, price, amount: notional, cost, reason });
    if (cash < -1) violate(`cash<-1 after BUY ${a.code}@${s}: ${cash}`);
  };

  const execSell = (a: AssetRt, s: number, qtyWanted: number, reason: TradeReason): Trade | null => {
    const price = openPx(a.code, s);
    let qty = qtyWanted;
    if (qty > a.qty + 1e-9) {
      violate(`sell qty>holding ${a.code}@${s}: ${qty}>${a.qty}`);
      qty = a.qty;
    }
    qty = Math.min(qty, a.qty);
    if (!(qty > 0)) return null;
    const amount = qty * price;
    const cost = amount * c;
    cash += amount - cost;
    a.qty = qty === a.qty ? 0 : a.qty - qty;
    a.flow += amount - cost;
    tradeAmountSum += amount;
    const trade: Trade = { index: s, date: panel.dates[s], code: a.code, side: 'SELL', qty, price, amount, cost, reason };
    trades.push(trade);
    return trade;
  };

  // ── 체결 결과 반영 ───────────────────────────────────────────────────────
  const settleReentry = (a: AssetRt, s: number, filled: number, price: number): void => {
    const camp = a.campaign;
    if (camp) {
      if (filled > 0) {
        camp.reentryIndex = s;
        camp.completed = true;
      }
      a.campaign = null;
    }
    if (a.pyr) {
      a.pyr.pending = false;
      a.pyr.stage = 1;
      if (filled > 0) a.pyr.lastFill = price;
      else a.pyr.active = false;
    }
  };

  const settlePyramid = (a: AssetRt, filled: number, price: number): void => {
    const p = a.pyr;
    if (!p) return;
    p.pending = false;
    p.stage += 1;
    if (filled > 0) {
      p.lastFill = price;
      if (p.campaign) p.campaign.pyramidFills += 1;
    }
    if (p.stage >= PYRAMID_UNIT_NUMERATORS.length) p.active = false;
  };

  // ── 같은 우선순위 매수 묶음 실행(⑥ 공통 λ → ⑦ 상한·최소주문) ─────────────
  const runDesires = (desires: Desire[], s: number, equityOpen: number): void => {
    if (desires.length === 0) return;
    const fullNeed = desires.reduce((sum, d) => sum + d.notional * (1 + c), 0);
    const lambda = solveLambda(fullNeed, cash);
    for (const d of desires) {
      const a = A(d.code);
      const price = openPx(a.code, s);
      let n = d.notional * lambda;
      const capClipped = mode !== 'CASH' && (d.kind === 'reentry' || d.kind === 'rotation' || d.kind === 'pyramid');
      const holdBefore = a.qty * price;
      if (capClipped) {
        n = Math.min(n, Math.max(0, a.cap * equityOpen - holdBefore));
      }
      if (!(n >= minOrder)) n = 0;
      if (n > 0) {
        const reason: TradeReason =
          d.kind === 'initial' ? 'initial'
            : d.kind === 'rotation' ? 'rotation_buy'
              : d.kind === 'pyramid' ? 'pyramid' : 'reentry';
        execBuy(a, s, n, reason);
        if (capClipped) {
          const holdAfter = a.qty * price;
          if (holdAfter > Math.max(holdBefore, a.cap * equityOpen) + 1) {
            violate(`cap exceeded by buy ${a.code}@${s}: hold ${holdAfter} cap ${a.cap * equityOpen}`);
          }
        }
        if (d.kind === 'cash_reentry') a.slotCash = Math.max(0, a.slotCash - n * (1 + c));
      }
      if (d.intent) intents = intents.filter(i => i !== d.intent);
      if (d.kind === 'reentry' || d.kind === 'cash_reentry') settleReentry(a, s, n, price);
      else if (d.kind === 'pyramid') settlePyramid(a, n, price);
    }
  };

  // ── 세션 시가 처리 ───────────────────────────────────────────────────────
  const executeOpen = (s: number): void => {
    const canTrade = new Map<AssetCode, boolean>();
    for (const code of codes) canTrade.set(code, tradable(code, s));
    const can = (code: AssetCode): boolean => canTrade.get(code) === true;

    // ② 매도: 신호 전량매도 → 축소매도
    for (const code of codes) {
      const a = A(code);
      if (!a.sellPending || !can(code)) continue;
      const trade = a.qty > 0 ? execSell(a, s, a.qty, 'signal_sell') : null;
      if (trade) {
        const net = trade.amount - trade.cost;
        if (mode === 'CASH') a.slotCash += net;
        else if (rotateMode) pools.push({ dueIndex: s + 1, net });
      }
      a.sellPending = false;
      if (a.campaign) a.campaign.sellIndex = s;
    }
    const dueTrims = trimOrders.filter(o => o.dueIndex <= s);
    trimOrders = trimOrders.filter(o => o.dueIndex > s);
    for (const o of dueTrims) {
      const a = A(o.code);
      if (!can(o.code) || a.state !== 'IN' || a.sellPending || a.qty <= 0) continue;
      execSell(a, s, Math.min(a.qty, o.notional / openPx(o.code, s)), 'trim');
    }

    // ③ 현금 확정 후 시가 평가
    let equityOpen = cash;
    for (const code of codes) {
      const a = A(code);
      equityOpen += a.qty * (can(code) ? openPx(code, s) : markPx(a));
    }
    const valueNow = (a: AssetRt): number => a.qty * (can(a.code) ? openPx(a.code, s) : markPx(a));

    // ④ 재진입 / 최초 매수 / 로테이션 분배 (같은 우선순위, 공통 λ)
    const dueIntents = intents.filter(i => i.dueIndex <= s && can(i.code));
    const desiresA: Desire[] = [];
    const desiresB: Desire[] = [];
    for (const i of dueIntents) {
      if (i.kind === 'pyramid') {
        desiresB.push({ code: i.code, kind: 'pyramid', notional: i.notional, intent: i });
      } else if (i.kind === 'cash_reentry') {
        desiresA.push({ code: i.code, kind: 'cash_reentry', notional: A(i.code).slotCash / (1 + c), intent: i });
      } else {
        desiresA.push({ code: i.code, kind: i.kind, notional: i.notional, intent: i });
      }
    }

    const duePools = pools.filter(p => p.dueIndex <= s);
    if (duePools.length > 0 && rotateMode) {
      const pooled = duePools.reduce((sum, p) => sum + p.net, 0);
      const reserved = intents.reduce((sum, i) => sum + i.needCash, 0);
      const amount = Math.min(pooled, Math.max(0, cash - reserved));
      const stateEligible: AssetRt[] = [];
      for (const code of codes) {
        const a = A(code);
        if (a.state !== 'IN' || a.sellPending) continue;
        if (intents.some(i => i.code === code)) continue;
        if (a.pyr && a.pyr.active) continue;
        if (a.cap * equityOpen - valueNow(a) <= 0) continue;
        stateEligible.push(a);
      }
      const recipients = stateEligible.filter(a => can(a.code));
      if (amount > 0 && recipients.length > 0) {
        const alloc = waterFill(
          amount / (1 + c),
          recipients.map(a => ({ weight: a.w, cap: a.cap * equityOpen - valueNow(a) })),
        );
        recipients.forEach((a, k) => {
          if (alloc[k] > 0) desiresA.push({ code: a.code, kind: 'rotation', notional: alloc[k], intent: null });
        });
        pools = pools.filter(p => p.dueIndex > s);
      } else if (amount > 0 && stateEligible.length > 0) {
        // 수혜 자산은 있으나 지금은 전부 거래 불가 → 다음 세션까지 대기
      } else {
        pools = pools.filter(p => p.dueIndex > s);
      }
    } else if (duePools.length > 0) {
      pools = pools.filter(p => p.dueIndex > s);
    }

    desiresA.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
    runDesires(desiresA, s, equityOpen);

    // ⑤ 불타기(남은 현금에 대해 별도 λ)
    desiresB.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
    runDesires(desiresB, s, equityOpen);
  };

  // ── 종가 처리 ────────────────────────────────────────────────────────────
  const updateClose = (s: number): void => {
    for (const code of codes) {
      const a = A(code);
      const b = panel.assets[code];
      const cl = b.close[s];
      if (isNum(cl) && cl > 0 && b.source[s] !== 'absent') a.lastClose = cl;
    }
  };

  // ── 결정(종가 후): 다음 세션 이후의 주문 예약 ────────────────────────────
  const decide = (t: number): void => {
    const reentries: AssetRt[] = [];
    const pyramids: { a: AssetRt; unit: number }[] = [];

    for (const code of codes) {
      const a = A(code);
      const sig = signals[code];
      if (!sig || !sig.valid[t]) continue;
      if (a.state === 'IN' && sig.sellEvent[t]) {
        sellEventCount += 1;
        assetsWithSellsSet.add(code);
        intents = intents.filter(i => i.code !== code); // ① 미체결 매수 취소(체결 전이므로 시가 처리 순서와 동일)
        a.pyr = null;
        a.state = 'OUT';
        a.sellPending = true;
        const camp: Campaign = {
          code, sellSignalIndex: t, sellIndex: null, reentrySignalIndex: null,
          reentryIndex: null, completed: false, pyramidFills: 0,
        };
        campaigns.push(camp);
        a.campaign = camp;
      } else if (a.state === 'OUT' && sig.reentryEvent[t]) {
        reentryEventCount += 1;
        a.state = 'IN';
        if (a.sellPending) {
          // 매도가 아직 체결 전(거래 불가로 대기) — 매도를 취소하고 계속 보유한 것으로 본다.
          a.sellPending = false;
          if (a.campaign) {
            const idx = campaigns.indexOf(a.campaign);
            if (idx >= 0) campaigns.splice(idx, 1);
            a.campaign = null;
          }
          continue;
        }
        if (a.campaign) a.campaign.reentrySignalIndex = t;
        if (mode === 'CASH') {
          intents.push({ code, kind: 'cash_reentry', dueIndex: t + 1, notional: 0, needCash: 0 });
        } else if (rotateMode) {
          reentries.push(a);
        }
      } else if (
        pyramidMode && a.state === 'IN' && a.pyr && a.pyr.active && !a.pyr.pending &&
        a.pyr.stage < PYRAMID_UNIT_NUMERATORS.length && a.pyr.lastFill !== null &&
        panel.assets[code].fresh[t] === true
      ) {
        const close = panel.assets[code].close[t];
        if (!isNum(close)) continue;
        const interval = config.pyramid?.interval ?? '10pct';
        let threshold: number;
        if (interval === '10pct') {
          threshold = a.pyr.lastFill * 1.1;
        } else {
          const atr = sig.atr20[t];
          if (!isNum(atr)) continue;
          threshold = a.pyr.lastFill + (interval === '0.5N' ? 0.5 : 4) * atr;
        }
        if (close >= threshold) pyramids.push({ a, unit: a.pyr.units[a.pyr.stage] });
      }
    }

    if (reentries.length === 0 && pyramids.length === 0) return;

    // 희망액 확정(결정일 종가 기준)
    let marketValue = cash;
    for (const code of codes) {
      const a = A(code);
      marketValue += a.qty * markPx(a);
    }
    const planned: Intent[] = [];
    for (const a of reentries) {
      const desired = Math.max(0, Math.min(a.w, a.cap) * marketValue - a.qty * markPx(a));
      let notional = desired;
      if (pyramidMode) {
        const units = PYRAMID_UNIT_NUMERATORS.map(k => (desired * k) / PYRAMID_UNIT_DENOMINATOR);
        notional = units[0];
        a.pyr = { units, stage: 0, lastFill: null, pending: true, active: true, campaign: a.campaign };
      }
      if (!(notional > 0)) {
        a.pyr = null;
        a.campaign = null;
        continue;
      }
      planned.push({ code: a.code, kind: 'reentry', dueIndex: t + 1, notional, needCash: notional * (1 + c) });
    }
    for (const p of pyramids) {
      if (!(p.unit > 0)) continue;
      planned.push({ code: p.a.code, kind: 'pyramid', dueIndex: t + 1, notional: p.unit, needCash: p.unit * (1 + c) });
    }
    if (planned.length === 0) return;

    // 자금조달: 현금 우선 → 부족분은 다른 active 자산 목표비중 비례 축소(i+1 매도, 매수는 i+2)
    const reserved = intents.reduce((sum, i) => sum + i.needCash, 0);
    const free = Math.max(0, cash - reserved);
    const totalNeed = planned.reduce((sum, i) => sum + i.needCash, 0);
    let dueAll = t + 1;
    const newTrims: TrimOrder[] = [];
    if (totalNeed > free + 1e-9) {
      const shortfall = totalNeed - free;
      const targets = new Set<AssetCode>(planned.map(i => i.code));
      const cands: AssetRt[] = [];
      for (const code of codes) {
        const a = A(code);
        if (targets.has(code) || a.state !== 'IN' || a.sellPending || !(a.qty > 0)) continue;
        cands.push(a);
      }
      const gross = shortfall / (1 - c);
      const alloc = waterFill(gross, cands.map(a => ({ weight: a.w, cap: a.qty * markPx(a) })));
      cands.forEach((a, k) => {
        if (alloc[k] >= minOrder) newTrims.push({ code: a.code, dueIndex: t + 1, notional: alloc[k] });
      });
      if (newTrims.length > 0) dueAll = t + 2;
    }
    if (dueAll > endIndex) {
      // 구간 종료 뒤 체결될 주문은 취소한다(축소만 하고 재투자하지 않는 일 방지).
      for (const i of planned) {
        const a = A(i.code);
        if (i.kind === 'pyramid') continue;
        a.pyr = null;
        a.campaign = null;
      }
      return;
    }
    for (const i of planned) {
      i.dueIndex = dueAll;
      intents.push(i);
      if (i.kind === 'pyramid') {
        const a = A(i.code);
        if (a.pyr) a.pyr.pending = true;
      }
    }
    trimOrders.push(...newTrims);
  };

  // ── 불변식(종가마다) ─────────────────────────────────────────────────────
  const checkClose = (s: number, equity: number): void => {
    if (cash < -1) violate(`cash<-1 at ${s}: ${cash}`);
    let flowSum = 0;
    let holdSum = 0;
    let slotSum = 0;
    for (const code of codes) {
      const a = A(code);
      flowSum += a.flow;
      holdSum += a.qty * markPx(a);
      slotSum += a.slotCash;
      if (a.qty < -1e-9) violate(`negative qty ${code}@${s}`);
    }
    const expectedCash = config.initialCapital + flowSum + interestTotal;
    if (Math.abs(cash - expectedCash) > 0.01) violate(`cash ledger mismatch @${s}: ${cash} vs ${expectedCash}`);
    if (Math.abs(equity - (cash + holdSum)) > 0.01) violate(`equity != cash+holdings @${s}`);
    if (slotSum > cash + 1) violate(`slot cash exceeds cash @${s}`);
  };

  // ── 메인 루프 ────────────────────────────────────────────────────────────
  for (const code of codes) {
    const a = A(code);
    const notional = a.w * config.initialCapital;
    intents.push({ code, kind: 'initial', dueIndex: startIndex, notional, needCash: notional * (1 + c) });
  }

  for (let s = startIndex; s <= endIndex; s++) {
    if (s > startIndex) {
      const days = dayNumber(panel.dates[s]) - dayNumber(panel.dates[s - 1]);
      const factor = Math.pow(1 + config.annualCashRate[s - 1] / 365, days);
      const before = cash;
      cash *= factor;
      interestTotal += cash - before;
      for (const code of codes) {
        const a = A(code);
        a.slotCash *= factor;
      }
    }
    executeOpen(s);
    updateClose(s);
    const holdings = holdingsValueAtMark();
    const equity = cash + holdings;
    datesOut.push(panel.dates[s]);
    equityOut.push(equity);
    cashWeightOut.push(equity > 0 ? cash / equity : 0);
    checkClose(s, equity);
    if (mode !== 'BH' && s < endIndex) decide(s);
  }

  // ── 결과 정리 ────────────────────────────────────────────────────────────
  for (const t of trades) {
    const expected = panel.assets[t.code].open[t.index];
    if (t.price !== expected) violate(`trade price != open ${t.code}@${t.index}`);
  }
  const contributions = {} as Record<AssetCode, number>;
  for (const code of ASSET_CODES) {
    const a = rt.get(code);
    contributions[code] = a ? a.flow + a.qty * markPx(a) : 0;
  }
  const meanEquity = equityOut.reduce((sum, v) => sum + v, 0) / equityOut.length;
  const lastEquity = equityOut[equityOut.length - 1];
  const contribSum = ASSET_CODES.reduce((sum, code) => sum + contributions[code], 0);
  if (Math.abs(contribSum + interestTotal - (lastEquity - config.initialCapital)) > 0.01) {
    violate('contributions + interest != final equity - initial capital');
  }

  return {
    dates: datesOut,
    equity: equityOut,
    cashWeight: cashWeightOut,
    trades,
    campaigns,
    contributions,
    turnover: meanEquity > 0 ? tradeAmountSum / meanEquity : 0,
    sellEventCount,
    reentryEventCount,
    assetsWithSells: Array.from(assetsWithSellsSet).sort(),
    invariantViolations: violations,
    cashInterest: interestTotal,
    warnings,
  };
}
