// scripts/backtest/holdingsTurtleCycle/independentVerify.ts
// CLI — 엔진(engine.ts/data.ts)을 전혀 import하지 않는 독립 재계산으로 SLV·GLD V1 경로를 교차검증한다.
// §재검증 과제2: "지금 보유 중인데도 B&H가 압도적으로 유리하다고 나온 결과가 버그 때문인지" 확인.
//
// 설계: 이 파일은 ATR·채널·상태기계·체결 규약을 처음부터 다시 손으로 구현한다(같은 함수 재사용 금지 —
// 재사용하면 "같은 버그를 두 번 계산"할 뿐이라 교차검증 의미가 없다). engine.ts와 값이 일치하면
// 버그가 없다는 강한 증거, 불일치하면 최소 한쪽에 결함이 있다는 뜻이다.
//
// 사용법: npx tsx scripts/backtest/holdingsTurtleCycle/independentVerify.ts

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildSecurity } from './data';
import { simulateCell, isSkip, VariantRules } from './engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');

interface RawSeries {
  dates: string[];
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
  ok: boolean;
}

function readRaw(symbol: string): RawSeries {
  const f = path.join(CACHE_DIR, `${symbol}.json`);
  if (!existsSync(f)) throw new Error(`캐시 없음: ${symbol}`);
  return JSON.parse(readFileSync(f, 'utf-8')) as RawSeries;
}

// ── 1) 독립 데이터 정제 (classifyBar 미사용 — 직접 재구현) ─────────────────────
interface CleanBar { date: string; o: number; h: number; l: number; c: number }

function cleanBars(raw: RawSeries): CleanBar[] {
  const out: CleanBar[] = [];
  for (let i = 0; i < raw.dates.length; i++) {
    const o = raw.open[i], h = raw.high[i], l = raw.low[i], c = raw.close[i];
    if (o === null || h === null || l === null || c === null) continue;
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    if (!(l <= o && o <= h && l <= c && c <= h)) continue; // OHLC 관계 위반 제외
    out.push({ date: raw.dates[i], o, h, l, c });
  }
  return out;
}

// ── 2) 독립 ATR(Wilder, period=20) — calculateATR 미사용, 직접 재구현 ───────────
function independentATR(bars: readonly CleanBar[], period: number): (number | null)[] {
  const n = bars.length;
  const atr: (number | null)[] = new Array(n).fill(null);
  const tr: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const h = bars[i].h, l = bars[i].l, pc = bars[i - 1].c;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (n < period + 1) return atr;
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i] as number;
  let cur = sum / period;
  atr[period] = cur;
  for (let i = period + 1; i < n; i++) {
    cur = (cur * (period - 1) + (tr[i] as number)) / period;
    atr[i] = cur;
  }
  return atr;
}

// ── 3) 독립 채널(현재봉 제외 rolling max/min) — data.ts의 rollingExcludingCurrent 미사용 ──
function independentChannel(values: readonly number[], lookback: number, mode: 'max' | 'min'): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - lookback);
    if (start >= i) { out[i] = null; continue; }
    let acc = mode === 'max' ? -Infinity : Infinity;
    for (let k = start; k < i; k++) {
      const v = values[k];
      if (mode === 'max') { if (v > acc) acc = v; } else { if (v < acc) acc = v; }
    }
    out[i] = acc;
  }
  return out;
}

// ── 4) 독립 상태기계 시뮬레이션 (engine.simulateCell 미사용 — 처음부터 재구현) ──
interface IndependentResult {
  bhFinalRatio: number;
  turtleFinalRatio: number;
  fills: { date: string; kind: 'buy' | 'sell'; reason: string; price: number }[];
}

function independentSimulate(
  bars: readonly CleanBar[],
  startIdx: number,
  rules: { entryLookback: number; exitLookback: number; atrPeriod: number; stopMultipleN: number },
  costMultiplier: number,
  oneWayRate: number
): IndependentResult {
  const highs = bars.map(b => b.h);
  const lows = bars.map(b => b.l);
  const atr = independentATR(bars, rules.atrPeriod);
  const hiCh = independentChannel(highs, rules.entryLookback, 'max');
  const loCh = independentChannel(lows, rules.exitLookback, 'min');
  const n = bars.length;
  const startClose = bars[startIdx].c;

  const bhFinal = bars[n - 1].c / startClose;

  type State = 'HOLD_INITIAL' | 'HOLD_REENTERED' | 'CASH';
  let state: State = 'HOLD_INITIAL';
  let capitalRatio = 1;
  let refPrice = startClose;
  let stopPrice: number | null = null;
  let pending: { kind: 'buy' | 'sell'; reason: string; signalIdx: number; fillIdx: number } | null = null;
  const fills: IndependentResult['fills'] = [];

  const buyRate = oneWayRate * costMultiplier;
  const sellRate = oneWayRate * costMultiplier; // SLV/GLD: USD, 비KR, 비코인 → 매도세 없음

  for (let i = startIdx; i < n; i++) {
    if (pending && pending.fillIdx === i) {
      const openPx = bars[i].o;
      if (pending.kind === 'sell') {
        capitalRatio = capitalRatio * (openPx / refPrice) * (1 - sellRate);
        state = 'CASH'; stopPrice = null;
      } else {
        capitalRatio = capitalRatio * (1 - buyRate);
        refPrice = openPx;
        const nAtSignal = atr[pending.signalIdx];
        stopPrice = nAtSignal !== null ? openPx - rules.stopMultipleN * nAtSignal : null;
        state = 'HOLD_REENTERED';
      }
      fills.push({ date: bars[i].date, kind: pending.kind, reason: pending.reason, price: openPx });
      pending = null;
    }

    const closeToday = bars[i].c;
    if (!pending && i + 1 < n) {
      if (state === 'HOLD_REENTERED' && stopPrice !== null && closeToday <= stopPrice) {
        pending = { kind: 'sell', reason: 'stop', signalIdx: i, fillIdx: i + 1 };
      } else if (state !== 'CASH') {
        const loVal = loCh[i];
        if (loVal !== null && closeToday <= loVal) pending = { kind: 'sell', reason: 'exit', signalIdx: i, fillIdx: i + 1 };
      } else {
        const hiVal = hiCh[i];
        if (hiVal !== null && closeToday >= hiVal) pending = { kind: 'buy', reason: 'entry', signalIdx: i, fillIdx: i + 1 };
      }
    }
  }

  const turtleFinal = state === 'CASH' ? capitalRatio : capitalRatio * (bars[n - 1].c / refPrice);
  return { bhFinalRatio: bhFinal, turtleFinalRatio: turtleFinal, fills };
}

// ── 5) 엔진 경로(실제 코드) — 비교 기준 ─────────────────────────────────────────
function engineSimulate(bars: readonly CleanBar[], startDateISO: string, rules: VariantRules, costMultiplier: number) {
  const sec = buildSecurity({
    ticker: 'X', name: 'X', assetClass: '실물자산', currency: 'USD', isCryptoTicker: false, isKrEtf: false,
    raw: {
      symbol: 'X', ok: true,
      dates: bars.map(b => b.date), open: bars.map(b => b.o), high: bars.map(b => b.h), low: bars.map(b => b.l), close: bars.map(b => b.c),
    },
    atrPeriod: rules.atrPeriod, lookbacks: [rules.entryLookback, rules.exitLookback],
  });
  const idx = sec.ownDates.indexOf(startDateISO);
  if (idx < 0) return null;
  const r = simulateCell(sec, idx, rules, costMultiplier);
  if (isSkip(r)) return null;
  return r;
}

// ── 실행 ────────────────────────────────────────────────────────────────────
const V1: VariantRules = { id: 'V1', name: '표준', entryLookback: 55, exitLookback: 20, atrPeriod: 20, stopMultipleN: 2 };
const START_DATES = ['2015-01', '2020-01', '2024-01', '2025-06'];
const TICKERS = ['SLV', 'GLD'];
const COST_MULT = 1; // 기본 비용단계

function firstTradingDayOfMonth(bars: readonly CleanBar[], yyyymm: string): string | null {
  for (const b of bars) if (b.date.startsWith(yyyymm)) return b.date;
  return null;
}

let mismatches = 0;
const rows: string[] = [];
rows.push('| 티커 | 시작월 | 시작일 | B&H(독립) | B&H(엔진) | 터틀(독립) | 터틀(엔진) | 차이(터틀) | 일치 |');
rows.push('|---|---|---|---|---|---|---|---|---|');

for (const ticker of TICKERS) {
  const raw = readRaw(ticker);
  const bars = cleanBars(raw);
  for (const yyyymm of START_DATES) {
    const startDate = firstTradingDayOfMonth(bars, yyyymm);
    if (!startDate) { console.log(`${ticker} ${yyyymm}: 데이터 없음(스킵)`); continue; }
    const startIdx = bars.findIndex(b => b.date === startDate);
    const ind = independentSimulate(bars, startIdx, V1, COST_MULT, 0.001);
    const eng = engineSimulate(bars, startDate, V1, COST_MULT);
    if (!eng) { console.log(`${ticker} ${yyyymm}: 엔진 측 스킵(워밍업 미충족) — 독립계산도 참고용으로만 출력`); continue; }
    const diff = Math.abs(ind.turtleFinalRatio - eng.turtleFinalRatio);
    const match = diff < 1e-6;
    if (!match) mismatches++;
    rows.push(
      `| ${ticker} | ${yyyymm} | ${startDate} | ${ind.bhFinalRatio.toFixed(6)} | ${eng.bhFinalRatio.toFixed(6)} | ` +
      `${ind.turtleFinalRatio.toFixed(6)} | ${eng.turtleFinalRatio.toFixed(6)} | ${diff.toExponential(3)} | ${match ? '✓' : '✗ 불일치'} |`
    );
    console.log(`${ticker} ${yyyymm} (start=${startDate}): 독립=${ind.turtleFinalRatio.toFixed(6)} 엔진=${eng.turtleFinalRatio.toFixed(6)} diff=${diff.toExponential(3)} ${match ? 'OK' : 'MISMATCH'}`);
    console.log(`  독립 체결 로그: ${ind.fills.map(f => `${f.date} ${f.kind}/${f.reason}@${f.price}`).join(' → ') || '(체결 없음)'}`);
    console.log(`  엔진 체결 로그: ${eng.fills.map(f => `${f.date} ${f.kind}/${f.reason}@${f.price}`).join(' → ') || '(체결 없음)'}`);
  }
}

console.log(`\n${'='.repeat(80)}`);
console.log(mismatches === 0 ? '전부 일치 — 엔진 버그 증거 없음.' : `불일치 ${mismatches}건 — 엔진 또는 독립계산 중 하나에 결함 가능성. 위 체결 로그로 원인 추적 필요.`);
console.log('\n마크다운 표:\n');
console.log(rows.join('\n'));
