// components/trade-plan/TradePlanSection.tsx
// 종목별 "매매 계획" 컨테이너 — 4개 마운트 지점(포트폴리오 데스크탑/모바일, 관심종목 데스크탑/모바일)
// 위에 `<StockReviewAccordion>`처럼 얹는다. 계획 있으면 카드, 없으면 "계획 만들기" 압축 행 → 인라인 편집기.
// 자체 상태(펼침/편집)만 갖고, 컨텍스트 값(enrichedMap/priceDataAsOf/환율/액션)은 이 컴포넌트가 직접
// usePortfolio()로 읽는다(관심종목 배선처는 .map() 내부라 이 컴포넌트 자체가 훅 캡슐화 경계).

import React, { useState } from 'react';
import { Currency } from '../../types';
import type { WatchlistItem } from '../../types';
import type { EnrichedAsset } from '../../types/ui';
import { usePortfolio } from '../../contexts/PortfolioContext';
import { evaluateTradePlan, armExitLine } from '../../utils/tradePlan';
import { buildTradePlanMarket, fxRateToKRWFor, type TradePlanTarget } from '../../utils/tradePlanMarket';
import { defaultSellOutcome } from '../../utils/tradePlanLink';
import type { TradePlan } from '../../types/tradePlan';
import TradePlanCard from './TradePlanCard';
import TradePlanEditor from './TradePlanEditor';

type TradePlanSectionProps =
  | { source: 'portfolio'; asset: EnrichedAsset; displayName: string; className?: string }
  | { source: 'watchlist'; watchItem: WatchlistItem; displayName: string; className?: string };

const TradePlanSection: React.FC<TradePlanSectionProps> = (props) => {
  const { source, className } = props;
  const { derived, data, actions } = usePortfolio();
  const [editing, setEditing] = useState(false);

  const ticker = source === 'portfolio' ? props.asset.ticker : props.watchItem.ticker;
  const exchange = source === 'portfolio' ? props.asset.exchange : props.watchItem.exchange;
  const currency: Currency = source === 'portfolio'
    ? props.asset.currency
    : (props.watchItem.currency ?? Currency.KRW);
  const priceOriginal = source === 'portfolio'
    ? props.asset.priceOriginal
    : (props.watchItem.priceOriginal ?? props.watchItem.currentPrice ?? 0);
  const plan: TradePlan | undefined = source === 'portfolio' ? props.asset.tradePlan : props.watchItem.tradePlan;
  const isActive = !!plan && plan.status === 'active';
  const target: TradePlanTarget = source === 'portfolio' ? { kind: 'asset', asset: props.asset } : { kind: 'watch', item: props.watchItem };
  const fxRateToKRW = fxRateToKRWFor(currency, data.exchangeRates);

  const handleSave = (nextPlan: TradePlan) => {
    if (source === 'portfolio') actions.saveTradePlan(props.asset.id, nextPlan);
    else actions.saveWatchTradePlan(props.watchItem.id, nextPlan);
    setEditing(false);
  };

  const handleClear = () => {
    if (source === 'portfolio') actions.clearTradePlan(props.asset.id);
    else actions.saveWatchTradePlan(props.watchItem.id, null);
  };

  const handleArmExit = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (source === 'portfolio') {
      actions.armTradePlanExitLine(props.asset.id, today);
    } else if (plan) {
      actions.saveWatchTradePlan(props.watchItem.id, armExitLine(plan, today));
    }
  };

  const handleToggleBrokerStop = (registered: boolean) => {
    if (source === 'portfolio') {
      actions.setTradePlanBrokerStop(props.asset.id, registered);
    } else if (plan) {
      actions.saveWatchTradePlan(props.watchItem.id, {
        ...plan, brokerStopOrderRegistered: registered, updatedAt: new Date().toISOString(),
      });
    }
  };

  if (!isActive) {
    return (
      <div className={className}>
        {!editing ? (
          <div className="mt-1.5 flex items-center gap-2 text-xs">
            <span className="text-gray-500">매매 계획 없음</span>
            <button type="button" onClick={() => setEditing(true)} className="text-primary-light hover:underline font-medium">
              계획 만들기
            </button>
          </div>
        ) : (
          <div className="mt-2">
            <TradePlanEditor target={target} onSave={handleSave} onCancel={() => setEditing(false)} />
          </div>
        )}
      </div>
    );
  }

  if (editing) {
    return (
      <div className={className}>
        <div className="mt-2">
          <TradePlanEditor target={target} existingPlan={plan} onSave={handleSave} onCancel={() => setEditing(false)} />
        </div>
      </div>
    );
  }

  const enriched = derived.enrichedMap.get(ticker);
  const now = new Date().toISOString();
  const market = buildTradePlanMarket({ priceOriginal, exchange, enriched, priceDataAsOf: derived.priceDataAsOf, now });
  const evaluation = evaluateTradePlan(plan as TradePlan, market);

  // 실행 핸들러(P2b) — 아래 카드가 실제로 렌더될 때만 도달하는 평범한 클로저다(훅 아님).
  // `evaluation`이 여기서야 계산되므로 조기 반환들보다 아래에 둔다. 포트폴리오 소스에서만 배선된다.
  const handleSellRecord = () => {
    if (source !== 'portfolio') return;
    actions.openSellWithPlan(props.asset.id, defaultSellOutcome(evaluation));
  };
  const handleBuyMoreRecord = () => {
    if (source !== 'portfolio') return;
    actions.openBuyModal(props.asset);
  };
  const handleSkip = (reason: string) => {
    if (source !== 'portfolio') return;
    const today = new Date().toISOString().slice(0, 10);
    actions.recordTradePlanDecision(props.asset.id, { date: today, signal: evaluation.signal, choice: 'skip', reason });
  };
  const handleTomorrow = () => {
    if (source !== 'portfolio') return;
    const today = new Date().toISOString().slice(0, 10);
    actions.recordTradePlanDecision(props.asset.id, { date: today, signal: evaluation.signal, choice: 'tomorrow' });
  };

  return (
    <div className={className}>
      <div className="mt-2">
        <TradePlanCard
          currency={currency}
          plan={plan as TradePlan}
          evaluation={evaluation}
          priceAsOf={market.priceAsOf}
          isIntraday={market.isIntraday}
          fxRateToKRW={fxRateToKRW}
          onEdit={() => setEditing(true)}
          onClear={handleClear}
          onArmExit={handleArmExit}
          onToggleBrokerStop={handleToggleBrokerStop}
          {...(source === 'portfolio' ? {
            onSellRecord: handleSellRecord,
            onBuyMoreRecord: handleBuyMoreRecord,
            onSkip: handleSkip,
            onTomorrow: handleTomorrow,
          } : {})}
        />
      </div>
    </div>
  );
};

export default TradePlanSection;
