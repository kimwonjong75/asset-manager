import { useState, useEffect, useRef, useCallback } from 'react';
import type { AlertSettings, AlertResult } from '../types/alertRules';
import type { EnrichedAsset } from '../types/ui';
import type { EnrichedIndicatorData } from './useEnrichedIndicators';
import type { WatchlistItem } from '../types';
import { DEFAULT_ALERT_SETTINGS } from '../constants/alertRules';
import { checkAlertRules, checkBuyRulesForWatchlist } from '../utils/alertChecker';

const STORAGE_KEY = 'asset-manager-alert-settings';
const POPUP_DATE_KEY = 'asset-manager-alert-popup-date';

/** localStorage에서 AlertSettings 로드 */
const loadAlertSettings = (): AlertSettings => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_ALERT_SETTINGS, ...parsed };
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

  // 자동 알림 트리거: 시세 업데이트 + enriched 로드 완료 시
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

    const results = runAlertCheck();
    setAlertResults(results);

    if (results.length > 0) {
      setShowAlertPopup(true);
    }

    localStorage.setItem(POPUP_DATE_KEY, today);
  }, [hasAutoUpdated, isMarketLoading, isEnrichedLoading, enrichedAssets, enrichedMap, alertSettings, runAlertCheck]);

  return {
    alertSettings,
    updateAlertSettings,
    alertResults,
    showAlertPopup,
    dismissAlertPopup,
    showBriefingPopup,
  };
};
