import { useCallback } from 'react';
import { Asset, BuyRecord, ExchangeRates, PortfolioSnapshot, SellRecord, WatchlistItem, AllocationTargets } from '../types';
import type { PortfolioSavePatch } from '../types/portfolioSave';
import type { PLBasis } from '../types/valuation';
import { buildPortfolioCsv } from '../utils/portfolioCsv';
import { inferOwnerFromText } from '../types/owner';

interface UsePortfolioExportProps {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  sellHistory: SellRecord[];
  buyHistory: BuyRecord[];
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
  setBuyHistory: React.Dispatch<React.SetStateAction<BuyRecord[]>>;
  setWatchlist: React.Dispatch<React.SetStateAction<WatchlistItem[]>>;
  setExchangeRates: React.Dispatch<React.SetStateAction<ExchangeRates>>;
  setAllocationTargets: React.Dispatch<React.SetStateAction<AllocationTargets>>;
}

export const usePortfolioExport = ({
  assets,
  portfolioHistory,
  sellHistory,
  buyHistory,
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
  setBuyHistory,
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
      buyHistory,
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
  }, [assets, portfolioHistory, sellHistory, buyHistory, watchlist, exchangeRates, allocationTargets, isSignedIn, setError, setSuccessMessage]);

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
          let loadedBuyHistory: BuyRecord[] = [];
          let loadedWatchlist: WatchlistItem[] = [];
          let loadedRates: ExchangeRates | undefined = undefined;
          let loadedTargets: AllocationTargets = { weights: {} };

          if (Array.isArray(loadedData)) {
            loadedAssets = loadedData as Asset[];
          } else if (loadedData && typeof loadedData === 'object') {
            loadedAssets = Array.isArray(loadedData.assets) ? loadedData.assets : [];
            loadedHistory = Array.isArray(loadedData.portfolioHistory) ? loadedData.portfolioHistory : [];
            loadedSellHistory = Array.isArray(loadedData.sellHistory) ? loadedData.sellHistory : [];
            loadedBuyHistory = Array.isArray(loadedData.buyHistory) ? loadedData.buyHistory : [];
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
          setAssets(loadedAssets.map(a => a.owner !== undefined ? a : {
            ...a, owner: a.owner ?? inferOwnerFromText(a.customName, a.name, a.memo),
          }));
          setPortfolioHistory(loadedHistory);
          setSellHistory(loadedSellHistory);
          setBuyHistory(loadedBuyHistory);
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
  }, [isSignedIn, setError, setSuccessMessage, setAssets, setPortfolioHistory, setSellHistory, setBuyHistory, setWatchlist, setExchangeRates, setAllocationTargets]);

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
      const content = buildPortfolioCsv(assets, exchangeRates, plBasis);
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
