// scripts/backtest/lectureSignals/rs.ts
// ---------------------------------------------------------------------------
// 3차 배치 — 한국 RS(상대강도) 계산기 + RS 90 진입 이벤트 + 보유열화 상태기계(§8·§9).
//
// RS 정의(§9.1):
//   rsRaw = 0.40×R21 + 0.20×R63 + 0.20×R126 + 0.20×R252   (분할조정 adj_close 수익률, 거래일 기준)
//   rsRank = 같은 날 적격 유니버스 내 횡단면 백분위(0~100)
//     · 적격(§4.1·§4.4·§9.1) = 그날 유효 PIT 투자가능 AND 직전 20일 평균 거래대금(amount) ≥ 10억원
//       AND R252 계산 가능(그 종목 상장/데이터 252거래일 이상)
//     · 동률은 종목코드 오름차순으로 결정론 처리(§9.1, §15-6). Mansfield RS와 혼용 금지.
//
// ⚠ 거래일 캘린더 선택(문서화 필요, 작업지시): **투자가능 유니버스 바 날짜의 합집합**을 공통
//   거래일 캘린더로 쓴다(^KS11 Yahoo 캘린더가 아님). KRX 상장 종목의 실제 거래일과 정확히
//   일치하고, 각 종목의 rsRaw는 그 종목 '자기 바 인덱스' 기준(거래일 기준 수익률)으로 계산해
//   거래정지·결측일이 있어도 룩어헤드 없이 정합적이다. 어떤 종목의 rsRank는 '그 날 그 종목이
//   보유한 바'에서만 정의된다(적격 유니버스에 없는 날은 rsRank 미정의=null).
//
// ⚠ 백분위 공식: 적격 종목을 (rsRaw 오름차순, code 오름차순)으로 정렬해 0-based 순위 k를 준 뒤
//   pct = N>1 ? 100 × k/(N-1) : 100. 최고 rsRaw=100, 최저=0. rsRank≥90 ⇔ 상위 ~10%.
//
// 규칙: `any`·`console.*`(런너 아님)·`Math.random` 금지. 순수 로직(외부 I/O 없음).
// ---------------------------------------------------------------------------

import type { SecurityBars } from './configTypes';
import type { LectureDataset } from './dataAccess';
import { returnK } from './features';

/** RS 90 임계값·상수(§9). */
export const RS_CONST = {
  weightR21: 0.4,
  weightR63: 0.2,
  weightR126: 0.2,
  weightR252: 0.2,
  minBarsForR252: 252,
  minAmountKRW: 1_000_000_000, // 10억원(§4.4 주분석)
  amountAvgWindow: 20,
  entryThreshold: 90, // rsRank ≥ 90 진입
  episodeEndBelowDays: 20, // RS 90 미만 20거래일 연속 → 에피소드 종료
  rs50Threshold: 50, // Q4 RS50 에피소드
  rs50BelowDays: 20,
  rs50LookbackDays: 504, // Q4 504일 내 시작점 미확인 시 504+ 범주
  rs70Threshold: 70, // A13 정체 밴드 상단(50~70)
  rs5070StallDays: 50, // A13 정체 판정 연속 랭크일(미국 E2 규칙의 50일)
  rs97Threshold: 97, // H6
  h6WindowDays: 21, // H6 진입 후 21거래일 내
  /**
   * H1·H2·H7·H8 관측창(진입 후 거래일). 사전등록 §8.1은 H6에만 창(21일)을 명시하고 나머지엔
   * 침묵한다. 창이 없으면 탐색이 데이터 끝까지 이어져 (a) 진입 10년 뒤 사건이 "보유열화 경고"로
   * 잡히고 (b) 경고일이 **잠금표본(2023-2025)** 으로 넘어간다. 실제로 무한탐색 시 H1이 진입의
   * 99%에서 발화했다. §5.2의 최장 호라이즌과 같은 **252거래일**로 고정한다(결과를 보고 고른
   * 값이 아니라 기존 상수 재사용).
   */
  hWindowDays: 252,
  boomUpMultiple: 1.5, // Q9/H5 러닝저점 대비 +50%
  bustDownMultiple: 0.7, // Q9/H5 러닝고점 대비 -30%
  boomBustWindowDays: 252, // Q9 최근 252일
} as const;

/**
 * 단일 종목 bar index i의 rsRaw. R21/R63/R126/R252 중 하나라도 계산 불가(창 부족·기준가≤0)면 null.
 * i ≥ 252 여야 R252가 존재. 미래참조 없음(모두 D까지의 과거 수익률).
 */
export function computeRsRaw(adjClose: readonly number[], i: number): number | null {
  const r21 = returnK(adjClose, i, 21);
  const r63 = returnK(adjClose, i, 63);
  const r126 = returnK(adjClose, i, 126);
  const r252 = returnK(adjClose, i, 252);
  if (r21 === null || r63 === null || r126 === null || r252 === null) return null;
  return (
    RS_CONST.weightR21 * r21 +
    RS_CONST.weightR63 * r63 +
    RS_CONST.weightR126 * r126 +
    RS_CONST.weightR252 * r252
  );
}

/**
 * 횡단면 백분위 배정(§9.1). 입력 순서와 무관하게 결정론적: (rsRaw 오름차순, code 오름차순) 정렬.
 * pct = N>1 ? 100×k/(N-1) : 100(k=0-based 순위). 동률은 code 오름차순으로 분리.
 * @returns code → 백분위(0~100).
 */
export function assignPercentiles(
  entries: readonly { code: string; rsRaw: number }[]
): Map<string, number> {
  const sorted = [...entries].sort((a, b) =>
    a.rsRaw !== b.rsRaw ? a.rsRaw - b.rsRaw : a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  );
  const N = sorted.length;
  const out = new Map<string, number>();
  for (let k = 0; k < N; k++) {
    out.set(sorted[k].code, N > 1 ? (100 * k) / (N - 1) : 100);
  }
  return out;
}

/**
 * 직전 window일 평균(당일 D 제외, §15-18)을 전 바에 대해 롤링 계산.
 * out[i] = mean(values[i-window .. i-1]) (= features.priorMean(values, i, window)) 또는 null.
 *
 * ⚠ 감사 수정(2026-07-26): 초판은 `sum -= values[i-window]`를 out 계산 **전에** 실행해
 * out[i]가 mean(values[i-window+1 .. i-1]) / window(원소 1개 부족, 분모는 window)로
 * 계산됐다. 즉 직전 20일 평균 거래대금이 체계적으로 과소평가되어 적격 유니버스가
 * 잘못 좁혀졌다. 아래 불변식으로 교정: 루프 진입 시 sum = values[i-window .. i-1].
 * `lectureRsParity.ts` §1이 features.priorMean과 전 바 일치를 골든으로 못박는다.
 */
export function rollingPriorMean(values: readonly number[], window: number): (number | null)[] {
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (window <= 0) return out;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i >= 1) sum += values[i - 1]; // 창에 D-1 편입
    if (i >= window + 1) sum -= values[i - window - 1]; // 창에서 D-window-1 방출
    if (i >= window) out[i] = sum / window;
  }
  return out;
}

function normMarketOk(m: string): boolean {
  return m === 'KOSPI' || m === 'KOSDAQ';
}

export interface RsRanks {
  /** 공통 거래일 캘린더(투자가능 유니버스 바 날짜 합집합, toDate 이하 오름차순). */
  calendar: string[];
  /** code → 그 종목 바 인덱스 정렬 rsRank(적격 아닌 바는 null). */
  rankByCode: Map<string, (number | null)[]>;
  /** 날짜 → 그날 적격 유니버스 크기(리포트용). */
  eligibleCountByDate: Map<string, number>;
  avgEligible: number;
  daysRanked: number;
}

/**
 * 전 종목·전 거래일 rsRank 계산(§9.1). PIT effectiveMonth 유니버스를 날짜별로 순회해
 * 적격 종목만 모아 백분위를 배정한다. toDate 이하 캘린더만 랭킹(잠금표본 랭킹 금지).
 *
 * 효율: 종목별 rsRaw·직전20일 거래대금 배열을 1회 선계산(O(전체 바)), 날짜별로 그달 PIT
 * 유니버스(≈2천 종목)만 순회해 정렬(O(N log N))한다. 수 분 내 완료.
 */
export function buildRsRanks(ds: LectureDataset, toDate: string): RsRanks {
  // 0) 공통 거래일 캘린더 = 투자가능 유니버스 바 날짜 합집합(toDate 이하)
  const dateSet = new Set<string>();
  for (const bars of ds.bars.values()) {
    for (const d of bars.dates) if (d <= toDate) dateSet.add(d);
  }
  const calendar = [...dateSet].sort();

  // 1) 종목별 선계산: rsRaw[], 직전20일 평균 거래대금[]
  const rsRawByCode = new Map<string, (number | null)[]>();
  const amt20ByCode = new Map<string, (number | null)[]>();
  const rankByCode = new Map<string, (number | null)[]>();
  for (const [code, bars] of ds.bars.entries()) {
    const n = bars.dates.length;
    const raw: (number | null)[] = new Array(n).fill(null);
    for (let i = RS_CONST.minBarsForR252; i < n; i++) raw[i] = computeRsRaw(bars.adjClose, i);
    rsRawByCode.set(code, raw);
    amt20ByCode.set(code, rollingPriorMean(bars.amount, RS_CONST.amountAvgWindow));
    rankByCode.set(code, new Array(n).fill(null));
  }

  // 2) 날짜별 횡단면 랭킹
  const eligibleCountByDate = new Map<string, number>();
  let sumEligible = 0;
  let daysRanked = 0;
  for (const date of calendar) {
    const eff = date.slice(0, 7); // effectiveMonth 키(다음달 유효분 → 룩어헤드 방지, §4.1)
    const inner = ds.pit.get(eff);
    if (!inner) continue;
    const day: { code: string; rsRaw: number; bar: number }[] = [];
    for (const code of inner.keys()) {
      const bars = ds.bars.get(code);
      if (!bars) continue;
      const i = bars.dateIndex.get(date);
      if (i === undefined) continue;
      if (!normMarketOk(bars.market[i])) continue;
      const raw = rsRawByCode.get(code)?.[i];
      if (raw === null || raw === undefined) continue;
      const amt = amt20ByCode.get(code)?.[i];
      if (amt === null || amt === undefined || amt < RS_CONST.minAmountKRW) continue;
      day.push({ code, rsRaw: raw, bar: i });
    }
    const N = day.length;
    if (N === 0) continue;
    const pctByCode = assignPercentiles(day);
    for (const d of day) {
      const arr = rankByCode.get(d.code);
      if (arr) arr[d.bar] = pctByCode.get(d.code) ?? null;
    }
    eligibleCountByDate.set(date, N);
    sumEligible += N;
    daysRanked++;
  }

  return {
    calendar,
    rankByCode,
    eligibleCountByDate,
    avgEligible: daysRanked > 0 ? sumEligible / daysRanked : 0,
    daysRanked,
  };
}

// ===========================================================================
// RS 90 진입 이벤트 + 에피소드(§9.2)
// ===========================================================================

/** 그 종목이 적격이었던 '랭크일'(rsRank 정의된 바). */
export interface RankDay {
  bar: number; // 종목 바 인덱스
  date: string;
  rank: number; // rsRank(0~100)
}

export interface RsEntryEvent {
  code: string;
  bar: number; // 진입일 종목 바 인덱스
  date: string;
  rankDayIdx: number; // rankList 내 인덱스
}

/**
 * 한 종목의 RS 90 진입 이벤트(§9.2). rankList = rsRank가 정의된 바만 순서대로.
 *   · 진입 = 전 랭크일 rank<90, 당 랭크일 rank≥90인 첫날(진행 중 에피소드 밖에서만).
 *   · 에피소드 종료 = rank<90 이 20 랭크일 연속. 종료 전 재진입 이벤트 생성 금지(§15-7).
 * "거래일" 연속 판정은 그 종목의 랭크일(적격일) 시퀀스 기준(문서화).
 */
export function detectRsEntries(
  bars: SecurityBars,
  ranks: readonly (number | null)[]
): { entries: RsEntryEvent[]; rankList: RankDay[] } {
  const rankList: RankDay[] = [];
  for (let i = 0; i < ranks.length; i++) {
    const r = ranks[i];
    if (r !== null) rankList.push({ bar: i, date: bars.dates[i], rank: r });
  }
  const entries: RsEntryEvent[] = [];
  let inEpisode = false;
  let belowStreak = 0;
  const TH = RS_CONST.entryThreshold;
  for (let t = 0; t < rankList.length; t++) {
    const r = rankList[t].rank;
    if (!inEpisode) {
      if (t > 0 && rankList[t - 1].rank < TH && r >= TH) {
        entries.push({ code: bars.code, bar: rankList[t].bar, date: rankList[t].date, rankDayIdx: t });
        inEpisode = true;
        belowStreak = 0;
      }
    } else {
      if (r < TH) belowStreak++;
      else belowStreak = 0;
      if (belowStreak >= RS_CONST.episodeEndBelowDays) {
        inEpisode = false;
        belowStreak = 0;
      }
    }
  }
  return { entries, rankList };
}

// ===========================================================================
// Q4 — RS50 → RS90 소요 거래일(§9.3)
// ===========================================================================

export interface Rs50ToRs90 {
  days: number; // RS50 에피소드 시작 → RS90 진입 거래일수(그 종목 바 인덱스 차)
  censored: boolean; // 504일 내 시작점 미확인 → true('504+' 범주)
}

/**
 * RS50 에피소드 시작(§9.3 Q4): RS50 아래 20거래일 연속 후 처음 50 이상이 된 날. 그 시작일부터
 * RS90 진입일까지 거래일수. 504거래일 내 시작점 미확인 시 censored(=504+ 범주로 유지, 미폐기).
 * 랭크일 시퀀스 기준(진입일·시작일 모두 그 종목의 랭크일).
 *
 * ⚠ 감사 수정(2026-07-26): 초판은 "진입일이 속한 **연속** ≥50 런의 시작"을 에피소드 시작으로 봤다.
 * 그러면 중간에 하루라도 RS가 50 밑으로 내려가면 에피소드가 리셋되어 소요기간이 체계적으로
 * 짧아진다. §9.2가 RS90 에피소드를 "20거래일 연속 미만"으로 끝낸다고 정의하므로 RS50
 * 에피소드도 같은 구성으로 읽는 것이 정합적이다 → **상태기계**로 교정:
 *   · 시작: <50 이 20 랭크일 연속인 뒤 처음 ≥50 이 된 날
 *   · 종료: <50 이 20 랭크일 연속
 *   · 20일 미만의 일시적 하회는 에피소드를 끊지 않는다
 * 미래참조 없음(진입일까지의 랭크일만 순회).
 */
export function computeRs50ToRs90(rankList: readonly RankDay[], entryIdx: number): Rs50ToRs90 {
  const TH = RS_CONST.rs50Threshold;
  const BELOW = RS_CONST.rs50BelowDays;
  let belowStreak = 0;
  let startIdx = -1; // 현재 진행 중 에피소드의 시작 랭크일(없으면 -1)
  for (let t = 0; t <= entryIdx; t++) {
    if (rankList[t].rank < TH) {
      belowStreak++;
      if (belowStreak >= BELOW) startIdx = -1; // 에피소드 종료
    } else {
      if (startIdx === -1 && belowStreak >= BELOW) startIdx = t; // 새 에피소드 시작
      belowStreak = 0;
    }
  }
  if (startIdx < 0) {
    // 시작점 미확인(상장 초기부터 계속 ≥50 등) → '504+' 범주
    return { days: RS_CONST.rs50LookbackDays, censored: true };
  }
  const days = rankList[entryIdx].bar - rankList[startIdx].bar; // 그 종목 거래일수
  if (days <= RS_CONST.rs50LookbackDays) return { days, censored: false };
  return { days: RS_CONST.rs50LookbackDays, censored: true };
}

// ===========================================================================
// A12 / A13 — RS 기반 보유열화 이벤트(§2 축A, PLAN v2)
// ===========================================================================

/**
 * A12(`H7_RS_BELOW_50`): RS90 진입 후 rsRank가 처음 50 **미만**이 되는 랭크일의 바 인덱스.
 * 강의 주장 = "한국 RS 50 미만이면 매도". 진입 랭크일 다음부터 탐색하며 창 제한 없음
 * (보유 관리 신호이므로 에피소드 종료와 무관하게 첫 하회일을 경고일로 본다). 미도달 시 null.
 */
export function firstRsBelow50AfterEntry(
  rankList: readonly RankDay[],
  entryRankIdx: number
): number | null {
  for (let t = entryRankIdx + 1; t < rankList.length; t++) {
    if (rankList[t].rank < RS_CONST.rs50Threshold) return rankList[t].bar;
  }
  return null;
}

/**
 * A13(`H8_RS_50_70_STALL`): RS90 진입 후 rsRank가 **50 이상 70 미만** 구간에 연속
 * `rs5070StallDays`(50) 랭크일 머문 첫날의 바 인덱스. 미국 규칙 E2("50~70 정체 50일이면 교체")를
 * 한국에 그대로 적용했을 때의 이벤트이며, 강의는 **한국에선 교체 불필요**라고 주장한다.
 * 따라서 이 이벤트 후 코호트 대비 부진이 없으면 강의 주장(교체 불필요)이 지지된다.
 * 구간을 벗어나면(≥70 또는 <50) 연속 카운트는 리셋된다. 미도달 시 null.
 */
export function firstRs5070StallAfterEntry(
  rankList: readonly RankDay[],
  entryRankIdx: number
): number | null {
  let streak = 0;
  for (let t = entryRankIdx + 1; t < rankList.length; t++) {
    const r = rankList[t].rank;
    if (r >= RS_CONST.rs50Threshold && r < RS_CONST.rs70Threshold) {
      streak++;
      if (streak >= RS_CONST.rs5070StallDays) return rankList[t].bar;
    } else {
      streak = 0;
    }
  }
  return null;
}

// ===========================================================================
// 붐-버스트 상태기계(§8.1 H5 / §9.3 Q9) — 비미래참조
// ===========================================================================

/**
 * 완료된 붐-버스트 사이클 수(비미래참조 상태기계, §8.1·§9.3).
 *   · SEEKING_BOOM: 러닝 저점 추적. 가격이 러닝저점×1.5(+50%) 도달 → SEEKING_BUST, 러닝고점=현재가.
 *   · SEEKING_BUST: 러닝 고점 추적. 가격이 러닝고점×0.7(-30%) 도달 → 1사이클 기록, 현재가부터 새 SEEKING_BOOM.
 * prices는 시간순 분할조정 종가 슬라이스. 미래 국소고점 미사용.
 */
export function countBoomBustCycles(prices: readonly number[]): number {
  const n = prices.length;
  if (n === 0) return 0;
  let phase: 'BOOM' | 'BUST' = 'BOOM';
  let runLow = prices[0];
  let runHigh = 0;
  let cycles = 0;
  for (let t = 1; t < n; t++) {
    const p = prices[t];
    if (phase === 'BOOM') {
      if (p < runLow) runLow = p;
      if (runLow > 0 && p >= runLow * RS_CONST.boomUpMultiple) {
        phase = 'BUST';
        runHigh = p;
      }
    } else {
      if (p > runHigh) runHigh = p;
      if (runHigh > 0 && p <= runHigh * RS_CONST.bustDownMultiple) {
        cycles++;
        phase = 'BOOM';
        runLow = p;
      }
    }
  }
  return cycles;
}

// ===========================================================================
// H1/H2 — 진입 후 롤링 창 급등 경고일(§8.1)
// ===========================================================================

/**
 * 진입 후 완전한 window거래일 창 롤링 수익률이 threshold 이상 되는 첫 바 인덱스(§8.1 H1/H2).
 *   · '완전한 창' = 창의 기준(base) 인덱스가 진입일 이상(진입 전 가격이 창에 섞이면 안 됨).
 *     j-window ≥ entryBar 이므로 첫 후보 j = entryBar+window(base=진입일 종가).
 *   · 롤링 수익률 = adjClose[j]/adjClose[j-window]-1.
 *   · 임계값 비교는 **비율 형태**(`ratio >= 1+threshold`)로 한다 — `x/base-1 >= 0.2`는 120/100에서
 *     0.19999999999999996이 되어 경계에서 거짓이 되는 부동소수 절벽이 있다(features.ts ratioK 주석과
 *     events.ts S1/S2 판정과 동일 규약).
 * 미도달 시 null.
 */
export function firstPostEntryRunup(
  adjClose: readonly number[],
  entryBar: number,
  window: number,
  threshold: number
): number | null {
  const n = adjClose.length;
  for (let j = entryBar + window; j < n; j++) {
    const base = adjClose[j - window];
    if (!(base > 0)) continue;
    if (adjClose[j] / base >= 1 + threshold) return j;
  }
  return null;
}

// ===========================================================================
// H6 — 진입 후 21거래일 내 RS 97 도달 경고일(§8.1)
// ===========================================================================

/**
 * 진입 후 h6WindowDays 거래일(그 종목 바 인덱스 기준) 내 rsRank ≥ 97 도달 첫 바 인덱스(§8.1 H6).
 * rankList는 detectRsEntries가 만든 랭크일 시퀀스. 진입 랭크일 다음부터, bar ≤ entryBar+window 범위.
 * 미도달 시 null.
 */
export function firstRs97AfterEntry(
  rankList: readonly RankDay[],
  entryRankIdx: number
): number | null {
  const entryBar = rankList[entryRankIdx].bar;
  const maxBar = entryBar + RS_CONST.h6WindowDays;
  for (let t = entryRankIdx + 1; t < rankList.length; t++) {
    const rd = rankList[t];
    if (rd.bar > maxBar) break;
    if (rd.rank >= RS_CONST.rs97Threshold) return rd.bar;
  }
  return null;
}
