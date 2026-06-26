// types/alertDiagnostics.ts
// 5B 일반 알림 진단 타입 — "이 종목에 왜 이 알림이 떴나/안 떴나".
// 5A 구루 진단(types/knowledge)과 어휘를 정렬한다:
//   · evaluation = matched/unmatched/unknown (발화 판정, matched === matchesRule===true)
//   · dataQuality = complete/partial/missing (데이터 품질 축, evaluation과 직교 — climax/distribution의 OHLC 품질)
// 팝업 전달 상태(PopupDelivery)는 규칙 발화와 또 다른 직교 축(자동팝업 on/off·오늘 표시됨)이라 별도 타입.

import type { SmartFilterKey, FilterEvalReason } from './smartFilter';
import type { EnrichedAsset } from './ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';

/** 데이터 품질 축 (5A MetricAvailability와 정렬, 알림엔 unsupported 없음). */
export type AlertDataQuality = 'complete' | 'partial' | 'missing';

/** 규칙 발화 판정 (filters AND 3치). matched === matchesRule===true (매치셋 동일성). */
export type AlertRuleEvaluation = 'matched' | 'unmatched' | 'unknown';

/** 단일 필터 진단 행 — evaluateSingleFilter 결과 + 표시 라벨 + 데이터 품질. */
export interface FilterDiagnostic {
  filterKey: SmartFilterKey;
  label: string;
  result: boolean | null;
  reason: FilterEvalReason;
  actual?: number | string;
  threshold?: number | string;
  quality: AlertDataQuality;
}

/** 규칙×종목 진단 — 발화(evaluation)와 데이터 품질(dataQuality)을 직교 분리. */
export interface AlertRuleDiagnostic {
  ruleId: string;
  ruleName: string;
  action: 'sell' | 'buy';
  enabled: boolean;
  evaluation: AlertRuleEvaluation;
  dataQuality: AlertDataQuality; // 조건 필터 중 최악 품질 (missing>partial>complete)
  filters: FilterDiagnostic[];
}

/** 3축(enabled×evaluation×dataQuality)을 사용자용 단일 상태로 번역한 결과. */
export type AlertRuleStatusKind =
  | 'firing'          // 활성 + 충족 + 데이터 완전 → 발화
  | 'firing-partial'  // 활성 + 충족이나 일부 데이터 품질 저하(OHLC)
  | 'not-met'         // 활성 + 미충족 + 데이터 완전 → 순수 조건 불일치
  | 'not-met-partial' // 활성 + 미충족 + 일부 데이터 누락/품질 저하
  | 'data-missing'    // 활성 + 판정 불가(필요 지표 미수신)
  | 'disabled';       // 규칙 비활성(off)

export type AlertStatusTone = 'positive' | 'neutral' | 'caution' | 'muted';

export interface AlertRuleStatusDescriptor {
  kind: AlertRuleStatusKind;
  label: string;
  detail?: string;
  tone: AlertStatusTone;
}

export const ALERT_RULE_STATUS_LABELS: Record<AlertRuleStatusKind, string> = {
  'firing': '발화 중 — 조건 충족',
  'firing-partial': '충족(일부 데이터 품질 저하)',
  'not-met': '미충족 (조건 불일치)',
  'not-met-partial': '현재 계산상 미충족·일부 데이터 누락',
  'data-missing': '데이터 부족으로 판정 불가',
  'disabled': '규칙 꺼짐(비활성)',
};

// ── 자동 브리핑 팝업 게이트 (규칙 발화와 직교 축) — useAutoAlert와 진단이 공유하는 단일 게이트 ──
// 주의: 자동 확인 일자 키는 발화 0건이어도 기록되므로 'already-checked-today'(≠'표시함')가 정확한 의미.
export type PopupDeliveryReason =
  | 'will-show'             // 모든 게이트 통과 — 다음 자동 브리핑에 표시될 조건
  | 'auto-popup-disabled'   // 자동 팝업 OFF
  | 'not-ready'             // 자동 업데이트 미완료 / 로딩 중 / 자산 없음
  | 'already-checked-today' // 오늘 이미 자동 확인 완료(하루 1회 — 0건이어도 기록됨)
  | 'no-matches';           // 확인했으나 발화 중인 규칙 없음

export interface PopupDeliveryDiagnosis {
  willAutoShow: boolean;
  reason: PopupDeliveryReason;
  matchedRuleCount: number;
}

// ── 훅 뷰모델 (useAlertDiagnostics 반환) — store.ts와 동일한 "조합 타입이 utils/hooks를 type-import" 패턴 ──
export interface AlertDiagnosticsTarget {
  assetId: string;
  ticker: string;
  name: string;
  source: 'portfolio' | 'watchlist';
  asset: EnrichedAsset;                 // 포트폴리오=실자산 / 관심종목=pseudo-EnrichedAsset
  enriched?: EnrichedIndicatorData;
}

export interface AlertDiagnosticRow {
  diagnostic: AlertRuleDiagnostic;
  status: AlertRuleStatusDescriptor;
}

export interface AlertDiagnosticsView {
  targets: AlertDiagnosticsTarget[];
  selectedId: string | null;
  selectedTarget: AlertDiagnosticsTarget | null;
  selectTarget: (assetId: string) => void;
  rows: AlertDiagnosticRow[];            // 선택 종목 × 적용 규칙(발화 근접 순)
  popupDelivery: PopupDeliveryDiagnosis; // 규칙 발화와 직교 — 자동 팝업이 뜰지/왜 안 뜨는지
}
