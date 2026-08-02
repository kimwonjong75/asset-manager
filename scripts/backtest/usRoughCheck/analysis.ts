// scripts/backtest/usRoughCheck/analysis.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검 — 가설별 이벤트 조립·집계(순수 로직, 외부 I/O 없음).
//
// 다루는 가설:
//   RS90  RS90 진입 코호트 기준선(진입 자체가 시장을 이겼는가)
//   B3    S&P500 200일선 아래/하락 레짐에서 미국주식 성과가 나쁜가
//   E1    RS 90 → 50 미만 하락 후 부진한가(매도 필터)
//   E2    RS 50~70 밴드에서 50거래일간 70 미회복 시 부진한가(교체 필터)
//   E3    RS90 진입 시 절대주가 $1~10 종목이 최고 성과인가(VIP)
//   E4    진입 전 거래량 폭발이 **좋은** 신호인가(한국은 나쁜 신호로 확인됨 — 정반대 검증)
//
// 룩어헤드 규율:
//   · 그룹 배정·이벤트 판정은 전부 측정 시작일(기준일) **이하** 정보만 쓴다.
//   · 전방수익만 미래를 본다(성과 측정 전용).
//   · 200일선은 당일 종가 포함(당일 종가는 그날 장 마감에 알 수 있고, 전방수익도 그 종가에서 시작).
//   · 거래량 기준선(직전 20일 평균)은 당일 제외.
//
// 규칙: `any`·`console.*`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import type { UsBars } from './usFetch';
import {
  buildDateIndex,
  buildE2Episode,
  detectUsRsEntries,
  firstRsBelow50AfterEntry,
  firstStrictStallAfterEntry,
  smaInclusive,
  US_RS,
  volumeExcess60,
  volumeMultipleAt,
  type RankDay,
  type UsRsRanks,
} from './rsUs';

export const HORIZONS = [63, 126] as const;
export type Horizon = (typeof HORIZONS)[number];

// ===========================================================================
// 0. 벤치마크 조회기
// ===========================================================================

export interface IndexLookup {
  levelAtOrBefore(date: string): number | null;
}

/** date 이하 최근 종가를 이진탐색으로 찾는 조회기(dates 오름차순 가정). */
export function makeIndexLookup(dates: readonly string[], close: readonly number[]): IndexLookup {
  return {
    levelAtOrBefore(date: string): number | null {
      let lo = 0;
      let hi = dates.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (dates[mid] <= date) {
          ans = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return ans < 0 ? null : close[ans];
    },
  };
}

/** bar i 기준 h거래일 전방 시장초과수익(종목 총수익 − ^GSPC 동일구간 수익). 결측 시 null. */
export function forwardExcess(
  bars: UsBars,
  i: number,
  h: number,
  index: IndexLookup
): number | null {
  const end = i + h;
  if (end >= bars.adjClose.length) return null;
  const base = bars.adjClose[i];
  if (!(base > 0)) return null;
  const sr = bars.adjClose[end] / base - 1;
  const mBase = index.levelAtOrBefore(bars.dates[i]);
  const mEnd = index.levelAtOrBefore(bars.dates[end]);
  if (mBase === null || mEnd === null || !(mBase > 0)) return null;
  return sr - (mEnd / mBase - 1);
}

/** bar i 기준 h거래일 전방 절대수익(시장 미차감). B3용. */
export function forwardReturn(bars: UsBars, i: number, h: number): number | null {
  const end = i + h;
  if (end >= bars.adjClose.length) return null;
  const base = bars.adjClose[i];
  if (!(base > 0)) return null;
  return bars.adjClose[end] / base - 1;
}

// ===========================================================================
// 1. RS90 진입 이벤트 패널
// ===========================================================================

export interface EntryRecord {
  symbol: string;
  date: string;
  bar: number;
  rankDayIdx: number;
  /** 진입일 명목주가 근사(Yahoo raw close = 분할조정 O · 배당조정 X). E3용. */
  priceAtEntry: number;
  /** 진입 전 60일 거래량 폭발 배수(최댓값). E4용. */
  volumeExcess60: number | null;
  /** 진입 당일 거래량 배수. E4 보조 축(한국 팩터패널과 동일 정의). */
  volumeMultiple: number | null;
  excess: Record<number, number | null>;
}

export interface EntryPanel {
  entries: EntryRecord[];
  rankListBySymbol: Map<string, RankDay[]>;
  entryRankIdxBySymbol: Map<string, number[]>;
}

/** 전 종목 RS90 진입 이벤트 + 진입일 특성·전방수익을 조립한다. */
export function buildEntryPanel(
  barsMap: ReadonlyMap<string, UsBars>,
  ranks: UsRsRanks,
  index: IndexLookup
): EntryPanel {
  const entries: EntryRecord[] = [];
  const rankListBySymbol = new Map<string, RankDay[]>();
  const entryRankIdxBySymbol = new Map<string, number[]>();

  const symbols = [...barsMap.keys()].sort();
  for (const sym of symbols) {
    const bars = barsMap.get(sym);
    const rk = ranks.rankBySymbol.get(sym);
    if (!bars || !rk) continue;
    const { entries: evs, rankList } = detectUsRsEntries(sym, bars.dates, rk);
    rankListBySymbol.set(sym, rankList);
    entryRankIdxBySymbol.set(sym, evs.map((e) => e.rankDayIdx));
    for (const ev of evs) {
      const excess: Record<number, number | null> = {};
      for (const h of HORIZONS) excess[h] = forwardExcess(bars, ev.bar, h, index);
      entries.push({
        symbol: sym,
        date: ev.date,
        bar: ev.bar,
        rankDayIdx: ev.rankDayIdx,
        priceAtEntry: bars.close[ev.bar],
        volumeExcess60: volumeExcess60(bars.volume, ev.bar),
        volumeMultiple: volumeMultipleAt(bars.volume, ev.bar),
        excess,
      });
    }
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol < b.symbol ? -1 : 1));
  return { entries, rankListBySymbol, entryRankIdxBySymbol };
}

// ===========================================================================
// 2. B3 — S&P500 200일선 레짐
// ===========================================================================

export type RegimeVariant = 'US200_LEVEL' | 'US200_SLOPE';

export interface RegimeDay {
  date: string;
  /** true = 위험 레짐(200일선 아래 / 200일선 하락). */
  risk: boolean;
  /** 그날 바를 가진 전 종목 등가중 126일 전방 절대수익. 표본 없으면 null. */
  equalWeightForward: number | null;
  stockCount: number;
}

/**
 * 지수 레짐 일별 패널.
 *   · US200_LEVEL : close[i] < SMA200(당일 포함)
 *   · US200_SLOPE : SMA200(i) < SMA200(i-21)  (21거래일 전 대비 하락)
 * 200일선 계산에 당일 종가를 포함하는 것은 한국 D1(`smaInclusive`)과 동일 규약이다.
 * 전방수익도 같은 날 종가에서 시작하므로 룩어헤드가 아니다.
 */
export function buildRegimePanel(
  benchmark: UsBars,
  barsMap: ReadonlyMap<string, UsBars>,
  variant: RegimeVariant,
  horizon: number
): RegimeDay[] {
  const idxBySymbol = new Map<string, Map<string, number>>();
  for (const [sym, bars] of barsMap.entries()) idxBySymbol.set(sym, buildDateIndex(bars));

  const out: RegimeDay[] = [];
  for (let i = 0; i < benchmark.dates.length; i++) {
    const ma = smaInclusive(benchmark.adjClose, i, 200);
    if (ma === null) continue;
    let risk: boolean;
    if (variant === 'US200_LEVEL') {
      risk = benchmark.adjClose[i] < ma;
    } else {
      const past = smaInclusive(benchmark.adjClose, i - 21, 200);
      if (past === null) continue;
      risk = ma < past;
    }
    const date = benchmark.dates[i];
    let sum = 0;
    let cnt = 0;
    for (const [sym, bars] of barsMap.entries()) {
      const j = idxBySymbol.get(sym)?.get(date);
      if (j === undefined) continue;
      const r = forwardReturn(bars, j, horizon);
      if (r === null) continue;
      sum += r;
      cnt++;
    }
    out.push({ date, risk, equalWeightForward: cnt > 0 ? sum / cnt : null, stockCount: cnt });
  }
  return out;
}

// ===========================================================================
// 3. E1 — RS 90 → 50 미만 하락(코호트 매칭)
// ===========================================================================

export interface CohortMatchedEvent {
  symbol: string;
  /** 경고일(측정 기준일). */
  date: string;
  signalExcess: number;
  controlMeanExcess: number;
  controlCount: number;
  diff: number;
}

interface WarnInfo {
  symbol: string;
  entryDate: string;
  warnDate: string | null;
  warnBar: number | null;
}

/**
 * E1 이벤트를 **not-yet-treated 코호트 매칭**으로 만든다(한국 3차배치 A12/H7와 동일 방법론).
 *   · 각 RS90 진입을 진입 **월** 코호트로 묶는다.
 *   · 종목 X의 경고일 d(진입 후 처음 rsRank<50)에서, 같은 코호트 중
 *     "그 날짜 기준 아직 경고가 나지 않았고 그 날 바를 가진" 종목들을 대조군으로 삼는다.
 *   · 대조군의 같은 날짜 기준 전방수익 평균과의 차(diff)를 이벤트 값으로 쓴다.
 *
 * 대조군 선정에 경고일 **이후** 정보를 쓰지 않는다(한국 감사에서 고친 선정 룩어헤드 회피).
 */
export function buildE1Events(
  panel: EntryPanel,
  barsMap: ReadonlyMap<string, UsBars>,
  index: IndexLookup,
  horizon: number
): { events: CohortMatchedEvent[]; warnRate: number; totalEntries: number } {
  const idxBySymbol = new Map<string, Map<string, number>>();
  for (const [sym, bars] of barsMap.entries()) idxBySymbol.set(sym, buildDateIndex(bars));

  // 코호트(진입 월) → 진입별 경고 정보
  const cohorts = new Map<string, WarnInfo[]>();
  let warned = 0;
  for (const e of panel.entries) {
    const rankList = panel.rankListBySymbol.get(e.symbol);
    if (!rankList) continue;
    const w = firstRsBelow50AfterEntry(rankList, e.rankDayIdx);
    if (w) warned++;
    const key = e.date.slice(0, 7);
    const arr = cohorts.get(key) ?? [];
    arr.push({
      symbol: e.symbol,
      entryDate: e.date,
      warnDate: w ? w.date : null,
      warnBar: w ? w.bar : null,
    });
    cohorts.set(key, arr);
  }

  const events: CohortMatchedEvent[] = [];
  for (const members of cohorts.values()) {
    for (const m of members) {
      if (m.warnDate === null || m.warnBar === null) continue;
      const bars = barsMap.get(m.symbol);
      if (!bars) continue;
      const sig = forwardExcess(bars, m.warnBar, horizon, index);
      if (sig === null) continue;
      let sum = 0;
      let cnt = 0;
      for (const other of members) {
        if (other.symbol === m.symbol) continue;
        // not-yet-treated: 경고가 없었거나, 있어도 기준일 이후여야 한다.
        if (other.warnDate !== null && other.warnDate <= m.warnDate) continue;
        const ob = barsMap.get(other.symbol);
        if (!ob) continue;
        const j = idxBySymbol.get(other.symbol)?.get(m.warnDate);
        if (j === undefined) continue;
        const v = forwardExcess(ob, j, horizon, index);
        if (v === null) continue;
        sum += v;
        cnt++;
      }
      if (cnt === 0) continue;
      const ctrl = sum / cnt;
      events.push({
        symbol: m.symbol,
        date: m.warnDate,
        signalExcess: sig,
        controlMeanExcess: ctrl,
        controlCount: cnt,
        diff: sig - ctrl,
      });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol < b.symbol ? -1 : 1));
  return { events, warnRate: panel.entries.length ? warned / panel.entries.length : 0, totalEntries: panel.entries.length };
}

// ===========================================================================
// 4. E2 — 50~70 밴드 50거래일 미회복
// ===========================================================================

export interface E2Record {
  symbol: string;
  /** 평가일(밴드 진입 + 50 랭크일). 두 그룹 모두 이 날짜에서 전방수익을 잰다. */
  date: string;
  stalled: boolean;
  droppedBelow50: boolean;
  excess: Record<number, number | null>;
}

export function buildE2Records(
  panel: EntryPanel,
  barsMap: ReadonlyMap<string, UsBars>,
  index: IndexLookup
): { records: E2Record[]; bandEntries: number; strictStallCount: number } {
  const records: E2Record[] = [];
  let bandEntries = 0;
  let strictStallCount = 0;
  for (const e of panel.entries) {
    const rankList = panel.rankListBySymbol.get(e.symbol);
    const bars = barsMap.get(e.symbol);
    if (!rankList || !bars) continue;
    if (firstStrictStallAfterEntry(rankList, e.rankDayIdx) !== null) strictStallCount++;
    const ep = buildE2Episode(rankList, e.rankDayIdx);
    if (!ep) continue;
    bandEntries++;
    if (!ep.evalDay) continue; // 평가일까지 랭크일이 모자람 → 표본 제외
    const excess: Record<number, number | null> = {};
    for (const h of HORIZONS) excess[h] = forwardExcess(bars, ep.evalDay.bar, h, index);
    records.push({
      symbol: e.symbol,
      date: ep.evalDay.date,
      stalled: !ep.recovered,
      droppedBelow50: ep.droppedBelow50,
      excess,
    });
  }
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol < b.symbol ? -1 : 1));
  return { records, bandEntries, strictStallCount };
}

// ===========================================================================
// 5. 그룹 분할 헬퍼
// ===========================================================================

/** 값 기준 3분위 분할(하위/중간/상위). 동률은 심볼·날짜 정렬로 결정론 처리(호출부가 정렬). */
export function tertileSplit<T>(
  items: readonly T[],
  valueOf: (t: T) => number
): { low: T[]; mid: T[]; high: T[] } {
  const sorted = [...items].sort((a, b) => valueOf(a) - valueOf(b));
  const n = sorted.length;
  const c1 = Math.floor(n / 3);
  const c2 = Math.floor((2 * n) / 3);
  return { low: sorted.slice(0, c1), mid: sorted.slice(c1, c2), high: sorted.slice(c2) };
}

/** 가격 구간 라벨(E3). 강의의 VIP 구간은 $1~10. */
export function priceBucket(price: number): string {
  if (price < 1) return '<$1';
  if (price <= 10) return '$1-10';
  if (price <= 20) return '$10-20';
  if (price <= 50) return '$20-50';
  if (price <= 100) return '$50-100';
  return '>$100';
}

/** 거래량 배수 구간 라벨(E4, 한국 팩터패널과 동일 경계). */
export function volumeBucket(mult: number): string {
  if (mult < 1) return '<1x';
  if (mult < 2) return '1-2x';
  if (mult < 5) return '2-5x';
  return '>=5x';
}

/** 진입일 기준 표본 구간 판정(한국 개발/검증 구간과 동일 경계). */
export function periodOf(date: string): 'dev' | 'val' | 'other' {
  if (date >= '2010-01-01' && date <= '2019-12-31') return 'dev';
  if (date >= '2020-01-01' && date <= '2022-12-31') return 'val';
  return 'other';
}

export { US_RS };
