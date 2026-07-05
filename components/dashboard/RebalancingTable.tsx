import React, { useState } from 'react';
import { Asset, ExchangeRates, RebalanceInstrument } from '../../types';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { useRebalancing } from '../../hooks/useRebalancing';
import { useActionQueue } from '../../hooks/useActionQueue';
import type { RebalanceRow } from '../../utils/bucketRebalancing';
import type { RebalanceGenDiag, RebalanceGenReason } from '../../utils/rebalanceActions';
import { getExchangesForCategory } from '../../types/category';

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

/** 코어 카테고리 1개의 대표 매수 종목 지정/변경/삭제 (Phase 4b-1, 로컬 편집 → 저장하기로 영속) */
interface InstrumentRowProps {
  categoryKey: string;
  categoryLabel: string;
  categoryId: number;
  instrument?: RebalanceInstrument;
  holdings: { ticker: string; name: string; currency: Asset['currency'] }[];
  exchanges: string[];
  onChange: (categoryKey: string, instrument: RebalanceInstrument | null) => void;
}

const InstrumentRow: React.FC<InstrumentRowProps> = ({ categoryKey, categoryLabel, categoryId, instrument, holdings, exchanges, onChange }) => {
  const [editing, setEditing] = useState(false);
  const [ticker, setTicker] = useState(instrument?.ticker ?? '');
  const [exchange, setExchange] = useState(instrument?.exchange ?? exchanges[0] ?? '');

  const open = () => {
    setTicker(instrument?.ticker ?? '');
    setExchange(instrument?.exchange ?? exchanges[0] ?? '');
    setEditing(true);
  };
  const apply = () => {
    const t = ticker.trim().toUpperCase();
    if (!t || !exchange) return;
    // 보유 종목과 티커가 일치하면 이름·통화 자동 채움(없으면 미지정 — 4b-3에서 가격 fetch로 확정)
    const match = holdings.find(h => h.ticker.toUpperCase() === t);
    onChange(categoryKey, { ticker: t, exchange, categoryId, name: match?.name, currency: match?.currency });
    setEditing(false);
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
      <span className="text-sm font-medium text-white min-w-[6rem]">{categoryLabel}</span>
      {editing ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            list={`hold-${categoryKey}`}
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="티커"
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <datalist id={`hold-${categoryKey}`}>
            {holdings.map(h => <option key={h.ticker} value={h.ticker}>{h.name}</option>)}
          </datalist>
          <select
            value={exchange}
            onChange={(e) => setExchange(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {exchanges.map(ex => <option key={ex} value={ex}>{ex}</option>)}
          </select>
          <button onClick={apply} disabled={!ticker.trim() || !exchange} className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1 rounded disabled:opacity-40 disabled:cursor-not-allowed">적용</button>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-white px-2 py-1">취소</button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {instrument ? (
            <span className="text-sm text-gray-200">
              {instrument.name ? `${instrument.name} ` : ''}<span className="text-gray-400">{instrument.ticker} · {instrument.exchange}</span>
            </span>
          ) : (
            <span className="text-sm text-gray-500">미지정</span>
          )}
          <button onClick={open} className="text-xs text-blue-300 hover:text-blue-200 px-2 py-1">{instrument ? '변경' : '지정'}</button>
          {instrument && <button onClick={() => onChange(categoryKey, null)} className="text-xs text-gray-400 hover:text-red-300 px-1.5 py-1">삭제</button>}
        </div>
      )}
    </li>
  );
};

/** 리밸런싱 주문 생성 결과 — "생성됨"과 "스킵 사유"를 분리 표시 (Phase 4b-3b) */
const SKIP_LABEL: Record<Exclude<RebalanceGenReason, 'generated-buy' | 'generated-sell'>, string> = {
  'no-instrument': '대표 매수 종목 미지정',
  'no-price': '가격 확보 실패',
  'no-fx': '환율 미지원(원화 환산 불가)',
  'no-holding': '매도할 코어 보유 없음',
  'zero-qty': '조정액이 1주 미만',
  'duplicate': '이미 대기 중 주문 있음',
};

export interface GenResultData {
  generated: number;
  diagnostics: RebalanceGenDiag[];
  bandCount: number;          // 밴드 이탈 카테고리 수 (0=전부 밴드 안)
  targetsConfigured: boolean; // 목표 총액·CORE% 설정 여부
}

/** 0건 사유 분기(4b-3c): 미설정 → 안내 / 전부 밴드 안 → "(정상)" / 이탈했으나 스킵 → 사유 목록 */
export const GenResult: React.FC<{ result: GenResultData }> = ({ result }) => {
  const skips = result.diagnostics.filter(d => d.reason !== 'generated-buy' && d.reason !== 'generated-sell');
  const zeroReason = result.generated > 0 ? null
    : !result.targetsConfigured
      ? '목표 총 자산 또는 코어 목표비중(CORE%)이 설정되지 않아 판정할 수 없습니다 — 위에서 설정 후 저장하세요.'
      : result.bandCount === 0
        ? '코어 카테고리가 모두 ±5%p 밴드 안입니다 — 지금 조정할 것이 없습니다 (정상).'
        : '밴드 이탈 카테고리가 있으나 아래 사유로 모두 생성되지 않았습니다.';
  return (
    <div className="mt-3 rounded-md border border-gray-700 bg-gray-800/60 p-3 text-xs">
      <p className="text-gray-200 font-medium">
        {result.generated > 0
          ? `리밸런싱 주문 ${result.generated}건 생성 — 실행 큐에서 확인하세요.`
          : '생성된 리밸런싱 주문이 없습니다.'}
      </p>
      {zeroReason && <p className="text-gray-400 mt-1">{zeroReason}</p>}
      {result.generated > 0 && (
        <p className="text-[11px] text-gray-500 mt-1">
          실행 큐의 「실행하기」로 실제 체결일·체결가·수량을 입력하면 매수/매도가 기록됩니다.
        </p>
      )}
      {skips.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-700">
          <p className="text-gray-400 mb-1">생성 안 된 카테고리:</p>
          <ul className="space-y-0.5">
            {skips.map((d, i) => (
              <li key={`${d.categoryId}-${i}`} className="text-gray-400">
                <span className="text-gray-200">{d.label}</span> ({d.direction}) — {SKIP_LABEL[d.reason as keyof typeof SKIP_LABEL] ?? d.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
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
    bandDeviations,
    rebalanceBandPct,
    categoryInstruments,
    handleInstrumentChange,
    coreHoldingsByCategory,
    hasUnsavedChanges,
  } = useRebalancing({
    assets,
    exchangeRates,
    allocationTargets: data.allocationTargets,
    onSave: actions.updateAllocationTargets,
    categories: data.categoryStore.categories,
  });

  // 리밸런싱 주문 생성 (Phase 4b-3b) — 저장본 기준, 명시적 버튼. useActionQueue는 별도 인스턴스(context 공유)
  const { refreshRebalanceActions, isGeneratingRebalance } = useActionQueue();
  const [genResult, setGenResult] = useState<GenResultData | null>(null);
  const handleGenerate = async () => {
    if (hasUnsavedChanges || isGeneratingRebalance) return;
    setGenResult(await refreshRebalanceActions());
  };

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

      {/* 코어 밴드 이탈 안내 (Phase 4a-2 — 표시 전용, 주문/수량/종목 없음). 이탈 0건이면 미표시 */}
      {bandDeviations.length > 0 && (
        <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
          <h3 className="text-sm font-bold text-amber-200 mb-1">밴드 이탈 안내 — 코어 카테고리 (±{rebalanceBandPct}%p)</h3>
          <p className="text-[11px] text-gray-400 mb-3">
            아래 코어 카테고리가 목표 비중에서 ±{rebalanceBandPct}%p 이상 벗어났습니다. <span className="text-gray-300">참고 안내</span>이며, 실제 주문·수량·종목은 다음 단계에서 다룹니다.
          </p>
          <ul className="space-y-1.5">
            {bandDeviations.map((d) => (
              <li key={d.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-xs">
                <span className="text-gray-200 font-medium">{d.label}</span>
                <span className="text-gray-400">
                  현재 {d.currentWeight.toFixed(1)}% → 목표 {d.targetWeight.toFixed(1)}%
                  <span className="text-gray-500"> (편차 {d.deviationPct > 0 ? '+' : ''}{d.deviationPct.toFixed(1)}%p)</span>
                </span>
                <span className={d.direction === 'BUY' ? 'text-red-300' : 'text-blue-300'}>
                  {d.direction === 'BUY' ? '목표 대비 부족' : '목표 대비 초과'} {formatKRW(Math.abs(d.difference))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ③ 대표 매수 종목 지정 (리밸런싱 매수용) — Phase 4b-1: 매핑 저장까지만, 주문 생성 없음 */}
      {core.rows.length > 0 && (
        <section>
          <h3 className="text-base font-bold text-white mb-1">③ 대표 매수 종목 지정 (코어 리밸런싱 매수용)</h3>
          <p className="text-xs text-gray-400 mb-3">
            각 코어 카테고리가 목표 대비 <span className="text-gray-300">부족할 때 어떤 종목을 살지</span> 미리 지정합니다.
            지정 후 <span className="text-gray-300">저장하기</span>를 눌러야 반영됩니다. (실제 주문·수량 계산은 다음 단계)
          </p>
          <ul className="divide-y divide-gray-700 border border-gray-700 rounded-md">
            {core.rows.map((row) => (
              <InstrumentRow
                key={row.key}
                categoryKey={row.key}
                categoryLabel={row.label}
                categoryId={Number(row.key)}
                instrument={categoryInstruments[row.key]}
                holdings={coreHoldingsByCategory[row.key] ?? []}
                exchanges={getExchangesForCategory(Number(row.key), data.categoryStore.categories)}
                onChange={handleInstrumentChange}
              />
            ))}
          </ul>

          {/* 리밸런싱 주문 생성 (Phase 4b-3b) — 저장본 기준, 미저장 변경 시 비활성 */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={hasUnsavedChanges || isGeneratingRebalance}
              className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={hasUnsavedChanges ? '변경사항을 먼저 저장하세요' : '저장된 목표 기준으로 리밸런싱 주문을 생성합니다'}
            >
              {isGeneratingRebalance ? '생성 중...' : '리밸런싱 주문 생성'}
            </button>
            {hasUnsavedChanges && <span className="text-xs text-amber-300">저장 후 생성 — 미저장 변경이 있습니다.</span>}
          </div>

          {/* 생성 대상 범위 안내 (4b-3c — 항상 표시) */}
          <p className="mt-2 text-[11px] text-gray-500">
            리밸런싱 주문은 <span className="text-gray-400">② 코어 카테고리의 ±5%p 밴드 이탈만</span> 대상입니다.
            <span className="text-gray-400"> ① 전략 배분(코어/투더문) 이탈은 현재 주문 생성 대상이 아닙니다.</span>
            {' '}코어 카테고리가 모두 밴드 안이면 주문이 없는 것이 정상입니다.
          </p>

          {genResult && <GenResult result={genResult} />}
        </section>
      )}

      {/* ④ 투더문 현황 (참고) */}
      {hasSatellite && (
        <section>
          <h3 className="text-base font-bold text-white mb-1">④ 투더문 현황 (참고)</h3>
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
