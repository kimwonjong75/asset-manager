import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AlertRule, AlertSettings, AlertResult, AlertDataGap } from '../types/alertRules';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from './useEnrichedIndicators';
import type { WatchlistItem } from '../types';
import { checkAlertRules, checkBuyRulesForWatchlist, collectSellRuleDataGaps } from '../utils/alertChecker';
import { computeRiskTier, sortByRiskPriority, DEFAULT_RISK_MATRIX_THRESHOLDS, type RiskMatrixRow } from '../utils/riskMatrix';
import { countDistributionDays } from '../utils/marketDistribution';
import { classifyDistributionTier } from '../utils/distributionTierState';
import { evaluateAutoPopupGate } from '../utils/alertDiagnostics';
import type { PopupDeliveryDiagnosis } from '../types/alertDiagnostics';
import {
  ALERT_SETTINGS_RESTORED_EVENT,
  loadAlertSettings,
  saveAlertSettings,
} from '../utils/alertSettingsStorage';

/** 자동 브리핑 "오늘 자동 확인 완료" 일자 키 (발화 0건이어도 기록 — 표시 여부와 무관). */
export const POPUP_DATE_KEY = 'asset-manager-alert-popup-date';

/**
 * P4.5 D1: distribution-high 매칭 자산에 tier 분류(new/ongoing) 첨부
 * 룰 매칭 로직은 건드리지 않고 표시 레이어 디듀프만 수행
 * distribution 카운트 계산은 alertChecker가 boolean만 반환하므로 enriched에서 직접 재계산
 */
const attachDistributionTiers = (
  results: AlertResult[],
  enrichedMap: Map<string, EnrichedIndicatorData>,
  rules: AlertRule[]
): AlertResult[] => {
  const distRule = rules.find(r => r.id === 'distribution-high');
  if (!distRule) return results;
  const windowDays = distRule.filterConfig.distributionWindow ?? 13;
  const volRatio = distRule.filterConfig.distributionVolumeRatio ?? 1.5;
  const today = new Date().toISOString().slice(0, 10);

  return results.map(result => {
    if (result.rule.id !== 'distribution-high') return result;
    const updatedAssets = result.matchedAssets.map(asset => {
      const enriched = enrichedMap.get(asset.ticker);
      if (!enriched) return asset;
      const count = countDistributionDays(enriched.distributionDayMeta, windowDays, volRatio);
      const classification = classifyDistributionTier(asset.assetId, count, today);
      // count<3은 룰이 안 매칭됐을 것이므로 classification이 null이면 그대로 통과
      if (!classification) return asset;
      return { ...asset, distributionTier: classification };
    });
    return { ...result, matchedAssets: updatedAssets };
  });
};

/** 포트폴리오 결과에 관심종목 매수 결과를 병합 */
const mergeWatchlistResults = (
  portfolioResults: AlertResult[],
  watchlistResults: AlertResult[]
): AlertResult[] => {
  const merged = [...portfolioResults];
  for (const wResult of watchlistResults) {
    const existing = merged.find(r => r.rule.id === wResult.rule.id);
    if (existing) {
      const existingTickers = new Set(existing.matchedAssets.map(a => a.ticker));
      const newAssets = wResult.matchedAssets.filter(a => !existingTickers.has(a.ticker));
      existing.matchedAssets.push(...newAssets);
    } else {
      merged.push(wResult);
    }
  }
  return merged;
};

interface UseAutoAlertProps {
  enrichedAssets: EnrichedAsset[];
  enrichedMap: Map<string, EnrichedIndicatorData>;
  isEnrichedLoading: boolean;
  hasAutoUpdated: boolean;
  isMarketLoading: boolean;
  watchlistItems?: WatchlistItem[];
  /**
   * 실행 축(터틀 자동 검토, 옵션): 알림 발화 0건이어도 실행할 게 있으면 하루 1회 자동 팝업.
   * reviewPending=true인 동안은 게이트가 not-ready로 대기(일자 미기록) — 검토 완료 시 재평가.
   */
  executionGate?: { actionableCount: number; reviewPending: boolean };
  /**
   * 설정이 **사용자 조작으로** 바뀌어 localStorage에 기록된 직후 호출(옵션).
   * PortfolioContext가 여기서 Drive autoSave를 트리거해 규칙 설정을 기기 간 동기화한다.
   * Drive 복원(이벤트 수신)으로 바뀐 경우에는 호출하지 않는다 — 되돌려 저장하는 루프 방지.
   */
  onSettingsPersisted?: (settings: AlertSettings) => void;
}

export const useAutoAlert = ({
  enrichedAssets,
  enrichedMap,
  isEnrichedLoading,
  hasAutoUpdated,
  isMarketLoading,
  watchlistItems,
  executionGate,
  onSettingsPersisted,
}: UseAutoAlertProps) => {
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(loadAlertSettings);
  const [alertResults, setAlertResults] = useState<AlertResult[]>([]);
  const [showAlertPopup, setShowAlertPopup] = useState(false);
  const hasTriggeredRef = useRef(false);
  // 자동 확인 일자 — localStorage POPUP_DATE_KEY의 반응형 미러. effect가 기록 시 함께 갱신 → 진단이 stale 안 됨.
  const [lastAutoCheckDate, setLastAutoCheckDate] = useState<string | null>(() => {
    try { return localStorage.getItem(POPUP_DATE_KEY); } catch { return null; }
  });

  // 콜백 identity 변화가 updateAlertSettings를 재생성하지 않도록 ref로 고정
  const onSettingsPersistedRef = useRef(onSettingsPersisted);
  useEffect(() => { onSettingsPersistedRef.current = onSettingsPersisted; });

  // 설정 변경 시 localStorage 저장 → 이어서 Drive 저장 트리거(콜백)
  // 순서 중요: localStorage 기록이 먼저여야 autoSave가 최신 설정을 페이로드에 싣는다.
  const updateAlertSettings = useCallback((newSettings: AlertSettings) => {
    setAlertSettings(newSettings);
    saveAlertSettings(newSettings);
    onSettingsPersistedRef.current?.(newSettings);
  }, []);

  // Drive 로드/백업 복원 → alertSettingsStorage가 발화하는 이벤트로 state 동기화.
  // (localStorage 기록은 이벤트 발화측이 이미 수행 — 여기서는 다시 저장하지 않는다)
  useEffect(() => {
    const handleRestored = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === 'object' && Array.isArray((detail as AlertSettings).rules)) {
        setAlertSettings(detail as AlertSettings);
      }
    };
    window.addEventListener(ALERT_SETTINGS_RESTORED_EVENT, handleRestored);
    return () => window.removeEventListener(ALERT_SETTINGS_RESTORED_EVENT, handleRestored);
  }, []);

  // 팝업 닫기
  const dismissAlertPopup = useCallback(() => {
    setShowAlertPopup(false);
  }, []);

  // 포트폴리오 + 관심종목 통합 알림 체크
  const runAlertCheck = useCallback(() => {
    const portfolioResults = checkAlertRules(enrichedAssets, enrichedMap, alertSettings.rules);

    // 관심종목 매수 기회 체크
    let merged: AlertResult[];
    if (watchlistItems && watchlistItems.length > 0) {
      const portfolioTickers = new Set(enrichedAssets.map(a => a.ticker));
      const watchlistBuyResults = checkBuyRulesForWatchlist(
        watchlistItems, enrichedMap, alertSettings.rules, portfolioTickers
      );
      merged = mergeWatchlistResults(portfolioResults, watchlistBuyResults);
    } else {
      merged = portfolioResults;
    }

    // P4.5 D1: distribution-high 자산에 tier(new/ongoing) 첨부 — localStorage 기반 일자 디듀프
    return attachDistributionTiers(merged, enrichedMap, alertSettings.rules);
  }, [enrichedAssets, enrichedMap, alertSettings.rules, watchlistItems]);

  // 수동으로 브리핑 다시 보기
  const showBriefingPopup = useCallback(() => {
    if (enrichedAssets.length === 0) return;
    const results = runAlertCheck();
    setAlertResults(results);
    setShowAlertPopup(true);
  }, [enrichedAssets, runAlertCheck]);

  // 결과 계산 + 자동 팝업 트리거를 **한 흐름**으로 (P1 타이밍 수정).
  // 자동 팝업 게이트는 방금 계산한 `results`(local)를 기준으로 평가한다 — 별도 effect가 stale `alertResults`(state)를
  // 읽어 실제 매칭이 있어도 no-matches로 일자/triggered를 기록해 팝업을 누락하던 레이스를 원천 제거.
  useEffect(() => {
    if (isEnrichedLoading || enrichedAssets.length === 0) return;
    const results = runAlertCheck();
    setAlertResults(results);

    // 자동 브리핑 팝업 (세션 1회). 부수효과는 여기서, 판정은 공유 순수 게이트로 — 기존 동작 보존.
    if (hasTriggeredRef.current) return;
    const today = new Date().toISOString().slice(0, 10);
    const gate = evaluateAutoPopupGate({
      enableAutoPopup: alertSettings.enableAutoPopup,
      hasAutoUpdated,
      isLoading: isMarketLoading || isEnrichedLoading,
      assetCount: enrichedAssets.length,
      lastCheckedDate: localStorage.getItem(POPUP_DATE_KEY),
      today,
      matchedRuleCount: results.length, // ← state가 아닌 방금 계산한 결과 기준(stale 없음)
      executionActionableCount: executionGate?.actionableCount,
      executionReviewPending: executionGate?.reviewPending,
    });
    // 준비 안 됨(터틀 검토 대기 포함) / 자동팝업 OFF / 오늘 이미 확인 → 트리거·기록 모두 안 함 (기존 가드와 동일)
    if (gate.reason === 'not-ready' || gate.reason === 'auto-popup-disabled' || gate.reason === 'already-checked-today') return;
    hasTriggeredRef.current = true;
    if (gate.willAutoShow) setShowAlertPopup(true);        // will-show (발화 규칙 > 0 또는 실행 건 > 0)
    localStorage.setItem(POPUP_DATE_KEY, today);           // no-matches·will-show 모두 일자 기록 (기존 동작)
    setLastAutoCheckDate(today);
  }, [isEnrichedLoading, enrichedAssets, runAlertCheck, hasAutoUpdated, isMarketLoading, alertSettings, executionGate]);

  // 종합 리스크 매트릭스 — 클라이맥스 플래그 + 디스트리뷰션 카운트 + MA 근접도 합성
  // alertSettings의 distributionWindow/Ratio 등 사용자 임계값이 있으면 적용, 없으면 DEFAULT 사용
  // (현재는 alertSettings에 별도 riskMatrix 키가 없어 DEFAULT 사용 — 추후 확장 가능)
  const riskMatrix = useMemo<RiskMatrixRow[]>(() => {
    if (isEnrichedLoading || enrichedMap.size === 0) return [];
    const rows: RiskMatrixRow[] = [];
    for (const asset of enrichedAssets) {
      const enriched = enrichedMap.get(asset.ticker);
      if (!enriched) continue;
      const assessment = computeRiskTier(enriched, asset.priceOriginal, DEFAULT_RISK_MATRIX_THRESHOLDS);
      if (assessment.tier !== null) {
        rows.push({
          assetId: asset.id,
          ticker: asset.ticker,
          assetName: asset.name,
          source: 'portfolio',
          assessment,
        });
      }
    }
    if (watchlistItems) {
      const portfolioTickers = new Set(enrichedAssets.map(a => a.ticker));
      for (const item of watchlistItems) {
        if (portfolioTickers.has(item.ticker)) continue;
        const enriched = enrichedMap.get(item.ticker);
        if (!enriched) continue;
        const price = item.priceOriginal ?? item.currentPrice ?? 0;
        if (price <= 0) continue;
        const assessment = computeRiskTier(enriched, price, DEFAULT_RISK_MATRIX_THRESHOLDS);
        if (assessment.tier !== null) {
          rows.push({
            assetId: item.id,
            ticker: item.ticker,
            assetName: item.name,
            source: 'watchlist',
            assessment,
          });
        }
      }
    }
    return sortByRiskPriority(rows);
  }, [enrichedMap, enrichedAssets, watchlistItems, isEnrichedLoading]);

  // fail-safe(매도 data-gap): 매도 규칙이 '데이터 누락으로 판정 불가'인 종목 — 발화 경로(runAlertCheck/checkAlertRules)와
  // 무관한 별도 채널(순수·additive). 팝업 게이트·알림 발화 수에 영향 없음. UI가 '데이터 불완전 — 수동 확인'으로 노출.
  const sellDataGaps = useMemo<AlertDataGap[]>(() => {
    if (isEnrichedLoading || enrichedMap.size === 0) return [];
    return collectSellRuleDataGaps(enrichedAssets, enrichedMap, alertSettings.rules);
  }, [enrichedAssets, enrichedMap, alertSettings.rules, isEnrichedLoading]);

  // 자동 브리핑 팝업 게이트 진단 (규칙 발화와 직교 축) — 진단 패널과 **동일 순수 게이트** 사용.
  // 반응형: lastAutoCheckDate(state) 기반이라 effect가 일자 기록 시 재계산됨(localStorage 직접 읽기로 인한 stale 제거).
  const autoPopupDiagnosis = useMemo<PopupDeliveryDiagnosis>(() =>
    evaluateAutoPopupGate({
      enableAutoPopup: alertSettings.enableAutoPopup,
      hasAutoUpdated,
      isLoading: isMarketLoading || isEnrichedLoading,
      assetCount: enrichedAssets.length,
      lastCheckedDate: lastAutoCheckDate,
      today: new Date().toISOString().slice(0, 10),
      matchedRuleCount: alertResults.length,
      executionActionableCount: executionGate?.actionableCount,
      executionReviewPending: executionGate?.reviewPending,
    }),
    [alertSettings.enableAutoPopup, hasAutoUpdated, isMarketLoading, isEnrichedLoading, enrichedAssets.length, lastAutoCheckDate, alertResults.length, executionGate],
  );

  return {
    alertSettings,
    updateAlertSettings,
    alertResults,
    riskMatrix,
    sellDataGaps,
    showAlertPopup,
    dismissAlertPopup,
    showBriefingPopup,
    autoPopupDiagnosis,
  };
};
