// scripts/backtest/lectureSignals/quality.ts
// ---------------------------------------------------------------------------
// 3차 배치 — RS 90 진입 품질 특성 Q1~Q9(§9.3) + 2단계 확인 설계(§9.4) + RS 코호트
// 보유열화 H1/H2/H6 이벤트 스터디(§8). 순수 계산(외부 I/O·console 없음).
//
// 재사용: forwardReturns(전방·MAE·MFE), eventStats(블록부트스트랩·연도분해·상위기여·Holm),
//   factorPanel(§5.6 분해), events.testSignalAt(S3 상한가=Q3), rs.ts(진입·에피소드·상태기계).
//
// 규칙: `any`·`console.*`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import type { Market, SamplePeriod, SecurityBars } from './configTypes';
import { CONST } from './configTypes';
import type { LectureDataset, RegimeSeries } from './dataAccess';
import { pitLookup } from './dataAccess';
import { CrossSectionCache, normMarket } from './batch2Common';
import { testSignalAt } from './events';
import { priorMean, realizedVol, returnK } from './features';
import type { ForwardResult, IndexLevelLookup } from './forwardReturns';
import { computeForward } from './forwardReturns';
import {
  buildCrossSection,
  factorLabels,
  stockFeaturesAt,
  type CrossSection,
  type FactorPanelLabels,
  type StockFeatures,
} from './factorPanel';
import {
  bootstrapDiff,
  decomposeByYear,
  holmAdjust,
  median,
  summarize,
  topContributorRemoval,
  type DiffEstimate,
  type EventSummary,
  type StatEvent,
} from './eventStats';
import { mulberry32, percentileSorted, randomInt } from '../conditionalChannel/statistics';
import {
  computeRs50ToRs90,
  countBoomBustCycles,
  detectRsEntries,
  firstPostEntryRunup,
  firstRs5070StallAfterEntry,
  firstRs97AfterEntry,
  firstRsBelow50AfterEntry,
  RS_CONST,
  type RankDay,
  type RsEntryEvent,
  type RsRanks,
} from './rs';
import { FACTOR_DECOMP_AXES } from './pipeline';

// ===========================================================================
// Q1~Q9 진입 품질 특성(§9.3) — 전부 진입일 D 기준, 미래참조 없음
// ===========================================================================

export type QCode = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9';
export const Q_CODES: readonly QCode[] = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'];

/** 각 Q의 유리 방향: 'LOW'=값이 낮을수록 우수, 'HIGH'=값이 높을수록 우수(§9.3 가설 방향). */
export const Q_DIRECTION: Record<QCode, 'LOW' | 'HIGH'> = {
  Q1: 'LOW', // 21일 수익률 30% 미만 우수
  Q2: 'LOW', // 최근 63일 일간 +20% 이력 없음 우수
  Q3: 'LOW', // 최근 63일 상한가 0회 우수
  Q4: 'HIGH', // 50→90 소요기간 길수록 우수
  Q5: 'HIGH', // 시총 상위 1/3 우수
  Q6: 'LOW', // 거래량 과다 낮을수록 우수
  Q7: 'LOW', // 변동성 낮을수록 우수
  Q8: 'LOW', // 윗꼬리 적을수록 우수
  Q9: 'LOW', // 붐버스트 반복 적을수록 우수
};

export const Q_LABEL: Record<QCode, string> = {
  Q1: 'Q1_RETURN_21D',
  Q2: 'Q2_MAX_DAILY_RETURN_63D',
  Q3: 'Q3_LIMIT_UP_COUNT_63D',
  Q4: 'Q4_DAYS_RS50_TO_RS90',
  Q5: 'Q5_SIZE_PERCENTILE',
  Q6: 'Q6_VOLUME_EXCESS_60D',
  Q7: 'Q7_REALIZED_VOL_63D',
  Q8: 'Q8_UPPER_WICK_COUNT_60D',
  Q9: 'Q9_BOOM_BUST_COUNT_252D',
};

export interface QFeatures {
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null; // days(censored는 504로 캡)
  q4Censored: boolean;
  q5: number | null;
  q6: number | null;
  q7: number | null;
  q8: number | null;
  q9: number | null;
}

/** Q2: 최근 63일(t∈[i-62,i]) 일간수익률의 최댓값. */
function maxDailyReturn63(adjClose: readonly number[], i: number): number | null {
  const start = i - 62;
  if (start - 1 < 0) return null; // r[start]=close[start]/close[start-1] 필요
  let mx = -Infinity;
  for (let t = start; t <= i; t++) {
    const prev = adjClose[t - 1];
    if (!(prev > 0)) return null;
    const r = adjClose[t] / prev - 1;
    if (r > mx) mx = r;
  }
  return Number.isFinite(mx) ? mx : null;
}

/** Q3: 최근 63일(j∈[i-62,i]) S3 상한가 판정 횟수(§7.1 로직 재사용). */
function limitUpCount63(bars: SecurityBars, i: number, corpActionDates: ReadonlySet<string>): number | null {
  const start = i - 62;
  if (start < 0) return null;
  let c = 0;
  for (let j = start; j <= i; j++) if (testSignalAt('S3_LIMIT_UP', bars, j, corpActionDates)) c++;
  return c;
}

/** Q6: 최근 60일(j∈[i-59,i]) adj_volume/직전20일평균 adj_volume 의 최댓값(§5.6 adj_volume 사용). */
function volumeExcess60(adjVolume: readonly number[], i: number): number | null {
  const start = i - 59;
  if (start < 0) return null;
  let mx = -Infinity;
  for (let j = start; j <= i; j++) {
    const base = priorMean(adjVolume, j, RS_CONST.amountAvgWindow);
    if (base === null || base <= 0) continue;
    const m = adjVolume[j] / base;
    if (m > mx) mx = m;
  }
  return Number.isFinite(mx) ? mx : null;
}

/** Q8: 최근 60일(j∈[i-59,i]) 중 (adj_high-adj_close)/adj_high ≥ 5%인 날 수. */
function upperWickCount60(bars: SecurityBars, i: number): number | null {
  const start = i - 59;
  if (start < 0) return null;
  let c = 0;
  for (let j = start; j <= i; j++) {
    const h = bars.adjHigh[j];
    if (!(h > 0)) continue;
    if ((h - bars.adjClose[j]) / h >= 0.05) c++;
  }
  return c;
}

/**
 * 진입일 D(bar i)에서 Q1~Q9 계산. rankList/entryRankIdx는 Q4·에피소드용, pit는 Q5용.
 */
export function computeQFeatures(
  bars: SecurityBars,
  i: number,
  rankList: readonly RankDay[],
  entryRankIdx: number,
  ds: LectureDataset,
  corpActionDates: ReadonlySet<string>
): QFeatures {
  const q1 = returnK(bars.adjClose, i, 21);
  const q2 = maxDailyReturn63(bars.adjClose, i);
  const q3 = limitUpCount63(bars, i, corpActionDates);
  const rs50 = computeRs50ToRs90(rankList, entryRankIdx);
  const q4 = rs50.days;
  const q5rec = pitLookup(ds.pit, bars.code, bars.dates[i]);
  const q5 = q5rec ? q5rec.percentile : null;
  const q6 = volumeExcess60(bars.adjVolume, i);
  const q7 = realizedVol(bars.adjClose, i, 63);
  const q8 = upperWickCount60(bars, i);
  const winStart = Math.max(0, i - (RS_CONST.boomBustWindowDays - 1));
  const q9 = countBoomBustCycles(bars.adjClose.slice(winStart, i + 1));
  return { q1, q2, q3, q4, q4Censored: rs50.censored, q5, q6, q7, q8, q9 };
}

function qValue(q: QFeatures, code: QCode): number | null {
  switch (code) {
    case 'Q1':
      return q.q1;
    case 'Q2':
      return q.q2;
    case 'Q3':
      return q.q3;
    case 'Q4':
      return q.q4;
    case 'Q5':
      return q.q5;
    case 'Q6':
      return q.q6;
    case 'Q7':
      return q.q7;
    case 'Q8':
      return q.q8;
    case 'Q9':
      return q.q9;
    default:
      return null;
  }
}

// ===========================================================================
// 진입 이벤트 강화(전방수익·팩터)
// ===========================================================================

export interface EnrichedEntry {
  code: string;
  market: Market;
  date: string;
  year: number;
  entryMonth: string; // YYYY-MM(대조군 코호트 키)
  bar: number;
  rankDayIdx: number;
  q: QFeatures;
  forward: ForwardResult;
  factors: FactorPanelLabels;
}

/**
 * 전 종목 RS90 진입 이벤트를 스캔하고 Q1~Q9·전방수익·§5.6 팩터·H1/H2/H6/H7/H8 경고까지 채운다.
 *
 * 룩어헤드 규율:
 *   · 진입 판정·에피소드 상태는 **전 기간 랭크일 시퀀스**를 처음부터 순회해 만든다(표본기간
 *     경계에서 에피소드 상태가 리셋되지 않도록). 표본 분할은 **진입일 날짜로만** 한다.
 *   · Q1~Q9는 전부 진입일 D까지의 정보. 팩터는 D의 횡단면. 전방수익·H 경고만 D 이후를 본다.
 *   · rsRank는 `buildRsRanks(ds, toDate)`가 `toDate`(=검증표본 끝) 이하만 계산하므로
 *     잠금표본(2023-2025) 랭킹은 존재하지 않는다.
 */
export function buildRsEntries(
  ds: LectureDataset,
  ranks: RsRanks,
  regime: RegimeSeries,
  index: IndexLevelLookup,
  csCache: CrossSectionCache
): EnrichedEntryWithWarn[] {
  const out: EnrichedEntryWithWarn[] = [];
  const codes = [...ranks.rankByCode.keys()].sort(); // 결정론적 순회
  for (const code of codes) {
    const bars = ds.bars.get(code);
    const arr = ranks.rankByCode.get(code);
    if (!bars || !arr) continue;
    const { entries, rankList } = detectRsEntries(bars, arr);
    if (entries.length === 0) continue;
    for (const ev of entries) {
      const i = ev.bar;
      const date = bars.dates[i];
      const market = normMarket(bars.market[i]);
      if (market === null) continue;
      const q = computeQFeatures(bars, i, rankList, ev.rankDayIdx, ds, ds.corpActionDates);
      const forward = computeForward(bars, i, CONST.forwardHorizons, index);
      const cs = csCache.get(date);
      const feat = cs.byCode.get(code);
      const regimeRisk = regime.riskAtOrBefore('KR150_LEVEL', date) === true;
      const factors: FactorPanelLabels = feat
        ? factorLabels(feat, cs, regimeRisk)
        : {
            market,
            size: 'NA',
            liquidityTertile: 'NA',
            volumeMultiple: 'NA',
            ret5Tertile: 'NA',
            ret21Tertile: 'NA',
            ret63Tertile: 'NA',
            dailyReturn: 'NA',
            dailyAbsShock: 'NA',
            vol20Tertile: 'NA',
            vol63Tertile: 'NA',
            regime: regimeRisk ? 'RISK' : 'NORMAL',
          };
      out.push({
        code,
        market,
        date,
        year: Number(date.slice(0, 4)),
        entryMonth: date.slice(0, 7),
        bar: i,
        rankDayIdx: ev.rankDayIdx,
        q,
        forward,
        factors,
        warn: computeHWarnings(bars, ev, rankList),
      });
    }
  }
  out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.code < b.code ? -1 : 1));
  return out;
}

/** 표본기간 필터(진입일 기준). */
export function entriesInPeriod(
  entries: readonly EnrichedEntryWithWarn[],
  period: SamplePeriod
): EnrichedEntryWithWarn[] {
  return entries.filter((e) => e.date >= period.from && e.date <= period.to);
}

/** Q4 검열(504+) 비율 등 진입 코호트 기술통계(리포트용). */
export function describeEntries(entries: readonly EnrichedEntryWithWarn[]): {
  n: number;
  uniqueCodes: number;
  years: number;
  kospi: number;
  kosdaq: number;
  q4CensoredRate: number;
  qMissingRate: Record<QCode, number>;
} {
  const n = entries.length;
  const qMissingRate = {} as Record<QCode, number>;
  for (const c of Q_CODES) {
    const miss = entries.filter((e) => {
      const v = qValue(e.q, c);
      return v === null || !Number.isFinite(v);
    }).length;
    qMissingRate[c] = n ? miss / n : 0;
  }
  return {
    n,
    uniqueCodes: new Set(entries.map((e) => e.code)).size,
    years: new Set(entries.map((e) => e.year)).size,
    kospi: entries.filter((e) => e.market === 'KOSPI').length,
    kosdaq: entries.filter((e) => e.market === 'KOSDAQ').length,
    q4CensoredRate: n ? entries.filter((e) => e.q.q4Censored).length / n : 0,
    qMissingRate,
  };
}

// ===========================================================================
// 2단계 확인 — 개발표본 스크리닝(§9.4)
// ===========================================================================

/** (값, code) 오름차순 3분위 위치 배정: 정렬 위치 기반 등분(동률은 code로 결정론 분리). */
function tercileByPosition<T extends { code: string; value: number }>(
  items: readonly T[]
): { low: T[]; mid: T[]; high: T[] } {
  const sorted = [...items].sort((a, b) =>
    a.value !== b.value ? a.value - b.value : a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  );
  const n = sorted.length;
  const c1 = Math.floor(n / 3);
  const c2 = Math.floor((2 * n) / 3);
  return { low: sorted.slice(0, c1), mid: sorted.slice(c1, c2), high: sorted.slice(c2) };
}

const meanOf = (xs: readonly number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;

/**
 * 날짜 군집 보존 두 그룹 평균차 부트스트랩(§5.5). 그룹은 전표본 3분위로 사전 고정(사전등록 알고리즘),
 * 부트스트랩은 이벤트를 날짜 블록(≈60거래일)으로 재표집해 mean(fav)−mean(unfav)를 재추정.
 */
function bootstrapTwoGroupDiff(
  events: readonly { date: string; group: 'F' | 'U'; excess: number }[],
  seed: number
): DiffEstimate {
  const favAll = events.filter((e) => e.group === 'F').map((e) => e.excess);
  const unfAll = events.filter((e) => e.group === 'U').map((e) => e.excess);
  const point = meanOf(favAll) - meanOf(unfAll);
  if (favAll.length < 2 || unfAll.length < 2) {
    return { point: Number.isFinite(point) ? point : 0, ciLower: NaN, ciUpper: NaN, pValue: 1 };
  }
  const byDate = new Map<string, { group: 'F' | 'U'; excess: number }[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push({ group: e.group, excess: e.excess });
    byDate.set(e.date, arr);
  }
  const dates = [...byDate.keys()].sort();
  // 성능: 날짜→일련일수를 1회 선계산(초판은 반복마다 Date.parse를 호출해 수천만 회 파싱했다).
  // 블록 경계 판정 결과는 동일하다(UTC 자정 기준 정수 일수 차이).
  const dayNum = dates.map((d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000));
  const perDate = dates.map((d) => byDate.get(d) ?? []);
  const target = events.length;
  const blockCalDays = 84;
  const rng = mulberry32(seed);
  const samples: number[] = [];
  for (let it = 0; it < CONST.bootstrapIterations; it++) {
    let favSum = 0;
    let favN = 0;
    let unfSum = 0;
    let unfN = 0;
    let collected = 0;
    let guard = 0;
    while (collected < target && guard < target * 4 + 10) {
      const startIdx = randomInt(rng, dates.length);
      const start = dayNum[startIdx];
      for (let j = startIdx; j < dates.length; j++) {
        if (dayNum[j] - start > blockCalDays) break;
        const arr = perDate[j];
        for (let k = 0; k < arr.length; k++) {
          if (arr[k].group === 'F') {
            favSum += arr[k].excess;
            favN++;
          } else {
            unfSum += arr[k].excess;
            unfN++;
          }
          collected++;
        }
        guard++;
        if (collected >= target) break;
      }
      guard++;
    }
    if (favN >= 1 && unfN >= 1) samples.push(favSum / favN - unfSum / unfN);
  }
  samples.sort((a, b) => a - b);
  const alpha = (1 - CONST.confidenceLevel) / 2;
  const ciLower = samples.length ? percentileSorted(samples, alpha * 100) : NaN;
  const ciUpper = samples.length ? percentileSorted(samples, (1 - alpha) * 100) : NaN;
  let leq = 0;
  let geq = 0;
  for (const s of samples) {
    if (s <= 0) leq++;
    if (s >= 0) geq++;
  }
  const n = samples.length;
  const pValue = n > 0 ? Math.min(1, 2 * Math.min(leq / n, geq / n)) : 1;
  return { point, ciLower, ciUpper, pValue };
}

export interface QDevResult {
  code: QCode;
  label: string;
  direction: 'LOW' | 'HIGH';
  nUsed: number;
  favMeanExcess: number; // 유리 3분위 126일 초과 평균
  midMeanExcess: number;
  unfavMeanExcess: number;
  diff: number; // fav − unfav (>0 = 가설방향)
  rawP: number;
  holmP: number;
  ciLower: number;
  ciUpper: number;
  dir1: number; // 2010-2014 diff
  dir2: number; // 2015-2019 diff
  subperiodDirectionOk: boolean; // dir1>0 && dir2>0
  monotonic: boolean; // fav ≥ mid ≥ unfav
  survives: boolean; // HolmP<0.10 && monotonic && subperiodDirectionOk
}

const HORIZON_Q = CONST.d1PrimaryHorizon; // 126일(§5.2 RS 진입 품질 주지표)

/** 개발표본에서 한 특성의 유리/불리 3분위 그룹 이벤트(부트스트랩 입력). */
function groupEventsForQ(
  entries: readonly EnrichedEntry[],
  code: QCode
): { events: { date: string; group: 'F' | 'U'; excess: number }[]; favMean: number; midMean: number; unfavMean: number } {
  const dir = Q_DIRECTION[code];
  const items = entries
    .map((e) => {
      const v = qValue(e.q, code);
      const ex = e.forward.marketExcess[HORIZON_Q];
      return v !== null && Number.isFinite(v) && ex !== null && ex !== undefined
        ? { code: e.code, value: v, date: e.date, excess: ex }
        : null;
    })
    .filter((x): x is { code: string; value: number; date: string; excess: number } => x !== null);
  const { low, mid, high } = tercileByPosition(items);
  const favT = dir === 'LOW' ? low : high;
  const unfT = dir === 'LOW' ? high : low;
  const favMean = meanOf(favT.map((x) => x.excess));
  const midMean = meanOf(mid.map((x) => x.excess));
  const unfavMean = meanOf(unfT.map((x) => x.excess));
  const events = [
    ...favT.map((x) => ({ date: x.date, group: 'F' as const, excess: x.excess })),
    ...unfT.map((x) => ({ date: x.date, group: 'U' as const, excess: x.excess })),
  ];
  return { events, favMean, midMean, unfavMean };
}

/**
 * 개발표본(2010-2019) 9특성 스크리닝(§9.4). 9개 주검정 Holm 보정, 2010-2014·2015-2019 방향 일치,
 * 단조성 확인. HolmP<0.10 + 단조성 + 부분기간 방향일치 → 생존.
 */
export function runQDevScreening(devEntries: readonly EnrichedEntry[]): {
  results: QDevResult[];
  survivors: QCode[];
} {
  const sub1 = devEntries.filter((e) => e.year <= 2014);
  const sub2 = devEntries.filter((e) => e.year >= 2015);
  const raw: { code: QCode; g: ReturnType<typeof groupEventsForQ>; diff: DiffEstimate }[] = [];
  let seed = CONST.masterSeed + 3000;
  for (const code of Q_CODES) {
    const g = groupEventsForQ(devEntries, code);
    const diff = bootstrapTwoGroupDiff(g.events, seed);
    seed += 100;
    raw.push({ code, g, diff });
  }
  const holm = holmAdjust(raw.map((r) => r.diff.pValue));
  const results: QDevResult[] = raw.map((r, k) => {
    const dir1 = groupEventsForQ(sub1, r.code);
    const dir2 = groupEventsForQ(sub2, r.code);
    const d1 = dir1.favMean - dir1.unfavMean;
    const d2 = dir2.favMean - dir2.unfavMean;
    const subOk = d1 > 0 && d2 > 0;
    const monotonic = r.g.favMean >= r.g.midMean && r.g.midMean >= r.g.unfavMean;
    const holmP = holm[k];
    const survives = holmP < 0.1 && monotonic && subOk;
    return {
      code: r.code,
      label: Q_LABEL[r.code],
      direction: Q_DIRECTION[r.code],
      nUsed: r.g.events.length,
      favMeanExcess: r.g.favMean,
      midMeanExcess: r.g.midMean,
      unfavMeanExcess: r.g.unfavMean,
      diff: r.diff.point,
      rawP: r.diff.pValue,
      holmP,
      ciLower: r.diff.ciLower,
      ciUpper: r.diff.ciUpper,
      dir1: d1,
      dir2: d2,
      subperiodDirectionOk: subOk,
      monotonic,
      survives,
    };
  });
  return { results, survivors: results.filter((r) => r.survives).map((r) => r.code) };
}

// ===========================================================================
// 2단계 확인 — 검증표본 품질점수 검정(§9.4)
// ===========================================================================

export interface QValidationResult {
  survivors: QCode[];
  nEntries: number;
  topMeanExcess: number;
  bottomMeanExcess: number;
  diff: number; // top − bottom
  ciLower: number;
  ciUpper: number;
  pValue: number;
  passes: boolean; // p<0.05 && diff>=0.02 && diff>0
  note: string;
  /** 품질점수(0~생존특성수) 분포 — 3분위가 동점 덩어리를 가르는 정도를 투명하게 보이기 위함. */
  scoreDistribution: { score: number; events: number }[];
  topN: number;
  bottomN: number;
}

/**
 * 검증표본(2020-2022) 품질점수 검정(§9.4). 생존 특성의 유리=1/불리=0(코호트 중앙값 기준) 동일가중 합산.
 * 품질점수 상위 1/3 vs 하위 1/3의 126일 시장초과수익 차이를 **단 한 번** 검정.
 * 통과 = p<0.05 && 차이≥2%p && 방향(top>bottom) 일치.
 */
export function runQValidation(
  valEntries: readonly EnrichedEntry[],
  survivors: readonly QCode[]
): QValidationResult {
  if (survivors.length === 0) {
    return {
      survivors: [],
      nEntries: 0,
      topMeanExcess: NaN,
      bottomMeanExcess: NaN,
      diff: NaN,
      ciLower: NaN,
      ciUpper: NaN,
      pValue: 1,
      passes: false,
      note: '개발표본 생존 특성 없음 → 품질점수 구성 불가(검정 공허, NO_SURVIVORS).',
      scoreDistribution: [],
      topN: 0,
      bottomN: 0,
    };
  }
  // 코호트 중앙값(검증표본 자체) — 유리/불리 이진화 기준
  const medians: Record<string, number> = {};
  for (const code of survivors) {
    const vals = valEntries
      .map((e) => qValue(e.q, code))
      .filter((v): v is number => v !== null && Number.isFinite(v))
      .sort((a, b) => a - b);
    medians[code] = vals.length ? percentileSorted(vals, 50) : NaN;
  }
  // 사용 가능한 이벤트(모든 생존특성 값 + 126일 초과 존재)
  const scored = valEntries
    .map((e) => {
      const ex = e.forward.marketExcess[HORIZON_Q];
      if (ex === null || ex === undefined) return null;
      let score = 0;
      for (const code of survivors) {
        const v = qValue(e.q, code);
        if (v === null || !Number.isFinite(v)) return null;
        const dir = Q_DIRECTION[code];
        const fav = dir === 'LOW' ? v <= medians[code] : v >= medians[code];
        if (fav) score++;
      }
      return { code: e.code, value: score, date: e.date, excess: ex };
    })
    .filter((x): x is { code: string; value: number; date: string; excess: number } => x !== null);
  const { low, high } = tercileByPosition(scored);
  const topMean = meanOf(high.map((x) => x.excess)); // 품질점수 상위 = 값 큰 쪽
  const bottomMean = meanOf(low.map((x) => x.excess));
  const events = [
    ...high.map((x) => ({ date: x.date, group: 'F' as const, excess: x.excess })),
    ...low.map((x) => ({ date: x.date, group: 'U' as const, excess: x.excess })),
  ];
  const boot = bootstrapTwoGroupDiff(events, CONST.masterSeed + 4000);
  const diff = topMean - bottomMean;
  const passes = boot.pValue < 0.05 && diff >= 0.02 && diff > 0;
  return {
    survivors: [...survivors],
    nEntries: scored.length,
    topMeanExcess: topMean,
    bottomMeanExcess: bottomMean,
    diff,
    ciLower: boot.ciLower,
    ciUpper: boot.ciUpper,
    pValue: boot.pValue,
    passes,
    note: `품질점수 상위1/3(n=${high.length}) vs 하위1/3(n=${low.length}). 중앙값 이진화·동일가중(가중치 최적화 없음).`,
    scoreDistribution: [...new Set(scored.map((s) => s.value))]
      .sort((a, b) => a - b)
      .map((score) => ({ score, events: scored.filter((s) => s.value === score).length })),
    topN: high.length,
    bottomN: low.length,
  };
}

// ===========================================================================
// RS 코호트 보유열화 H1/H2/H6 이벤트 스터디(§8)
// ===========================================================================

export type HCode = 'H1' | 'H2' | 'H6' | 'H7' | 'H8';
export const H_CODES: readonly HCode[] = ['H1', 'H2', 'H6', 'H7', 'H8'];
export const H_LABEL: Record<HCode, string> = {
  H1: 'H1_POST_ENTRY_RUNUP_5D',
  H2: 'H2_POST_ENTRY_RUNUP_21D',
  H6: 'H6_RS_90_TO_97_FAST',
  H7: 'H7_RS_BELOW_50',
  H8: 'H8_RS_50_70_STALL',
};

/**
 * Holm 보정 패밀리(§8.3 · PLAN v2 §2 축A).
 *   · `POST_ENTRY_RUNUP` = {H1, H2} — §8.3이 명시한 "사후 급등" 패밀리(A7의 RS 코호트 판).
 *   · `RS_DETERIORATION` = {H6, H7, H8} — RS 기반 보유열화 A11/A12/A13.
 * 서로 다른 가설 패밀리이므로 별도로 보정한다(§5.5 "동일 가설 패밀리 내 Holm").
 */
export const H_FAMILY: Record<HCode, 'POST_ENTRY_RUNUP' | 'RS_DETERIORATION'> = {
  H1: 'POST_ENTRY_RUNUP',
  H2: 'POST_ENTRY_RUNUP',
  H6: 'RS_DETERIORATION',
  H7: 'RS_DETERIORATION',
  H8: 'RS_DETERIORATION',
};

/**
 * 각 H의 **가설 방향**. 'BAD' = 경고 후 코호트 대비 부진해야 가설 지지(매도/경고 근거).
 * 'NEUTRAL' = 강의가 "한국에선 조치 불필요"라고 주장하므로 **부진이 없어야** 강의 지지(A13).
 */
export const H_DIRECTION: Record<HCode, 'BAD' | 'NEUTRAL'> = {
  H1: 'BAD',
  H2: 'BAD',
  H6: 'BAD',
  H7: 'BAD',
  H8: 'NEUTRAL',
};

/** 진입 이벤트별 각 H 경고 발생 바 인덱스(미발생 null). */
export interface HWarnings {
  h1: number | null;
  h2: number | null;
  h6: number | null;
  h7: number | null;
  h8: number | null;
}

/** HCode → HWarnings 필드 접근(문자열 인덱싱 캐스팅 없이 타입안전). */
export function warnBarOf(w: HWarnings, code: HCode): number | null {
  switch (code) {
    case 'H1':
      return w.h1;
    case 'H2':
      return w.h2;
    case 'H6':
      return w.h6;
    case 'H7':
      return w.h7;
    case 'H8':
      return w.h8;
    default:
      return null;
  }
}

/**
 * 진입(bar, rankList)에서 H1/H2/H6/H7/H8 경고 발생일 계산. 전부 진입 이후 정보만 사용.
 *
 * ⚠ 감사 수정(2026-07-26): H1·H2·H7·H8은 **진입 후 `RS_CONST.hWindowDays`(252거래일) 이내**로
 * 관측창을 제한한다. 초판은 창이 없어 데이터 끝(2025년)까지 탐색했고, 그 결과
 *   · H1이 개발표본 진입의 **99%**(2794/2826)에서 발화해 "경고"의 변별력이 사라졌고,
 *   · 경고일이 **잠금표본(2023-2025)** 으로 넘어가 봉인 규율을 위반했다.
 * H6은 사전등록 §8.1이 정한 21거래일 창을 그대로 쓴다.
 */
export function computeHWarnings(
  bars: SecurityBars,
  entry: RsEntryEvent,
  rankList: readonly RankDay[]
): HWarnings {
  const maxBar = entry.bar + RS_CONST.hWindowDays;
  const cap = (b: number | null): number | null => (b === null || b > maxBar ? null : b);
  return {
    h1: cap(firstPostEntryRunup(bars.adjClose, entry.bar, 5, 0.2)),
    h2: cap(firstPostEntryRunup(bars.adjClose, entry.bar, 21, 0.2)),
    h6: firstRs97AfterEntry(rankList, entry.rankDayIdx), // 사전등록 21일 창
    h7: cap(firstRsBelow50AfterEntry(rankList, entry.rankDayIdx)),
    h8: cap(firstRs5070StallAfterEntry(rankList, entry.rankDayIdx)),
  };
}

export interface HSignalResult {
  code: HCode;
  label: string;
  family: 'POST_ENTRY_RUNUP' | 'RS_DETERIORATION';
  direction: 'BAD' | 'NEUTRAL';
  nWarned: number;
  nCohortControls: number; // 평균 대조군 수(경고일 기준 미발생 코호트)
  summaryByHorizon: Record<number, EventSummary>;
  primaryBootstrap: DiffEstimate;
  yearDecomp: ReturnType<typeof decomposeByYear>;
  topContributor: ReturnType<typeof topContributorRemoval>;
  matchRate: number;
  factorDecomp: FactorDecomp[];
}

const HORIZON_H = CONST.d2PrimaryHorizon; // 63일(§5.2 보유열화 주지표)

/** 진입 이벤트 + 경고일(H 이벤트 스터디 입력). */
export type EnrichedEntryWithWarn = EnrichedEntry & { warn: HWarnings };

/**
 * 한 H 경고의 이벤트 스터디(§8). 처리군 = 경고 발생 진입종목, 결과 = 경고일 `D_w` 후 63일 시장초과.
 *
 * **대조군 정의(감사 수정 2026-07-26, 명시 요구사항)**
 *   대조군 = **같은 진입월(`entryMonth`)의 RS90 진입 코호트 중, 경고일 `D_w` 시점까지 아직 이
 *   경고가 발생하지 않은 종목**(`warnBar === null || warnBar > D_w 바`)의 같은 `D_w` 기준 63일
 *   시장초과 평균. 즉 **not-yet-treated 대조군**이다.
 *
 *   초판은 "표본 전 구간에서 **끝내** 이 경고를 내지 않은 종목"만 대조군에 넣었다. 그건 대조군
 *   선정에 `D_w` 이후 정보(미래에 경고를 낼지 여부)를 쓰는 것이라 **선정 단계 룩어헤드**이고,
 *   대조군이 "끝까지 조용했던 종목"으로 사후 편향된다(H1/H2에선 사실상 '급등 못 한 종목'만 남음).
 *   staggered treatment 이벤트 스터디의 표준 처방대로 not-yet-treated로 교정했다.
 *
 *   대조군은 같은 코호트(같은 달 RS90 진입)이므로 §5.4의 5축 매칭이 아니라 **코호트 매칭**이다.
 *   이 트랙의 질문이 "RS90에 새로 편입된 종목들 중 경고가 뜬 것과 안 뜬 것"이기 때문이다.
 */
export function runHSignal(
  code: HCode,
  enriched: readonly EnrichedEntryWithWarn[],
  index: IndexLevelLookup,
  ds: LectureDataset,
  controlFwd: (c: string, d: string) => ForwardResult | null,
  seed: number,
  /**
   * 경고일 상한(표본기간 끝). 이 날짜를 넘는 경고는 이벤트로 등록하지 않는다.
   *  · 개발표본 경고가 검증표본 날짜로 넘어가는 것을 막고(§4.2 표본 분리),
   *  · 잠금표본(2023-2025) 날짜의 경고를 원천 차단한다.
   * 대조군의 not-yet-treated 판정에는 영향이 없다(상한을 넘는 경고는 D_w 이후이므로 자동으로
   * '아직 미발생'으로 취급된다).
   */
  maxWarnDate: string
): HSignalResult {
  // 진입월 코호트
  const cohortByMonth = new Map<string, EnrichedEntryWithWarn[]>();
  for (const e of enriched) {
    const arr = cohortByMonth.get(e.entryMonth) ?? [];
    arr.push(e);
    cohortByMonth.set(e.entryMonth, arr);
  }

  // 경고 이벤트 1회 계산(호라이즌 전부 동시) — 초판은 호라이즌마다 전방을 재계산했다.
  interface WarnEvent {
    code: string;
    date: string;
    year: number;
    fwd: ForwardResult;
    controlExcess: Record<number, number | null>;
    nControls: number;
    factors: FactorPanelLabels;
  }
  const warnEvents: WarnEvent[] = [];
  for (const e of enriched) {
    const warnBar = warnBarOf(e.warn, code);
    if (warnBar === null) continue;
    const bars = ds.bars.get(e.code);
    if (!bars) continue;
    const warnDate = bars.dates[warnBar];
    if (warnDate > maxWarnDate) continue; // 표본기간·잠금표본 가드
    const fwd = computeForward(bars, warnBar, CONST.forwardHorizons, index);
    const cohort = cohortByMonth.get(e.entryMonth) ?? [];
    // not-yet-treated 대조군 후보(경고일 기준 아직 미발생)
    const ctlCodes: string[] = [];
    for (const c of cohort) {
      if (c.code === e.code) continue;
      const cWarn = warnBarOf(c.warn, code);
      if (cWarn !== null) {
        const cBars = ds.bars.get(c.code);
        const cWarnDate = cBars ? cBars.dates[cWarn] : null;
        if (cWarnDate !== null && cWarnDate <= warnDate) continue; // 이미 경고 발생 → 제외
      }
      ctlCodes.push(c.code);
    }
    const controlExcess: Record<number, number | null> = {};
    let nControls = 0;
    for (const h of CONST.forwardHorizons) {
      const vals: number[] = [];
      for (const cc of ctlCodes) {
        const cf = controlFwd(cc, warnDate);
        const v = cf?.marketExcess[h];
        if (v !== null && v !== undefined) vals.push(v);
      }
      if (h === HORIZON_H) nControls = vals.length;
      controlExcess[h] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }
    warnEvents.push({
      code: e.code,
      date: warnDate,
      year: Number(warnDate.slice(0, 4)),
      fwd,
      controlExcess,
      nControls,
      factors: e.factors,
    });
  }

  const statEventsAt = (h: number): StatEvent[] =>
    warnEvents.map((w) => ({
      code: w.code,
      signal: 'S1_RUNUP_21D_100', // StatEvent.signal 타입 요건 충족용 더미(통계 미사용)
      date: w.date,
      year: w.year,
      excess: w.fwd.marketExcess[h],
      controlExcess: w.controlExcess[h],
      stockReturn: w.fwd.stockReturn[h],
      mae: w.fwd.mae[h],
      mfe: w.fwd.mfe[h],
    }));

  const summaryByHorizon: Record<number, EventSummary> = {};
  for (const h of CONST.forwardHorizons) summaryByHorizon[h] = summarize(statEventsAt(h));

  const primaryStats = statEventsAt(HORIZON_H);
  const primaryBootstrap = bootstrapDiff(primaryStats, seed, 'median');
  const withCtl = primaryStats.filter((e) => e.excess !== null && e.controlExcess !== null).length;
  const withExcess = primaryStats.filter((e) => e.excess !== null).length;
  return {
    code,
    label: H_LABEL[code],
    family: H_FAMILY[code],
    direction: H_DIRECTION[code],
    nWarned: primaryStats.length,
    nCohortControls: warnEvents.length
      ? meanOf(warnEvents.map((w) => w.nControls))
      : 0,
    summaryByHorizon,
    primaryBootstrap,
    yearDecomp: decomposeByYear(primaryStats),
    topContributor: topContributorRemoval(primaryStats),
    matchRate: withExcess ? withCtl / withExcess : 0,
    factorDecomp: factorDecomposition(
      warnEvents.map((w) => ({ factors: w.factors, excess: w.fwd.marketExcess[HORIZON_H] }))
    ),
  };
}

// ===========================================================================
// §5.6 팩터 분해(공통) — Q 진입·H 경고 공용
// ===========================================================================

export interface FactorDecomp {
  axis: string;
  groups: { label: string; events: number; medianExcess: number; inconclusive: boolean }[];
}

/**
 * §5.6 필수 팩터 패널 **전 축(12축)**.
 * ⚠ 감사 수정(2026-07-26): 초판은 `ret5Tertile`·`vol20Tertile`이 빠진 10축이었다 —
 * 1차 배치에서 발견돼 P0로 고친 §5.6 위반(PLAN v2 §1-1 A)이 이 파일에서 그대로 재발해 있었다.
 * 아래 `declared` 검사가 `pipeline.FACTOR_DECOMP_AXES`와의 불일치를 즉시 실패시킨다.
 */
const FACTOR_AXES: { axis: string; get: (f: FactorPanelLabels) => string }[] = [
  { axis: 'market', get: (f) => f.market },
  { axis: 'size', get: (f) => f.size },
  { axis: 'liquidityTertile', get: (f) => f.liquidityTertile },
  { axis: 'volumeMultiple', get: (f) => f.volumeMultiple },
  { axis: 'ret5Tertile', get: (f) => f.ret5Tertile },
  { axis: 'ret21Tertile', get: (f) => f.ret21Tertile },
  { axis: 'ret63Tertile', get: (f) => f.ret63Tertile },
  { axis: 'dailyReturn', get: (f) => f.dailyReturn },
  { axis: 'dailyAbsShock', get: (f) => f.dailyAbsShock },
  { axis: 'vol20Tertile', get: (f) => f.vol20Tertile },
  { axis: 'vol63Tertile', get: (f) => f.vol63Tertile },
  { axis: 'regime', get: (f) => f.regime },
];

/** 이벤트(팩터+결과)의 §5.6 분해표. 구간 <50건은 INCONCLUSIVE. */
export function factorDecomposition(
  events: readonly { factors: FactorPanelLabels; excess: number | null }[]
): FactorDecomp[] {
  const declared = FACTOR_AXES.map((a) => a.axis).join(',');
  if (declared !== FACTOR_DECOMP_AXES.join(',')) {
    throw new Error(`분해 축 불일치(§5.6): ${declared} != ${FACTOR_DECOMP_AXES.join(',')}`);
  }
  return FACTOR_AXES.map(({ axis, get }) => {
    const byLabel = new Map<string, number[]>();
    for (const e of events) {
      if (e.excess === null) continue;
      const lab = get(e.factors);
      const arr = byLabel.get(lab) ?? [];
      arr.push(e.excess);
      byLabel.set(lab, arr);
    }
    const groups = [...byLabel.entries()]
      .map(([label, arr]) => ({
        label,
        events: arr.length,
        medianExcess: median(arr),
        inconclusive: arr.length < CONST.inconclusiveMinEvents,
      }))
      .sort((a, b) => (a.label < b.label ? -1 : 1));
    return { axis, groups };
  });
}

export { buildCrossSection, factorLabels, stockFeaturesAt };
export type { CrossSection, StockFeatures, FactorPanelLabels, EventSummary, StatEvent };
