// scripts/backtest/usRoughCheck/rsUs.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검 — RS(상대강도) 엔진 + RS90 진입 이벤트 + 파생 이벤트(E1·E2).
//
// 산식·규약은 한국 `lectureSignals/rs.ts`(§9)와 **동일하게** 재구현했다(import 아님, 로직 참고).
// 한국 결과와 직접 비교하려면 정의가 같아야 하기 때문이다.
//
//   rsRaw  = 0.40×R21 + 0.20×R63 + 0.20×R126 + 0.20×R252   (adj_close, 거래일 기준)
//   rsRank = 그날 적격 유니버스 내 횡단면 백분위 = 100 × k/(N-1)   (k = rsRaw 오름차순 0-based)
//   동률   = 심볼 오름차순 결정론 분리
//   적격   = 그날 바 존재 AND R252 계산 가능(252바 이상) AND 직전20일 평균 달러거래대금 ≥ $1M
//
// ⚠ 한국과의 차이(모집단):
//   · 한국은 PIT(월말 스냅샷) 투자가능 유니버스(하루 평균 420종목)를 썼다.
//   · 여기는 **오늘 S&P500에 남아 있는 대형주 ~500종목** 고정 유니버스다(생존편향, universe.ts 참조).
//     따라서 "rsRank ≥ 90"의 의미가 다르다 — 미국 전체 상장사 상위 10%가 아니라
//     **오늘 살아남은 S&P500 대형주 중 상위 10%**(하루 ~50종목)다. 수치 직접 이식 금지.
//
// 룩어헤드 금지: 모든 지표는 D 이하 정보만 쓴다. "직전 N일 평균"은 당일 D를 제외한다.
//
// 규칙: `any`·`console.*`·`Math.random` 금지. 순수 로직(외부 I/O 없음).
// ---------------------------------------------------------------------------

import type { UsBars } from './usFetch';

export const US_RS = {
  weightR21: 0.4,
  weightR63: 0.2,
  weightR126: 0.2,
  weightR252: 0.2,
  minBarsForR252: 252,
  /** 유동성 최소선: 직전 20일 평균 달러거래대금 $1,000,000. S&P500 대형주라 사실상 거의 통과한다. */
  minDollarVolume: 1_000_000,
  amountAvgWindow: 20,
  entryThreshold: 90,
  episodeEndBelowDays: 20,
  rs50Threshold: 50,
  rs70Threshold: 70,
  /** E2 정체 판정 창(랭크일). 강의 규칙의 "50거래일". */
  stallDays: 50,
  /** E1·E2 이벤트 탐색 창(진입 후 거래일). 한국 3차배치와 동일한 252일 규약. */
  eventWindowDays: 252,
} as const;

// ===========================================================================
// 0. 순수 시계열 헬퍼 (features.ts 스타일 — 룩어헤드 규약 동일)
// ===========================================================================

/** k거래일 수익률 close[i]/close[i-k]-1. i-k<0 또는 base<=0 이면 null. */
export function returnK(close: readonly number[], i: number, k: number): number | null {
  const j = i - k;
  if (j < 0) return null;
  const base = close[j];
  if (!(base > 0)) return null;
  return close[i] / base - 1;
}

/**
 * 직전 N일 평균(**당일 D 제외**): values[i-window .. i-1] 평균. 창 부족이면 null.
 * 거래량·거래대금 기준선용(룩어헤드 규약: 당일 값이 자기 기준선에 들어가면 안 된다).
 */
export function priorMean(values: readonly number[], i: number, window: number): number | null {
  const start = i - window;
  if (start < 0) return null;
  let s = 0;
  for (let k = start; k <= i - 1; k++) s += values[k];
  return s / window;
}

/**
 * `priorMean`의 롤링 O(n) 버전. out[i] = mean(values[i-window .. i-1]) 또는 null.
 * (한국 rs.ts의 오프바이원 감사 교정판과 동일 불변식: 루프 진입 시 sum = values[i-window..i-1])
 */
export function rollingPriorMean(values: readonly number[], window: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (window <= 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i >= 1) sum += values[i - 1];
    if (i >= window + 1) sum -= values[i - window - 1];
    if (i >= window) out[i] = sum / window;
  }
  return out;
}

/** 이동평균(**당일 포함**): values[i-period+1 .. i]. 창 부족이면 null. B3의 200일선용. */
export function smaInclusive(values: readonly number[], i: number, period: number): number | null {
  if (period <= 0) return null;
  const start = i - period + 1;
  if (start < 0) return null;
  let s = 0;
  for (let k = start; k <= i; k++) s += values[k];
  return s / period;
}

// ===========================================================================
// 1. RS 계산
// ===========================================================================

/** 단일 종목 bar i의 rsRaw. 창 부족·기준가≤0이면 null. 미래참조 없음. */
export function computeRsRaw(adjClose: readonly number[], i: number): number | null {
  const r21 = returnK(adjClose, i, 21);
  const r63 = returnK(adjClose, i, 63);
  const r126 = returnK(adjClose, i, 126);
  const r252 = returnK(adjClose, i, 252);
  if (r21 === null || r63 === null || r126 === null || r252 === null) return null;
  return (
    US_RS.weightR21 * r21 +
    US_RS.weightR63 * r63 +
    US_RS.weightR126 * r126 +
    US_RS.weightR252 * r252
  );
}

/**
 * 횡단면 백분위 배정. (rsRaw 오름차순, code 오름차순) 정렬 후 pct = N>1 ? 100×k/(N-1) : 100.
 * 최고 rsRaw=100, 최저=0. 입력 순서와 무관하게 결정론적.
 */
export function assignPercentiles(
  entries: readonly { code: string; rsRaw: number }[]
): Map<string, number> {
  const sorted = [...entries].sort((a, b) =>
    a.rsRaw !== b.rsRaw ? a.rsRaw - b.rsRaw : a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  );
  const N = sorted.length;
  const out = new Map<string, number>();
  for (let k = 0; k < N; k++) out.set(sorted[k].code, N > 1 ? (100 * k) / (N - 1) : 100);
  return out;
}

export interface UsRsRanks {
  calendar: string[];
  /** symbol → 그 종목 바 인덱스 정렬 rsRank(적격 아닌 바는 null). */
  rankBySymbol: Map<string, (number | null)[]>;
  eligibleCountByDate: Map<string, number>;
  avgEligible: number;
  minEligible: number;
  maxEligible: number;
  daysRanked: number;
}

/** 심볼 → 날짜→바인덱스 맵(조회 성능). */
export function buildDateIndex(bars: UsBars): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < bars.dates.length; i++) m.set(bars.dates[i], i);
  return m;
}

/**
 * 전 종목·전 거래일 rsRank 계산. 거래일 캘린더는 **수집 성공 종목 바 날짜의 합집합**.
 * 각 종목의 rsRaw는 그 종목 자기 바 인덱스 기준이므로 결측일이 있어도 룩어헤드가 없다.
 */
export function buildUsRsRanks(barsMap: ReadonlyMap<string, UsBars>, toDate: string): UsRsRanks {
  const dateSet = new Set<string>();
  for (const bars of barsMap.values()) {
    for (const d of bars.dates) if (d <= toDate) dateSet.add(d);
  }
  const calendar = [...dateSet].sort();

  const rsRawBySymbol = new Map<string, (number | null)[]>();
  const amt20BySymbol = new Map<string, (number | null)[]>();
  const rankBySymbol = new Map<string, (number | null)[]>();
  const idxBySymbol = new Map<string, Map<string, number>>();
  for (const [sym, bars] of barsMap.entries()) {
    const n = bars.dates.length;
    const raw: (number | null)[] = new Array(n).fill(null);
    for (let i = US_RS.minBarsForR252; i < n; i++) raw[i] = computeRsRaw(bars.adjClose, i);
    rsRawBySymbol.set(sym, raw);
    amt20BySymbol.set(sym, rollingPriorMean(bars.amount, US_RS.amountAvgWindow));
    rankBySymbol.set(sym, new Array(n).fill(null));
    idxBySymbol.set(sym, buildDateIndex(bars));
  }

  const eligibleCountByDate = new Map<string, number>();
  let sumEligible = 0;
  let minEligible = Number.POSITIVE_INFINITY;
  let maxEligible = 0;
  let daysRanked = 0;
  for (const date of calendar) {
    const day: { code: string; rsRaw: number; bar: number }[] = [];
    for (const [sym, bars] of barsMap.entries()) {
      const i = idxBySymbol.get(sym)?.get(date);
      if (i === undefined) continue;
      const raw = rsRawBySymbol.get(sym)?.[i];
      if (raw === null || raw === undefined) continue;
      const amt = amt20BySymbol.get(sym)?.[i];
      if (amt === null || amt === undefined || amt < US_RS.minDollarVolume) continue;
      day.push({ code: sym, rsRaw: raw, bar: i });
      void bars;
    }
    const N = day.length;
    if (N === 0) continue;
    const pct = assignPercentiles(day);
    for (const d of day) {
      const arr = rankBySymbol.get(d.code);
      if (arr) arr[d.bar] = pct.get(d.code) ?? null;
    }
    eligibleCountByDate.set(date, N);
    sumEligible += N;
    if (N < minEligible) minEligible = N;
    if (N > maxEligible) maxEligible = N;
    daysRanked++;
  }

  return {
    calendar,
    rankBySymbol,
    eligibleCountByDate,
    avgEligible: daysRanked > 0 ? sumEligible / daysRanked : 0,
    minEligible: daysRanked > 0 ? minEligible : 0,
    maxEligible,
    daysRanked,
  };
}

// ===========================================================================
// 2. RS90 진입 이벤트 + 에피소드
// ===========================================================================

export interface RankDay {
  bar: number;
  date: string;
  rank: number;
}

export interface UsRsEntry {
  symbol: string;
  bar: number;
  date: string;
  rankDayIdx: number;
}

/**
 * RS90 진입 이벤트(한국 §9.2와 동일 정의).
 *   · 진입 = 직전 랭크일 rank<90, 당 랭크일 rank≥90 (진행 중 에피소드 밖에서만)
 *   · 에피소드 종료 = rank<90 이 20 랭크일 연속. 종료 전 재진입 이벤트 생성 금지.
 * "연속"은 그 종목의 **랭크일(적격일) 시퀀스** 기준.
 */
export function detectUsRsEntries(
  symbol: string,
  dates: readonly string[],
  ranks: readonly (number | null)[]
): { entries: UsRsEntry[]; rankList: RankDay[] } {
  const rankList: RankDay[] = [];
  for (let i = 0; i < ranks.length; i++) {
    const r = ranks[i];
    if (r !== null) rankList.push({ bar: i, date: dates[i], rank: r });
  }
  const entries: UsRsEntry[] = [];
  let inEpisode = false;
  let belowStreak = 0;
  const TH = US_RS.entryThreshold;
  for (let t = 0; t < rankList.length; t++) {
    const r = rankList[t].rank;
    if (!inEpisode) {
      if (t > 0 && rankList[t - 1].rank < TH && r >= TH) {
        entries.push({ symbol, bar: rankList[t].bar, date: rankList[t].date, rankDayIdx: t });
        inEpisode = true;
        belowStreak = 0;
      }
    } else {
      if (r < TH) belowStreak++;
      else belowStreak = 0;
      if (belowStreak >= US_RS.episodeEndBelowDays) {
        inEpisode = false;
        belowStreak = 0;
      }
    }
  }
  return { entries, rankList };
}

// ===========================================================================
// 3. E1 — RS 90 → 50 미만 하락(매도 신호 후보)
// ===========================================================================

/**
 * E1: RS90 진입 후 rsRank가 처음 **50 미만**이 되는 랭크일(진입 후 eventWindowDays 바 이내).
 * 한국 A12(H7)와 동일 정의. 미도달 시 null.
 */
export function firstRsBelow50AfterEntry(
  rankList: readonly RankDay[],
  entryRankIdx: number
): RankDay | null {
  const maxBar = rankList[entryRankIdx].bar + US_RS.eventWindowDays;
  for (let t = entryRankIdx + 1; t < rankList.length; t++) {
    if (rankList[t].bar > maxBar) break;
    if (rankList[t].rank < US_RS.rs50Threshold) return rankList[t];
  }
  return null;
}

// ===========================================================================
// 4. E2 — RS 90 → 50~70 밴드 진입 후 50거래일간 70 미회복 → 교체
// ===========================================================================

export interface E2Episode {
  /** 50~70 밴드에 처음 들어간 랭크일. */
  bandEntry: RankDay;
  /** 평가일 = 밴드 진입 후 stallDays 번째 랭크일(그만큼 랭크일이 없으면 null → 표본 제외). */
  evalDay: RankDay | null;
  /** 밴드 진입 다음 랭크일 ~ 평가일 사이에 rank ≥ 70 을 한 번이라도 찍었는가. */
  recovered: boolean;
  /** 평가창 안에서 rank < 50 으로 내려간 적이 있는가(해석용 보조 플래그). */
  droppedBelow50: boolean;
}

/**
 * E2 에피소드 구성(강의 규칙의 문자 그대로 판정).
 *   · 밴드 진입 = RS90 진입 후 처음으로 50 ≤ rank < 70 이 된 랭크일(진입 후 eventWindowDays 바 이내)
 *   · 평가일    = 밴드 진입 **다음** 랭크일부터 세어 stallDays(50) 번째 랭크일
 *   · STALL     = 그 50 랭크일 동안 rank ≥ 70 을 한 번도 못 찍음  → 강의는 "교체하라"
 *   · RECOVERED = 그 안에 한 번이라도 rank ≥ 70                  → 강의는 "보유 유지"
 *
 * ⚠ 두 그룹 모두 **같은 평가일**(밴드진입+50 랭크일)에서 전방수익을 측정한다.
 *   회복 시점에서 측정하면 두 그룹의 기준시점이 달라져 비교가 오염되기 때문이다.
 *   분류에 쓰는 정보는 전부 평가일 이하 → 룩어헤드 없음.
 *
 * ⚠ 한국 A13(H8)은 "50~70 구간에 **연속** 50 랭크일 체류"라는 더 엄격한 정의였고 사실상
 *   발화하지 않았다(dev 0건/val 1건). 두 정의의 차이는 결과문서에 명시한다.
 *   `strictStall`(연속 체류) 버전은 `firstStrictStallAfterEntry`로 따로 제공한다.
 */
export function buildE2Episode(rankList: readonly RankDay[], entryRankIdx: number): E2Episode | null {
  const maxBar = rankList[entryRankIdx].bar + US_RS.eventWindowDays;
  let bandIdx = -1;
  for (let t = entryRankIdx + 1; t < rankList.length; t++) {
    if (rankList[t].bar > maxBar) break;
    const r = rankList[t].rank;
    if (r >= US_RS.rs50Threshold && r < US_RS.rs70Threshold) {
      bandIdx = t;
      break;
    }
  }
  if (bandIdx < 0) return null;
  const evalIdx = bandIdx + US_RS.stallDays;
  const lastIdx = Math.min(evalIdx, rankList.length - 1);
  let recovered = false;
  let droppedBelow50 = false;
  for (let t = bandIdx + 1; t <= lastIdx; t++) {
    if (rankList[t].rank >= US_RS.rs70Threshold) recovered = true;
    if (rankList[t].rank < US_RS.rs50Threshold) droppedBelow50 = true;
  }
  return {
    bandEntry: rankList[bandIdx],
    evalDay: evalIdx < rankList.length ? rankList[evalIdx] : null,
    recovered,
    droppedBelow50,
  };
}

/**
 * 한국 A13(H8)과 **완전히 동일한** 엄격 정의: 진입 후 rank가 50~70 구간에 연속 stallDays
 * 랭크일 머문 첫날. 구간을 벗어나면(≥70 또는 <50) 카운트 리셋. 미도달 시 null.
 * 한국은 이 정의로 이벤트가 거의 0건이었다 — 미국에서도 그런지 대조하기 위해 병기한다.
 */
export function firstStrictStallAfterEntry(
  rankList: readonly RankDay[],
  entryRankIdx: number
): RankDay | null {
  const maxBar = rankList[entryRankIdx].bar + US_RS.eventWindowDays;
  let streak = 0;
  for (let t = entryRankIdx + 1; t < rankList.length; t++) {
    if (rankList[t].bar > maxBar) break;
    const r = rankList[t].rank;
    if (r >= US_RS.rs50Threshold && r < US_RS.rs70Threshold) {
      streak++;
      if (streak >= US_RS.stallDays) return rankList[t];
    } else {
      streak = 0;
    }
  }
  return null;
}

// ===========================================================================
// 5. E4 — 진입 전 거래량 폭발 배수
// ===========================================================================

/**
 * E4/한국 Q6와 동일: 최근 60일(j ∈ [i-59, i]) 중 `volume[j] / priorMean(volume, j, 20)` 의 **최댓값**.
 * 기준선은 당일 j 제외(룩어헤드 금지). 창 부족이면 null.
 * 한국 Q6_VOLUME_EXCESS_60D 는 "낮을수록 우수"가 개발표본에서 생존했다 — 미국은 반대라는 것이 강의 주장.
 */
export function volumeExcess60(volume: readonly number[], i: number): number | null {
  const start = i - 59;
  if (start < 0) return null;
  let mx = -Infinity;
  for (let j = start; j <= i; j++) {
    const base = priorMean(volume, j, US_RS.amountAvgWindow);
    if (base === null || base <= 0) continue;
    const m = volume[j] / base;
    if (m > mx) mx = m;
  }
  return Number.isFinite(mx) ? mx : null;
}

/** 진입 당일 거래량 배수(당일/직전20일 평균). 한국 팩터패널 `volumeMultiple`과 동일. */
export function volumeMultipleAt(volume: readonly number[], i: number): number | null {
  const base = priorMean(volume, i, US_RS.amountAvgWindow);
  if (base === null || base <= 0) return null;
  return volume[i] / base;
}
