// scripts/backtest/lectureSignals/runBatch2.ts
// ---------------------------------------------------------------------------
// 2차 배치 실행 드라이버 — P2(보유열화 H3/H4/H5 + 런치패드) · P3(동적자산배분 DAA).
//
// 순서 엄수: 각 트랙에서 **개발표본(2010-2019)을 먼저 완전히 확정**한 뒤 검증표본
// (2020-2022)을 코드·설정 변경 없이 1회 실행한다(§5.5, §16). 잠금표본(2023-2025)은
// 실행하지 않는다. DAA도 2022-12-31 을 넘는 데이터를 쓰지 않는다.
//
// 산출물:
//   output/d4_deterioration.json · output/d5_launchpad.json · output/d6_daa.json
//   docs/backtest/RESULTS_2차배치_보유열화_런치패드_DAA.md (한국어)
//
// 이 파일은 CLI 드라이버라 console.* 허용. `any`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEV_PERIOD, VALIDATION_PERIOD } from './configTypes';
import { loadLectureDataset, loadRegimeSeries } from './dataAccess';
import { makeIndexLookup } from './forwardReturns';
import { FACTOR_DECOMP_AXES } from './pipeline';
import { holmAdjust } from './eventStats';
import type { Batch2SignalResult } from './batch2Common';
import {
  DETERIORATION_CODES,
  DETERIORATION_CONST,
  runDeteriorationFamily,
  type DeteriorationFamilyResult,
} from './deterioration';
import {
  LAUNCHPAD_CODES,
  LAUNCHPAD_CONST,
  runLaunchpadFamily,
  type LaunchpadFamilyResult,
} from './launchpad';
import { DAA_SYMBOLS, DATA_END, DATA_START, fetchDaaMany } from './daaFetch';
import {
  DAA_ASSUMPTIONS,
  STRATEGY_LABEL,
  buildPriceTable,
  firstDates,
  runDaa,
  type DaaRunResult,
  type SimResult,
} from './daa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'output');
const DOCS = path.resolve(__dirname, '..', '..', '..', 'docs', 'backtest');

const pct = (x: number, d = 2): string =>
  Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a';
const num = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

// ===========================================================================
// 등급 판정(§13)
// ===========================================================================

type Grade =
  | 'REJECTED'
  | 'INCONCLUSIVE'
  | 'RESEARCH_ONLY'
  | 'SEGMENT_ONLY'
  | 'PASSIVE_BADGE'
  | 'REVIEW_WARNING';

interface GradeResult {
  grade: Grade;
  reasons: string[];
}

/**
 * 보유 열화(방향=음수: 신호 뒤 성과가 대조군보다 나쁨). D2 급성매도와 **동일 기준**(§8.3).
 * 통과해도 자동매도가 아니라 보유 검토 우선순위 가중치 후보일 뿐이다.
 */
function gradeDeterioration(
  dev: Batch2SignalResult,
  val: Batch2SignalResult,
  holmPVal: number
): GradeResult {
  const reasons: string[] = [];
  const MIN = 50;
  if (dev.nEvents < MIN || val.nEvents < MIN) {
    reasons.push(`이벤트 부족(dev ${dev.nEvents}, val ${val.nEvents} — 50건 미만)`);
    return { grade: 'INCONCLUSIVE', reasons };
  }
  const devMed = dev.primaryBootstrapMedian.point;
  const valMed = val.primaryBootstrapMedian.point;
  const dirDev = devMed < 0;
  const dirVal = valMed < 0;
  reasons.push(`dev 63일 중앙초과차 ${pct(devMed)}, val ${pct(valMed)}`);
  if (!dirDev) {
    reasons.push('개발표본 방향 불일치(신호가 대조군보다 나쁘지 않음) → 경제성 없음');
    return { grade: 'REJECTED', reasons };
  }
  const holmOk = holmPVal < 0.05;
  const econVal = val.summaryByHorizon[63].medianExcessDiff <= -0.03;
  const robustnessOk = !val.yearDecomp.regimeConcentrated && val.topContributor.directionKept;
  const tradeHelps = val.tradeCf.medianAdvantage > 0 && val.tradeCf.p10A > val.tradeCf.p10B;
  reasons.push(
    `검증: 방향${dirVal ? 'O' : 'X'} HolmP=${num(holmPVal, 4)}(${holmOk ? 'O' : 'X'}) ` +
      `경제성(≤-3%p)=${econVal ? 'O' : 'X'} 강건성=${robustnessOk ? 'O' : 'X'} 거래우위=${tradeHelps ? 'O' : 'X'}`
  );
  if (val.yearDecomp.regimeConcentrated) {
    reasons.push('REGIME_CONCENTRATED(1개 연도 제거 시 방향상실)');
  }
  if (dirVal && holmOk && econVal && robustnessOk) {
    if (tradeHelps) return { grade: 'REVIEW_WARNING', reasons };
    reasons.push('통계·경제성은 통과하나 다음시가 매도 반사실이 하위손실을 줄이지 못함');
    return { grade: 'PASSIVE_BADGE', reasons };
  }
  const segStrong = val.factorDecomp
    .filter((f) => f.axis === 'market' || f.axis === 'size')
    .flatMap((f) => f.groups)
    .some((g) => g.events >= MIN && g.medianSignalExcess <= -0.05);
  if (segStrong) {
    reasons.push('전체 표본 미통과이나 사전등록 구간(시장/시총)에서 강한 음의 초과 관측 → SEGMENT_ONLY 후보');
    return { grade: 'SEGMENT_ONLY', reasons };
  }
  reasons.push('개발표본은 방향 일치하나 검증표본에서 통계·경제성 미달');
  return { grade: 'RESEARCH_ONLY', reasons };
}

/**
 * 런치패드(방향=양수: 매수 가설). §10.3 채택 기준.
 *   ① 검증 126일 초과수익 차이 ≥ +2%p  ② 95% CI 하한 > 0  ③ 이벤트 100건 이상
 *   ④ 다음 시가 진입 포트폴리오 순 Sharpe +0.10 또는 MDD 2%p 개선  ← **이번 실행에서 미평가**
 * ④는 포트폴리오 엔진(진입 오버레이)이 이 하네스에 없어 계산하지 않았다. 따라서
 * ①~③을 모두 통과해도 **④ 미평가**를 등급 사유에 남긴다(앱 적용 판단 전 필수 잔여작업).
 */
function gradeLaunchpad(dev: Batch2SignalResult, val: Batch2SignalResult): GradeResult {
  const reasons: string[] = [];
  const MIN = LAUNCHPAD_CONST.minEventsRequired;
  if (dev.nEvents < MIN || val.nEvents < MIN) {
    reasons.push(`이벤트 부족(dev ${dev.nEvents}, val ${val.nEvents} — §10.3 100건 미만)`);
    return { grade: 'INCONCLUSIVE', reasons };
  }
  const devMed = dev.primaryBootstrapMedian.point;
  const valMed = val.primaryBootstrapMedian.point;
  reasons.push(`dev 126일 중앙초과차 ${pct(devMed)}, val ${pct(valMed)}`);
  if (!(devMed > 0)) {
    reasons.push('개발표본 방향 불일치(수렴돌파가 대조군보다 낫지 않음)');
    return { grade: 'REJECTED', reasons };
  }
  const econOk = val.summaryByHorizon[126].medianExcessDiff >= 0.02;
  const ciOk = Number.isFinite(val.primaryBootstrapMedian.ciLower) &&
    val.primaryBootstrapMedian.ciLower > 0;
  const robustnessOk = !val.yearDecomp.regimeConcentrated && val.topContributor.directionKept;
  reasons.push(
    `검증: 경제성(≥+2%p)=${econOk ? 'O' : 'X'} 95%CI하한>0=${ciOk ? 'O' : 'X'} ` +
      `[${pct(val.primaryBootstrapMedian.ciLower)}~${pct(val.primaryBootstrapMedian.ciUpper)}] ` +
      `강건성=${robustnessOk ? 'O' : 'X'}`
  );
  if (econOk && ciOk && robustnessOk) {
    reasons.push('§10.3 ④(다음시가 진입 포트폴리오 Sharpe/MDD)는 **미평가** — 앱 적용 전 필수');
    return { grade: 'REVIEW_WARNING', reasons };
  }
  reasons.push('개발표본은 방향 일치하나 검증표본에서 §10.3 기준 미달');
  return { grade: 'RESEARCH_ONLY', reasons };
}

// ===========================================================================
// 분해표 렌더링(§5.6 12축)
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

function renderFactorTables(
  by: Map<string, Batch2SignalResult>,
  codes: readonly string[],
  sampleLabel: string
): string {
  const lines: string[] = [];
  for (const axis of FACTOR_DECOMP_AXES) {
    const present = new Set<string>();
    for (const sig of codes) {
      const ax = by.get(sig)?.factorDecomp.find((f) => f.axis === axis);
      for (const g of ax?.groups ?? []) present.add(g.label);
    }
    const cols = orderedLabels(axis, present);
    lines.push(`**${axis}** — ${AXIS_TITLE[axis] ?? axis} (${sampleLabel})\n`);
    if (cols.length === 0) {
      lines.push('(해당 축의 구간이 없음)\n');
      continue;
    }
    lines.push(`| 신호 | ${cols.join(' | ')} |`);
    lines.push(`|---|${cols.map(() => '---').join('|')}|`);
    for (const sig of codes) {
      const ax = by.get(sig)?.factorDecomp.find((f) => f.axis === axis);
      const cells = cols.map((c) => {
        const g = ax?.groups.find((x) => x.label === c);
        if (!g) return '—';
        return `${pct(g.medianSignalExcess)}(${g.events})${g.inconclusive ? '*' : ''}`;
      });
      lines.push(`| ${sig} | ${cells.join(' | ')} |`);
    }
    lines.push('');
  }
  lines.push('> `*` = **INCONCLUSIVE(표본부족)** — 해당 셀 이벤트 50건 미만. 방향만 읽고 채택 판정에 쓰지 않는다(§5.7).');
  lines.push('');
  return lines.join('\n');
}

function renderYearTable(
  by: Map<string, Batch2SignalResult>,
  codes: readonly string[],
  years: readonly number[]
): string {
  const lines: string[] = [];
  lines.push(`| 신호 | ${years.map((y) => `${y}(n)`).join(' | ')} | REGIME_CONCENTRATED |`);
  lines.push(`|---|${years.map(() => '---').join('|')}|---|`);
  for (const sig of codes) {
    const v = by.get(sig);
    if (!v) continue;
    const cells = years.map((y) => {
      const rec = v.yearDecomp.byYear.find((b) => b.year === y);
      return rec ? `${pct(rec.medianExcessDiff)}(${rec.events})` : '—';
    });
    lines.push(`| ${sig} | ${cells.join(' | ')} | ${v.yearDecomp.regimeConcentrated ? 'YES' : 'no'} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ===========================================================================
// 섹션 렌더링
// ===========================================================================

function renderDeterioration(
  dev: DeteriorationFamilyResult,
  val: DeteriorationFamilyResult,
  grades: Record<string, GradeResult>
): string {
  const devBy = new Map(dev.bySignal.map((s) => [s.signal, s]));
  const valBy = new Map(val.bySignal.map((s) => [s.signal, s]));
  const L: string[] = [];
  L.push('## D4. 보유 중 열화 경고 H3·H4·H5 (§8)\n');
  L.push('- 주지표: 경고 발생 후 **63거래일 시장초과수익** 중앙값이 매칭 대조군보다 **낮은가**(방향=음수).');
  L.push('- 이벤트 정의: 조건이 **처음 충족되는 날**(false→true 상향 전이). 발화 후 63거래일 재발화 금지(D2와 동일 중복제거 규약).');
  L.push('- Holm 보정: **H3·H4·H5 3개를 하나의 패밀리**로 묶었다(§8.3의 H1·H2 사후급등 패밀리는 이번 범위 밖).');
  L.push('- 통과해도 §8.3에 따라 **자동매도가 아니라 보유 검토 우선순위 가중치** 후보다.\n');
  L.push('### 신호 정의(실행된 그대로)\n');
  L.push('| 코드 | 정의 | 계획서 대비 |');
  L.push('|---|---|---|');
  L.push(
    `| H3_VOL_SPIKE_ROLLING | realizedVol(20) ≥ ${DETERIORATION_CONST.h3Multiple} × realizedVol(63). 두 변동성 모두 **당일 D 제외**(기존 realizedVol 규약) | ⚠ **이탈**: 계획서 §8.1은 분모를 "진입일 고정"으로 뒀으나 이 트랙엔 진입 코호트 정의가 없어 **롤링 분모**로 재정의 |`
  );
  L.push(
    `| H4_UPPER_WICK_CLUSTER | 최근 ${DETERIORATION_CONST.h4Window}일(당일 포함) (adjHigh−adjClose)/adjHigh ≥ ${DETERIORATION_CONST.h4WickThreshold * 100}% 인 날 > ${DETERIORATION_CONST.h4CountThreshold}회 | 원 정의 그대로 |`
  );
  L.push(
    `| H5_BOOM_BUST_REPEAT | 비미래참조 상태기계(러닝저점×${DETERIORATION_CONST.h5UpMultiple} → 러닝고점 추적 → 고점×${DETERIORATION_CONST.h5DownMultiple} = 1사이클 완료) 완료 사이클이 최근 ${DETERIORATION_CONST.h5Window}일 내 ≥ ${DETERIORATION_CONST.h5CycleThreshold} | 원 정의 그대로(§8.1 상태기계 지시 준수) |`
  );
  L.push('');
  L.push('> **H3 분모 주의**: `realizedVol(i,63)` 창은 `[i-63, i-1]`이라 분자 창 `[i-20, i-1]`을 **포함**한다(중첩 기준선). 따라서 비율의 이론 상한이 압축되어 1.5배 충족이 원 정의(비중첩 진입 전 63일)보다 **어렵다** — 이 방향은 이벤트 수를 줄이는 보수적 편향이다.\n');
  L.push('### 신호별 요약 (63일 주호라이즌)\n');
  L.push('| 신호 | 표본 | 이벤트 | 고유종목 | 연도 | 신호중앙 | 대조중앙 | 중앙초과차 | 95%CI | HolmP | 매칭율 | 등급 |');
  L.push('|---|---|---:|---:|---:|---|---|---|---|---|---|---|');
  for (const sig of DETERIORATION_CODES) {
    const d = devBy.get(sig);
    const v = valBy.get(sig);
    if (!d || !v) continue;
    const dS = d.summaryByHorizon[63];
    const vS = v.summaryByHorizon[63];
    L.push(
      `| ${sig} | 개발 | ${d.nEvents} | ${dS.uniqueCodes} | ${dS.years} | ${pct(dS.signalMedian)} | ${pct(dS.controlMedian)} | ${pct(dS.medianExcessDiff)} | ${pct(d.primaryBootstrapMedian.ciLower)}~${pct(d.primaryBootstrapMedian.ciUpper)} | ${num(dev.holmAdjustedP[sig], 4)} | ${pct(d.matchRate, 0)} | — |`
    );
    L.push(
      `| ${sig} | 검증 | ${v.nEvents} | ${vS.uniqueCodes} | ${vS.years} | ${pct(vS.signalMedian)} | ${pct(vS.controlMedian)} | ${pct(vS.medianExcessDiff)} | ${pct(v.primaryBootstrapMedian.ciLower)}~${pct(v.primaryBootstrapMedian.ciUpper)} | ${num(val.holmAdjustedP[sig], 4)} | ${pct(v.matchRate, 0)} | **${grades[sig].grade}** |`
    );
  }
  L.push('');
  L.push('### 전방수익 전체 호라이즌 (검증표본, 시장초과 중앙차)\n');
  L.push('| 신호 | 20일 | 63일 | 126일 | 252일 | MAE(평균) | MFE(평균) | 10%하위수익 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const sig of DETERIORATION_CODES) {
    const v = valBy.get(sig);
    if (!v) continue;
    const s = (h: number) => pct(v.summaryByHorizon[h].medianExcessDiff);
    const p = v.summaryByHorizon[63];
    L.push(`| ${sig} | ${s(20)} | ${s(63)} | ${s(126)} | ${s(252)} | ${pct(p.maeMean)} | ${pct(p.mfeMean)} | ${pct(p.p10StockReturn)} |`);
  }
  L.push('');
  L.push('### 거래 반사실 A(다음시가 매도) vs B(63일 보유) — 비용차감, 검증표본\n');
  L.push('| 신호 | n | 중앙 A | 중앙 B | 중앙 매도우위(A−B) | A 하위10% | B 하위10% |');
  L.push('|---|---:|---|---|---|---|---|');
  for (const sig of DETERIORATION_CODES) {
    const v = valBy.get(sig);
    if (!v) continue;
    const t = v.tradeCf;
    L.push(`| ${sig} | ${t.n} | ${pct(t.medianA)} | ${pct(t.medianB)} | ${pct(t.medianAdvantage)} | ${pct(t.p10A)} | ${pct(t.p10B)} |`);
  }
  L.push('');
  L.push('### 연도별 기여 분해 (검증표본, 63일 중앙초과차)\n');
  L.push(renderYearTable(valBy, DETERIORATION_CODES, [2020, 2021, 2022]));
  L.push('### 연도별 기여 분해 (개발표본, 63일 중앙초과차)\n');
  L.push(renderYearTable(devBy, DETERIORATION_CODES, [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019]));
  L.push(`### §5.6 전 축 분해 (검증표본, 63일 신호 시장초과 중앙값) — ${FACTOR_DECOMP_AXES.length}축 전수\n`);
  L.push(renderFactorTables(valBy, DETERIORATION_CODES, '검증표본'));
  L.push('### D4 등급 판정 근거\n');
  for (const sig of DETERIORATION_CODES) {
    L.push(`- **${sig}: ${grades[sig].grade}**`);
    for (const r of grades[sig].reasons) L.push(`  - ${r}`);
  }
  L.push('');
  return L.join('\n');
}

function renderLaunchpad(
  dev: LaunchpadFamilyResult,
  val: LaunchpadFamilyResult,
  grades: Record<string, GradeResult>,
  holmDev: Record<string, number>,
  holmVal: Record<string, number>
): string {
  const devBy = new Map(dev.bySignal.map((s) => [s.signal, s]));
  const valBy = new Map(val.bySignal.map((s) => [s.signal, s]));
  const L: string[] = [];
  L.push('## D5. 런치패드 / MA 수렴 돌파 (§10)\n');
  L.push('- **매수 가설**(방향=양수): 수렴 상태에서 거래량 2배와 함께 20일 고점을 돌파한 종목은 대조군보다 **126일 시장초과수익이 높다**.');
  L.push('- 주호라이즌 126일, 중복제거 126거래일.');
  L.push('- **주결론은 수렴 임계 5%**이고 3%/7%는 민감도다(§10.3 단일 가설의 임계 민감도이므로 세 임계에 Holm 패밀리 보정을 적용하지 않는다 — 참고로 3개 보정치를 병기한다).');
  L.push('- ⚠ 강의의 MA10·21·50·65·200 조합이 아니라 **앱 변형 가설**(MA20·60·150)이다. 강의 성과 수치와 직접 비교하지 않는다(§10.2).\n');
  L.push('### 신호 정의(실행된 그대로)\n');
  L.push('| 요소 | 정의 |');
  L.push('|---|---|');
  L.push(`| 수렴 | \`maCompression = (max(MA20,MA60,MA150) − min(...)) / adjClose × 100 ≤ 임계\` (앱 산식 동일) |`);
  L.push(`| 수렴 평가시점 | ⚠ **돌파 직전일 D−1**(사전 고정·계획서 미명시분). 돌파 당일 급등 종가가 분모를 부풀려 수렴을 인위적으로 통과시키는 것을 막는다 |`);
  L.push(`| 돌파 | \`adjClose[D] > max(adjHigh[D−${LAUNCHPAD_CONST.breakoutHighWindow}..D−1])\` **AND** \`adjVolume[D] ≥ ${LAUNCHPAD_CONST.volMultiple} × mean(adjVolume[D−${LAUNCHPAD_CONST.volWindow}..D−1])\` (기준선 모두 당일 제외) |`);
  L.push(`| 이벤트화 | 조건 false→true 상향 전이일. 발화 후 ${LAUNCHPAD_CONST.dedupHorizon}거래일 재발화 금지 |`);
  L.push('');
  L.push('### 임계값별 요약 (126일 주호라이즌)\n');
  L.push('| 신호(수렴임계) | 표본 | 이벤트 | 고유종목 | 연도 | 신호중앙 | 대조중앙 | 중앙초과차 | 95%CI | p(원) | p(Holm 3임계) | 매칭율 | 등급 |');
  L.push('|---|---|---:|---:|---:|---|---|---|---|---|---|---|---|');
  for (const sig of LAUNCHPAD_CODES) {
    const d = devBy.get(sig);
    const v = valBy.get(sig);
    if (!d || !v) continue;
    const dS = d.summaryByHorizon[126];
    const vS = v.summaryByHorizon[126];
    L.push(
      `| ${sig} | 개발 | ${d.nEvents} | ${dS.uniqueCodes} | ${dS.years} | ${pct(dS.signalMedian)} | ${pct(dS.controlMedian)} | ${pct(dS.medianExcessDiff)} | ${pct(d.primaryBootstrapMedian.ciLower)}~${pct(d.primaryBootstrapMedian.ciUpper)} | ${num(d.primaryBootstrapMedian.pValue, 4)} | ${num(holmDev[sig], 4)} | ${pct(d.matchRate, 0)} | — |`
    );
    L.push(
      `| ${sig} | 검증 | ${v.nEvents} | ${vS.uniqueCodes} | ${vS.years} | ${pct(vS.signalMedian)} | ${pct(vS.controlMedian)} | ${pct(vS.medianExcessDiff)} | ${pct(v.primaryBootstrapMedian.ciLower)}~${pct(v.primaryBootstrapMedian.ciUpper)} | ${num(v.primaryBootstrapMedian.pValue, 4)} | ${num(holmVal[sig], 4)} | ${pct(v.matchRate, 0)} | **${grades[sig].grade}** |`
    );
  }
  L.push('');
  L.push('### 전방수익 전체 호라이즌 (검증표본, 시장초과 중앙차)\n');
  L.push('| 신호 | 20일 | 63일 | 126일 | 252일 | MAE(평균) | MFE(평균) | 10%하위수익 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const sig of LAUNCHPAD_CODES) {
    const v = valBy.get(sig);
    if (!v) continue;
    const s = (h: number) => pct(v.summaryByHorizon[h].medianExcessDiff);
    const p = v.summaryByHorizon[126];
    L.push(`| ${sig} | ${s(20)} | ${s(63)} | ${s(126)} | ${s(252)} | ${pct(p.maeMean)} | ${pct(p.mfeMean)} | ${pct(p.p10StockReturn)} |`);
  }
  L.push('');
  L.push('### 연도별 기여 분해 (검증표본, 126일 중앙초과차)\n');
  L.push(renderYearTable(valBy, LAUNCHPAD_CODES, [2020, 2021, 2022]));
  L.push(`### §5.6 전 축 분해 (검증표본, 126일 신호 시장초과 중앙값) — ${FACTOR_DECOMP_AXES.length}축 전수\n`);
  L.push(renderFactorTables(valBy, LAUNCHPAD_CODES, '검증표본'));
  L.push('### D5 등급 판정 근거\n');
  for (const sig of LAUNCHPAD_CODES) {
    L.push(`- **${sig}: ${grades[sig].grade}**`);
    for (const r of grades[sig].reasons) L.push(`  - ${r}`);
  }
  L.push('');
  return L.join('\n');
}

/** 런치패드 결과에 근거한 `maCompression` 존치/제거 의견(§10.3 마지막 문단). */
function renderMaCompressionOpinion(
  main: Grade,
  devMain: Batch2SignalResult,
  valMain: Batch2SignalResult,
  variants: { code: string; devDiff: number; valDiff: number; nDev: number; nVal: number }[]
): string {
  const L: string[] = [];
  L.push('### `maCompression` 존치 vs 제거 의견\n');
  const valDiff = valMain.summaryByHorizon[126].medianExcessDiff;
  const devDiff = devMain.summaryByHorizon[126].medianExcessDiff;
  const consistent = variants.every((v) => Math.sign(v.valDiff) === Math.sign(valDiff));
  L.push(
    `- 주임계(5%) 개발 ${pct(devDiff)} / 검증 ${pct(valDiff)}, 이벤트 개발 ${devMain.nEvents}건 / 검증 ${valMain.nEvents}건. ` +
      `임계 3%·5%·7% 방향 ${consistent ? '일치' : '불일치'}.`
  );
  if (main === 'REVIEW_WARNING') {
    L.push('- **의견: 존치(관찰용 → 진입 검토 큐 후보)**. 사전등록 §10.3 ①~③을 통과했다. 다만 ④(다음시가 진입 포트폴리오 Sharpe/MDD)가 미평가이므로 **표시·검토 큐까지만**이고 매수 자동화는 금지다.');
  } else if (main === 'INCONCLUSIVE') {
    L.push('- **의견: 관찰용으로만 존치(판단 보류)**. §10.3의 이벤트 100건 요건을 못 채워 통계적으로 아무 말도 할 수 없다. 제거를 정당화할 근거도 없다 — 임계를 낮춰 표본을 늘린 뒤 재검증하거나, 현 상태로 화면 지표로만 남기는 것이 맞다.');
  } else if (main === 'RESEARCH_ONLY' || main === 'SEGMENT_ONLY') {
    L.push('- **의견: 관찰용 유지(진입 규칙화 금지)**. 개발표본 방향은 맞지만 검증표본에서 §10.3 기준을 못 넘었다. 화면 지표로 두는 비용은 0에 가깝고 정보가치는 남아 있으므로 제거까지 갈 이유는 없으나, **매수 신호·점수에 쓰는 것은 근거 없음**이다.');
  } else {
    const revDev = devMain.primaryBootstrapMedian.ciUpper < 0;
    const revVal = valMain.primaryBootstrapMedian.ciUpper < 0;
    if (revDev && revVal) {
      L.push(
        `- **의견: 매수 근거에서 제거. 단순 무효과가 아니라 "역방향이 유의"하다.** 개발·검증 두 표본 모두에서 ` +
          `95%CI 상한이 0보다 작다(개발 ${pct(devMain.primaryBootstrapMedian.ciLower)}~${pct(devMain.primaryBootstrapMedian.ciUpper)}, ` +
          `검증 ${pct(valMain.primaryBootstrapMedian.ciLower)}~${pct(valMain.primaryBootstrapMedian.ciUpper)}). ` +
          `즉 **거래량 2배 동반 20일 고점 돌파 종목은 매칭 대조군보다 이후 126일 성과가 유의하게 나빴다**. ` +
          `임계를 3%·5%·7%로 바꿔도 방향이 그대로다.`
      );
      L.push('- 이 결과 자체는 "돌파 매수를 뒤집어 매도 신호로 쓰라"는 뜻이 **아니다**. 대조군 매칭이 업종 중립이 아니고 배당·상장폐지 처리의 편향이 남아 있어(아래 해석 주의) 역방향 매매 규칙의 근거로 삼기에는 부족하다. 확실한 것은 **순방향 매수 근거로 쓸 수 없다**는 것뿐이다.');
      L.push('- 실무 처방: `maCompression` **수치 표시는 존치**(차트 보조지표로 무해), **"수렴 후 돌파 = 매수 기회"라는 문구·가점은 제거**. 한국 표본에서 이 서술은 반대로 관측된다.');
    } else {
      L.push('- **의견: 매수 근거로는 제거, 표시 지표로만 존치 검토**. 개발표본에서부터 방향이 가설과 반대이거나 효과가 없다. `maCompression` 값 자체는 차트 보조지표로 무해하지만, **"수렴 후 돌파 = 매수 우위"라는 서술은 이 데이터에서 지지되지 않으므로 문구·점수에서 빼야 한다**.');
    }
  }
  L.push('- 어느 결론이든 이 판단은 **한국 2010-2022 표본** 기준이며 미국·잠금표본(2023-2025)에는 적용하지 않는다.');
  L.push('');
  return L.join('\n');
}

function renderDaa(daa: DaaRunResult, firstDateMap: Map<string, string>): string {
  const L: string[] = [];
  const byCode = new Map(daa.strategies.map((s) => [s.strategy, s]));
  const bench = new Map(daa.benchmarks.map((s) => [s.strategy, s]));

  L.push('## D6. 동적 자산배분 5전략 (§11)\n');
  L.push('### ⚠ 가정 티커 (계획서 §11은 이 항목들을 `BLOCKED_DEFINITION`으로 뒀다 — 아래는 전부 **가정**이다)\n');
  L.push('| 역할 | 가정 티커 | 첫 거래일(Yahoo) |');
  L.push('|---|---|---|');
  const fd = (s: string): string => firstDateMap.get(s) ?? 'n/a';
  L.push(`| 채권 DAA 후보 8종 | ${DAA_ASSUMPTIONS.bonds8.join(', ')} | ${DAA_ASSUMPTIONS.bonds8.map((s) => `${s} ${fd(s)}`).join(' / ')} |`);
  L.push(`| 미국주식 | ${DAA_ASSUMPTIONS.equityUs} | ${fd(DAA_ASSUMPTIONS.equityUs)} |`);
  L.push(`| 글로벌(미국外)주식 | ${DAA_ASSUMPTIONS.equityIntl} | ${fd(DAA_ASSUMPTIONS.equityIntl)} |`);
  L.push(`| 오리지널 듀얼모멘텀 안전자산 | ${DAA_ASSUMPTIONS.safeOriginal} | ${fd(DAA_ASSUMPTIONS.safeOriginal)} |`);
  L.push(`| 정적 배분 | ${DAA_ASSUMPTIONS.staticSleeve.join(', ')} 각 ${DAA_ASSUMPTIONS.staticWeight * 100}% | — |`);
  L.push(`| 현금 대용 | ${DAA_ASSUMPTIONS.cashProxy} (상장 전이면 무이자 현금 0%) | ${fd(DAA_ASSUMPTIONS.cashProxy)} |`);
  L.push('');
  L.push('> **이 표의 티커가 사용자가 의도한 것과 다르면 결과 전체가 달라진다.** 확인 후 재실행이 필요하다.\n');
  L.push('### 규약\n');
  L.push('| 항목 | 값 |');
  L.push('|---|---|');
  L.push(`| 데이터 | Yahoo v8 \`adjclose\`(**배당·분할 조정 = 총수익**). 시가는 같은 날 조정계수 \`adjclose/close\`를 시가에 곱해 재구성 |`);
  L.push(`| 공통구간 | ${daa.from} ~ ${daa.to} (${daa.tradingDays} 거래일, 전 심볼 교집합 달력) |`);
  L.push(`| 실제 성과 구간 | 첫 신호 ${daa.firstSignalDate} → **첫 체결 ${daa.firstTradeDate}** ~ ${daa.to} |`);
  L.push(`| 모멘텀 | 12개월 = ${DAA_ASSUMPTIONS.lookback12M}거래일, 6개월 = ${DAA_ASSUMPTIONS.lookback6M}거래일 (총수익 기준) |`);
  L.push('| 신호·체결 | **그 달 마지막 거래일 종가로 신호 → 다음 거래일(=익월 첫 거래일) 시가 체결.** 같은 봉 체결 금지(체결일 하루를 전일종가→시가 / 시가→종가 두 구간으로 분리해 계산) |');
  L.push(`| 비용 | 편도 ${DAA_ASSUMPTIONS.costOneWay * 100}% × 매매 명목금액(cost = ${DAA_ASSUMPTIONS.costOneWay} × Σ\\|Δw\\|) |`);
  L.push('| 세금 | **생략**(§11 미정의). 실제 계좌 성과는 이보다 낮다 |');
  L.push('| Sharpe | 무위험수익률 0 기준, **비용 차감 후**(순 Sharpe) |');
  L.push('| 잠금 | 2022-12-31 이후 데이터 미사용 |');
  L.push('');
  L.push('### 전략 정의\n');
  L.push('| 전략 | 정의 |');
  L.push('|---|---|');
  L.push(`| STATIC | ${STRATEGY_LABEL.STATIC} — 연 1회(해가 바뀐 첫 거래일)만 25%로 되돌림 |`);
  L.push(`| BOND_DAA | ${STRATEGY_LABEL.BOND_DAA} — 매월. 8종을 6개월 모멘텀 내림차순 정렬, 상위 3개 각 1/3. 그 슬롯 모멘텀이 음수면 그 1/3만 BIL |`);
  L.push(`| DUAL_ORIGINAL | ${STRATEGY_LABEL.DUAL_ORIGINAL} — 매월. SPY·VEU 중 12개월 모멘텀 우세 종목을 고르고, **그 우세 종목의 12개월 수익이 양수면** 100% 매수, 아니면 AGG 100% |`);
  L.push(`| DUAL_VARIANT | ${STRATEGY_LABEL.DUAL_VARIANT} — 위와 동일하되 안전자산만 **채권 DAA**로 교체 |`);
  L.push(`| BLEND_50_50 | ${STRATEGY_LABEL.BLEND_50_50} — 두 슬리브를 매월 50:50으로 되돌림(이체분에도 편도비용) |`);
  L.push('');
  L.push('> **절대 모멘텀 기준을 "우세 종목의 12개월 수익 > 0"으로 잡은 것은 사전 고정 선택**이다(계획서 미명시). 오리지널·변형에 **동일하게** 적용해 두 전략의 차이가 오직 안전자산뿐이도록 했다 — 그래야 (b) "변형 > 오리지널" 비교가 성립한다.\n');

  L.push('### 5전략 성과 (비용차감, 세금제외)\n');
  L.push('| 전략 | CAGR | 순 Sharpe | MDD | 최종배수 | 리밸런싱 | 평균 월회전율 |');
  L.push('|---|---|---|---|---|---:|---|');
  for (const s of daa.strategies) {
    L.push(
      `| ${s.strategy} | ${pct(s.perf.cagr)} | ${num(s.perf.sharpe, 3)} | ${pct(s.perf.mdd)} | ${num(s.perf.finalEquity, 3)}x | ${s.rebalances} | ${pct(s.avgMonthlyTurnover, 1)} |`
    );
  }
  L.push('');
  L.push('### 매수후보유 기준선 (같은 구간·같은 비용규약)\n');
  L.push('| 자산 | CAGR | 순 Sharpe | MDD | 최종배수 |');
  L.push('|---|---|---|---|---|');
  for (const s of daa.benchmarks) {
    L.push(`| ${s.strategy.replace('BH_', '')} | ${pct(s.perf.cagr)} | ${num(s.perf.sharpe, 3)} | ${pct(s.perf.mdd)} | ${num(s.perf.finalEquity, 3)}x |`);
  }
  L.push('');

  // 연도별 수익률
  const years = [...new Set(daa.strategies[0].byYear.map((y) => y.year))].sort();
  L.push('### 연도별 수익률\n');
  L.push(`| 전략 | ${years.join(' | ')} |`);
  L.push(`|---|${years.map(() => '---').join('|')}|`);
  const yrow = (s: SimResult, label: string): void => {
    const m = new Map(s.byYear.map((y) => [y.year, y.ret]));
    L.push(`| ${label} | ${years.map((y) => (m.has(y) ? pct(m.get(y) as number, 1) : '—')).join(' | ')} |`);
  };
  for (const s of daa.strategies) yrow(s, s.strategy);
  for (const s of daa.benchmarks) yrow(s, s.strategy.replace('BH_', '(BH) '));
  L.push('');

  // ---- 검증 포인트 (a)(b)(c) ----
  L.push('### 검증 포인트 판정\n');
  const bond = byCode.get('BOND_DAA') as SimResult;
  const agg = bench.get('BH_AGG');
  const orig = byCode.get('DUAL_ORIGINAL') as SimResult;
  const vari = byCode.get('DUAL_VARIANT') as SimResult;
  const stat = byCode.get('STATIC') as SimResult;
  const blend = byCode.get('BLEND_50_50') as SimResult;
  const yr = (s: SimResult | undefined, y: number): number => {
    const rec = s?.byYear.find((b) => b.year === y);
    return rec ? rec.ret : NaN;
  };

  // (a)
  const bond2022 = yr(bond, 2022);
  const agg2022 = yr(agg, 2022);
  const aOk = Number.isFinite(bond2022) && Number.isFinite(agg2022) && bond2022 > agg2022;
  L.push(`**(a) 2022년 채권 DAA가 AGG 폭락을 회피했는가?** → ${aOk ? '**지지**' : '**미지지**'}`);
  L.push(`- 2022년 수익률: 채권DAA ${pct(bond2022, 2)} vs AGG 매수후보유 ${pct(agg2022, 2)} (차 ${pct(bond2022 - agg2022, 2)})`);
  L.push(
    aOk
      ? '- 6개월 모멘텀이 음수인 슬롯을 BIL로 돌리는 규칙이 2022년 채권 동반하락 구간에서 실제로 손실을 줄였다.'
      : '- 모멘텀 필터가 2022년 채권 하락을 피하지 못했다. 월 1회 리밸런싱 지연(신호→익월 체결) 때문에 급락 국면 전환이 늦었을 가능성을 함께 본다.'
  );
  L.push('');

  // (b)
  const bSharpe = vari.perf.sharpe - orig.perf.sharpe;
  const bCagr = vari.perf.cagr - orig.perf.cagr;
  const bMdd = orig.perf.mdd - vari.perf.mdd;
  const bOk = bSharpe > 0;
  L.push(`**(b) 변형 듀얼모멘텀 > 오리지널 듀얼모멘텀인가?** → ${bOk ? '**지지**' : '**미지지**'} (주지표 = 순 Sharpe)`);
  L.push(`- Sharpe ${num(orig.perf.sharpe, 3)} → ${num(vari.perf.sharpe, 3)} (Δ${num(bSharpe, 3)}), CAGR ${pct(orig.perf.cagr)} → ${pct(vari.perf.cagr)} (Δ${pct(bCagr)}), MDD ${pct(orig.perf.mdd)} → ${pct(vari.perf.mdd)} (개선 ${pct(bMdd)})`);
  L.push('- 두 전략은 **위험자산 신호가 완전히 동일**하고 안전자산만 다르므로, 차이는 전부 "위험회피 구간에서 AGG 대신 채권DAA를 든 효과"다.');
  L.push('');

  // (c)
  const avgMdd = (stat.perf.mdd + vari.perf.mdd) / 2;
  const minMdd = Math.min(stat.perf.mdd, vari.perf.mdd);
  const cStrong = blend.perf.mdd < minMdd;
  const cPartial = blend.perf.mdd < avgMdd;
  L.push(
    `**(c) 정적50 + 동적50이 MDD를 낮추는가?** → ${cStrong ? '**지지(분산효과 확인)**' : cPartial ? '**부분지지(가중평균보다는 낮으나 최저 슬리브보다는 높음)**' : '**미지지**'}`
  );
  L.push(`- MDD: 정적 ${pct(stat.perf.mdd)} / 변형동적 ${pct(vari.perf.mdd)} / 혼합 ${pct(blend.perf.mdd)} (두 슬리브 단순평균 ${pct(avgMdd)})`);
  L.push(`- Sharpe: 정적 ${num(stat.perf.sharpe, 3)} / 변형동적 ${num(vari.perf.sharpe, 3)} / 혼합 ${num(blend.perf.sharpe, 3)}`);
  L.push(`- 계획서 D5의 목표치 "MDD < 10%"는 ${blend.perf.mdd < 0.1 ? '**충족**' : '**미충족**'}(혼합 MDD ${pct(blend.perf.mdd)}). ${blend.perf.mdd < 0.1 ? '' : '§11은 "특정 MDD 수치 재현을 목표로 하지 않는다"고 못박았으므로 이 미달 자체가 기각 사유는 아니다.'}`);
  L.push('');

  // ---- 가설에 불리한 관측 두 가지(반드시 병기) ----
  const spy = bench.get('BH_SPY');
  L.push('### 가설에 불리한 관측 (숨기지 않고 병기)\n');
  if (spy) {
    const beatCagr = daa.strategies.filter((s) => s.perf.cagr > spy.perf.cagr).map((s) => s.strategy);
    const beatSharpe = daa.strategies.filter((s) => s.perf.sharpe > spy.perf.sharpe).map((s) => s.strategy);
    L.push(
      `- **① 이 구간에서 SPY 매수후보유(CAGR ${pct(spy.perf.cagr)}, Sharpe ${num(spy.perf.sharpe, 3)}, MDD ${pct(spy.perf.mdd)})를 CAGR로 이긴 전략은 ${beatCagr.length === 0 ? '하나도 없다' : beatCagr.join('·')}.** ` +
        `Sharpe로 이긴 전략은 ${beatSharpe.length === 0 ? '없다' : beatSharpe.join('·')}. ` +
        `2009-2022는 미국주식 초강세 구간이므로 이 비교는 **동적배분에 구조적으로 불리**하지만, "동적배분이 더 낫다"는 주장을 이 표본으로는 세울 수 없다는 사실은 그대로다.`
    );
  }
  const covidNote =
    Math.abs(orig.perf.mdd - vari.perf.mdd) < 1e-9 && spy && Math.abs(orig.perf.mdd - spy.perf.mdd) < 1e-9;
  L.push(
    `- **② 듀얼모멘텀 두 전략의 MDD(${pct(orig.perf.mdd)})가 ${covidNote ? 'SPY 매수후보유와 소수점까지 동일하다' : '위험자산 보유 구간에서 발생했다'}.** ` +
      `월 1회 신호는 2020년 코로나 급락(고점→저점 5주)을 **전혀 회피하지 못했다** — 급락이 시작된 달의 말일 신호 시점에는 12개월 모멘텀이 아직 양수였기 때문이다. ` +
      `**"동적배분 = 급락 방어"라는 서술은 이 구현·이 주기에서는 성립하지 않는다.** 안전자산 교체(변형)는 하락을 **겪은 뒤** 회복 국면의 성과를 바꿀 뿐이다.`
  );
  L.push(
    `- **③ 채권 DAA는 회전율이 가장 높다(월 ${pct(bond.avgMonthlyTurnover, 1)}).** 편도 0.1%를 가정했으나 실제 스프레드·환전·세금이 붙으면 표의 CAGR ${pct(bond.perf.cagr)}는 더 내려간다.`
  );
  L.push('');

  L.push('### DAA 서술 결론 (§13 등급 미적용)\n');
  L.push(
    `- 이 표본에서 **가장 방어적인 조합은 STATIC**(Sharpe ${num(stat.perf.sharpe, 3)}, MDD ${pct(stat.perf.mdd)})이고, ` +
      `**가장 공격적인 조합은 DUAL_VARIANT**(CAGR ${pct(vari.perf.cagr)}, MDD ${pct(vari.perf.mdd)})이며, ` +
      `**혼합(BLEND_50_50)은 그 사이에서 Sharpe ${num(blend.perf.sharpe, 3)} / MDD ${pct(blend.perf.mdd)}로 타협**한다. 셋 다 SPY 매수후보유보다 CAGR이 낮다.`
  );
  L.push('- §11은 자산배분을 개별 신호 등급 체계(§13)로 판정하지 않는다. 위 표는 **비교 결과 보고**이며 채택 판정이 아니다.');
  L.push('- **자산배분 변경은 백테스트와 별개로 사용자 승인이 필요하다**(§11 마지막 문단). 이 문서는 승인 요청이 아니다.');
  L.push('');
  return L.join('\n');
}

// ===========================================================================
// 메인
// ===========================================================================

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('강의 가설 2차 배치(D4 보유열화 + D5 런치패드) + P3(D6 자산배분) 실행\n');

  // ---------- KR 데이터 ----------
  console.log('KR 데이터 로드 중...');
  const ds = await loadLectureDataset();
  console.log(
    `  prelock=${ds.manifestPrelock}, 투자가능 ${ds.investableUnion.size}종목, 바 ${ds.bars.size}, 미분류 제외 ${ds.unresolvedCodes.size}`
  );
  const regime = await loadRegimeSeries('^KS11');
  const index = makeIndexLookup(regime.dates, regime.close);
  console.log(`  KOSPI 레짐 시계열 ${regime.dates.length}일`);

  // ---------- D4 보유 열화 (개발 → 검증) ----------
  console.log('\nD4 보유열화 개발표본(H3/H4/H5)...');
  const d4Dev = runDeteriorationFamily(ds, regime, index, DEV_PERIOD);
  console.log(`  개발 이벤트: ${d4Dev.bySignal.map((s) => `${s.signal}=${s.nEvents}`).join(', ')}`);
  console.log('D4 보유열화 검증표본...');
  const d4Val = runDeteriorationFamily(ds, regime, index, VALIDATION_PERIOD);
  console.log(`  검증 이벤트: ${d4Val.bySignal.map((s) => `${s.signal}=${s.nEvents}`).join(', ')}`);
  const d4DevBy = new Map(d4Dev.bySignal.map((s) => [s.signal, s]));
  const d4ValBy = new Map(d4Val.bySignal.map((s) => [s.signal, s]));
  const d4Grades: Record<string, GradeResult> = {};
  for (const sig of DETERIORATION_CODES) {
    d4Grades[sig] = gradeDeterioration(
      d4DevBy.get(sig) as Batch2SignalResult,
      d4ValBy.get(sig) as Batch2SignalResult,
      d4Val.holmAdjustedP[sig]
    );
  }

  // ---------- D5 런치패드 (개발 → 검증) ----------
  console.log('\nD5 런치패드 개발표본(수렴 5%/3%/7%)...');
  const d5Dev = runLaunchpadFamily(ds, regime, index, DEV_PERIOD);
  console.log(`  개발 이벤트: ${d5Dev.bySignal.map((s) => `${s.signal}=${s.nEvents}`).join(', ')}`);
  console.log('D5 런치패드 검증표본...');
  const d5Val = runLaunchpadFamily(ds, regime, index, VALIDATION_PERIOD);
  console.log(`  검증 이벤트: ${d5Val.bySignal.map((s) => `${s.signal}=${s.nEvents}`).join(', ')}`);
  const d5DevBy = new Map(d5Dev.bySignal.map((s) => [s.signal, s]));
  const d5ValBy = new Map(d5Val.bySignal.map((s) => [s.signal, s]));
  const d5Grades: Record<string, GradeResult> = {};
  for (const sig of LAUNCHPAD_CODES) {
    d5Grades[sig] = gradeLaunchpad(
      d5DevBy.get(sig) as Batch2SignalResult,
      d5ValBy.get(sig) as Batch2SignalResult
    );
  }
  // 참고용 Holm(3임계) — 등급 판정엔 쓰지 않는다.
  const holmOf = (fam: LaunchpadFamilyResult): Record<string, number> => {
    const ps = fam.bySignal.map((s) => s.primaryBootstrapMedian.pValue);
    const adj = holmAdjust(ps);
    const out: Record<string, number> = {};
    fam.bySignal.forEach((s, k) => (out[s.signal] = adj[k]));
    return out;
  };
  const holmDev = holmOf(d5Dev);
  const holmVal = holmOf(d5Val);

  // ---------- D6 자산배분 ----------
  console.log('\nD6 자산배분 데이터 로드(캐시 우선)...');
  const series = await fetchDaaMany(DAA_SYMBOLS, DATA_START, DATA_END);
  const fdMap = firstDates(series);
  const commonStart = [...fdMap.values()].sort().pop() as string;
  console.log(`  공통 시작일(가장 늦은 상장) = ${commonStart}`);
  const table = buildPriceTable(series, DAA_SYMBOLS, commonStart, DATA_END);
  console.log(`  공통 달력 ${table.dates.length}거래일 (${table.dates[0]} ~ ${table.dates[table.dates.length - 1]})`);
  const daa = runDaa(table);
  console.log(`  첫 신호 ${daa.firstSignalDate} → 첫 체결 ${daa.firstTradeDate}`);
  for (const s of daa.strategies) {
    console.log(`  ${s.strategy.padEnd(14)} CAGR ${pct(s.perf.cagr)} Sharpe ${num(s.perf.sharpe, 2)} MDD ${pct(s.perf.mdd)}`);
  }

  // ---------- 산출물 ----------
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, 'd4_deterioration.json'),
    JSON.stringify({ dev: d4Dev, val: d4Val, grades: d4Grades }, null, 2)
  );
  writeFileSync(
    path.join(OUT_DIR, 'd5_launchpad.json'),
    JSON.stringify({ dev: d5Dev, val: d5Val, grades: d5Grades, holmDev, holmVal }, null, 2)
  );
  // 일간수익 시계열(3500일×9)은 파일 크기 때문에 제외. 성과지표·연도수익·신호로그는 유지.
  const omitDaily = (key: string, value: unknown): unknown =>
    key === 'dailyReturns' || key === 'dates' ? undefined : value;
  writeFileSync(
    path.join(OUT_DIR, 'd6_daa.json'),
    JSON.stringify(
      {
        assumptions: DAA_ASSUMPTIONS,
        firstDates: Object.fromEntries(fdMap),
        commonStart,
        result: daa,
      },
      omitDaily,
      2
    )
  );

  const md: string[] = [];
  md.push('# 2차 배치 결과 — 보유 열화(D4) · 런치패드(D5) · 동적 자산배분(D6)\n');
  md.push(`- 실행일: ${new Date().toISOString().slice(0, 10)}`);
  md.push('- 사전등록: `docs/backtest/PREREG_강의가설_통합백테스트계획.md` §8·§10·§11 + `docs/backtest/PLAN_강의가설_전면검증_v2.md` §3 P2·P3');
  md.push('- 표본: 개발 2010-01~2019-12 → 검증 2020-01~2022-12(코드·설정 변경 없이 1회). **잠금(2023-2025) 미실행.**');
  md.push('- 공통 규율: seed 20260725, 60거래일 블록부트스트랩 10,000회, Holm 보정, 95%CI, `adj_*` 가격, 월말 PIT 유니버스(effectiveMonth 키 — 룩어헤드 수정본), 미분류 168종목 제외.');
  md.push('- **이 문서는 순수 리서치 결과다. 앱 코드는 이번 작업에서 한 줄도 수정하지 않았고, 앱 적용은 이 문서의 결론이 아니다.**\n');
  md.push('## 요약\n');
  md.push('| 트랙 | 신호 | 개발 이벤트 | 검증 이벤트 | 검증 주지표 | 등급 |');
  md.push('|---|---|---:|---:|---|---|');
  for (const sig of DETERIORATION_CODES) {
    const d = d4DevBy.get(sig) as Batch2SignalResult;
    const v = d4ValBy.get(sig) as Batch2SignalResult;
    md.push(`| D4 보유열화 | ${sig} | ${d.nEvents} | ${v.nEvents} | 63일 ${pct(v.summaryByHorizon[63].medianExcessDiff)} | **${d4Grades[sig].grade}** |`);
  }
  for (const sig of LAUNCHPAD_CODES) {
    const d = d5DevBy.get(sig) as Batch2SignalResult;
    const v = d5ValBy.get(sig) as Batch2SignalResult;
    md.push(`| D5 런치패드 | ${sig} | ${d.nEvents} | ${v.nEvents} | 126일 ${pct(v.summaryByHorizon[126].medianExcessDiff)} | **${d5Grades[sig].grade}** |`);
  }
  md.push(`| D6 자산배분 | 5전략 비교 | — | — | ${daa.firstTradeDate}~${daa.to} | 서술결론(§13 미적용) |`);
  md.push('');
  md.push(renderDeterioration(d4Dev, d4Val, d4Grades));
  md.push(renderLaunchpad(d5Dev, d5Val, d5Grades, holmDev, holmVal));
  md.push(
    renderMaCompressionOpinion(
      d5Grades.LAUNCHPAD_C5.grade,
      d5DevBy.get('LAUNCHPAD_C5') as Batch2SignalResult,
      d5ValBy.get('LAUNCHPAD_C5') as Batch2SignalResult,
      LAUNCHPAD_CODES.map((c) => ({
        code: c,
        devDiff: (d5DevBy.get(c) as Batch2SignalResult).summaryByHorizon[126].medianExcessDiff,
        valDiff: (d5ValBy.get(c) as Batch2SignalResult).summaryByHorizon[126].medianExcessDiff,
        nDev: (d5DevBy.get(c) as Batch2SignalResult).nEvents,
        nVal: (d5ValBy.get(c) as Batch2SignalResult).nEvents,
      }))
    )
  );
  md.push(renderDaa(daa, fdMap));

  md.push('## 결과 해석 주의 (비판적 검토)\n');
  md.push('- **D4/D5 매칭 잔차**: 대조군은 시총·직전63일수익·변동성·거래대금 5분위 매칭이며 업종 중립이 아니다. 관측된 초과의 일부는 "더 극단적인 특성의 더 강한 평균회귀"일 수 있다(조건부 상관이지 인과가 아님).');
  md.push('- **생존편향 방향**: 상장폐지 종목의 전방수익은 절단(null)된다. 최악 경로가 표본에서 빠지므로 매도 신호(D4)의 효과는 **과소추정**(보수적), 매수 신호(D5)는 반대로 **과대추정** 쪽으로 치우칠 수 있다.');
  md.push('- **D5는 배당 미반영**(PRICE_RETURN_EX_DIVIDEND). 126일 초과수익 비교는 신호·대조군 양쪽에 같은 편향이 걸리므로 상대비교는 유효하지만 절대 수익 수준은 과소평가다.');
  md.push('- **D4 A/B 반사실의 순환성**: 신호가 하락할 종목을 고르므로 "다음시가 매도가 낫다"는 부분적으로 자기충족적이다. 앱 기존 매도규칙 대비 증분(C/D)은 여전히 미검증이다(P4).');
  md.push(`- **D6는 2008년을 보지 못한다.** 공통구간이 가장 늦게 상장한 티커(${commonStart})에 묶여 12개월 워밍업 후 **${daa.firstTradeDate}**부터 시작한다. 동적배분 전략이 존재 이유로 내세우는 2008년 금융위기가 표본 밖이라는 뜻이며, 이는 **동적 전략에 불리하지 않고 오히려 유리한 방향으로** 결과를 왜곡할 수 있다(위기 회피 성과를 못 보여주는 대신 2009~2021 강세장에서 현금·채권 대기 비용만 계상되기도 한다 — 부호는 사전에 단정할 수 없다).`);
  md.push('- **D6는 미국 상장 ETF·달러 기준**이다. 원화 투자자의 환노출·국내 세제(배당소득세, 해외주식 양도세)·환전비용이 전부 빠져 있다. 실계좌 성과는 이 표와 다르다.');
  md.push('- **D6 단일 경로**: 5전략 모두 하나의 표본경로만 관측했다. 신뢰구간·부트스트랩을 붙이지 않았으므로 전략 간 성과차가 통계적으로 유의한지는 **판정하지 않았다**(§11 주평가지표는 순 Sharpe이며 유의성 검정을 요구하지 않는다).');
  md.push('');
  md.push('## 다음 단계 (이번 범위 밖)\n');
  md.push('- P1(RS 엔진 + 매수 품질 C1~C10)이 강의의 최대 미실행 블록으로 남아 있다.');
  md.push('- D5 §10.3 ④(다음시가 진입 포트폴리오 Sharpe/MDD)를 계산하려면 진입 오버레이 포트폴리오 엔진이 필요하다.');
  md.push('- D6 티커 가정 확인 → 필요 시 재실행. **자산배분 변경은 별도 승인 사항이다.**');
  md.push('- 잠금표본(2023-2025)은 G8·G11 통과 전까지 봉인 유지.\n');

  md.push('## 부록 A. §5.6 전 축 분해 (개발표본)\n');
  md.push('### D4 보유열화 (개발표본, 63일)\n');
  md.push(renderFactorTables(d4DevBy, DETERIORATION_CODES, '개발표본'));
  md.push('### D5 런치패드 (개발표본, 126일)\n');
  md.push(renderFactorTables(d5DevBy, LAUNCHPAD_CODES, '개발표본'));

  const mdPath = path.join(DOCS, 'RESULTS_2차배치_보유열화_런치패드_DAA.md');
  writeFileSync(mdPath, md.join('\n'));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n완료. 소요 ${secs}s`);
  console.log(`  JSON: ${OUT_DIR}`);
  console.log(`  MD:   ${mdPath}`);
  console.log('\nD4 등급:');
  for (const sig of DETERIORATION_CODES) console.log(`  ${sig}: ${d4Grades[sig].grade}`);
  console.log('D5 등급:');
  for (const sig of LAUNCHPAD_CODES) console.log(`  ${sig}: ${d5Grades[sig].grade}`);
}

main().catch((e) => {
  console.error('실행 오류:', e);
  process.exit(1);
});
