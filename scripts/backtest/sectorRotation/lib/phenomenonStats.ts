// scripts/backtest/sectorRotation/lib/phenomenonStats.ts
// Phase 1 현상검증 — 순수 통계 함수(리더십 순환 존재 + 예측가능성).
// 연구 전용(앱/백엔드 무접촉). 사전등록(PHASE1_PREREGISTRATION.md) §4~§6 그대로 구현.
// 모든 난수는 시드 고정 PRNG(mulberry32)로 재현 가능. Math.random/Date.now 사용 금지.

import type { MonthlyPanel } from './monthly';
import { futureExcessReturn, buildScoresByMonth } from './monthly';

// ─── 시드 고정 PRNG ───────────────────────────────────────────
/** mulberry32: 32비트 시드 결정론적 PRNG. 같은 시드 → 같은 난수열(재현성). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 기초 통계 헬퍼 ───────────────────────────────────────────
function mean(a: number[]): number {
  return a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function stdevPop(a: number[]): number {
  if (a.length === 0) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

/** 평균 순위(동점은 평균 처리), 1-based. */
function ranks(vals: number[]): number[] {
  const idx = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(vals.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1; // 1-based 평균 순위
    for (let k = i; k <= j; k++) r[idx[k].i] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length;
  if (n < 2) return null;
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// ─── Q1(존재) 지표 ────────────────────────────────────────────
/** 월별 리더(M 1위) 종목 인덱스. 점수 있는 종목이 2개 미만이면 null. */
export function leaderSeries(scoresByMonth: (number | null)[][]): (number | null)[] {
  return scoresByMonth.map(scores => {
    const scored = scores
      .map((v, i) => ({ v, i }))
      .filter((x): x is { v: number; i: number } => x.v !== null);
    if (scored.length < 2) return null;
    let best = scored[0];
    for (const s of scored) if (s.v > best.v) best = s;
    return best.i;
  });
}

/** 리더 평균 연속 유지기간(개월) + 월별 리더 교체확률. */
export function leaderPersistence(leaders: (number | null)[]): {
  meanRunLengthMonths: number;
  monthlyChangeProb: number;
} {
  let pairs = 0;
  let changes = 0;
  for (let i = 1; i < leaders.length; i++) {
    const a = leaders[i - 1];
    const b = leaders[i];
    if (a !== null && b !== null) {
      pairs++;
      if (a !== b) changes++;
    }
  }
  const monthlyChangeProb = pairs > 0 ? changes / pairs : 0;

  // 연속 유지기간: null은 런을 끊는다.
  let runs = 0;
  let count = 0;
  let prev: number | null = null;
  for (const l of leaders) {
    if (l === null) {
      prev = null;
      continue;
    }
    if (l !== prev) runs++;
    count++;
    prev = l;
  }
  const meanRunLengthMonths = runs > 0 ? count / runs : 0;
  return { meanRunLengthMonths, monthlyChangeProb };
}

/** 리더 전환행렬: 월 t 리더 i → 월 t+1 리더 j 의 빈도(둘 다 non-null일 때). */
export function transitionMatrix(leaders: (number | null)[], nSymbols: number): number[][] {
  const m: number[][] = Array.from({ length: nSymbols }, () =>
    new Array<number>(nSymbols).fill(0)
  );
  for (let t = 1; t < leaders.length; t++) {
    const a = leaders[t - 1];
    const b = leaders[t];
    if (a !== null && b !== null) m[a][b]++;
  }
  return m;
}

/** 순위 지속성: 월 t 순위와 t+lag 순위의 Spearman 상관을 t 평균. 둘 다 점수있는 종목만. */
export function spearmanRankAutocorr(scoresByMonth: (number | null)[][], lag: number): number {
  const corrs: number[] = [];
  for (let t = 0; t + lag < scoresByMonth.length; t++) {
    const a = scoresByMonth[t];
    const b = scoresByMonth[t + lag];
    const common: number[] = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== null && b[i] !== null) common.push(i);
    }
    if (common.length < 2) continue;
    const va = common.map(i => a[i] as number);
    const vb = common.map(i => b[i] as number);
    const c = pearson(ranks(va), ranks(vb));
    if (c !== null) corrs.push(c);
  }
  return corrs.length > 0 ? mean(corrs) : 0;
}

/** 횡단면 분산: 월별 종목 1개월수익률의 표준편차(모집단)를 시계열 평균. */
export function crossSectionalDispersion(panel: MonthlyPanel): number {
  const disp: number[] = [];
  for (let t = 1; t < panel.months.length; t++) {
    const rets: number[] = [];
    for (let i = 0; i < panel.symbols.length; i++) {
      const a = panel.close[t - 1][i];
      const b = panel.close[t][i];
      if (typeof a === 'number' && typeof b === 'number' && a !== 0) rets.push(b / a - 1);
    }
    if (rets.length >= 2) disp.push(stdevPop(rets));
  }
  return disp.length > 0 ? mean(disp) : 0;
}

// ─── Q2(예측가능성) 지표 ──────────────────────────────────────
/**
 * 분위 그룹(사전등록 §5):
 * - 'thirds' (US 9종): 상위 floor(n/3) / 하위 floor(n/3).
 * - 'halves' (Global 6종=상위3/하위3, KR=상위절반/하위절반): 상위 floor(n/2) / 하위 floor(n/2).
 * 점수 내림차순 정렬, 동점은 인덱스 오름차순으로 안정 정렬(재현성).
 * 반환은 종목 인덱스 배열.
 */
export function terciles(
  scores: (number | null)[],
  mode: 'thirds' | 'halves'
): { top: number[]; bottom: number[] } {
  const scored = scores
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null);
  scored.sort((a, b) => b.v - a.v || a.i - b.i);
  const n = scored.length;
  const groupSize = mode === 'thirds' ? Math.floor(n / 3) : Math.floor(n / 2);
  if (groupSize < 1) return { top: [], bottom: [] };
  const top = scored.slice(0, groupSize).map(x => x.i);
  const bottom = scored.slice(n - groupSize).map(x => x.i);
  return { top, bottom };
}

function groupMeanExcess(
  panel: MonthlyPanel,
  T: number,
  group: number[],
  h: number
): number | null {
  const vals: number[] = [];
  for (const i of group) {
    const e = futureExcessReturn(panel, T, i, h);
    if (e !== null) vals.push(e);
  }
  return vals.length > 0 ? mean(vals) : null;
}

/**
 * 예측가능성 스프레드(사전등록 §5).
 * 각 월 T에서 상위그룹 미래h초과수익 평균 − 하위그룹 미래h초과수익 평균을 모은 시계열과 그 평균.
 * 그룹이 비거나 미래수익이 없어 계산 불가한 월은 건너뛴다.
 */
export function predictabilitySpread(
  panel: MonthlyPanel,
  scoresByMonth: (number | null)[][],
  h: number,
  mode: 'thirds' | 'halves'
): { spreadByMonth: number[]; meanSpread: number } {
  const spreadByMonth: number[] = [];
  for (let T = 0; T < scoresByMonth.length; T++) {
    const { top, bottom } = terciles(scoresByMonth[T], mode);
    if (top.length === 0 || bottom.length === 0) continue;
    const topEx = groupMeanExcess(panel, T, top, h);
    const botEx = groupMeanExcess(panel, T, bottom, h);
    if (topEx === null || botEx === null) continue;
    spreadByMonth.push(topEx - botEx);
  }
  return { spreadByMonth, meanSpread: spreadByMonth.length > 0 ? mean(spreadByMonth) : 0 };
}

// ─── 통계적 엄밀성(사전등록 §6) ───────────────────────────────
/**
 * 이동블록 부트스트랩: 스프레드 월별 시계열을 블록길이 blockLen(기본 12),
 * resamples(기본 5000)회 재표본 → 95% 신뢰구간. 시드 고정 PRNG.
 * 각 재표본은 원 길이 n에 도달할 때까지 블록을 이어 붙인다.
 */
export function blockBootstrapCI(
  series: number[],
  blockLen = 12,
  resamples = 5000,
  seed = 1
): { lo: number; hi: number; mean: number } {
  const n = series.length;
  const overallMean = mean(series);
  if (n < 2) return { lo: overallMean, hi: overallMean, mean: overallMean };
  const rng = mulberry32(seed);
  const bl = Math.min(blockLen, n);
  const numBlocks = Math.ceil(n / bl);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    let cnt = 0;
    for (let b = 0; b < numBlocks && cnt < n; b++) {
      const start = Math.floor(rng() * (n - bl + 1));
      for (let k = 0; k < bl && cnt < n; k++) {
        sum += series[start + k];
        cnt++;
      }
    }
    means.push(sum / cnt);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(0.025 * resamples)];
  const hi = means[Math.floor(0.975 * resamples)];
  return { lo, hi, mean: overallMean };
}

/** 각 월의 점수(=순위)를 무작위 치환(시드 PRNG Fisher-Yates). 점수있는 위치끼리만 섞는다. */
function permuteScored(scores: (number | null)[], rng: () => number): (number | null)[] {
  const idxs: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] !== null) {
      idxs.push(i);
      vals.push(scores[i] as number);
    }
  }
  for (let k = vals.length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    const tmp = vals[k];
    vals[k] = vals[j];
    vals[j] = tmp;
  }
  const out: (number | null)[] = new Array<number | null>(scores.length).fill(null);
  for (let m = 0; m < idxs.length; m++) out[idxs[m]] = vals[m];
  return out;
}

/** 점수있는 종목이 minScored 미만인 월은 전체 null 처리(동적 유니버스 저검정력 방어). */
export function maskMinScored(
  scoresByMonth: (number | null)[][],
  minScored: number
): (number | null)[][] {
  return scoresByMonth.map(scores => {
    const cnt = scores.reduce<number>((c, v) => c + (v !== null ? 1 : 0), 0);
    if (cnt < minScored) return scores.map(() => null);
    return scores.slice();
  });
}

/**
 * 무작위 대조군(사전등록 §6): 각 월의 모멘텀 순위를 무작위 치환한 뒤 동일 스프레드를
 * resamples(기본 5000)회 계산 → 귀무분포. 실제 스프레드의 백분위(유사 p값)를 보고.
 * minScored: KR 등 동적 유니버스에서 점수있는 종목이 이 수 미만인 월 배제(기본 2).
 * percentile = 귀무분포 중 actualSpread 이하인 비율.
 */
export function randomControlNull(
  panel: MonthlyPanel,
  h: number,
  mode: 'thirds' | 'halves',
  resamples = 5000,
  seed = 1,
  minScored = 2
): { actualSpread: number; nullMean: number; percentile: number } {
  const scoresByMonth = maskMinScored(buildScoresByMonth(panel), minScored);
  const actualSpread = predictabilitySpread(panel, scoresByMonth, h, mode).meanSpread;
  const rng = mulberry32(seed);
  const nullSpreads: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const permuted = scoresByMonth.map(scores => permuteScored(scores, rng));
    nullSpreads.push(predictabilitySpread(panel, permuted, h, mode).meanSpread);
  }
  const nullMean = mean(nullSpreads);
  const below = nullSpreads.reduce<number>((c, v) => c + (v <= actualSpread ? 1 : 0), 0);
  const percentile = resamples > 0 ? below / resamples : 0;
  return { actualSpread, nullMean, percentile };
}
