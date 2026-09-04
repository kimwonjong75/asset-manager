// hooks/useTradePlanSignals.ts
// ---------------------------------------------------------------------------
// 활성 매매 계획(TradePlan)을 현재 시세/지표로 평가해 "오늘 무엇을 해야 하는가" 행을 만든다.
// 계산은 여기(훅), 렌더는 components/trade-plan/*(컴포넌트) — RULES.md §2.
//
// 입력은 PortfolioContext의 파생 상태(assets/enrichedMap/priceDataAsOf)를 그대로 받는다
// (usePortfolio() 대신 props 주입 — useAutoAlert/useTurtleActionReview와 동일 패턴, Context
// Provider 내부에서 호출되므로 자기 자신을 구독할 수 없다).
//
// `now`는 훅 내부에서 매 memo 계산 시 `new Date().toISOString()`으로 읽는다(순수 유틸은 시각을
// 주입받아야 하지만, 훅은 시계를 읽을 수 있다 — utils/tradePlan.ts·utils/tradePlanMarket.ts는
// 여전히 순수하다). deps는 실제로 재계산을 유발해야 하는 값(assets/enrichedMap/priceDataAsOf)만.

import { useMemo } from 'react';
import type { Asset } from '../types';
import type { EnrichedIndicatorData } from './useEnrichedIndicators';
import type { PlanTier, TradePlan, TradePlanEvaluation, TradePlanMarket } from '../types/tradePlan';
import { evaluateTradePlan, isEligibleForBulkPlan } from '../utils/tradePlan';
import {
  buildTradePlanMarket,
  summarizeTradePlanSignals,
  type TradePlanSignalSummary,
} from '../utils/tradePlanMarket';

/** 활성 계획 1건의 평가 행 — 오늘 화면·아코디언 카드가 공유하는 단일 소스. */
export interface TradePlanSignalRow {
  asset: Asset;
  plan: TradePlan;
  evaluation: TradePlanEvaluation;
  market: TradePlanMarket;
}

interface UseTradePlanSignalsInput {
  assets: Asset[];
  enrichedMap: Map<string, EnrichedIndicatorData>;
  /** `derived.priceDataAsOf` — 마지막 시세 갱신 완료 시각(ISO) */
  priceDataAsOf: string | null;
}

interface UseTradePlanSignalsResult {
  /** 활성 계획 평가 행 — 긴급→오늘 실행→준비→대기 순, 동일 등급은 손절선까지 여유(%) 오름차순 */
  rows: TradePlanSignalRow[];
  summary: TradePlanSignalSummary;
  /** 일괄 계획 마법사 대상(투더문 보유 中 계획 없음) — `utils/tradePlan.isEligibleForBulkPlan` */
  planlessSatellites: Asset[];
}

const TIER_ORDER: Record<PlanTier, number> = { urgent: 0, today: 1, prepare: 2, none: 3 };

export function useTradePlanSignals({
  assets,
  enrichedMap,
  priceDataAsOf,
}: UseTradePlanSignalsInput): UseTradePlanSignalsResult {
  const rows = useMemo<TradePlanSignalRow[]>(() => {
    const now = new Date().toISOString();
    const list: TradePlanSignalRow[] = [];
    for (const asset of assets) {
      const plan = asset.tradePlan;
      if (!plan || plan.status !== 'active') continue;
      const enriched = enrichedMap.get(asset.ticker);
      const market = buildTradePlanMarket({
        priceOriginal: asset.priceOriginal,
        exchange: asset.exchange,
        enriched,
        priceDataAsOf,
        now,
      });
      const evaluation = evaluateTradePlan(plan, market);
      list.push({ asset, plan, evaluation, market });
    }
    list.sort((a, b) => {
      const tierDiff = TIER_ORDER[a.evaluation.tier] - TIER_ORDER[b.evaluation.tier];
      if (tierDiff !== 0) return tierDiff;
      const da = a.evaluation.distanceToStopPct;
      const db = b.evaluation.distanceToStopPct;
      if (da === null && db === null) return 0;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
    return list;
  }, [assets, enrichedMap, priceDataAsOf]);

  const summary = useMemo(() => summarizeTradePlanSignals(rows), [rows]);

  const planlessSatellites = useMemo(
    () => assets.filter(a => isEligibleForBulkPlan(a)),
    [assets],
  );

  return { rows, summary, planlessSatellites };
}
