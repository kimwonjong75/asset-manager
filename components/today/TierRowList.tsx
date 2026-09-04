// components/today/TierRowList.tsx
// 등급 섹션(Urgent/Today/Prepare) 공용 행 렌더러 — 렌더 전용(RULES.md §2).
// TradePlanSignalRow 배열을 받아 TradePlanCard(variant="compact")로 그린다.
// 핸들러 배선은 `components/trade-plan/TradePlanSection.tsx`의 P2b 배선과 동일 규약
// (portfolio 소스 전용 액션들 — 오늘 화면은 항상 보유 자산이므로 넷 다 항상 전달한다).
// [수정]은 보유자산 탭으로 이동 + 해당 종목 포커스(계획서 §4.3 "간단히" 지침).

import React from 'react';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { fxRateToKRWFor } from '../../utils/tradePlanMarket';
import { defaultSellOutcome } from '../../utils/tradePlanLink';
import type { TradePlanSignalRow } from '../../hooks/useTradePlanSignals';
import TradePlanCard from '../trade-plan/TradePlanCard';

export interface TierRowListProps {
  rows: TradePlanSignalRow[];
}

const TierRowList: React.FC<TierRowListProps> = ({ rows }) => {
  const { data, actions } = usePortfolio();

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      {rows.map(row => {
        const { asset, plan, evaluation, market } = row;
        const fxRateToKRW = fxRateToKRWFor(asset.currency, data.exchangeRates);
        const today = new Date().toISOString().slice(0, 10);
        return (
          <TradePlanCard
            key={asset.id}
            variant="compact"
            assetName={asset.name}
            currentPrice={market.price}
            currency={asset.currency}
            plan={plan}
            evaluation={evaluation}
            priceAsOf={market.priceAsOf}
            isIntraday={market.isIntraday}
            fxRateToKRW={fxRateToKRW}
            onEdit={() => { actions.setActiveTab('portfolio'); actions.setFocusedAssetId(asset.id); }}
            onClear={() => actions.clearTradePlan(asset.id)}
            onArmExit={() => actions.armTradePlanExitLine(asset.id, today)}
            onToggleBrokerStop={(registered) => actions.setTradePlanBrokerStop(asset.id, registered)}
            onSellRecord={() => actions.openSellWithPlan(asset.id, defaultSellOutcome(evaluation))}
            onBuyMoreRecord={() => actions.openBuyModal(asset)}
            onSkip={(reason) => actions.recordTradePlanDecision(asset.id, { date: today, signal: evaluation.signal, choice: 'skip', reason })}
            onTomorrow={() => actions.recordTradePlanDecision(asset.id, { date: today, signal: evaluation.signal, choice: 'tomorrow' })}
          />
        );
      })}
    </div>
  );
};

export default TierRowList;
