// scripts/backtest/lectureSignals/forwardReturns.ts
// ---------------------------------------------------------------------------
// 전방수익 · MAE · MFE · 시장초과수익(§5.2). 미래참조는 여기서만 다룬다.
//
// 기준(base): 신호일 D 종가 adjClose[i](신호일까지 알 수 있는 정보).
// 전방수익(h): adjClose[i+h]/adjClose[i]-1. i+h가 데이터 끝을 넘으면 null(호라이즌 결측).
// MAE/MFE: [i+1, i+h] 구간의 저가/고가를 base 대비. 미래참조 허용 구간(성과 측정 전용).
// 시장초과: 종목 전방수익 − KOSPI 동일 캘린더 구간 수익.
//
// 규칙: `any`·`console.*`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import type { SecurityBars } from './configTypes';

/** date → 그 날짜 이하(<=)의 마지막 지수 종가를 돌려주는 조회기. */
export interface IndexLevelLookup {
  /** date 이하 최근 거래일의 지수 레벨. 없으면 null. */
  levelAtOrBefore(date: string): number | null;
}

export interface ForwardResult {
  /** 호라이즌 → 종목 전방수익(없으면 null) */
  stockReturn: Record<number, number | null>;
  /** 호라이즌 → KOSPI 전방수익(없으면 null) */
  marketReturn: Record<number, number | null>;
  /** 호라이즌 → 시장초과수익(stock − market, 둘 다 있어야) */
  marketExcess: Record<number, number | null>;
  /** 호라이즌 → MAE(최대불리폭, 음수) */
  mae: Record<number, number | null>;
  /** 호라이즌 → MFE(최대유리폭, 양수) */
  mfe: Record<number, number | null>;
}

/**
 * 신호일 bar index i, 호라이즌 목록 horizons에 대한 전방 성과를 계산한다.
 */
export function computeForward(
  bars: SecurityBars,
  i: number,
  horizons: readonly number[],
  index: IndexLevelLookup
): ForwardResult {
  const { adjClose, adjHigh, adjLow, dates } = bars;
  const n = adjClose.length;
  const base = adjClose[i];
  const mktBase = index.levelAtOrBefore(dates[i]);

  const stockReturn: Record<number, number | null> = {};
  const marketReturn: Record<number, number | null> = {};
  const marketExcess: Record<number, number | null> = {};
  const mae: Record<number, number | null> = {};
  const mfe: Record<number, number | null> = {};

  for (const h of horizons) {
    const end = i + h;
    if (end >= n || !(base > 0)) {
      stockReturn[h] = null;
      marketReturn[h] = null;
      marketExcess[h] = null;
    } else {
      const sr = adjClose[end] / base - 1;
      stockReturn[h] = sr;
      const mktEnd = index.levelAtOrBefore(dates[end]);
      if (mktBase !== null && mktBase > 0 && mktEnd !== null) {
        const mr = mktEnd / mktBase - 1;
        marketReturn[h] = mr;
        marketExcess[h] = sr - mr;
      } else {
        marketReturn[h] = null;
        marketExcess[h] = null;
      }
    }
    // MAE/MFE: [i+1, min(i+h, n-1)] 구간. 최소 하루라도 있으면 계산.
    const lo = i + 1;
    const hi = Math.min(end, n - 1);
    if (lo <= hi && base > 0) {
      let worst = Infinity;
      let bestF = -Infinity;
      for (let t = lo; t <= hi; t++) {
        const lowR = adjLow[t] / base - 1;
        const highR = adjHigh[t] / base - 1;
        if (lowR < worst) worst = lowR;
        if (highR > bestF) bestF = highR;
      }
      mae[h] = worst;
      mfe[h] = bestF;
    } else {
      mae[h] = null;
      mfe[h] = null;
    }
  }

  return { stockReturn, marketReturn, marketExcess, mae, mfe };
}

/** date 이하 최근 종가를 이진탐색으로 찾는 IndexLevelLookup 생성. dates는 오름차순. */
export function makeIndexLookup(dates: readonly string[], close: readonly number[]): IndexLevelLookup {
  return {
    levelAtOrBefore(date: string): number | null {
      // 오름차순 dates에서 date 이하 최대 인덱스.
      let lo = 0;
      let hi = dates.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid] <= date) {
          ans = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (ans < 0) return null;
      return close[ans];
    },
  };
}
