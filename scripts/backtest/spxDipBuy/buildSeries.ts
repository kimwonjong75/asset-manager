// scripts/backtest/spxDipBuy/buildSeries.ts
// raw.json → 엔진 입력(SpxSeries). 노드(검증)와 페이지 빌드가 공유한다.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SpxSeries } from './engine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Raw {
  fetchedAt: string;
  series: Record<string, { dates: string[]; close: number[] }>;
}

export interface BuiltSeries {
  fetchedAt: string;
  dates: string[];
  px: number[];
  /** 총수익지수(^SP500TR) — 1988 이전은 NaN */
  tr: number[];
  /** 13주 T-bill 연이율(%) 이전값 이월, 없으면 0 */
  irx: number[];
}

export function loadRaw(): BuiltSeries {
  const raw = JSON.parse(readFileSync(path.join(__dirname, 'data', 'raw.json'), 'utf8')) as Raw;
  const g = raw.series['^GSPC'];
  const tr = new Map(raw.series['^SP500TR'].dates.map((d, i) => [d, raw.series['^SP500TR'].close[i]]));
  const irx = new Map(raw.series['^IRX'].dates.map((d, i) => [d, raw.series['^IRX'].close[i]]));
  let lastIrx = 0;
  const trArr: number[] = [];
  const irxArr: number[] = [];
  for (const d of g.dates) {
    trArr.push(tr.get(d) ?? NaN);
    const r = irx.get(d);
    if (r !== undefined && r >= 0 && r < 30) lastIrx = r;
    irxArr.push(lastIrx);
  }
  return { fetchedAt: raw.fetchedAt, dates: g.dates, px: g.close, tr: trArr, irx: irxArr };
}

export function toSeries(b: BuiltSeries, basis: 'price' | 'tr', cash: { mode: 'none' | 'fixed' | 'irx'; fixed: number }): SpxSeries {
  const cashRate = b.dates.map((_, i) => (cash.mode === 'none' ? 0 : cash.mode === 'fixed' ? cash.fixed : b.irx[i]));
  return { dates: b.dates, px: b.px, perf: basis === 'price' ? b.px : b.tr, cashRate };
}
