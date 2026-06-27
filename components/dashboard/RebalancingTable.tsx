import React from 'react';
import { Asset, ExchangeRates } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useRebalancing } from '../../hooks/useRebalancing';
import type { RebalanceRow } from '../../utils/bucketRebalancing';

interface RebalancingTableProps {
  assets: Asset[];
  exchangeRates: ExchangeRates;
}

const formatKRW = (num: number) =>
  new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(num);
const formatNumber = (num: number) => new Intl.NumberFormat('ko-KR').format(num);
const getDiffColor = (val: number) => {
  if (val > 0) return 'text-red-400 font-bold'; // 매수
  if (val < 0) return 'text-blue-400 font-bold'; // 매도
  return 'text-gray-400';
};

/** 한 tier(버킷 또는 코어 카테고리)의 리밸런싱 표 */
interface TierTableProps {
  firstColLabel: string;
  rows: RebalanceRow[];
  totalCurrentValue: number;
  totalTargetWeight: number;
  totalTargetValue: number;
  totalDifference: number;
  onWeightChange: (key: string, value: string) => void;
  emptyMessage?: string;
}

const TierTable: React.FC<TierTableProps> = ({
  firstColLabel,
  rows,
  totalCurrentValue,
  totalTargetWeight,
  totalTargetValue,
  totalDifference,
  onWeightChange,
  emptyMessage,
}) => {
  if (rows.length === 0 && emptyMessage) {
    return <p className="text-sm text-gray-400 py-4">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left text-gray-400">
        <thead className="text-xs text-gray-300 uppercase bg-gray-700">
          <tr>
            <th className="px-4 py-3">{firstColLabel}</th>
            <th className="px-4 py-3 text-right">현재금액</th>
            <th className="px-4 py-3 text-right">현재비중</th>
            <th className="px-4 py-3 text-right bg-gray-600 bg-opacity-30 border-b-2 border-blue-500">목표비중 (%)</th>
            <th className="px-4 py-3 text-right">목표금액</th>
            <th className="px-4 py-3 text-right">매수/매도 필요액</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-gray-700 hover:bg-gray-750">
              <td className="px-4 py-3 font-medium text-white">{row.label}</td>
              <td className="px-4 py-3 text-right">{formatKRW(row.currentValue)}</td>
              <td className="px-4 py-3 text-right">{row.currentWeight.toFixed(2)}%</td>
              <td className="px-4 py-3 text-right">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={row.targetWeight}
                  onChange={(e) => onWeightChange(row.key, e.target.value)}
                  className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-white w-20 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </td>
              <td className="px-4 py-3 text-right text-gray-300">{formatKRW(row.targetValue)}</td>
              <td className={`px-4 py-3 text-right ${getDiffColor(row.difference)}`}>
                {row.difference > 0 ? '+' : ''}{formatKRW(row.difference)}
              </td>
            </tr>
          ))}
          {/* 합계 */}
          <tr className="bg-gray-750 font-bold border-t-2 border-gray-600">
            <td className="px-4 py-3 text-white">합계</td>
            <td className="px-4 py-3 text-right">{formatKRW(totalCurrentValue)}</td>
            <td className="px-4 py-3 text-right">100.00%</td>
            <td className={`px-4 py-3 text-right ${Math.abs(totalTargetWeight - 100) > 0.1 ? 'text-yellow-400' : 'text-green-400'}`}>
              {totalTargetWeight.toFixed(2)}%
            </td>
            <td className="px-4 py-3 text-right">{formatKRW(totalTargetValue)}</td>
            <td className="px-4 py-3 text-right text-white">{formatKRW(totalDifference)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

const RebalancingTable: React.FC<RebalancingTableProps> = ({ assets, exchangeRates }) => {
  const { data, actions } = usePortfolio();

  const {
    targetTotalAmount,
    handleTotalAmountChange,
    handleSave,
    isSaved,
    hasSatellite,
    bucket,
    core,
    satelliteHoldings,
    satelliteValue,
  } = useRebalancing({
    assets,
    exchangeRates,
    allocationTargets: data.allocationTargets,
    onSave: actions.updateAllocationTargets,
    categories: data.categoryStore.categories,
  });

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-lg space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-bold text-white">포트폴리오 리밸런싱 (2단 배분표)</h2>
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

      {/* ① 전략 배분: 코어 vs 투더문 */}
      <section>
        <h3 className="text-base font-bold text-white mb-1">① 전략 배분 — 코어 vs 투더문</h3>
        <p className="text-xs text-gray-400 mb-3">
          전체 자산을 자산배분 본체(코어)와 개별 위성 종목(투더문)으로 나눕니다. 먼저 이 비율을 맞추세요.
        </p>
        <TierTable
          firstColLabel="전략 버킷"
          rows={bucket.rows}
          totalCurrentValue={bucket.totalCurrentValue}
          totalTargetWeight={bucket.totalTargetWeight}
          totalTargetValue={bucket.totalTargetValue}
          totalDifference={bucket.totalDifference}
          onWeightChange={bucket.handleWeightChange}
        />
      </section>

      {/* ② 코어 자산배분 */}
      <section>
        <h3 className="text-base font-bold text-white mb-1">② 코어 자산배분 — 카테고리별</h3>
        <p className="text-xs text-gray-400 mb-3">
          코어 버킷({formatKRW(core.currentValue)}) 내부에서만 카테고리 비율을 맞춥니다. 투더문 종목은 제외됩니다.
          {hasSatellite && ' (비중·목표금액은 코어 합계 기준)'}
        </p>
        <TierTable
          firstColLabel="자산군 (코어)"
          rows={core.rows}
          totalCurrentValue={core.currentValue}
          totalTargetWeight={core.totalTargetWeight}
          totalTargetValue={core.totalTargetValue}
          totalDifference={core.totalDifference}
          onWeightChange={core.handleWeightChange}
          emptyMessage="코어 버킷에 자산이 없습니다."
        />
      </section>

      {/* ③ 투더문 현황 (참고) */}
      {hasSatellite && (
        <section>
          <h3 className="text-base font-bold text-white mb-1">③ 투더문 현황 (참고)</h3>
          <p className="text-xs text-gray-400 mb-3">
            위성 종목은 종류가 섞여 있어 합산 한 덩어리로만 관리합니다. 총 {formatKRW(satelliteValue)}.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-400">
              <thead className="text-xs text-gray-300 uppercase bg-gray-700">
                <tr>
                  <th className="px-4 py-3">종목</th>
                  <th className="px-4 py-3">자산군</th>
                  <th className="px-4 py-3 text-right">평가금액</th>
                  <th className="px-4 py-3 text-right">위성 내 비중</th>
                </tr>
              </thead>
              <tbody>
                {satelliteHoldings.map((row) => (
                  <tr key={row.id} className="border-b border-gray-700 hover:bg-gray-750">
                    <td className="px-4 py-3 font-medium text-white">{row.name}</td>
                    <td className="px-4 py-3">{row.categoryName}</td>
                    <td className="px-4 py-3 text-right">{formatKRW(row.value)}</td>
                    <td className="px-4 py-3 text-right">{row.weight.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="text-xs text-gray-400 text-right">
        * 각 표의 목표 비중 합계가 100%가 되도록 설정해주세요.
        <br />
        * 매수/매도 필요액이 (+)인 경우 매수, (-)인 경우 매도가 필요함을 의미합니다.
      </div>
    </div>
  );
};

export default RebalancingTable;
