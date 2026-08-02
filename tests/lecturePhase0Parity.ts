// tests/lecturePhase0Parity.ts
// ---------------------------------------------------------------------------
// Phase 0(신규 알림 구성 선검증) 순수 로직 `scripts/backtest/lectureSignals/phase0Core.ts`의
// 골든/불변식 테스트.
//
// RULES §13 준수: **명시적 절대 골든값**을 손계산해 못박는다(경로A-vs-경로B 자기참조 금지).
//   §1 구성 정의가 계획서(`docs/PLAN_앱적용_신호정비_260726.md` §2 Phase 0 표)와 1:1 일치
//   §2 비트 유틸(popcount / transition / state) 절대 골든
//   §3 **신규 전이 vs 상태 지속** 카운트 구분 골든 — 합성 마스크 시계열 손계산
//   §4 포트폴리오 표본 시드 재현성·중복 없음·매수일 범위
//   §5 합성 바에서 실제 규칙 판정 → 마스크 비트 골든(손계산한 규칙 집합)
//   §6 분포 요약(percentile) 절대 골든
//
// 실행: npx --yes tsx tests/lecturePhase0Parity.ts   (package.json 미등록 — 지시대로)
// ---------------------------------------------------------------------------

import { mulberry32 } from '../scripts/backtest/conditionalChannel/statistics';
import { APP_SELL_RULE_IDS, buildAppIndicatorSeries } from '../scripts/backtest/lectureSignals/appRules';
import type { SecurityBars } from '../scripts/backtest/lectureSignals/configTypes';
import {
  ACUTE_SIX,
  ALERT_SEVERITY,
  ALL_CONFIG_LABEL,
  ALL_CONFIG_MASKS,
  ALL_CONFIG_RULE_SETS,
  COMPROMISE_ADDED_RULES,
  COMPROMISE_CONFIG_IDS,
  COMPROMISE_RULE_SETS,
  CONFIG_MASKS,
  CONFIG_RULE_SETS,
  PHASE0_ALERT_IDS,
  PHASE0_ALL_CONFIG_IDS,
  PHASE0_CONFIG_IDS,
  SATURATION_EXCLUDED_RULES,
  SEVERITY_ORDER,
  TAIL_DEFENSE_RULES,
  alertBitIndex,
  anyConfigMask,
  applyDailyCap,
  buildAcuteMask,
  configMask,
  countSeriesAlerts,
  percentileOf,
  planCappedGroups,
  popcount,
  prioritizeCandidates,
  samplePortfolios,
  scanHoldingMasks,
  severityRankOfBit,
  simulateCappedPortfolio,
  simulateConfigPolicy,
  stateBits,
  summarizeDist,
  transitionBits,
  type CapCandidate,
  type CappedMember,
  type Phase0CompromiseId,
  type PortfolioCandidate,
} from '../scripts/backtest/lectureSignals/phase0Core';

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${String(expected)} 실제=${String(actual)}`);
  }
}
function checkArr(name: string, actual: readonly unknown[], expected: readonly unknown[]): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${e}\n      실제=${a}`);
  }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`);
  }
}
function checkTrue(name: string, cond: boolean): void {
  check(name, cond, true);
}

const bit = (id: string): number => 1 << alertBitIndex(id);

// ===========================================================================
console.log('§1 구성 정의 — 계획서와 1:1 일치 불변식');
// ===========================================================================

check('알림 단위 총 19종', PHASE0_ALERT_IDS.length, 19);
checkArr('앞 13종 = 앱 매도규칙 순서', PHASE0_ALERT_IDS.slice(0, 13), [...APP_SELL_RULE_IDS]);
checkArr('뒤 6종 = 급성 6종', PHASE0_ALERT_IDS.slice(13), [...ACUTE_SIX]);
checkArr('급성 6종 코드 고정(S5는 앱 프록시 변형)', [...ACUTE_SIX], [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_APP_PROXY',
  'S6_CRASH_5_VOLUME_2X',
]);

checkArr('C = 현행 앱 매도규칙 13종 그대로', [...CONFIG_RULE_SETS.C], [...APP_SELL_RULE_IDS]);
check('C 규칙 수 13', CONFIG_RULE_SETS.C.length, 13);
checkArr('C′-min = 급성 6종 + climax-top + distribution-high', [...CONFIG_RULE_SETS.CMIN], [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_APP_PROXY',
  'S6_CRASH_5_VOLUME_2X',
  'climax-top',
  'distribution-high',
]);
check('C′-min 규칙 수 8', CONFIG_RULE_SETS.CMIN.length, 8);
checkArr('C′-mid = C′-min + 이동평균 이탈 3종', [...CONFIG_RULE_SETS.CMID], [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_APP_PROXY',
  'S6_CRASH_5_VOLUME_2X',
  'climax-top',
  'distribution-high',
  'weinstein-150-break',
  'ma120-break',
  'swing-low-break',
]);
check('C′-mid 규칙 수 11', CONFIG_RULE_SETS.CMID.length, 11);

check('구성 3종', PHASE0_CONFIG_IDS.length, 3);
check('C 마스크 popcount 13', popcount(CONFIG_MASKS.C), 13);
check('C′-min 마스크 popcount 8', popcount(CONFIG_MASKS.CMIN), 8);
check('C′-mid 마스크 popcount 11', popcount(CONFIG_MASKS.CMID), 11);
check(
  'C′-min ⊂ C′-mid',
  (CONFIG_MASKS.CMIN & CONFIG_MASKS.CMID) >>> 0,
  CONFIG_MASKS.CMIN >>> 0
);
check(
  'C ∩ C′-min = climax-top·distribution-high (2종)',
  popcount(CONFIG_MASKS.C & CONFIG_MASKS.CMIN),
  2
);
check(
  'C ∩ C′-min 비트 정확 일치',
  (CONFIG_MASKS.C & CONFIG_MASKS.CMIN) >>> 0,
  (bit('climax-top') | bit('distribution-high')) >>> 0
);
check(
  'C ∩ C′-mid = 위 2종 + 이동평균 이탈 3종 (5종)',
  popcount(CONFIG_MASKS.C & CONFIG_MASKS.CMID),
  5
);

const acuteMaskAll = ACUTE_SIX.reduce((m, id) => m | bit(id), 0);
check('급성 6종은 C에 없다', (CONFIG_MASKS.C & acuteMaskAll) >>> 0, 0);
check('급성 6종은 C′-min에 전부 있다', (CONFIG_MASKS.CMIN & acuteMaskAll) >>> 0, acuteMaskAll >>> 0);
for (const id of [...CONFIG_RULE_SETS.C, ...CONFIG_RULE_SETS.CMID]) {
  checkTrue(`규칙 id 등록됨: ${id}`, alertBitIndex(id) >= 0);
}
check('configMask는 CONFIG_MASKS와 동일', configMask('CMIN'), CONFIG_MASKS.CMIN);

// 계획서에서 "완화 또는 OFF"로 분류된 4종이 C′-min에 없어야 한다.
for (const off of ['stop-loss', 'dead-cross', 'trend-break', 'long-decline']) {
  check(`포화 4종 ${off}는 C′-min에서 제외`, (CONFIG_MASKS.CMIN & bit(off)) >>> 0, 0);
  check(`포화 4종 ${off}는 C′-mid에서도 제외`, (CONFIG_MASKS.CMID & bit(off)) >>> 0, 0);
  check(`포화 4종 ${off}는 C에는 포함`, (CONFIG_MASKS.C & bit(off)) >>> 0, bit(off) >>> 0);
}

// ===========================================================================
console.log('§2 비트 유틸 절대 골든');
// ===========================================================================

check('popcount(0)', popcount(0), 0);
check('popcount(0b1011)=3', popcount(0b1011), 3);
check('popcount(0x7FFFF)=19', popcount(0x7ffff), 19);
check('popcount(1<<18)=1', popcount(1 << 18), 1);

check('transition: 어제 0b0101 → 오늘 0b0111 (cfg 0b1111) = 0b0010', transitionBits(0b0101, 0b0111, 0b1111), 0b0010);
check('transition: 꺼진 비트는 세지 않음', transitionBits(0b0111, 0b0101, 0b1111), 0);
check('transition: 구성 밖 비트는 마스킹', transitionBits(0b0000, 0b1111, 0b0011), 0b0011);
check('state: 구성 밖 비트는 마스킹', stateBits(0b1111, 0b0101), 0b0101);
check('state: 지속되는 비트도 매일 센다', stateBits(0b0010, 0b1111), 0b0010);

// ===========================================================================
console.log('§3 신규 전이 vs 상태 지속 — 합성 시계열 손계산 골든');
// ===========================================================================

// 규칙 A = climax-top(비트 8), B = distribution-high(비트 9), Z = S1(비트 13, C에는 없음)
const A = bit('climax-top');
const B = bit('distribution-high');
const Z = bit('S1_RUNUP_21D_100');
check('A 비트 인덱스 8', alertBitIndex('climax-top'), 8);
check('B 비트 인덱스 9', alertBitIndex('distribution-high'), 9);
check('Z 비트 인덱스 13', alertBitIndex('S1_RUNUP_21D_100'), 13);

//        day0    day1    day2    day3    day4    day5
// A:      ON      ON      ON      off     ON      off
// B:      off     ON      ON      ON      ON      off
// Z:      off     off     off     off     off     ON
const series = [A, A | B, A | B, B, A | B, Z];

// (1) 신규 전이 (prevMask = 0):
//   day0: A 신규 → 1
//   day1: B 신규 → 1  (A는 이미 켜져 있어 세지 않음)
//   day2: 0
//   day3: 0            (A는 꺼짐 — 꺼짐은 알림 아님)
//   day4: A 재점화 → 1
//   day5: 0            (A·B 꺼짐, Z는 C′-min 밖 구성에서만)
// (2) 상태 지속: [1,2,2,1,2,0]
const cfgAB = A | B;
const r1 = countSeriesAlerts(series, cfgAB, 0);
checkArr('전이 일별(prev=0)', r1.perDayTransition, [1, 1, 0, 0, 1, 0]);
checkArr('상태 일별', r1.perDayState, [1, 2, 2, 1, 2, 0]);
check('전이 합계 3', r1.transitionTotal, 3);
check('상태 합계 8', r1.stateTotal, 8);
check('전이 기여 A=2', r1.transitionByBit[8], 2);
check('전이 기여 B=1', r1.transitionByBit[9], 1);
check('전이 기여 Z=0(구성 밖)', r1.transitionByBit[13], 0);

// prevMask에 A가 이미 켜져 있으면 day0 전이가 사라진다 → 합계 2
const r2 = countSeriesAlerts(series, cfgAB, A);
checkArr('전이 일별(prev=A)', r2.perDayTransition, [0, 1, 0, 0, 1, 0]);
check('전이 합계 2', r2.transitionTotal, 2);
check('상태 합계는 prevMask와 무관 = 8', r2.stateTotal, 8);

// 구성이 A만 포함하면
const r3 = countSeriesAlerts(series, A, 0);
checkArr('A만 구성: 전이 일별', r3.perDayTransition, [1, 0, 0, 0, 1, 0]);
checkArr('A만 구성: 상태 일별', r3.perDayState, [1, 1, 1, 0, 1, 0]);

// C 구성은 Z(급성)를 포함하지 않으므로 day5는 0, C′-min은 1
const rC = countSeriesAlerts(series, CONFIG_MASKS.C, 0);
const rMin = countSeriesAlerts(series, CONFIG_MASKS.CMIN, 0);
check('C 구성 day5 전이 0(S1은 C에 없음)', rC.perDayTransition[5], 0);
check('C′-min 구성 day5 전이 1(S1 포함)', rMin.perDayTransition[5], 1);
check('C·C′-min 모두 A·B를 포함 → day1 전이 1', rC.perDayTransition[1], 1);
check('C′-min day1 전이 1', rMin.perDayTransition[1], 1);

// 지속 상태가 길수록 상태 지속 카운트만 커진다(전이는 1회) — 포화 지표와 체감 알림의 분리
const persist = [A, A, A, A, A, A, A, A, A, A];
const rp = countSeriesAlerts(persist, A, 0);
check('10일 연속 충족: 전이 1회', rp.transitionTotal, 1);
check('10일 연속 충족: 상태 10건', rp.stateTotal, 10);

// ===========================================================================
console.log('§4 포트폴리오 표본 — 시드 재현성·중복 없음·매수일 범위');
// ===========================================================================

const candidates: PortfolioCandidate[] = [];
for (let i = 0; i < 20; i++) {
  candidates.push({ code: `A${String(i).padStart(2, '0')}`, purchaseLo: 100, purchaseHi: 109 });
}
const SEED = 20260726 + 1060;
const s1 = samplePortfolios(candidates, 6, 5, mulberry32(SEED));
const s2 = samplePortfolios(candidates, 6, 5, mulberry32(SEED));
const s3 = samplePortfolios(candidates, 6, 5, mulberry32(SEED + 1));
check('세트 수 5', s1.length, 5);
check('세트 크기 6', s1[0].length, 6);
checkArr('같은 시드 → 완전 동일 표본', s1, s2);
checkTrue('다른 시드 → 표본이 달라짐', JSON.stringify(s1) !== JSON.stringify(s3));
let dupFree = true;
let inRange = true;
for (const set of s1) {
  const seen = new Set<string>();
  for (const h of set) {
    if (seen.has(h.code)) dupFree = false;
    seen.add(h.code);
    if (h.purchaseBar < 100 || h.purchaseBar > 109) inRange = false;
  }
}
checkTrue('세트 내 종목 중복 없음', dupFree);
checkTrue('매수일이 후보 구간 안', inRange);
check('후보보다 큰 규모는 빈 결과', samplePortfolios(candidates, 21, 3, mulberry32(1)).length, 0);
check('세트 0이면 빈 결과', samplePortfolios(candidates, 5, 0, mulberry32(1)).length, 0);

// 시드 재현성은 rng 소비 순서에 의존한다 — 첫 세트 첫 종목의 절대 골든을 못박는다.
check('첫 세트 첫 종목(시드 고정 골든)', s1[0][0].code, s2[0][0].code);
checkTrue('첫 세트 첫 매수bar가 구간 내', s1[0][0].purchaseBar >= 100 && s1[0][0].purchaseBar <= 109);

// ===========================================================================
console.log('§5 합성 바 → 실제 규칙 판정 마스크 골든');
// ===========================================================================

function mkDates(n: number): string[] {
  const out: string[] = [];
  let y = 2014;
  let m = 1;
  let d = 1;
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    d++;
    if (d > 28) {
      d = 1;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return out;
}

/**
 * 400봉 전부 종가 1000·시가 1000·거래량 1000 고정, **350봉만** 종가 940(−6%)·거래량 3000.
 * 손계산 기대 발동(§ appRules 정의 기준):
 *   stop-loss(0)      : 보유수익률 = (940−1000)/1000 = −6% ≤ −5%           → ON
 *   trend-break(3)    : 940 < MA20(=997) 이고 보유수익률 < 0               → ON
 *   daily-crash(7)    : 당일 −6% ≤ −5%                                     → ON
 *   weinstein-150(10) : 940 < MA150, 하향이탈 경과일 0 ≤ 5                  → ON
 *   ma120-break(11)   : 940 < MA120, 하향이탈 경과일 0 ≤ 5                  → ON
 *   swing-low(12)     : 직전 확정 스윙로우 1000 > 940                        → ON
 *   S6(18)            : −6% ≤ −5% 이고 거래량 3000 ≥ 2×1000                → ON
 *   나머지 전부 OFF (평탄한 가격이라 RSI≈50·클라이맥스 장기추세 미충족·
 *                    디스트리뷰션 카운트 1 < 5·데드크로스 MA5==MA20 등)
 */
const N = 400;
const CRASH = 350;
const closes: number[] = [];
const opens: number[] = [];
const highs: number[] = [];
const lows: number[] = [];
const vols: number[] = [];
const amts: number[] = [];
for (let i = 0; i < N; i++) {
  const c = i === CRASH ? 940 : 1000;
  closes.push(c);
  opens.push(1000);
  highs.push(1000);
  lows.push(c);
  vols.push(i === CRASH ? 3000 : 1000);
  amts.push(c * (i === CRASH ? 3000 : 1000));
}
const dates = mkDates(N);
const dateIndex = new Map<string, number>();
for (let i = 0; i < N; i++) dateIndex.set(dates[i], i);
const bars: SecurityBars = {
  code: 'TEST01',
  name: '합성',
  dates,
  adjOpen: opens,
  adjHigh: highs,
  adjLow: lows,
  adjClose: closes,
  adjVolume: vols,
  amount: amts,
  market: new Array<string>(N).fill('KOSPI'),
  close: closes,
  volume: vols,
  dateIndex,
};

const series5 = buildAppIndicatorSeries(bars);
const acute = buildAcuteMask(bars, new Set<string>(), 300, N - 1);
// 매수는 340봉(시가 1000) — 급락일 이전에 보유 중인 상태
const scan = scanHoldingMasks(series5, acute, 340, CRASH - 1, CRASH + 1);
checkTrue('scanHoldingMasks 결과 있음', scan !== null);
if (scan) {
  const expectedCrash =
    bit('stop-loss') |
    bit('trend-break') |
    bit('daily-crash') |
    bit('weinstein-150-break') |
    bit('ma120-break') |
    bit('swing-low-break') |
    bit('S6_CRASH_5_VOLUME_2X');
  check('급락 전일 마스크 0', scan.masks[0], 0);
  check('급락일 마스크 = 손계산 7종', scan.masks[1] >>> 0, expectedCrash >>> 0);
  check('급락일 발동 규칙 수 7', popcount(scan.masks[1]), 7);
  check('급락 다음날 마스크 0', scan.masks[2], 0);
  check('전이 판정 기준 prevMask 0', scan.prevMask, 0);

  // 구성별 그날 알림 건수 — 손계산
  //   C      : stop-loss·trend-break·daily-crash·weinstein·ma120·swing-low = 6
  //   C′-min : S6만 = 1
  //   C′-mid : S6 + weinstein + ma120 + swing-low = 4
  const cnt = countSeriesAlerts(scan.masks, CONFIG_MASKS.C, scan.prevMask);
  checkArr('C 구성 전이 일별', cnt.perDayTransition, [0, 6, 0]);
  const cntMin = countSeriesAlerts(scan.masks, CONFIG_MASKS.CMIN, scan.prevMask);
  checkArr('C′-min 구성 전이 일별', cntMin.perDayTransition, [0, 1, 0]);
  const cntMid = countSeriesAlerts(scan.masks, CONFIG_MASKS.CMID, scan.prevMask);
  checkArr('C′-mid 구성 전이 일별', cntMid.perDayTransition, [0, 4, 0]);
  checkArr('C 구성 상태 일별(= 전이와 같은 날만 충족)', cnt.perDayState, [0, 6, 0]);
}

// 급성 마스크는 13..18 비트만 쓴다(앱 규칙 비트 침범 금지)
let acuteBitsOk = true;
for (let i = 300; i < N; i++) {
  if ((acute[i] & 0x1fff) !== 0) acuteBitsOk = false;
}
checkTrue('급성 마스크는 하위 13비트를 건드리지 않음', acuteBitsOk);
check('급락일 급성 마스크 = S6만', acute[CRASH] >>> 0, bit('S6_CRASH_5_VOLUME_2X') >>> 0);
check('평탄일 급성 마스크 0', acute[CRASH - 1] >>> 0, 0);

// 매수일이 다른 두 보유는 보유손익 의존 규칙에서만 갈린다(구성 독립성 확인).
// 990봉 매수는 없으므로 대신 급락 직후(351봉, 시가 1000) 매수 → 급락일 이전 구간 미보유.
const scanLate = scanHoldingMasks(series5, acute, 200, CRASH - 1, CRASH + 1);
if (scanLate) {
  check('다른 매수일에도 C′-min 판정은 동일(보유가 무관)', (scanLate.masks[1] & CONFIG_MASKS.CMIN) >>> 0, bit('S6_CRASH_5_VOLUME_2X') >>> 0);
}

// ===========================================================================
console.log('§6 분포 요약 절대 골든');
// ===========================================================================

checkClose('percentileOf([1..5], 50) = 3', percentileOf([1, 2, 3, 4, 5], 50), 3);
checkClose('percentileOf([1..5], 90) = 4.6', percentileOf([1, 2, 3, 4, 5], 90), 4.6);
checkClose('percentileOf([1..4], 50) = 2.5', percentileOf([1, 2, 3, 4], 50), 2.5);
checkClose('percentileOf 단일값', percentileOf([7], 90), 7);
const d = summarizeDist([5, 1, 3, 2, 4]);
check('summarizeDist n', d.n, 5);
checkClose('summarizeDist mean', d.mean, 3);
checkClose('summarizeDist median', d.median, 3);
checkClose('summarizeDist p90', d.p90, 4.6);
checkClose('summarizeDist max', d.max, 5);
check('빈 배열 n=0', summarizeDist([]).n, 0);

// ===========================================================================
console.log('§7 예산제한 C(C_CAPPED) — 우선순위·상한 경계·미실행 소멸 골든');
// ===========================================================================

// ── 7-1. severity 표는 앱 constants/alertRules.ts 값 그대로여야 한다(손으로 옮겨 적은 기대값) ──
const EXPECTED_SEVERITY: Record<string, string> = {
  'stop-loss': 'critical',
  'overheat-drop': 'critical',
  'dead-cross': 'warning',
  'trend-break': 'warning',
  'long-decline': 'warning',
  'profit-target': 'warning',
  'overheat-profit': 'critical',
  'daily-crash': 'critical',
  'climax-top': 'warning',
  'distribution-high': 'warning',
  'weinstein-150-break': 'warning',
  'ma120-break': 'warning',
  'swing-low-break': 'warning',
};
for (const id of APP_SELL_RULE_IDS) {
  check(`severity(${id})`, ALERT_SEVERITY[id], EXPECTED_SEVERITY[id]);
}
check(
  'critical은 정확히 4종',
  APP_SELL_RULE_IDS.filter((r) => ALERT_SEVERITY[r] === 'critical').length,
  4
);
check(
  'warning은 정확히 9종',
  APP_SELL_RULE_IDS.filter((r) => ALERT_SEVERITY[r] === 'warning').length,
  9
);
check('매도 13종에 info는 없다', APP_SELL_RULE_IDS.filter((r) => ALERT_SEVERITY[r] === 'info').length, 0);
check('severity 순위 critical=0', SEVERITY_ORDER.critical, 0);
check('severity 순위 warning=1', SEVERITY_ORDER.warning, 1);
check('severity 순위 info=2', SEVERITY_ORDER.info, 2);
check('severityRankOfBit(stop-loss)=0', severityRankOfBit(alertBitIndex('stop-loss')), 0);
check('severityRankOfBit(dead-cross)=1', severityRankOfBit(alertBitIndex('dead-cross')), 1);
check('severityRankOfBit(미등록 비트)=info(2)', severityRankOfBit(99), 2);

// ── 7-2. 우선순위 정렬 결정론: severity → 종목코드 → 비트 인덱스, 전부 오름차순 ──
const mkCand = (code: string, rule: string, posIndex = 0): CapCandidate => ({
  posIndex,
  code,
  bit: alertBitIndex(rule),
});
// 일부러 뒤죽박죽으로 넣는다.
const raw: CapCandidate[] = [
  mkCand('B02', 'swing-low-break', 1), // warning, B02, bit12
  mkCand('A01', 'dead-cross', 0), // warning, A01, bit2
  mkCand('B02', 'daily-crash', 1), // critical, B02, bit7
  mkCand('A01', 'stop-loss', 0), // critical, A01, bit0
  mkCand('A01', 'daily-crash', 0), // critical, A01, bit7
  mkCand('C03', 'overheat-drop', 2), // critical, C03, bit1
];
const ordered = prioritizeCandidates(raw);
checkArr(
  '우선순위: critical(코드順) → warning(코드順), 같은 코드면 비트順',
  ordered.map((c) => `${c.code}:${PHASE0_ALERT_IDS[c.bit]}`),
  [
    'A01:stop-loss', // critical A01 bit0
    'A01:daily-crash', // critical A01 bit7
    'B02:daily-crash', // critical B02
    'C03:overheat-drop', // critical C03
    'A01:dead-cross', // warning A01
    'B02:swing-low-break', // warning B02
  ]
);
checkArr('정렬은 비파괴(원본 순서 유지)', raw.map((c) => c.code), [
  'B02',
  'A01',
  'B02',
  'A01',
  'A01',
  'C03',
]);
// 입력 순서를 바꿔도 결과는 같다(완전 결정론)
checkArr(
  '입력 순서를 뒤집어도 정렬 결과 동일',
  prioritizeCandidates([...raw].reverse()).map((c) => `${c.code}:${c.bit}`),
  ordered.map((c) => `${c.code}:${c.bit}`)
);

// ── 7-3. 상한 경계: 정확히 3건 / 4건 ──
const three = raw.slice(0, 3);
const cap3of3 = applyDailyCap(three, 3);
check('후보 3건·상한 3 → 실행 3', cap3of3.executed.length, 3);
check('후보 3건·상한 3 → 소멸 0', cap3of3.dropped.length, 0);
const four = raw.slice(0, 4); // B02:swing, A01:dead, B02:crash, A01:stop
const cap3of4 = applyDailyCap(four, 3);
check('후보 4건·상한 3 → 실행 3', cap3of4.executed.length, 3);
check('후보 4건·상한 3 → 소멸 1', cap3of4.dropped.length, 1);
checkArr(
  '후보 4건·상한 3 → 실행되는 3건(손계산)',
  cap3of4.executed.map((c) => `${c.code}:${PHASE0_ALERT_IDS[c.bit]}`),
  ['A01:stop-loss', 'B02:daily-crash', 'A01:dead-cross']
);
checkArr(
  '후보 4건·상한 3 → 소멸하는 1건(가장 낮은 우선순위)',
  cap3of4.dropped.map((c) => `${c.code}:${PHASE0_ALERT_IDS[c.bit]}`),
  ['B02:swing-low-break']
);
check('상한 0 → 실행 0·소멸 전부', applyDailyCap(raw, 0).executed.length, 0);
check('상한 0 → 소멸 6', applyDailyCap(raw, 0).dropped.length, 6);
check('후보보다 큰 상한 → 전부 실행', applyDailyCap(raw, 99).executed.length, 6);
check('후보보다 큰 상한 → 소멸 0', applyDailyCap(raw, 99).dropped.length, 0);

// ── 7-4. 그룹 계획 결정론 ──
const gp = planCappedGroups(
  [
    { code: 'X1', buyBar: 0, windowEnd: 99 }, // 100일
    { code: 'X2', buyBar: 0, windowEnd: 99 },
    { code: 'X3', buyBar: 0, windowEnd: 99 },
    { code: 'X4', buyBar: 0, windowEnd: 99 },
  ],
  100,
  2
);
checkClose('평균 동시보유 = 400/100 = 4', gp.avgConcurrency, 4);
check('그룹 수 = round(4/2) = 2', gp.groupCount, 2);
checkArr(
  '그룹 배정 = 코드 오름차순 라운드로빈',
  ['X1', 'X2', 'X3', 'X4'].map((c) => gp.groupOfCode.get(c)),
  [0, 1, 0, 1]
);
check('목표 규모가 동시보유보다 크면 그룹 1개', planCappedGroups([{ code: 'A', buyBar: 0, windowEnd: 9 }], 10, 60).groupCount, 1);

// ── 7-5. 포트폴리오 시뮬레이션 — 절대 골든 (§5의 합성 바 4종목판) ──
//
// 손계산 전제(§5와 같은 바: 400봉 전부 종가·시가 1000, 350봉만 종가 940·거래량 3000):
//   매수비용 bCost = (10+10+5+5)/10000 = 0.003
//   매도비용 = 변동 30bps + 증권거래세 30bps(2015년, KR_SELL_TAX_SCHEDULE) = 0.006
//   매수bar 340(시가 1000) → shares = 0.997/1000
//   350봉에서 C 규칙 6종 발동(stop-loss·trend-break·daily-crash·weinstein·ma120·swing-low)
//   → 351봉 시가 1000 매도 → 현금 0.997 × 0.994 = 0.991018 → 최종수익률 −0.008982
//   재매수는 351+20 = 371봉이라 창(360) 밖 → 없음
//   매도 없으면(HOLD) 최종수익률 = −bCost = −0.003
const B_COST = 0.003;
const SELL_COST = 0.006;
const GOLD_SOLD_RETURN = 0.997 * (1 - SELL_COST) - 1; // −0.008982
const GOLD_HOLD_RETURN = -B_COST;
check('합성 바 351봉 날짜(세율 구간 확인용)', bars.dates[351], '2015-01-16');

function mkSyntheticBars(code: string): SecurityBars {
  return { ...bars, code, dateIndex };
}
const CAP_CODES = ['A01', 'A02', 'A03', 'A04'];
const capBarsByCode = new Map<string, SecurityBars>();
const capMembers: CappedMember[] = [];
for (const code of CAP_CODES) {
  const b = mkSyntheticBars(code);
  capBarsByCode.set(code, b);
  capMembers.push({
    code,
    s: buildAppIndicatorSeries(b),
    bars: b,
    acute: buildAcuteMask(b, new Set<string>(), 300, N - 1),
    buyBar: 340,
    windowEnd: 360,
  });
}
const capCalendar = dates.slice(340, 361);
check('캘린더 21일', capCalendar.length, 21);

// (a) 상한 3 — 4종목이 같은 날 6건씩 = 24건 발동, 상위 3건만 실행
const cap3 = simulateCappedPortfolio(capMembers, CONFIG_MASKS.C, 3, 20, capCalendar);
check('상한3: 발동 후보 24건(4종목 × 6규칙)', cap3.totalCandidates, 24);
check('상한3: 실행 3건', cap3.executedCandidates, 3);
check('상한3: 소멸 21건', cap3.droppedCandidates, 21);
check('상한3: 캘린더 21일', cap3.calendarDays, 21);
check('상한3: 부실시가 이월 0', cap3.deferredBadOpen, 0);
// 우선순위 = critical(bit0 stop-loss, bit7 daily-crash) × 코드順 → A01:0, A01:7, A02:0
// → 매도되는 종목은 A01·A02 뿐. A03·A04는 신호가 그날 소멸하고 **이월되지 않는다**.
checkArr(
  '상한3: 종목별 매도 횟수(A01·A02만 1회) — 미실행 신호는 그날 소멸',
  cap3.perPosition.map((p) => p.sells),
  [1, 1, 0, 0]
);
checkClose('상한3: A01 최종수익률(손계산)', cap3.perPosition[0].terminalReturn, GOLD_SOLD_RETURN, 1e-12);
checkClose('상한3: A02 최종수익률(손계산)', cap3.perPosition[1].terminalReturn, GOLD_SOLD_RETURN, 1e-12);
checkClose('상한3: A03 최종수익률 = 미매도(HOLD와 동일)', cap3.perPosition[2].terminalReturn, GOLD_HOLD_RETURN, 1e-12);
checkClose('상한3: A04 최종수익률 = 미매도(HOLD와 동일)', cap3.perPosition[3].terminalReturn, GOLD_HOLD_RETURN, 1e-12);
checkClose('상한3: A01 MDD = 0.06(1000→940)', cap3.perPosition[0].mdd, 0.06, 1e-12);
checkClose('상한3: A03 MDD = 0.06(팔지 않아도 같음)', cap3.perPosition[2].mdd, 0.06, 1e-12);
check('상한3: 실행 매도 로그 2건', cap3.sellLog.length, 2);
checkArr('상한3: 매도 종목', cap3.sellLog.map((x) => x.code).sort(), ['A01', 'A02']);
check('상한3: 매도 bar = 351(익일 시가)', cap3.sellLog[0].sellBar, 351);
check('상한3: 매도가 = 시가 1000', cap3.sellLog[0].sellPrice, 1000);

// (b) 상한 4 — 경계 한 칸 차이로 A02의 두 번째 critical까지 들어가지만 매도 종목 수는 그대로
const cap4 = simulateCappedPortfolio(capMembers, CONFIG_MASKS.C, 4, 20, capCalendar);
check('상한4: 실행 4건', cap4.executedCandidates, 4);
check('상한4: 소멸 20건', cap4.droppedCandidates, 20);
checkArr(
  '상한4: A01:0 · A01:7 · A02:0 · A02:7 → 여전히 A01·A02만 매도',
  cap4.perPosition.map((p) => p.sells),
  [1, 1, 0, 0]
);
// 상한 5면 A03의 stop-loss까지 들어가 매도 종목이 3개가 된다 — 경계가 실제로 작동함을 고정
const cap5 = simulateCappedPortfolio(capMembers, CONFIG_MASKS.C, 5, 20, capCalendar);
checkArr('상한5: A03까지 매도(경계 작동)', cap5.perPosition.map((p) => p.sells), [1, 1, 1, 0]);
const cap0 = simulateCappedPortfolio(capMembers, CONFIG_MASKS.C, 0, 20, capCalendar);
check('상한0: 실행 0건', cap0.executedCandidates, 0);
check('상한0: 소멸 24건', cap0.droppedCandidates, 24);
checkArr('상한0: 아무도 팔지 않음', cap0.perPosition.map((p) => p.sells), [0, 0, 0, 0]);
checkClose('상한0: 최종수익률 = HOLD', cap0.perPosition[0].terminalReturn, GOLD_HOLD_RETURN, 1e-12);

// (c) 상한 무한 → C(현행 13종) per-position 시뮬레이션과 **정확히 동일**해야 한다.
//     (독립 구현 2개의 교차확인 + 위의 절대 골든값으로 이중 고정)
const capInf = simulateCappedPortfolio(capMembers, CONFIG_MASKS.C, 1e9, 20, capCalendar);
check('상한∞: 24건 전부 실행', capInf.executedCandidates, 24);
check('상한∞: 소멸 0', capInf.droppedCandidates, 0);
checkArr('상한∞: 4종목 전부 매도', capInf.perPosition.map((p) => p.sells), [1, 1, 1, 1]);
for (let k = 0; k < CAP_CODES.length; k++) {
  const m = capMembers[k];
  const perPos = simulateConfigPolicy(
    m.s,
    m.bars,
    m.acute,
    { code: m.code, signalBar: 339, buyBar: 340, windowEnd: 360 },
    CONFIG_MASKS.C,
    20
  );
  checkTrue(`상한∞ vs C per-position: ${CAP_CODES[k]} 시뮬 성립`, perPos !== null);
  if (perPos) {
    checkClose(
      `상한∞ ≡ C 수익률 (${CAP_CODES[k]})`,
      capInf.perPosition[k].terminalReturn,
      perPos.terminalReturn,
      1e-15
    );
    check(`상한∞ ≡ C 매도횟수 (${CAP_CODES[k]})`, capInf.perPosition[k].sells, perPos.sells);
    checkClose(
      `상한∞ ≡ C 거래비용 (${CAP_CODES[k]})`,
      capInf.perPosition[k].costPaid,
      perPos.costPaid,
      1e-15
    );
    checkClose(`상한∞ ≡ C MDD (${CAP_CODES[k]})`, capInf.perPosition[k].mdd, perPos.mdd, 1e-15);
  }
  checkClose(
    `상한∞ 최종수익률 절대 골든 (${CAP_CODES[k]})`,
    capInf.perPosition[k].terminalReturn,
    GOLD_SOLD_RETURN,
    1e-12
  );
}

// (d) sellLog out-param은 수치 결과를 바꾸지 않는다(관측용 순수 부가)
{
  const m = capMembers[0];
  const pos = { code: m.code, signalBar: 339, buyBar: 340, windowEnd: 360 };
  const a = simulateConfigPolicy(m.s, m.bars, m.acute, pos, CONFIG_MASKS.C, 20);
  const log: Array<{ code: string; sellBar: number; sellPrice: number }> = [];
  const b = simulateConfigPolicy(m.s, m.bars, m.acute, pos, CONFIG_MASKS.C, 20, log);
  checkTrue('sellLog 유무와 무관하게 결과 동일', JSON.stringify(a) === JSON.stringify(b));
  check('sellLog 1건 적재', log.length, 1);
  check('sellLog bar 351', log[0]?.sellBar, 351);
}

// ===========================================================================
console.log('§8 Phase 0-C 절충안 구성 — 규칙 집합 1:1 불변식');
// ===========================================================================

// ── 8-1. 탐색 대상/제외 목록 (지시문 사전 고정) ──
checkArr('꼬리 방어 후보 3종 고정', [...TAIL_DEFENSE_RULES], [
  'daily-crash',
  'swing-low-break',
  'stop-loss',
]);
checkArr('포화 제외 3종 고정', [...SATURATION_EXCLUDED_RULES], [
  'dead-cross',
  'trend-break',
  'long-decline',
]);
checkArr('절충안 구성 id 6종·순서 고정', [...COMPROMISE_CONFIG_IDS], [
  'CMIN_DC',
  'CMIN_SLB',
  'CMIN_STOP',
  'CMIN_DC_STOP',
  'CMIN_SLB_STOP',
  'CMIN_DC_SLB',
]);
checkArr('전체 구성 = 원 3종 + 절충안 6종(순서 고정)', [...PHASE0_ALL_CONFIG_IDS], [
  'C',
  'CMIN',
  'CMID',
  'CMIN_DC',
  'CMIN_SLB',
  'CMIN_STOP',
  'CMIN_DC_STOP',
  'CMIN_SLB_STOP',
  'CMIN_DC_SLB',
]);
check('전체 구성 9종', PHASE0_ALL_CONFIG_IDS.length, 3 + 6);

// ── 8-2. 구성별 규칙 id 집합 1:1 (손으로 적은 기대 배열) ──
const CMIN_BASE = [
  'S1_RUNUP_21D_100',
  'S2_RUNUP_5D_40',
  'S3_LIMIT_UP',
  'S4_GAP_BEAR_VOLUME',
  'S5_APP_PROXY',
  'S6_CRASH_5_VOLUME_2X',
  'climax-top',
  'distribution-high',
];
const EXPECTED_COMPROMISE: Record<Phase0CompromiseId, string[]> = {
  CMIN_DC: [...CMIN_BASE, 'daily-crash'],
  CMIN_SLB: [...CMIN_BASE, 'swing-low-break'],
  CMIN_STOP: [...CMIN_BASE, 'stop-loss'],
  CMIN_DC_STOP: [...CMIN_BASE, 'daily-crash', 'stop-loss'],
  CMIN_SLB_STOP: [...CMIN_BASE, 'swing-low-break', 'stop-loss'],
  CMIN_DC_SLB: [...CMIN_BASE, 'daily-crash', 'swing-low-break'],
};
const EXPECTED_ADDED: Record<Phase0CompromiseId, string[]> = {
  CMIN_DC: ['daily-crash'],
  CMIN_SLB: ['swing-low-break'],
  CMIN_STOP: ['stop-loss'],
  CMIN_DC_STOP: ['daily-crash', 'stop-loss'],
  CMIN_SLB_STOP: ['swing-low-break', 'stop-loss'],
  CMIN_DC_SLB: ['daily-crash', 'swing-low-break'],
};
checkArr('C′-min 기저 배열이 §1과 동일', [...CONFIG_RULE_SETS.CMIN], CMIN_BASE);
for (const id of COMPROMISE_CONFIG_IDS) {
  checkArr(`${id} 규칙 집합 1:1`, [...COMPROMISE_RULE_SETS[id]], EXPECTED_COMPROMISE[id]);
  checkArr(`${id} 추가 규칙 1:1`, [...COMPROMISE_ADDED_RULES[id]], EXPECTED_ADDED[id]);
  check(
    `${id} 규칙 수 = 8 + 추가 ${EXPECTED_ADDED[id].length}`,
    COMPROMISE_RULE_SETS[id].length,
    8 + EXPECTED_ADDED[id].length
  );
  check(
    `${id} 마스크 popcount = 규칙 수`,
    popcount(ALL_CONFIG_MASKS[id]),
    COMPROMISE_RULE_SETS[id].length
  );
  check(`${id}: C′-min ⊂ 구성`, (ALL_CONFIG_MASKS[id] & CONFIG_MASKS.CMIN) >>> 0, CONFIG_MASKS.CMIN >>> 0);
  check(`${id}: anyConfigMask ≡ ALL_CONFIG_MASKS`, anyConfigMask(id), ALL_CONFIG_MASKS[id]);
  checkArr(`${id}: ALL_CONFIG_RULE_SETS 경유도 동일`, [...ALL_CONFIG_RULE_SETS[id]], EXPECTED_COMPROMISE[id]);
  checkTrue(`${id}: 라벨 존재`, typeof ALL_CONFIG_LABEL[id] === 'string' && ALL_CONFIG_LABEL[id].length > 0);
  // 포화 3종은 어떤 절충안에도 들어가지 않는다(탐색 대상 제외 — 사전 고정)
  for (const off of SATURATION_EXCLUDED_RULES) {
    check(`${id}: 포화 제외 ${off} 미포함`, (ALL_CONFIG_MASKS[id] & bit(off)) >>> 0, 0);
  }
  // 추가되는 규칙은 전부 현행 13종(C) 안에 있다 — 새로 만든 규칙이 아니다
  check(
    `${id}: 추가 규칙은 전부 C 안에 있음`,
    (ALL_CONFIG_MASKS[id] & ~CONFIG_MASKS.CMIN & ~CONFIG_MASKS.C) >>> 0,
    0
  );
}
// 조합 구성 = 단일 구성의 합집합
check(
  'CMIN_DC_STOP = CMIN_DC ∪ CMIN_STOP',
  ALL_CONFIG_MASKS.CMIN_DC_STOP,
  (ALL_CONFIG_MASKS.CMIN_DC | ALL_CONFIG_MASKS.CMIN_STOP) >>> 0
);
check(
  'CMIN_SLB_STOP = CMIN_SLB ∪ CMIN_STOP',
  ALL_CONFIG_MASKS.CMIN_SLB_STOP,
  (ALL_CONFIG_MASKS.CMIN_SLB | ALL_CONFIG_MASKS.CMIN_STOP) >>> 0
);
check(
  'CMIN_DC_SLB = CMIN_DC ∪ CMIN_SLB',
  ALL_CONFIG_MASKS.CMIN_DC_SLB,
  (ALL_CONFIG_MASKS.CMIN_DC | ALL_CONFIG_MASKS.CMIN_SLB) >>> 0
);
// 원 3구성은 그대로 보존된다(회귀 가드)
check('ALL_CONFIG_MASKS.C ≡ CONFIG_MASKS.C', ALL_CONFIG_MASKS.C, CONFIG_MASKS.C);
check('ALL_CONFIG_MASKS.CMIN ≡ CONFIG_MASKS.CMIN', ALL_CONFIG_MASKS.CMIN, CONFIG_MASKS.CMIN);
check('ALL_CONFIG_MASKS.CMID ≡ CONFIG_MASKS.CMID', ALL_CONFIG_MASKS.CMID, CONFIG_MASKS.CMID);
check('configMask("C") ≡ anyConfigMask("C")', configMask('C'), anyConfigMask('C'));
// 9구성 마스크가 전부 서로 다르다(중복 정의 방지)
check(
  '9구성 마스크 전부 상이',
  new Set(PHASE0_ALL_CONFIG_IDS.map((id) => ALL_CONFIG_MASKS[id])).size,
  9
);
// C′-mid와 절충안은 서로 포함관계가 아니다(설계 확인: mid는 이동평균 계열, 절충안은 꼬리 방어)
check('CMIN_STOP ⊄ C′-mid', (ALL_CONFIG_MASKS.CMIN_STOP & ~CONFIG_MASKS.CMID) >>> 0, bit('stop-loss') >>> 0);

// ===========================================================================
console.log('§9 상한 적용판 ≤ 원판 — 절충안 마스크에서도 성립하는가');
// ===========================================================================
//
// §7-5와 같은 합성 4종목판을 절충안 마스크로 다시 돌린다.
// 350봉에서 켜지는 비트(§5 손계산): stop-loss·trend-break·daily-crash·weinstein·ma120·
// swing-low·S6. 따라서 절충안별 그날 발동 규칙 수(종목당)는
//   CMIN        : S6                       = 1
//   CMIN_DC     : S6 + daily-crash          = 2
//   CMIN_SLB    : S6 + swing-low-break      = 2
//   CMIN_STOP   : S6 + stop-loss            = 2
//   CMIN_DC_STOP: S6 + daily-crash + stop   = 3
//   CMIN_SLB_STOP: S6 + swing-low + stop    = 3
//   CMIN_DC_SLB : S6 + daily-crash + swing  = 3
const PER_STOCK_FIRE: Record<string, number> = {
  CMIN: 1,
  CMIN_DC: 2,
  CMIN_SLB: 2,
  CMIN_STOP: 2,
  CMIN_DC_STOP: 3,
  CMIN_SLB_STOP: 3,
  CMIN_DC_SLB: 3,
};
for (const id of ['CMIN', ...COMPROMISE_CONFIG_IDS] as const) {
  const mask = ALL_CONFIG_MASKS[id];
  const uncapped = simulateCappedPortfolio(capMembers, mask, 1e9, 20, capCalendar);
  const capped3 = simulateCappedPortfolio(capMembers, mask, 3, 20, capCalendar);
  const capped0 = simulateCappedPortfolio(capMembers, mask, 0, 20, capCalendar);

  check(
    `${id}: 발동 후보 = 4종목 × ${PER_STOCK_FIRE[id]}규칙`,
    uncapped.totalCandidates,
    4 * PER_STOCK_FIRE[id]
  );
  check(`${id}: 상한∞은 전부 실행`, uncapped.executedCandidates, uncapped.totalCandidates);
  check(`${id}: 상한∞ 소멸 0`, uncapped.droppedCandidates, 0);
  // 핵심 불변식 ①: 상한판 실행 알림 수 ≤ 원판(상한 없음) 실행 알림 수
  checkTrue(
    `${id}: 상한3 실행 ≤ 상한∞ 실행`,
    capped3.executedCandidates <= uncapped.executedCandidates
  );
  // 핵심 불변식 ②: 실행 수는 예산 × 캘린더일을 넘을 수 없다
  checkTrue(
    `${id}: 상한3 실행 ≤ 3 × 캘린더일`,
    capped3.executedCandidates <= 3 * capped3.calendarDays
  );
  // 핵심 불변식 ③: 실행 + 소멸 = 발동(회계 항등식)
  check(
    `${id}: 상한3 실행+소멸 = 발동`,
    capped3.executedCandidates + capped3.droppedCandidates,
    capped3.totalCandidates
  );
  // 핵심 불변식 ④: 포지션별 매도 횟수도 상한판이 원판 이하
  let sellsMonotone = true;
  for (let k = 0; k < capped3.perPosition.length; k++) {
    if (capped3.perPosition[k].sells > uncapped.perPosition[k].sells) sellsMonotone = false;
  }
  checkTrue(`${id}: 상한3 종목별 매도 ≤ 상한∞`, sellsMonotone);
  check(`${id}: 상한0은 아무것도 실행하지 않음`, capped0.executedCandidates, 0);
  checkArr(
    `${id}: 상한0 매도 0건`,
    capped0.perPosition.map((p) => p.sells),
    [0, 0, 0, 0]
  );
  // 예산을 올리면 실행 수는 단조 증가(감소하지 않는다)
  let budgetMonotone = true;
  let prevExec = -1;
  for (const b of [0, 1, 2, 3, 4, 6, 8, 12, 1e9]) {
    const r = simulateCappedPortfolio(capMembers, mask, b, 20, capCalendar);
    if (r.executedCandidates < prevExec) budgetMonotone = false;
    if (r.executedCandidates > r.totalCandidates) budgetMonotone = false;
    prevExec = r.executedCandidates;
  }
  checkTrue(`${id}: 예산↑ → 실행 알림 수 단조 비감소`, budgetMonotone);
}

// 구성이 커지면 발동 알림도 늘어난다(부분집합 단조성) — CMIN ⊂ CMIN_DC ⊂ CMIN_DC_STOP
{
  const a = simulateCappedPortfolio(capMembers, ALL_CONFIG_MASKS.CMIN, 1e9, 20, capCalendar);
  const b = simulateCappedPortfolio(capMembers, ALL_CONFIG_MASKS.CMIN_DC, 1e9, 20, capCalendar);
  const c = simulateCappedPortfolio(capMembers, ALL_CONFIG_MASKS.CMIN_DC_STOP, 1e9, 20, capCalendar);
  checkTrue('부분집합 단조: CMIN ≤ CMIN_DC 발동', a.totalCandidates <= b.totalCandidates);
  checkTrue('부분집합 단조: CMIN_DC ≤ CMIN_DC_STOP 발동', b.totalCandidates <= c.totalCandidates);
  check('CMIN 발동 4건(종목당 S6 1건)', a.totalCandidates, 4);
  check('CMIN_DC 발동 8건', b.totalCandidates, 8);
  check('CMIN_DC_STOP 발동 12건', c.totalCandidates, 12);
}

// 절충안 상한3의 실행 대상 손계산: daily-crash(critical)이 warning S6보다 먼저 예산을 가져간다.
{
  const r = simulateCappedPortfolio(capMembers, ALL_CONFIG_MASKS.CMIN_DC, 3, 20, capCalendar);
  check('CMIN_DC 상한3: 실행 3건', r.executedCandidates, 3);
  check('CMIN_DC 상한3: 소멸 5건', r.droppedCandidates, 5);
  checkArr(
    'CMIN_DC 상한3: critical(daily-crash) 우선 → A01·A02·A03만 매도',
    r.perPosition.map((p) => p.sells),
    [1, 1, 1, 0]
  );
  checkArr('CMIN_DC 상한3: 매도 종목', r.sellLog.map((x) => x.code).sort(), ['A01', 'A02', 'A03']);
}
// C′-min 단독은 전부 warning(S6)이라 코드 오름차순으로 예산이 배분된다.
{
  const r = simulateCappedPortfolio(capMembers, ALL_CONFIG_MASKS.CMIN, 3, 20, capCalendar);
  check('CMIN 상한3: 실행 3건', r.executedCandidates, 3);
  checkArr(
    'CMIN 상한3: warning 동률 → 종목코드 오름차순 A01·A02·A03',
    r.perPosition.map((p) => p.sells),
    [1, 1, 1, 0]
  );
}

// ===========================================================================
console.log('');
console.log(`통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);
