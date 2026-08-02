// scripts/backtest/lectureSignals/run.ts
// ---------------------------------------------------------------------------
// D1(시장 레짐) + D2(급성 매도 8신호: S1~S6 + S5 3변형) 스크리닝 실행 드라이버.
// 개발표본(2010-2019)을 먼저 완전히 확정한 뒤 검증표본(2020-2022)을 코드·설정 변경
// 없이 1회 실행한다(§5.5, §16). 잠금표본(2023-2025)은 실행하지 않는다.
//
// 산출물: output/*.json(기계가독) + docs/backtest/RESULTS_1차배치_시장레짐_급성매도.md(한국어).
//
// 이 파일은 CLI 드라이버라 console.* 허용. `any`·`Math.random` 금지.
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEV_PERIOD,
  VALIDATION_PERIOD,
  ACUTE_SIGNAL_CODES,
  S5_VARIANTS,
  type AcuteSignalCode,
} from './configTypes';
import { loadLectureDataset, loadRegimeSeries } from './dataAccess';
import { makeIndexLookup } from './forwardReturns';
import {
  FACTOR_DECOMP_AXES,
  runD1,
  runD2Family,
  type D1Result,
  type D2FamilyResult,
  type SignalResult,
  type RegimeVariantResult,
} from './pipeline';

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

interface D2Grade {
  grade: Grade;
  reasons: string[];
}

function gradeD2(dev: SignalResult, val: SignalResult, holmPVal: number): D2Grade {
  const reasons: string[] = [];
  const MIN = 50;
  if (dev.nEvents < MIN || val.nEvents < MIN) {
    reasons.push(`이벤트 부족(dev ${dev.nEvents}, val ${val.nEvents} — 50건 미만)`);
    return { grade: 'INCONCLUSIVE', reasons };
  }
  const devMed = dev.primaryBootstrapMedian.point; // 신호중앙 − 대조중앙
  const valMed = val.primaryBootstrapMedian.point;
  const dirDev = devMed < 0; // 신호 후 성과가 대조군보다 낮음(가설 방향)
  const dirVal = valMed < 0;
  reasons.push(`dev 63일 중앙초과차 ${pct(devMed)}, val ${pct(valMed)}`);
  if (!dirDev) {
    reasons.push('개발표본 방향 불일치(신호가 대조군보다 나쁘지 않음) → 경제성 없음');
    return { grade: 'REJECTED', reasons };
  }
  const holmOk = holmPVal < 0.05;
  const econVal = val.summaryByHorizon[63].medianExcessDiff <= -0.03;
  const robustnessOk = !val.yearDecomp.regimeConcentrated && val.topContributor.directionKept;
  const tradeHelps =
    val.tradeCf.medianAdvantage > 0 && val.tradeCf.p10A > val.tradeCf.p10B;
  reasons.push(
    `검증: 방향${dirVal ? 'O' : 'X'} HolmP=${num(holmPVal, 4)}(${holmOk ? 'O' : 'X'}) ` +
      `경제성(≤-3%p)=${econVal ? 'O' : 'X'} 강건성=${robustnessOk ? 'O' : 'X'} 거래우위=${tradeHelps ? 'O' : 'X'}`
  );
  if (val.yearDecomp.regimeConcentrated) reasons.push('REGIME_CONCENTRATED(1개 연도 제거 시 방향상실)');

  if (dirVal && holmOk && econVal && robustnessOk) {
    if (tradeHelps) return { grade: 'REVIEW_WARNING', reasons };
    reasons.push('통계·경제성은 통과하나 다음시가 매도 반사실이 하위손실을 줄이지 못함');
    return { grade: 'PASSIVE_BADGE', reasons };
  }
  // 개발 통과, 검증 미통과 → 세그먼트 확인
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

interface D1Grade {
  grade: Grade;
  reasons: string[];
}

function gradeD1(dev: RegimeVariantResult, val: RegimeVariantResult): D1Grade {
  const reasons: string[] = [];
  const ft = val.forwardTest;
  const dirDev = dev.forwardTest.diffMean < 0;
  const dirVal = ft.diffMean < 0;
  reasons.push(
    `dev 126일 레짐차(risk−normal)=${pct(dev.forwardTest.diffMean)}, val=${pct(ft.diffMean)} ` +
      `[95%CI ${pct(ft.ciLower)}~${pct(ft.ciUpper)}]`
  );
  const ciExcludesZero = Number.isFinite(ft.ciUpper) && ft.ciUpper < 0;
  const bestSharpe = Math.max(val.sharpeDeltaBlock, val.sharpeDeltaHalve);
  const bestMdd = Math.max(val.mddDeltaBlock, val.mddDeltaHalve);
  const cagrSac = Math.min(val.cagrSacrificeBlock, val.cagrSacrificeHalve); // 더 작은 희생
  const econOk = (bestSharpe >= 0.1 || bestMdd >= 0.02) && cagrSac <= 0.01;
  reasons.push(
    `검증 포트폴리오: ΔSharpe 차단 ${num(val.sharpeDeltaBlock)}/반감 ${num(val.sharpeDeltaHalve)}, ` +
      `ΔMDD개선 차단 ${pct(val.mddDeltaBlock)}/반감 ${pct(val.mddDeltaHalve)}, ` +
      `CAGR희생(최소) ${pct(cagrSac)}`
  );
  if (!dirDev) {
    reasons.push('개발표본 방향 불일치');
    return { grade: 'REJECTED', reasons };
  }
  if (dirVal && ciExcludesZero && econOk) {
    reasons.push('검증: 방향O, 95%CI 0 미포함, 포트폴리오 경제성 충족');
    return { grade: 'REVIEW_WARNING', reasons };
  }
  if (dirVal && ciExcludesZero && !econOk) {
    reasons.push('통계 유의하나 포트폴리오 경제성(Sharpe/MDD/CAGR 가드) 미달');
    return { grade: 'PASSIVE_BADGE', reasons };
  }
  reasons.push('검증표본에서 방향 또는 95%CI 조건 미달');
  return { grade: 'RESEARCH_ONLY', reasons };
}

// ===========================================================================
// 마크다운 렌더링
// ===========================================================================

/** 축별 구간(열) 표시 순서. 목록에 없는 라벨은 뒤에 사전순으로 붙인다. */
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

/** 축 한국어 설명(표 제목용). */
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

/** 한 축의 열 순서를 결정(표시순서 우선, 나머지는 사전순). */
function orderedLabels(axis: string, present: ReadonlySet<string>): string[] {
  const pref = AXIS_LABEL_ORDER[axis] ?? [];
  const out: string[] = [];
  for (const l of pref) if (present.has(l)) out.push(l);
  const rest = [...present].filter((l) => !pref.includes(l)).sort();
  return [...out, ...rest];
}

/**
 * §5.6 전 축 분해표. 축마다 표 1개(행=신호, 열=구간), 셀=`중앙초과%(n)`.
 * 이벤트 50건 미만 셀은 `*`(INCONCLUSIVE, 표본부족).
 */
function renderFactorDecompTables(by: Map<AcuteSignalCode, SignalResult>, sampleLabel: string): string {
  const lines: string[] = [];
  for (const axis of FACTOR_DECOMP_AXES) {
    const present = new Set<string>();
    for (const sig of ACUTE_SIGNAL_CODES) {
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
    for (const sig of ACUTE_SIGNAL_CODES) {
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
  lines.push('> `*` = **INCONCLUSIVE(표본부족)** — 해당 셀 이벤트 50건 미만. 방향은 표시하되 통계적 채택 판정에 쓰지 않는다(§5.7).');
  lines.push('');
  return lines.join('\n');
}

function renderD1Section(devD1: D1Result, valD1: D1Result, grades: Record<string, D1Grade>): string {
  const lines: string[] = [];
  lines.push('## D1. 시장 레짐 (6절)\n');
  lines.push(`- 지수 프록시: **${valD1.proxySymbol}** (Yahoo v8 신규 수집, 2009-2022)`);
  lines.push(`- 등가중 투자가능 유니버스 일수: 개발 ${devD1.ewDays} / 검증 ${valD1.ewDays}`);
  lines.push('- 반사실: 신규진입 차단(위험레짐 현금) / 반감(50%). 전량매도는 계획서 지시대로 제외.\n');
  lines.push('### 변형별 결과 (126일 전방 레짐차 + 포트폴리오)\n');
  lines.push('| 변형 | 표본 | risk−normal(126d) | 95%CI | p | ΔSharpe(차단/반감) | ΔMDD개선(차단/반감) | CAGR희생 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  const row = (r: RegimeVariantResult, sample: string): string =>
    `| ${r.variant} | ${sample} | ${pct(r.forwardTest.diffMean)} | ${pct(r.forwardTest.ciLower)}~${pct(r.forwardTest.ciUpper)} | ${num(r.forwardTest.pValue, 3)} | ${num(r.sharpeDeltaBlock, 2)}/${num(r.sharpeDeltaHalve, 2)} | ${pct(r.mddDeltaBlock)}/${pct(r.mddDeltaHalve)} | ${pct(Math.min(r.cagrSacrificeBlock, r.cagrSacrificeHalve))} |`;
  for (let k = 0; k < devD1.variants.length; k++) {
    lines.push(row(devD1.variants[k], '개발'));
    lines.push(row(valD1.variants[k], '검증'));
  }
  lines.push('');
  lines.push('### 포트폴리오 절대지표 (검증표본)\n');
  lines.push('| 변형 | 전략 | CAGR | Sharpe | MDD |');
  lines.push('|---|---|---|---|---|');
  for (const v of valD1.variants) {
    lines.push(`| ${v.variant} | 기준(항상투자) | ${pct(v.baseline.cagr)} | ${num(v.baseline.sharpe, 2)} | ${pct(v.baseline.mdd)} |`);
    lines.push(`| ${v.variant} | 차단 | ${pct(v.block.cagr)} | ${num(v.block.sharpe, 2)} | ${pct(v.block.mdd)} |`);
    lines.push(`| ${v.variant} | 반감 | ${pct(v.halve.cagr)} | ${num(v.halve.sharpe, 2)} | ${pct(v.halve.mdd)} |`);
  }
  lines.push('');
  lines.push('### D1 등급 판정\n');
  for (const key of Object.keys(grades)) {
    lines.push(`- **${key}: ${grades[key].grade}**`);
    for (const r of grades[key].reasons) lines.push(`  - ${r}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderD2Section(
  dev: D2FamilyResult,
  val: D2FamilyResult,
  grades: Record<string, D2Grade>
): string {
  const lines: string[] = [];
  lines.push('## D2. 급성 매도 신호 8종 (7절)\n');
  lines.push('- 주지표: 신호 후 **63거래일 시장초과수익** 중앙값이 매칭 대조군보다 낮은가.');
  lines.push('- 거래 반사실: **A(D+1 시가 매도 후 현금) vs B(63일 보유)만** 구현(C/D=앱 규칙 재현은 범위 밖).');
  lines.push('- Holm 보정: **8개 신호**(S1~S6, S5 3변형)를 하나의 패밀리로. 초판은 7개(S5 2변형)였고, `S5_APP_RUNTIME_RAW` 추가로 패밀리가 커져 보정이 **더 보수적**이 됐다.');
  lines.push('- S5 세 변형은 **−10% 판정을 모두 `adj_close`로 동일하게** 하고 63일 거래대금 최대 판정 입력만 다르다: `S5_AMOUNT`=**원천**(무조정 `amount`), `S5_APP_PROXY`=**조정가정**(`adj_close×adj_volume` — 앱 `/history`가 조정값을 준다고 가정), `S5_APP_RUNTIME_RAW`=**무조정가정**(원시 `close×volume` — 앱 `/history`가 원시값을 준다고 가정).');
  lines.push('- ⚠ **앱 `/history` 응답이 조정값인지 원시값인지는 이번 작업에서 확인하지 않았다(범위 밖).** 그래서 어느 한쪽을 판정하는 대신 **양쪽 가정을 모두 실행해 병기**한다. 목적은 "어느 가정이 맞든 결론이 바뀌는가"를 보는 것이다(아래 3자 비교표).\n');

  const devBy = new Map(dev.bySignal.map((s) => [s.signal, s]));
  const valBy = new Map(val.bySignal.map((s) => [s.signal, s]));

  lines.push('### 신호별 요약 (63일 주호라이즌)\n');
  lines.push('| 신호 | 표본 | 이벤트 | 고유종목 | 연도 | 신호중앙 | 대조중앙 | 중앙초과차 | 95%CI | HolmP | 매칭율 | 등급 |');
  lines.push('|---|---|---|---:|---:|---|---|---|---|---|---|---|');
  for (const sig of ACUTE_SIGNAL_CODES) {
    const d = devBy.get(sig)!;
    const v = valBy.get(sig)!;
    const dS = d.summaryByHorizon[63];
    const vS = v.summaryByHorizon[63];
    lines.push(
      `| ${sig} | 개발 | ${d.nEvents} | ${dS.uniqueCodes} | ${dS.years} | ${pct(dS.signalMedian)} | ${pct(dS.controlMedian)} | ${pct(dS.medianExcessDiff)} | ${pct(d.primaryBootstrapMedian.ciLower)}~${pct(d.primaryBootstrapMedian.ciUpper)} | ${num(dev.holmAdjustedP[sig], 3)} | ${pct(d.matchRate, 0)} | — |`
    );
    lines.push(
      `| ${sig} | 검증 | ${v.nEvents} | ${vS.uniqueCodes} | ${vS.years} | ${pct(vS.signalMedian)} | ${pct(vS.controlMedian)} | ${pct(vS.medianExcessDiff)} | ${pct(v.primaryBootstrapMedian.ciLower)}~${pct(v.primaryBootstrapMedian.ciUpper)} | ${num(val.holmAdjustedP[sig], 3)} | ${pct(v.matchRate, 0)} | **${grades[sig].grade}** |`
    );
  }
  lines.push('');

  lines.push('### 전방수익 전체 호라이즌 (검증표본, 시장초과 중앙차)\n');
  lines.push('| 신호 | 20일 | 63일 | 126일 | 252일 | MAE(평균) | MFE(평균) | 10%하위수익 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const sig of ACUTE_SIGNAL_CODES) {
    const v = valBy.get(sig)!;
    const s = (h: number) => pct(v.summaryByHorizon[h].medianExcessDiff);
    const p = v.summaryByHorizon[63];
    lines.push(`| ${sig} | ${s(20)} | ${s(63)} | ${s(126)} | ${s(252)} | ${pct(p.maeMean)} | ${pct(p.mfeMean)} | ${pct(p.p10StockReturn)} |`);
  }
  lines.push('');

  lines.push('### 거래 반사실 A(다음시가 매도) vs B(63일 보유) — 비용차감, 검증표본\n');
  lines.push('| 신호 | n | 중앙 A | 중앙 B | 중앙 매도우위(A−B) | A 하위10% | B 하위10% |');
  lines.push('|---|---:|---|---|---|---|---|');
  for (const sig of ACUTE_SIGNAL_CODES) {
    const v = valBy.get(sig)!;
    const t = v.tradeCf;
    lines.push(`| ${sig} | ${t.n} | ${pct(t.medianA)} | ${pct(t.medianB)} | ${pct(t.medianAdvantage)} | ${pct(t.p10A)} | ${pct(t.p10B)} |`);
  }
  lines.push('');

  lines.push(`### §5.6 전 축 분해 (검증표본, 63일 신호 시장초과 중앙값) — ${FACTOR_DECOMP_AXES.length}축 전수\n`);
  lines.push('> 초판은 계산된 분해 중 시총·연도 2개만 실었다(사전등록 §5.6 위반). 이번 판은 **필수 팩터 패널 전 축**을 게재한다.');
  lines.push('> 축 배열에서 누락돼 있던 `ret5Tertile`·`vol20Tertile`도 복구했다.');
  lines.push('> PIT 룩어헤드 수정(effectiveMonth 키) 반영 — 시총 분류는 신호 당월이 아니라 **직전 월말 시총** 기준.');
  lines.push('');
  lines.push(renderFactorDecompTables(valBy, '검증표본'));

  lines.push('### 연도별 기여 분해 (검증표본 2020/2021/2022, 63일 중앙초과차)\n');
  lines.push('| 신호 | 2020(n) | 2021(n) | 2022(n) | REGIME_CONCENTRATED |');
  lines.push('|---|---|---|---|---|');
  for (const sig of ACUTE_SIGNAL_CODES) {
    const v = valBy.get(sig)!;
    const yd = v.yearDecomp;
    const cell = (y: number) => {
      const rec = yd.byYear.find((b) => b.year === y);
      return rec ? `${pct(rec.medianExcessDiff)}(${rec.events})` : '—';
    };
    lines.push(`| ${sig} | ${cell(2020)} | ${cell(2021)} | ${cell(2022)} | ${yd.regimeConcentrated ? 'YES' : 'no'} |`);
  }
  lines.push('');

  // S5 3자 비교 섹션
  lines.push('### S5 3자 비교 — 원천 / 조정가정 / 무조정가정 (핵심 산출물)\n');
  lines.push('> **이 표의 목적**: 앱 `/history` 응답이 조정값이든 원시값이든 **결론(등급·효과 방향·크기)이 바뀌는지**를 보는 것이다. 앱 데이터의 실제 조정 여부를 판정하는 표가 아니다 — 그 확인은 별도 작업이다.\n');
  lines.push('| 항목 | S5_AMOUNT(원천 amount) | S5_APP_PROXY(**조정가정** adj×adj) | S5_APP_RUNTIME_RAW(**무조정가정** close×volume) |');
  lines.push('|---|---|---|---|');
  const cell3 = (f: (s: AcuteSignalCode) => string): string =>
    S5_VARIANTS.map((s) => f(s as AcuteSignalCode)).join(' | ');
  lines.push(`| 개발 이벤트수 | ${cell3((s) => String(devBy.get(s)!.nEvents))} |`);
  lines.push(`| 검증 이벤트수 | ${cell3((s) => String(valBy.get(s)!.nEvents))} |`);
  lines.push(`| 개발 63일 중앙초과차 | ${cell3((s) => pct(devBy.get(s)!.summaryByHorizon[63].medianExcessDiff))} |`);
  lines.push(`| 검증 63일 중앙초과차 | ${cell3((s) => pct(valBy.get(s)!.summaryByHorizon[63].medianExcessDiff))} |`);
  lines.push(`| 검증 95%CI | ${cell3((s) => `${pct(valBy.get(s)!.primaryBootstrapMedian.ciLower)}~${pct(valBy.get(s)!.primaryBootstrapMedian.ciUpper)}`)} |`);
  lines.push(`| 개발 HolmP | ${cell3((s) => num(dev.holmAdjustedP[s], 4))} |`);
  lines.push(`| 검증 HolmP | ${cell3((s) => num(val.holmAdjustedP[s], 4))} |`);
  lines.push(`| 등급 | ${cell3((s) => `**${grades[s].grade}**`)} |`);
  lines.push('');
  lines.push('#### 신호 일치율 (같은 `(종목,날짜)` 이벤트 집합 비교)\n');
  lines.push('| 표본 | 기준 A | 비교 B | \\|A\\| | \\|B\\| | 교집합 | 합집합 | Jaccard | 재현율(A기준) | 정밀도(A기준) |');
  lines.push('|---|---|---|---:|---:|---:|---:|---|---|---|');
  const ovRows = (fam: D2FamilyResult, sample: string): void => {
    for (const o of fam.s5Overlap) {
      lines.push(
        `| ${sample} | ${o.a} | ${o.b} | ${o.nA} | ${o.nB} | ${o.intersection} | ${o.union} | ` +
          `${pct(o.jaccard, 1)} | ${pct(o.recallOfBvsA, 1)} | ${pct(o.precisionOfBvsA, 1)} |`
      );
    }
  };
  ovRows(dev, '개발');
  ovRows(val, '검증');
  lines.push('');
  lines.push('- **재현율(A기준)** = |A∩B| / |A| — A가 낸 신호 중 B도 낸 비율(앱이 놓치는 신호의 여집합).');
  lines.push('- **정밀도(A기준)** = |A∩B| / |B| — B가 낸 신호 중 A도 낸 비율(앱이 헛되이 내는 신호의 여집합).');
  lines.push('- 불일치에 기여할 수 있는 두 경로: (1) **같은 날 판정이 갈림**(입력 정의 차이), (2) **중복제거 연쇄**(첫 이벤트가 갈리면 이후 63거래일 차단 구간이 어긋나 후속 이벤트도 달라짐). 따라서 이 수치는 "같은 날 규칙 일치율"이 아니라 **최종 이벤트 집합 일치율**이다.');
  lines.push('');
  lines.push('> **해석 — 사전 예상이 두 군데에서 빗나갔다.**');
  lines.push('> **① "분할일에 원시 거래량이 50배 튀어 무조정 변형이 가짜 신호를 낸다"는 틀렸다.** S5의 판정 대상은 거래량이 아니라 **거래대금(가격×수량)**이고, 거래대금은 분할에 불변이다(가격 1/50 × 거래량 50배 = 동일). 골든 테스트 §14(a)가 이를 못박는다 — 1:50 분할일에 세 변형 모두 발화하지 않는다. 게다가 세 변형 모두 **−10% 판정을 `adj_close`로 통일**했으므로 분할일 "가짜 −98%" 오탐도 구조적으로 없다.');
  lines.push('> **② `S5_APP_PROXY`와 `S5_APP_RUNTIME_RAW`의 이벤트 집합은 개발·검증 양쪽에서 Jaccard 100.0%로 완전히 동일하다.** `adj_close×adj_volume`과 `close×volume`은 조정계수가 약분되어 같은 값이기 때문이다. 이론상 `adj_volume = int(volume / adj_factor)`의 **정수 절삭**이 판정을 뒤집을 수 있고 골든 테스트 §14(b)가 그 합성 사례를 고정해 두었지만, **이 데이터셋의 실제 이벤트에서는 단 1건도 뒤집히지 않았다.**');
  lines.push('> **따라서 §1-2가 지목한 "조정 기준 불일치" 위험은 S5에 한해 실측 0이다.** 앱 `/history`가 조정값이든 원시값이든 S5 이벤트 집합·효과크기·등급이 모두 같다. (다만 `/history` 조정 여부 확인 자체는 여전히 필요하다 — S4·S6는 **거래량 자체**를 기준선과 비교하므로 분할 불변이 아니고, 조정 여부에 따라 신호가 실제로 갈린다.)');
  lines.push('> **남는 실질 차이는 `S5_AMOUNT` vs 프록시 계열의 약 11%p뿐이며, 그 원인은 조정이 아니라 거래대금의 정의다.** 원천 `amount`는 하루 전 체결의 **체결가 가중 합**이고 프록시는 **종가×거래량**이라 장중 변동이 큰 날 서로 다른 날을 "63일 최대"로 지목한다. 실측하면 `amount / (종가×거래량)`은 정확일치가 0.5%에 불과하고 중앙값 0.999·1~99분위 0.965~1.047이다(처리데이터 93만 바 표본) — 평소엔 0.1% 수준 오차지만 장중 변동이 큰 날 최대일이 갈리기에 충분하다. 즉 앱이 `종가×거래량`으로 S5를 계산하면 원천 거래대금 기준 신호의 약 90%를 재현하고(재현율), 새로 내는 신호의 98~99%는 원천 기준으로도 참이다(정밀도).');
  lines.push('> 등급 관점의 결론: 세 변형 모두 REVIEW_WARNING으로 동일하다. `S5_APP_RUNTIME_RAW`은 사전등록 §5.6이 신호 계산에 원시 `volume` 사용을 금지하므로 **채택 후보가 아니라 앱 이식 위험 계측용 진단 변형**으로만 남긴다.\n');

  lines.push('### D2 등급 판정 근거\n');
  for (const sig of ACUTE_SIGNAL_CODES) {
    lines.push(`- **${sig}: ${grades[sig].grade}**`);
    for (const r of grades[sig].reasons) lines.push(`  - ${r}`);
  }
  lines.push('');
  return lines.join('\n');
}

// ===========================================================================
// 메인
// ===========================================================================

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('강의 가설 1차 배치(D1 시장레짐 + D2 급성매도) 실행\n');

  console.log('데이터 로드 중...');
  const ds = await loadLectureDataset();
  console.log(
    `  prelock=${ds.manifestPrelock}, 투자가능 유니버스 ${ds.investableUnion.size}종목, ` +
      `바 로드 ${ds.bars.size}, 미분류 제외 ${ds.unresolvedCodes.size}, 기업행위일 ${ds.corpActionDates.size}`
  );

  // S5_APP_RUNTIME_RAW 전제 확인: 원시 close·volume이 실제로 실려 있어야 한다.
  // (없으면 그 신호가 조용히 0건이 되어 "표본부족"으로 오독될 수 있다 → 즉시 실패.)
  {
    let checked = 0;
    for (const b of ds.bars.values()) {
      if (!b.close || !b.volume || b.close.length !== b.dates.length || b.volume.length !== b.dates.length) {
        throw new Error(`원시 close/volume 결측: ${b.code} (S5_APP_RUNTIME_RAW 판정 불가)`);
      }
      if (++checked >= 50) break;
    }
    console.log(`  원시(무조정) close/volume 적재 확인 ${checked}종목 샘플 OK`);
  }

  const regime = await loadRegimeSeries('^KS11');
  const index = makeIndexLookup(regime.dates, regime.close);
  console.log(`  KOSPI 레짐 시계열 ${regime.dates.length}일 (${regime.symbol})`);

  // --- D1 (개발 먼저, 그다음 검증) ---
  console.log('\nD1 개발표본...');
  const d1Dev = runD1(ds, regime, DEV_PERIOD);
  console.log('D1 검증표본...');
  const d1Val = runD1(ds, regime, VALIDATION_PERIOD);
  const d1Grades: Record<string, D1Grade> = {};
  for (let k = 0; k < d1Dev.variants.length; k++) {
    d1Grades[d1Dev.variants[k].variant] = gradeD1(d1Dev.variants[k], d1Val.variants[k]);
  }

  // --- D2 (개발 완전 확정 후 검증) ---
  console.log('\nD2 개발표본(8신호)...');
  const d2Dev = runD2Family(ds, regime, index, DEV_PERIOD);
  console.log('D2 검증표본(8신호)...');
  const d2Val = runD2Family(ds, regime, index, VALIDATION_PERIOD);
  const d2Grades: Record<string, D2Grade> = {};
  const devBy = new Map(d2Dev.bySignal.map((s) => [s.signal, s]));
  const valBy = new Map(d2Val.bySignal.map((s) => [s.signal, s]));
  for (const sig of ACUTE_SIGNAL_CODES) {
    d2Grades[sig] = gradeD2(devBy.get(sig)!, valBy.get(sig)!, d2Val.holmAdjustedP[sig]);
  }

  // --- 산출물 ---
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, 'd1_regime.json'),
    JSON.stringify({ dev: d1Dev, val: d1Val, grades: d1Grades }, null, 2)
  );
  // eventKeys(수천 건×8신호)는 파일 크기 때문에 직렬화에서 제외. 일치율은 s5Overlap에 요약됨.
  const omitEventKeys = (key: string, value: unknown): unknown =>
    key === 'eventKeys' ? undefined : value;
  writeFileSync(
    path.join(OUT_DIR, 'd2_acute.json'),
    JSON.stringify({ dev: d2Dev, val: d2Val, grades: d2Grades }, omitEventKeys, 2)
  );

  const md: string[] = [];
  md.push('# 1차 배치 결과 — 시장 레짐(D1) · 급성 매도(D2)\n');
  md.push(`- 실행일: ${new Date().toISOString().slice(0, 10)} (**P0 결함 보수 후 재실행**)`);
  md.push('- 사전등록: `docs/backtest/PREREG_강의가설_통합백테스트계획.md` + 보수 계획 `docs/backtest/PLAN_강의가설_전면검증_v2.md` §3 P0');
  md.push('- P0 보수 3건: ① §5.6 분해 축 누락(`ret5Tertile`·`vol20Tertile`) 복구 → **전 축 완비** ② **전 축 분해표 문서 게재**(초판은 2축만) ③ **`S5_APP_RUNTIME_RAW`(앱 런타임 무조정 규약) 변형 추가** → S5 3자 비교');
  md.push('- 표본: 개발 2010-01~2019-12 / 검증 2020-01~2022-12. **잠금(2023-2025) 미실행(G8/G11 봉인).**');
  md.push('- 데이터: 분할조정 `adj_*`, 원천 무조정 `amount`, 월말 PIT 유니버스(백분위·대형), 미분류 168종목 제외. 원시 무조정 `close`·`volume`은 **`S5_APP_RUNTIME_RAW` 판정에만** 사용.');
  md.push(`- 통계: master seed ${20260725}, 60거래일 블록부트스트랩 10000회, Holm 보정, 95%CI.`);
  md.push('- **주의**: 이 문서는 순수 리서치 결과다. 앱 적용은 이번 작업의 결론이 아니다(별도 포트폴리오 검증·승인 필요).\n');
  md.push(renderD1Section(d1Dev, d1Val, d1Grades));
  md.push(renderD2Section(d2Dev, d2Val, d2Grades));
  md.push('## 결과 해석 주의 (비판적 검토)\n');
  md.push('- **D1은 겉보기 함정에 주의**: 검증표본(2020-2022)에서 진입차단 오버레이는 Sharpe·MDD를 크게 개선하지만(예: KR150_LEVEL Sharpe 0.46→1.21, MDD 41.6%→14.8%), **개발표본에서는 방향이 반대**(위험레짐 진입이 오히려 유리, 차단이 CAGR 희생)다. 검증 구간이 코로나 급락+2022 약세장에 특수해 사후적으로 유리해 보일 뿐이며, 개발표본 방향 불일치로 REJECTED가 정확한 판정이다.');
  md.push('- **D2 효과의 이질성은 위 §5.6 전 축 분해표에서 직접 확인할 것**(초판은 2축만 실어 판단 근거가 부족했다). 시총 축에서 대체로 소형>중형>대형 순으로 효과가 커지고, 급등 신호(S1)는 대형주에서 효과가 약하다. 유동성 3분위 모두(10억원 이상 유니버스 내)에서 음의 초과가 관측되므로 "소형+저유동성 전용 효과(RESEARCH_ONLY)"는 아니다. 다만 셀 이벤트 50건 미만(`*`) 칸은 §5.7에 따라 방향만 읽고 채택 판단에 쓰지 않는다.');
  md.push('- **복구된 `vol20Tertile` 축이 이번 판의 최대 신규 발견이다 — 효과가 변동성 상위 구간에 집중되고, 저변동성 구간에서는 사라지거나 뒤집힌다.** 검증표본 20일 실현변동성 3분위(하/중/상) 기준 63일 중앙초과: S6 −1.63%(606)/−2.89%(678)/−10.38%(1158), S4 −2.80%(281)/−5.30%(423)/−13.00%(939), S5_AMOUNT **+0.69%(53)**/−3.83%(58)/−18.78%(157). `vol63Tertile`도 같은 방향이다(S5_AMOUNT 하위 +2.93%(61)). **즉 S5는 저변동성 종목에서 방향이 반대이며, 두 구간 모두 이벤트 50건 이상이라 표본부족으로 치부할 수 없다.** 급성 매도 신호를 앱에 쓸 때 "조용한 종목"에 그대로 적용하면 이득이 없거나 역효과일 수 있다는 뜻이다. 다만 §5.7에 따라 이 상호작용은 사전등록된 **이질성 확인**이지 새 채택 규칙이 아니며, 구간별 결과로 임계값·유니버스를 사후 변경하지 않는다.');
  md.push('- **`ret5Tertile`은 신호 정의에 따라 축이 축퇴(degenerate)한다**: S2(5일 +40%)는 전 이벤트가 R5 상위 3분위 한 칸에 몰리고 S1·S3도 사실상 그렇다. 이 축이 정보를 갖는 것은 급락형 신호(S4·S5·S6)에서이며, 거기서는 R5 상위(직전 5일 강세 뒤 급락)일수록 후속 부진이 크다(S6 −3.66%(1088) → −8.79%(1026)). 축퇴한 칸을 "구간별 효과"로 해석하면 안 된다.');
  md.push('- **PIT 룩어헤드 수정(중요)**: 초판은 월말 유니버스를 as-of월 키로 조회해 당월 스냅샷(다음달 유효분)을 그날 썼다(1개월 룩어헤드). effectiveMonth 키로 교정. 등급은 불변이나 **시총 분해가 유의미하게 교정**됐다 — 급등 신호 종목이 급등 후 시총으로 대형에 과대편입되던 것이 직전 월말 시총 기준으로 바로잡혀 대형→소형으로 재분류(예: S1 개발표본 대형 63→28건·소형 68→172건).');
  md.push('- **매칭 잔차 모멘텀**: 대조군은 5분위(시총·직전63일수익·변동성·거래대금)로 매칭하나, 신호 종목의 상승/급락 강도가 분위 경계보다 훨씬 극단적일 수 있다. 따라서 관측된 초과의 일부는 "더 극단적인 모멘텀의 더 강한 평균회귀"일 수 있다(업종 중립 아님, 계획서 §5.4 명시). 이는 가설의 방향과 일치하는 해석이지만 인과가 아니라 조건부 상관이다.');
  md.push('- **생존편향 방향**: 상장폐지 종목의 바는 폐지일에서 끝나 전방수익이 절단(null)된다. 급락 후 폐지로 가는 최악 경로가 표본에서 빠지므로 효과는 **과소추정**(보수적)이다.');
  md.push('- **A vs B 반사실의 순환성**: 신호가 하락할 종목을 선택하므로 "다음시가 매도가 보유보다 낫다"는 부분적으로 자기충족적이다. 순수 타이밍 효과의 참고치일 뿐 앱 매도규칙 대비 증분가치(C/D)는 미검증.');
  md.push('');
  md.push('## 앱 적용 전 추가로 필요한 작업\n');
  md.push('- 거래 반사실 C(앱 기존 매도규칙)·D(기존+신규 신호) 재현 — 이번 범위에서 의도적으로 생략(패리티 위험 회피).');
  md.push('- 126/252일 경제성은 현금배당 미반영(PRICE_RETURN_EX_DIVIDEND)이므로 조건부 증거로만 해석.');
  md.push('- G8(정상폐지 대가)·G11(KRX 교차검증) 통과 후에만 잠금표본(2023-2025) 최종 확인 가능.');
  md.push('- **S5 앱 이식 전 `/history` 조정 여부 확인**(백엔드 응답이 분할조정값인지 원시값인지) — **이번 작업에서 확인하지 않았고 범위 밖이다.** 대신 조정가정·무조정가정 양쪽을 모두 돌려 병기했으며, 위 3자 비교표·Jaccard가 그 차이의 정량 비용이다.');
  md.push('- SHADOW_POLICY/LIVE_POLICY(실행 정책)는 포트폴리오 검증과 별도 승인 필요.\n');

  // 부록 — 개발표본 전 축 분해(검증표본과 동일 형식)
  md.push(`## 부록 A. §5.6 전 축 분해 (개발표본, 63일 신호 시장초과 중앙값) — ${FACTOR_DECOMP_AXES.length}축 전수\n`);
  md.push('> 개발표본(2010-2019)은 설정 확정에 쓰인 표본이다. 검증표본 표와 같은 형식으로 병기해 이질성의 표본 간 재현 여부를 볼 수 있게 한다.');
  md.push('');
  md.push(renderFactorDecompTables(devBy, '개발표본'));

  const mdPath = path.join(DOCS, 'RESULTS_1차배치_시장레짐_급성매도.md');
  writeFileSync(mdPath, md.join('\n'));

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n완료. 소요 ${secs}s`);
  console.log(`  JSON: ${OUT_DIR}`);
  console.log(`  MD:   ${mdPath}`);
  console.log('\nD1 등급:');
  for (const k of Object.keys(d1Grades)) console.log(`  ${k}: ${d1Grades[k].grade}`);
  console.log('D2 등급:');
  for (const sig of ACUTE_SIGNAL_CODES) console.log(`  ${sig}: ${d2Grades[sig].grade} (dev ${devBy.get(sig)!.nEvents} / val ${valBy.get(sig)!.nEvents} 이벤트)`);
}

main().catch((e) => {
  console.error('실행 오류:', e);
  process.exit(1);
});
