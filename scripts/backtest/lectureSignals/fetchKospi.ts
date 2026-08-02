// scripts/backtest/lectureSignals/fetchKospi.ts
// KOSPI 지수(^KS11) 캐시 채우기용 일회성 드라이버. `npx tsx` 로 실행.
import { fetchIndexSeries } from './kospiIndex';

async function main(): Promise<void> {
  const symbols = ['^KS11', '069500.KS']; // 주=^KS11, 대안(KODEX200)=강건성 비교용
  for (const sym of symbols) {
    const s = await fetchIndexSeries(sym, '2009-01-01', '2022-12-31', () =>
      console.log(`  [network fetch ${sym}]`)
    );
    if (s.ok) {
      console.log(
        `  OK ${sym}: ${s.dates.length}행 ${s.dates[0]}~${s.dates[s.dates.length - 1]} ` +
          `first=${s.close[0]} last=${s.close[s.close.length - 1]}`
      );
    } else {
      console.log(`  FAIL ${sym}: ${s.error}`);
    }
  }
}

main().catch((e) => {
  console.error('FETCH ERROR:', e);
  process.exit(1);
});
