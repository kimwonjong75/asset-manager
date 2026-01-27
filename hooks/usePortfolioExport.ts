import { useCallback } from 'react';
import { Asset, Currency, ExchangeRates, PortfolioSnapshot, SellRecord, WatchlistItem, AllocationTargets } from '../types';

interface UsePortfolioExportProps {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  watchlist: WatchlistItem[];
  exchangeRates: ExchangeRates;
  allocationTargets: AllocationTargets;
  isSignedIn: boolean;
  triggerAutoSave: (assets: Asset[], history: PortfolioSnapshot[], sells: SellRecord[], watchlist: WatchlistItem[], rates: ExchangeRates, targets?: AllocationTargets, sellAlertDropRate?: number) => void;
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
  isSignedIn,
  triggerAutoSave,
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
    triggerAutoSave(assets, portfolioHistory, sellHistory, watchlist, exchangeRates, allocationTargets);
    setSuccessMessage('저장 요청되었습니다.');
    setTimeout(() => setSuccessMessage(null), 3000);
  }, [assets, portfolioHistory, sellHistory, watchlist, exchangeRates, allocationTargets, triggerAutoSave, setSuccessMessage]);

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
      setTimeout(() => setSuccessMessage(null), 3000);
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
          setTimeout(() => setSuccessMessage(null), 3000);
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
      alert('내보낼 데이터가 없습니다.');
      return;
    }
    try {
      const header = [
        '종목명', '티커', '거래소', '자산구분', '보유수량',
        '매수단가(자국통화)', '매수환율', '총매수금액(원화)',
        '현재단가(원화)', '현재평가금액(원화)', '총손익(원화)', '수익률(%)'
      ];
      const rows = assets.map(asset => {
        const rate = asset.currency === Currency.KRW ? 1 : (exchangeRates[asset.currency] || 0);
        const currentValueKRW = asset.currentPrice * asset.quantity * rate;
        const purchaseValueKRW = asset.currency === Currency.KRW
          ? asset.purchasePrice * asset.quantity
          : (asset.purchaseExchangeRate
              ? asset.purchasePrice * asset.purchaseExchangeRate * asset.quantity
              : asset.purchasePrice * rate * asset.quantity);
        const gainLossKRW = currentValueKRW - purchaseValueKRW;
        const returnPct = purchaseValueKRW === 0 ? 0 : (gainLossKRW / purchaseValueKRW) * 100;
        return [
          (asset.customName?.trim() || asset.name),
          asset.ticker,
          asset.exchange,
          asset.category,
          asset.quantity,
          asset.purchasePrice,
          asset.purchaseExchangeRate ?? '',
          Math.round(purchaseValueKRW),
          Math.round(asset.currentPrice * rate),
          Math.round(currentValueKRW),
          Math.round(gainLossKRW),
          returnPct.toFixed(2),
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
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (e) {
      setError('CSV 내보내기 실패');
      setTimeout(() => setError(null), 3000);
    }
  }, [assets, exchangeRates, isSignedIn, setError, setSuccessMessage]);

  return {
    saveToDrive,
    exportJson,
    importJsonPrompt,
    exportCsv,
  };
};
