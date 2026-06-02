import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { AlertRule, AlertSettings, AlertResult } from '../types/alertRules';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from './useEnrichedIndicators';
import type { WatchlistItem } from '../types';
import { DEFAULT_ALERT_SETTINGS } from '../constants/alertRules';
import { checkAlertRules, checkBuyRulesForWatchlist } from '../utils/alertChecker';
import { computeRiskTier, sortByRiskPriority, DEFAULT_RISK_MATRIX_THRESHOLDS, type RiskMatrixRow } from '../utils/riskMatrix';

const STORAGE_KEY = 'asset-manager-alert-settings';
const POPUP_DATE_KEY = 'asset-manager-alert-popup-date';

/** localStorage에서 AlertSettings 로드 (신규 규칙 자동 병합) */
const loadAlertSettings = (): AlertSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const settings: AlertSettings = { ...DEFAULT_ALERT_SETTINGS, ...parsed };

      // 기존 사용자에게 새 규칙 자동 추가 (기존 커스터마이징 보존)
      const existingIds = new Set(settings.rules.map((r: AlertRule) => r.id));
      for (const defaultRule of DEFAULT_ALERT_SETTINGS.rules) {
        if (!existingIds.has(defaultRule.id)) {
          settings.rules.push(defaultRule);
        }
      }

      // 기존 규칙에 신규 filterConfig 필드 병합 (withinDays 등)
      const defaultRuleMap = new Map(DEFAULT_ALERT_SETTINGS.rules.map(r => [r.id, r]));
      settings.rules = settings.rules.map((r: AlertRule) => {
        const def = defaultRuleMap.get(r.id);
        if (!def) return r;
        // 기본값에 있는데 저장된 config에 없는 필드만 backfill
        const mergedConfig = { ...def.filterConfig, ...r.filterConfig };
        return { ...r, filterConfig: mergedConfig };
      });

      return settings;
    }
  } catch { /* ignore */ }
  return DEFAULT_ALERT_SETTINGS;
};

/** localStorage에 AlertSettings 저장 */
const saveAlertSettings = (settings: AlertSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
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
}

export const useAutoAlert = ({
  enrichedAssets,
  enrichedMap,
  isEnrichedLoading,
  hasAutoUpdated,
  isMarketLoading,
  watchlistItems,
}: UseAutoAlertProps) => {
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(loadAlertSettings);
  const [alertResults, setAlertResults] = useState<AlertResult[]>([]);
  const [showAlertPopup, setShowAlertPopup] = useState(false);
  const hasTriggeredRef = useRef(false);

  // 설정 변경 시 localStorage 저장
  const updateAlertSettings = useCallback((newSettings: AlertSettings) => {
    setAlertSettings(newSettings);
    saveAlertSettings(newSettings);
  }, []);

  // 팝업 닫기
  const dismissAlertPopup = useCallback(() => {
    setShowAlertPopup(false);
  }, []);

  // 포트폴리오 + 관심종목 통합 알림 체크
  const runAlertCheck = useCallback(() => {
    const portfolioResults = checkAlertRules(enrichedAssets, enrichedMap, alertSettings.rules);

    // 관심종목 매수 기회 체크
    if (watchlistItems && watchlistItems.length > 0) {
      const portfolioTickers = new Set(enrichedAssets.map(a => a.ticker));
      const watchlistBuyResults = checkBuyRulesForWatchlist(
        watchlistItems, enrichedMap, alertSettings.rules, portfolioTickers
      );
      return mergeWatchlistResults(portfolioResults, watchlistBuyResults);
    }

    return portfolioResults;
  }, [enrichedAssets, enrichedMap, alertSettings.rules, watchlistItems]);

  // 수동으로 브리핑 다시 보기
  const showBriefingPopup = useCallback(() => {
    if (enrichedAssets.length === 0) return;
    const results = runAlertCheck();
    setAlertResults(results);
    setShowAlertPopup(true);
  }, [enrichedAssets, runAlertCheck]);

  // alertResults를 데이터 준비 즉시 계산 (팝업 트리거와 무관하게 상단 버튼 표시용)
  useEffect(() => {
    if (isEnrichedLoading || enrichedAssets.length === 0) return;
    const results = runAlertCheck();
    setAlertResults(results);
  }, [isEnrichedLoading, enrichedAssets, runAlertCheck]);

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

  // 자동 알림 트리거: 시세 업데이트 + enriched 로드 완료 시 (팝업만 제어)
  useEffect(() => {
    if (hasTriggeredRef.current) return;
    if (!hasAutoUpdated || isMarketLoading || isEnrichedLoading) return;
    if (enrichedAssets.length === 0) return;
    if (!alertSettings.enableAutoPopup) return;

    // 오늘 이미 팝업을 띄웠는지 확인
    const today = new Date().toISOString().slice(0, 10);
    const lastPopupDate = localStorage.getItem(POPUP_DATE_KEY);
    if (lastPopupDate === today) return;

    hasTriggeredRef.current = true;

    if (alertResults.length > 0) {
      setShowAlertPopup(true);
    }

    localStorage.setItem(POPUP_DATE_KEY, today);
  }, [hasAutoUpdated, isMarketLoading, isEnrichedLoading, enrichedAssets, alertSettings, alertResults, runAlertCheck]);

  return {
    alertSettings,
    updateAlertSettings,
    alertResults,
    riskMatrix,
    showAlertPopup,
    dismissAlertPopup,
    showBriefingPopup,
  };
};
