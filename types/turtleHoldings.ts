// types/turtleHoldings.ts
// ---------------------------------------------------------------------------
// P0 — "보유종목 터틀" 확장 설정 (계획서 `docs/PLAN_터틀중심_앱재정비_260925.md` §3.1).
//
// 안전 원칙: 기존 `TurtleSettings`/`DEFAULT_TURTLE_SETTINGS`(types/turtle.ts)는 **절대 수정하지 않는다**
// (기존 골든 테스트·주문 경로가 그 값에 의존). 이 파일은 `TurtleSettings.holdings?: TurtleHoldingsSettings`
// 중첩 optional 필드로만 얹힌다. 병합은 `utils/turtleHoldings.resolveHoldingsSettings`가 담당한다
// (`{...DEFAULT, ...saved}` + 범위 가드 — 잘못된 값은 기본값으로 대체, throw 하지 않음).

export type HoldingsExitMethod = 'donchian' | 'ma' | 'atrTrail';
export type PyramidSpacingMode = '2R' | 'halfN' | 'custom';

export interface TurtleHoldingsSettings {
  /** 진입(재진입) 돌파 채널 — 55일. 20~100. */
  entryLookback: number;
  /** 청산 방식. 기본 donchian. */
  exitMethod: HoldingsExitMethod;
  /** donchian 청산 채널(일). 10~55. exitMethod='donchian' 전용. */
  exitLookback: number;
  /** 이동평균 청산 기간(일). exitMethod='ma' 전용. */
  maPeriod: number;
  /** ATR 추적 배수. exitMethod='atrTrail' 전용. */
  atrTrailMultiple: number;
  /** 손절 배수(재매수분). 1.5~3. */
  stopMultipleN: number;
  /** 유닛당 사이징 리스크 %(관리자산 대비). 0.25~1. */
  riskPerUnitPct: number;
  /** 종목당 최대 유닛 수. 1~4. */
  maxUnitsPerPosition: number;
  /** 불타기 간격 방식. 기본 2R(=2×stopMultipleN×N). */
  pyramidSpacing: PyramidSpacingMode;
  /** pyramidSpacing='custom' 전용 — 간격 = pyramidCustomN × N. */
  pyramidCustomN: number;
  /** 최초 유닛 이후 추가 유닛 수량 배수(고정, 재계산 금지). 1 또는 0.5. */
  pyramidSizeMultiplier: 1 | 0.5;
  /** 종목 한도 %(관리자산 대비, 4유닛 다 채웠을 때 기준). 5~25. */
  positionCapPct: number;
  /** 전체 위험 한도 %(관리자산 대비). 12~24. */
  maxTotalRiskPct: number;
  /** 계좌 축소(드로다운 감쇄) 사용 여부. */
  drawdownScalingEnabled: boolean;
  /** 최소 주문 금액(KRW) — 미만이면 재매수 생략. */
  minOrderKRW: number;
  /** 가족(유선) 계정 상시 제외. */
  excludeFamilyOwner: boolean;
  /** 개별 자산 제외 목록(assetId). */
  excludedAssetIds: string[];
  /** 카테고리 제외 목록(categoryId). */
  excludedCategoryIds: number[];
  /**
   * 계좌 축소(드로다운 감쇄) 기준 자산(KRW) — P3(2026-09-26, 계획서 §4.7). 사용자가 설정에서
   * [지금 자산으로 기준 정하기]를 눌렀을 때만 값이 생긴다("보이지 않는 쓰기 금지" — 자동 기록 없음).
   * 미설정(undefined)이면 `resolveEffectiveManagedEquity`가 자기참조(현재 관리자산=기준)로 폴백해
   * 항상 감쇄 미적용으로 계산한다(기존 P2 동작과 동일, 안전한 기본값).
   */
  drawdownReferenceKRW?: number;
  /** 기준 자산을 정한 날짜 — YYYY-MM-DD. 홈 카드가 "매년 1월 또는 365일 경과" 안내에 사용(표시 전용). */
  drawdownReferenceSetAt?: string;
}

export const DEFAULT_TURTLE_HOLDINGS_SETTINGS: TurtleHoldingsSettings = {
  entryLookback: 55,
  exitMethod: 'donchian',
  exitLookback: 20,
  maPeriod: 50,
  atrTrailMultiple: 3,
  stopMultipleN: 2,
  riskPerUnitPct: 1,
  maxUnitsPerPosition: 4,
  pyramidSpacing: '2R',
  pyramidCustomN: 1,
  pyramidSizeMultiplier: 1,
  positionCapPct: 10,
  maxTotalRiskPct: 24,
  drawdownScalingEnabled: false, // 2026-09-26 사용자 결정: 검증상 이득 없음 → 기본 꺼짐(원조는 켜짐, 설정에서 켤 수 있음)
  minOrderKRW: 50_000,
  excludeFamilyOwner: true,
  excludedAssetIds: [],
  excludedCategoryIds: [],
};

/** 변동성 라벨(§3.1 N/가격 임계값): 잔잔 <2% · 보통 2~4% · 출렁임 큼 >4%. */
export type VolatilityLabel = 'calm' | 'normal' | 'volatile';

export const VOLATILITY_LABELS: Record<VolatilityLabel, string> = {
  calm: '잔잔함',
  normal: '보통',
  volatile: '출렁임 큼',
};

/** 재매수 불가/생략 사유. */
export type HoldingsSkipReason =
  | 'below-min-order'   // 매수 금액이 minOrderKRW 미만
  | 'max-units-reached' // 종목 한도(유닛 수) 도달
  | 'no-n'              // N 산출 불가(데이터 부족)
  | 'no-fx'             // 환율 없음(ExchangeRates 미보유 통화)
  | 'no-cash';          // 배정 가능 현금 없음

/** 원래 보유분(터틀 매수 이력 없음) 상태 — 청산선만 적용, 2N 손절 없음. */
export type LegacyHoldingsStatus = 'hold' | 'sell-check' | 'unavailable';

// ---------------------------------------------------------------------------
// P1 — 저장 구조 확장(계획서 §6 P1). 새 최상위 저장 도메인 금지 — 기존 도메인(watchlist/turtlePositions/
// assets) 안의 optional 필드로만 얹는다. 전이 함수는 `utils/turtleHoldingsState.ts`.
// ---------------------------------------------------------------------------

/**
 * "다시 살 때 감시" 명단 표식 — `WatchlistItem.turtleWatch`. 기존 `isTurtleCandidate`와 함께 설정한다
 * (별도 새 필드를 만들지 않고 재사용 — 계획서 §6 P1 승인 사항).
 *
 * ⚠️ `isTurtleCandidate`는 기존 위성(90/10) 실행 큐 생성기(`utils/actionQueueGenerator.ts`의
 * `turtleCandidateItems`)가 진입 후보 판정에도 그대로 쓴다. 이 표식을 실제 watchlist 저장(commitPortfolio)에
 * 연결하기 전에(P2), 위성 엔진이 이 종목을 자기 예산(satelliteBudgetKRW)으로 오인 진입하지 않는지
 * 반드시 재확인할 것 — 두 시스템의 사이징 분모가 다르다(위성=satelliteBudgetKRW, 보유종목=관리자산).
 */
export interface TurtleHoldingsWatchEntry {
  /** 매도(청산) 체결일 — YYYY-MM-DD, 실제 체결값 */
  soldAt: string;
  /** 매도 체결가 — 원통화(priceOriginal 기준), 실제 체결값(refPrice 금지) */
  soldPriceOriginal: number;
  /** 감시 등록 계기 — 터틀 청산선 이탈로 자동 등록 / 사용자가 직접 등록 */
  source: 'turtle-exit' | 'manual';
}

/** 보유 종목의 보류 결정 1건(원래 보유분·재매수분 공통) — `Asset.turtleDecisions`. */
export interface TurtleHoldDecision {
  /** 결정일 — YYYY-MM-DD */
  date: string;
  action: 'hold';
  /** 보류 사유 — 필수(빈 문자열 저장 금지, `recordTurtleHold`가 가드). */
  reason: string;
}

/** `Asset.turtleDecisions` 보관 캡 — 최근 N개만 유지(무한 누적 방지). 초과분은 오래된 것부터 버린다. */
export const TURTLE_HOLD_DECISIONS_CAP = 20;
