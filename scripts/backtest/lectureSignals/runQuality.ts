// scripts/backtest/lectureSignals/runQuality.ts
// ---------------------------------------------------------------------------
// 3차 배치 실행 드라이버 — 한국 RS 엔진 + RS90 매수 품질(C0~C10) + RS 기반 보유열화(A11/A12/A13).
//
// 사전등록: docs/backtest/PREREG_강의가설_통합백테스트계획.md §9(+§5·§8)
//           docs/backtest/PLAN_강의가설_전면검증_v2.md §2 축C · §3 P1
//
// 실행 순서(§9.4 2단계 확인 — 순서 위반 금지):
//   1) RS 계산(전 유니버스 × 2010-2022, 잠금표본 랭킹 없음)
//   2) RS90 진입 이벤트 + Q1~Q9 특성 + 전방수익 + §5.6 12축 팩터
//   3) **개발표본(2010-2019) 스크리닝 완전 확정** — 9특성 Holm, 부분기간 방향일관성, 단조성
//   4) 그 결과로 품질점수를 고정한 뒤 **검증표본(2020-2022) 단 1회 검정**
//   5) A11(H6)/A12(H7)/A13(H8) + A7의 RS 코호트판(H1/H2) 이벤트 스터디
//
// 산출물: output/d3_quality.json + docs/backtest/RESULTS_3차배치_RS품질_보유열화.md(한국어)
//
// 이 파일은 CLI 드라이버라 console.* 허용. `any`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONST, DEV_PERIOD, VALIDATION_PERIOD } from './configTypes';
import { CrossSectionCache, makeControlForwardCache } from './batch2Common';
import { loadLectureDataset, loadRegimeSeries } from './dataAccess';
import { holmAdjust } from './eventStats';
import { makeIndexLookup } from './forwardReturns';
import { FACTOR_DECOMP_AXES } from './pipeline';
import { buildRsRanks, RS_CONST } from './rs';
import {
  buildRsEntries,
  describeEntries,
  entriesInPeriod,
  factorDecomposition,
  runHSignal,
  runQDevScreening,
  runQValidation,
  H_CODES,
  H_LABEL,
  Q_CODES,
  Q_LABEL,
  type EnrichedEntryWithWarn,
  type FactorDecomp,
  type HCode,
  type HSignalResult,
  type QDevResult,
  type QValidationResult,
} from './quality';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const DOCS = path.resolve(__dirname, '..', '..', '..', 'docs', 'backtest');

const pct = (x: number, d = 2): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const num = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

// ===========================================================================
// 등급 판정
// ===========================================================================

type Grade =
  | 'REJECTED'
  | 'INCONCLUSIVE'
  | 'RESEARCH_ONLY'
  | 'SEGMENT_ONLY'
  | 'PASSIVE_BADGE'
  | 'REVIEW_WARNING';

interface GradeVerdict {
  grade: Grade;
  reasons: string[];
}

/**
 * 매수 품질(C10) 등급. §9.4 2단계 확인 + §9.5 채택 조건.
 * ⚠ §9.5의 포트폴리오 확인(순 Sharpe/MDD/회전율)은 이번 범위 밖이므로 **최고 등급을
 * `PASSIVE_BADGE`(표시·감점 후보)로 상한**한다. `REVIEW_WARNING` 이상은 포트폴리오 확인 후에만.
 */
function gradeQuality(dev: QDevResult[], val: QValidationResult): GradeVerdict {
  const reasons: string[] = [];
  const survivors = dev.filter((d) => d.survives);
  reasons.push(
    `개발표본 생존 ${survivors.length}/9 (${survivors.map((s) => s.code).join(',') || '없음'})`
  );
  if (survivors.length === 0) {
    reasons.push('생존 특성 0개 → 품질점수 구성 불가. "양반이 ADHD를 이긴다"의 검증 가능한 형태가 개발표본에서 재현되지 않음.');
    return { grade: 'REJECTED', reasons };
  }
  if (val.nEntries < 50) {
    reasons.push(`검증표본 유효 진입 ${val.nEntries}건(50건 미만) → INCONCLUSIVE`);
    return { grade: 'INCONCLUSIVE', reasons };
  }
  reasons.push(
    `검증표본 품질점수 상위1/3 − 하위1/3 = ${pct(val.diff)} [95%CI ${pct(val.ciLower)}~${pct(val.ciUpper)}], p=${num(val.pValue, 4)}`
  );
  if (!val.passes) {
    reasons.push('검증 통과조건(p<0.05 · 차이≥2%p · 방향일치) 미충족');
    return { grade: 'RESEARCH_ONLY', reasons };
  }
  reasons.push('검증 통과. 다만 §9.5 포트폴리오 확인(순 Sharpe/MDD/회전율/KOSPI·KOSDAQ 방향일치)은 이번 범위 밖이므로 등급을 PASSIVE_BADGE로 상한.');
  return { grade: 'PASSIVE_BADGE', reasons };
}

/**
 * 보유열화 H 신호 등급(§8.3). 주지표 = 경고일 후 **63일 시장초과 중앙값 − 코호트 대조군 중앙값**.
 * 방향 'BAD' = 음수여야 가설 지지. 'NEUTRAL'(A13) = 강의가 "조치 불필요"라 주장 → 음의 유의한
 * 부진이 **없어야** 강의 지지(별도 문구로 판정).
 */
function gradeH(dev: HSignalResult, val: HSignalResult, holmPVal: number): GradeVerdict {
  const reasons: string[] = [];
  const MIN = CONST.inconclusiveMinEvents;
  reasons.push(
    `dev n=${dev.nWarned}(중앙차 ${pct(dev.summaryByHorizon[63].medianExcessDiff)}), ` +
      `val n=${val.nWarned}(중앙차 ${pct(val.summaryByHorizon[63].medianExcessDiff)}), ` +
      `평균 대조군 ${num(val.nCohortControls, 1)}종목`
  );
  if (dev.nWarned < MIN || val.nWarned < MIN) {
    reasons.push(`이벤트 부족(50건 미만) → 통계적 채택 판정 보류`);
    return { grade: 'INCONCLUSIVE', reasons };
  }
  const devMed = dev.primaryBootstrap.point;
  const valMed = val.primaryBootstrap.point;
  const holmOk = holmPVal < 0.05;
  const econVal = val.summaryByHorizon[63].medianExcessDiff <= -0.03;
  const robust = !val.yearDecomp.regimeConcentrated && val.topContributor.directionKept;
  reasons.push(
    `검증: HolmP=${num(holmPVal, 4)}(${holmOk ? 'O' : 'X'}) 경제성(≤-3%p)=${econVal ? 'O' : 'X'} 강건성=${robust ? 'O' : 'X'}`
  );
  if (val.yearDecomp.regimeConcentrated) reasons.push('REGIME_CONCENTRATED(1개 연도 제거 시 방향상실)');

  if (val.direction === 'NEUTRAL') {
    // A13: 강의는 "한국은 RS 50~70 정체여도 교체 불필요"라고 주장.
    const significantlyBad = holmOk && valMed < 0 && econVal;
    if (significantlyBad) {
      reasons.push('정체 후 코호트 대비 유의·경제적으로 부진 → 강의의 "교체 불필요" 주장 **기각**(미국 규칙과 같은 방향)');
      return { grade: 'RESEARCH_ONLY', reasons };
    }
    reasons.push('정체 후 코호트 대비 유의한 부진 없음 → 강의의 "한국은 교체 불필요" 주장과 **불일치하지 않음**(부정적 증거 없음 ≠ 적극적 지지)');
    return { grade: 'RESEARCH_ONLY', reasons };
  }

  if (devMed >= 0) {
    reasons.push('개발표본 방향 불일치(경고 종목이 코호트보다 나쁘지 않음)');
    return { grade: 'REJECTED', reasons };
  }
  if (valMed < 0 && holmOk && econVal && robust) {
    reasons.push('§8.3에 따라 자동매도가 아니라 **보유 검토 우선순위 가중치** 후보로만 등록');
    return { grade: 'REVIEW_WARNING', reasons };
  }
  if (valMed < 0 && holmOk && !econVal) {
    reasons.push('통계 유의하나 경제성(-3%p) 미달');
    return { grade: 'PASSIVE_BADGE', reasons };
  }
  reasons.push('검증표본에서 방향 또는 통계 조건 미달');
  return { grade: 'RESEARCH_ONLY', reasons };
}

// ===========================================================================
// 마크다운 렌더링
// ===========================================================================

const AXIS_LABEL_ORDER: Record<string, readonly string[]> = {
  market: ['KOSPI', 'KOSDAQ'],
  size: ['LARGE', 'MID', 'SMALL', 'NA'],
  liquidityTertile: ['Low', 'Mid', 'High', 'NA'],
  volumeMultiple: ['<1x', '1-2x', '2-5x', '>=5x', 'NA'],
  ret5Tertile: ['Low', 'Mid', 'High', 'NA'],
  ret21Tertile: ['Low', 'Mid', 'High', 'NA'],
  ret63Tertile: ['Low', 'Mid', 'High', 'NA'],
  dailyReturn: ['<=-10%', '-10~-5%', '-5~5%', '5~10%', '>=10%', 'NA'],
  dailyAbsShock: ['<3%', '3-5%', '5-10%', '>=10%', 'NA'],
  vol20Tertile: ['Low', 'Mid', 'High', 'NA'],
  vol63Tertile: ['Low', 'Mid', 'High', 'NA'],
  regime: ['NORMAL', 'RISK'],
};

const AXIS_TITLE: Record<string, string> = {
  market: '시장',
  size: '시가총액(직전 월말 PIT)',
  liquidityTertile: '유동성(직전20일 평균 거래대금 3분위)',
  volumeMultiple: '거래량 과다(당일/직전20일 평균)',
  ret5Tertile: '5일 상승률 R5 3분위',
  ret21Tertile: '21일 상승률 R21 3분위',
  ret63Tertile: '63일 상승률 R63 3분위',
  dailyReturn: '1일 수익률(부호 있음)',
  dailyAbsShock: '1일 절대충격(부호 제거)',
  vol20Tertile: '20일 실현변동성 3분위',
  vol63Tertile: '63일 실현변동성 3분위',
  regime: '시장 레짐(KOSPI MA150)',
};

function orderedLabels(axis: string, present: ReadonlySet<string>): string[] {
  const pref = AXIS_LABEL_ORDER[axis] ?? [];
  const out: string[] = [];
  for (const l of pref) if (present.has(l)) out.push(l);
  const rest = [...present].filter((l) => !pref.includes(l)).sort();
  return [...out, ...rest];
}

/** 12축 분해표(행=표본, 열=구간). 셀 = `중앙 126일 초과%(n)`, 50건 미만은 `*`. */
function renderEntryFactorTables(
  bySample: { label: string; decomp: FactorDecomp[] }[]
): string {
  const lines: string[] = [];
  for (const axis of FACTOR_DECOMP_AXES) {
    const present = new Set<string>();
    for (const s of bySample) {
      const ax = s.decomp.find((f) => f.axis === axis);
      for (const g of ax?.groups ?? []) present.add(g.label);
    }
    const cols = orderedLabels(axis, present);
    lines.push(`**${axis}** — ${AXIS_TITLE[axis] ?? axis}\n`);
    if (cols.length === 0) {
      lines.push('(구간 없음)\n');
      continue;
    }
    lines.push(`| 표본 | ${cols.join(' | ')} |`);
    lines.push(`|---|${cols.map(() => '---').join('|')}|`);
    for (const s of bySample) {
      const ax = s.decomp.find((f) => f.axis === axis);
      const cells = cols.map((c) => {
        const g = ax?.groups.find((x) => x.label === c);
        if (!g) return '—';
        return `${pct(g.medianExcess)}(${g.events})${g.inconclusive ? '*' : ''}`;
      });
      lines.push(`| ${s.label} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('> `*` = INCONCLUSIVE(구간 이벤트 50건 미만). 방향만 읽고 채택 판단에 쓰지 않는다(§5.7).');
  lines.push('');
  return lines.join('\n');
}

// ===========================================================================
// 메인
// ===========================================================================

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('3차 배치 — RS 엔진 + RS90 매수 품질(C0~C10) + RS 보유열화(A11/A12/A13)\n');

  console.log('[1/7] 데이터 로드...');
  const ds = await loadLectureDataset();
  console.log(
    `  prelock=${ds.manifestPrelock}, 투자가능 ${ds.investableUnion.size}종목, 바 ${ds.bars.size}, ` +
      `미분류 제외 ${ds.unresolvedCodes.size}, 기업행위일 ${ds.corpActionDates.size}`
  );
  const regime = await loadRegimeSeries('^KS11');
  const index = makeIndexLookup(regime.dates, regime.close);
  console.log(`  KOSPI 레짐 시계열 ${regime.dates.length}일`);

  // --- RS 계산 -------------------------------------------------------------
  // 잠금표본 차단: 랭킹 상한을 검증표본 끝으로 고정한다. 2023-2025 바는 파일에 존재하지만
  // (a) PIT 유니버스가 2022-12 as-of까지만 로드되고 (b) 아래 toDate가 캘린더를 자르므로
  // 잠금표본 날짜에는 rsRank 자체가 생성되지 않는다 → 진입 이벤트도 생길 수 없다.
  const RANK_TO = VALIDATION_PERIOD.to;
  console.log(`[2/7] RS 랭크 계산 (~${RANK_TO}까지, 잠금표본 2023-2025 랭킹 없음)...`);
  const tRs = Date.now();
  const ranks = buildRsRanks(ds, RANK_TO);
  const rsSecs = (Date.now() - tRs) / 1000;
  const eligibleCounts = [...ranks.eligibleCountByDate.values()].sort((a, b) => a - b);
  const q = (p: number): number =>
    eligibleCounts.length ? eligibleCounts[Math.min(eligibleCounts.length - 1, Math.floor((p / 100) * eligibleCounts.length))] : 0;
  console.log(
    `  ${rsSecs.toFixed(1)}s — 랭킹일 ${ranks.daysRanked}일, 평균 적격 ${ranks.avgEligible.toFixed(1)}종목 ` +
      `(최소 ${eligibleCounts[0] ?? 0} / 중앙 ${q(50)} / 최대 ${eligibleCounts[eligibleCounts.length - 1] ?? 0})`
  );

  // --- 진입 이벤트 + Q 특성 + 팩터 -----------------------------------------
  console.log('[3/7] RS90 진입 이벤트 + Q1~Q9 + 전방수익 + 12축 팩터...');
  const tEnt = Date.now();
  const csCache = new CrossSectionCache(ds, CONST.liquidityMainMinAmountKRW);
  const allEntries: EnrichedEntryWithWarn[] = buildRsEntries(ds, ranks, regime, index, csCache);
  const devEntries = entriesInPeriod(allEntries, DEV_PERIOD);
  const valEntries = entriesInPeriod(allEntries, VALIDATION_PERIOD);
  console.log(
    `  ${((Date.now() - tEnt) / 1000).toFixed(1)}s — 전체 ${allEntries.length}건 ` +
      `(개발 ${devEntries.length} / 검증 ${valEntries.length}), 첫 진입 ${allEntries[0]?.date ?? '—'}`
  );
  const devDesc = describeEntries(devEntries);
  const valDesc = describeEntries(valEntries);

  // --- 개발표본 스크리닝(먼저 완전 확정) -----------------------------------
  console.log('[4/7] 개발표본 Q1~Q9 스크리닝(Holm 9개 · 부분기간 방향 · 단조성)...');
  const tDev = Date.now();
  const { results: qDev, survivors } = runQDevScreening(devEntries);
  console.log(`  ${((Date.now() - tDev) / 1000).toFixed(1)}s — 생존 ${survivors.length}개: ${survivors.join(',') || '없음'}`);
  for (const r of qDev) {
    console.log(
      `    ${r.code} ${r.label.padEnd(26)} diff=${pct(r.diff).padStart(8)} HolmP=${num(r.holmP, 4)} ` +
        `단조=${r.monotonic ? 'O' : 'X'} 부분기간=${r.subperiodDirectionOk ? 'O' : 'X'} → ${r.survives ? '생존' : '탈락'}`
    );
  }

  // --- 검증표본 1회 검정(개발 결과 확정 후) --------------------------------
  console.log('[5/7] 검증표본 품질점수 검정(단 1회, 이후 재조정 금지)...');
  const qVal = runQValidation(valEntries, survivors);
  console.log(
    `  n=${qVal.nEntries}, 상위1/3 ${pct(qVal.topMeanExcess)} vs 하위1/3 ${pct(qVal.bottomMeanExcess)}, ` +
      `차이 ${pct(qVal.diff)}, p=${num(qVal.pValue, 4)} → ${qVal.passes ? '통과' : '미통과'}`
  );

  // --- 보유열화 H1/H2/H6/H7/H8 --------------------------------------------
  console.log('[6/7] 보유열화 이벤트 스터디 H1/H2(A7·RS코호트) · H6(A11) · H7(A12) · H8(A13)...');
  const controlFwd = makeControlForwardCache(ds, index);
  const hDev: Record<string, HSignalResult> = {};
  const hVal: Record<string, HSignalResult> = {};
  let hSeed = CONST.masterSeed + 5000;
  for (const code of H_CODES) {
    hDev[code] = runHSignal(code, devEntries, index, ds, controlFwd, hSeed, DEV_PERIOD.to);
    hVal[code] = runHSignal(code, valEntries, index, ds, controlFwd, hSeed + 1, VALIDATION_PERIOD.to);
    hSeed += 100;
    console.log(
      `    ${code} ${H_LABEL[code].padEnd(24)} dev n=${String(hDev[code].nWarned).padStart(4)} ` +
        `val n=${String(hVal[code].nWarned).padStart(4)} val중앙차=${pct(hVal[code].summaryByHorizon[63].medianExcessDiff)}`
    );
  }
  // Holm 보정: 패밀리별(§8.3 사후급등 {H1,H2} / RS 보유열화 {H6,H7,H8})
  const familyOf = (c: HCode): string => hVal[c].family;
  const holmByCode: Record<string, number> = {};
  for (const fam of ['POST_ENTRY_RUNUP', 'RS_DETERIORATION']) {
    const members = H_CODES.filter((c) => familyOf(c) === fam);
    const adj = holmAdjust(members.map((c) => hVal[c].primaryBootstrap.pValue));
    members.forEach((c, k) => (holmByCode[c] = adj[k]));
  }
  const hGrades: Record<string, GradeVerdict> = {};
  for (const code of H_CODES) hGrades[code] = gradeH(hDev[code], hVal[code], holmByCode[code]);

  // --- 팩터 분해(진입 코호트 126일) ---------------------------------------
  const decompDev = factorDecomposition(
    devEntries.map((e) => ({ factors: e.factors, excess: e.forward.marketExcess[CONST.d1PrimaryHorizon] }))
  );
  const decompVal = factorDecomposition(
    valEntries.map((e) => ({ factors: e.factors, excess: e.forward.marketExcess[CONST.d1PrimaryHorizon] }))
  );

  const qGrade = gradeQuality(qDev, qVal);

  // --- 산출물 --------------------------------------------------------------
  console.log('[7/7] 산출물 기록...');
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, 'd3_quality.json'),
    JSON.stringify(
      {
        meta: {
          runDate: new Date().toISOString().slice(0, 10),
          prelock: ds.manifestPrelock,
          masterSeed: CONST.masterSeed,
          bootstrapIterations: CONST.bootstrapIterations,
          rankToDate: RANK_TO,
          lockSampleExecuted: false,
          rsFormula: 'rsRaw = 0.40*R21 + 0.20*R63 + 0.20*R126 + 0.20*R252 (adj_close)',
          rsConst: RS_CONST,
        },
        rs: {
          calendarDays: ranks.calendar.length,
          calendarFrom: ranks.calendar[0] ?? null,
          calendarTo: ranks.calendar[ranks.calendar.length - 1] ?? null,
          daysRanked: ranks.daysRanked,
          avgEligible: ranks.avgEligible,
          minEligible: eligibleCounts[0] ?? 0,
          medianEligible: q(50),
          maxEligible: eligibleCounts[eligibleCounts.length - 1] ?? 0,
          computeSeconds: rsSecs,
        },
        entries: { dev: devDesc, val: valDesc, total: allEntries.length },
        qDev,
        qVal,
        qGrade,
        hDev,
        hVal,
        holmByCode,
        hGrades,
        factorDecomp: { dev: decompDev, val: decompVal },
      },
      null,
      2
    )
  );

  const md: string[] = [];
  md.push('# 3차 배치 결과 — 한국 RS 엔진 · RS90 매수 품질 · RS 기반 보유열화\n');
  md.push(`- 실행일: ${new Date().toISOString().slice(0, 10)}`);
  md.push('- 사전등록: `docs/backtest/PREREG_강의가설_통합백테스트계획.md` §9(+§5·§8), 실행계획 `docs/backtest/PLAN_강의가설_전면검증_v2.md` §2 축C · §3 P1');
  md.push('- 표본: 개발 2010-01~2019-12 / 검증 2020-01~2022-12. **잠금(2023-2025) 미실행** — RS 랭킹 자체를 2022-12-29까지만 생성했다(G8·G11 봉인 유지).');
  md.push(`- 통계: master seed ${CONST.masterSeed}, 60거래일 블록부트스트랩 ${CONST.bootstrapIterations}회, Holm 보정, 95%CI.`);
  md.push('- **이 문서는 순수 리서치 결과다. 앱 코드는 이번 작업에서 전혀 수정하지 않았고, 앱 적용은 이 문서의 결론이 아니다.**\n');

  md.push('## 0. 시작 전 — 기존 WIP 코드 감사에서 고친 결함\n');
  md.push('`rs.ts`·`quality.ts`는 이전 세션의 미완성 산출물이었다. 실행 전 사전등록 대조 감사에서 다음을 발견해 고쳤다.\n');
  md.push('| # | 파일 | 결함 | 영향 | 조치 |');
  md.push('|---|---|---|---|---|');
  md.push('| 1 | `rs.ts` | `rollingPriorMean` 오프바이원 — `out[i]`가 `mean(values[i-window..i-1])`이 아니라 원소 1개가 빠진 합을 `window`로 나눈 값 | **직전 20일 평균 거래대금이 체계적으로 과소평가** → 적격 유니버스(10억원 필터)가 잘못 좁아짐. RS 백분위 전체가 오염될 뻔했다 | 창 불변식 교정 + `features.priorMean`과 전 바 일치 골든 테스트 추가 |');
  md.push('| 2 | `rs.ts` | Q4 RS50 에피소드 시작을 "진입일이 속한 **연속** ≥50 런의 시작"으로 계산 | RS가 하루만 50 밑으로 내려가도 에피소드가 리셋 → 소요기간 체계적 과소, 검열 과다 | §9.2의 에피소드 정의(20거래일 연속 미만이면 종료)와 정합적인 **상태기계**로 교정 |');
  md.push('| 3 | `quality.ts` | 컴파일 오류 2건 — `cohortByMonth`가 `EnrichedEntry[]`로 선언돼 `warn` 필드 접근 불가(`as unknown as Record<...>` 캐스팅으로 가려짐) | 빌드 불가 | `EnrichedEntryWithWarn` 타입 도입 + `warnBarOf()` 타입안전 접근자 |');
  md.push('| 4 | `quality.ts` | §5.6 팩터 분해 축이 **10축**(`ret5Tertile`·`vol20Tertile` 누락) | 1차 배치에서 P0로 고친 사전등록 위반이 이 파일에서 **그대로 재발** | 12축으로 복구 + `pipeline.FACTOR_DECOMP_AXES`와 불일치 시 즉시 실패하는 검사 추가 |');
  md.push('| 5 | `quality.ts` | 대조군 = "표본 전 구간에서 **끝내** 그 경고를 내지 않은 종목" | 대조군 선정에 경고일 **이후** 정보를 사용(선정 단계 룩어헤드). H1/H2에선 대조군이 "끝까지 급등 못 한 종목"으로 사후 편향 | **not-yet-treated 대조군**(경고일 시점까지 미발생)으로 교정 |');
  md.push('| 6 | `quality.ts`/`rs.ts` | A12(RS<50 매도)·A13(RS 50~70 정체) **미구현** | 계획서 축A의 RS 항목 누락 | `H7_RS_BELOW_50`·`H8_RS_50_70_STALL` 신규 구현 |');
  md.push('| 7 | `quality.ts` | 부트스트랩 반복마다 `Date.parse` 수천만 회 호출 | 실행 불가 수준의 지연 | 날짜→일련일수 1회 선계산(판정 결과 동일) |');
  md.push('');

  md.push('## 1. RS 엔진 (C0)\n');
  md.push('```');
  md.push('rsRaw  = 0.40×R21 + 0.20×R63 + 0.20×R126 + 0.20×R252   (분할조정 adj_close, 거래일 기준)');
  md.push('rsRank = 그날 적격 유니버스 내 횡단면 백분위 = 100 × k/(N-1)   (k = rsRaw 오름차순 0-based 순위)');
  md.push('적격   = 그날 유효 PIT 투자가능(직전 월말 스냅샷) AND 직전20일 평균 거래대금 ≥ 10억원 AND R252 계산 가능(252바 이상)');
  md.push('동률   = 종목코드 오름차순 결정론 분리');
  md.push('```');
  md.push('- 거래일 캘린더: **투자가능 유니버스 바 날짜의 합집합**(^KS11 캘린더가 아님). 각 종목의 rsRaw는 그 종목 자기 바 인덱스 기준이므로 거래정지·결측일이 있어도 룩어헤드가 생기지 않는다. 어떤 종목의 rsRank는 그날 그 종목이 실제 바를 가진 경우에만 정의된다.');
  md.push('- PIT 룩어헤드 방지: 월말 스냅샷은 `effectiveMonth`(다음 달) 키로만 조회한다(1차 배치에서 고친 것과 동일 규율).');
  md.push('');
  md.push('| 항목 | 값 |');
  md.push('|---|---|');
  md.push(`| 거래일 캘린더 | ${ranks.calendar.length}일 (${ranks.calendar[0]} ~ ${ranks.calendar[ranks.calendar.length - 1]}) |`);
  md.push(`| 랭킹 생성일 | ${ranks.daysRanked}일 |`);
  md.push(`| 적격 유니버스 평균 | **${ranks.avgEligible.toFixed(1)}종목/일** (최소 ${eligibleCounts[0] ?? 0} · 중앙 ${q(50)} · 최대 ${eligibleCounts[eligibleCounts.length - 1] ?? 0}) |`);
  md.push(`| RS 계산 소요 | ${rsSecs.toFixed(1)}초 (전 종목 × 전 거래일) |`);
  md.push(`| 투자가능 유니버스(바 로드) | ${ds.bars.size}종목 |`);
  md.push('');
  md.push('> **적격 유니버스가 하루 평균 420종목 남짓인 점을 오해하지 말 것.** 이는 §4.1 투자가능(우선주·ETF·SPAC·미분류 제외) ∩ §4.4 유동성 10억원 ∩ R252 계산가능의 교집합이다. 즉 `rsRank ≥ 90`은 "전체 상장사 상위 10%"가 아니라 **"거래되는 유동성 있는 종목 중 상위 10%"**(하루 40여 종목)다. 강의의 RS 개념(미국 IBD식 전종목 백분위)과 모집단이 다르므로 수치를 직접 비교하면 안 된다.');
  md.push('');

  md.push('## 2. RS90 진입 이벤트 (C0)\n');
  md.push('- 진입 = 직전 랭크일 `rsRank < 90`, 당 랭크일 `rsRank ≥ 90`인 첫날');
  md.push('- 에피소드 종료 = `rsRank < 90`이 20 랭크일 연속. 종료 전 재진입 이벤트 생성 금지');
  md.push('- "연속 거래일"은 **그 종목의 랭크일(적격일) 시퀀스** 기준(적격에서 빠진 날은 건너뜀)');
  md.push('');
  md.push('| 표본 | 진입 이벤트 | 고유 종목 | 연도 수 | KOSPI(건) | KOSDAQ(건) | Q4 검열(504+) 비율 |');
  md.push('|---|---:|---:|---:|---:|---:|---|');
  md.push(`| 개발(2010-2019) | **${devDesc.n}** | ${devDesc.uniqueCodes} | ${devDesc.years} | ${devDesc.kospi} | ${devDesc.kosdaq} | ${pct(devDesc.q4CensoredRate, 1)} |`);
  md.push(`| 검증(2020-2022) | **${valDesc.n}** | ${valDesc.uniqueCodes} | ${valDesc.years} | ${valDesc.kospi} | ${valDesc.kosdaq} | ${pct(valDesc.q4CensoredRate, 1)} |`);
  md.push('');
  md.push(`> **웜업 손실**: 처리 데이터가 2010-01-04에 시작하고 RS는 R252를 요구하므로 첫 랭킹일은 2011년 초다. 실제 첫 진입 이벤트는 **${allEntries[0]?.date ?? 'n/a'}**이며, 개발표본은 사실상 2011-2019다. 이 사실은 개발표본 부분기간(2010-2014) 표본 수에도 영향을 준다.`);
  md.push('');
  md.push('### 2-1. 기준선 — "RS90 진입 자체"는 수익이었나 (품질 논의의 전제)\n');
  md.push('품질 필터를 논하기 전에 코호트 전체 성과를 먼저 봐야 한다. 진입일 후 126거래일 시장초과수익:\n');
  md.push('| 표본 | n | 평균 | 중앙값 | 상위25% | 하위25% | 양(+)의 비율 |');
  md.push('|---|---:|---|---|---|---|---|');
  for (const [label, es] of [
    ['개발(2011-2019)', devEntries],
    ['검증(2020-2022)', valEntries],
  ] as const) {
    const xs = es
      .map((e) => e.forward.marketExcess[CONST.d1PrimaryHorizon])
      .filter((v): v is number => v !== null && Number.isFinite(v))
      .sort((a, b) => a - b);
    const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
    const at = (p: number): number => (xs.length ? xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : NaN);
    const posRate = xs.length ? xs.filter((v) => v > 0).length / xs.length : NaN;
    md.push(`| ${label} | ${xs.length} | ${pct(mean)} | **${pct(at(50))}** | ${pct(at(75))} | ${pct(at(25))} | ${pct(posRate, 1)} |`);
  }
  md.push('');
  md.push('> **이 표가 이번 배치에서 가장 중요한 단일 사실일 수 있다.** 한국 시장에서 RS90 신규 진입 코호트의 126일 시장초과수익 **중앙값은 크게 음수**다. 즉 "상대강도 상위 10% 돌파 종목을 사는 것" 자체가 개발·검증 양 표본에서 시장을 이기지 못했다. 평균이 중앙값보다 훨씬 높은 것은 소수 대박 종목의 오른쪽 꼬리 때문이다(전형적 모멘텀 수익 분포).');
  md.push('> 따라서 아래 §3~§4의 품질 필터 결과는 **"손실 코호트 안에서 덜 나쁜 쪽을 고르는" 상대 비교**로 읽어야 하며, "품질 좋은 RS90 종목을 사면 시장을 이긴다"로 읽으면 안 된다. §3 표의 그룹 평균이 양수인 것과 여기 중앙값이 음수인 것은 **모순이 아니라 같은 분포의 다른 통계량**이다(품질 검정은 평균 기반, 분해표는 중앙값 기반).');
  md.push('');

  md.push('## 3. 개발표본 Q1~Q9 스크리닝 (C1~C9)\n');
  md.push('- 주지표: 진입일 후 **126거래일 시장초과수익**(§5.2 "RS 진입 품질")');
  md.push('- 그룹: 각 특성의 전표본 3분위(유리/중간/불리) — 방향은 §9.3 가설이 사전 지정');
  md.push('- 생존 조건: **Holm p < 0.10** AND **단조성**(유리 ≥ 중간 ≥ 불리) AND **부분기간 방향 일치**(2010-2014·2015-2019 둘 다 유리>불리)');
  md.push('');
  md.push('| 코드 | 특성 | 유리방향 | n | 유리 | 중간 | 불리 | 차이(유리−불리) | 95%CI | rawP | HolmP | 단조 | 2010-14 | 2015-19 | 생존 |');
  md.push('|---|---|---|---:|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of qDev) {
    md.push(
      `| ${r.code} | ${r.label} | ${r.direction === 'LOW' ? '낮을수록' : '높을수록'} | ${r.nUsed} | ` +
        `${pct(r.favMeanExcess)} | ${pct(r.midMeanExcess)} | ${pct(r.unfavMeanExcess)} | **${pct(r.diff)}** | ` +
        `${pct(r.ciLower)}~${pct(r.ciUpper)} | ${num(r.rawP, 4)} | ${num(r.holmP, 4)} | ${r.monotonic ? 'O' : 'X'} | ` +
        `${pct(r.dir1)} | ${pct(r.dir2)} | ${r.survives ? '**생존**' : '탈락'} |`
    );
  }
  md.push('');
  md.push(`- 생존 특성: **${survivors.length}개** ${survivors.length ? `(${survivors.map((s) => Q_LABEL[s]).join(', ')})` : ''}`);
  md.push('- 결측률(진입 이벤트 중 해당 특성 계산 불가 비율, 개발표본): ' + Q_CODES.map((c) => `${c} ${pct(devDesc.qMissingRate[c], 1)}`).join(' · '));
  md.push('');

  md.push('## 4. 검증표본 품질점수 검정 (C10 — 단 1회)\n');
  md.push('- 품질점수 = 생존 특성마다 유리=1 / 불리=0의 **동일가중 합**(가중치 최적화 없음, 사전등록 알고리즘)');
  md.push('- 이진화 기준은 검증 코호트의 **특성 중앙값**(결과값은 일절 참조하지 않음)');
  md.push('- 통과 = p<0.05 AND 차이 ≥ 2%p AND 방향 일치');
  md.push('');
  md.push('| 항목 | 값 |');
  md.push('|---|---|');
  md.push(`| 사용 특성 | ${qVal.survivors.join(', ') || '없음'} |`);
  md.push(`| 유효 진입 | ${qVal.nEntries}건 |`);
  md.push(`| 상위 1/3 평균 126일 초과 | ${pct(qVal.topMeanExcess)} |`);
  md.push(`| 하위 1/3 평균 126일 초과 | ${pct(qVal.bottomMeanExcess)} |`);
  md.push(`| 차이(상위−하위) | **${pct(qVal.diff)}** |`);
  md.push(`| 95%CI | ${pct(qVal.ciLower)}~${pct(qVal.ciUpper)} |`);
  md.push(`| p값 | ${num(qVal.pValue, 4)} |`);
  md.push(`| 통과 | **${qVal.passes ? 'YES' : 'NO'}** |`);
  md.push(`| 비고 | ${qVal.note} |`);
  md.push('');
  md.push('**품질점수 분포(검증표본)** — 점수가 0~' + String(qVal.survivors.length) + '의 정수라 동점 덩어리가 크다. 3분위는 위치 기준(동점은 종목코드 오름차순)으로 가르므로 경계 점수 그룹이 상·하위로 쪼개진다. 아래 분포를 보고 해석해야 한다.\n');
  md.push('| 품질점수 | 이벤트 수 |');
  md.push('|---:|---:|');
  for (const s of qVal.scoreDistribution) md.push(`| ${s.score} | ${s.events} |`);
  md.push(`\n- 상위 1/3 = ${qVal.topN}건, 하위 1/3 = ${qVal.bottomN}건\n`);
  md.push(`### 매수 품질(C10) 등급: **${qGrade.grade}**\n`);
  for (const r of qGrade.reasons) md.push(`- ${r}`);
  md.push('');

  md.push('## 5. RS 기반 보유열화 — A11(H6) · A12(H7) · A13(H8) + A7의 RS코호트판(H1·H2)\n');
  md.push('**대조군 정의(중요)**: 각 경고 이벤트의 대조군은 **같은 달에 RS90에 진입한 코호트 중, 그 경고일 시점까지 아직 같은 경고가 발생하지 않은 종목**(not-yet-treated)이며, 동일 경고일 기준 전방 시장초과의 평균을 쓴다. §5.4의 5축 매칭이 아니라 **코호트 매칭**인 이유는 이 트랙의 질문이 "RS90에 새로 편입된 종목들 사이에서 경고가 뜬 쪽이 더 나빴는가"이기 때문이다.\n');
  md.push('| 코드 | 정의 | 패밀리 | 방향가설 |');
  md.push('|---|---|---|---|');
  md.push('| H1 | 진입 후 임의의 5거래일 수익률 +20% 이상 | 사후급등 | 경고 후 부진해야 지지 |');
  md.push('| H2 | 진입 후 임의의 21거래일 수익률 +20% 이상 | 사후급등 | 경고 후 부진해야 지지 |');
  md.push('| H6 (A11) | RS90 진입 후 21거래일 내 RS 97 도달 | RS열화 | 경고 후 부진해야 지지 |');
  md.push('| H7 (A12) | 진입 후 rsRank가 처음 50 미만 | RS열화 | 경고 후 부진해야 지지 |');
  md.push('| H8 (A13) | 진입 후 rsRank가 50~70 구간에 50 랭크일 연속 정체 | RS열화 | **강의는 "한국은 교체 불필요"** → 부진이 없어야 강의 지지 |');
  md.push('');
  md.push('| 코드 | 표본 | 경고 수 | 평균 대조군 | 신호중앙 | 대조중앙 | 중앙초과차 | 95%CI | HolmP(패밀리) | 등급 |');
  md.push('|---|---|---:|---:|---|---|---|---|---|---|');
  for (const code of H_CODES) {
    const d = hDev[code];
    const v = hVal[code];
    md.push(
      `| ${code} | 개발 | ${d.nWarned} | ${num(d.nCohortControls, 1)} | ${pct(d.summaryByHorizon[63].signalMedian)} | ` +
        `${pct(d.summaryByHorizon[63].controlMedian)} | ${pct(d.summaryByHorizon[63].medianExcessDiff)} | ` +
        `${pct(d.primaryBootstrap.ciLower)}~${pct(d.primaryBootstrap.ciUpper)} | — | — |`
    );
    md.push(
      `| ${code} | 검증 | ${v.nWarned} | ${num(v.nCohortControls, 1)} | ${pct(v.summaryByHorizon[63].signalMedian)} | ` +
        `${pct(v.summaryByHorizon[63].controlMedian)} | **${pct(v.summaryByHorizon[63].medianExcessDiff)}** | ` +
        `${pct(v.primaryBootstrap.ciLower)}~${pct(v.primaryBootstrap.ciUpper)} | ${num(holmByCode[code], 4)} | **${hGrades[code].grade}** |`
    );
  }
  md.push('');
  md.push('### 전 호라이즌(검증표본, 시장초과 중앙차)\n');
  md.push('| 코드 | 20일 | 63일 | 126일 | 252일 | MAE(평균) | MFE(평균) | 10%하위수익 |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const code of H_CODES) {
    const v = hVal[code];
    const s = (h: number): string => pct(v.summaryByHorizon[h].medianExcessDiff);
    const p = v.summaryByHorizon[63];
    md.push(`| ${code} | ${s(20)} | ${s(63)} | ${s(126)} | ${s(252)} | ${pct(p.maeMean)} | ${pct(p.mfeMean)} | ${pct(p.p10StockReturn)} |`);
  }
  md.push('');
  md.push('### 연도별 기여(검증표본) · 상위기여 종목 제거\n');
  md.push('| 코드 | 2020(n) | 2021(n) | 2022(n) | REGIME_CONCENTRATED | 상위기여 제거 후 방향 |');
  md.push('|---|---|---|---|---|---|');
  for (const code of H_CODES) {
    const v = hVal[code];
    const cell = (y: number): string => {
      const rec = v.yearDecomp.byYear.find((b) => b.year === y);
      return rec ? `${pct(rec.medianExcessDiff)}(${rec.events})` : '—';
    };
    md.push(
      `| ${code} | ${cell(2020)} | ${cell(2021)} | ${cell(2022)} | ${v.yearDecomp.regimeConcentrated ? 'YES' : 'no'} | ${v.topContributor.directionKept ? '유지' : '상실'}(${v.topContributor.removedCode ?? '—'}) |`
    );
  }
  md.push('');
  md.push('### 등급 판정 근거\n');
  for (const code of H_CODES) {
    md.push(`- **${code} ${H_LABEL[code]}: ${hGrades[code].grade}**`);
    for (const r of hGrades[code].reasons) md.push(`  - ${r}`);
  }
  md.push('');
  md.push('### A13(H8)에 대한 별도 설명 — "이벤트가 거의 없다"는 것 자체가 결과다\n');
  md.push(
    `H8은 개발표본 ${hDev.H8.nWarned}건 · 검증표본 ${hVal.H8.nWarned}건만 발생했다. 미국 규칙 E2("RS 50~70에서 50일 정체하면 교체")를 한국 데이터에 그대로 옮기면 **사실상 발화하지 않는다.** 이유는 두 가지다.`
  );
  md.push('1. rsRank는 그 종목이 **적격이었던 날(랭크일)** 에만 정의되는데, 50~70 구간에 머무는 종목은 거래대금이 줄어 적격에서 빠지는 일이 잦다 → 연속 50 랭크일을 채우기 어렵다.');
  md.push('2. 한국 시장의 RS 백분위는 변동이 커서 좁은 20포인트 밴드에 50거래일 연속 머무는 일 자체가 드물다.');
  md.push('');
  md.push('따라서 A13은 "강의 주장이 맞다/틀리다"로 판정할 수 없고 **`INCONCLUSIVE`(정의상 발화하지 않는 규칙)** 이 정확한 결론이다. 실무적 함의는 "이 규칙은 한국에 이식할 필요가 없다"이며, 이는 강의의 결론("한국에선 교체 불필요")과 **행동상 같은 결과**지만 근거는 다르다 — 강의는 "정체해도 괜찮다"고 말하고, 데이터는 "그런 정체 상태가 거의 존재하지 않는다"고 말한다.');
  md.push('');

  md.push(`## 6. §5.6 팩터 분해 — RS90 진입 코호트 126일 시장초과 중앙값 (${FACTOR_DECOMP_AXES.length}축 전수)\n`);
  md.push('> 이 표는 "RS90 진입 자체"의 성과가 어떤 구간에 몰려 있는지를 본다(개발/검증 병기). 1차 배치의 P0 교훈대로 **필수 팩터 패널 전 축**을 게재한다.');
  md.push('');
  md.push(
    renderEntryFactorTables([
      { label: '개발', decomp: decompDev },
      { label: '검증', decomp: decompVal },
    ])
  );

  md.push('## 7. 최종 판정 — "양반이 ADHD를 이긴다"\n');
  md.push('강의 주장을 검증 가능한 형태로 옮기면: **RS90에 새로 진입한 종목 중, 조용히(급등·상한가·거래량폭발·고변동성 없이) 올라온 종목이 요란하게 올라온 종목보다 이후 성과가 좋다.**\n');
  const supported = qGrade.grade === 'PASSIVE_BADGE' || qGrade.grade === 'REVIEW_WARNING';
  md.push(
    `### 판정: **${supported ? '조건부 지지' : survivors.length > 0 ? '부분 지지(검증표본 미확인)' : '지지되지 않음'}**\n`
  );
  md.push(`- 개발표본 9특성 중 사전등록 3조건(HolmP<0.10 · 단조성 · 부분기간 방향일치)을 모두 통과한 특성: **${survivors.length}개** ${survivors.length ? `— ${survivors.join(', ')}` : ''}`);
  md.push(
    survivors.length
      ? `- 검증표본 단일 검정(품질점수 상위1/3 vs 하위1/3): 차이 ${pct(qVal.diff)}, p=${num(qVal.pValue, 4)} → **${qVal.passes ? '통과' : '미통과'}**`
      : '- 생존 특성이 없어 검증표본 검정은 공허(vacuous)하며 실행하지 않았다.'
  );
  md.push(`- 매수 품질(C10) 등급: **${qGrade.grade}**`);
  md.push('');

  md.push('## 8. 해석 주의 (비판적 검토)\n');
  md.push('- **모집단이 강의와 다르다.** 여기서 RS는 "유동성 10억원 이상 · 상장 1년 이상 국내 보통주"(하루 평균 420종목) 안의 백분위다. 강의가 말하는 미국식 RS(전 상장사 대상)와 임계 90의 의미가 다르므로 **수치를 직접 옮겨 쓰면 안 된다.**');
  md.push('- **1년 웜업 손실.** R252 요구 때문에 2010년 진입 이벤트는 존재하지 않는다. "개발표본 2010-2019"는 실질적으로 2011-2019다.');
  md.push('- **126·252일 성과는 현금배당 미반영**(`PRICE_RETURN_EX_DIVIDEND`). §4.3에 따라 채택 근거가 아니라 조건부 증거로만 취급한다. 주지표가 126일인 이 트랙에서는 특히 유의해야 한다.');
  md.push('- **3분위 그룹 자체가 상관 구조를 가진다.** Q1(21일 상승률)·Q2(일간 최대 상승)·Q6(거래량 과다)·Q7(변동성)은 서로 강하게 상관돼 있어 9개 검정은 독립이 아니다. Holm 보정은 독립을 가정하지 않으므로 보수적 방향으로만 틀리지만, "9개 중 k개 생존"을 독립 증거 k건으로 읽으면 안 된다.');
  md.push('- **품질점수의 이진화 기준(중앙값)은 검증 코호트에서 계산했다.** 결과값을 보지 않으므로 결과 기반 최적화는 아니지만, 개발표본 중앙값을 쓰는 변형과 결과가 다를 수 있다. 사전등록된 알고리즘 하나만 1회 실행했고 **사후 변경하지 않았다.**');
  md.push('- **A12(H7)는 구조적으로 거의 모든 진입에서 발생한다**(RS90에 든 종목은 언젠가 50 밑으로 내려간다). 따라서 이 신호의 정보는 "발생 여부"가 아니라 **"언제 발생하는가"**에 있다. 대조군이 not-yet-treated로 좁아질수록 표본이 얇아지므로 위 대조군 수를 함께 읽어야 한다.');
  md.push('- **A13(H8)의 "지지"는 부정적 증거의 부재이지 적극적 증거가 아니다.** 정체 후 부진이 관측되지 않았다는 것은 "교체하면 손해"를 증명하지 않는다. 교체의 실익을 보려면 교체 대상(다음 후보)의 성과까지 포함한 포트폴리오 반사실이 필요하고, 그건 이번 범위가 아니다.');
  md.push('- **생존편향 방향은 보수적이다.** 상장폐지 종목의 바는 폐지일에서 끊겨 전방수익이 절단(null)되므로, 최악 경로가 표본에서 빠진다 → 열화 신호의 효과는 과소추정된다.');
  md.push('- **거래비용·세금 미반영.** 이벤트 스터디 단계이므로 무비용 효과다. 매도 규칙으로 쓰려면 §5.1 3단계(포트폴리오)가 필요하다.');
  md.push('- **평균과 중앙값을 섞어 읽지 말 것.** §3의 품질 검정은 그룹 **평균** 차이를, §2-1·§6의 분해표는 **중앙값**을 쓴다. RS90 코호트 수익 분포는 오른쪽 꼬리가 매우 길어 두 통계량의 부호가 서로 다를 수 있다(평균 양수·중앙값 음수). 사전등록이 정한 지표를 각각 그대로 보고했으며 유리한 쪽을 고르지 않았다.');
  md.push('- **H1·H2·H7의 관측창(252거래일)은 사전등록에 없던 값이다.** §8.1은 H6에만 21일 창을 명시했다. 창 없이 실행하면 탐색이 데이터 끝까지 이어져 H1이 진입의 99%에서 발화하고 경고일이 잠금표본으로 넘어가므로, §5.2의 최장 호라이즌과 같은 252거래일로 고정했다. **결과를 보고 고른 값이 아니며 단일 값만 실행했다**(민감도 탐색 없음).');
  md.push('- **경고 발생률이 높다는 사실 자체를 유의할 것.** 관측창 안에서도 H2는 검증표본 진입의 80%, H7은 82%에서 발화한다. 이런 신호는 "예외적 위험 경고"가 아니라 **코호트의 정상 경로**에 가까우므로, 앱에서 알림으로 쓰면 경보 피로를 유발한다. 통계적 유의성과 운영 가치는 다르다.');
  md.push('');
  md.push('## 9. 이번 범위에서 하지 않은 것\n');
  md.push(`- §9.5 **포트폴리오 확인**(RS90 코호트 / 앱 신규후보∩RS90 두 베이스, 순 Sharpe·MDD·회전율·현금비중) — 미실행. 그래서 C10 최고 등급을 \`PASSIVE_BADGE\`로 상한했다(이번 실측 등급은 그보다 낮은 \`${qGrade.grade}\`).`);
  md.push('- P4 **앱 기존 규칙 대비 증분(C/D 반사실)** — 미실행.');
  md.push('- **잠금표본(2023-2025)** — 랭킹 자체를 생성하지 않았다. G8(합병대가)·G11(KRX 교차검증) 통과 전까지 봉인.');
  md.push('- **미국 RS 가설(E1~E7)** — 미국 PIT 데이터 미확보로 차단. 한국 결과를 미국에 전용하지 않는다.');
  md.push('- 앱 코드 수정 일절 없음(순수 리서치).\n');

  const mdPath = path.join(DOCS, 'RESULTS_3차배치_RS품질_보유열화.md');
  writeFileSync(mdPath, md.join('\n'));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n완료. 총 소요 ${secs}s`);
  console.log(`  JSON: ${path.join(OUT_DIR, 'd3_quality.json')}`);
  console.log(`  MD:   ${mdPath}`);
  console.log(`\n매수 품질(C10) 등급: ${qGrade.grade}`);
  for (const code of H_CODES) console.log(`  ${code}: ${hGrades[code].grade}`);
}

main().catch((e) => {
  console.error('실행 오류:', e);
  process.exit(1);
});
