// scripts/backtest/spxDipBuy/grid.ts
// 파라미터 격자 탐색 — 개발구간(1965~1989 시작)에서 고른 조합이 검증구간(1990~2014 시작)에서도 통하는지 본다.
// 명세 §12: "과거 수익률 최고 조합을 찾는 것"과 "새 기간에서도 유효한 것"을 분리한다.
//   실행: npx tsx scripts/backtest/spxDipBuy/grid.ts   → data/grid.json
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRaw, toSeries } from './buildSeries';
import {
  prepare, runSweep, defaultStrategies, DEFAULT_COMMON,
  type StrategyParams, type Tranche, type Sweep, type Summary,
} from './engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface GridRow {
  id: string;
  family: 'C' | 'E' | 'F' | 'D';
  t0: number | null; // 첫 하락 구간(%)
  upfront: number | null;
  maN: number;
  band: number;
  confirm: number;
  dev: Metrics;
  hold: Metrics;
  holdTr: Metrics;
}
interface Metrics { n: number; cagr: number; mdd: number; mddWorst: number; beatA: number; excess: number; calmar: number }

function tranchesFrom(t0: number): Tranche[] {
  return [
    { dd: t0, pct: 20 },
    { dd: t0 - 5, pct: 20 },
    { dd: t0 - 10, pct: 20 },
    { dd: t0 - 15, pct: 40 },
  ];
}

function metrics(s: Summary): Metrics {
  return {
    n: s.n, cagr: s.cagrMedian, mdd: s.mddMedian, mddWorst: s.mddWorst,
    beatA: s.beatBaseRate, excess: s.excessMedian,
    calmar: s.mddMedian < 0 ? s.cagrMedian / Math.abs(s.mddMedian) : NaN,
  };
}

const b = loadRaw();
const cashIrx = { mode: 'irx' as const, fixed: 0 };
const pPrice = prepare(toSeries(b, 'price', cashIrx));
const pTr = prepare(toSeries(b, 'tr', cashIrx));

const swDev: Sweep = { stepMonths: 1, firstDate: '1965-01-01', lastDate: '1989-12-31', horizonYears: 10, allowIncomplete: false };
const swHold: Sweep = { stepMonths: 1, firstDate: '1990-01-01', lastDate: '2014-12-31', horizonYears: 10, allowIncomplete: false };

const base = defaultStrategies(50);
const A = base[0];

const cfgs: { fam: GridRow['family']; strat: StrategyParams; t0: number | null; up: number | null }[] = [];
cfgs.push({ fam: 'D', strat: { ...base[3], label: 'D MA50' }, t0: null, up: null });
for (const n of [50, 100, 200]) cfgs.push({ fam: 'D', strat: { ...base[3], label: `D MA${n}`, ma: { ...base[3].ma, n } }, t0: null, up: null });
for (const t0 of [-10, -15, -20]) {
  for (const up of [0, 30, 50, 70]) {
    const trs = tranchesFrom(t0);
    cfgs.push({ fam: 'C', strat: { ...base[2], label: `C t0=${t0} up=${up}`, upfrontPct: up, tranches: trs }, t0, up });
    for (const n of [50, 100, 200]) {
      for (const band of [0, 2]) {
        for (const confirm of [1, 3]) {
          cfgs.push({
            fam: 'E',
            strat: { ...base[4], label: `E t0=${t0} up=${up} MA${n} b${band} c${confirm}`, upfrontPct: up, tranches: trs, ma: { ...base[4].ma, n, band, confirmDays: confirm } },
            t0, up,
          });
        }
      }
      cfgs.push({ fam: 'F', strat: { ...base[5], label: `F t0=${t0} up=${up} MA${n}`, upfrontPct: up, tranches: trs, ma: { ...base[5].ma, n } }, t0, up });
    }
  }
}

function evalAll(p: ReturnType<typeof prepare>, sw: Sweep): Summary[] {
  const strategies = [A, ...cfgs.map(c => c.strat)];
  return runSweep(p, strategies, DEFAULT_COMMON, sw, 0).summaries;
}

const dev = evalAll(pPrice, swDev);
const hold = evalAll(pPrice, swHold);
const holdTr = evalAll(pTr, swHold);

const rows: GridRow[] = cfgs.map((c, k) => ({
  id: c.strat.label,
  family: c.fam,
  t0: c.t0,
  upfront: c.up,
  maN: c.strat.ma.n,
  band: c.strat.ma.band,
  confirm: c.strat.ma.confirmDays,
  dev: metrics(dev[k + 1]),
  hold: metrics(hold[k + 1]),
  holdTr: metrics(holdTr[k + 1]),
}));
const baseline = { dev: metrics(dev[0]), hold: metrics(hold[0]), holdTr: metrics(holdTr[0]) };

writeFileSync(path.join(__dirname, 'data', 'grid.json'), JSON.stringify({ baseline, rows, devRange: '1965-1989', holdRange: '1990-2014' }));
process.stdout.write(`grid rows=${rows.length}\n`);
const byDev = rows.slice().sort((x, y) => y.dev.calmar - x.dev.calmar).slice(0, 8);
for (const r of byDev) {
  process.stdout.write(`${r.id.padEnd(40)} dev calmar ${r.dev.calmar.toFixed(2)} CAGR ${(r.dev.cagr*100).toFixed(2)} MDD ${(r.dev.mdd*100).toFixed(1)} | hold calmar ${r.hold.calmar.toFixed(2)} CAGR ${(r.hold.cagr*100).toFixed(2)} MDD ${(r.hold.mdd*100).toFixed(1)} | A: dev ${baseline.dev.calmar.toFixed(2)} hold ${baseline.hold.calmar.toFixed(2)}\n`);
}
