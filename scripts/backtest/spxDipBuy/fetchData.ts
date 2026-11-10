// scripts/backtest/spxDipBuy/fetchData.ts
// S&P500 전고점 대비 하락 분할매수 연구용 데이터 수집(앱/백엔드 무접촉).
// ^GSPC(가격지수, 1950~), ^SP500TR(총수익지수, 1988~), ^IRX(13주 T-bill 연율%, 현금이자용).
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchAdjSeries } from '../sectorRotation/lib/yahooData';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'data');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const end = new Date().toISOString().slice(0, 10);
  const out: Record<string, { dates: string[]; close: number[] }> = {};
  for (const sym of ['^GSPC', '^SP500TR', '^IRX']) {
    const s = await fetchAdjSeries(sym, '1950-01-01', end);
    if (!s.ok) throw new Error(`${sym}: ${s.error}`);
    const dates: string[] = [];
    const close: number[] = [];
    // ^GSPC/^SP500TR 은 지수 자체(rawClose)를 사용 — adjclose 는 지수에서 동일하나 안전하게 raw 우선.
    s.dates.forEach((d, i) => {
      const v = sym === '^IRX' ? s.rawClose[i] : s.rawClose[i];
      if (v != null && isFinite(v)) { dates.push(d); close.push(v); }
    });
    out[sym] = { dates, close };
    process.stdout.write(`${sym}: ${dates.length} rows ${dates[0]}..${dates[dates.length - 1]}\n`);
  }
  writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), series: out }));
}
main().catch(e => { process.stderr.write(String(e) + '\n'); process.exit(1); });
