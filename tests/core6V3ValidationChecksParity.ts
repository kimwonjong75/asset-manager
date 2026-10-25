// tests/core6V3ValidationChecksParity.ts
// 코어 6종 신호 로테이션 V3 — 검증구간 사후 점검(run/validationChecks.ts) 골든 테스트. 오프라인·합성 패널(실제 패널 파일을 읽지 않는다).
// 기대값은 손계산 숫자이며 구현 함수의 출력을 정답으로 쓰지 않는다.

import { strict as assert } from 'assert';
import {
  afterTaxFromTrades,
  analyseRule,
  bhLiquidationTax,
  capFor,
  decideLabel,
  looPass,
  looWeights,
  maxAssetShare,
  meetsCriteria12,
  planOffsets,
  quarterlyExcessFromEquity,
  windowContributions,
} from '../scripts/backtest/core6SignalRotationV3/run/validationChecks';
import type { Criteria } from '../scripts/backtest/core6SignalRotationV3/run/validationChecks';
import { computeSignalCache } from '../scripts/backtest/core6SignalRotationV3/run/common';
import type { CdRow } from '../scripts/backtest/core6SignalRotationV3/run/common';
import type { SelectedRule } from '../scripts/backtest/core6SignalRotationV3/run/devRun';
import { ASSET_CODES, TARGET_WEIGHTS } from '../scripts/backtest/core6SignalRotationV3/types';
import type { AssetBars, AssetCode, Panel } from '../scripts/backtest/core6SignalRotationV3/types';
import type { Trade } from '../scripts/backtest/core6SignalRotationV3/portfolio/simulate';

let checks = 0;
function eq<T>(actual: T, expected: T, label: string): void {
  checks += 1;
  assert.deepStrictEqual(actual, expected, label);
}
function near(actual: number, expected: number, label: string, tol = 1e-9): void {
  checks += 1;
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected}, got ${actual}`);
}

// ── 1. leave-one-out 재정규화 ───────────────────────────────────────────────
{
  const w = looWeights(TARGET_WEIGHTS, '411060');
  near(w['411060'], 0, 'LOO 제거 자산 0');
  near(w['069500'], 0.17 / 0.75, 'LOO 069500 = 0.17/0.75');
  near(w['379800'], 0.17 / 0.75, 'LOO 379800');
  near(w['283580'], 0.16 / 0.75, 'LOO 283580 = 0.16/0.75');
  near(w['385560'], 0.125 / 0.75, 'LOO 385560 = 1/6');
  near(w['464470'], 0.125 / 0.75, 'LOO 464470 = 1/6');
  near(ASSET_CODES.reduce((s, c) => s + w[c], 0), 1, 'LOO 합 1');
  // 상한 재계산 min(1.5w, 35%)
  near(capFor(w['069500']), 0.34, 'LOO 상한 069500 = 1.5×0.22667 = 0.34');
  near(capFor(w['283580']), 0.32, 'LOO 상한 283580 = 0.32');
  near(capFor(w['385560']), 0.25, 'LOO 상한 385560 = 0.25');
  // 069500 제거 → 금 25/83 = 30.12%, 1.5배 45.18% → 절대 35% 캡
  const w2 = looWeights(TARGET_WEIGHTS, '069500');
  near(w2['411060'], 0.25 / 0.83, 'LOO 금 비중');
  near(capFor(w2['411060']), 0.35, '절대 35% 캡');
  near(ASSET_CODES.reduce((s, c) => s + w2[c], 0), 1, 'LOO2 합 1');
}

// ── 2. 시작일 오프셋 인덱스 ─────────────────────────────────────────────────
{
  const p = planOffsets(10, 399);
  eq(p.map(x => x.startIndex), [10, 31, 52, 73], '오프셋 시작 인덱스');
  eq(p.map(x => x.days), [390, 369, 348, 327], '잔여일');
  eq(p.every(x => x.valid), true, '전부 유효');
  const q = planOffsets(10, 220);
  eq(q.map(x => x.valid), [true, true, false, false], '잔여 <180 이면 제외(190 유효, 169·148 제외)');
  eq(planOffsets(10, 252)[3].days, 180, '잔여 정확히 180');
  eq(planOffsets(10, 252)[3].valid, true, '180 은 유효');
  eq(planOffsets(10, 251)[3].valid, false, '179 는 제외');
}

// ── 3. 기준 1·2 / LOO 판정 ──────────────────────────────────────────────────
{
  eq(meetsCriteria12(-0.4, -0.2, 0.1, 0.1), true, '축소 50%, CAGR 동일 → 충족');
  eq(meetsCriteria12(-0.4, -0.2, 0.1, 0.081), true, 'CAGR 차이 −1.9%p 충족');
  eq(meetsCriteria12(-0.4, -0.2, 0.1, 0.079), false, 'CAGR 차이 −2.1%p 미충족');
  eq(meetsCriteria12(-0.4, -0.36, 0.1, 0.1), false, '축소 10% 미충족');
  eq(meetsCriteria12(0, -0.1, 0.1, 0.1), false, 'B&H MDD=0 이면 미충족');
  eq(looPass(-0.3, -0.29, 0.1, 0.1), true, 'LOO: MDD 소폭 얕으면 통과(20% 불요)');
  eq(looPass(-0.3, -0.3, 0.1, 0.1), false, 'LOO: MDD 동일하면 실패');
  eq(looPass(-0.3, -0.2, 0.1, 0.079), false, 'LOO: CAGR −2.1%p 실패');
}

// ── 4. 분기 초과손익 항등식 ─────────────────────────────────────────────────
{
  const dates = ['2024-07-01', '2024-09-30', '2024-10-01', '2024-12-31'];
  const q = quarterlyExcessFromEquity(dates, [110, 120, 125, 150], [105, 108, 120, 130], 100);
  eq(q.map(x => x.quarter), ['2024Q3', '2024Q4'], '분기 라벨');
  near(q[0].excessPnl, 12, 'Q3 = (120−100)−(108−100)');
  near(q[1].excessPnl, 8, 'Q4 = (150−120)−(130−108)');
  near(q[0].excessPnl + q[1].excessPnl, 150 - 130, '분기 합 = 최종 차이');
}

// ── 5. 최대 자산 기여 비중 ─────────────────────────────────────────────────
{
  const c = { '069500': 30, '379800': -50, '283580': 20, '385560': 0, '464470': 0, '411060': 0 } as Record<AssetCode, number>;
  const m = maxAssetShare(c);
  eq(m?.code, '379800', '최대 절대기여 자산');
  near(m?.share ?? NaN, 0.5, '비중 0.5 (경계: >0.5 아님)');
  eq(maxAssetShare({ '069500': 0, '379800': 0, '283580': 0, '385560': 0, '464470': 0, '411060': 0 }), null, '합 0 → null');
}

// ── 6. 구간 기여(체결 현금흐름 + 평가 변화) ─────────────────────────────────
function emptyBars(code: AssetCode, close: (number | null)[]): AssetBars {
  const n = close.length;
  return { code, open: close.slice(), high: close.slice(), low: close.slice(), close, fresh: new Array<boolean>(n).fill(true), source: new Array<'actual' | 'absent'>(n).fill('actual') };
}
function trade(index: number, code: AssetCode, side: 'BUY' | 'SELL', qty: number, price: number, costRate: number): Trade {
  const amount = qty * price;
  return { index, date: `2024-07-0${index + 1}`, code, side, qty, price, amount, cost: amount * costRate, reason: side === 'BUY' ? 'initial' : 'signal_sell' };
}
{
  const assets = {} as Record<AssetCode, AssetBars>;
  for (const c of ASSET_CODES) assets[c] = emptyBars(c, c === '069500' ? [100, 110, 120] : [null, null, null]);
  const panel: Panel = { dates: ['2024-07-01', '2024-07-02', '2024-07-03'], assets };
  const trades = [trade(0, '069500', 'BUY', 10, 100, 0.001), trade(2, '069500', 'SELL', 4, 120, 0.001)];
  // 전 구간: 매수 −(1000+1) + 매도 +(480−0.48) + 보유 6×120 = 198.52
  near(windowContributions(panel, trades, 0, 2)['069500'], 198.52, '전 구간 기여', 1e-9);
  // [0..0]: −1001 + 10×100 = −1
  near(windowContributions(panel, trades, 0, 0)['069500'], -1, '첫날 기여(비용만)', 1e-9);
  // [1..2]: 직전 종가(100) 기준 시작 평가 1000, flow +479.52, 말 평가 720 → 199.52
  near(windowContributions(panel, trades, 1, 2)['069500'], 199.52, '후반 구간 기여', 1e-9);
  near(windowContributions(panel, trades, 0, 0)['069500'] + windowContributions(panel, trades, 1, 2)['069500'], windowContributions(panel, trades, 0, 2)['069500'], '구간 가법성', 1e-9);
  near(windowContributions(panel, trades, 0, 2)['379800'], 0, '무거래 자산 0');
}

// ── 7. 세금 소형 예 ─────────────────────────────────────────────────────────
{
  // 379800: 10주 @100 (비용 1% = 10) → 취득가 1010, 평균 101.
  //   5주 @120 매도: 금액 600, 비용 6 → 실현 600−6−505 = 89 → 세금 89×0.154 = 13.706
  //   5주 @90 매도: 금액 450, 비용 4.5 → 실현 450−4.5−505 = −59.5 → 세금 0(통산 없음)
  const trades = [
    trade(0, '379800', 'BUY', 10, 100, 0.01),
    trade(1, '379800', 'SELL', 5, 120, 0.01),
    trade(2, '379800', 'SELL', 5, 90, 0.01),
  ];
  const t = afterTaxFromTrades(trades, [1000, 1100, 1200], 0);
  near(t.realizedByCode['379800'], 29.5, '실현손익 합 89−59.5');
  near(t.taxByCode['379800'], 13.706, '세금(이익 건만)', 1e-9);
  near(t.taxTotal, 13.706, '세금 합계', 1e-9);
  eq(t.taxCount, 1, '과세 건수');
  near(t.netEquity[0], 1000, '세후 곡선 0일(세금 전)');
  near(t.netEquity[1], 1100 - 13.706, '세후 곡선 1일');
  near(t.netEquity[2], 1200 - 13.706, '세후 곡선 2일(누계)');
  // 같은 거래가 069500 이면 비과세
  const ex = afterTaxFromTrades(trades.map(x => ({ ...x, code: '069500' as AssetCode })), [1000, 1100, 1200], 0);
  near(ex.taxTotal, 0, '069500 비과세');
  near(ex.realizedByCode['069500'], 29.5, '069500 실현손익은 기록');
  // B&H 청산 참고: 379800 10주 취득가 1010, 말 종가 130 → 평가 1300, 이익 290 → 44.66. 069500 비과세.
  const assets = {} as Record<AssetCode, AssetBars>;
  for (const c of ASSET_CODES) assets[c] = emptyBars(c, c === '379800' || c === '069500' ? [100, 120, 130] : [null, null, null]);
  const panel: Panel = { dates: ['2024-07-01', '2024-07-02', '2024-07-03'], assets };
  const bh = [trade(0, '379800', 'BUY', 10, 100, 0.01), trade(0, '069500', 'BUY', 10, 100, 0.01)];
  near(bhLiquidationTax(panel, bh, 2), 290 * 0.154, 'B&H 청산 참고 세금', 1e-9);
}

// ── 8. 라벨 결정 ────────────────────────────────────────────────────────────
{
  const all: Criteria = { c1Mdd20: true, c2CagrFloor: true, c3MinEvents: true, c4Adverse: true, c5StartMajority: true, c6Loo: true, c7Cap: true, c8Calmar: true };
  eq(decideLabel(all, false, false).finalLabel, '제한된 기간에서 채택 가능', '전부 충족');
  eq(decideLabel({ ...all, c8Calmar: false }, false, false).finalLabel, '채택하지 않음', '하나 미충족');
  eq(decideLabel({ ...all, c3MinEvents: false }, true, true).finalLabel, '판단 보류', '기준 3 미달은 판단 보류');
  eq(decideLabel(all, true, false).finalLabel, '집중 의존/불안정', '집중');
  eq(decideLabel(all, false, true).finalLabel, '구조변경 의존/불안정', '구조변경');
  eq(decideLabel(all, true, true).finalLabel, '집중 의존/불안정 + 구조변경 의존/불안정', '둘 다');
  eq(decideLabel(all, false, true).criteriaLabel, '제한된 기간에서 채택 가능', '기준 라벨은 보존');
}

// ── 9. 합성 패널 통합: 항등식·결정성 ────────────────────────────────────────
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s + 1) / 4294967297;
  };
}
function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
}
function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function makePanel(n: number, seed: number): Panel {
  const dates = weekdays('2021-12-15', n);
  const rng = makeRng(seed);
  const assets = {} as Record<AssetCode, AssetBars>;
  ASSET_CODES.forEach((code, a) => {
    const open: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    const close: number[] = [];
    let px = 100 + a * 10;
    for (let i = 0; i < n; i++) {
      const drift = 0.0009 * Math.sin((i + a * 37) / 55) + 0.0001;
      const prev = px;
      px = px * Math.exp(drift + 0.011 * gauss(rng));
      const o = prev * (1 + 0.002 * gauss(rng));
      open.push(o);
      high.push(Math.max(o, px) * (1 + Math.abs(gauss(rng)) * 0.004));
      low.push(Math.min(o, px) * (1 - Math.abs(gauss(rng)) * 0.004));
      close.push(px);
    }
    assets[code] = { code, open, high, low, close, fresh: new Array<boolean>(n).fill(true), source: new Array<'actual'>(n).fill('actual') };
  });
  return { dates, assets };
}
{
  const panel = makePanel(1170, 20260101);
  const cd91: CdRow[] = [{ date: '2000-01-01', value: 3.0 }];
  const cache = computeSignalCache(panel);
  const sel: SelectedRule = { rule: 'MA50', pyramidInterval: '10pct', pyramidNote: 'test' };
  const r1 = analyseRule(panel, cache, cd91, sel, { iterations: 200 });
  const r2 = analyseRule(panel, cache, cd91, sel, { iterations: 200 });
  eq(JSON.stringify(r1.bootstrapCvsBh), JSON.stringify(r2.bootstrapCvsBh), '부트스트랩 결정성(seed 고정)');
  eq(r1.bootstrapCvsBh.seed, 260101, '기본 seed 260101');
  eq(r1.bootstrapCvsBh.meanBlock, 21, '평균 블록 21');
  eq(r1.startDate, panel.dates.find(d => d >= '2024-07-01'), '검증 시작일');
  eq(r1.sessions, r1.events.days, '세션 수 = 사건 패스 유효일');
  near(r1.concentration.quarterSumCheck, 0, '분기 초과손익 합 항등식', 1e-4);
  near(r1.concentration.contributionIdentityError, 0, '구간 기여 재구성 = SimResult.contributions', 1e-4);
  // regime 세션 합 = 전체
  eq(r1.structural.regimes.reduce((s, g) => s + g.sessions, 0), r1.sessions, 'regime 세션 합');
  // regime 기여 합 = 전체 기여 합(가법성)
  const totalContribution = ASSET_CODES.reduce((s, c) => s + r1.concentration.strategyContributions[c], 0);
  near(r1.structural.regimes.reduce((s, g) => s + (g.stratContribution ?? 0), 0), totalContribution, 'regime 기여 가법성', 1e-4);
  // LOO
  eq(r1.loo.rows.length, 6, 'LOO 6개');
  for (const row of r1.loo.rows) {
    near(ASSET_CODES.reduce((s, c) => s + row.weights[c], 0), 1, `LOO ${row.removed} 합 1`);
    near(row.weights[row.removed], 0, `LOO ${row.removed} 제거`);
  }
  // 오프셋
  eq(r1.offsets.map(o => o.offset), [0, 21, 42, 63], '오프셋 목록');
  eq(r1.offsets[1].startIndex - r1.offsets[0].startIndex, 21, '오프셋 +21 인덱스');
  eq(r1.offsets[3].startIndex - r1.offsets[0].startIndex, 63, '오프셋 +63 인덱스');
  // 비용 행: B&H 는 6 체결(초기 매수)
  eq(r1.costs[0].trades, 6, 'B&H 체결 6');
  eq(r1.costs[0].sellTrades, 0, 'B&H 매도 0');
  // 세후는 세전보다 클 수 없다.
  eq(r1.tax[0].net.finalEquity <= r1.tax[0].gross.finalEquity + 1e-6, true, '세후 ≤ 세전');
}

process.stdout.write(`core6V3ValidationChecksParity: ${checks} assertions passed\n`);
