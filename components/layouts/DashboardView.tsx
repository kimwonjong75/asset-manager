import React, { useMemo, useCallback } from 'react';
import { Asset, AssetCategory, ExchangeRates, PortfolioSnapshot, Currency, ALLOWED_CATEGORIES } from '../../types';
import StatCard from '../StatCard';
import ExchangeRateInput from '../ExchangeRateInput';
import ProfitLossChart from '../ProfitLossChart';
import AllocationChart from '../AllocationChart';
import CategorySummaryTable from '../CategorySummaryTable';
import TopBottomAssets from '../TopBottomAssets';
import RebalancingTable from '../RebalancingTable';

interface DashboardViewProps {
  assets: Asset[];
  portfolioHistory: PortfolioSnapshot[];
  exchangeRates: ExchangeRates;
  dashboardFilterCategory: AssetCategory | 'ALL';
  setDashboardFilterCategory: (cat: AssetCategory | 'ALL') => void;
  alertCount: number;
  onAlertClick: () => void;
  onRatesChange: (rates: ExchangeRates) => void;
  showExchangeRateWarning: boolean;
  totalValue: number; // 부모에서 계산해서 내려줌 (혹은 여기서 계산)
}

const DashboardView: React.FC<DashboardViewProps> = ({
  assets,
  portfolioHistory,
  exchangeRates,
  dashboardFilterCategory,
  setDashboardFilterCategory,
  alertCount,
  onAlertClick,
  onRatesChange,
  showExchangeRateWarning,
  // totalValue -> 내부 계산으로 변경
}) => {

  const getValueInKRW = useCallback((value: number, currency: Currency): number => {
    if (currency === Currency.KRW) return value;
    const rate = exchangeRates[currency] || 0;
    return value * rate;
  }, [exchangeRates]);

  const totalValue = useMemo(() => {
    return assets.reduce((acc, asset) => {
      const v = asset.currentPrice * asset.quantity;
      return acc + getValueInKRW(v, asset.currency);
    }, 0);
  }, [assets, getValueInKRW]);

  const categoryOptions = useMemo(() => {
    const extras = Array.from(new Set(assets.map(asset => asset.category))).filter(
      (cat) => !ALLOWED_CATEGORIES.includes(cat)
    );
    return [...ALLOWED_CATEGORIES, ...extras];
  }, [assets]);

  const dashboardFilteredAssets = useMemo(() => {
      if (dashboardFilterCategory === 'ALL') {
          return assets;
      }
      return assets.filter(asset => asset.category === dashboardFilterCategory);
  }, [assets, dashboardFilterCategory]);

  const dashboardTotalValue = useMemo(() => {
      return dashboardFilteredAssets.reduce((acc, asset) => {
        const v = asset.currentPrice * asset.quantity;
        return acc + getValueInKRW(v, asset.currency);
      }, 0);
  }, [dashboardFilteredAssets, getValueInKRW]);

  const dashboardTotalPurchaseValue = useMemo(() => {
      return dashboardFilteredAssets.reduce((acc, asset) => {
        const v = asset.purchasePrice * asset.quantity;
        return acc + getValueInKRW(v, asset.currency);
      }, 0);
  }, [dashboardFilteredAssets, getValueInKRW]);

  const dashboardTotalGainLoss = dashboardTotalValue - dashboardTotalPurchaseValue;
  const dashboardTotalReturn = dashboardTotalPurchaseValue === 0 ? 0 : (dashboardTotalGainLoss / dashboardTotalPurchaseValue) * 100;

  const soldAssetsStats = useMemo(() => {
    let totalSoldAmount = 0;
    let totalSoldPurchaseValue = 0;
    let totalSoldProfit = 0;
    let soldCount = 0;

    assets.forEach(asset => {
      if (asset.sellTransactions && asset.sellTransactions.length > 0) {
        asset.sellTransactions.forEach(transaction => {
          totalSoldAmount += transaction.sellPrice * transaction.sellQuantity;
          soldCount += 1;
          
          let purchaseValueForSold: number;
          if (asset.currency === Currency.KRW) {
            purchaseValueForSold = asset.purchasePrice * transaction.sellQuantity;
          } else if (asset.purchaseExchangeRate) {
            purchaseValueForSold = asset.purchasePrice * asset.purchaseExchangeRate * transaction.sellQuantity;
          } else if (asset.priceOriginal > 0) {
            const exchangeRate = asset.currentPrice / asset.priceOriginal;
            purchaseValueForSold = asset.purchasePrice * exchangeRate * transaction.sellQuantity;
          } else {
            purchaseValueForSold = asset.purchasePrice * transaction.sellQuantity;
          }
          totalSoldPurchaseValue += purchaseValueForSold;
        });
      }
    });

    totalSoldProfit = totalSoldAmount - totalSoldPurchaseValue;
    const soldReturn = totalSoldPurchaseValue === 0 ? 0 : (totalSoldProfit / totalSoldPurchaseValue) * 100;

    return {
      totalSoldAmount,
      totalSoldPurchaseValue,
      totalSoldProfit,
      soldReturn,
      soldCount,
    };
  }, [assets]);

  const profitLossChartTitle = useMemo(() => (
      dashboardFilterCategory === 'ALL'
      ? '손익 추이 분석'
      : `${dashboardFilterCategory} 손익 추이 분석`
  ), [dashboardFilterCategory]);

  const formatCurrencyKRW = (value: number) => {
    return value.toLocaleString('ko-KR', { 
        style: 'currency', 
        currency: 'KRW', 
        maximumFractionDigits: 0 
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 p-4 rounded-lg shadow-lg flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4" title="대시보드에 표시될 자산의 종류를 선택합니다.">
              <label htmlFor="dashboard-filter" className="text-sm font-medium text-gray-300">
                  자산 구분 필터:
              </label>
              <div className="relative">
                  <select
                      id="dashboard-filter"
                      value={dashboardFilterCategory}
                      onChange={(e) => setDashboardFilterCategory(e.target.value as AssetCategory | 'ALL')}
                      className="bg-gray-700 border border-gray-600 rounded-md py-2 pl-3 pr-8 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent appearance-none"
                  >
                      <option value="ALL">전체 포트폴리오</option>
                      {categoryOptions.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                      ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                  </div>
              </div>
          </div>
          <ExchangeRateInput 
            rates={exchangeRates} 
            onRatesChange={onRatesChange} 
            showWarning={showExchangeRateWarning} 
          />
          <StatCard 
              title="매도 알림 발생" 
              value={`${alertCount}개`}
              tooltip="설정된 하락률 기준을 초과한 자산의 수입니다. 클릭하여 필터링된 목록을 확인하세요."
              onClick={onAlertClick}
              isAlert={alertCount > 0}
              size="small"
          />
      </div>
       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard title="총 자산 (원화)" value={formatCurrencyKRW(dashboardTotalValue)} tooltip="선택된 자산의 현재 평가금액 총합입니다." />
        <StatCard title="투자 원금" value={formatCurrencyKRW(dashboardTotalPurchaseValue)} tooltip="선택된 자산의 총 매수금액 합계입니다." />
        <StatCard title="총 손익 (원화)" value={formatCurrencyKRW(dashboardTotalGainLoss)} isProfit={dashboardTotalGainLoss >= 0} tooltip="총 평가금액에서 총 매수금액을 뺀 금액입니다."/>
        <StatCard title="총 수익률" value={`${dashboardTotalReturn.toFixed(2)}%`} isProfit={dashboardTotalReturn >= 0} tooltip="총 손익을 총 매수금액으로 나눈 백분율입니다."/>
      </div>
      {soldAssetsStats.soldCount > 0 && (
        <div className="bg-gray-800 p-6 rounded-lg shadow-lg mb-6">
          <h3 className="text-xl font-bold text-white mb-4">매도 통계</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard title="매도 횟수" value={soldAssetsStats.soldCount.toString()} tooltip="총 매도 거래 횟수입니다." size="small" />
            <StatCard title="매도 금액" value={formatCurrencyKRW(soldAssetsStats.totalSoldAmount)} tooltip="매도된 종목의 총 매도금액입니다." size="small" />
            <StatCard title="매도 수익" value={formatCurrencyKRW(soldAssetsStats.totalSoldProfit)} isProfit={soldAssetsStats.totalSoldProfit >= 0} tooltip="매도금액에서 매수금액을 뺀 수익입니다." size="small" />
            <StatCard title="매도 수익률" value={`${soldAssetsStats.soldReturn.toFixed(2)}%`} isProfit={soldAssetsStats.soldReturn >= 0} tooltip="매도 수익을 매수금액으로 나눈 백분율입니다." size="small" />
          </div>
        </div>
      )}
      <ProfitLossChart history={portfolioHistory} assetsToDisplay={dashboardFilteredAssets} title={profitLossChartTitle} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="lg:col-span-1">
          <AllocationChart assets={assets} exchangeRates={exchangeRates} />
        </div>
        <div className="lg:col-span-1">
           <CategorySummaryTable 
            assets={assets} 
            totalPortfolioValue={totalValue} 
            exchangeRates={exchangeRates} 
           />
        </div>
      </div>
      <RebalancingTable assets={assets} exchangeRates={exchangeRates} />
      <TopBottomAssets assets={assets} />
    </div>
  );
};

export default DashboardView;
