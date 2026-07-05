// utils/turtlePositionView.ts
// ---------------------------------------------------------------------------
// 터틀 오픈 포지션의 "읽기 전용 표시 모델" + KRW 리스크 게이지 (Phase 2b-5, 순수 함수).
//
// 통화 규약(D6):
//   · 가격-공간(entry/stop/N/pyramid trigger/entryDonchianHigh) = 종목 통화(원통화) 그대로 표시.
//   · 돈-공간(리스크 게이지, 오픈리스크, 12% 한도) = KRW. 원통화 리스크 × fxRate로 환산.
//
// fail-safe (Codex 지시): 외화 포지션의 환율을 확보하지 못하면(예: CNY — ExchangeRates에 없음),
//   리스크를 fx=1로 과소평가하지 말고 **미해결로 분리**해 게이지에서 제외 + 플래그로 노출한다.
//   (엔진 computeTotalOpenRisk를 resolver 없이 부르면 전부 fx=1이 되어 외화 리스크를 왜곡 → 여기서 차단.)
//
// 포지션 매칭: **assetId만 신뢰**(ticker fallback 없음). 표시 맵은 assetId 키, closed 제외.

import { Asset, Currency, ExchangeRates } from '../types';
import { TurtlePosition, TurtleSettings } from '../types/turtle';
import { positionQuantity, positionRiskAtStop } from './turtleEngine';

export interface TurtlePositionView {
  positionId: string;
  ticker: string;
  currency: Currency;          // 가격-공간 표시 통화
  unitsCount: number;          // 현재 유닛 수
  maxUnits: number;            // 설정 상한 (n/max 표시)
  totalQuantity: number;       // 전 유닛 합 보유 수량
  entryPrice: number;          // 최초 진입가 units[0] (원통화)
  lastFillPrice: number;       // 마지막 체결가 (피라미딩 트리거 기준, 원통화)
  stopPrice: number;           // 공통 손절가 (원통화)
  nAtLastFill: number;         // 마지막 유닛 N (원통화)
  entryDonchianHigh: number;   // 진입 돌파 채널 (원통화)
  pyramidTriggerPrice: number | null; // 다음 불타기 트리거 = lastFill + pyramidStepN×N (유닛 여유 있을 때만)
  riskOriginal: number;        // 원통화 리스크 = max(0, Σ qty×(fill−stop))
  fxRate: number | null;       // KRW/종목통화 (KRW=1, 미확보=null)
  riskKRW: number | null;      // riskOriginal × fxRate (fx 미확보면 null)
}

export interface TurtleRiskGaugeModel {
  budgetKRW: number;           // 위성 예산 (리스크 % 분모)
  limitPct: number;            // maxTotalRiskPct (동시 전멸 한도)
  openRiskKRW: number;         // 환율 확보된 포지션들의 오픈리스크 합 (KRW)
  riskPct: number | null;      // openRiskKRW / budget × 100 (budget<=0이면 null)
  openPositionCount: number;   // 오픈 포지션 총수
  resolvedCount: number;       // 환율 확보되어 합산된 포지션 수
  unresolved: { ticker: string; currency: Currency | null }[]; // 환율 미확보(게이지 제외) — 실제 리스크는 표시보다 큼
  hasUnresolved: boolean;
}

/**
 * 종목 통화 → KRW 환율 (KRW=1). 외화인데 rate 미보유/≤0이면 null.
 * ExchangeRates는 USD/JPY만 보유 → CNY 등은 null(fail-safe: 과소평가 금지).
 */
export function resolvePositionFxRate(currency: Currency | undefined, rates: ExchangeRates): number | null {
  if (currency === Currency.KRW) return 1;
  if (currency === Currency.USD) return rates.USD > 0 ? rates.USD : null;
  if (currency === Currency.JPY) return rates.JPY > 0 ? rates.JPY : null;
  return null; // CNY·통화 미상 등
}

/**
 * 오픈 포지션 → assetId 키 표시 모델 맵.
 * assetId 없는 포지션은 제외(표시할 자산 행이 없음), closed 제외.
 */
export function buildTurtlePositionViews(
  positions: TurtlePosition[],
  assets: Asset[],
  rates: ExchangeRates,
  settings: TurtleSettings
): Map<string, TurtlePositionView> {
  const assetById = new Map<string, Asset>();
  for (const a of assets) assetById.set(a.id, a);

  const map = new Map<string, TurtlePositionView>();
  for (const p of positions) {
    if (p.status !== 'open' || !p.assetId) continue;
    const asset = assetById.get(p.assetId);
    const currency = asset?.currency;
    const fxRate = resolvePositionFxRate(currency, rates);
    const riskOriginal = positionRiskAtStop(p, 1); // fx=1 → 원통화 raw max(0,·)
    const lastUnit = p.units[p.units.length - 1];
    const firstUnit = p.units[0];
    const nAtLastFill = lastUnit?.nAtFill ?? 0;
    const unitsCount = p.units.length;
    const canPyramid = unitsCount < settings.maxUnitsPerPosition;
    const pyramidTriggerPrice =
      canPyramid && lastUnit && nAtLastFill > 0
        ? lastUnit.fillPrice + settings.pyramidStepN * nAtLastFill
        : null;

    map.set(p.assetId, {
      positionId: p.id,
      ticker: p.ticker,
      currency: currency ?? Currency.KRW,
      unitsCount,
      maxUnits: settings.maxUnitsPerPosition,
      totalQuantity: positionQuantity(p),
      entryPrice: firstUnit?.fillPrice ?? 0,
      lastFillPrice: lastUnit?.fillPrice ?? 0,
      stopPrice: p.stopPrice,
      nAtLastFill,
      entryDonchianHigh: p.entryDonchianHigh,
      pyramidTriggerPrice,
      riskOriginal,
      fxRate,
      riskKRW: fxRate != null ? riskOriginal * fxRate : null,
    });
  }
  return map;
}

/**
 * 전 오픈 포지션의 KRW 리스크 게이지 (per-position fxRate로 정확 환산 + fail-safe).
 * 환율 미확보 포지션은 합산에서 제외하고 unresolved로 분리 — 게이지는 "≥ 표시값"임을 UI가 알려야 한다.
 */
export function computeTurtleRiskGauge(
  positions: TurtlePosition[],
  assets: Asset[],
  rates: ExchangeRates,
  settings: TurtleSettings
): TurtleRiskGaugeModel {
  const assetById = new Map<string, Asset>();
  for (const a of assets) assetById.set(a.id, a);

  const open = positions.filter(p => p.status === 'open');
  let openRiskKRW = 0;
  const unresolved: { ticker: string; currency: Currency | null }[] = [];

  for (const p of open) {
    const asset = p.assetId ? assetById.get(p.assetId) : undefined;
    const currency = asset?.currency;
    const fxRate = resolvePositionFxRate(currency, rates);
    if (fxRate == null) {
      unresolved.push({ ticker: p.ticker, currency: currency ?? null });
      continue;
    }
    openRiskKRW += positionRiskAtStop(p, fxRate);
  }

  const budgetKRW = settings.satelliteBudgetKRW;
  return {
    budgetKRW,
    limitPct: settings.maxTotalRiskPct,
    openRiskKRW,
    riskPct: budgetKRW > 0 ? (openRiskKRW / budgetKRW) * 100 : null,
    openPositionCount: open.length,
    resolvedCount: open.length - unresolved.length,
    unresolved,
    hasUnresolved: unresolved.length > 0,
  };
}
