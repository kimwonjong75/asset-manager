// utils/tradePlanTransfer.ts
// ---------------------------------------------------------------------------
// 매수 전 계획(WatchlistItem.tradePlan, mode 'new-buy') → 실제 보유 자산(Asset) 계획 이전 (P2c).
// 계획서 §3.1 "매수 전 계획(스크린샷 흐름)": 관심종목 단계에서 세운 계획을 실제 매수를 기록하는
// 순간 자산으로 그대로 넘긴다 — 기준가/수량은 **실제 체결값**으로 갱신하고, 사용자가 고른 설정
// (리스크%·손절폭·익절배수·추세선·불타기·손절주문 등록 여부·메모)은 그대로 보존한다.
//
// 상태 전이 규칙을 다시 구현하지 않는다 — `buildTradePlan`(utils/tradePlan.ts) 한 곳만 다시 호출해
// mode='holding'·anchor='purchase'로 재구축한다(TradePlanEditor가 "보유 종목 계획"을 만드는 것과
// 정확히 같은 경로). side effect 금지 · Date.now 금지(now 주입) · any 금지.

import type { Asset, WatchlistItem } from '../types';
import { normalizeExchange } from '../types';
import { isBaseType } from '../types/category';
import { buildTradePlan } from './tradePlan';
import type { TradePlan, TradePlanBuildInput } from '../types/tradePlan';

export interface TransferWatchPlanOptions {
  /** KRW/1단위 환율. KRW=1, 미지원 통화(CNY 등)는 null(`utils/tradePlanMarket.fxRateToKRWFor`) */
  fxRateToKRW: number | null;
  /** ISO 시각 — 순수 함수라 주입한다(Date.now 금지). */
  now: string;
  /** 이전 시점 총자산(KRW). 보통 `derived.totalValue`. */
  totalEquityKRW: number;
}

/**
 * 관심종목의 매수 전 계획(`watchPlan`)을 실제 매수 자산(`asset`) 계획으로 재구축한다.
 *   · anchor='purchase' → anchorPrice=asset.purchasePrice, anchorDate=asset.purchaseDate
 *   · mode='holding' → holdingQuantity=asset.quantity(실제 체결 수량)
 *   · 보존: riskPct·stopPct·profitMultiple·exitLine·exitLineArmMode·pyramid 설정
 *     (stepUnit/step/sizing/maxAdds)·brokerStopOrderRegistered·memo
 * 빌드 실패(기준가/수량 등 유효성 오류) 시 null — 호출부는 실패해도 자산 추가 자체는 되돌리지 않는다.
 */
export function transferWatchPlanToAsset(
  watchPlan: TradePlan,
  asset: Asset,
  opts: TransferWatchPlanOptions
): TradePlan | null {
  const input: TradePlanBuildInput = {
    mode: 'holding',
    anchor: 'purchase',
    anchorPrice: asset.purchasePrice,
    anchorDate: asset.purchaseDate,
    currency: asset.currency,
    totalEquityKRW: opts.totalEquityKRW,
    riskPct: watchPlan.riskPct,
    stopPct: watchPlan.stopPct,
    profitMultiple: watchPlan.profitMultiple,
    exitLine: watchPlan.exitLine,
    exitLineArmMode: watchPlan.exitLineArmMode,
    pyramid: {
      enabled: watchPlan.pyramid.enabled,
      stepUnit: watchPlan.pyramid.stepUnit,
      step: watchPlan.pyramid.step,
      sizing: watchPlan.pyramid.sizing,
      maxAdds: watchPlan.pyramid.maxAdds,
    },
    holdingQuantity: asset.quantity,
    fxRateToKRW: opts.fxRateToKRW,
    allowFractional: isBaseType(asset.categoryId, 'CRYPTOCURRENCY'),
    now: opts.now,
    brokerStopOrderRegistered: watchPlan.brokerStopOrderRegistered,
  };
  const result = buildTradePlan(input);
  if (!result.ok) return null;
  return watchPlan.memo !== undefined ? { ...result.plan, memo: watchPlan.memo } : result.plan;
}

/**
 * 새로 추가된 자산과 짝이 맞는 관심종목 항목을 찾는다(티커+거래소, `normalizeExchange` 정규화).
 * 같은 티커라도 계정(owner)이 다르면 별개 보유일 수 있으나, 관심종목은 계정 축이 없으므로
 * (관심종목은 "아직 사지 않은 상태"라 owner 개념이 성립하지 않음) 티커+거래소만으로 매칭한다.
 */
export function findWatchItemForAsset(
  watchlist: WatchlistItem[],
  asset: Pick<Asset, 'ticker' | 'exchange'>
): WatchlistItem | undefined {
  const ticker = asset.ticker.toUpperCase();
  const exchange = normalizeExchange(asset.exchange);
  return watchlist.find(
    w => w.ticker.toUpperCase() === ticker && normalizeExchange(w.exchange) === exchange
  );
}
