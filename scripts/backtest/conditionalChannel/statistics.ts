// scripts/backtest/conditionalChannel/statistics.ts
// ---------------------------------------------------------------------------
// 조건부 돌파 채널 가설(PROMPT_3 §7·§12) — 통계 검정 순수 로직.
//
//   · 1차 추정량 I = ΔA − ΔB, ΔA = mean(R20A − R55A), ΔB = mean(R20B − R55B)(§7).
//   · 60거래일 블록 부트스트랩(종목·시장 동시 충격 보존) — 점추정·95% CI·양측 p값(§12.1).
//   · 시장·월별 A그룹 비중 보존 1,000회 라벨 순열(제약 셔플, §12.3).
//   · Holm 다중비교 보정(보조 검정, §12.1).
//   · 시드 결정론 PRNG(mulberry32) — Math.random 절대 금지, 바이트 재현성 보장(§4-4·§9-11).
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직), 외부 I/O 없음, Math.random 없음(결정론).
// ---------------------------------------------------------------------------

import type {
  EstimateWithInterval,
  InteractionEstimate,
  Market,
  StatisticalPlan,
} from '../../../types/backtestConditionalChannel';

// ===========================================================================
// 0. 시드 결정론 PRNG — mulberry32(작고 자기완결적, 의존성 0)
// ===========================================================================

/**
 * mulberry32 시드 PRNG. 같은 시드 → 같은 난수열(바이트 재현성, §9-11).
 * 반환 함수는 매 호출 [0,1) 균등 난수를 낸다. Math.random을 절대 쓰지 않는다.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [0, n) 정수 난수(균등). rng는 mulberry32 등 [0,1) 생성기. */
export function randomInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

// ===========================================================================
// 1. 기초 통계 — 평균·쌍차·추정량
// ===========================================================================

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 쌍별 차 d[t] = a[t] − b[t]. 길이가 다르면 짧은 쪽에 맞춘다. */
export function pairedDiff(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.min(a.length, b.length);
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] - b[i];
  return out;
}

/** ΔA = mean(R20A − R55A) (§7). r20/r55는 동일 위험 기준 일별 수익률(비용 차감). */
export function deltaEstimate(r20: readonly number[], r55: readonly number[]): number {
  return mean(pairedDiff(r20, r55));
}

/** I = ΔA − ΔB (§7 1차 상호작용 추정량). */
export function interaction(deltaA: number, deltaB: number): number {
  return deltaA - deltaB;
}

// ===========================================================================
// 2. 백분위 · 신뢰구간 — 선형보간 percentile
// ===========================================================================

/**
 * 정렬 배열의 p분위(0~100) — 선형보간법(numpy 'linear'와 동일).
 * sorted는 오름차순 정렬 완료 가정.
 */
export function percentileSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ===========================================================================
// 3. 60거래일 블록 부트스트랩 (§12.1)
// ===========================================================================

/**
 * 블록 부트스트랩 인덱스 시퀀스 생성(§12.1): 원 길이 n을 채울 때까지 시작점을 무작위로 골라
 * 연속 blockDays 블록을 이어 붙인다(복원추출, 순환). 블록 내 동시성(종목·시장 동시충격)을 보존한다.
 * 결정론적(rng 시드 고정).
 */
export function blockBootstrapIndices(
  n: number,
  blockDays: number,
  rng: () => number
): number[] {
  const idx: number[] = [];
  if (n <= 0) return idx;
  const block = Math.max(1, Math.min(blockDays, n));
  while (idx.length < n) {
    const start = randomInt(rng, n);
    for (let k = 0; k < block && idx.length < n; k++) {
      idx.push((start + k) % n); // 순환(끝을 넘으면 처음으로)
    }
  }
  return idx;
}

function meanOverIndices(series: readonly number[], indices: readonly number[]): number {
  if (indices.length === 0) return 0;
  let s = 0;
  for (const i of indices) s += series[i];
  return s / indices.length;
}

/** 부트스트랩 표본 배열에서 EstimateWithInterval 조립(양측 p값·percentile CI). */
function summarize(
  pointEstimate: number,
  samples: number[],
  plan: StatisticalPlan,
  seed: number
): EstimateWithInterval {
  const sorted = [...samples].sort((a, b) => a - b);
  const alpha = (1 - plan.confidenceLevel) / 2;
  const ciLower = percentileSorted(sorted, alpha * 100);
  const ciUpper = percentileSorted(sorted, (1 - alpha) * 100);
  // 양측 p값: 0을 기준으로 부트스트랩 분포의 반대편 비율×2(문서화된 방법).
  const nboot = sorted.length;
  let leq = 0;
  let geq = 0;
  for (const s of sorted) {
    if (s <= 0) leq++;
    if (s >= 0) geq++;
  }
  const pValue = nboot > 0 ? Math.min(1, 2 * Math.min(leq / nboot, geq / nboot)) : 1;
  return {
    pointEstimate,
    ciLower,
    ciUpper,
    pValue,
    confidenceLevel: plan.confidenceLevel,
    bootstrapIterations: nboot,
    seed,
  };
}

/**
 * ΔA·ΔB·I의 60거래일 블록 부트스트랩(§12.1). dA[t]=R20A−R55A, dB[t]=R20B−R55B의 일별 시계열을
 * 입력받아, 매 반복 같은 블록 인덱스로 ΔA·ΔB를 함께 재추정한다(동시 충격 보존). I=ΔA−ΔB.
 * 점추정은 전표본 평균, CI/p는 부트스트랩 분포.
 */
export function blockBootstrapInteraction(
  dA: readonly number[],
  dB: readonly number[],
  plan: StatisticalPlan,
  market: Market | 'COMBINED_50_50',
  configHash: string,
  evidenceGrade: InteractionEstimate['evidenceGrade']
): InteractionEstimate {
  const n = Math.min(dA.length, dB.length);
  const rng = mulberry32(plan.bootstrapSeed);
  const bootA: number[] = [];
  const bootB: number[] = [];
  const bootI: number[] = [];
  for (let it = 0; it < plan.bootstrapIterations; it++) {
    const indices = blockBootstrapIndices(n, plan.blockBootstrapBlockDays, rng);
    const a = meanOverIndices(dA, indices);
    const b = meanOverIndices(dB, indices);
    bootA.push(a);
    bootB.push(b);
    bootI.push(a - b);
  }
  const pointA = mean(dA.slice(0, n));
  const pointB = mean(dB.slice(0, n));
  return {
    market,
    deltaA: summarize(pointA, bootA, plan, plan.bootstrapSeed),
    deltaB: summarize(pointB, bootB, plan, plan.bootstrapSeed),
    interactionI: summarize(pointA - pointB, bootI, plan, plan.bootstrapSeed),
    evidenceGrade,
    configHash,
  };
}

// ===========================================================================
// 4. Holm 단계적 하강 다중비교 보정 (§12.1)
// ===========================================================================

/**
 * Holm step-down 보정(§12.1). 입력 p값 배열 → 보정 p값 배열(입력과 동일 순서).
 * 오름차순 정렬 후 (m − i) 곱, 단조 증가 보정, [0,1] 클램프.
 */
export function holmAdjust(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adjustedSorted: number[] = new Array(m);
  let runningMax = 0;
  for (let k = 0; k < m; k++) {
    const factor = m - k;
    let adj = Math.min(1, indexed[k].p * factor);
    if (adj < runningMax) adj = runningMax; // 단조 증가 강제
    else runningMax = adj;
    adjustedSorted[k] = adj;
  }
  const out: number[] = new Array(m);
  for (let k = 0; k < m; k++) out[indexed[k].i] = adjustedSorted[k];
  return out;
}

// ===========================================================================
// 5. 라벨 순열 검정 — 시장·월별 A그룹 비중 보존(제약 셔플, §12.3)
// ===========================================================================

/** 순열 검정 한 종목 단위: 어느 시장·월에 속하고 실제 A인지. */
export interface LabelUnit {
  securityId: string;
  stratum: string; // 시장·월 식별자(예: 'US:2020-04')
  isA: boolean;    // 실제 라벨(A=true, B=false)
}

/**
 * Fisher–Yates 셔플(시드 결정론). 원배열을 변형하지 않고 새 배열 반환.
 */
export function seededShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 라벨 순열 결과 맵의 복합 키 구분자. `${stratum}${LABEL_KEY_SEP}${securityId}`.
 * ⚠ Bug3 수정: 예전엔 securityId만으로 키를 잡아, 같은 종목이 여러 층(다른 월)에 등장하면
 * 뒤 층이 앞 층을 덮어써 월 차원이 소실됐다. 층(stratum)을 키에 포함해 층별로 독립 보존한다.
 */
export const LABEL_KEY_SEP = '::';

/** 라벨 순열/관측 라벨 맵의 복합 키를 만든다: `${stratum}::${securityId}`. */
export function labelKey(stratum: string, securityId: string): string {
  return `${stratum}${LABEL_KEY_SEP}${securityId}`;
}

/**
 * 제약 라벨 순열(§12.3): 각 (시장·월) 층 내에서 A/B 라벨을 무작위 재배정하되 그 층의 A 개수는
 * 보존한다(전체 무작위 셔플이 아니라 층별 비중 보존). 결정론적(rng 시드 고정).
 *
 * @returns `${stratum}::${securityId}` 복합 키 → 순열된 라벨(A=true). 각 층의 A 개수는 입력과 동일.
 *   ⚠ Bug3 수정 전에는 securityId만 키로 써서 같은 종목이 다른 층에 있으면 충돌·덮어쓰기가 났다.
 *   이제 층을 키에 포함해 (US:2020-03의 a1)과 (US:2020-04의 a1)이 독립적으로 살아남는다.
 */
export function constrainedLabelPermutation(
  units: readonly LabelUnit[],
  rng: () => number
): Map<string, boolean> {
  const byStratum = new Map<string, LabelUnit[]>();
  for (const u of units) {
    const arr = byStratum.get(u.stratum) ?? [];
    arr.push(u);
    byStratum.set(u.stratum, arr);
  }
  const out = new Map<string, boolean>();
  // 층 순회 순서를 결정론적으로 고정(stratum 키 정렬).
  const strata = Array.from(byStratum.keys()).sort();
  for (const stratum of strata) {
    const members = byStratum.get(stratum) as LabelUnit[];
    const aCount = members.filter((m) => m.isA).length;
    // securityId 정렬로 셔플 입력 순서 고정 → 시드만으로 완전 재현.
    const ordered = [...members].sort((a, b) =>
      a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0
    );
    const shuffled = seededShuffle(ordered, rng);
    shuffled.forEach((m, i) => out.set(labelKey(m.stratum, m.securityId), i < aCount));
  }
  return out;
}

export interface PermutationTestResult {
  observedStatistic: number;   // 실제 라벨에서의 통계량(예: I 또는 ADAPTIVE−REVERSE)
  permutedStatistics: number[]; // 각 순열의 통계량
  pValue: number;              // 단측: P(perm ≥ observed)
  percentile95: number;        // 순열 분포 95백분위(§13-9)
  permutationCount: number;
  seed: number;
}

/**
 * 라벨 순열 검정 실행(§12.3·§13-9). 실제 분류가 임의 분할보다 특별한지 검정한다.
 * statisticOf: 라벨 배정을 받아 관심 통계량을 계산하는 순수 콜백
 *   (시뮬레이션 재실행 등은 호출부 책임 — 여기서는 라벨 셔플과 통계 집계만 결정론적으로 담당).
 *
 * ⚠ 라벨 맵의 키 형식(Bug3): `observedLabels`와 `constrainedLabelPermutation`이 반환하는 맵은
 *   모두 **복합 키** `${stratum}::${securityId}`(= labelKey())를 쓴다. statisticOf 콜백은 이 형식으로
 *   맵을 조회해야 하며, securityId만으로 조회하면 안 된다(같은 종목이 여러 층에 있으면 충돌).
 */
export function runLabelPermutationTest(
  units: readonly LabelUnit[],
  observedLabels: ReadonlyMap<string, boolean>,
  statisticOf: (labels: ReadonlyMap<string, boolean>) => number,
  plan: StatisticalPlan
): PermutationTestResult {
  const observedStatistic = statisticOf(observedLabels);
  const rng = mulberry32(plan.permutationSeed);
  const permuted: number[] = [];
  for (let it = 0; it < plan.permutationCount; it++) {
    const labels = constrainedLabelPermutation(units, rng);
    permuted.push(statisticOf(labels));
  }
  let geq = 0;
  for (const s of permuted) if (s >= observedStatistic) geq++;
  const sorted = [...permuted].sort((a, b) => a - b);
  return {
    observedStatistic,
    permutedStatistics: permuted,
    pValue: permuted.length > 0 ? geq / permuted.length : 1,
    percentile95: percentileSorted(sorted, 95),
    permutationCount: permuted.length,
    seed: plan.permutationSeed,
  };
}
