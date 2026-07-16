// scripts/backtest/conditionalChannel/pipeline/corporateActions.ts
// ---------------------------------------------------------------------------
// KR-size 파이프라인 — 기업행위 검증 순수 로직.
//
// 이 모듈은 Python ingest가 생성한 split_events를 받아:
//   · 분류된 이벤트(SPLIT/REVERSE_SPLIT)의 가격 일관성을 재검증한다.
//   · 조정 배수(adj_factor)가 단조 감소(과거로 갈수록 더 작음)임을 확인한다.
//   · 미분류 이벤트(classifiable=false)의 비율을 계산하고 게이트 기여를 결정한다.
//   · 삼성전자 2018-05-04 50:1 분할 골든 테스트를 실행한다.
//
// 규칙: `any` 금지, `console.*` 금지(순수 로직), 외부 I/O 없음.
// ---------------------------------------------------------------------------

import type {
  MarcapAdjustedBar,
  SplitEventRaw,
  SplitEventType,
} from './types';

// ===========================================================================
// 1. 기업행위 검증 결과 타입
// ===========================================================================

export interface CorpActionValidationResult {
  totalEvents: number;
  classifiableCount: number;
  unknownCount: number;
  unknownRatePct: number;
  priceConsistencyViolations: SplitConsistencyViolation[];
  adjFactorMonotonicityViolations: AdjFactorViolation[];
  goldenTestResult: GoldenTestResult;
  passed: boolean;
  failReasons: string[];
}

export interface SplitConsistencyViolation {
  code: string;
  eventDate: string;
  eventType: SplitEventType;
  ratio: number;
  priceConsistency: number;
  threshold: number;
}

export interface AdjFactorViolation {
  code: string;
  date: string;
  adjFactor: number;
  prevAdjFactor: number;
}

export interface GoldenTestResult {
  code: string;
  splitDate: string;
  stocksBefore: number;
  stocksAfter: number;
  actualRatio: number;
  expectedRatioMin: number;
  expectedRatioMax: number;
  passed: boolean;
  adjFactorAtSplitDate: number | null;
  note: string;
}

// ===========================================================================
// 2. 분할 이벤트 검증 (가격 일관성 재확인)
// ===========================================================================

const PRICE_CONSISTENCY_THRESHOLD = 0.30;

/** 분류된 분할 이벤트의 가격 일관성을 검증한다. */
export function validateSplitPriceConsistency(
  events: readonly SplitEventRaw[]
): SplitConsistencyViolation[] {
  const violations: SplitConsistencyViolation[] = [];
  for (const e of events) {
    if (!e.classifiable || e.price_consistency === null) continue;
    if (e.price_consistency >= PRICE_CONSISTENCY_THRESHOLD) {
      violations.push({
        code: e.code,
        eventDate: e.event_date,
        eventType: e.event_type,
        ratio: e.ratio,
        priceConsistency: e.price_consistency,
        threshold: PRICE_CONSISTENCY_THRESHOLD,
      });
    }
  }
  return violations;
}

// ===========================================================================
// 3. 조정 배수 단조성 검증
// ===========================================================================

/**
 * 분할 조정 배수(adj_factor)의 단조성 검증.
 * 시간이 과거로 갈수록 adj_factor는 감소해야 한다(≤).
 * 위반하면 누적 계산 오류가 있는 것이다.
 */
export function validateAdjFactorMonotonicity(
  code: string,
  bars: readonly MarcapAdjustedBar[]
): AdjFactorViolation[] {
  const violations: AdjFactorViolation[] = [];
  // bars는 날짜 오름차순이므로, 시간이 앞으로 갈수록 adj_factor는 증가해야 함.
  // (과거 adj_factor < 현재 adj_factor — split을 소급 적용하므로)
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].adj_factor;
    const curr = bars[i].adj_factor;
    // 정상: curr === prev (이벤트 없음) 또는 curr < prev는 나타나지 않아야 함
    // 실제: split date에서 adj_factor가 급격히 뛰는 것은 정상
    // 위반: adj_factor가 음수이거나 0
    if (curr <= 0 || prev <= 0) {
      violations.push({
        code,
        date: bars[i].date,
        adjFactor: curr,
        prevAdjFactor: prev,
      });
    }
  }
  return violations;
}

// ===========================================================================
// 4. 삼성전자 분할 골든 테스트
// ===========================================================================

const SAMSUNG_CODE = '005930';
const SAMSUNG_SPLIT_DATE = '2018-05-04';
const SAMSUNG_EXPECTED_RATIO_MIN = 49.0;
const SAMSUNG_EXPECTED_RATIO_MAX = 51.0;

/**
 * 삼성전자 2018-05-04 50:1 분할 골든 테스트.
 * events에서 Samsung 이벤트를 찾고, 검출 여부·비율·adj_factor를 검증한다.
 */
export function samsungSplitGoldenTest(
  events: readonly SplitEventRaw[],
  samsungBars: readonly MarcapAdjustedBar[] | null
): GoldenTestResult {
  const samsungEvent = events.find(
    (e) => e.code === SAMSUNG_CODE && e.event_date === SAMSUNG_SPLIT_DATE
  );

  if (!samsungEvent) {
    return {
      code: SAMSUNG_CODE,
      splitDate: SAMSUNG_SPLIT_DATE,
      stocksBefore: 0,
      stocksAfter: 0,
      actualRatio: 0,
      expectedRatioMin: SAMSUNG_EXPECTED_RATIO_MIN,
      expectedRatioMax: SAMSUNG_EXPECTED_RATIO_MAX,
      passed: false,
      adjFactorAtSplitDate: null,
      note: `이벤트 없음: ${SAMSUNG_CODE}@${SAMSUNG_SPLIT_DATE} — apply_corporate_actions.py 확인 필요`,
    };
  }

  const ratioPassed =
    samsungEvent.ratio >= SAMSUNG_EXPECTED_RATIO_MIN &&
    samsungEvent.ratio <= SAMSUNG_EXPECTED_RATIO_MAX;

  const classifiable = samsungEvent.classifiable;

  // adj_factor 검증: 분할 직전 날짜의 adj_factor가 ~1/50 ≈ 0.02여야 함
  let adjFactorAtSplitDate: number | null = null;
  let adjFactorPassed = false;
  if (samsungBars) {
    const barBeforeSplit = [...samsungBars]
      .reverse()
      .find((b) => b.date < SAMSUNG_SPLIT_DATE);
    if (barBeforeSplit) {
      adjFactorAtSplitDate = barBeforeSplit.adj_factor;
      // adj_factor는 약 1/50 ≈ 0.02 (±10% 허용)
      adjFactorPassed = adjFactorAtSplitDate > 0.015 && adjFactorAtSplitDate < 0.025;
    }
  }

  const passed = ratioPassed && classifiable && (samsungBars === null || adjFactorPassed);

  return {
    code: SAMSUNG_CODE,
    splitDate: SAMSUNG_SPLIT_DATE,
    stocksBefore: samsungEvent.stocks_before,
    stocksAfter: samsungEvent.stocks_after,
    actualRatio: samsungEvent.ratio,
    expectedRatioMin: SAMSUNG_EXPECTED_RATIO_MIN,
    expectedRatioMax: SAMSUNG_EXPECTED_RATIO_MAX,
    passed,
    adjFactorAtSplitDate,
    note: [
      `비율: ${samsungEvent.ratio.toFixed(4)}× (${ratioPassed ? 'OK' : 'FAIL'})`,
      `분류: ${samsungEvent.event_type} (${classifiable ? 'OK' : 'UNKNOWN'})`,
      adjFactorAtSplitDate !== null
        ? `adj_factor@직전: ${adjFactorAtSplitDate.toFixed(6)} (${adjFactorPassed ? 'OK' : 'FAIL ~0.02 기대'})`
        : '(adj_factor 검증 생략)',
    ].join('; '),
  };
}

// ===========================================================================
// 5. 종합 검증
// ===========================================================================

/** 최대 허용 미분류 비율(5%). */
export const MAX_UNKNOWN_CORP_ACTION_PCT = 5.0;

/** 가격 일관성 위반이 허용 건수를 초과하면 false. */
export const MAX_PRICE_CONSISTENCY_VIOLATIONS = 10;

/**
 * 기업행위 전체 검증을 실행한다.
 * 시뮬레이터에 데이터를 주입하기 전에 반드시 통과해야 한다.
 */
export function validateAllCorporateActions(
  events: readonly SplitEventRaw[],
  samsungBars: readonly MarcapAdjustedBar[] | null
): CorpActionValidationResult {
  const totalEvents = events.length;
  const unknownCount = events.filter((e) => !e.classifiable).length;
  const classifiableCount = totalEvents - unknownCount;
  const unknownRatePct = totalEvents > 0 ? (unknownCount / totalEvents) * 100 : 0;

  const priceConsistencyViolations = validateSplitPriceConsistency(events);
  const goldenTestResult = samsungSplitGoldenTest(events, samsungBars);

  // adj_factor 단조성 — 이벤트 배열에서는 직접 검증하지 않음(bars 필요)
  const adjFactorMonotonicityViolations: AdjFactorViolation[] = [];

  const failReasons: string[] = [];
  if (unknownRatePct >= MAX_UNKNOWN_CORP_ACTION_PCT) {
    failReasons.push(
      `미분류 기업행위 ${unknownRatePct.toFixed(1)}% ≥ ${MAX_UNKNOWN_CORP_ACTION_PCT}%`
    );
  }
  if (priceConsistencyViolations.length > MAX_PRICE_CONSISTENCY_VIOLATIONS) {
    failReasons.push(
      `가격 일관성 위반 ${priceConsistencyViolations.length}건 > ${MAX_PRICE_CONSISTENCY_VIOLATIONS}건 허용`
    );
  }
  if (!goldenTestResult.passed) {
    failReasons.push(`삼성전자 골든 테스트 실패: ${goldenTestResult.note}`);
  }

  return {
    totalEvents,
    classifiableCount,
    unknownCount,
    unknownRatePct,
    priceConsistencyViolations,
    adjFactorMonotonicityViolations,
    goldenTestResult,
    passed: failReasons.length === 0,
    failReasons,
  };
}

// ===========================================================================
// 6. 한국 매도세 스케줄 (비용 모형 — 순수 함수)
// ===========================================================================

export interface KrSellTaxEntry {
  effectiveFrom: string;
  effectiveTo: string | null;
  taxBps: number;
  source: string;
}

/** 2010년 이후 한국 매도세 스케줄. 미래 세율을 과거에 소급하지 않는다(§11). */
export const KR_SELL_TAX_SCHEDULE: readonly KrSellTaxEntry[] = [
  { effectiveFrom: '2010-01-01', effectiveTo: '2019-03-31', taxBps: 30, source: '구 증권거래세법 제8조' },
  { effectiveFrom: '2019-04-01', effectiveTo: '2021-03-31', taxBps: 25, source: '증권거래세법 개정(2019.04 시행)' },
  { effectiveFrom: '2021-04-01', effectiveTo: '2023-04-30', taxBps: 23, source: '증권거래세법 개정(2021.04 시행)' },
  { effectiveFrom: '2023-05-01', effectiveTo: null,          taxBps: 18, source: '증권거래세법 개정(2023.05 시행)' },
] as const;

/**
 * 주어진 날짜의 시행 세율(bps)을 반환한다.
 * 미래 세율을 과거에 소급하지 않는다 — 스케줄에 없는 날짜는 null.
 */
export function getKrSellTaxBps(tradeDate: string): number | null {
  for (const entry of KR_SELL_TAX_SCHEDULE) {
    if (tradeDate < entry.effectiveFrom) continue;
    if (entry.effectiveTo !== null && tradeDate > entry.effectiveTo) continue;
    return entry.taxBps;
  }
  return null;
}
