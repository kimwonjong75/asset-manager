import { useCallback } from 'react';
import { Asset, ExchangeRates, PortfolioSnapshot, SellRecord, WatchlistItem, AllocationTargets } from '../types';
import { getCategoryName, DEFAULT_CATEGORIES } from '../types/category';
import type { PortfolioSavePatch } from '../types/portfolioSave';
import type { PLBasis } from '../types/valuation';
import { computeAssetMetrics } from '../utils/portfolioMetrics';

interface UsePortfolioExportProps {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  /** 수익률 기준 — CSV의 매수금액·손익·수익률이 화면 표와 같은 규약을 쓰도록 한다. */
  plBasis: PLBasis;
  isSignedIn: boolean;
  /** 저장만 (상태 변경 없음). 생략한 도메인은 최신 스냅샷에서 채워진다. */
  saveNow: (patch?: PortfolioSavePatch) => void;
  setError: (msg: string | null) => void;
  setSuccessMessage: (msg: string | null) => void;
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  setPortfolioHistory: React.Dispatch<React.SetStateAction<PortfolioSnapshot[]>>;
  setSellHistory: React.Dispatch<React.SetStateAction<SellRecord[]>>;
  setWatchlist: React.Dispatch<React.SetStateAction<WatchlistItem[]>>;
  setExchangeRates: React.Dispatch<React.SetStateAction<ExchangeRates>>;
  setAllocationTargets: React.Dispatch<React.SetStateAction<AllocationTargets>>;
}

export const usePortfolioExport = ({
  assets,
  portfolioHistory,
  sellHistory,
  watchlist,
  exchangeRates,
  allocationTargets,
  plBasis,
  isSignedIn,
  saveNow,
  setError,
  setSuccessMessage,
  setAssets,
  setPortfolioHistory,
  setSellHistory,
  setWatchlist,
  setExchangeRates,
  setAllocationTargets,
}: UsePortfolioExportProps) => {

  const saveToDrive = useCallback(async () => {
    // 수동 저장 — 바뀐 도메인이 없으므로 최신 스냅샷을 그대로 저장한다.
    saveNow();
    setSuccessMessage('저장 요청되었습니다.');
  }, [saveNow, setSuccessMessage]);

  const exportJson = useCallback(async (fileName: string = 'portfolio.json') => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 내보내기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const exportData = {
      assets,
      portfolioHistory,
      sellHistory,
      exchangeRates,
      watchlist,
      allocationTargets,
      lastUpdateDate: new Date().toISOString().slice(0, 10),
    };
    const portfolioJSON = JSON.stringify(exportData, null, 2);
    const blob = new Blob([portfolioJSON], { type: 'application/json' });
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMessage(`'${fileName}' 파일로 내보내기가 완료되었습니다.`);
    } catch (e) {
      setError('파일 내보내기에 실패했습니다.');
      setTimeout(() => setError(null), 3000);
    }
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, allocationTargets, isSignedIn, setError, setSuccessMessage]);

  const importJsonPrompt = useCallback(() => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 가져오기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const contents = e.target?.result as string;
          const loadedData = JSON.parse(contents);
          let loadedAssets: Asset[] = [];
          let loadedHistory: PortfolioSnapshot[] = [];
          let loadedSellHistory: SellRecord[] = [];
          let loadedWatchlist: WatchlistItem[] = [];
          let loadedRates: ExchangeRates | undefined = undefined;
          let loadedTargets: AllocationTargets = { weights: {} };

          if (Array.isArray(loadedData)) {
            loadedAssets = loadedData as Asset[];
          } else if (loadedData && typeof loadedData === 'object') {
            loadedAssets = Array.isArray(loadedData.assets) ? loadedData.assets : [];
            loadedHistory = Array.isArray(loadedData.portfolioHistory) ? loadedData.portfolioHistory : [];
            loadedSellHistory = Array.isArray(loadedData.sellHistory) ? loadedData.sellHistory : [];
            loadedWatchlist = Array.isArray(loadedData.watchlist) ? loadedData.watchlist : [];
            loadedRates = loadedData.exchangeRates;
            
            // AllocationTargets Migration
            if (loadedData.allocationTargets) {
              if ('weights' in loadedData.allocationTargets) {
                loadedTargets = loadedData.allocationTargets;
              } else {
                loadedTargets = { 
                  weights: loadedData.allocationTargets as unknown as Record<string, number> 
                };
              }
            }
          }
          setAssets(loadedAssets);
          setPortfolioHistory(loadedHistory);
          setSellHistory(loadedSellHistory);
          setWatchlist(loadedWatchlist);
          if (loadedRates) setExchangeRates(loadedRates);
          setAllocationTargets(loadedTargets);
          
          setSuccessMessage('파일에서 데이터를 불러왔습니다.');
        } catch (err) {
          setError('파일 파싱 실패');
          setTimeout(() => setError(null), 3000);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [isSignedIn, setError, setSuccessMessage, setAssets, setPortfolioHistory, setSellHistory, setWatchlist, setExchangeRates, setAllocationTargets]);

  const exportCsv = useCallback(async () => {
    if (!isSignedIn) {
      setError('Google Drive 로그인 후 내보내기 기능을 사용할 수 있습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    if (assets.length === 0) {
      setError('내보낼 데이터가 없습니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }
    try {
      const header = [
        '종목명', '티커', '거래소', '자산구분', '보유수량',
        '매수단가(자국통화)', '매수환율', '총매수금액(원화)',
        '현재단가(원화)', '현재평가금액(원화)', '총손익(원화)', '수익률(%)'
      ];
      const rows = assets.map(asset => {
        // 계산은 화면 표와 동일한 단일 모듈 (열 구성·순서는 그대로 — docs/backtest/PROMPT_1_데이터정리.md가 참조).
        // '매수환율'은 원본 데이터라 수익률 기준과 무관하게 계속 내보낸다(원화 기준 재계산·세무 참고용).
        const { metrics } = computeAssetMetrics(asset, exchangeRates, 0, { plBasis });
        return [
          (asset.customName?.trim() || asset.name),
          asset.ticker,
          asset.exchange,
          getCategoryName(asset.categoryId, DEFAULT_CATEGORIES),
          asset.quantity,
          asset.purchasePrice,
          asset.purchaseExchangeRate ?? '',
          Math.round(metrics.purchaseValueKRW),
          Math.round(metrics.currentPriceKRW),
          Math.round(metrics.currentValueKRW),
          Math.round(metrics.profitLossKRW),
          metrics.returnPercentage.toFixed(2),
        ].join(',');
      });
      const content = [header.join(','), ...rows].join('\n');
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'portfolio.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMessage('CSV 내보내기 완료');
    } catch (e) {
      setError('CSV 내보내기 실패');
      setTimeout(() => setError(null), 3000);
    }
  }, [assets, exchangeRates, plBasis, isSignedIn, setError, setSuccessMessage]);

  return {
    saveToDrive,
    exportJson,
    importJsonPrompt,
    exportCsv,
  };
};
