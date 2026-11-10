// 명세 §10 1차 결과 재현 점검(수동 실행): npx tsx scripts/backtest/spxDipBuy/verifySpec.ts
import { loadRaw, toSeries } from './buildSeries';
import { prepare, runSweep, defaultStrategies, DEFAULT_COMMON } from './engine';

const b = loadRaw();
for (const cashMode of [{ mode: 'none' as const, fixed: 0 }, { mode: 'fixed' as const, fixed: 3 }]) {
  const p = prepare(toSeries(b, 'price', cashMode));
  const strats = defaultStrategies(50);
  const r = runSweep(p, strats, DEFAULT_COMMON, { stepMonths: 12, firstDate: '1965-01-01', lastDate: '2014-12-31', horizonYears: 10, allowIncomplete: false });
  process.stdout.write(`\n== cash ${cashMode.mode} ${cashMode.fixed}% · starts=${r.starts.length}\n`);
  r.summaries.forEach((s, k) => {
    process.stdout.write(
      `${strats[k].label.padEnd(22)} final중앙 ${s.finalMedian.toFixed(1)}  CAGR중앙 ${(s.cagrMedian * 100).toFixed(2)}%  MDD중앙 ${(s.mddMedian * 100).toFixed(1)}%  MDD최악 ${(s.mddWorst * 100).toFixed(1)}%  A승률 ${(s.beatBaseRate * 100).toFixed(0)}%  첫매수일 ${s.firstBuyDaysMedian}  전액투입률 ${(s.fullInvestRate * 100).toFixed(0)}%  종료현금중앙 ${s.endCashPctMedian.toFixed(1)}%\n`
    );
  });
  const cWins = r.runs[2].filter((x, k) => x.finalValue > r.runs[0][k].finalValue).length;
  process.stdout.write(`C beats A: ${cWins}/${r.starts.length}\n`);
}
