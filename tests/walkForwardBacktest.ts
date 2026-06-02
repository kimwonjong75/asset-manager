// tests/walkForwardBacktest.ts
// 클라이맥스 탑 / 디스트리뷰션 룰의 워크포워드(walk-forward) 백테스트
//
// 목적: 임계값 튜닝 시 오버피팅을 막기 위해, 학습 구간(train)에서 정한 임계값을
//       그 다음 미지 구간(test)에 적용해 신호 발생률·드로다운·거짓신호율을 측정한다.
//
// 사용 예:
//   npm run backtest -- --ticker 005930 --from 2023-01-01 --to 2026-06-01
//   npm run backtest -- --ticker SI=F --proxy SLV --from 2024-01-01 --to 2026-06-01
//   npm run backtest -- --fixture tests/fixtures/sample.json
//
// 주의 (오버피팅 가드):
//   - 단일 사건(예: 2026-01 은 폭락)에 임계값을 맞추지 말 것.
//   - 학습 구간(train) 결과만 보고 임계값을 채택하지 말고, 반드시 test 구간 성능까지 확인할 것.
//   - 임계값 grid는 의도적으로 넓게 설정 — "현재 데이터에서 잘 작동"이 아닌 "체제 변화에도 견딤"이 목적.
//
// 본 스크립트는 CI 미통합 — 수동 실행용 진단 도구.

import {
  calculateATR,
  calculate52WeekHigh,
  calculate52WeekMaxVolume,
  calculateSlopeRatio,
} from '../utils/maCalculations';
import { CLOUD_RUN_BASE_URL } from '../constants/api';

interface OHLCVPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

interface BacktestArgs {
  ticker?: string;
  proxy?: string;           // 거래량 프록시 ticker (예: SI=F → SLV)
  from?: string;
  to?: string;
  fixture?: string;
  // 워크포워드 윈도우
  trainDays?: number;
  testDays?: number;
  stepDays?: number;
}

// 임계값 grid (오버피팅 방지 차원에서 의도적으로 거친 격자)
const CLIMAX_SLOPE_GRID = [2, 3, 4, 5];
const CLIMAX_ATR_GRID = [2.0, 2.5, 3.0];
const DISTRIBUTION_WINDOW_GRID = [10, 13, 20];
const DISTRIBUTION_VOL_RATIO_GRID = [1.3, 1.5, 1.8];
const DISTRIBUTION_THRESHOLD_GRID = [4, 5, 6];

interface ThresholdSet {
  climaxSlope: number;
  climaxAtr: number;
  distWindow: number;
  distVolRatio: number;
  distThreshold: number;
}

interface SignalResult {
  date: string;
  climaxFlags: number;
  distributionCount: number;
  tier: 'red' | 'amber' | 'blue' | null;
}

function parseArgs(): BacktestArgs {
  const args: BacktestArgs = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    (args as Record<string, string | number>)[k] = ['trainDays', 'testDays', 'stepDays'].includes(k) ? Number(v) : v;
  }
  args.trainDays ??= 180;
  args.testDays ??= 60;
  args.stepDays ??= 20;
  return args;
}

/** Cloud Run /history에서 OHLCV 시계열 fetch */
async function fetchOHLCV(ticker: string, from: string, to: string): Promise<OHLCVPoint[]> {
  const res = await fetch(`${CLOUD_RUN_BASE_URL}/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: [ticker], start_date: from, end_date: to }),
  });
  if (!res.ok) throw new Error(`fetch failed ${res.status}`);
  const json = (await res.json()) as Record<string, {
    data?: Record<string, number>;
    open?: Record<string, number>;
    high?: Record<string, number>;
    low?: Record<string, number>;
    volume?: Record<string, number>;
  }>;
  const entry = json[ticker];
  if (!entry?.data) throw new Error(`no data for ${ticker}`);
  const dates = Object.keys(entry.data).sort();
  return dates.map(d => ({
    date: d,
    close: entry.data![d],
    open: entry.open?.[d] ?? null,
    high: entry.high?.[d] ?? null,
    low: entry.low?.[d] ?? null,
    volume: entry.volume?.[d] ?? null,
  }));
}

/** 픽스처 JSON 로드 */
async function loadFixture(path: string): Promise<OHLCVPoint[]> {
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(path, 'utf-8');
  return JSON.parse(raw);
}

/** 특정 시점(i)에서 거래량 시계열 — 프록시가 있으면 프록시 사용 */
function getVolumeAt(asset: OHLCVPoint[], proxy: OHLCVPoint[] | null, i: number): number | null {
  if (proxy) {
    const date = asset[i].date;
    const match = proxy.find(p => p.date === date);
    return match?.volume ?? null;
  }
  return asset[i].volume;
}

/** 특정 시점 i 에서 신호 평가 (룩어헤드 편향 금지 — i까지의 데이터만 사용) */
function evaluateSignalAt(
  asset: OHLCVPoint[],
  proxy: OHLCVPoint[] | null,
  i: number,
  thr: ThresholdSet
): SignalResult {
  const slice = asset.slice(0, i + 1);
  const closes = slice.map(p => p.close);
  const highs = slice.map(p => p.high);
  const lows = slice.map(p => p.low);
  const volumes = Array.from({ length: i + 1 }, (_, j) => getVolumeAt(asset, proxy, j));

  // 클라이맥스 플래그
  let climaxFlags = 0;
  const slopeRatio = calculateSlopeRatio(closes, 10, 60);
  if (typeof slopeRatio === 'number' && slopeRatio >= thr.climaxSlope) climaxFlags++;

  const atrSeries = calculateATR(highs, lows, closes, 14);
  const atr14 = atrSeries[atrSeries.length - 1];
  const todayH = highs[highs.length - 1];
  const todayL = lows[lows.length - 1];
  if (typeof atr14 === 'number' && atr14 > 0 && typeof todayH === 'number' && typeof todayL === 'number') {
    if ((todayH - todayL) / atr14 >= thr.climaxAtr) climaxFlags++;
  }

  const high52w = calculate52WeekHigh(closes);
  const volMax = calculate52WeekMaxVolume(volumes);
  const todayClose = closes[closes.length - 1];
  const todayVol = volumes[volumes.length - 1];
  if (
    typeof high52w === 'number' && todayClose >= high52w - 1e-9 &&
    typeof volMax === 'number' && typeof todayVol === 'number' && todayVol >= volMax - 1e-9
  ) climaxFlags++;

  // 디스트리뷰션 카운트
  const window = Math.min(thr.distWindow, slice.length);
  let distributionCount = 0;
  for (let j = slice.length - window; j < slice.length; j++) {
    if (j < 50) continue; // 50일 평균 산출 불가
    // 50일 trailing 평균 거래량 (j 미포함)
    let sum = 0;
    let cnt = 0;
    for (let k = j - 50; k < j; k++) {
      const v = volumes[k];
      if (typeof v === 'number') { sum += v; cnt++; }
    }
    if (cnt < 40) continue;
    const avg = sum / cnt;
    const v = volumes[j];
    if (typeof v !== 'number' || avg <= 0 || v / avg < thr.distVolRatio) continue;

    const o = asset[j].open;
    const h = asset[j].high;
    const l = asset[j].low;
    const c = asset[j].close;
    const pc = j > 0 ? asset[j - 1].close : null;
    const isBearish = typeof o === 'number' ? c < o : false;
    const isLowerHalfClose = typeof h === 'number' && typeof l === 'number' && h > l
      ? (c - l) / (h - l) < 0.5 : false;
    const changeRatio = typeof pc === 'number' && pc > 0 ? (c - pc) / pc : 0;
    if (isBearish || isLowerHalfClose || changeRatio < 0.002) {
      distributionCount++;
    }
  }

  // 티어
  let tier: 'red' | 'amber' | 'blue' | null = null;
  if (climaxFlags >= 2 && distributionCount >= thr.distThreshold) tier = 'red';
  else if (climaxFlags >= 1 && distributionCount >= 3 && distributionCount <= 4) tier = 'amber';

  return { date: asset[i].date, climaxFlags, distributionCount, tier };
}

interface WindowMetrics {
  signalCount: number;
  redCount: number;
  amberCount: number;
  /** 신호 후 30거래일 평균 드로다운 (음수) — 신호의 의미 검증 */
  avgDrawdown30d: number;
  /** 거짓 신호율: RED 신호 후 60거래일 내 신고가를 갱신한 비율 */
  falsePositiveRate: number;
}

function evaluateWindow(
  asset: OHLCVPoint[],
  proxy: OHLCVPoint[] | null,
  startIdx: number,
  endIdx: number,
  thr: ThresholdSet
): WindowMetrics {
  let signalCount = 0;
  let redCount = 0;
  let amberCount = 0;
  const drawdowns: number[] = [];
  let redTotal = 0;
  let falsePositives = 0;

  for (let i = startIdx; i <= endIdx; i++) {
    if (i < 60) continue;
    const sig = evaluateSignalAt(asset, proxy, i, thr);
    if (sig.tier === 'red' || sig.tier === 'amber') {
      signalCount++;
      if (sig.tier === 'red') redCount++;
      if (sig.tier === 'amber') amberCount++;

      // 신호 후 30거래일 드로다운
      const endCheck = Math.min(asset.length - 1, i + 30);
      if (endCheck > i) {
        const signalPrice = asset[i].close;
        let minPrice = signalPrice;
        for (let k = i + 1; k <= endCheck; k++) {
          if (asset[k].close < minPrice) minPrice = asset[k].close;
        }
        drawdowns.push((minPrice - signalPrice) / signalPrice);
      }

      // RED 신호 거짓 신호율
      if (sig.tier === 'red') {
        redTotal++;
        const peakCheck = Math.min(asset.length - 1, i + 60);
        const signalPrice = asset[i].close;
        let maxAfter = signalPrice;
        for (let k = i + 1; k <= peakCheck; k++) {
          if (asset[k].close > maxAfter) maxAfter = asset[k].close;
        }
        if (maxAfter > signalPrice * 1.02) falsePositives++; // 2% 이상 신고가 갱신 = 거짓 RED
      }
    }
  }

  const avgDrawdown30d = drawdowns.length > 0
    ? drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length
    : 0;
  const falsePositiveRate = redTotal > 0 ? falsePositives / redTotal : 0;

  return { signalCount, redCount, amberCount, avgDrawdown30d, falsePositiveRate };
}

/** 워크포워드: train에서 최적 임계값 선택, test에서 검증 */
function walkForward(
  asset: OHLCVPoint[],
  proxy: OHLCVPoint[] | null,
  trainDays: number,
  testDays: number,
  stepDays: number
): void {
  console.log(`\n[Walk-Forward] series=${asset.length} train=${trainDays} test=${testDays} step=${stepDays}`);
  console.log('window | best_thr_summary | train_dd | test_dd | test_signals | test_fp');

  let trainStart = 0;
  let trainEnd = trainStart + trainDays;
  let windowIdx = 0;

  while (trainEnd + testDays < asset.length) {
    const testStart = trainEnd + 1;
    const testEnd = testStart + testDays;

    // 임계값 grid 평가 (train 구간)
    let bestThr: ThresholdSet | null = null;
    let bestScore = -Infinity;
    for (const cs of CLIMAX_SLOPE_GRID) {
      for (const ca of CLIMAX_ATR_GRID) {
        for (const dw of DISTRIBUTION_WINDOW_GRID) {
          for (const dvr of DISTRIBUTION_VOL_RATIO_GRID) {
            for (const dt of DISTRIBUTION_THRESHOLD_GRID) {
              const thr: ThresholdSet = { climaxSlope: cs, climaxAtr: ca, distWindow: dw, distVolRatio: dvr, distThreshold: dt };
              const m = evaluateWindow(asset, proxy, trainStart, trainEnd, thr);
              // 점수: 신호당 평균 드로다운이 음수일수록(=매도가 의미있음) 좋고,
              //       신호 수가 너무 많거나 적으면 페널티
              if (m.signalCount === 0) continue;
              const idealCount = Math.floor(trainDays / 30); // train 기간 대비 한 달에 1회 정도
              const countPenalty = -Math.abs(m.signalCount - idealCount) * 0.5;
              const score = -m.avgDrawdown30d * 100 + countPenalty - m.falsePositiveRate * 20;
              if (score > bestScore) {
                bestScore = score;
                bestThr = thr;
              }
            }
          }
        }
      }
    }

    if (bestThr) {
      const trainMetrics = evaluateWindow(asset, proxy, trainStart, trainEnd, bestThr);
      const testMetrics = evaluateWindow(asset, proxy, testStart, testEnd, bestThr);
      const summary = `cs=${bestThr.climaxSlope} ca=${bestThr.climaxAtr} dw=${bestThr.distWindow} dvr=${bestThr.distVolRatio} dt=${bestThr.distThreshold}`;
      console.log(
        `#${windowIdx} | ${summary} | ${(trainMetrics.avgDrawdown30d * 100).toFixed(2)}% | ` +
        `${(testMetrics.avgDrawdown30d * 100).toFixed(2)}% | ${testMetrics.signalCount} (R${testMetrics.redCount}/A${testMetrics.amberCount}) | ` +
        `fp ${(testMetrics.falsePositiveRate * 100).toFixed(1)}%`
      );
    } else {
      console.log(`#${windowIdx} | no signal in train`);
    }

    trainStart += stepDays;
    trainEnd += stepDays;
    windowIdx++;
  }
}

async function main() {
  const args = parseArgs();

  let asset: OHLCVPoint[];
  let proxy: OHLCVPoint[] | null = null;

  if (args.fixture) {
    asset = await loadFixture(args.fixture);
  } else if (args.ticker && args.from && args.to) {
    console.log(`Fetching ${args.ticker} from ${args.from} to ${args.to}...`);
    asset = await fetchOHLCV(args.ticker, args.from, args.to);
    if (args.proxy) {
      console.log(`Fetching proxy ${args.proxy}...`);
      proxy = await fetchOHLCV(args.proxy, args.from, args.to);
    }
  } else {
    console.error('Usage: npm run backtest -- --ticker <T> --from <YYYY-MM-DD> --to <YYYY-MM-DD> [--proxy <T>]');
    console.error('   or: npm run backtest -- --fixture <path>');
    process.exit(1);
  }

  console.log(`Loaded ${asset.length} days. OHLCV coverage: ` +
    `open=${asset.filter(p => p.open !== null).length}, ` +
    `high=${asset.filter(p => p.high !== null).length}, ` +
    `low=${asset.filter(p => p.low !== null).length}, ` +
    `vol=${asset.filter(p => p.volume !== null).length}`);

  if (proxy) {
    console.log(`Proxy ${args.proxy}: ${proxy.length} days, vol coverage=${proxy.filter(p => p.volume !== null).length}`);
    console.log('\n=== WITH proxy volume ===');
    walkForward(asset, proxy, args.trainDays!, args.testDays!, args.stepDays!);
    console.log('\n=== WITHOUT proxy (own volume) ===');
    walkForward(asset, null, args.trainDays!, args.testDays!, args.stepDays!);
  } else {
    walkForward(asset, null, args.trainDays!, args.testDays!, args.stepDays!);
  }
}

main().catch(err => {
  console.error('Backtest error:', err);
  process.exit(1);
});
