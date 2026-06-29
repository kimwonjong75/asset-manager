// utils/alertDiagnostics.ts
// 5B 일반 알림 진단 (순수 함수) — "이 종목에 왜 이 알림이 떴나/안 떴나"를 3축으로 분해.
// ---------------------------------------------------------------------------
// 5A 구루 진단(guruDiagnostics)과 동형 설계:
//   · evaluation: 규칙 filters의 AND 3치 — matched/unmatched/unknown.
//     **matched === matchesRule()===true** (매치셋 동일성). evaluateSingleFilter + 공유 buildExtraConfig 재사용 → drift 없음.
//   · dataQuality: complete/partial/missing (5A MetricAvailability와 정렬). evaluation과 직교 —
//     climax/distribution은 OHLC 미수신 시 값이 degrade하므로 'partial'로 별도 노출(미충족에 숨기지 않음).
//   · 자동 팝업 게이트(evaluateAutoPopupGate)는 규칙 발화와 또 다른 직교 축 — side effect 없이 상태를 인자로만 받는다.
// 진단은 평가만 한다 — checkAlertRules/매칭 로직은 건드리지 않는다(additive). any/side effect 없음.

import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { AlertRule } from '../types/alertRules';
import type { SmartFilterKey } from '../types/smartFilter';
import type {
  AlertDataQuality, AlertRuleEvaluation, FilterDiagnostic, AlertRuleDiagnostic,
  AlertRuleStatusKind, AlertStatusTone, AlertRuleStatusDescriptor,
  PopupDeliveryDiagnosis,
} from '../types/alertDiagnostics';
import { ALERT_RULE_STATUS_LABELS } from '../types/alertDiagnostics';
import { evaluateSingleFilter } from './smartFilterLogic';
import { buildExtraConfig, ruleThresholds } from './alertChecker';
import { hasClimaxInputs } from './climaxFlags';
import { hasDistributionInputs } from './marketDistribution';

// 필터 표시 라벨 (진단 패널용, 초보 친화 간결). 미정의 키는 원시 키 폴백.
const FILTER_LABELS: Partial<Record<SmartFilterKey, string>> = {
  PRICE_ABOVE_SHORT_MA: '현재가 > 단기 이평선',
  PRICE_ABOVE_LONG_MA: '현재가 > 장기 이평선',
  PRICE_BELOW_SHORT_MA: '현재가 < 단기 이평선',
  PRICE_BELOW_LONG_MA: '현재가 < 장기 이평선',
  MA_BULLISH_ALIGN: '이평선 정배열',
  MA_BEARISH_ALIGN: '이평선 역배열',
  MA_GOLDEN_CROSS: '골든크로스',
  MA_DEAD_CROSS: '데드크로스',
  PRICE_CROSS_ABOVE_MA: '이평선 상향돌파',
  PRICE_CROSS_BELOW_MA: '이평선 하향이탈',
  RSI_OVERBOUGHT: 'RSI 과매수(≥70)',
  RSI_OVERSOLD: 'RSI 과매도(≤30)',
  RSI_BOUNCE: 'RSI 과매도 반등',
  RSI_OVERHEAT_ENTRY: 'RSI 과열 진입',
  SIGNAL_STRONG_BUY: '강력매수 시그널',
  SIGNAL_BUY: '매수 시그널',
  SIGNAL_SELL: '매도 시그널',
  SIGNAL_STRONG_SELL: '강력매도 시그널',
  PROFIT_POSITIVE: '수익 중',
  PROFIT_NEGATIVE: '손실 중',
  PROFIT_TARGET: '목표 수익률 도달',
  DROP_FROM_HIGH: '고점 대비 하락',
  DAILY_DROP: '당일 하락',
  DAILY_SURGE: '당일 급등',
  DAILY_CRASH: '당일 급락',
  LOSS_THRESHOLD: '손절 임계 도달',
  VOLUME_SURGE: '거래량 급증(≥2배)',
  VOLUME_HIGH: '거래량 증가(≥1.5배)',
  VOLUME_LOW: '거래량 위축(<0.5배)',
  CLIMAX_TOP: '클라이맥스(과열)',
  DISTRIBUTION_HIGH: '디스트리뷰션(매물 출회)',
  SWING_LOW_BREAK: '직전 저점 이탈',
};

// OHLC 품질 의존 필터 — OHLC 미수신 시 값이 degrade하므로 'partial'로 표기.
const OHLC_QUALITY_FILTERS: ReadonlySet<SmartFilterKey> = new Set<SmartFilterKey>([
  'CLIMAX_TOP', 'DISTRIBUTION_HIGH',
]);

/**
 * 복합(다중 지표) 필터의 실제 입력 가용성. ohlcvAvailable 플래그만으론 못 잡는 케이스 보강:
 * climax 정량 입력(slopeRatio/dayRangeOverAtr)이 전부 null이거나 distribution volRatio가 전부 null이면
 * 카운트 자체가 무의미하므로 missing/partial로 강등(과대평가 방지).
 */
function compositeInputQuality(filterKey: SmartFilterKey, enriched: EnrichedIndicatorData | undefined): AlertDataQuality {
  if (!enriched) return 'missing';
  if (filterKey === 'CLIMAX_TOP') {
    // 'missing' 경계는 공유 predicate(guruSignalEngine fail-closed와 동일 기준 — drift 차단)
    if (!hasClimaxInputs(enriched)) return 'missing';                 // 핵심 정량 입력 전무 → 사실상 계산 불가
    const hasSlope = typeof enriched.slopeRatio === 'number';
    const hasAtr = typeof enriched.dayRangeOverAtr === 'number';
    if (!hasSlope || !hasAtr || enriched.ohlcvAvailable === false) return 'partial';
    return 'complete';
  }
  if (filterKey === 'DISTRIBUTION_HIGH') {
    const meta = enriched.distributionDayMeta;
    if (!hasDistributionInputs(meta)) return 'missing';               // 메타 없음/volRatio 전부 null → 카운트 불가
    if (!meta || !meta.every(m => typeof m.volRatio === 'number') || enriched.ohlcvAvailable === false) return 'partial';
    return 'complete';
  }
  return 'complete';
}

/**
 * 단일 필터 데이터 품질. no-data=missing / OHLC 복합필터는 실제 입력 가용성(compositeInputQuality) / 그 외=complete.
 */
export function classifyFilterQuality(
  filterKey: SmartFilterKey,
  reason: FilterDiagnostic['reason'],
  enriched: EnrichedIndicatorData | undefined,
): AlertDataQuality {
  if (reason === 'no-data') return 'missing';
  if (OHLC_QUALITY_FILTERS.has(filterKey)) return compositeInputQuality(filterKey, enriched);
  return 'complete';
}

function worstQuality(qs: AlertDataQuality[]): AlertDataQuality {
  if (qs.some(q => q === 'missing')) return 'missing';
  if (qs.some(q => q === 'partial')) return 'partial';
  return 'complete';
}

/**
 * 단일 알림 규칙 × 종목 진단. evaluation은 filters AND 3치:
 *   하나라도 false → unmatched / 전부 true → matched(= matchesRule===true) / 그 외(false 없고 null 있음) → unknown.
 */
export function diagnoseAlertRule(
  asset: EnrichedAsset,
  rule: AlertRule,
  enriched?: EnrichedIndicatorData,
): AlertRuleDiagnostic {
  const { maShort, maLong, dropThreshold, lossThreshold } = ruleThresholds(rule.filterConfig);
  const extra = buildExtraConfig(rule.filterConfig);

  const filters: FilterDiagnostic[] = rule.filters.map(fk => {
    const r = evaluateSingleFilter(asset, fk, dropThreshold, maShort, maLong, enriched, lossThreshold, extra);
    return {
      filterKey: fk,
      label: FILTER_LABELS[fk] ?? fk,
      result: r.result,
      reason: r.reason,
      actual: r.actual,
      threshold: r.threshold,
      quality: classifyFilterQuality(fk, r.reason, enriched),
    };
  });

  let evaluation: AlertRuleEvaluation;
  if (filters.some(f => f.result === false)) evaluation = 'unmatched';
  else if (filters.every(f => f.result === true)) evaluation = 'matched'; // 빈 filters도 every()=true → matchesRule과 동일
  else evaluation = 'unknown';

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    action: rule.action,
    enabled: rule.enabled,
    evaluation,
    dataQuality: worstQuality(filters.map(f => f.quality)),
    filters,
  };
}

/**
 * 선택 종목에 대해 적용 규칙을 진단. 관심종목은 buy-only 정책(매수 규칙만), 포트폴리오는 전 규칙.
 */
export function diagnoseAssetAlerts(params: {
  asset: EnrichedAsset;
  enriched?: EnrichedIndicatorData;
  rules: AlertRule[];
  source: 'portfolio' | 'watchlist';
}): AlertRuleDiagnostic[] {
  const applicable = params.source === 'watchlist'
    ? params.rules.filter(r => r.action === 'buy')
    : params.rules;
  return applicable.map(r => diagnoseAlertRule(params.asset, r, params.enriched));
}

/** 품질이 complete가 아닌 필터 라벨 (부연용). */
function degradedFilterNames(d: AlertRuleDiagnostic, q: AlertDataQuality): string[] {
  return d.filters.filter(f => f.quality === q).map(f => f.label);
}

/**
 * 3축(enabled×evaluation×dataQuality) → 사용자용 단일 상태. 5A describeRuleStatus와 동일 우선순위 정신:
 *   disabled(규칙 off) 최우선 → matched는 발화 사실 보존(품질 저하면 firing-partial까지만) →
 *   unmatched(complete=순수 불일치 / 아니면 데이터 누락 캐비엇) → unknown(판정 불가).
 */
export function describeAlertRuleStatus(d: AlertRuleDiagnostic): AlertRuleStatusDescriptor {
  const mk = (kind: AlertRuleStatusKind, tone: AlertStatusTone, detail?: string): AlertRuleStatusDescriptor =>
    ({ kind, label: ALERT_RULE_STATUS_LABELS[kind], tone, detail });

  if (!d.enabled) {
    return mk('disabled', 'muted', d.evaluation === 'matched' ? '조건은 충족하나 규칙이 꺼져 있음' : undefined);
  }
  if (d.evaluation === 'matched') {
    return d.dataQuality === 'complete' ? mk('firing', 'positive') : mk('firing-partial', 'caution');
  }
  if (d.evaluation === 'unmatched') {
    if (d.dataQuality === 'complete') return mk('not-met', 'neutral');
    const names = [...degradedFilterNames(d, 'missing'), ...degradedFilterNames(d, 'partial')];
    return mk('not-met-partial', 'caution', names.length ? `데이터 주의: ${names.join(', ')}` : undefined);
  }
  // unknown
  const missing = degradedFilterNames(d, 'missing');
  return mk('data-missing', 'caution', missing.length ? `누락: ${missing.join(', ')}` : undefined);
}

/**
 * 자동 브리핑 팝업 게이트 (순수, side effect 없음) — **useAutoAlert와 진단이 공유하는 단일 소스**.
 * useAutoAlert effect의 실제 조건을 그대로 반영한다:
 *   준비 안 됨(자동업데이트 미완료/로딩/자산 없음) → 자동팝업 OFF → 오늘 이미 자동확인 → 발화 0건 → 표시.
 * 핵심: 자동확인 일자 키는 **발화 0건이어도 기록**되므로 lastCheckedDate===today는 "표시함"이 아니라 "확인 완료"다.
 * willAutoShow는 모든 게이트를 통과(enableAutoPopup AND ready AND 오늘 미확인 AND 발화>0)할 때만 true.
 * 부수효과(localStorage 기록·setShowAlertPopup)는 호출부(effect)가 수행 — 이 함수는 판정만 한다.
 */
export function evaluateAutoPopupGate(params: {
  enableAutoPopup: boolean;
  hasAutoUpdated: boolean;
  isLoading: boolean;           // isMarketLoading || isEnrichedLoading
  assetCount: number;
  lastCheckedDate: string | null; // localStorage 'asset-manager-alert-popup-date'
  today: string;                  // 'YYYY-MM-DD' (호출부 주입 — now 직접 생성 금지)
  matchedRuleCount: number;
}): PopupDeliveryDiagnosis {
  const { enableAutoPopup, hasAutoUpdated, isLoading, assetCount, lastCheckedDate, today, matchedRuleCount } = params;
  if (!enableAutoPopup) return { willAutoShow: false, reason: 'auto-popup-disabled', matchedRuleCount };
  if (!hasAutoUpdated || isLoading || assetCount === 0) return { willAutoShow: false, reason: 'not-ready', matchedRuleCount };
  if (lastCheckedDate === today) return { willAutoShow: false, reason: 'already-checked-today', matchedRuleCount };
  if (matchedRuleCount === 0) return { willAutoShow: false, reason: 'no-matches', matchedRuleCount };
  return { willAutoShow: true, reason: 'will-show', matchedRuleCount };
}
