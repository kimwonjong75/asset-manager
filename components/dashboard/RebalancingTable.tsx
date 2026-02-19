import React from 'react';
import { Asset, ExchangeRates } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useRebalancing } from '../../hooks/useRebalancing';

interface RebalancingTableProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
}

const RebalancingTable: React.FC<RebalancingTableProps> = ({ assets, exchangeRates }) => {
  const { data, actions } = usePortfolio();
  
  const {
      tableData,
      totalCurrentValue,
      totalTargetWeight,
      totalTargetValue,
      totalDifference,
      targetTotalAmount,
      handleWeightChange,
      handleTotalAmountChange,
      handleSave,
      isSaved
  } = useRebalancing({
      assets,
      exchangeRates,
      allocationTargets: data.allocationTargets,
      onSave: actions.updateAllocationTargets,
      categories: data.categoryStore.categories
  });

  // --- Helpers ---
  const formatKRW = (num: number) => {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
  };
  
  const formatNumber = (num: number) => {
      return new Intl.NumberFormat('ko-KR').format(num);
  }

  const getDiffColor = (val: number) => {
      if (val > 0) return 'text-red-400 font-bold'; // Buy
      if (val < 0) return 'text-blue-400 font-bold'; // Sell
      return 'text-gray-400';
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h2 className="text-xl font-bold text-white">포트폴리오 리밸런싱 (배분표)</h2>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4">
            <div className="flex items-center gap-2">
                <label htmlFor="targetTotal" className="text-sm font-medium text-gray-300 whitespace-nowrap">
                    목표 총 자산 (KRW):
                </label>
                <input
                    id="targetTotal"
                    type="text"
                    value={formatNumber(targetTotalAmount)}
                    onChange={(e) => handleTotalAmountChange(e.target.value)}
                    className="bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white text-right focus:outline-none focus:ring-2 focus:ring-blue-500 w-40 sm:w-56"
                />
            </div>
            <div className="flex items-center gap-2">
                <button 
                    onClick={handleSave}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                    저장하기
                </button>
                {isSaved && <span className="text-green-400 text-sm animate-pulse">저장됨!</span>}
            </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left text-gray-400">
            <thead className="text-xs text-gray-300 uppercase bg-gray-700">
                <tr>
                    <th className="px-4 py-3">자산군</th>
                    <th className="px-4 py-3 text-right">현재금액</th>
                    <th className="px-4 py-3 text-right">현재비중</th>
                    <th className="px-4 py-3 text-right bg-gray-600 bg-opacity-30 border-b-2 border-blue-500">목표비중 (%)</th>
                    <th className="px-4 py-3 text-right">목표금액</th>
                    <th className="px-4 py-3 text-right">매수/매도 필요액</th>
                </tr>
            </thead>
            <tbody>
                {tableData.map((row) => (
                    <tr key={row.category} className="border-b border-gray-700 hover:bg-gray-750">
                        <td className="px-4 py-3 font-medium text-white">{row.category}</td>
                        <td className="px-4 py-3 text-right">{formatKRW(row.currentValue)}</td>
                        <td className="px-4 py-3 text-right">{row.currentWeight.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={row.targetWeight}
                                onChange={(e) => handleWeightChange(row.category, e.target.value)}
                                className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-white w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </td>
                        <td className="px-4 py-3 text-right text-gray-300">{formatKRW(row.targetValue)}</td>
                        <td className={`px-4 py-3 text-right ${getDiffColor(row.difference)}`}>
                            {row.difference > 0 ? '+' : ''}{formatKRW(row.difference)}
                        </td>
                    </tr>
                ))}
                
                {/* Total Row */}
                <tr className="bg-gray-750 font-bold border-t-2 border-gray-600">
                    <td className="px-4 py-3 text-white">합계</td>
                    <td className="px-4 py-3 text-right">{formatKRW(totalCurrentValue)}</td>
                    <td className="px-4 py-3 text-right">100.00%</td>
                    <td className={`px-4 py-3 text-right ${Math.abs(totalTargetWeight - 100) > 0.1 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {totalTargetWeight.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-right">{formatKRW(totalTargetValue)}</td>
                    <td className="px-4 py-3 text-right text-white">
                        {formatKRW(totalDifference)}
                    </td>
                </tr>
            </tbody>
        </table>
      </div>
      <div className="mt-4 text-xs text-gray-400 text-right">
        * 목표 비중 합계가 100%가 되도록 설정해주세요.
        <br />
        * 매수/매도 필요액이 (+)인 경우 매수, (-)인 경우 매도가 필요함을 의미합니다.
      </div>
    </div>
  );
};

export default RebalancingTable;
