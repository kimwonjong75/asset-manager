// scripts/backtest/bondRole/lib/align.ts
// AdjSeries(yahooData.ts) 를 공통 거래일 그리드로 정렬하는 어댑터.
// lib/calendar.ts 는 fetchHistory.ts 의 SymbolSeries 에 묶여 있어 재사용 불가 →
// 동일 로직(합집합 캘린더 + carry-forward)을 AdjSeries 용으로 재구현한다(calendar.ts 무수정).

import { AdjSeries } from './yahooData';

/** 여러 심볼의 날짜 합집합(오름차순, [startDate, endDate] 범위)을 만든다. */
export function buildUnionCalendar(seriesList: AdjSeries[], startDate: string, endDate: string): string[] {
  const set = new Set<string>();
  for (const s of seriesList) {
    if (!s.ok) continue;
    for (const d of s.dates) {
      if (d >= startDate && d <= endDate) set.add(d);
    }
  }
  return Array.from(set).sort();
}

/**
 * AdjSeries.adjClose 를 공통 캘린더에 정렬. 그 날 값이 없으면 직전 유효값으로 carry-forward.
 * 캘린더 시작 이전에 아직 값이 없으면 null(상장/데이터 시작 전).
 */
export function alignAdjCloseToCalendar(series: AdjSeries, calendar: string[]): (number | null)[] {
  const idx = new Map<string, number>();
  series.dates.forEach((d, i) => idx.set(d, i));

  const out: (number | null)[] = [];
  let last: number | null = null;
  for (const d of calendar) {
    const i = idx.get(d);
    if (i !== undefined && typeof series.adjClose[i] === 'number') {
      last = series.adjClose[i] as number;
    }
    out.push(last);
  }
  return out;
}

/** 첫 유효(non-null) 값의 인덱스. 전부 null 이면 -1. */
export function firstValidIndex(values: (number | null)[]): number {
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] === 'number') return i;
  }
  return -1;
}
