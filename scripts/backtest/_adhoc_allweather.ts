// 일회성 백테스트 스크립트 — 사용자의 4단계 자산배분(25.01/25.07/26.01/26.07) 검증용.
// 완료 후 삭제 예정 (레포에 커밋하지 않음).
import { fetchManySymbols } from './lib/fetchHistory';
import { buildUnionCalendar, alignToCalendar } from './lib/calendar';
import { cagr, maxDrawdown, annualReturns, EquityPoint } from './lib/metrics';

type Currency = 'KRW' | 'USD' | 'JPY';

interface Leg {
  label: string;
  symbol: string;
  weightPct: number;
  currency: Currency;
  note?: string;
  assetClass: string; // 주식/채권/실물자산/현금
}

const START = '2024-12-01';
const END = '2026-07-12';

const PERIODS: { name: string; startTarget: string; legs: Leg[] }[] = [
  {
    name: 'P1 (2025-01 ~ 2025-06, 실제 초기매수)',
    startTarget: '2025-01-02',
    legs: [
      { label: 'KODEX200', symbol: '^KS200', weightPct: 2, currency: 'KRW', assetClass: '주식' },
      { label: '소형성장가치10팩터(KR,AVUV프록시)', symbol: 'AVUV', weightPct: 3, currency: 'USD', assetClass: '주식' },
      { label: 'ACE WideMoat', symbol: 'MOAT', weightPct: 4, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX나스닥100', symbol: 'QQQ', weightPct: 6, currency: 'USD', assetClass: '주식' },
      { label: 'TIGER니케이225', symbol: '^N225', weightPct: 1, currency: 'JPY', assetClass: '주식' },
      { label: 'KODEX차이나CSI300(반)', symbol: 'ASHR', weightPct: 2, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX차이나항셍테크(반)', symbol: 'KTEC', weightPct: 2, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX인도Nifty50', symbol: 'INDA', weightPct: 3, currency: 'USD', assetClass: '주식' },
      { label: 'RISE유로스탁스50(H)', symbol: 'VGK', weightPct: 2, currency: 'USD', assetClass: '주식' },
      { label: 'RISE KIS국고채30년', symbol: 'TLT', weightPct: 12.5, currency: 'USD', assetClass: '채권' },
      { label: 'PLUS미국채30년액티브', symbol: 'TLT', weightPct: 12.5, currency: 'USD', assetClass: '채권' },
      { label: 'ACE KRX금현물', symbol: 'GLD', weightPct: 18, currency: 'USD', assetClass: '실물자산' },
      { label: '은(TIGER)', symbol: 'SLV', weightPct: 4, currency: 'USD', assetClass: '실물자산' },
      { label: '업비트 USDT전략', symbol: 'KRW=X', weightPct: 28, currency: 'USD', assetClass: '현금' },
    ],
  },
  {
    name: 'P2 (2025-07 ~ 2025-12)',
    startTarget: '2025-07-01',
    legs: [
      { label: 'KODEX200', symbol: '^KS200', weightPct: 12.5, currency: 'KRW', assetClass: '주식' },
      { label: 'ACE WideMoat(가치주)', symbol: 'MOAT', weightPct: 8.5, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX나스닥100(성장주)', symbol: 'QQQ', weightPct: 8.5, currency: 'USD', assetClass: '주식' },
      { label: 'TIGER니케이225', symbol: '^N225', weightPct: 8, currency: 'JPY', assetClass: '주식' },
      { label: 'KODEX차이나CSI300', symbol: 'ASHR', weightPct: 6.25, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX차이나항셍테크', symbol: 'KTEC', weightPct: 6.25, currency: 'USD', assetClass: '주식' },
      { label: 'RISE KIS국고채30년', symbol: 'TLT', weightPct: 10, currency: 'USD', assetClass: '채권' },
      { label: 'PLUS미국채30년액티브', symbol: 'TLT', weightPct: 7, currency: 'USD', assetClass: '채권' },
      { label: '현금전략(USDT-USD스위칭)', symbol: 'KRW=X', weightPct: 8, currency: 'USD', assetClass: '현금' },
      { label: 'ACE KRX금현물', symbol: 'GLD', weightPct: 18, currency: 'USD', assetClass: '실물자산' },
      { label: '은', symbol: 'SLV', weightPct: 7, currency: 'USD', assetClass: '실물자산' },
    ],
  },
  {
    name: 'P3 (2026-01 ~ 현재)',
    startTarget: '2026-01-02',
    legs: [
      { label: 'KODEX200', symbol: '^KS200', weightPct: 10, currency: 'KRW', assetClass: '주식' },
      { label: 'KIWOOM미국원유에너지(가치주)', symbol: 'XLE', weightPct: 5, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX나스닥100(성장주)', symbol: 'QQQ', weightPct: 5, currency: 'USD', assetClass: '주식' },
      { label: '이스라엘주식', symbol: 'EIS', weightPct: 5, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX차이나CSI300', symbol: 'ASHR', weightPct: 8, currency: 'USD', assetClass: '주식' },
      { label: 'KODEX차이나항셍테크', symbol: 'KTEC', weightPct: 4, currency: 'USD', assetClass: '주식' },
      { label: '칠레주식', symbol: 'ECH', weightPct: 5, currency: 'USD', assetClass: '주식' },
      { label: '브라질주식', symbol: 'EWZ', weightPct: 4, currency: 'USD', assetClass: '주식' },
      { label: '인도네시아주식', symbol: 'EIDO', weightPct: 4, currency: 'USD', assetClass: '주식' },
      { label: '한국채권(RISE)', symbol: 'TLT', weightPct: 8, currency: 'USD', assetClass: '채권' },
      { label: '미국채권(PLUS)', symbol: 'TLT', weightPct: 9, currency: 'USD', assetClass: '채권' },
      { label: 'GRVT(정의불명)', symbol: '__UNKNOWN__', weightPct: 8, currency: 'USD', assetClass: '채권' },
      { label: '금', symbol: 'GLD', weightPct: 12, currency: 'USD', assetClass: '실물자산' },
      { label: '은', symbol: 'SLV', weightPct: 6, currency: 'USD', assetClass: '실물자산' },
      { label: '구리', symbol: 'HG=F', weightPct: 3, currency: 'USD', assetClass: '실물자산' },
      { label: '우라늄', symbol: 'URA', weightPct: 4, currency: 'USD', assetClass: '실물자산' },
    ],
  },
];

async function main() {
  const allSymbols = new Set<string>();
  for (const p of PERIODS) for (const l of p.legs) if (l.symbol !== '__UNKNOWN__') allSymbols.add(l.symbol);
  allSymbols.add('KRW=X');
  allSymbols.add('JPYKRW=X');

  console.log('=== fetching ===');
  const seriesMap = await fetchManySymbols(Array.from(allSymbols), START, END);
  const calendar = buildUnionCalendar(Array.from(seriesMap.values()), START, END);
  const aligned = new Map<string, ReturnType<typeof alignToCalendar>>();
  for (const [sym, s] of seriesMap) aligned.set(sym, alignToCalendar(s, calendar));
  const usdKrw = aligned.get('KRW=X')!.close;
  const jpyKrw = aligned.get('JPYKRW=X')!.close;

  function fxFor(currency: Currency, t: number): number {
    if (currency === 'KRW') return 1;
    if (currency === 'USD') return usdKrw[t] ?? 1;
    if (currency === 'JPY') return jpyKrw[t] ?? 1;
    return 1;
  }
  function priceFor(leg: Leg, t: number): number | null {
    if (leg.symbol === '__UNKNOWN__') return null;
    if (leg.symbol === 'KRW=X') return usdKrw[t];
    return aligned.get(leg.symbol)!.close[t];
  }
  function fxMultiplierFor(leg: Leg, t: number): number {
    if (leg.symbol === 'KRW=X') return 1;
    return fxFor(leg.currency, t);
  }
  function idxOf(dateTarget: string): number {
    let idx = calendar.findIndex(d => d >= dateTarget);
    if (idx === -1) idx = calendar.length - 1;
    return idx;
  }
  const periodStartIdx = PERIODS.map(p => idxOf(p.startTarget));
  const endIdx = calendar.length - 1;

  function runSim(excludeSymbols: string[]) {
    const START_CAPITAL = 100_000_000;
    let units = new Map<string, number>();
    let currentLegs: Leg[] = [];
    let totalKRW = START_CAPITAL;
    const equity: EquityPoint[] = [];
    const periodBoundaries: { name: string; startIdx: number; startVal: number; endIdx?: number; endVal?: number; excluded: string[] }[] = [];

    for (let pIdx = 0; pIdx < PERIODS.length; pIdx++) {
      const period = PERIODS[pIdx];
      const tStart = periodStartIdx[pIdx];
      const tEnd = pIdx + 1 < PERIODS.length ? periodStartIdx[pIdx + 1] - 1 : endIdx;

      if (pIdx > 0) {
        let sum = 0;
        for (const leg of currentLegs) {
          const u = units.get(leg.label) ?? 0;
          if (u === 0) continue;
          const price = priceFor(leg, tStart);
          if (typeof price === 'number') sum += u * price * fxMultiplierFor(leg, tStart);
        }
        totalKRW = sum;
      }

      const excluded: string[] = [];
      const validLegs = period.legs.filter(l => {
        if (excludeSymbols.includes(l.symbol)) { excluded.push(`${l.label}(수동제외)`); return false; }
        if (l.symbol === '__UNKNOWN__') { excluded.push(l.label); return false; }
        const p = priceFor(l, tStart);
        if (p === null || p === undefined) { excluded.push(`${l.label}(데이터없음)`); return false; }
        return true;
      });
      const totalW = validLegs.reduce((s, l) => s + l.weightPct, 0);

      units = new Map();
      for (const leg of validLegs) {
        const w = leg.weightPct / totalW;
        const price = priceFor(leg, tStart)!;
        const fx = fxMultiplierFor(leg, tStart);
        units.set(leg.label, (totalKRW * w) / (price * fx));
      }
      currentLegs = validLegs;
      periodBoundaries.push({ name: period.name, startIdx: tStart, startVal: totalKRW, excluded });

      for (let t = tStart; t <= tEnd; t++) {
        let sum = 0;
        for (const leg of currentLegs) {
          const u = units.get(leg.label) ?? 0;
          const price = priceFor(leg, t);
          if (typeof price === 'number') sum += u * price * fxMultiplierFor(leg, t);
        }
        if (sum > 0) equity.push({ date: calendar[t], value: sum });
      }
      periodBoundaries[periodBoundaries.length - 1].endIdx = tEnd;
      periodBoundaries[periodBoundaries.length - 1].endVal = equity[equity.length - 1]?.value;
    }
    return { equity, periodBoundaries };
  }

  function printSim(title: string, sim: ReturnType<typeof runSim>) {
    console.log(`\n########## ${title} ##########`);
    for (const pb of sim.periodBoundaries) {
      const ret = pb.endVal && pb.startVal ? ((pb.endVal / pb.startVal - 1) * 100).toFixed(2) : 'N/A';
      console.log(`${pb.name}: ${calendar[pb.startIdx]} ${Math.round(pb.startVal).toLocaleString()}원 → ${calendar[pb.endIdx!]} ${Math.round(pb.endVal ?? 0).toLocaleString()}원 (${ret}%)  [제외: ${pb.excluded.join(', ') || '없음'}]`);
    }
    const eq = sim.equity;
    console.log(`총수익률: ${((eq[eq.length - 1].value / 100_000_000 - 1) * 100).toFixed(2)}%`);
    console.log(`CAGR: ${(cagr(eq) * 100).toFixed(2)}%`);
    console.log(`MDD: ${(maxDrawdown(eq) * 100).toFixed(2)}%`);
    console.log('연도별:', JSON.stringify(annualReturns(eq)));
  }

  const full = runSim([]);
  printSim('전체(원본) 포트폴리오', full);

  const exGoldSilver = runSim(['GLD', 'SLV']);
  printSim('금/은 배제 포트폴리오 (가중치 나머지 종목에 비례재분배)', exGoldSilver);

  // ---- 자산군별(주식/채권/실물자산/현금) 구간별 수익률 ----
  console.log('\n########## 자산군별 구간 수익률 (가격만, 리밸런싱 가중치 무관) ##########');
  for (let pIdx = 0; pIdx < PERIODS.length; pIdx++) {
    const period = PERIODS[pIdx];
    const tStart = periodStartIdx[pIdx];
    const tEnd = pIdx + 1 < PERIODS.length ? periodStartIdx[pIdx + 1] - 1 : endIdx;
    console.log(`\n--- ${period.name} (${calendar[tStart]} ~ ${calendar[tEnd]}) ---`);

    // per-leg return
    const legReturns: { label: string; assetClass: string; weightPct: number; retPct: number | null }[] = [];
    for (const leg of period.legs) {
      if (leg.symbol === '__UNKNOWN__') { legReturns.push({ label: leg.label, assetClass: leg.assetClass, weightPct: leg.weightPct, retPct: null }); continue; }
      const p0 = priceFor(leg, tStart);
      const p1 = priceFor(leg, tEnd);
      const fx0 = fxMultiplierFor(leg, tStart);
      const fx1 = fxMultiplierFor(leg, tEnd);
      if (typeof p0 === 'number' && typeof p1 === 'number' && p0 > 0) {
        const ret = ((p1 * fx1) / (p0 * fx0) - 1) * 100;
        legReturns.push({ label: leg.label, assetClass: leg.assetClass, weightPct: leg.weightPct, retPct: ret });
      } else {
        legReturns.push({ label: leg.label, assetClass: leg.assetClass, weightPct: leg.weightPct, retPct: null });
      }
    }
    for (const lr of legReturns) {
      console.log(`  [${lr.assetClass}] ${lr.label} (${lr.weightPct}%): ${lr.retPct === null ? 'N/A' : lr.retPct.toFixed(2) + '%'}`);
    }

    // asset-class weighted return (weight-normalized within class, using only legs with valid return)
    const classes = Array.from(new Set(period.legs.map(l => l.assetClass)));
    console.log('  == 자산군 합산(가중평균) ==');
    for (const cls of classes) {
      const members = legReturns.filter(lr => lr.assetClass === cls && lr.retPct !== null);
      const totalW = members.reduce((s, m) => s + m.weightPct, 0);
      if (totalW === 0) { console.log(`  ${cls}: N/A`); continue; }
      const weighted = members.reduce((s, m) => s + (m.weightPct / totalW) * (m.retPct as number), 0);
      const classWeightOfPortfolio = period.legs.filter(l => l.assetClass === cls).reduce((s, l) => s + l.weightPct, 0);
      console.log(`  ${cls} (포트폴리오 내 비중 ${classWeightOfPortfolio}%): ${weighted.toFixed(2)}%`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
