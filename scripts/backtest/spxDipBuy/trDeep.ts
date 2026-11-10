// scripts/backtest/spxDipBuy/trDeep.ts
// 총수익(배당 재투자, ^SP500TR 1988~) 기준 심화 검증 — 연구 전용.
//   실행: npx tsx scripts/backtest/spxDipBuy/trDeep.ts   → data/trDeep.json
//
// 핵심 질문: E(하락분할+이평선 매도)의 낙폭 감소는 "타이밍 실력"인가, 그냥 "주식을 덜 들고 있어서"인가?
//   → 같은 평균 투자비중의 '정적 혼합'(주식 x% 즉시 매수, 나머지 T-bill 현금)과 같은 시작일 격자에서 비교한다.
// 사전 판정 기준(결과를 보기 전에 고정):
//   · 하위 구간 둘(1988~2001 시작 / 2002~2016 시작) **모두**에서 정적 혼합 대비 CAGR 중앙값이 높거나 같으면서
//     MDD 중앙값이 더 얕을 때만 "타이밍 가치 있음".
//   · 거래비용 편도 5bp 고정(ETF 가정), 현금은 실제 T-bill(^IRX).
import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadRaw, toSeries } from './buildSeries';
import {
  prepare, runSweep, defaultStrategies,
  type StrategyParams, type Tranche, type Sweep, type Summary,
} from './engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMON = { costBps: 5, principal: 100 };

const b = loadRaw();
const p = prepare(toSeries(b, 'tr', { mode: 'irx', fixed: 0 }));

const sweepFor = (first: string, last: string, years: number): Sweep => ({
  stepMonths: 1, firstDate: first, lastDate: last, horizonYears: years, allowIncomplete: false,
});
const P1 = sweepFor('1988-01-01', '2001-12-31', 10);
const P2 = sweepFor('2002-01-01', '2016-12-31', 10);

const base = defaultStrategies(50);
const tranchesFrom = (t0: number): Tranche[] => [
  { dd: t0, pct: 20 }, { dd: t0 - 5, pct: 20 }, { dd: t0 - 10, pct: 20 }, { dd: t0 - 15, pct: 40 },
];

// 정적 혼합: 시작일 다음 날 주식 x% 매수, 나머지는 T-bill 현금(이자). 이후 거래 없음(리밸런싱 없음).
function mix(x: number): StrategyParams {
  return { ...base[2], label: `혼합 ${x}%`, tranches: [], upfrontPct: x };
}
const MIX_XS = Array.from({ length: 21 }, (_, k) => k * 5);

interface Cfg { id: string; fam: 'E' | 'F' | 'C' | 'D'; strat: StrategyParams; t0: number | null; up: number | null }
const cfgs: Cfg[] = [];
cfgs.push({ id: 'C 하락분할(기본)', fam: 'C', strat: { ...base[2] }, t0: -15, up: 0 });
for (const n of [50, 100, 150, 200]) {
  for (const band of [0, 1, 2, 3]) {
    for (const conf of [1, 3, 5]) {
      cfgs.push({ id: `D MA${n} b${band} c${conf}`, fam: 'D', t0: null, up: null,
        strat: { ...base[3], label: `D MA${n} b${band} c${conf}`, ma: { ...base[3].ma, n, band, confirmDays: conf } } });
    }
  }
}
for (const t0 of [-10, -15, -20]) {
  for (const up of [0, 30, 50, 70]) {
    for (const n of [50, 100, 150, 200]) {
      for (const band of [0, 1, 2, 3]) {
        for (const conf of [1, 3, 5]) {
          for (const scope of ['sold', 'all'] as const) {
            cfgs.push({
              id: `E t0=${t0} up=${up} MA${n} b${band} c${conf} ${scope}`, fam: 'E', t0, up,
              strat: { ...base[4], label: `E t0=${t0} up=${up} MA${n} b${band} c${conf} ${scope}`, upfrontPct: up, tranches: tranchesFrom(t0),
                ma: { ...base[4].ma, n, band, confirmDays: conf, reentryScope: scope } },
            });
          }
        }
      }
    }
    for (const n of [50, 100, 200]) {
      cfgs.push({ id: `F t0=${t0} up=${up} MA${n}`, fam: 'F', t0, up,
        strat: { ...base[5], label: `F t0=${t0} up=${up} MA${n}`, upfrontPct: up, tranches: tranchesFrom(t0), ma: { ...base[5].ma, n } } });
    }
  }
}

interface M { n: number; cagr: number; mdd: number; mddWorst: number; avgInv: number; beatA: number; mixX: number; dCagr: number; dMdd: number; cagrMix: number; mddMix: number }
function runPeriod(sw: Sweep): { A: Summary; B: Summary; mixes: Summary[]; cfg: Summary[] } {
  const strategies = [base[0], base[1], ...MIX_XS.map(mix), ...cfgs.map(c => c.strat)];
  const s = runSweep(p, strategies, COMMON, sw, 0).summaries;
  return { A: s[0], B: s[1], mixes: s.slice(2, 2 + MIX_XS.length), cfg: s.slice(2 + MIX_XS.length) };
}

function matchMix(sum: Summary, mixes: Summary[]): { x: number; ms: Summary } {
  let bi = 0;
  mixes.forEach((m, i) => { if (Math.abs(m.avgInvestedMedian - sum.avgInvestedMedian) < Math.abs(mixes[bi].avgInvestedMedian - sum.avgInvestedMedian)) bi = i; });
  return { x: MIX_XS[bi], ms: mixes[bi] };
}
function toM(s: Summary, mixes: Summary[]): M {
  const { x, ms } = matchMix(s, mixes);
  return { n: s.n, cagr: s.cagrMedian, mdd: s.mddMedian, mddWorst: s.mddWorst, avgInv: s.avgInvestedMedian, beatA: s.beatBaseRate,
    mixX: x, dCagr: s.cagrMedian - ms.cagrMedian, dMdd: s.mddMedian - ms.mddMedian, cagrMix: ms.cagrMedian, mddMix: ms.mddMedian };
}

const r1 = runPeriod(P1);
const r2 = runPeriod(P2);
const rAll = runPeriod(sweepFor('1988-01-01', '2016-12-31', 10));

interface Row { id: string; fam: string; t0: number | null; up: number | null; p1: M; p2: M; all: M; pass: boolean }
const rows: Row[] = cfgs.map((c, k) => {
  const p1 = toM(r1.cfg[k], r1.mixes);
  const p2 = toM(r2.cfg[k], r2.mixes);
  const all = toM(rAll.cfg[k], rAll.mixes);
  const ok = (m: M): boolean => m.dCagr >= 0 && m.dMdd >= 0; // dMdd>=0: MDD(음수)가 혼합보다 얕거나 같음
  return { id: c.id, fam: c.fam, t0: c.t0, up: c.up, p1, p2, all, pass: ok(p1) && ok(p2) };
});

const sumM = (s: Summary): { n: number; cagr: number; mdd: number; mddWorst: number; avgInv: number } =>
  ({ n: s.n, cagr: s.cagrMedian, mdd: s.mddMedian, mddWorst: s.mddWorst, avgInv: s.avgInvestedMedian });
const baselines = {
  A: { p1: sumM(r1.A), p2: sumM(r2.A), all: sumM(rAll.A) },
  B: { p1: sumM(r1.B), p2: sumM(r2.B), all: sumM(rAll.B) },
  mixes: MIX_XS.map((x, i) => ({ x, p1: sumM(r1.mixes[i]), p2: sumM(r2.mixes[i]), all: sumM(rAll.mixes[i]) })),
};

writeFileSync(path.join(__dirname, 'data', 'trDeep.json'), JSON.stringify({ baselines, rows, ranges: { p1: '1988-2001', p2: '2002-2016' }, costBps: COMMON.costBps }));

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;
const out = (s: string): void => { process.stdout.write(s + '\n'); };
out(`configs=${rows.length} starts: P1=${r1.A.n} P2=${r2.A.n} all=${rAll.A.n}`);
out(`A    P1 CAGR ${pct(baselines.A.p1.cagr)} MDD ${pct(baselines.A.p1.mdd)} | P2 CAGR ${pct(baselines.A.p2.cagr)} MDD ${pct(baselines.A.p2.mdd)}`);
for (const m of baselines.mixes.filter(m => m.x % 20 === 0)) {
  out(`혼합${String(m.x).padStart(3)}% P1 CAGR ${pct(m.p1.cagr)} MDD ${pct(m.p1.mdd)} | P2 CAGR ${pct(m.p2.cagr)} MDD ${pct(m.p2.mdd)}`);
}
const passRows = rows.filter(r => r.pass);
out(`\n사전 기준 통과(양 구간 모두 혼합 대비 CAGR≥0 & MDD 더 얕음): ${passRows.length}/${rows.length}`);
for (const fam of ['D', 'E', 'F', 'C']) {
  const f = rows.filter(r => r.fam === fam);
  out(`  ${fam}: ${f.filter(r => r.pass).length}/${f.length} 통과 · 평균 dCAGR(P1 ${pct(f.reduce((a, r) => a + r.p1.dCagr, 0) / f.length)}, P2 ${pct(f.reduce((a, r) => a + r.p2.dCagr, 0) / f.length)}) · 평균 dMDD(P1 ${pct(f.reduce((a, r) => a + r.p1.dMdd, 0) / f.length)}, P2 ${pct(f.reduce((a, r) => a + r.p2.dMdd, 0) / f.length)})`);
}
const rank = rows.slice().sort((x, y) => Math.min(y.p1.dCagr, y.p2.dCagr) - Math.min(x.p1.dCagr, x.p2.dCagr)).slice(0, 12);
out('\n혼합 대비 CAGR 열위가 가장 작은 상위 12 (min over P1,P2 of dCAGR):');
for (const r of rank) {
  out(`${r.id.padEnd(42)} P1 dCAGR ${pct(r.p1.dCagr)} dMDD ${pct(r.p1.dMdd)} (혼합${r.p1.mixX}%) | P2 dCAGR ${pct(r.p2.dCagr)} dMDD ${pct(r.p2.dMdd)} (혼합${r.p2.mixX}%) pass=${r.pass}`);
}
