// types/stockReview.ts
// "종목 검토(Stock Review)" 아코디언 패널의 타입 정의 (관찰·판단 보조용, 주문 신호 아님).
// ---------------------------------------------------------------------------
// **지배 원리: 3축을 완전 분리(섞지 않는다).**
//   A 평가(evaluation)   = 공유 evaluateSingleFilter 결과만: 충족/미충족/판정불가(엔진 null)/해당없음(보유 컨텍스트 없음).
//                          특정 필드 결측을 이유로 사전 차단(pre-gate)해 판정불가로 만들지 않는다.
//   B 데이터 품질(qualityNote) = 캐비엇('부분 데이터'). 평가를 절대 숨기지 않음(충족/미충족 그대로 + 캐비엇).
//                          헤더 '부분'에 기여, summary.qualityCaveats에 카운트.
//   C 시장 상태(stateNote)     = 중립 정보('장기추세 비상승' 등). **데이터 품질이 아님** —
//                          qualityCaveats 증가·헤더 '부분'·'데이터 부족' 표기 금지. 회색 정보로만 표시.
// 단일 데이터 소스: 패널은 enriched만 사용(평가 asset의 indicators를 strip해 stale 폴백 차단).
// 이 파일은 순수 타입만 — any 금지. ViewModel 생성 로직은 utils/stockReview.ts.

import type { SmartFilterKey } from './smartFilter';

/** 조건 평가 결과 (축 A, 품질·상태와 직교). */
export type StockReviewEvaluation = '충족' | '미충족' | '판정불가' | '해당 없음';

/** 칩 표시 상태 — evaluation을 사용자 라벨로 매핑('판정불가'→'데이터 부족'). */
export type StockReviewConditionStatus = '충족' | '미충족' | '데이터 부족' | '해당 없음';

/**
 * 지표 데이터 상태 — 코어 표시 지표 결측 + 조건 품질(축B)/판정불가로만 결정. **축C(stateNote)로는 '부분' 안 됨.**
 *   정상: 코어 표시 지표 완비 + 축B 캐비엇/판정불가 없음
 *   부분: 코어 표시 지표 일부 결측 또는 축B 캐비엇/판정불가 존재
 *   없음: 가격 이력 부족으로 코어 지표(RSI/MA)조차 계산 불가
 */
export type StockReviewDataStatus = '정상' | '부분' | '없음';

/** 지표 요약 한 줄. raw는 테스트/툴팁용 원값, display는 UI 표시용 포맷 문자열. */
export interface StockReviewIndicator {
  key: string;
  label: string;
  display: string;
  raw: number | null;
}

/** 단일 조건 점검 결과 — 3축 분리. */
export interface StockReviewCondition {
  key: SmartFilterKey;
  label: string;
  /** 축A: 평가 결과 (품질·상태와 독립) */
  evaluation: StockReviewEvaluation;
  /** 축B: 데이터 품질 캐비엇 ('부분 데이터'). 없으면 null. 헤더 '부분'·qualityCaveats에 기여. */
  qualityNote: string | null;
  /** 축C: 시장 상태 중립 정보 ('장기추세 비상승'). 헤더/카운트에 영향 없음. 없으면 undefined. */
  stateNote?: string;
  actualDisplay: string | null;
  thresholdDisplay: string | null;
  rawActual: number | string | null;
  rawThreshold: number | string | null;
  rationale: string;
}

/**
 * 한 섹션(매수/매도)의 조건 카운트 요약.
 *   met=충족(캐비엇 포함), evaluated=충족+미충족, qualityCaveats=축B 캐비엇 수(축C 제외),
 *   dataMissing=판정불가, notApplicable=해당없음. "발화" 아닌 "충족 조건 수".
 */
export interface StockReviewSideSummary {
  met: number;
  evaluated: number;
  qualityCaveats: number;
  dataMissing: number;
  notApplicable: number;
}

export interface StockReviewSummary {
  buy: StockReviewSideSummary;
  sell: StockReviewSideSummary;
}

/** 패널 전체 ViewModel — StockReviewPanel은 이 구조만 렌더링(로직·API 없음). */
export interface StockReviewViewModel {
  ticker: string;
  name: string;
  source: 'portfolio' | 'watchlist';
  /** 보유 조건이 실제 평가됐는지 (관심종목이라도 동일 티커 보유 시 true) */
  holdingEvaluated: boolean;
  /** 보유 집계 방식 부연 ('복수 계정 통합 기준'). 단일/미보유면 null */
  holdingNote: string | null;
  /** 검토일 (화면을 연 오늘·로컬, 호출부 주입 — 시장 데이터 날짜 아님) */
  asOfLabel: string;
  dataStatus: StockReviewDataStatus;
  dataStatusNote: string | null;
  summary: StockReviewSummary;
  indicators: StockReviewIndicator[];
  buyConditions: StockReviewCondition[];
  sellConditions: StockReviewCondition[];
  disclaimer: string;
}

/** 패널 하단 고정 면책 문구 (필수 표기). */
export const STOCK_REVIEW_DISCLAIMER =
  '본 정보는 관찰과 판단 보조용이며 투자 추천이나 자동 주문 신호가 아닙니다.';

/** 패널 부제 — 이 스캔의 성격을 명시(알림 규칙 설정과 독립). */
export const STOCK_REVIEW_SUBTITLE = '기본 기술 스캔 · 알림 설정과 독립';
