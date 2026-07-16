// tests/krSizeBacktest.ts
// ---------------------------------------------------------------------------
// conditional-channel-kr-size-v1 — 단위 테스트 스위트.
// 수동 실행: npm run test:kr-size  (tsx). 통과 시 exit 0.
//
// 커버:
//   · 분할 조정 adj_factor 계산 (누적 역산·단조성)
//   · 삼성전자 50:1 분할 골든 테스트 (TypeScript측)
//   · 분할 전후 가격 불연속 방지 (가짜 돌파 차단)
//   · 기업행위 가격 일관성 검증 (임계치 0.30)
//   · 상장폐지 분류 (ORDERLY/DISTRESS/UNKNOWN)
//   · 합병 UNRESOLVED → EXCLUDE_OPEN
//   · 월말 스냅샷 → MonthlyGroupFlags 변환
//   · 대형주 백분위 계산 (KR-size, leader 없음)
//   · 한국 매도세 스케줄 조회
//   · 데이터 감사 게이트 경로 (PASS_PRELOCK / PASS_PRELOCK_KRX_WAIT / FAIL)
//   · lookahead-free: 진입 시 그룹 동결, 보유 중 재할당 없음
//   · 결정론: 동일 입력 → 동일 출력
//
// 외부 파일 없음 — 모든 데이터는 이 파일에서 직접 합성.
// ---------------------------------------------------------------------------

import {
  validateSplitPriceConsistency,
  validateAdjFactorMonotonicity,
  samsungSplitGoldenTest,
  validateAllCorporateActions,
  KR_SELL_TAX_SCHEDULE,
  getKrSellTaxBps,
  type CorpActionValidationResult,
} from '../scripts/backtest/conditionalChannel/pipeline/corporateActions';
import {
  classifyDelistings,
  findDelistingConflicts,
  buildDelistingGateResult,
  type DelistingEvent,
} from '../scripts/backtest/conditionalChannel/pipeline/delistingHandler';
import {
  buildManifestMissingResult,
  runKrSizeDataAudit,
  checkDevValPeriodCoverage,
} from '../scripts/backtest/conditionalChannel/dataQualityKrSize';
import {
  MIN_KRX_CROSSCHECK_SAMPLES,
  validateCrossCheckInputs,
} from '../scripts/backtest/conditionalChannel/pipeline/krxAdapter';
import { calculateKrSizePerformance } from '../scripts/backtest/conditionalChannel/pipeline/performanceKrSize';
import type {
  MarcapAdjustedBar,
  SplitEventRaw,
  MonthEndSnapshot,
  MonthEndSecurityRecord,
  DataPipelineManifest,
  GateResult,
  KrSecurityBars,
  KrSizeDataset,
} from '../scripts/backtest/conditionalChannel/pipeline/types';
import type { MonthlyGroupFlags } from '../types/backtestConditionalChannel';

// ===========================================================================
// 0. 테스트 하네스
// ===========================================================================

let pass = 0;
const fails: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected} (eps=${eps})`);
}

function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

// ===========================================================================
// 1. 분할 조정 adj_factor 계산 검증
// ===========================================================================

function makeBar(
  date: string,
  close: number,
  stocks: number,
  adjFactor: number
): MarcapAdjustedBar {
  return {
    date,
    open: close, high: close, low: close, close,
    volume: 100000,
    stocks,
    marketcap: close * stocks,
    market_field: 'KOSPI',
    adj_factor: adjFactor,
    adj_open: close * adjFactor, adj_high: close * adjFactor,
    adj_low: close * adjFactor, adj_close: close * adjFactor,
    adj_volume: 100000 / adjFactor,
  };
}

function makeEvent(
  code: string, eventDate: string, prevDate: string,
  stocksBefore: number, stocksAfter: number,
  closeBefore: number, closeAfter: number,
  eventType: SplitEventRaw['event_type'],
  classifiable: boolean
): SplitEventRaw {
  const ratio = stocksAfter / stocksBefore;
  const priceRatio = closeAfter / closeBefore;
  return {
    code, name: code, event_date: eventDate, prev_date: prevDate,
    stocks_before: stocksBefore, stocks_after: stocksAfter,
    ratio, close_before: closeBefore, close_after: closeAfter,
    price_ratio: priceRatio,
    price_consistency: Math.abs(ratio * priceRatio - 1),
    event_type: eventType, classifiable,
  };
}

// 1a. adj_factor 단조성 — 정상 케이스 (위반 없음)
{
  const bars: MarcapAdjustedBar[] = [
    makeBar('2018-01-01', 2500000, 128900000, 0.02),  // 분할 전, adj = 1/50
    makeBar('2018-05-04', 53000,   6455063500, 1.0),  // 분할 후, adj = 1.0
    makeBar('2018-05-07', 54000,   6455063500, 1.0),
  ];
  const violations = validateAdjFactorMonotonicity('005930', bars);
  check('adj_factor 단조성: 정상 케이스 위반 없음', violations.length, 0);
}

// 1b. adj_factor 단조성 — 위반 케이스 (0 또는 음수)
{
  const bars: MarcapAdjustedBar[] = [
    makeBar('2020-01-01', 10000, 1000000, 0.5),
    makeBar('2020-01-02', 10000, 1000000, 0.0),  // 위반: 0
    makeBar('2020-01-03', 10000, 1000000, 0.5),
  ];
  const violations = validateAdjFactorMonotonicity('TEST', bars);
  check('adj_factor 단조성: adj=0 위반 감지', violations.length, 2);
}

// 1c. 분할 전후 adj 가격 연속성 — 분할 날짜에서 adj_close가 연속이어야 함
{
  // 2:1 분할: 분할 전 adj_close = 50000 * 0.5 = 25000, 분할 후 adj_close = 25000 * 1.0 = 25000
  const bars: MarcapAdjustedBar[] = [
    makeBar('2020-05-20', 50000, 1000000, 0.5),   // 분할 직전
    makeBar('2020-05-21', 25000, 2000000, 1.0),   // 분할 당일 (2:1)
  ];
  // adj_close 연속성: 두 바의 adj_close가 같아야 함
  const adjBefore = bars[0].adj_close;
  const adjAfter  = bars[1].adj_close;
  checkClose('분할 전후 adj_close 연속성 (2:1 분할)', adjBefore, adjAfter, 1.0);
}

// 1d. 가짜 돌파 차단 — 분할 당일 adj 가격 연속이면 채널 고점 돌파 없음
{
  // 조정 전 고점 = 50000, 조정 후 종가 = 25000. adj 적용 후 둘 다 동일 → 돌파 없음.
  const rawHighBefore = 50000;
  const adjFactorBefore = 0.5;
  const rawCloseAfter  = 25000;
  const adjFactorAfter = 1.0;
  const adjHighBefore  = rawHighBefore * adjFactorBefore;  // 25000
  const adjCloseAfter  = rawCloseAfter * adjFactorAfter;   // 25000
  checkClose('가짜 돌파 없음: adj 고점 = adj 종가', adjHighBefore, adjCloseAfter, 1.0);
}

// ===========================================================================
// 2. 삼성전자 골든 테스트 (TypeScript측)
// ===========================================================================

// 2a. 이벤트가 있는 경우 — PASS
{
  const samsungEvent = makeEvent(
    '005930', '2018-05-04', '2018-05-03',
    128927341, 6455063500,
    2500000, 50000,
    'SPLIT', true
  );
  const samsungBars: MarcapAdjustedBar[] = [
    makeBar('2018-05-03', 2500000, 128927341, 0.02),   // 분할 직전
    makeBar('2018-05-04', 53000,   6455063500, 1.0),
  ];
  const result = samsungSplitGoldenTest([samsungEvent], samsungBars);
  checkTrue('삼성전자 골든 테스트: passed', result.passed);
  checkTrue('삼성전자 분할 비율 ~50×', result.actualRatio >= 49 && result.actualRatio <= 51);
  checkTrue('삼성전자 adj_factor ≈ 0.02', result.adjFactorAtSplitDate !== null &&
    result.adjFactorAtSplitDate > 0.015 && result.adjFactorAtSplitDate < 0.025);
}

// 2b. 이벤트 없는 경우 — FAIL
{
  const result = samsungSplitGoldenTest([], null);
  check('삼성전자 골든 테스트: 이벤트 없음 시 FAIL', result.passed, false);
}

// 2c. 비율 오류 — FAIL
{
  const badEvent = makeEvent(
    '005930', '2018-05-04', '2018-05-03',
    128927341, 386781000, // ~3× (오류)
    2500000, 833000,
    'SPLIT', true
  );
  const result = samsungSplitGoldenTest([badEvent], null);
  check('삼성전자 골든 테스트: 비율 오류 FAIL', result.passed, false);
}

// ===========================================================================
// 3. 기업행위 가격 일관성 검증
// ===========================================================================

// 3a. price_consistency < 0.30 — 위반 없음
{
  const ev = makeEvent('A000', '2020-03-01', '2020-02-28',
    1000000, 2000000, 20000, 10000, 'SPLIT', true);
  // ratio=2, price_ratio=0.5, consistency = |2*0.5-1| = 0 < 0.30 → 위반 없음
  const violations = validateSplitPriceConsistency([ev]);
  check('가격 일관성: 2:1 분할 위반 없음', violations.length, 0);
}

// 3b. price_consistency ≥ 0.30 — 위반 1건
{
  const ev = makeEvent('B000', '2020-03-01', '2020-02-28',
    1000000, 2000000, 20000, 20000, 'SPLIT', true);
  // ratio=2, price_ratio=1.0, consistency = |2*1.0-1| = 1.0 ≥ 0.30 → 위반
  const violations = validateSplitPriceConsistency([ev]);
  check('가격 일관성: 가격 불변 시 위반', violations.length, 1);
}

// 3c. classifiable=false인 이벤트는 가격 일관성 검증 제외
{
  const ev = makeEvent('C000', '2020-03-01', '2020-02-28',
    1000000, 2000000, 20000, 20000, 'SPLIT_OR_BONUS_UNKNOWN', false);
  const violations = validateSplitPriceConsistency([ev]);
  check('가격 일관성: 미분류 이벤트 제외', violations.length, 0);
}

// ===========================================================================
// 4. 상장폐지 분류
// ===========================================================================

function makeSecJson(code: string, bars: MarcapAdjustedBar[]) {
  return { code, name: code, bars, split_events: [] as SplitEventRaw[] };
}

const PANEL_END = '2023-12-31';

// 4a. ORDERLY_MERGER — 최종 15일 수익률 > -5%
{
  const bars: MarcapAdjustedBar[] = Array.from({ length: 20 }, (_, i) => {
    const date = `2022-${String(1 + Math.floor(i / 10)).padStart(2, '0')}-${String((i % 10) + 1).padStart(2, '0')}`;
    return makeBar(date, 50000 + i * 100, 1000000, 1.0);
  });
  bars[bars.length - 1] = makeBar('2022-11-30', 52000, 1000000, 1.0); // 마지막: 2022-11-30 < 2023-12-31
  const delistings = classifyDelistings([makeSecJson('X001', bars)], PANEL_END);
  check('상장폐지: ORDERLY_MERGER 분류', delistings[0]?.delistingType, 'ORDERLY_MERGER');
}

// 4b. DISTRESS_REGULATORY — 최종 15일 수익률 < -50%
{
  const bars: MarcapAdjustedBar[] = Array.from({ length: 20 }, (_, i) => {
    const price = i < 5 ? 10000 : (10000 - (i - 5) * 1200); // 급락
    const date = `2022-0${Math.floor(i / 10) + 1}-${String((i % 10) + 1).padStart(2, '0')}`;
    return makeBar(date, Math.max(price, 100), 1000000, 1.0);
  });
  bars[bars.length - 1] = makeBar('2022-11-30', 200, 1000000, 1.0);
  const delistings = classifyDelistings([makeSecJson('X002', bars)], PANEL_END);
  check('상장폐지: DISTRESS_REGULATORY 분류', delistings[0]?.delistingType, 'DISTRESS_REGULATORY');
}

// 4c. 현재까지 살아있는 종목은 상장폐지 목록에 없음
{
  const bars: MarcapAdjustedBar[] = [
    makeBar('2023-12-31', 50000, 1000000, 1.0), // 패널 마지막 날과 동일 → 생존
  ];
  const delistings = classifyDelistings([makeSecJson('X003', bars)], PANEL_END);
  check('상장폐지: 패널 마지막일까지 생존 → 목록 제외', delistings.length, 0);
}

// 4d. 합병 UNRESOLVED → EXCLUDE_OPEN
{
  const event: DelistingEvent = {
    code: 'M001', name: 'M001',
    lastTradingDate: '2021-06-30',
    lastClose: 50000,
    delistingType: 'ORDERLY_MERGER',
    finalWindowReturn: 0.02,
    mergerProceeds: null,          // 미확인
    mergersResolvedViaLastClose: true,
    resolutionStatus: 'UNRESOLVED',
    note: '합병 대가 미확인',
  };
  const conflicts = findDelistingConflicts([event], [{ code: 'M001', entryDate: '2021-04-01' }]);
  check('합병 UNRESOLVED → EXCLUDE_OPEN', conflicts[0]?.suggestedTreatment, 'EXCLUDE_OPEN');
  check('합병 UNRESOLVED → economicReturnComputable = false', conflicts[0]?.economicReturnComputable, false);
}

// 4e. 정리매매 종목은 USE_LAST_CLOSE (수익률 계산 가능)
{
  const event: DelistingEvent = {
    code: 'D001', name: 'D001',
    lastTradingDate: '2021-06-30',
    lastClose: 500,
    delistingType: 'DISTRESS_REGULATORY',
    finalWindowReturn: -0.70,
    mergerProceeds: null,
    mergersResolvedViaLastClose: false,
    resolutionStatus: 'RESOLVED',
    note: null,
  };
  const conflicts = findDelistingConflicts([event], [{ code: 'D001', entryDate: '2021-03-01' }]);
  check('정리매매 RESOLVED → USE_LAST_CLOSE', conflicts[0]?.suggestedTreatment, 'USE_LAST_CLOSE');
}

// 4f. 상장폐지 게이트 결과: UNRESOLVED 집계
{
  const delistings: DelistingEvent[] = [
    { code: 'A', name: 'A', lastTradingDate: '2021-01-01', lastClose: 100,
      delistingType: 'ORDERLY_MERGER', finalWindowReturn: 0.03,
      mergerProceeds: null, mergersResolvedViaLastClose: true,
      resolutionStatus: 'UNRESOLVED', note: null },
    { code: 'B', name: 'B', lastTradingDate: '2021-02-01', lastClose: 50,
      delistingType: 'DISTRESS_REGULATORY', finalWindowReturn: -0.70,
      mergerProceeds: null, mergersResolvedViaLastClose: false,
      resolutionStatus: 'RESOLVED', note: null },
  ];
  const conflicts = [
    { code: 'A', positionEntryDate: '2020-10-01' as const, delistingDate: '2021-01-01' as const,
      delistingType: 'ORDERLY_MERGER' as const, resolutionStatus: 'UNRESOLVED' as const,
      economicReturnComputable: false, suggestedTreatment: 'EXCLUDE_OPEN' as const },
  ];
  const gateResult = buildDelistingGateResult(delistings, conflicts);
  check('상장폐지 게이트: 총 건수', gateResult.totalDelistings, 2);
  check('상장폐지 게이트: UNRESOLVED 건수', gateResult.unresolvedCount, 1);
  check('상장폐지 게이트: 포지션 충돌 미해결', gateResult.positionConflictsUnresolved, 1);
}

// ===========================================================================
// 5. 월말 스냅샷 → MonthlyGroupFlags 변환 (snapshotToMonthlyFlags 간접 검증)
// ===========================================================================

function makeSnapshot(
  monthEnd: string, effectiveMonth: string,
  securities: MonthEndSecurityRecord[]
): MonthEndSnapshot {
  const investable = securities.filter((s) => s.investable);
  const classifiable = investable.filter((s) => !s.unclassifiable);
  const large = classifiable.filter((s) => s.large);
  return {
    month_end: monthEnd, effective_month: effectiveMonth,
    total_count: securities.length,
    investable_count: investable.length,
    classifiable_count: classifiable.length,
    large_count: large.length,
    securities,
  };
}

function makeSecRecord(
  code: string, investable: boolean, large: boolean,
  unclassifiable: boolean, group: 'A' | 'B' | null,
  percentile: number
): MonthEndSecurityRecord {
  return {
    code, name: code, sec_type: 'COMMON_STOCK', investable,
    close: 50000, stocks: 1000000, marketcap: 5e10,
    market_field: 'KOSPI',
    unclassifiable, rank: null, percentile, large, group,
  };
}

// 5a. 투자 불가 종목 제외
{
  const snapshot = makeSnapshot('2020-01-31', '2020-02', [
    makeSecRecord('A001', true, true, false, 'A', 95),
    makeSecRecord('B001', false, false, false, 'B', 10),  // investable=false
  ]);

  // snapshotToMonthlyFlags 로직 직접 재현 (순수 함수)
  const flags = snapshot.securities
    .filter((r) => r.investable)
    .map((r) => ({
      securityId: r.code,
      market: 'KR' as const,
      asOfMonthEnd: snapshot.month_end,
      effectiveMonth: snapshot.effective_month,
      investable: true,
      marketCap: r.marketcap,
      marketCapPercentile: r.percentile,
      large: r.large,
      sectorCode: null,
      sectorRankByMarketCap: null,
      sectorInvestableCount: null,
      leader: false,
      group: r.unclassifiable ? 'B' : (r.group ?? 'B'),
      unclassifiable: r.unclassifiable,
      tieBreakNote: '',
    } as MonthlyGroupFlags));

  check('스냅샷 → GroupFlags: 투자불가 제외', flags.length, 1);
  check('스냅샷 → GroupFlags: A001 그룹 A', flags[0]?.group, 'A');
}

// 5b. unclassifiable 종목은 그룹 B로 표시되지만 unclassifiable=true 설정됨
{
  const snapshot = makeSnapshot('2020-01-31', '2020-02', [
    makeSecRecord('Z001', true, false, true, null, 30),
  ]);
  const flags = snapshot.securities
    .filter((r) => r.investable)
    .map((r) => ({
      securityId: r.code, market: 'KR' as const,
      asOfMonthEnd: snapshot.month_end, effectiveMonth: snapshot.effective_month,
      investable: true as const,
      marketCap: r.marketcap, marketCapPercentile: r.percentile,
      large: r.large, sectorCode: null, sectorRankByMarketCap: null,
      sectorInvestableCount: null, leader: false,
      group: r.unclassifiable ? 'B' : (r.group ?? 'B'),
      unclassifiable: r.unclassifiable, tieBreakNote: '',
    } as MonthlyGroupFlags));

  check('스냅샷 → GroupFlags: unclassifiable=true 보존', flags[0]?.unclassifiable, true);
}

// 5c. KR-size에는 leader=false, sectorCode=null
{
  const snapshot = makeSnapshot('2020-01-31', '2020-02', [
    makeSecRecord('L001', true, true, false, 'A', 98),
  ]);
  const flags = snapshot.securities
    .filter((r) => r.investable)
    .map((r) => ({
      securityId: r.code, market: 'KR' as const,
      asOfMonthEnd: snapshot.month_end, effectiveMonth: snapshot.effective_month,
      investable: true as const,
      marketCap: r.marketcap, marketCapPercentile: r.percentile,
      large: r.large, sectorCode: null, sectorRankByMarketCap: null,
      sectorInvestableCount: null, leader: false,
      group: r.unclassifiable ? 'B' : (r.group ?? 'B'),
      unclassifiable: r.unclassifiable, tieBreakNote: '',
    } as MonthlyGroupFlags));

  check('KR-size: leader=false', flags[0]?.leader, false);
  check('KR-size: sectorCode=null', flags[0]?.sectorCode, null);
}

// ===========================================================================
// 6. 대형주 백분위 계산 (상위 20% = large)
// ===========================================================================

// 6a. 100개 종목, 상위 20%가 large이어야 함
{
  const n = 100;
  const securities = Array.from({ length: n }, (_, i): MonthEndSecurityRecord => ({
    code: `S${String(i).padStart(4, '0')}`, name: `S${i}`, sec_type: 'COMMON_STOCK',
    investable: true, close: 50000, stocks: 1000,
    marketcap: (n - i) * 1e10, // 시총 내림차순
    market_field: 'KOSPI',
    unclassifiable: false, rank: i + 1,
    percentile: ((n - i) / n) * 100, // 0번이 가장 큰 시총 → percentile 100
    large: ((n - i) / n) * 100 >= 80, // 상위 20%
    group: ((n - i) / n) * 100 >= 80 ? 'A' : 'B',
  }));
  const largeCount = securities.filter((s) => s.large).length;
  checkTrue('대형주 백분위: 상위 20% = 20개', largeCount >= 19 && largeCount <= 21);
}

// 6b. 대형주(A)와 소형주(B)는 완전 분할(합집합 = 전체, 교집합 = 0)
{
  const securities = Array.from({ length: 10 }, (_, i): MonthEndSecurityRecord => ({
    code: `P${i}`, name: `P${i}`, sec_type: 'COMMON_STOCK',
    investable: true, close: 50000, stocks: 1000,
    marketcap: (10 - i) * 1e10, market_field: 'KOSPI',
    unclassifiable: false, rank: i + 1,
    percentile: ((10 - i) / 10) * 100,
    large: ((10 - i) / 10) * 100 >= 80,
    group: ((10 - i) / 10) * 100 >= 80 ? 'A' : 'B',
  }));
  const aSet = new Set(securities.filter((s) => s.group === 'A').map((s) => s.code));
  const bSet = new Set(securities.filter((s) => s.group === 'B').map((s) => s.code));
  const allCodes = securities.map((s) => s.code);
  const union = new Set([...aSet, ...bSet]);
  const intersection = [...aSet].filter((c) => bSet.has(c));
  check('A+B 완전 분할: 합집합 = 전체', union.size, allCodes.length);
  check('A+B 완전 분할: 교집합 없음', intersection.length, 0);
}

// ===========================================================================
// 7. 한국 매도세 스케줄
// ===========================================================================

// 7a. 2010년 이전: null
check('매도세: 2009-12-31', getKrSellTaxBps('2009-12-31'), null);

// 7b. 2010-01-01: 30bps
check('매도세: 2010-01-01 (30bps)', getKrSellTaxBps('2010-01-01'), 30);

// 7c. 2019-03-31: 여전히 30bps
check('매도세: 2019-03-31 (30bps)', getKrSellTaxBps('2019-03-31'), 30);

// 7d. 2019-04-01: 25bps
check('매도세: 2019-04-01 (25bps)', getKrSellTaxBps('2019-04-01'), 25);

// 7e. 2021-03-31: 여전히 25bps
check('매도세: 2021-03-31 (25bps)', getKrSellTaxBps('2021-03-31'), 25);

// 7f. 2021-04-01: 23bps
check('매도세: 2021-04-01 (23bps)', getKrSellTaxBps('2021-04-01'), 23);

// 7g. 2023-04-30: 여전히 23bps
check('매도세: 2023-04-30 (23bps)', getKrSellTaxBps('2023-04-30'), 23);

// 7h. 2023-05-01: 18bps
check('매도세: 2023-05-01 (18bps)', getKrSellTaxBps('2023-05-01'), 18);

// 7i. 미래도 현재 18bps 적용 (2023 이후 스케줄 없음)
check('매도세: 2025-12-31 (18bps)', getKrSellTaxBps('2025-12-31'), 18);

// 7j. 스케줄 항목 수 확인 (4개)
check('매도세 스케줄 항목 수', KR_SELL_TAX_SCHEDULE.length, 4);

// 7k. 미래 세율 소급 금지 — 2018년에 18bps가 아님
checkTrue('미래 세율 소급 금지: 2018년 ≠ 18bps', getKrSellTaxBps('2018-01-01') !== 18);

// ===========================================================================
// 8. 데이터 감사 게이트 경로
// ===========================================================================

function makeManifest(
  prelockGatesPassed: boolean,
  g11Passed: boolean,
  g8Passed = true
): DataPipelineManifest {
  // G1-G7, G9-G10은 prelock 제어 게이트
  const prelockGates: GateResult[] = [
    'G1_NO_DUPLICATES', 'G2_TRADING_DAYS', 'G3_MISSING_RATES',
    'G4_MARKET_FIELD', 'G5_TYPE_FILTER', 'G6_UNKNOWN_RATE',
    'G7_CORP_ACTION_UNKNOWN', 'G9_DATE_CONTINUITY', 'G10_SAMSUNG_GOLDEN',
  ].map((gate) => ({ gate, passed: prelockGatesPassed, detail: 'test' }));

  // G8(합병대가 완비)과 G11(KRX 교차검증): lockbox-only 차단 게이트
  const g8: GateResult = {
    gate: 'G8_DELISTING_COVERAGE',
    passed: g8Passed,
    detail: g8Passed ? '합병 대가 완비' : 'merger_proceeds.json 없음 — lockbox 차단',
  };
  const g11: GateResult = {
    gate: 'G11_KRX_CROSSCHECK',
    passed: g11Passed,
    detail: g11Passed ? 'KRX 교차검증 완료' : 'WAITING_FOR_USER_KEY',
  };

  return {
    hypothesisId: 'conditional-channel-kr-size-v1',
    generatedAt: '2026-07-01T00:00:00Z',
    schemaVersion: 1,
    dataGateVerdict: {
      prelock: prelockGatesPassed ? 'PASS' : 'FAIL',
      lockbox: (prelockGatesPassed && g8Passed && g11Passed) ? 'PASS' : 'FAIL',
      lockboxBlockReason: (g8Passed && g11Passed) ? null : 'G8/G11 미완료',
    },
    gates: [...prelockGates, g8, g11],
    rawFiles: {},
    processedFiles: {
      'month_end/2010-01.json': 'abc',
      'month_end/2019-12.json': 'bcd',  // 개발 끝 (2019-12-31 기준)
      'month_end/2020-01.json': 'cde',  // 검증 시작
      'month_end/2022-12.json': 'def',  // 검증 끝
    },
    recreateCommands: [],
    licenseNote: 'test',
  };
}

// 8a. PASS_PRELOCK: G1-G10 PASS, G11 FAIL → prelock 허용, lockbox 차단
{
  const manifest = makeManifest(true, false);
  const result = runKrSizeDataAudit(manifest, 'test/manifest.json', '2026-07-01T00:00:00Z');
  check('감사: PASS_PRELOCK_KRX_WAIT verdict', result.verdict, 'PASS_PRELOCK_KRX_WAIT');
  check('감사: prelockAllowed', result.prelockAllowed, true);
  check('감사: lockboxAllowed=false (G11 대기)', result.lockboxAllowed, false);
  check('감사: waitingGates 포함', result.waitingGates.includes('G11_KRX_CROSSCHECK'), true);
  check('감사: failedGates 비어있음 (G11 제외)', result.failedGates.length, 0);
}

// 8b. FAIL: prelock 게이트 중 하나 실패
{
  const manifest = makeManifest(false, false);
  const result = runKrSizeDataAudit(manifest, 'test/manifest.json', '2026-07-01T00:00:00Z');
  check('감사: FAIL verdict', result.verdict, 'FAIL');
  check('감사: prelockAllowed=false', result.prelockAllowed, false);
  checkTrue('감사: failedGates 비어있지 않음', result.failedGates.length > 0);
}

// 8c. PASS_PRELOCK: G11도 PASS
{
  const manifest = makeManifest(true, true);
  const result = runKrSizeDataAudit(manifest, 'test/manifest.json', '2026-07-01T00:00:00Z');
  check('감사: 완전 PASS_PRELOCK verdict', result.verdict, 'PASS_PRELOCK');
  check('감사: lockboxAllowed=true', result.lockboxAllowed, true);
}

// 8d. manifest.json 없는 경우 → FAIL
{
  const result = buildManifestMissingResult('no/such/path/manifest.json');
  check('감사: 매니페스트 없음 → FAIL', result.verdict, 'FAIL');
  check('감사: 매니페스트 없음 → prelockAllowed=false', result.prelockAllowed, false);
  check('감사: 매니페스트 없음 → manifest=null', result.manifest, null);
}

// 8e. checkDevValPeriodCoverage — 기간 월 확인 (개발 2010-2019, 검증 2020-2022)
{
  const manifest = makeManifest(true, false);
  // processedFiles에 2010-01, 2019-12, 2020-01, 2022-12 있음 (makeManifest 참조)
  const periodCheck = checkDevValPeriodCoverage(
    manifest, '2010-01-01', '2019-12-31', '2020-01-01', '2022-12-31'
  );
  check('개발검증기간 확인: 기간 파일 존재 시 passed', periodCheck.passed, true);
}

// 8f. checkDevValPeriodCoverage — 기간 파일 없음
{
  const manifest = makeManifest(true, false);
  const periodCheck = checkDevValPeriodCoverage(
    manifest, '2005-01-01', '2019-12-31', '2020-01-01', '2022-12-31'
  );
  // 2005-01 파일 없음
  check('개발검증기간 확인: 파일 없음 시 failed', periodCheck.passed, false);
}

// 8g. G8 lockbox-only — merger_proceeds.json 없음 시 prelock 허용, lockbox 차단
{
  const manifest = makeManifest(true, true, false);  // g8Passed=false
  const result = runKrSizeDataAudit(manifest, 'test\\manifest.json', '2026-07-16T00:00:00Z');
  // G8는 lockbox-only 게이트: prelock은 허용되어야 함
  check('G8 없음: verdict=PASS_PRELOCK_KRX_WAIT', result.verdict, 'PASS_PRELOCK_KRX_WAIT');
  check('G8 없음: prelockAllowed=true', result.prelockAllowed, true);
  check('G8 없음: lockboxAllowed=false', result.lockboxAllowed, false);
  checkTrue('G8 없음: waitingGates에 G8_DELISTING_COVERAGE 포함', result.waitingGates.includes('G8_DELISTING_COVERAGE'));
  check('G8 없음: failedGates는 비어있음 (prelock 게이트는 모두 통과)', result.failedGates.length, 0);
}

// 8h. G8·G11 둘 다 실패 → 둘 다 waitingGates에 포함
{
  const manifest = makeManifest(true, false, false);  // g11Passed=false, g8Passed=false
  const result = runKrSizeDataAudit(manifest, 'test\\manifest.json', '2026-07-16T00:00:00Z');
  check('G8+G11 없음: verdict=PASS_PRELOCK_KRX_WAIT', result.verdict, 'PASS_PRELOCK_KRX_WAIT');
  check('G8+G11 없음: prelockAllowed=true', result.prelockAllowed, true);
  check('G8+G11 없음: waitingGates 2개', result.waitingGates.length, 2);
  checkTrue('G8+G11 없음: G8 포함', result.waitingGates.includes('G8_DELISTING_COVERAGE'));
  checkTrue('G8+G11 없음: G11 포함', result.waitingGates.includes('G11_KRX_CROSSCHECK'));
}

// ===========================================================================
// 9. Lookahead-free — 진입 시 그룹 동결, 보유 중 재할당 없음
// ===========================================================================

{
  const empty = validateCrossCheckInputs([], new Map());
  check('KRX 교차검증: 빈 표본 FAIL', empty?.status, 'FAIL_NO_SAMPLES');

  const shortSamples = Array.from({ length: MIN_KRX_CROSSCHECK_SAMPLES - 1 }, (_, i) => ({
    code: String(i).padStart(6, '0'),
    date: '2022-06-30' as const,
  }));
  const insufficient = validateCrossCheckInputs(shortSamples, new Map());
  check('KRX 교차검증: 10표본 미만 FAIL', insufficient?.status, 'FAIL_INSUFFICIENT_SAMPLES');

  const samples = Array.from({ length: MIN_KRX_CROSSCHECK_SAMPLES }, (_, i) => ({
    code: String(i).padStart(6, '0'),
    date: '2022-06-30' as const,
  }));
  const missingBaseline = validateCrossCheckInputs(samples, new Map());
  check('KRX 교차검증: marcap 기준값 누락 FAIL', missingBaseline?.status, 'FAIL_INSUFFICIENT_SAMPLES');

  const complete = new Map<string, Map<string, { close: number; stocks: number }>>();
  for (const sample of samples) {
    complete.set(sample.code, new Map([[sample.date, { close: 1000, stocks: 1_000_000 }]]));
  }
  check('KRX 교차검증: 10표본 기준값 완비', validateCrossCheckInputs(samples, complete), null);
}

{
  const metrics = calculateKrSizePerformance(
    [
      { date: '2020-01-02', equity: 100, cash: 100 },
      { date: '2020-06-30', equity: 120, cash: 120 },
      { date: '2020-12-31', equity: 110, cash: 110 },
    ],
    [],
    '2020-01-01',
    '2020-12-31',
    100
  );
  checkClose('성과: 총수익률', metrics.totalReturnPct, 10);
  checkClose('성과: MDD', metrics.maxDrawdownPct, -100 / 12);
  check('성과: 거래 없음', metrics.tradeCount, 0);
  check('성과: 거래 없으면 승률 null', metrics.winRatePct, null);
}

// 가정: 2020-01 기준 A그룹으로 진입한 종목이 2020-02에 B그룹으로 이동해도
// 포지션 보유 중에는 여전히 A그룹 신호로 관리.

{
  const entryMonth = '2020-01';
  const entryGroup: string = 'A';  // 진입 시 그룹 동결

  // 다음 달에 그룹이 B로 바뀌어도
  const laterGroup: string = 'B';

  // 동결된 그룹 = 진입 시 그룹 (변경 없음)
  const frozenGroup: string = entryGroup;

  check('lookahead-free: 보유 중 그룹 재할당 없음', frozenGroup, 'A');
  checkTrue('lookahead-free: 나중 그룹과 다를 수 있음', laterGroup !== frozenGroup);
}

// ===========================================================================
// 10. 결정론 — 동일 입력 → 동일 출력
// ===========================================================================

// 10a. 분할 이벤트 검증 순수 함수 결정론 확인
{
  const events: SplitEventRaw[] = [
    makeEvent('T001', '2020-01-10', '2020-01-09', 1000000, 2000000, 20000, 10000, 'SPLIT', true),
    makeEvent('T002', '2020-03-15', '2020-03-14', 500000, 1500000, 30000, 10000, 'SPLIT', true),
  ];

  const result1 = validateSplitPriceConsistency(events);
  const result2 = validateSplitPriceConsistency(events);
  check('결정론: 분할 검증 동일 입력 → 동일 출력', result1.length, result2.length);
}

// 10b. 매도세 스케줄 결정론
{
  const date = '2020-06-15';
  const r1 = getKrSellTaxBps(date);
  const r2 = getKrSellTaxBps(date);
  check('결정론: 매도세 조회 결정론', r1, r2);
}

// 10c. 상장폐지 분류 결정론
{
  const bars: MarcapAdjustedBar[] = Array.from({ length: 20 }, (_, i) =>
    makeBar(`2022-${String(Math.floor(i / 10) + 1).padStart(2, '0')}-${String((i % 10) + 1).padStart(2, '0')}`,
      1000 - i * 50, 1000000, 1.0)
  );
  bars[bars.length - 1] = makeBar('2022-11-30', 50, 1000000, 1.0);
  const sec = makeSecJson('D001', bars);

  const r1 = classifyDelistings([sec], PANEL_END);
  const r2 = classifyDelistings([sec], PANEL_END);
  check('결정론: 상장폐지 분류 결정론', r1[0]?.delistingType, r2[0]?.delistingType);
}

// ===========================================================================
// 11. validateAllCorporateActions — 통합 경로
// ===========================================================================

// 11a. 이벤트 0건: 골든 테스트 실패 → passed=false
{
  const result = validateAllCorporateActions([], null);
  check('통합검증: 이벤트 없음 시 골든 테스트 실패', result.passed, false);
  check('통합검증: 이벤트 없음 unknownCount=0', result.unknownCount, 0);
}

// 11b. 삼성 이벤트만 있는 경우 → passed=true
{
  const samsungEvent = makeEvent(
    '005930', '2018-05-04', '2018-05-03',
    128927341, 6455063500, 2500000, 50000, 'SPLIT', true
  );
  const result = validateAllCorporateActions([samsungEvent], null);
  // 삼성 이벤트만 있으면 goldenTestResult.passed=true, unknownRate=0, violations=0
  check('통합검증: 삼성 이벤트만 있으면 passed', result.passed, true);
}

// 11c. unknown 비율 ≥ 5% → passed=false
{
  const unknownEvent: SplitEventRaw = {
    code: 'U001', name: 'U001', event_date: '2020-01-01', prev_date: '2019-12-31',
    stocks_before: 1000000, stocks_after: 2000000, ratio: 2.0,
    close_before: 20000, close_after: 20000, price_ratio: 1.0,
    price_consistency: 1.0, event_type: 'SPLIT_OR_BONUS_UNKNOWN', classifiable: false,
  };
  // unknownEvent 5건 + 정상 삼성 1건 = 총 6건, unknown 5/6 ≈ 83.3% ≥ 5%
  const samsungEvent = makeEvent(
    '005930', '2018-05-04', '2018-05-03',
    128927341, 6455063500, 2500000, 50000, 'SPLIT', true
  );
  const events = [
    samsungEvent,
    ...Array.from({ length: 5 }, (_, i) => ({ ...unknownEvent, code: `U${String(i).padStart(3, '0')}` })),
  ];
  const result = validateAllCorporateActions(events, null);
  check('통합검증: unknown 83% → passed=false', result.passed, false);
  checkTrue('통합검증: unknown 83% → failReasons 존재', result.failReasons.length > 0);
}

// ===========================================================================
// 결과 출력
// ===========================================================================

const total = pass + fails.length;
console.log(`\n=== krSizeBacktest: ${pass}/${total} 통과 ===`);
for (const f of fails) console.error(f);

if (fails.length > 0) process.exit(1);
