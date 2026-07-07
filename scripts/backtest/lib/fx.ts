// scripts/backtest/lib/fx.ts
// 환율 시계열을 공통 캘린더에 정렬하고, 결측일은 직전값 carry-forward.

import { AlignedSeries } from './calendar';

export interface FxTable {
  usdKrw: (number | null)[];
  jpyKrw: (number | null)[];
}

/** currency별 KRW 환율 시계열 (KRW 자산은 항상 1). 결측 구간은 첫 유효값으로 backfill. */
export function fxRateFor(currency: string, fx: FxTable, i: number): number {
  if (currency === 'KRW') return 1;
  if (currency === 'USD') return fx.usdKrw[i] ?? nearestValid(fx.usdKrw, i);
  if (currency === 'JPY') return fx.jpyKrw[i] ?? nearestValid(fx.jpyKrw, i);
  return 1;
}

function nearestValid(arr: (number | null)[], i: number): number {
  for (let k = i; k >= 0; k--) {
    if (typeof arr[k] === 'number') return arr[k] as number;
  }
  for (let k = i; k < arr.length; k++) {
    if (typeof arr[k] === 'number') return arr[k] as number;
  }
  return 1;
}

export function buildFxTable(usdKrwSeries: AlignedSeries, jpyKrwSeries: AlignedSeries): FxTable {
  return {
    usdKrw: usdKrwSeries.close,
    jpyKrw: jpyKrwSeries.close,
  };
}
