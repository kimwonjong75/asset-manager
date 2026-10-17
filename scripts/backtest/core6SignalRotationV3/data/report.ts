// scripts/backtest/core6SignalRotationV3/data/report.ts
// 데이터 게이트 결과 타입 + 사람이 읽는 한국어 보고서(DATA_GATE_REPORT.md) 렌더러. 순수 함수.
// 전략 성과는 다루지 않는다.

import type { AssetCode } from '../types';
import { ASSET_CODES } from '../types';
import type { Dg1Result, Dg2Compare, Dg3Result, Dg4Result, GateStatus, ImpossibleBar, ProxyFidelity, ReturnStats } from './gates';
import type { CalendarRule, SpliceInfo, SyntheticMeta } from './panel';
import type { BackendImplied, LedgerEvent } from './amendment';
import type { Dg2Explanation, OhlcConsistency } from './amendment2';

export interface Dg2Row extends Dg2Compare {
  /** new-tr = Yahoo 이벤트 원장 TR 종가(머리 판정 대상) / yahoo-adjclose = Yahoo 원래 adjclose(참고) */
  reference: 'new-tr' | 'yahoo-adjclose';
  /** new-tr 행에만: 알려진 분배 오류 3건으로 어긋남이 설명되는지(구간 단위) */
  explanation?: Dg2Explanation;
}

export interface Dg2Block {
  /** 머리 판정: 기준 통과 또는 '사유 확인 통과'면 PASS. */
  status: GateStatus;
  /** 설명을 적용하기 전 순수 기준(0.1%·99%) 판정 */
  rawStatus: GateStatus;
  /** true = 기준 미달이지만 알려진 오류로 전부 설명되어 통과 처리(사유 확인 통과) */
  explainedPass: boolean;
  note: string;
  rows: Dg2Row[];
}

export interface Amendment2AssetBlock {
  /** Yahoo 행은 있으나 백엔드 값이 없어 이월한 날(fresh=false) */
  carriedDates: string[];
  /** 백엔드 봉은 있으나 Yahoo 행이 없어 달력에 없는 날 */
  backendOnlyDates: string[];
  impossible: ImpossibleBar[];
  barsInRange: number;
  integerValuedBars: number;
  ohlcConsistency: OhlcConsistency;
  events: LedgerEvent[];
  implied: BackendImplied;
  explanation: Dg2Explanation;
}

export interface Amendment2Block {
  id: 'AMENDMENT_2';
  document: string;
  backendFiles: Array<{ symbol: string; file: string; sha256: string; bytes: number; fetchedAtUtc: string | null }>;
  assets: Record<AssetCode, Amendment2AssetBlock>;
  /** true = 정정 2 §2 의 중단 조건(설명되지 않는 불일치·불가능 OHLC)에 걸렸다. 사람이 판단하기 전에는 이 패널을 쓰지 않는다. */
  halted: boolean;
  haltReasons: string[];
}

export interface DataGateResults {
  schema: 'core6-v3-data-gates-v3';
  preregistration: string;
  calendar: {
    ruleUsed: CalendarRule;
    start: string;
    end: string;
    sessions: number;
    firstDate: string;
    lastDate: string;
    /** 과반 유효 규칙(정정 전 주 규칙)으로 센 거래일 수 — 참고용 */
    majorityRuleSessions: number;
    droppedFromCalendar: Array<{ date: string; weekday: number; status: Record<AssetCode, string> }>;
  };
  panels: {
    P: { sessions: number; sha256: string; syntheticSessions: number; syntheticFreshSessions: number; syntheticNonFreshSessions: number };
    P5: { sessions: number; sha256: string };
    PA: { start: string; end: string; sessions: number };
    sameDatesPandP5: boolean;
    shapeProblems: string[];
  };
  synthetic: SyntheticMeta | null;
  dg1: Dg1Result[];
  dg2: Dg2Block;
  dg3: Dg3Result[];
  dg3Supplementary: Dg3Result[];
  dg4: Dg4Result;
  dg5: { status: GateStatus; note: string };
  proxyFidelity: ProxyFidelity;
  amendment: Amendment2Block;
  /** 참고: Yahoo 원래 계수로 본 DG3(정정 전 방식). 판정에 쓰지 않는다. */
  dg3YahooReference: Dg3Result[];
  summary: {
    dg1: GateStatus;
    dg2: GateStatus;
    /** true = DG2 가 기준 미달이나 알려진 오류로 전부 설명되어 '사유 확인 통과' */
    dg2Explained: boolean;
    dg3: GateStatus;
    dg4: GateStatus;
    dg5: GateStatus;
    section10: GateStatus;
    primaryAnalysis: 'P' | 'P5';
    interpretationDependentItems: string[];
    blockers: string[];
  };
}

const KR_NAMES: Record<string, string> = {
  '069500': 'KODEX 200',
  '379800': 'KODEX 미국S&P500',
  '283580': 'KODEX 차이나CSI300',
  '385560': 'RISE KIS 국고채30년',
  '464470': 'PLUS 미국채30년액티브',
  '411060': 'ACE KRX금현물',
};

const STATUS_KO: Record<GateStatus, string> = {
  PASS: '통과',
  FAIL: '실패',
  REPORT: '보고',
  PARTIAL: '부분(범위 일부만 대조)',
  UNAVAILABLE: '확인 불가',
};

function pct(x: number | null, d = 2): string {
  return x === null ? '-' : `${(x * 100).toFixed(d)}%`;
}
function num(x: number | null, d = 3): string {
  return x === null ? '-' : x.toFixed(d);
}
function st(s: GateStatus): string {
  return STATUS_KO[s];
}

function statsRow(label: string, s: ReturnStats): string {
  return `| ${label} | ${s.observations} | ${num(s.correlation)} | ${num(s.beta)} | ${pct(s.trackingErrorAnnual)} | ${pct(s.directionMatch, 1)} |`;
}

function summaryLines(r: DataGateResults): string[] {
  const am = r.amendment;
  const L: string[] = [];
  L.push('## 요약 (먼저 읽는 곳)');
  L.push('');
  const dg2Word = r.summary.dg2Explained ? '사유 확인 통과' : st(r.summary.dg2);
  L.push(`- **시세 출처**: 6종 TR 조정 OHLC를 앱 백엔드 \`/history\` 값 그대로 썼다(정정 2). 달력은 Yahoo 행이 있는 모든 날 **${r.calendar.sessions}일**(${r.calendar.firstDate} ~ ${r.calendar.lastDate}).`);
  const carriedTotal = ASSET_CODES.reduce((n, c) => n + am.assets[c].carriedDates.length, 0);
  L.push(`- **결과**: DG1 ${st(r.summary.dg1)} / DG2 **${dg2Word}** / DG3 ${st(r.summary.dg3)} / DG4 ${st(r.summary.dg4)} / DG5 ${st(r.summary.dg5)} / §10 ${st(r.summary.section10)} → 주 분석 **${r.summary.primaryAnalysis}**.`);
  L.push(`- **백엔드에 값이 없어 이월한 날**: 6종 합계 ${carriedTotal}건 (6번 항목에 날짜 전체).`);
  const imp = ASSET_CODES.reduce((n, c) => n + am.assets[c].impossible.length, 0);
  L.push(`- **백엔드 불가능 OHLC**: ${imp}건.`);
  if (r.summary.dg2Explained) {
    L.push('- **DG2 설명**: 순수 기준(0.1% 이내 99%)으로는 미달이지만, 어긋남이 알려진 Yahoo 분배 원장 오류(069500 2022-07 누락·2022-10-27 날짜 오류, 464470 2025-03-28 누락)가 만드는 단계형 구간으로 전부 설명된다. 설명 안 되는 날 0일 (3번 항목).');
  } else if (r.summary.dg2 !== 'PASS') {
    L.push('- **DG2 미설명**: 알려진 오류로 설명되지 않는 불일치가 남았다. 중단 — 3번 항목.');
  }
  L.push('- **한계**: 백엔드와 Yahoo는 같은 계열일 수 있어 DG2는 독립 검증이 아니다. DG5(독립 KRX CSV)는 없다.');
  L.push('');
  return L;
}

export function renderGateReport(r: DataGateResults): string {
  const L: string[] = [];
  const am = r.amendment;
  L.push('# 코어 6종 신호 로테이션 V3 — 데이터 게이트 보고서 (정정 2 적용 후)');
  L.push('');
  L.push(...summaryLines(r));
  L.push('> 이 문서는 **데이터가 믿을 만한지**만 점검한다. 전략 성과(수익률·낙폭)는 계산하지 않았다. 기준값은 사전등록(§9·§10)에 고정되어 있고 바꾸지 않았다. 정정 내용: `docs/backtest/PREREG_코어6종_신호로테이션_V3_AMENDMENT_2.md`(정정 1 포함). 정정 1 시점 결과는 `output/pre_amendment2/`에, 정정 전 결과는 `output/pre_amendment/`에 보존했다.');
  L.push('');
  if (am.halted) {
    L.push('> **중단 상태(HALTED)**: 정정 2 §2의 중단 조건에 걸렸다. 아래 사유를 사람이 판단하기 전에는 이 패널을 전략 계산에 쓰지 않는다.');
    for (const x of am.haltReasons) L.push(`> - ${x}`);
    L.push('');
  }
  L.push('## 한눈에 보기');
  L.push('');
  L.push('| 관문 | 결과 | 한 줄 설명 |');
  L.push('|---|---|---|');
  L.push(`| DG1 결측·이상 봉 | ${st(r.summary.dg1)} | 결측 비율 1% 이하(엄격 달력), 말이 안 되는 봉 0건, 중복·역순 0건 |`);
  L.push(`| DG2 앱 백엔드 대조 | ${r.summary.dg2Explained ? '사유 확인 통과' : st(r.summary.dg2)} | 백엔드 조정 종가 vs Yahoo(이벤트 원장 TR) 종가, 0.1% 이내 일치율 99% 이상 — 미달 시 알려진 분배 오류 3건으로 구간 단위 전부 설명되어야 함 |`);
  L.push(`| DG3 조정계수 | ${st(r.summary.dg3)} | (Yahoo 이벤트 원장 계수) 변화점이 분배락일에만 있는지 — 원장에서 만들었으므로 구성상 성립, 독립 확인은 5번 항목 |`);
  L.push(`| DG4 결측 처리 | ${st(r.summary.dg4)} | 비어 있는 날과 이월한 날을 보고 |`);
  L.push(`| DG5 KRX CSV | ${st(r.summary.dg5)} | ${r.dg5.note} |`);
  L.push(`| §10 프록시 충실도 | ${st(r.summary.section10)} | 464470 상장 전 합성이 실제(백엔드 종가)와 얼마나 닮았는지 → 주 분석 **${r.summary.primaryAnalysis}** |`);
  L.push('');
  if (r.summary.blockers.length > 0) {
    L.push('### 막히는 항목 (사전등록 기준 미달)');
    L.push('');
    for (const b of r.summary.blockers) L.push(`- ${b}`);
    L.push('');
  }
  if (r.summary.interpretationDependentItems.length > 0) {
    L.push('### 사람이 판단해야 하는 항목');
    L.push('');
    for (const b of r.summary.interpretationDependentItems) L.push(`- ${b}`);
    L.push('');
  }

  L.push('## 0. 정정 2 적용 요약');
  L.push('');
  L.push('### 0-1. 백엔드 원본 (output/backend_fill/, 정정 1 때 조회한 파일을 그대로 재사용 — 조회 범위 2021-12-15 ~ 2026-10-01이라 패널 끝 2026-09-30 포함)');
  L.push('');
  L.push('| 종목 | 파일 | 바이트 | SHA-256 | 조회 시각(UTC) |');
  L.push('|---|---|---|---|---|');
  for (const f of am.backendFiles) L.push(`| ${f.symbol} | \`${f.file}\` | ${f.bytes} | \`${f.sha256}\` | ${f.fetchedAtUtc ?? '-'} |`);
  L.push('');
  L.push('### 0-2. 백엔드 OHLC 점검 (패널 기간)');
  L.push('');
  L.push('| 종목 | 백엔드 봉 수 | 불가능 OHLC | 정수값 봉 | 시가 대비 종가 계수 최대 편차(O/H/L) | 이월(값 없음) | 달력에 없는 백엔드 날 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const code of ASSET_CODES) {
    const a = am.assets[code];
    const c = a.ohlcConsistency;
    L.push(`| ${code} | ${a.barsInRange} | ${a.impossible.length} | ${a.integerValuedBars} | ${pct(c.maxDevOpen, 3)} / ${pct(c.maxDevHigh, 3)} / ${pct(c.maxDevLow, 3)} (n=${c.n}) | ${a.carriedDates.length} | ${a.backendOnlyDates.length} |`);
  }
  L.push('');
  L.push('- 불가능 OHLC = 고가<저가, 시가·종가가 고가 초과 또는 저가 미만. 백엔드 값은 O/H/L/C가 같은 계수로 조정됐다면 위 "계수 최대 편차"(= 백엔드 O/H/L을 Yahoo 이벤트 원장 TR의 O/H/L로 나눈 비율을 종가 비율과 비교)가 반올림 잡음 수준이어야 한다. 백엔드 값은 원 단위 정수로 반올림돼 있다(정수값 봉 수 참조).');
  for (const code of ASSET_CODES) {
    const a = am.assets[code];
    if (a.impossible.length > 0) L.push(`- ${code} 불가능 OHLC: ${a.impossible.map(x => `${x.date}(${x.kind})`).join(', ')}`);
  }
  L.push('');

  L.push('## 1. 거래일 달력');
  L.push('');
  L.push(`- 기간 ${r.calendar.start} ~ ${r.calendar.end}, 달력 규칙: \`${r.calendar.ruleUsed}\` (Yahoo 행이 있는 모든 날 = 엄격 해석).`);
  L.push(`- 거래일 수: **${r.calendar.sessions}일** (${r.calendar.firstDate} ~ ${r.calendar.lastDate}). 과반 유효 규칙으로 센 수(참고): ${r.calendar.majorityRuleSessions}일.`);
  L.push('');

  L.push('## 2. DG1 — 결측·이상 봉');
  L.push('');
  L.push('| 자산 | 비교 시작 | 결측(엄격 달력) | 불가능 OHLC | 중복·역순·비양수 | ±20% 초과 | 결과 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const d of r.dg1) {
    L.push(`| ${d.asset} | ${d.effectiveFrom} | ${d.strict.missing}/${d.strict.sessions} (${pct(d.strict.missingRatio)}) | ${d.impossibleOhlc.length} | ${d.duplicateDates.length + d.outOfOrderDates.length + d.nonPositive.length} | ${d.bigMoves.length} | ${st(d.status)} |`);
  }
  L.push('');
  for (const d of r.dg1) if (d.strict.missing > 0) L.push(`- ${d.asset} 결측일: ${d.strict.missingDates.join(', ')}`);
  const big = r.dg1.filter(d => d.bigMoves.length > 0);
  if (big.length > 0) {
    L.push('- 일간 ±20% 초과(보고용):');
    for (const d of big) L.push(`  - ${d.asset}: ${d.bigMoves.map(m => `${m.date} (${pct(m.ret, 1)})`).join(', ')}`);
  } else {
    L.push('- 일간 ±20% 초과 움직임: 없음.');
  }
  L.push('');

  L.push('## 3. DG2 — 백엔드 조정 종가 vs Yahoo(이벤트 원장 TR) 종가');
  L.push('');
  L.push(`- 머리 판정: **${r.summary.dg2Explained ? '사유 확인 통과' : st(r.dg2.status)}** (설명 적용 전 순수 기준 판정: ${st(r.dg2.rawStatus)}).`);
  L.push(`- ${r.dg2.note}`);
  L.push('- 주의: 백엔드와 Yahoo는 같은 계열일 수 있어 **독립 검증이 아니다**(정정 2 A2-3). 백엔드에만 값이 있는 날은 이 대조에서 제외된다.');
  L.push('');
  L.push('| 자산 | 비교 기준 | 대조 일수 | 일치율(0.1% 이내) | 최대 차이 | 대조 범위 | 불일치 일수 | 결과 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const c of r.dg2.rows) {
    L.push(`| ${c.asset} | ${c.reference === 'new-tr' ? 'Yahoo 이벤트 원장 TR 종가(판정)' : 'Yahoo 원래 adjclose(참고)'} | ${c.compared} | ${pct(c.matchRate)} | ${pct(c.maxRelDiff, 3)} | ${c.appFirstDate ?? '-'} ~ ${c.appLastDate ?? '-'} | ${c.mismatchCount} | ${st(c.status)} |`);
  }
  L.push('');
  L.push('### 3-1. 알려진 분배 오류 3건으로 어긋남이 설명되는가 (구간 단위 자동 판정)');
  L.push('');
  L.push('판정 방법: 알려진 오류마다 사건 날짜를 찾고(missing = 원장에 없는 백엔드 단계, misdated = 원장 이벤트일), 그 날짜로 "백엔드/원장TR 종가" 비율 시계열을 구간으로 자른다. 구간 안에서 비율이 일정(±0.05%)하고, 경계의 단계 크기가 사건이 말하는 분배 수익률과 5bp 안에서 같으며, 마지막 구간(사건 이후)이 전부 0.1% 이내여야 설명된 것으로 본다. 임의 보정은 하지 않는다.');
  L.push('');
  for (const code of ASSET_CODES) {
    const ex = am.assets[code].explanation;
    const row = r.dg2.rows.find(x => x.asset === code && x.reference === 'new-tr');
    L.push(`**${code}** — 기준 판정 ${row ? st(row.status) : '-'}, 어긋난 날 ${row?.mismatchCount ?? '-'}일 → ${ex.explained ? (row && row.status !== 'PASS' ? '전부 설명됨' : '어긋남 없음/설명 불필요') : '**설명 안 되는 불일치 있음**'}`);
    L.push('');
    L.push('| 구간 | 일수 | 비율 중앙값 | 구간 내 최대 편차 | 0.1% 초과 일수 | 설명 가능 |');
    L.push('|---|---|---|---|---|---|');
    for (const iv of ex.intervals) L.push(`| ${iv.from} ~ ${iv.to} | ${iv.rows} | ${iv.medianRatio.toFixed(6)} | ${pct(iv.maxDevFromMedian, 3)} | ${iv.mismatchDays} | ${iv.clean ? '어긋남 없음' : iv.explainable ? '예' : '**아니오**'} |`);
    L.push('');
    for (const stp of ex.steps) L.push(`- 알려진 오류: ${stp.error.description} → 단계일 ${stp.date ?? '(못 찾음)'}, 사건이 말하는 단계 ${stp.expectedStep === null ? '-' : pct(stp.expectedStep, 4)}, 측정 단계 ${stp.measuredStep === null ? '-' : pct(stp.measuredStep, 4)}, 차이 ${stp.diffBp === null ? '-' : stp.diffBp.toFixed(1)}bp — ${stp.note || (stp.ok ? '일치' : '불일치')}`);
    if (ex.unexplainedDates.length > 0) L.push(`- **설명 안 되는 어긋난 날 ${ex.unexplainedDates.length}일**: ${ex.unexplainedDates.join(', ')}`);
    for (const x of ex.extraDisagreements) L.push(`- **알려진 오류와 무관한 불일치**: ${x}`);
    L.push('');
  }

  L.push('## 4. DG3 — 조정계수와 분배 이벤트 (Yahoo 이벤트 원장 기준)');
  L.push('');
  L.push('분배락일 전날과 당일 사이에서만 조정계수가 바뀌어야 하고, 이벤트가 없는 구간에서는 1e-6 이하로만 움직여야 한다. 백엔드 값은 원 단위로 반올림돼 있어 1e-6 계수 검사가 성립하지 않으므로, DG3는 계수가 있는 Yahoo 이벤트 원장 TR로 본다. 원장에서 만들었으므로 이 표는 구성상 통과한다 — 원장 자체가 맞는지는 3-1과 5번 항목이 본다.');
  L.push('');
  L.push('| 자산 | 분배 이벤트 | 변화점 | 이벤트 없는 변화점 | 변화 없는 이벤트 | 이벤트 없는 구간 최대 변화 | 결과 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const d of [...r.dg3, ...r.dg3Supplementary]) {
    L.push(`| ${d.asset} | ${d.eventsInPeriod} | ${d.changePoints.length} | ${d.unexplainedChanges.length} | ${d.eventsWithoutChange.length} | ${d.maxNoEventRelChange.toExponential(2)} | ${st(d.status)} |`);
  }
  L.push('');
  L.push('참고 — Yahoo 원래 계수로 본 DG3(정정 전 방식, 판정 아님):');
  L.push('');
  L.push('| 자산 | 분배 이벤트 | 변화점 | 이벤트 없는 변화점 | 변화 없는 이벤트 | 결과 |');
  L.push('|---|---|---|---|---|---|');
  for (const d of r.dg3YahooReference) {
    L.push(`| ${d.asset} | ${d.eventsInPeriod} | ${d.changePoints.length} | ${d.unexplainedChanges.length} | ${d.eventsWithoutChange.length} | ${st(d.status)} |`);
  }
  L.push('');
  for (const d of r.dg3YahooReference) for (const e of d.eventsWithoutChange) L.push(`- ${d.asset}: Yahoo 계수는 ${e.date} 분배 ${e.amount}원을 반영하지 않았다(원장에는 있음).`);
  L.push('');

  L.push('## 5. 이벤트 원장 vs 백엔드가 암시하는 분배 단계');
  L.push('');
  L.push('원장 분배 수익률(분배금 ÷ 직전 원시 종가) vs 백엔드가 암시하는 단계. 5bp 넘게 다르거나 한쪽에만 있는 것을 모두 적는다(알려진 오류 3건 포함, 3-1에서 설명 여부 판정).');
  L.push('');
  let anyAnomaly = false;
  for (const code of ASSET_CODES) {
    const a = am.assets[code];
    for (const e of a.implied.events) {
      if (e.flag === 'ok') continue;
      anyAnomaly = true;
      L.push(`- ${code} ${e.exDate} (분배 ${e.amount}원): 원장 ${e.ledgerYield === null ? '-' : pct(e.ledgerYield, 4)} / 백엔드 ${e.backendYield === null ? '-' : pct(e.backendYield, 4)} / 차이 ${e.diffBp === null ? '-' : e.diffBp.toFixed(1)}bp [${e.flag}]`);
    }
    for (const s of a.implied.backendOnlySteps) {
      anyAnomaly = true;
      L.push(`- ${code} ${s.prevDate}→${s.date}: **원장에 이벤트가 없는데 백엔드 계수가 ${pct(s.backendYield, 4)} 단계 변화** [백엔드 단독]`);
    }
  }
  if (!anyAnomaly) L.push('- 없음');
  L.push('');

  L.push('## 6. DG4 — 결측·이월 보고');
  L.push('');
  L.push('- 백엔드에 값이 없어 이월한 세션(fresh=false):');
  for (const a of r.dg4.perAsset) {
    L.push(`  - ${a.code} ${KR_NAMES[a.code] ?? ''}: 이월 ${a.carriedSessions.length}건${a.carriedSessions.length ? ` (${a.carriedSessions.join(', ')})` : ''}, 상장 전(없음) ${a.absentSessions}일, 합성 ${a.syntheticSessions}일 (그중 같은 미국 봉 반복 ${a.syntheticNonFreshSessions}일)`);
  }
  L.push('- 달력(Yahoo 행)에 없는 백엔드 날(패널에 들어가지 않음):');
  for (const code of ASSET_CODES) {
    const d = am.assets[code].backendOnlyDates;
    L.push(`  - ${code}: ${d.length}건${d.length ? ` (${d.join(', ')})` : ''}`);
  }
  L.push('- 한 자산이 3거래일 이상 연속으로 비어 있던 구간:');
  const strictRuns = r.dg4.perAsset.filter(a => a.strictMissingRunsGE3.length > 0);
  if (strictRuns.length === 0) L.push('  - 없음');
  for (const a of strictRuns) L.push(`  - ${a.code}: ${a.strictMissingRunsGE3.map(x => `${x.start}~${x.end}(${x.length})`).join(', ')}`);
  L.push('');

  L.push('## 7. §10 프록시 충실도 — 464470 상장 전 합성');
  L.push('');
  const pf = r.proxyFidelity;
  L.push(`겹침 구간 ${pf.from} ~ ${pf.to} (${pf.sessions} 세션)에서 "TLT×환율로 만든 합성"과 "실제 464470(백엔드 조정 종가)"의 수익률을 비교했다. 일간은 미국·한국 시차 때문에 구조적으로 낮아 **보고만** 한다.`);
  L.push('');
  L.push('| 빈도 | 관측 수 | 상관 | 베타(실제=a+b×합성) | 추적오차(연율) | 방향 일치율 |');
  L.push('|---|---|---|---|---|---|');
  L.push(statsRow('일간(보고만)', pf.daily));
  L.push(statsRow('주간', pf.weekly));
  L.push(statsRow('월간', pf.monthly));
  L.push('');
  L.push('| 판정 기준 | 값 | 기준 | 결과 |');
  L.push('|---|---|---|---|');
  for (const c of pf.criteria) {
    const isPct = c.name.includes('추적오차');
    L.push(`| ${c.name} | ${isPct ? pct(c.value) : num(c.value)} | ${c.threshold} | ${c.pass ? '통과' : '실패'} |`);
  }
  L.push('');
  L.push(`- 종합: **${pf.pass ? '모든 기준 충족 → P(합성 포함)가 주 분석' : '하나 이상 실패 → 합성 구간 폐기, P5(464470 제외 5종)가 주 분석'}**`);
  if (r.synthetic) {
    const s: SpliceInfo = r.synthetic.splice;
    L.push(`- 이음새(백엔드 첫 조정 종가 기준 재계산): 상장일 ${s.listingDate}, 실제 첫 종가 ${s.actualFirstClose.toFixed(2)}, 합성 ${s.syntheticAtListing.toFixed(2)} → 스케일 c = ${s.scale.toFixed(6)} (합성 구간 전체에 곱함).`);
    L.push(`- 합성 구간: ${r.synthetic.syntheticFirstDate} ~ ${r.synthetic.syntheticLastDate}, ${r.synthetic.syntheticSessions} 세션 (새 미국 봉 ${r.synthetic.syntheticFreshSessions}).`);
    if (r.synthetic.seam) {
      const sm = r.synthetic.seam;
      L.push(`- 이음새 괴리(실제 값으로 보고): 마지막 합성일 ${sm.lastSyntheticDate} 종가 → 상장일 시가 ${pct(sm.actualOpenGap, 2)}, 종가 ${pct(sm.actualCloseReturn, 2)}.`);
    }
  }
  L.push('');

  L.push('## 8. 한계 (정직한 공개)');
  L.push('');
  L.push('- TR 시세의 기준 출처는 앱 백엔드 `/history`이고, Yahoo는 교차 확인용이다. 둘은 같은 공급자 계열일 수 있어 DG2는 독립 검증이 아니다. DG5(KRX 공식 CSV)는 받지 못했다.');
  L.push('- 백엔드 값은 원 단위 정수로 반올림된 배당조정 값이다. O/H/L/C가 같은 계수로 조정됐는지는 불가능 OHLC 검사와 0-2의 계수 편차로만 본다.');
  L.push('- DG2의 "사유 확인 통과"는 기준을 만족한 것이 아니라, 미달 원인이 알려진 Yahoo 분배 원장 오류임을 구간 단위로 확인했다는 뜻이다.');
  L.push('- 한국 공휴일 달력은 외부 자료와 대조하지 않았다.');
  L.push('- 합성 구간은 시가·고가·저가가 없어 종가 하나로 만든 근사다(사전등록 §6). TLT는 정정 대상이 아니어서 Yahoo adjclose를 그대로 쓴다.');
  L.push('');
  return L.join('\n');
}
