// scripts/backtest/lib/calendar.ts
// 여러 심볼의 날짜 배열을 하나의 공통 거래일 그리드로 정렬 (합집합 + 직전값 carry-forward).

import { SymbolSeries } from './fetchHistory';

export interface AlignedSeries {
  open: (number | null)[];
  high: (number | null)[];
  low: (number | null)[];
  close: (number | null)[];
}

/** 여러 심볼의 날짜 합집합(오름차순, 시작~끝 사이)을 만든다. */
export function buildUnionCalendar(seriesList: SymbolSeries[], startDate: string, endDate: string): string[] {
  const set = new Set<string>();
  for (const s of seriesList) {
    for (const d of s.dates) {
      if (d >= startDate && d <= endDate) set.add(d);
    }
  }
  return Array.from(set).sort();
}

/**
 * 심볼 시계열을 공통 캘린더에 정렬. 그 날짜에 값이 없으면 직전 유효값으로 carry-forward.
 * 캘린더 시작 이전에 아직 값이 없으면 null (해당 구간은 상장 전으로 취급).
 */
export function alignToCalendar(series: SymbolSeries, calendar: string[]): AlignedSeries {
  const idx = new Map<string, number>();
  series.dates.forEach((d, i) => idx.set(d, i));

  function build(field: (number | null)[]): (number | null)[] {
    const out: (number | null)[] = [];
    let last: number | null = null;
    for (const d of calendar) {
      const i = idx.get(d);
      if (i !== undefined && typeof field[i] === 'number') {
        last = field[i] as number;
      }
      out.push(last);
    }
    return out;
  }

  return {
    open: build(series.open),
    high: build(series.high),
    low: build(series.low),
    close: build(series.close),
  };
}

/** 첫 유효(non-null) close 인덱스 (상장/데이터 시작 시점). 전부 null이면 -1. */
export function firstValidIndex(values: (number | null)[]): number {
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === 'number') return i;
  }
  return -1;
}
