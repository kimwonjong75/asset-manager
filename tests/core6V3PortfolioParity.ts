// tests/core6V3PortfolioParity.ts
// 코어 6종 신호 로테이션 V3 — 포트폴리오 시뮬레이터(portfolio/simulate.ts) 골든 테스트.
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §11·§12·§16.
// 오프라인. 손계산 가능한 소형 픽스처(가격은 시가/종가를 직접 지정)와 **고정 절대값** 골든만 쓴다 —
// 기대값은 시뮬레이터 호출이 아니라 아래 주석의 손계산에서 나온 숫자다.

import { strict as assert } from 'assert';
import { simulate } from '../scripts/backtest/core6SignalRotationV3/portfolio/simulate';
import type { SimConfig, SimResult, Trade } from '../scripts/backtest/core6SignalRotationV3/portfolio/simulate';
import { solveLambda, waterFill } from '../scripts/backtest/core6SignalRotationV3/portfolio/alloc';
import { ASSET_CODES } from '../scripts/backtest/core6SignalRotationV3/types';
import type { AssetBars, AssetCode, Panel, SignalSeries } from '../scripts/backtest/core6SignalRotationV3/types';

const A: AssetCode = '069500';
const B: AssetCode = '379800';
const C: AssetCode = '283580';
const D: AssetCode = '385560';

let checks = 0;
function near(actual: number, expected: number, label: string, tol = 1e-6): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  checks += 1;
  assert.deepStrictEqual(actual, expected, label);
}

// ── 픽스처 ────────────────────────────────────────────────────────────────
function makeDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(2026, 0, 5)); // 월요일
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

interface Spec {
  open: (number | null)[];
  close: (number | null)[];
  fresh?: boolean[];
}

function bars(code: AssetCode, n: number, spec: Spec | undefined): AssetBars {
  if (!spec) {
    return {
      code, open: Array(n).fill(null), high: Array(n).fill(null), low: Array(n).fill(null),
      close: Array(n).fill(null), fresh: Array(n).fill(false), source: Array(n).fill('absent'),
    };
  }
  const hi = spec.open.map((o, i) => (o === null || spec.close[i] === null ? null : Math.max(o, spec.close[i] as number)));
  const lo = spec.open.map((o, i) => (o === null || spec.close[i] === null ? null : Math.min(o, spec.close[i] as number)));
  return {
    code, open: spec.open, high: hi, low: lo, close: spec.close,
    fresh: spec.fresh ?? Array(n).fill(true),
    source: Array(n).fill('actual'),
  };
}

function makePanel(n: number, specs: Partial<Record<AssetCode, Spec>>, keyOrder: readonly AssetCode[] = ASSET_CODES): Panel {
  const assets = {} as Record<AssetCode, AssetBars>;
  for (const code of keyOrder) assets[code] = bars(code, n, specs[code]);
  return { dates: makeDates(n), assets };
}

interface SigSpec { sell?: number[]; reentry?: number[]; atr?: number }
function makeSignal(code: AssetCode, n: number, spec: SigSpec = {}): SignalSeries {
  const sell = Array(n).fill(false) as boolean[];
  const reentry = Array(n).fill(false) as boolean[];
  for (const i of spec.sell ?? []) sell[i] = true;
  for (const i of spec.reentry ?? []) reentry[i] = true;
  const active: boolean[] = [];
  let state = true;
  for (let i = 0; i < n; i++) {
    if (sell[i]) state = false;
    if (reentry[i]) state = true;
    active.push(state);
  }
  return {
    rule: 'D20/55', code, valid: Array(n).fill(true), active, sellEvent: sell, reentryEvent: reentry,
    atr20: Array(n).fill(spec.atr ?? 1),
  };
}

function weights(partial: Partial<Record<AssetCode, number>>, order: readonly AssetCode[] = ASSET_CODES): Record<AssetCode, number> {
  const w = {} as Record<AssetCode, number>;
  for (const code of order) w[code] = partial[code] ?? 0;
  return w;
}

function flat(n: number, v: number): number[] { return Array(n).fill(v); }

function config(mode: SimConfig['mode'], w: Record<AssetCode, number>, n: number, over: Partial<SimConfig> = {}): SimConfig {
  return {
    mode, weights: w, capMultiplier: 1.5, capAbsolute: 1, costOneWay: 0, initialCapital: 1_000_000,
    minOrderKRW: 10_000, startIndex: 0, endIndex: n - 1, annualCashRate: flat(n, 0), ...over,
  };
}

function clean(r: SimResult, label: string): void {
  eq(r.invariantViolations, [], `${label}: invariantViolations`);
}

function tradesOf(r: SimResult, code: AssetCode): Trade[] {
  return r.trades.filter(t => t.code === code);
}

function brief(t: Trade): string {
  return `${t.index}:${t.side}:${t.reason}:${Math.round(t.amount * 1000) / 1000}`;
}

console.log('core6 V3 portfolio simulator parity');

// ── 0. 배분 도우미 ──────────────────────────────────────────────────────────
{
  // 50%(상한 200) → 고정, 남은 800 을 3:2 → 480/320
  const a = waterFill(1000, [{ weight: 0.5, cap: 200 }, { weight: 0.3, cap: 1000 }, { weight: 0.2, cap: 1000 }]);
  near(a[0], 200, 'waterFill saturate first'); near(a[1], 480, 'waterFill second'); near(a[2], 320, 'waterFill third');
  // 전부 상한 → 합계가 total 보다 작고 초과분은 배분 안 됨
  const b = waterFill(1000, [{ weight: 1, cap: 100 }, { weight: 1, cap: 150 }]);
  near(b[0], 100, 'waterFill all capped 0'); near(b[1], 150, 'waterFill all capped 1');
  // 연쇄 고정: 1차에 첫 항목만, 재배분으로 둘째도 넘침
  const c2 = waterFill(900, [{ weight: 4, cap: 100 }, { weight: 3, cap: 300 }, { weight: 3, cap: 1000 }]);
  // 1라운드 몫 360/270/270 → 첫 항목 100 고정, 남은 800 을 3:3 → 400/400 → 둘째 300 고정, 남은 500 → 셋째 500
  near(c2[0], 100, 'waterFill chain 0'); near(c2[1], 300, 'waterFill chain 1'); near(c2[2], 500, 'waterFill chain 2');
  // 가중치 0·상한 0 항목은 제외
  const d2 = waterFill(100, [{ weight: 0, cap: 100 }, { weight: 1, cap: 0 }, { weight: 1, cap: 100 }]);
  eq(d2, [0, 0, 100], 'waterFill ignores zero weight/cap');
  near(solveLambda(900, 850), 850 / 900, 'lambda <1');
  near(solveLambda(800, 850), 1, 'lambda capped at 1');
  near(solveLambda(900, 0), 0, 'lambda zero cash');
}

// ── ① BH: 평가액·비용 ────────────────────────────────────────────────────────
// 자본 1,000,000, 비중 A .5/B .3/C .2, 편도 비용 0.1%. 최초 매수 희망액 w×자본 에 λ=1/1.001 →
//   A 금액 500000/1.001 = 499500.4995004996 (비용 499.5004995004996, 수량 4995.004995004996)
//   B 299700.29970029974, C 199800.19980019983 → 총지출=1,000,000 이므로 현금 0.
//   종가(마지막) A 110, B 55, C 24 → 평가 549450.5494505495 + 329670.3296703297 + 239760.2397602398 = 1118881.118881119
{
  const n = 6;
  const panel = makePanel(n, {
    [A]: { open: flat(n, 100), close: [100, 102, 104, 108, 110, 110] },
    [B]: { open: flat(n, 50), close: [50, 49, 48, 50, 52, 55] },
    [C]: { open: flat(n, 20), close: [20, 20, 21, 22, 22, 24] },
  });
  const sigs = { [A]: makeSignal(A, n, { sell: [1], reentry: [3] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const w = weights({ [A]: 0.5, [B]: 0.3, [C]: 0.2 });
  const r = simulate(panel, sigs, config('BH', w, n, { costOneWay: 0.001 }));
  clean(r, 'BH');
  eq(r.trades.length, 3, 'BH trades');
  eq(r.trades.map(t => t.index), [0, 0, 0], 'BH all at start open');
  eq(r.trades.map(t => t.reason), ['initial', 'initial', 'initial'], 'BH reason');
  eq(tradesOf(r, A)[0].side, 'BUY', 'BH side');
  near(tradesOf(r, A)[0].amount, 499500.4995004996, 'BH A amount');
  near(tradesOf(r, A)[0].cost, 499.5004995004996, 'BH A cost');
  near(tradesOf(r, A)[0].qty, 4995.004995004996, 'BH A qty');
  near(tradesOf(r, B)[0].amount, 299700.29970029974, 'BH B amount');
  near(tradesOf(r, C)[0].amount, 199800.19980019983, 'BH C amount');
  near(r.equity[0], 999000.9990009991, 'BH equity[0] = capital/1.001');
  near(r.equity[5], 1118881.118881119, 'BH equity end');
  near(r.cashWeight[0], 0, 'BH cash weight start');
  near(r.contributions[A], 49450.54945054947, 'BH contribution A');
  near(r.contributions[B], 29670.329670329636, 'BH contribution B');
  near(r.contributions[C], 39760.23976023978, 'BH contribution C');
  near(r.contributions['464470'], 0, 'BH contribution excluded asset');
  eq(r.sellEventCount, 0, 'BH ignores signals (sell)');
  eq(r.campaigns.length, 0, 'BH no campaigns');
  // 신호를 안 줘도 같은 결과
  const r2 = simulate(panel, {}, config('BH', w, n, { costOneWay: 0.001 }));
  eq(r2.equity, r.equity, 'BH without signals identical');
}

// ── ② CASH: 매도 → 현금 → 재진입 타이밍 ─────────────────────────────────────
// A .5/B .3/C .2, 자본 1,000,000, 비용 0. A 5000주(@100), B 6000주(@50), C 10000주(@20).
// A 매도신호 idx2 종가 → idx3 시가 90 에 5000주 전량(450000). 재진입신호 idx5 종가 → idx6 시가 95 에 보유현금으로만 재진입:
//   450000/95 = 4736.8421052631575주. idx9 종가 100 → 평가 473684.2105 + 300000 + 200000 = 973684.2105263157
const t2Panel = (n: number) => makePanel(n, {
  [A]: { open: [100, 100, 100, 90, 90, 90, 95, 100, 100, 100], close: [100, 100, 95, 90, 90, 92, 96, 100, 100, 100] },
  [B]: { open: flat(n, 50), close: flat(n, 50) },
  [C]: { open: flat(n, 20), close: flat(n, 20) },
});
{
  const n = 10;
  const panel = t2Panel(n);
  const sigs = { [A]: makeSignal(A, n, { sell: [2], reentry: [5] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const w = weights({ [A]: 0.5, [B]: 0.3, [C]: 0.2 });
  const r = simulate(panel, sigs, config('CASH', w, n));
  clean(r, 'CASH');
  const ta = tradesOf(r, A);
  eq(ta.map(t => `${t.index}:${t.side}:${t.reason}`), ['0:BUY:initial', '3:SELL:signal_sell', '6:BUY:reentry'], 'CASH A trade timeline (i+1 open)');
  near(ta[1].price, 90, 'CASH sell at idx3 open'); near(ta[1].amount, 450000, 'CASH sell amount');
  near(ta[2].price, 95, 'CASH reentry at idx6 open'); near(ta[2].qty, 4736.8421052631575, 'CASH reentry qty');
  eq(r.trades.length, 5, 'CASH only A trades after start');
  near(r.equity[2], 975000, 'CASH equity idx2'); near(r.equity[3], 950000, 'CASH equity idx3');
  near(r.equity[5], 950000, 'CASH equity idx5 (cash)'); near(r.equity[9], 973684.2105263157, 'CASH equity end');
  near(r.cashWeight[3], 450000 / 950000, 'CASH cash weight while out'); near(r.cashWeight[9], 0, 'CASH cash weight end');
  eq(r.campaigns, [{
    code: A, sellSignalIndex: 2, sellIndex: 3, reentrySignalIndex: 5, reentryIndex: 6, completed: true, pyramidFills: 0,
  }], 'CASH campaign');
  eq(r.sellEventCount, 1, 'CASH sell events'); eq(r.reentryEventCount, 1, 'CASH reentry events');
  eq(r.assetsWithSells, [A], 'CASH assetsWithSells');
  // 체결금액 합 1,000,000(최초) + 450,000(매도) + 450,000(재진입), 평균 평가액 = (1e6+1e6+975000+3×950000+(450000/95×96+500000)+3×(450000/95×100+500000))/10
  near(r.turnover, 1_900_000 / ((1e6 + 1e6 + 975000 + 3 * 950000 + (450000 / 95 * 96 + 500000) + 3 * (450000 / 95 * 100 + 500000)) / 10), 'CASH turnover');
  near(r.contributions[A], 450000 / 95 * 100 - 500000, 'CASH contribution A (= -26315.789...)');
  near(r.contributions[B], 0, 'CASH contribution B');

  // ⑪ 신호가 없고 비용 0 이면 CASH == BH (이자 포함)
  const none = { [A]: makeSignal(A, n), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const rates = flat(n, 0.03);
  for (const cost of [0, 0.001]) {
    const rc = simulate(panel, none, config('CASH', w, n, { costOneWay: cost, annualCashRate: rates }));
    const rb = simulate(panel, none, config('BH', w, n, { costOneWay: cost, annualCashRate: rates }));
    eq(rc.equity, rb.equity, `CASH == BH without signals (cost=${cost})`);
    eq(rc.trades.length, rb.trades.length, 'CASH == BH trades');
  }

  // 칸 독립성(§19): 다자산 CASH == 단일자산 CASH 의 선형결합 (비용·이자 포함)
  const sigs2 = {
    [A]: makeSignal(A, n, { sell: [2], reentry: [5] }),
    [B]: makeSignal(B, n),
    [C]: makeSignal(C, n),
  };
  const full = simulate(panel, sigs2, config('CASH', w, n, { costOneWay: 0.001, annualCashRate: flat(n, 0.04) }));
  const parts = [A, B, C].map(code => simulate(panel, sigs2, config('CASH', weights({ [code]: 1 }), n, {
    costOneWay: 0.001, annualCashRate: flat(n, 0.04), initialCapital: 1_000_000 * (w[code]),
  })));
  full.equity.forEach((v, i) => near(v, parts.reduce((sum, p) => sum + p.equity[i], 0), `CASH linear combination idx${i}`, 1e-6));
  clean(full, 'CASH linear');
}

// ── ⑨ 현금이자: ACT/365 일복리, 직전 세션 금리, 실제 현금에만 ────────────────
// 위 CASH 픽스처 + 금리 idx<=4 연 3.65%(일 0.0001), idx>=5 연 7.3%(일 0.0002).
// 매도 후 현금 450000 이 idx3 시가에 생김 → idx3→4 (1일, rate[3]) ×1.0001, idx4→5 (금요일→월요일 3일, rate[4]) ×1.0001^3,
// idx5→6 (1일, rate[5]) ×1.0002 → idx6 시가 직전 현금 450270.0630072003, 이 금액 전부로 95 에 재진입(수량 4739.684873760003)
// 종료 평가 4739.684873760003×100 + 500000 = 973968.4873760003
{
  const n = 10;
  const panel = t2Panel(n);
  const sigs = { [A]: makeSignal(A, n, { sell: [2], reentry: [5] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const w = weights({ [A]: 0.5, [B]: 0.3, [C]: 0.2 });
  const rates = Array.from({ length: n }, (_, i) => (i <= 4 ? 0.0365 : 0.073));
  const r = simulate(panel, sigs, config('CASH', w, n, { annualCashRate: rates }));
  clean(r, 'interest');
  const buy = tradesOf(r, A)[2];
  near(buy.amount, 450270.0630072003, 'interest: reentry funded by cash + interest', 1e-6);
  near(buy.qty, 4739.684873760003, 'interest: reentry qty', 1e-6);
  near(r.cashInterest, 270.0630072003114, 'interest total', 1e-5);
  near(r.equity[9], 973968.4873760003, 'interest: equity end', 1e-5);
  // 현금이 없는 동안(이자 대상 없음)에는 이자가 0: BH 풀투자에 높은 금리를 줘도 이자 0
  const rb = simulate(panel, sigs, config('BH', w, n, { annualCashRate: flat(n, 0.5) }));
  near(rb.cashInterest, 0, 'interest: fully invested earns nothing', 1e-6);
}

// ── ③④⑤ ROTATE: 로테이션·재진입 비례 축소 ───────────────────────────────────
// A .5/B .3/C .2, 상한 배수 1.5 → 상한 .75/.45/.30, 비용 0, 자본 1,000,000. n=11.
//   idx0 시가 100: A 5000주, B 3000주, C 2000주.
//   A 매도신호 idx2 → idx3 시가 100 에 5000주 전량 → 500000 현금(분배는 그 다음 세션 idx4).
//   idx4 시가: V=1,000,000. B 여유 .45e6−300000=150000, C 여유 .30e6−200000=100000. 목표비중 비례 몫 300000/200000 은 둘 다
//     상한 초과 → B 150000(1500주) C 100000(1000주)로 고정, 초과분 250000 은 현금.
//   A 재진입신호 idx6 종가: V=1,000,000, 희망액 min(.5,.75)×V=500000, 가용현금 250000, 부족 250000 →
//     B(보유 450000)·C(300000)를 비례 water-filling → B 150000, C 100000 을 idx7 시가에 축소매도(B 시가 120 → 1250주, C 100 → 1000주),
//     재진입 매수는 idx8 시가 125 에 500000/125 = 4000주.
//   종가: idx10 A 130, B 120, C 100 → 4000×130 + 3250×120 + 2000×100 = 1,110,000
const rotPanel = (n: number) => makePanel(n, {
  [A]: { open: [100, 100, 100, 100, 100, 100, 100, 110, 125, 125, 125], close: [100, 100, 98, 100, 100, 100, 100, 115, 125, 125, 130] },
  [B]: { open: [100, 100, 100, 100, 100, 100, 100, 120, 120, 120, 120], close: [100, 100, 100, 100, 100, 100, 100, 120, 120, 120, 120] },
  [C]: { open: flat(n, 100), close: flat(n, 100) },
});
const rotW = () => weights({ [A]: 0.5, [B]: 0.3, [C]: 0.2 });
{
  const n = 11;
  const panel = rotPanel(n);
  const sigs = { [A]: makeSignal(A, n, { sell: [2], reentry: [6] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const r = simulate(panel, sigs, config('ROTATE', rotW(), n));
  clean(r, 'ROTATE');
  eq(r.trades.map(t => `${t.index}:${t.code}:${t.side}:${t.reason}`), [
    '0:069500:BUY:initial', '0:283580:BUY:initial', '0:379800:BUY:initial',
    '3:069500:SELL:signal_sell',
    '4:283580:BUY:rotation_buy', '4:379800:BUY:rotation_buy',
    '7:283580:SELL:trim', '7:379800:SELL:trim',
    '8:069500:BUY:reentry',
  ], 'ROTATE trade timeline');
  const byKey = (idx: number, code: AssetCode) => r.trades.find(t => t.index === idx && t.code === code) as Trade;
  near(byKey(3, A).amount, 500000, 'ROTATE signal sell amount');
  near(byKey(4, B).amount, 150000, 'ROTATE rotation B capped at room'); near(byKey(4, B).qty, 1500, 'ROTATE rotation B qty');
  near(byKey(4, C).amount, 100000, 'ROTATE rotation C capped at room'); near(byKey(4, C).qty, 1000, 'ROTATE rotation C qty');
  near(r.cashWeight[3], 0.5, 'ROTATE cash weight after sell'); near(r.cashWeight[4], 0.25, 'ROTATE excess over caps stays cash');
  near(byKey(7, B).amount, 150000, 'ROTATE trim B amount'); near(byKey(7, B).qty, 1250, 'ROTATE trim B qty (open 120)');
  near(byKey(7, C).amount, 100000, 'ROTATE trim C amount'); near(byKey(7, C).qty, 1000, 'ROTATE trim C qty');
  near(byKey(8, A).amount, 500000, 'ROTATE reentry amount'); near(byKey(8, A).qty, 4000, 'ROTATE reentry qty at idx8 open 125');
  eq(r.equity, [1e6, 1e6, 990000, 1e6, 1e6, 1e6, 1e6, 1090000, 1090000, 1090000, 1110000], 'ROTATE equity curve');
  near(r.cashWeight[7], 500000 / 1090000, 'ROTATE cash weight idx7'); near(r.cashWeight[8], 0, 'ROTATE cash weight idx8');
  near(r.contributions[A], 20000, 'ROTATE contribution A'); near(r.contributions[B], 90000, 'ROTATE contribution B');
  near(r.contributions[C], 0, 'ROTATE contribution C');
  eq(r.campaigns, [{
    code: A, sellSignalIndex: 2, sellIndex: 3, reentrySignalIndex: 6, reentryIndex: 8, completed: true, pyramidFills: 0,
  }], 'ROTATE campaign');

  // 재진입 매수가 체결되기 전(idx7 종가)에 매도신호가 나면 미체결 매수 취소 + 전량 매도(보유 0 → 거래 없음)
  const sigsCancel = { [A]: makeSignal(A, n, { sell: [2, 7], reentry: [6] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const rc = simulate(panel, sigsCancel, config('ROTATE', rotW(), n));
  clean(rc, 'ROTATE cancel');
  eq(rc.trades.filter(t => t.index === 8).length, 0, 'cancel: no trade at idx8');
  eq(rc.trades.filter(t => t.index === 7).map(t => `${t.code}:${t.reason}`).sort(), ['283580:trim', '379800:trim'], 'cancel: trims already executed stay');
  near(rc.equity[10], 1090000, 'cancel: trimmed cash stays cash');
  eq(rc.campaigns.length, 2, 'cancel: two campaigns');
  eq(rc.campaigns[0].completed, false, 'cancel: first campaign never re-entered');
  eq(rc.campaigns[1].sellSignalIndex, 7, 'cancel: second campaign signal'); eq(rc.campaigns[1].sellIndex, 8, 'cancel: sell resolved at idx8');
  eq(rc.sellEventCount, 2, 'cancel: sell events');

  // 시작일 오프셋: startIndex=2 면 첫 매수는 idx2 시가이고 곡선은 idx2 종가부터
  const r0 = simulate(panel, sigs, config('BH', rotW(), n, { startIndex: 2 }));
  eq(r0.trades.map(t => t.index), [2, 2, 2], 'startIndex: initial buys at start open');
  eq(r0.equity.length, n - 2, 'startIndex: curve length');
  eq(r0.dates[0], panel.dates[2], 'startIndex: first date');
  near(r0.equity[0], 1e6 * (1 + 0.5 * -0.02), 'startIndex: first equity at start close (A close 98)');

  // 비용이 있으면 축소매도는 순대금이 부족분과 같도록 S/(1-c) 만큼 팔아야 하므로, 재진입 매수가 λ=1 로 체결된다:
  //  재진입 금액 = 0.5 × (결정일 idx6 종가 평가액), 매수 직후 현금은 0.
  const rcost = simulate(panel, sigs, config('ROTATE', rotW(), n, { costOneWay: 0.001 }));
  clean(rcost, 'ROTATE trim with cost');
  const reCost = rcost.trades.find(t => t.reason === 'reentry') as Trade;
  eq(reCost.index, 8, 'cost: reentry still at idx8');
  near(reCost.amount, 0.5 * rcost.equity[6], 'cost: reentry funded in full (lambda=1)', 1e-6);
  near(rcost.cashWeight[8], 0, 'cost: no cash left after funded reentry', 1e-9);

  // 비용·이자가 있어도 회계 불변식이 유지된다
  const rf = simulate(panel, sigs, config('ROTATE', rotW(), n, { costOneWay: 0.001, annualCashRate: flat(n, 0.0225) }));
  clean(rf, 'ROTATE with cost+interest');
  for (const t of rf.trades) near(t.cost, t.amount * 0.001, `cost = amount x c (${t.index}${t.code})`, 1e-9);
  const sumContrib = ASSET_CODES.reduce((s, code) => s + rf.contributions[code], 0);
  near(sumContrib + rf.cashInterest, rf.equity[n - 1] - 1_000_000, 'contributions + interest = pnl', 1e-6);
}

// ── ⑤ 공통 λ ────────────────────────────────────────────────────────────────
// A .4/B .5/C .1, 상한 .6/.75/.15, 평평한 가격 100, 자본 1,000,000. A·B 가 idx2 종가에 동시 매도 → idx3 시가 400000+500000.
//   idx4: C 만 수혜(여유 .15e6−100000=50000) → C +50000, 현금 850000.
//   A·B 재진입신호 idx6: 희망액 400000+500000=900000, 가용 850000, 부족 50000 → C 축소를 idx7 에 예약하지만
//   C 가 idx7 에 거래 불가(결측) → 축소 생략. idx8 시가 필요 900000 > 현금 850000 → 공통 λ=850/900:
//   A 377777.77777777775, B 472222.22222222225
{
  const n = 10;
  const cOpen = flat(n, 100); const cClose = flat(n, 100); const cFresh = Array(n).fill(true) as boolean[];
  (cOpen as (number | null)[])[7] = null; (cClose as (number | null)[])[7] = null; cFresh[7] = false;
  const panel = makePanel(n, {
    [A]: { open: flat(n, 100), close: flat(n, 100) },
    [B]: { open: flat(n, 100), close: flat(n, 100) },
    [C]: { open: cOpen, close: cClose, fresh: cFresh },
  });
  const sigs = {
    [A]: makeSignal(A, n, { sell: [2], reentry: [6] }),
    [B]: makeSignal(B, n, { sell: [2], reentry: [6] }),
    [C]: makeSignal(C, n),
  };
  const w = weights({ [A]: 0.4, [B]: 0.5, [C]: 0.1 });
  const r = simulate(panel, sigs, config('ROTATE', w, n));
  clean(r, 'lambda');
  const rot = r.trades.filter(t => t.reason === 'rotation_buy');
  eq(rot.length, 1, 'lambda: single rotation buy'); eq(rot[0].code, C, 'lambda: only C is eligible');
  near(rot[0].amount, 50000, 'lambda: C limited to cap room');
  eq(r.trades.filter(t => t.reason === 'trim').length, 0, 'lambda: trim skipped when asset not tradable');
  const re = r.trades.filter(t => t.reason === 'reentry');
  eq(re.map(t => `${t.index}:${t.code}`), ['8:069500', '8:379800'], 'lambda: both re-entries at idx8 (trim-funded timing)');
  near(re[0].amount, 400000 * 850 / 900, 'lambda: A scaled'); near(re[1].amount, 500000 * 850 / 900, 'lambda: B scaled');
  near(re[0].amount / 400000, re[1].amount / 500000, 'lambda: common factor');
  near(r.cashWeight[9], 0, 'lambda: cash fully used');
  near(r.equity[9], 1e6, 'lambda: equity flat prices');
}

// ── ⑥ 최소주문 · ⑦ 상한(수동 초과) ───────────────────────────────────────────
// A .5/B .3/C .2, 상한 배수 1.0 → 상한=목표비중. A 가 idx3 시가에 500000 현금화. idx4 시가에서 B 가 하락:
//  p_B=96 → V=500000+288000+200000=988000, B 여유 .3×988000−288000 = 8400 < 1만원 → 매수 생략(현금 유지), C 여유<0.
//  p_B=95 → V=985000, B 여유 295500−285000=10500 ≥ 1만원 → B 10500 매수, C 여유<0 이라 제외.
{
  const n = 7;
  const mk = (pB: number) => makePanel(n, {
    [A]: { open: flat(n, 100), close: [100, 100, 98, 100, 100, 100, 100] },
    [B]: { open: [100, 100, 100, 100, pB, pB, pB], close: [100, 100, 100, 100, pB, pB, pB] },
    [C]: { open: flat(n, 100), close: flat(n, 100) },
  });
  const sigs = { [A]: makeSignal(A, n, { sell: [2] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
  const cfg = config('ROTATE', rotW(), n, { capMultiplier: 1.0 });
  const r96 = simulate(mk(96), sigs, cfg);
  clean(r96, 'min order 96');
  eq(r96.trades.map(brief), ['0:BUY:initial:500000', '0:BUY:initial:200000', '0:BUY:initial:300000', '3:SELL:signal_sell:500000'], 'min order: nothing bought (room 8400 < 10000)');
  near(r96.cashWeight[6], 500000 / (500000 + 288000 + 200000), 'min order: proceeds stay cash');
  const r95 = simulate(mk(95), sigs, cfg);
  clean(r95, 'min order 95');
  const rot = r95.trades.filter(t => t.reason === 'rotation_buy');
  eq(rot.length, 1, 'min order: one rotation buy'); eq(rot[0].code, B, 'min order: B only');
  near(rot[0].amount, 10500, 'min order: bought exactly the room'); near(rot[0].qty, 10500 / 95, 'min order: qty at open 95');
}
{
  // ⑦ 수동 초과: D 가 가격 급등(100→250)으로 상한(.2)을 이미 넘으면 추가매수 금지, 강제 매도도 없음.
  // A .5/B .2/C .2/D .1, 상한 배수 2 → A 1.0/B .4/C .4/D .2. A 가 idx3 시가에 500000 현금화.
  // idx4 시가: D 1000주×250=250000, V=500000+200000+200000+250000=1,150,000 → D 상한 230000 < 250000 → 제외.
  // B·C 여유 .4×1.15e6−200000=260000 씩 → 500000 을 .2:.2 로 나누면 250000 씩 → B·C 각 2500주.
  const n = 7;
  const panel = makePanel(n, {
    [A]: { open: flat(n, 100), close: [100, 100, 98, 100, 100, 100, 100] },
    [B]: { open: flat(n, 100), close: flat(n, 100) },
    [C]: { open: flat(n, 100), close: flat(n, 100) },
    [D]: { open: [100, 100, 100, 100, 250, 250, 250], close: [100, 100, 100, 250, 250, 250, 250] },
  });
  const sigs = { [A]: makeSignal(A, n, { sell: [2] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n), [D]: makeSignal(D, n) };
  const r = simulate(panel, sigs, config('ROTATE', weights({ [A]: 0.5, [B]: 0.2, [C]: 0.2, [D]: 0.1 }), n, { capMultiplier: 2 }));
  clean(r, 'manual excess');
  const rot = r.trades.filter(t => t.reason === 'rotation_buy');
  eq(rot.map(t => t.code), [C, B], 'manual excess: only B and C receive money (code order 283580,379800)');
  near(rot[0].amount, 250000, 'manual excess: C'); near(rot[1].amount, 250000, 'manual excess: B');
  eq(tradesOf(r, D).length, 1, 'manual excess: D never traded after start (no buy, no forced sell)');
  near(r.cashWeight[6], 0, 'manual excess: all proceeds deployed');
  // 평가: B 4500주×100 + C 4500주×100 + D 1000주×250 = 1,150,000
  near(r.equity[6], 1150000, 'manual excess: equity');
}

// ── ⑧ 불타기 ────────────────────────────────────────────────────────────────
// A .3/B .7, 상한 배수 1.0(상한=비중), 자본 1,000,000. B 는 상한(.7)에 걸려 로테이션을 받지 못한다(여유 0).
//   idx0 시가 100: A 3000주, B 7000주. A 매도신호 idx2 → idx3 시가 100: 300000 현금(분배 대상 없음 → 현금 유지).
//   A 재진입신호 idx5 종가(V=1,000,000): 희망액 min(.3,.3)×V=300000 → 유닛 160000/80000/40000/20000 (8:4:2:1/15).
//   현금 300000 으로 충분 → idx6 시가 100 에 160000(1600주). 이후 B 가 120 으로 올라 상한 여유가 생겨 추가매수가 상한에 막히지 않는다.
const pyrPanel = (n: number, aOpen: number[], aClose: number[]) => makePanel(n, {
  [A]: { open: aOpen, close: aClose },
  [B]: { open: [...flat(7, 100), ...flat(n - 7, 120)], close: [...flat(7, 100), ...flat(n - 7, 120)] },
});
const pyrCfg = (n: number, interval: '0.5N' | '4N' | '10pct', events: SigSpec = {}) => ({
  sigs: { [A]: makeSignal(A, n, { sell: [2], reentry: [5], atr: 4, ...events }), [B]: makeSignal(B, n) },
  config: config('ROTATE_PYRAMID', weights({ [A]: 0.3, [B]: 0.7 }), n, { capMultiplier: 1.0, pyramid: { interval } }),
});
const pyrOpen = [100, 100, 100, 100, 100, 100, 100, 101, 105, 107, 110, 112, 114, 114, 114, 114];
const pyrClose = [100, 100, 98, 100, 100, 101, 101, 103, 106, 108, 111, 113, 120, 120, 120, 120];
{
  const n = 16;
  const panel = pyrPanel(n, pyrOpen, pyrClose);

  // 0.5N (N=4 → +2): 마지막 체결가 100 → 문턱 102: idx7 종가 103 → idx8 시가 105 에 80000(761.9047619047619주)
  //   마지막 체결가 105 → 문턱 107: idx8 종가 106 미달, idx9 종가 108 → idx10 시가 110 에 40000(363.6363636363636주)
  //   마지막 체결가 110 → 문턱 112: idx10 종가 111 미달, idx11 종가 113 → idx12 시가 114 에 20000(175.43859649122808주). 4단계 종료.
  const p = pyrCfg(n, '0.5N');
  const r = simulate(panel, p.sigs, p.config);
  clean(r, 'pyramid 0.5N');
  eq(tradesOf(r, A).map(brief), ['0:BUY:initial:300000', '3:SELL:signal_sell:300000', '6:BUY:reentry:160000',
    '8:BUY:pyramid:80000', '10:BUY:pyramid:40000', '12:BUY:pyramid:20000'], 'pyramid 0.5N A timeline (8:4:2:1 amounts)');
  const tp = tradesOf(r, A).filter(t => t.reason === 'pyramid');
  near(tp[0].price, 105, 'pyramid stage2 price'); near(tp[0].qty, 761.9047619047619, 'pyramid stage2 qty');
  near(tp[1].price, 110, 'pyramid stage3 price'); near(tp[1].qty, 363.6363636363636, 'pyramid stage3 qty');
  near(tp[2].price, 114, 'pyramid stage4 price'); near(tp[2].qty, 175.43859649122808, 'pyramid stage4 qty');
  eq(r.trades.length, 7, 'pyramid: no trades besides A (6) and initial B (1)');
  near(r.equity[15], 1188117.5666438825, 'pyramid 0.5N end equity');
  near(r.cashWeight[15], 0, 'pyramid: cash fully used by the 4 units');
  eq(r.campaigns, [{
    code: A, sellSignalIndex: 2, sellIndex: 3, reentrySignalIndex: 5, reentryIndex: 6, completed: true, pyramidFills: 3,
  }], 'pyramid campaign');

  // 4N (+16): 첫 문턱 116 은 idx12 종가 120 에서 처음 넘는다 → idx13 시가 114 에 80000. 마지막 체결가 114 → 문턱 130 은 안 넘음.
  const p4 = pyrCfg(n, '4N');
  const r4 = simulate(panel, p4.sigs, p4.config);
  clean(r4, 'pyramid 4N');
  eq(tradesOf(r4, A).filter(t => t.reason === 'pyramid').map(brief), ['13:BUY:pyramid:80000'], '4N one stage');
  near(tradesOf(r4, A).filter(t => t.reason === 'pyramid')[0].qty, 80000 / 114, '4N qty');
  near(r4.equity[15], 1176210.5263157894, '4N end equity');
  eq(r4.campaigns[0].pyramidFills, 1, '4N pyramidFills');

  // 10pct: 문턱 110 → idx10 종가 111 에서 처음 → idx11 시가 112 에 80000. 마지막 체결가 112 → 문턱 123.2 는 안 넘음.
  const p10 = pyrCfg(n, '10pct');
  const r10 = simulate(panel, p10.sigs, p10.config);
  clean(r10, 'pyramid 10pct');
  eq(tradesOf(r10, A).filter(t => t.reason === 'pyramid').map(brief), ['11:BUY:pyramid:80000'], '10pct one stage');
  near(tradesOf(r10, A).filter(t => t.reason === 'pyramid')[0].qty, 80000 / 112, '10pct qty');
  near(r10.equity[15], 1177714.2857142857, '10pct end equity');

  // 매도 시: 캠페인 중 idx9 종가 매도신호(같은 날 불타기 문턱 108≥107 도 참이지만 매도 우선) → idx10 시가 110 에 전량 매도
  //   보유 1600+761.9047619047619 = 2361.9047619047619주 → 259809.52380952382. 추가매수(3단계) 없음.
  const ps = pyrCfg(n, '0.5N', { sell: [2, 9] });
  const rs = simulate(panel, ps.sigs, ps.config);
  clean(rs, 'pyramid sell');
  eq(tradesOf(rs, A).map(brief), ['0:BUY:initial:300000', '3:SELL:signal_sell:300000', '6:BUY:reentry:160000',
    '8:BUY:pyramid:80000', '10:SELL:signal_sell:259809.524'], 'sell wins over pyramid trigger; full liquidation');
  near(tradesOf(rs, A)[4].qty, 2361.9047619047619, 'sell liquidates every accumulated share');
  near(rs.equity[15], 1159809.5238095238, 'sell: end equity (cash + B)');
  eq(rs.campaigns.map(c2 => [c2.sellSignalIndex, c2.completed, c2.pyramidFills]), [[2, true, 1], [9, false, 0]], 'sell: campaigns');
}
{
  // 하루 한 단계 + 문턱은 마지막 "실제 체결가" 기준 (N=1 → +0.5):
  //  마지막 체결가 100 → 문턱 100.5, idx7 종가 104 는 100.5·101·102·103·104 를 한꺼번에 넘지만 idx8 시가 105 에 한 단계(80000)만 체결.
  //  마지막 체결가 105 → 문턱 105.5, idx8 종가 105.2 미달(이론 문턱 101.0·101.5…로 계산했다면 걸렸을 것) → idx9 에는 체결 없음.
  //  idx9 종가 107 ≥ 105.5 → idx10 시가 108 에 40000. 마지막 체결가 108 → 문턱 108.5, idx10 종가 112 → idx11 시가 113 에 20000.
  const n = 16;
  const aOpen = [100, 100, 100, 100, 100, 100, 100, 101, 105, 106, 108, 113, 113, 113, 113, 113];
  const aClose = [100, 100, 98, 100, 100, 100, 100.2, 104, 105.2, 107, 112, 113, 113, 113, 113, 113];
  const p = pyrCfg(n, '0.5N', { atr: 1 });
  const r = simulate(pyrPanel(n, aOpen, aClose), p.sigs, p.config);
  clean(r, 'pyramid gap');
  const stages = tradesOf(r, A).filter(t => t.reason === 'pyramid');
  eq(stages.map(t => t.index), [8, 10, 11], 'gap: one stage per session, based on last actual fill');
  eq(new Set(stages.map(t => t.index)).size, stages.length, 'gap: never two stages in one session');
  eq(stages.map(t => Math.round(t.amount)), [80000, 40000, 20000], 'gap: units 4/15, 2/15, 1/15');
  near(stages[0].price, 105, 'gap: fill price is the open (gap not clamped)');
}
{
  // 상한이 불타기 유닛을 줄이면 줄어든 만큼만 체결하고 나중에 보충하지 않는다.
  //  idx8 시가 160: V=현금 140000 + A 1600주×160=256000 + B 700000 = 1,096,000, 상한 .3V=328800 → 여유 328800−256000=72800 < 80000
  //  → 2단계는 72800 만 체결. 마지막 체결가 160 → 문턱 162 는 안 넘으므로 이후 거래 없음(부족분 7200 보충 없음, 현금 67200 유지).
  const n = 12;
  const aOpen = [100, 100, 100, 100, 100, 100, 100, 101, 160, 160, 160, 160];
  const aClose = [100, 100, 98, 100, 100, 101, 101, 150, 160, 160, 160, 160];
  const panel = makePanel(n, {
    [A]: { open: aOpen, close: aClose },
    [B]: { open: flat(n, 100), close: flat(n, 100) },
  });
  const sigs = { [A]: makeSignal(A, n, { sell: [2], reentry: [5], atr: 4 }), [B]: makeSignal(B, n) };
  const r = simulate(panel, sigs, config('ROTATE_PYRAMID', weights({ [A]: 0.3, [B]: 0.7 }), n, { capMultiplier: 1.0, pyramid: { interval: '0.5N' } }));
  clean(r, 'pyramid cap clip');
  eq(tradesOf(r, A).filter(t => t.reason === 'pyramid').map(brief), ['8:BUY:pyramid:72800'], 'cap clip: stage 2 reduced to cap room');
  eq(tradesOf(r, A).length, 4, 'cap clip: nothing refilled later');
  near(r.cashWeight[11], 67200 / (67200 + (1600 + 72800 / 160) * 160 + 700000), 'cap clip: unfilled unit stays cash');
}

// ── ⑩ 입력 순서를 섞어도 결과 동일 ───────────────────────────────────────────
{
  const reversed = [...ASSET_CODES].reverse();
  // (a) 재진입 비례축소 시나리오
  {
    const n = 11;
    const base = rotPanel(n);
    const sigs = { [A]: makeSignal(A, n, { sell: [2], reentry: [6] }), [B]: makeSignal(B, n), [C]: makeSignal(C, n) };
    const r1 = simulate(base, sigs, config('ROTATE', rotW(), n));
    const shuffledPanel: Panel = {
      dates: base.dates,
      assets: Object.fromEntries(reversed.map(code => [code, base.assets[code]])) as Record<AssetCode, AssetBars>,
    };
    const shuffledSigs = { [C]: sigs[C], [B]: sigs[B], [A]: sigs[A] };
    const r2 = simulate(shuffledPanel, shuffledSigs, config('ROTATE', weights({ [A]: 0.5, [B]: 0.3, [C]: 0.2 }, reversed), n));
    eq(r2, r1, 'shuffle: rotate scenario identical');
  }
  // (b) 공통 λ 시나리오
  {
    const n = 10;
    const mk = (order: readonly AssetCode[]) => {
      const cOpen: (number | null)[] = flat(n, 100); const cClose: (number | null)[] = flat(n, 100);
      const cFresh = Array(n).fill(true) as boolean[];
      cOpen[7] = null; cClose[7] = null; cFresh[7] = false;
      return makePanel(n, {
        [A]: { open: flat(n, 100), close: flat(n, 100) },
        [B]: { open: flat(n, 100), close: flat(n, 100) },
        [C]: { open: cOpen, close: cClose, fresh: cFresh },
      }, order);
    };
    const sigsOf = () => ({
      [A]: makeSignal(A, n, { sell: [2], reentry: [6] }),
      [B]: makeSignal(B, n, { sell: [2], reentry: [6] }),
      [C]: makeSignal(C, n),
    });
    const w1 = weights({ [A]: 0.4, [B]: 0.5, [C]: 0.1 });
    const w2 = weights({ [A]: 0.4, [B]: 0.5, [C]: 0.1 }, reversed);
    const s1 = sigsOf(); const s2s = sigsOf();
    const r1 = simulate(mk(ASSET_CODES), s1, config('ROTATE', w1, n));
    const r2 = simulate(mk(reversed), { [C]: s2s[C], [B]: s2s[B], [A]: s2s[A] }, config('ROTATE', w2, n));
    eq(r2, r1, 'shuffle: lambda scenario identical');
  }
  // (c) 불타기 시나리오
  {
    const n = 16;
    const base = pyrPanel(n, pyrOpen, pyrClose);
    const p = pyrCfg(n, '0.5N');
    const r1 = simulate(base, p.sigs, p.config);
    const shuffledPanel: Panel = {
      dates: base.dates,
      assets: Object.fromEntries(reversed.map(code => [code, base.assets[code]])) as Record<AssetCode, AssetBars>,
    };
    const r2 = simulate(shuffledPanel, { [B]: p.sigs[B], [A]: p.sigs[A] }, { ...p.config, weights: weights({ [A]: 0.3, [B]: 0.7 }, reversed) });
    eq(r2, r1, 'shuffle: pyramid scenario identical');
  }
}

// ── 사양 가드 ────────────────────────────────────────────────────────────────
{
  const n = 4;
  const panel = makePanel(n, { [A]: { open: flat(n, 100), close: flat(n, 100) } });
  assert.throws(() => simulate(panel, {}, config('ROTATE', weights({ [A]: 1 }), n)), /missing signal/);
  assert.throws(() => simulate(panel, {}, config('BH', weights({ [A]: 1 }), n, { endIndex: 9 })), /invalid index range/);
  checks += 2;
}

console.log(`  ${checks} assertions passed`);
