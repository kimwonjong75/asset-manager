// scripts/backtest/sectorRotation/phase1.ts
// Phase 1 현상검증 러너 — 섹터/테마 "순환이 실제로 존재하고 예측 가능한가"를 검증.
// 전략 수익률 백테스트가 아니다(사전등록 PHASE1_PREREGISTRATION.md). 튜닝 금지.
// 연구 전용(앱/백엔드 무접촉, 캐시 우선). 실행: npm run phase1
//
// 초보자용 한글 리포트를 콘솔에 출력하고 phase1_report.json 에 모든 수치를 저장한다.

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchMany } from './lib/yahooData';
import {
  US_SECTOR_FIXED,
  GLOBAL,
  KR_SECTOR,
  JP_SECTOR,
  type UniverseEntry,
} from './lib/universe';
import {
  buildPanel,
  buildScoresByMonth,
  restrictToCommonMonths,
  capMonths,
  type MonthlyPanel,
} from './lib/monthly';
import {
  leaderSeries,
  leaderPersistence,
  transitionMatrix,
  spearmanRankAutocorr,
  crossSectionalDispersion,
  predictabilitySpread,
  blockBootstrapCI,
  randomControlNull,
  maskMinScored,
} from './lib/phenomenonStats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const START = '1990-01-01';
const END = '2026-07-13';
// 마지막 "완료된" 달. END 기준 미완성 당월(2026-07)을 배제한다.
// END를 바꾸면 이 값도 마지막 완료월로 함께 갱신해야 한다.
const LAST_COMPLETE_MONTH = '2026-06';
const REPORT_PATH = path.join(__dirname, 'phase1_report.json');

// 재현성: 고정 시드 상수(트랙·h별로 결정론적으로 파생).
const BASE_SEED = 20260713;
const HS = [1, 3, 6] as const;
const LAGS = [1, 3, 6] as const;
const BOOT_BLOCK = 12;
const RESAMPLES = 5000;
const MIN_MONTHS_POWER = 24; // 이보다 스프레드 표본이 적으면 '검정력 부족' 표기.

type Mode = 'thirds' | 'halves';

interface TrackSpec {
  key: string;
  label: string;
  entries: UniverseEntry[];
  mode: Mode;
  minScored: number;
  primary: boolean; // 1차 증거 여부
  // 사전등록 §1: 전 종목 공통구간만 사용(고정 유니버스). false면 동적 편입(KR).
  requireCommonPeriod: boolean;
  powerNote?: string;
}

const TRACK_SPECS: TrackSpec[] = [
  {
    key: 'US-Sector',
    label: '미국 섹터(주력·1차 증거, 9종·약 1999~)',
    entries: US_SECTOR_FIXED,
    mode: 'thirds',
    // 공통구간 트랙은 부분 유니버스에서 스프레드가 계산되지 않도록 minScored=전체종목수.
    minScored: US_SECTOR_FIXED.length, // 9
    primary: true,
    requireCommonPeriod: true,
  },
  {
    key: 'Global',
    label: '글로벌(국가/금/원자재, 6종·공통구간 ~2011~)',
    entries: GLOBAL,
    mode: 'halves',
    minScored: GLOBAL.length, // 6
    primary: false,
    requireCommonPeriod: true,
  },
  {
    key: 'KR-Sector',
    label: '한국 섹터 ETF(보조 증거·저검정력, 갭절단·동적편입)',
    entries: KR_SECTOR,
    mode: 'halves',
    minScored: 3,
    powerNote: '종목수가 적어 검정력이 낮음(보조 증거).',
    primary: false,
    requireCommonPeriod: false, // 사전등록 §1: KR은 명시적으로 동적 편입.
  },
];

// ─── 소수/퍼센트 표기 헬퍼 ────────────────────────────────────
function pct(v: number, digits = 2): string {
  return `${(v * 100).toFixed(digits)}%`;
}
function num(v: number, digits = 3): string {
  return v.toFixed(digits);
}

interface HResult {
  h: number;
  nMonths: number;
  meanSpread: number;
  ci: { lo: number; hi: number; mean: number };
  control: { actualSpread: number; nullMean: number; percentile: number };
  predictable: boolean;
  direction: 'positive' | 'negative' | 'none';
  lowPower: boolean;
  verdict: string;
}

interface TrackResult {
  key: string;
  label: string;
  mode: Mode;
  minScored: number;
  primary: boolean;
  months: number;
  firstMonth: string | null;
  lastMonth: string | null;
  symbols: string[];
  effN: number;
  q1: {
    distinctLeaders: number;
    leaderLabels: string[];
    meanRunLengthMonths: number;
    monthlyChangeProb: number;
    randomChangeProb: number;
    spearman: Record<string, number>;
    crossSectionalDispersion: number;
    transition: number[][];
    exists: boolean;
    structural: boolean;
    verdict: string;
  };
  q2: HResult[];
  q2Verdict: string;
}

// h별 예측가능성 판정.
function evalH(
  panel: MonthlyPanel,
  scoresMasked: (number | null)[][],
  h: number,
  mode: Mode,
  minScored: number,
  trackIdx: number
): HResult {
  const { spreadByMonth, meanSpread } = predictabilitySpread(panel, scoresMasked, h, mode);
  const bootSeed = BASE_SEED + trackIdx * 1000 + h * 10 + 1;
  const nullSeed = BASE_SEED + trackIdx * 1000 + h * 10 + 2;
  const ci = blockBootstrapCI(spreadByMonth, BOOT_BLOCK, RESAMPLES, bootSeed);
  const control = randomControlNull(panel, h, mode, RESAMPLES, nullSeed, minScored);

  const nMonths = spreadByMonth.length;
  const lowPower = nMonths < MIN_MONTHS_POWER;
  // 예측 가능 = CI가 0을 배제(양수) AND 무작위 대조군 상위(백분위≥0.95).
  const positive = ci.lo > 0 && control.percentile >= 0.95;
  const negative = ci.hi < 0 && control.percentile <= 0.05;
  const predictable = positive || negative;
  const direction: 'positive' | 'negative' | 'none' = positive
    ? 'positive'
    : negative
      ? 'negative'
      : 'none';

  let verdict: string;
  if (nMonths < 2) {
    verdict = '불충분(표본 부족)';
  } else if (predictable) {
    verdict =
      direction === 'positive'
        ? `예측가능 O (상위-하위 스프레드 +, CI가 0 초과, 무작위 상위 ${pct(control.percentile, 1)})`
        : `역방향 신호 (스프레드 −, 무작위 하위 ${pct(control.percentile, 1)})`;
  } else {
    verdict = `예측가능 X (CI가 0을 못 배제하거나 무작위 대조 초과 못함, 백분위 ${pct(control.percentile, 1)})`;
  }
  if (lowPower) verdict += ' · 검정력 부족';

  return { h, nMonths, meanSpread, ci, control, predictable, direction, lowPower, verdict };
}

function analyzeTrack(
  spec: TrackSpec,
  panel: MonthlyPanel,
  trackIdx: number
): TrackResult {
  const scoresRaw = buildScoresByMonth(panel);
  const scores = maskMinScored(scoresRaw, spec.minScored);

  // 유효 유니버스 크기(한 번이라도 점수 받은 종목 수).
  const everScored = new Array<boolean>(panel.symbols.length).fill(false);
  for (const row of scores) for (let i = 0; i < row.length; i++) if (row[i] !== null) everScored[i] = true;
  const effN = everScored.reduce((c, b) => c + (b ? 1 : 0), 0);

  // ── Q1(존재) ──
  const leaders = leaderSeries(scores);
  const persistence = leaderPersistence(leaders);
  const transition = transitionMatrix(leaders, panel.symbols.length);
  const distinctSet = new Set<number>();
  for (const l of leaders) if (l !== null) distinctSet.add(l);
  const leaderLabels = Array.from(distinctSet)
    .sort((a, b) => a - b)
    .map(i => spec.entries[i]?.label ?? panel.symbols[i]);
  const spearman: Record<string, number> = {};
  for (const lag of LAGS) spearman[`L${lag}`] = spearmanRankAutocorr(scores, lag);
  const dispersion = crossSectionalDispersion(panel);

  const randomChangeProb = effN > 1 ? 1 - 1 / effN : 0;
  const structural = persistence.monthlyChangeProb < randomChangeProb - 1e-9;
  const exists = distinctSet.size >= 3 && persistence.monthlyChangeProb > 0;

  let q1Verdict: string;
  if (distinctSet.size < 2) {
    q1Verdict = '존재 판정 불가(리더 표본 부족)';
  } else if (exists) {
    q1Verdict =
      `존재 O — 주도 섹터가 ${distinctSet.size}종을 오가며 실제로 교체됨` +
      (structural
        ? ` · 리더 유지가 무작위보다 끈끈함(구조적: 관측 교체율 ${pct(persistence.monthlyChangeProb, 1)} < 무작위 ${pct(randomChangeProb, 1)})`
        : ` · 단, 리더 유지 끈끈함은 무작위와 뚜렷이 구분되진 않음(관측 ${pct(persistence.monthlyChangeProb, 1)} vs 무작위 ${pct(randomChangeProb, 1)})`);
  } else {
    q1Verdict = `존재 약함 — 리더가 소수(${distinctSet.size}종)에 몰리거나 거의 안 바뀜`;
  }

  // ── Q2(예측가능성) ──
  const q2: HResult[] = HS.map(h => evalH(panel, scores, h, spec.mode, spec.minScored, trackIdx));
  const anyPredictable = q2.some(r => r.predictable && r.direction === 'positive');
  const anyLowPowerOnly = q2.every(r => !r.predictable) && q2.some(r => r.lowPower);
  let q2Verdict: string;
  if (anyPredictable) {
    const hs = q2.filter(r => r.predictable && r.direction === 'positive').map(r => r.h);
    q2Verdict = `예측가능 O — h=${hs.join(',')}개월에서 스프레드가 유의(+)하고 무작위 대조군 초과`;
  } else if (anyLowPowerOnly) {
    q2Verdict = '불충분 — 유의한 h 없음 + 표본/검정력 부족(단정 불가)';
  } else {
    q2Verdict = '예측가능 X — 어떤 h에서도 유의한 상위-하위 스프레드가 무작위 대조를 못 넘음';
  }

  return {
    key: spec.key,
    label: spec.label,
    mode: spec.mode,
    minScored: spec.minScored,
    primary: spec.primary,
    months: panel.months.length,
    firstMonth: panel.months[0] ?? null,
    lastMonth: panel.months[panel.months.length - 1] ?? null,
    symbols: panel.symbols,
    effN,
    q1: {
      distinctLeaders: distinctSet.size,
      leaderLabels,
      meanRunLengthMonths: persistence.meanRunLengthMonths,
      monthlyChangeProb: persistence.monthlyChangeProb,
      randomChangeProb,
      spearman,
      crossSectionalDispersion: dispersion,
      transition,
      exists,
      structural,
      verdict: q1Verdict,
    },
    q2,
    q2Verdict,
  };
}

// ─── 콘솔 리포트 ──────────────────────────────────────────────
function printTrack(r: TrackResult): void {
  console.log('\n' + '='.repeat(80));
  console.log(`▶ ${r.label}  [${r.key}]${r.primary ? '  ★1차 증거' : ''}`);
  console.log('='.repeat(80));
  console.log(
    `  분석구간(월): ${r.firstMonth ?? '—'} ~ ${r.lastMonth ?? '—'}  (총 ${r.months}개월, 유효종목 ${r.effN}종, 분위=${r.mode})`
  );

  // Q1
  console.log('\n  ── Q1(존재): 주도 섹터가 실제로 교체되는가? ──');
  console.log(
    `    · 주도 섹터로 한 번이라도 오른 종목: ${r.q1.distinctLeaders}종 [${r.q1.leaderLabels.join(', ')}]`
  );
  console.log(`    · 리더 평균 연속 유지기간: ${num(r.q1.meanRunLengthMonths, 2)}개월`);
  console.log(
    `    · 월별 리더 교체확률: ${pct(r.q1.monthlyChangeProb, 1)}  (무작위 기준 ${pct(r.q1.randomChangeProb, 1)})`
  );
  console.log(
    `    · 순위 지속성(Spearman): L1=${num(r.q1.spearman.L1)} · L3=${num(r.q1.spearman.L3)} · L6=${num(r.q1.spearman.L6)}`
  );
  console.log(`    · 월 횡단면 수익률 표준편차(쏠림): ${pct(r.q1.crossSectionalDispersion, 2)}`);
  console.log(`    ▷ 판정: ${r.q1.verdict}`);

  // Q2
  console.log('\n  ── Q2(예측가능성): 과거 모멘텀 순위가 미래 초과수익을 예측하는가? ──');
  console.log('    (상위그룹 − 하위그룹의 미래 h개월 초과수익 스프레드)');
  for (const h of r.q2) {
    console.log(
      `    · h=${h.h}개월: 평균 스프레드 ${pct(h.meanSpread, 2)}` +
        ` | 95% CI [${pct(h.ci.lo, 2)}, ${pct(h.ci.hi, 2)}]` +
        ` | 무작위대조 백분위 ${pct(h.control.percentile, 1)} (귀무평균 ${pct(h.control.nullMean, 2)}, 표본 ${h.nMonths}개월)`
    );
    console.log(`        → ${h.verdict}`);
  }
  console.log(`    ▷ 종합 판정: ${r.q2Verdict}`);
}

async function main(): Promise<void> {
  console.log('='.repeat(80));
  console.log('Phase 1 현상검증 — 섹터/테마 순환이 "존재하고 예측 가능한가"');
  console.log('(전략 수익률 백테스트가 아님. 사전등록 고정 파라미터·튜닝 금지.)');
  console.log(`요청 구간: ${START} ~ ${END}  |  소스: Yahoo v8 수정종가(캐시 우선)`);
  console.log('='.repeat(80));

  // 데이터 로드(캐시 히트).
  const allSymbols = [
    ...US_SECTOR_FIXED,
    ...GLOBAL,
    ...KR_SECTOR,
  ].map(e => e.symbol);
  console.log('\n[1/3] 데이터 로드(전용 캐시)...');
  const seriesMap = await fetchMany(allSymbols, START, END);

  console.log('\n[2/3] 월별 패널 구성 + 지표 계산...');
  const results: TrackResult[] = [];
  TRACK_SPECS.forEach((spec, idx) => {
    const symbols = spec.entries.map(e => e.symbol);
    let panel = buildPanel(seriesMap, symbols);
    // 사전등록 §1: 고정 유니버스 트랙은 전 종목 공통구간만 사용(부분 유니버스 아티팩트 제거).
    if (spec.requireCommonPeriod) panel = restrictToCommonMonths(panel);
    // 미완성 당월 배제(모든 트랙).
    panel = capMonths(panel, LAST_COMPLETE_MONTH);
    results.push(analyzeTrack(spec, panel, idx));
  });

  console.log('\n[3/3] 리포트');
  for (const r of results) printTrack(r);

  // JP-Sector: 주력 결과 제외, 한 줄 안내만.
  const jpCandidates = JP_SECTOR.map(e => e.symbol);
  console.log('\n' + '-'.repeat(80));
  console.log(
    `※ JP-Sector는 유동성 미달(1615.T만 유효)로 Phase 1 주력 결과에서 제외 — 재선별 후보: [${jpCandidates.join(', ')}]`
  );

  // 종합 결론(1차 증거=US 강조).
  const us = results.find(r => r.key === 'US-Sector');
  console.log('\n' + '='.repeat(80));
  console.log('종합 결론 (1차 증거 = 미국 섹터)');
  console.log('='.repeat(80));
  if (us) {
    console.log(`  Q1(존재)      : ${us.q1.verdict}`);
    console.log(`  Q2(예측가능성): ${us.q2Verdict}`);
    console.log(
      '  해석: Q1이 참이어도 Q2가 거짓이면 "리더는 바뀌지만 매매로 예측 불가"이며,' +
        ' 그 경우 Phase 2(전략)로 넘어가지 않는다(사전등록 §7).'
    );
  } else {
    console.log('  (US-Sector 결과 없음)');
  }
  console.log('  KR-Sector는 종목수가 적어 보조 증거로만 취급한다.');

  // JSON 리포트.
  const report = {
    generatedAt: new Date().toISOString(),
    requestedStart: START,
    requestedEnd: END,
    source: 'yahoo-v8',
    preRegistration: 'PHASE1_PREREGISTRATION.md',
    config: { windows: [3, 6, 12], hs: HS, lags: LAGS, bootBlock: BOOT_BLOCK, resamples: RESAMPLES, baseSeed: BASE_SEED },
    jpDeferred: { reason: 'liquidity(1615.T only)', candidates: jpCandidates },
    tracks: results,
  };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n머신리더블 리포트 저장: ${REPORT_PATH}`);
  console.log('='.repeat(80));
}

main().catch(e => {
  console.error('Phase 1 실행 중 예외:', e);
  process.exit(1);
});
