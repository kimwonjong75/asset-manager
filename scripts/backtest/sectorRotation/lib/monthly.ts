// scripts/backtest/sectorRotation/lib/monthly.ts
// Phase 1 현상검증 — 순수 함수 계층(갭절단·월말리샘플·상대모멘텀).
// 연구 전용(앱/백엔드 무접촉). 룩어헤드 금지: 시점 T의 신호는 T 월말 종가까지만 사용.
// 사전등록(PHASE1_PREREGISTRATION.md) §2~§3을 그대로 구현. 파라미터 튜닝 금지.

import type { AdjSeries } from './yahooData';

/** 두 ISO 날짜(YYYY-MM-DD) 사이의 캘린더 일수. */
export function dateDiffDays(a: string, b: string): number {
  const ms = new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

/** AdjSeries의 모든 병렬 배열을 from 인덱스 이후로 잘라 새 시계열을 만든다. */
function sliceSeries(s: AdjSeries, from: number): AdjSeries {
  return {
    ...s,
    dates: s.dates.slice(from),
    adjOpen: s.adjOpen.slice(from),
    adjHigh: s.adjHigh.slice(from),
    adjLow: s.adjLow.slice(from),
    adjClose: s.adjClose.slice(from),
    volume: s.volume.slice(from),
    rawClose: s.rawClose.slice(from),
  };
}

/**
 * 갭 절단: 연속 데이터 사이 간격이 maxGapDays(기본 30 캘린더일)를 초과하는
 * "마지막" 지점을 찾아, 그 지점 이후의 연속 구간만 남긴다(앞쪽 고립점 폐기).
 * 큰 갭이 없으면 원본 그대로 반환.
 * 예) KR 원조 3종의 2007 점(2007→2009 800일 갭) → 2009-04-17부터 유지.
 */
export function truncateGaps(series: AdjSeries, maxGapDays = 30): AdjSeries {
  const dates = series.dates;
  if (dates.length < 2) return series;
  let cut = -1;
  for (let i = 1; i < dates.length; i++) {
    if (dateDiffDays(dates[i - 1], dates[i]) > maxGapDays) cut = i;
  }
  if (cut < 0) return series;
  return sliceSeries(series, cut);
}

/**
 * 월말 리샘플링: 각 캘린더 달의 "마지막 유효 거래일" adjClose를 뽑아
 * 월별 시계열로 변환한다. adjClose가 null/NaN인 날은 건너뛴다.
 * 날짜는 오름차순 가정.
 */
export function toMonthEnd(series: AdjSeries): { dates: string[]; adjClose: number[] } {
  const outDates: string[] = [];
  const outClose: number[] = [];
  let lastKey = '';
  let lastDate = '';
  let lastClose = 0;
  let has = false;
  for (let i = 0; i < series.dates.length; i++) {
    const c = series.adjClose[i];
    if (typeof c !== 'number' || !isFinite(c)) continue;
    const key = series.dates[i].slice(0, 7); // YYYY-MM
    if (has && key !== lastKey) {
      outDates.push(lastDate);
      outClose.push(lastClose);
    }
    lastKey = key;
    lastDate = series.dates[i];
    lastClose = c;
    has = true;
  }
  if (has) {
    outDates.push(lastDate);
    outClose.push(lastClose);
  }
  return { dates: outDates, adjClose: outClose };
}

/**
 * 월별 패널: 여러 종목을 공통 월(YYYY-MM) 축에 정렬한다.
 * close[t][i] = 월 t에서 종목 i의 월말 adjClose, 없으면 null(미상장/갭절단 폐기 구간).
 * 각 종목은 월말화 전에 truncateGaps를 적용한다.
 */
export interface MonthlyPanel {
  months: string[]; // YYYY-MM 오름차순
  symbols: string[];
  close: (number | null)[][]; // [monthIndex][symbolIndex]
}

export function buildPanel(
  seriesMap: Map<string, AdjSeries>,
  symbols: string[]
): MonthlyPanel {
  const perSymbol = new Map<string, Map<string, number>>();
  const monthSet = new Set<string>();

  for (const sym of symbols) {
    const s = seriesMap.get(sym);
    const m = new Map<string, number>();
    if (s && s.ok && s.dates.length > 0) {
      const trunc = truncateGaps(s);
      const me = toMonthEnd(trunc);
      for (let k = 0; k < me.dates.length; k++) {
        const key = me.dates[k].slice(0, 7);
        m.set(key, me.adjClose[k]);
        monthSet.add(key);
      }
    }
    perSymbol.set(sym, m);
  }

  const months = Array.from(monthSet).sort();
  const close: (number | null)[][] = months.map(mk =>
    symbols.map(sym => {
      const v = perSymbol.get(sym)!.get(mk);
      return v === undefined ? null : v;
    })
  );

  return { months, symbols, close };
}

/**
 * 공통구간 제한(사전등록 §1): 모든 종목이 non-null close를 가진 달만 남긴다.
 * Global 6종은 MCHI 상장(~2011-03)부터, US 9종은 ~1998-12부터 시작하게 된다.
 * months/close를 일관되게 슬라이스한 새 패널을 반환(원본 불변).
 */
export function restrictToCommonMonths(panel: MonthlyPanel): MonthlyPanel {
  const keep: number[] = [];
  for (let t = 0; t < panel.months.length; t++) {
    let all = true;
    for (let i = 0; i < panel.symbols.length; i++) {
      const v = panel.close[t][i];
      if (typeof v !== 'number' || !isFinite(v)) {
        all = false;
        break;
      }
    }
    if (all) keep.push(t);
  }
  return {
    months: keep.map(t => panel.months[t]),
    symbols: panel.symbols.slice(),
    close: keep.map(t => panel.close[t].slice()),
  };
}

/**
 * 미완성 현재월 절단: 월 키(YYYY-MM)가 maxMonth "초과"인 달을 버린다.
 * Phase 1은 마지막 "완료된" 달까지만 봐야 한다(월말 리샘플링이 미완성 당월을
 * 잡지 않도록). months/close를 일관되게 슬라이스한 새 패널을 반환(원본 불변).
 */
export function capMonths(panel: MonthlyPanel, maxMonth: string): MonthlyPanel {
  const keep: number[] = [];
  for (let t = 0; t < panel.months.length; t++) {
    if (panel.months[t] <= maxMonth) keep.push(t);
  }
  return {
    months: keep.map(t => panel.months[t]),
    symbols: panel.symbols.slice(),
    close: keep.map(t => panel.close[t].slice()),
  };
}

/**
 * 상대 모멘텀 점수(사전등록 §3).
 * 시점 t, 종목 i에 대해 각 창 k∈windows(기본 3/6/12)의 총수익
 *   R_k(i) = close[t][i]/close[t-k][i] - 1
 * 을 구하고, 창별 유니버스 평균 대비 상대강도
 *   rel_k(i) = R_k(i) - mean_j R_k(j)  (mean_j 는 그 창이 있는 종목 전체)
 * 을 평균해 M(i) = mean_k rel_k(i) 를 만든다.
 * 모든 창이 있는 종목만 점수를 받고, 아니면 null.
 */
export function relMomentum(
  panel: MonthlyPanel,
  t: number,
  windows: number[] = [3, 6, 12]
): (number | null)[] {
  const n = panel.symbols.length;

  // 창별 R_k(i)
  const perWindowR: (number | null)[][] = windows.map(k => {
    const arr: (number | null)[] = new Array(n).fill(null);
    if (t - k < 0) return arr;
    for (let i = 0; i < n; i++) {
      const now = panel.close[t][i];
      const past = panel.close[t - k][i];
      if (typeof now === 'number' && typeof past === 'number' && past !== 0) {
        arr[i] = now / past - 1;
      }
    }
    return arr;
  });

  // 창별 유니버스 평균(그 창이 있는 종목 전체)
  const meanR: (number | null)[] = perWindowR.map(arr => {
    const vals = arr.filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  });

  const scores: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    let ok = true;
    let sum = 0;
    for (let w = 0; w < windows.length; w++) {
      const r = perWindowR[w][i];
      const mu = meanR[w];
      if (r === null || mu === null) {
        ok = false;
        break;
      }
      sum += r - mu;
    }
    scores[i] = ok ? sum / windows.length : null;
  }
  return scores;
}

/**
 * 미래 h개월 초과수익(사전등록 §5).
 * = close[t+h][i]/close[t][i]-1  −  유니버스 동일가중 미래수익(t→t+h).
 * 유니버스 = t→t+h 수익이 있는 종목. 계산 불가 시 null.
 * 룩어헤드 안전: 오직 t "이후" 종가만 미래에 사용한다.
 */
export function futureExcessReturn(
  panel: MonthlyPanel,
  t: number,
  i: number,
  h: number
): number | null {
  if (t + h >= panel.months.length) return null;
  const now = panel.close[t][i];
  const fut = panel.close[t + h][i];
  if (typeof now !== 'number' || typeof fut !== 'number' || now === 0) return null;
  const ri = fut / now - 1;

  const rets: number[] = [];
  for (let j = 0; j < panel.symbols.length; j++) {
    const n0 = panel.close[t][j];
    const n1 = panel.close[t + h][j];
    if (typeof n0 === 'number' && typeof n1 === 'number' && n0 !== 0) {
      rets.push(n1 / n0 - 1);
    }
  }
  if (rets.length === 0) return null;
  const mu = rets.reduce((a, b) => a + b, 0) / rets.length;
  return ri - mu;
}

/** 편의: 모든 월에 대해 상대모멘텀 점수를 계산해 [month][symbol] 로 반환. */
export function buildScoresByMonth(
  panel: MonthlyPanel,
  windows: number[] = [3, 6, 12]
): (number | null)[][] {
  const out: (number | null)[][] = [];
  for (let t = 0; t < panel.months.length; t++) {
    out.push(relMomentum(panel, t, windows));
  }
  return out;
}
