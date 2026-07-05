// utils/cleanupPlan.ts
// ---------------------------------------------------------------------------
// Phase 3 대청소 순수 계산 (3a) — 후보 선정 · 자동 제안 · 세금 참고 추정.
// side effect·any·Date 없음(연도는 주입). 저장·주문 생성·UI는 이후 단계(3b~3d).
//
// 프레이밍(가드): 이 손실은 이미 발생 — 여기 계산은 "앞으로 이 자금을 어디 둘지"의 근거일 뿐.
// 세금 추정은 전부 참고용(확정 세무 판단 아님).

import { Asset, Currency, ExchangeRates, SellRecord, WatchlistItem, normalizeExchange } from '../types';
import { EnrichedAsset } from '../types/ui';
import { getAssetBucket } from '../types/bucket';
import { ActionItem, isActiveAction } from '../types/actionQueue';
import {
  CleanupCandidate,
  CleanupCandidateFlags,
  CleanupDecision,
  CleanupSelectionOptions,
  CleanupTag,
  CleanupTaxEstimate,
} from '../types/cleanup';

const DEFAULT_DEEP_LOSS_PCT = -50;
const DEFAULT_DUST_PCT = 1;
const DEFAULT_BASIC_DEDUCTION_KRW = 2_500_000; // 해외주식 양도세 기본공제(연 250만)
const DEFAULT_FOREIGN_TAX_RATE = 0.22;         // 22%(지방세 포함 관행치, 참고용)

const MAX_REASONABLE_EXCHANGE_RATES: Partial<Record<Currency, number>> = {
  [Currency.USD]: 3000,
  [Currency.JPY]: 50,
  [Currency.CNY]: 400,
};

// ── 후보 선정 + 자동 제안 ──────────────────────────────────────────────

/**
 * 자동 제안 태그 (보수적) — core/turtle은 사용자 판단이라 자동 제안하지 않는다.
 * 명확한 정리 케이스만 liquidate, 나머지는 keep.
 */
export function suggestCleanupTag(flags: CleanupCandidateFlags): { tag: CleanupTag; reason: string } {
  if (flags.deepLoss && flags.dust) return { tag: 'liquidate', reason: '-50% 이하 깊은 손실 + 총자산 1% 미만 — 정리 후보' };
  if (flags.deepLoss) return { tag: 'liquidate', reason: '-50% 이하 깊은 손실 — 재검토·정리 후보' };
  if (flags.dust && flags.loss) return { tag: 'liquidate', reason: '총자산 1% 미만 먼지 포지션(손실) — 정리 후보' };
  return { tag: 'keep', reason: '손실이나 규모·손실폭이 크지 않음 — 보류(직접 판단)' };
}

/**
 * 정리 위저드 후보 선정 (손실 또는 먼지 포지션). 순수.
 * @param isExcluded 가족('유선') 등 의사결정 밖 자산 제외 predicate (기본 미제외). 3b에서 excludedFromCleanup 주입.
 */
export function selectCleanupCandidates(
  assets: EnrichedAsset[],
  opts: CleanupSelectionOptions = {},
  isExcluded: (asset: EnrichedAsset) => boolean = () => false,
): CleanupCandidate[] {
  const deepLossPct = opts.deepLossThresholdPct ?? DEFAULT_DEEP_LOSS_PCT;
  const dustPct = opts.dustThresholdPct ?? DEFAULT_DUST_PCT;

  const out: CleanupCandidate[] = [];
  for (const a of assets) {
    if (isExcluded(a)) continue;
    const m = a.metrics;
    const loss = m.returnPercentage < 0;
    const dust = m.allocation < dustPct;
    if (!loss && !dust) continue; // 이익 + 유의미 비중 → 정리 대상 아님

    const flags: CleanupCandidateFlags = {
      loss,
      deepLoss: m.returnPercentage <= deepLossPct,
      dust,
      foreign: a.currency !== Currency.KRW,
    };
    const { tag, reason } = suggestCleanupTag(flags);
    out.push({
      assetId: a.id, ticker: a.ticker, name: a.name, categoryId: a.categoryId,
      currency: a.currency, bucket: getAssetBucket(a), quantity: a.quantity,
      currentValueKRW: m.currentValueKRW, profitLossKRW: m.profitLossKRW,
      returnPercentage: m.returnPercentage, allocationPct: m.allocation,
      flags, suggestedTag: tag, suggestReason: reason,
    });
  }
  return out;
}

// ── 일괄 분류 저장 (순수 mutation) ──────────────────────────────────────

/**
 * 자산 배열에 대청소 분류 결정을 적용해 **다음 assets 배열**을 만든다 (순수·불변).
 * 결정 없는 자산은 그대로 통과. 저장은 호출부가 `commitPortfolioPatch({ assets })`로 수행.
 *
 * 규칙:
 *   · cleanupTag는 명시된 경우에만 설정(미포함=변경 안 함 — 미검토 상태 보존).
 *   · 버킷 효과: core→'CORE', turtle→'SATELLITE'(정리 후 재진입 감시). liquidate/keep은 버킷 불변.
 *   · excludedFromCleanup: true면 설정, **false면 필드 제거**(false를 저장하지 않음 — 누락=false 해석).
 * ※ 'turtle' 결정의 관심종목(isTurtleCandidate) 등록은 watchlist 도메인이라 별도(3c 위저드 액션에서).
 */
export function applyCleanupDecisions(
  assets: Asset[],
  decisions: Record<string, CleanupDecision>,
): Asset[] {
  return assets.map(a => {
    const d = decisions[a.id];
    if (!d) return a;
    const next: Asset = { ...a };
    if (d.cleanupTag !== undefined) {
      next.cleanupTag = d.cleanupTag;
      if (d.cleanupTag === 'core') next.bucket = 'CORE';
      else if (d.cleanupTag === 'turtle') next.bucket = 'SATELLITE';
    }
    if (d.excludedFromCleanup !== undefined) {
      if (d.excludedFromCleanup) next.excludedFromCleanup = true;
      else delete next.excludedFromCleanup;
    }
    return next;
  });
}

// ── 대청소 원자 커밋 빌더 (Phase 3c-2, 순수) ────────────────────────────

export interface CleanupCommitContext {
  assets: Asset[];
  watchlist: WatchlistItem[];
  actionQueue: ActionItem[];
}
export interface CleanupCommitOptions {
  today: string;
  makeId: (seq: number) => string;
  /** assetId → 표시/스냅샷용 지표(수익률·평가손익). 미지정이면 reasonText는 일반 문구. */
  metricsOf?: (assetId: string) => { returnPct: number; profitLossKRW: number } | undefined;
}
export interface CleanupCommitResult {
  assets: Asset[];
  watchlist: WatchlistItem[];
  actionQueue: ActionItem[];
  summary: {
    watchRegistered: number;          // 관심종목 신규 등록 + 후보 갱신 수
    cleanupGenerated: number;         // 생성된 CLEANUP_SELL 수
    cleanupSkippedNoPrice: string[];  // 시세(priceOriginal) 없어 생성 못한 ticker
  };
}

/**
 * 대청소 저장의 **3도메인 next 상태**를 한 번에 계산 (순수). 저장은 호출부가 commitPortfolioPatch로.
 * 부수효과 트리거 범위 = **이번 저장에서 새로 turtle/liquidate로 바뀐 자산만**(이미 그 태그였으면 재처리 안 함).
 *   · turtle → 관심종목 등록: 같은 ticker+거래소 있으면 isTurtleCandidate만 갱신, 없으면 asset 메타로 신규(makeId).
 *             ※ 기존 보유분을 터틀 포지션으로 만들지 않음(positions 무접촉). priceOriginal 없으면 실행 큐 진입은 시세 갱신 후.
 *   · liquidate → CLEANUP_SELL pending 생성(전량·refPrice=priceOriginal). **quantity>0 && priceOriginal>0일 때만**,
 *             같은 assetId active(pending/snoozed) CLEANUP_SELL 있으면 중복 생성 안 함. 실행은 3d.
 */
export function buildCleanupCommit(
  decisions: Record<string, CleanupDecision>,
  ctx: CleanupCommitContext,
  opts: CleanupCommitOptions,
): CleanupCommitResult {
  const priorById = new Map(ctx.assets.map(a => [a.id, a]));
  const nextAssets = applyCleanupDecisions(ctx.assets, decisions);

  // 이번 저장에서 태그가 새로 바뀐 자산만
  const newlyTurtle: Asset[] = [];
  const newlyLiquidate: Asset[] = [];
  for (const [id, d] of Object.entries(decisions)) {
    if (d.cleanupTag === undefined) continue;
    const prior = priorById.get(id);
    if (!prior || d.cleanupTag === prior.cleanupTag) continue;
    if (d.cleanupTag === 'turtle') newlyTurtle.push(prior);
    else if (d.cleanupTag === 'liquidate') newlyLiquidate.push(prior);
  }

  let seq = 0;
  let watchlist = ctx.watchlist;
  let watchRegistered = 0;

  for (const a of newlyTurtle) {
    const idx = watchlist.findIndex(
      w => w.ticker.toUpperCase() === a.ticker.toUpperCase() && normalizeExchange(w.exchange) === normalizeExchange(a.exchange),
    );
    if (idx >= 0) {
      if (!watchlist[idx].isTurtleCandidate) {
        watchlist = watchlist.map((w, i) => (i === idx ? { ...w, isTurtleCandidate: true } : w));
        watchRegistered++;
      }
      // 이미 후보면 no-op (재등록 아님)
    } else {
      const item: WatchlistItem = {
        id: opts.makeId(seq++),
        ticker: a.ticker,
        exchange: a.exchange,
        name: a.name,
        categoryId: a.categoryId,
        currency: a.currency,
        priceOriginal: a.priceOriginal > 0 ? a.priceOriginal : undefined,
        isTurtleCandidate: true,
      };
      watchlist = [...watchlist, item];
      watchRegistered++;
    }
  }

  let actionQueue = ctx.actionQueue;
  let cleanupGenerated = 0;
  const cleanupSkippedNoPrice: string[] = [];
  const activeCleanupAssetIds = new Set(
    ctx.actionQueue
      .filter(it => it.kind === 'CLEANUP_SELL' && isActiveAction(it.status) && it.assetId)
      .map(it => it.assetId as string),
  );

  const generated: ActionItem[] = [];
  for (const a of newlyLiquidate) {
    if (!(a.quantity > 0) || !(a.priceOriginal > 0)) { cleanupSkippedNoPrice.push(a.ticker); continue; }
    if (activeCleanupAssetIds.has(a.id)) continue; // 이미 대기 중
    activeCleanupAssetIds.add(a.id);
    const m = opts.metricsOf?.(a.id);
    const snapshot: Record<string, number> = { quantity: a.quantity, refPrice: a.priceOriginal };
    if (m) { snapshot.returnPct = m.returnPct; snapshot.profitLossKRW = m.profitLossKRW; }
    generated.push({
      id: opts.makeId(seq++),
      createdDate: opts.today,
      kind: 'CLEANUP_SELL',
      ticker: a.ticker,
      name: a.name,
      assetId: a.id,
      quantity: a.quantity,
      refPrice: a.priceOriginal,
      reasonText: m
        ? `대청소 청산 — 전량 매도 검토 (수익률 ${m.returnPct.toFixed(1)}%)`
        : '대청소 청산 — 전량 매도 검토',
      ruleSnapshot: snapshot,
      status: 'pending',
    });
    cleanupGenerated++;
  }
  if (generated.length > 0) actionQueue = [...actionQueue, ...generated];

  return {
    assets: nextAssets,
    watchlist,
    actionQueue,
    summary: { watchRegistered, cleanupGenerated, cleanupSkippedNoPrice },
  };
}

// ── 해외주식 양도세 통산 추정 (참고용) ──────────────────────────────────

/** 해외(양도세 통산 대상) 판정 — settlementCurrency/통화가 KRW가 아니면 해외로 본다. */
export function isForeignSettlement(currency: Currency | undefined): boolean {
  return currency != null && currency !== Currency.KRW;
}

/** SellRecord 1건의 KRW 매도금액 (비정상 환율 보정 포함 — usePortfolioCalculator와 동일 규칙). */
function sellAmountKRW(record: SellRecord, rates: ExchangeRates): number {
  const currency = record.settlementCurrency;
  if (currency && currency !== Currency.KRW && record.sellPriceOriginal && record.sellPriceOriginal > 0) {
    const maxRate = MAX_REASONABLE_EXCHANGE_RATES[currency];
    if (maxRate && record.sellExchangeRate && record.sellExchangeRate > maxRate) {
      const currentRate = currency === Currency.USD ? (rates.USD || 0)
        : currency === Currency.JPY ? (rates.JPY || 0) : 0;
      if (currentRate > 0) return record.sellPriceOriginal * currentRate * record.sellQuantity;
    }
  }
  return record.sellPrice * record.sellQuantity;
}

/** SellRecord 1건의 KRW 매수원가 (원본 매수정보 우선, 없으면 보유자산, 둘 다 없으면 0수익 처리). */
function purchaseValueForSoldKRW(record: SellRecord, assets: Asset[]): number {
  if (record.originalPurchasePrice && record.originalPurchasePrice > 0) {
    const purchasePrice = record.originalPurchasePrice;
    const rate = record.originalPurchaseExchangeRate || 1;
    const currency = record.originalCurrency || Currency.KRW;
    return currency === Currency.KRW ? purchasePrice * record.sellQuantity : purchasePrice * rate * record.sellQuantity;
  }
  const asset = assets.find(a => a.id === record.assetId);
  if (asset) {
    if (asset.currency === Currency.KRW) return asset.purchasePrice * record.sellQuantity;
    if (asset.purchaseExchangeRate) return asset.purchasePrice * asset.purchaseExchangeRate * record.sellQuantity;
    if (asset.priceOriginal > 0) return asset.purchasePrice * (asset.currentPrice / asset.priceOriginal) * record.sellQuantity;
    return asset.purchasePrice * record.sellQuantity;
  }
  return sellAmountKRW(record, { USD: 0, JPY: 0 }); // 정보 없음 → 수익 0 처리(매수=매도)
}

/**
 * 특정 연도 실현 해외손익 합 (KRW). year는 주입(순수). sellDate 앞 4자리로 연도 매칭.
 * 해외 판정은 settlementCurrency(없으면 originalCurrency) ≠ KRW.
 */
export function realizedForeignGainYTD(
  sellHistory: SellRecord[],
  assets: Asset[],
  rates: ExchangeRates,
  year: number,
): number {
  const yr = String(year);
  return sellHistory
    .filter(r => isForeignSettlement(r.settlementCurrency ?? r.originalCurrency) && (r.sellDate ?? '').slice(0, 4) === yr)
    .reduce((sum, r) => sum + (sellAmountKRW(r, rates) - purchaseValueForSoldKRW(r, assets)), 0);
}

/** 청산 예정 후보 중 해외 종목의 미실현손익 합 (KRW). plannedIds에 포함된 후보만. */
export function plannedForeignGainKRW(candidates: CleanupCandidate[], plannedIds: Set<string>): number {
  return candidates
    .filter(c => c.flags.foreign && plannedIds.has(c.assetId))
    .reduce((sum, c) => sum + c.profitLossKRW, 0);
}

/**
 * 해외주식 양도세 + 손실 통산 절감 추정 (참고용).
 * taxable = max(0, 실현+예정 − 기본공제), 세금 = taxable×rate.
 * offsetSavings = (예정 없이 낼 세금) − (예정 포함 세금) — 청산 손실이 이익과 통산돼 줄어든 금액.
 */
export function estimateForeignCapGainsTax(input: {
  realizedForeignGainKRW: number;
  plannedForeignGainKRW: number;
  year: number;
  basicDeductionKRW?: number;
  rate?: number;
}): CleanupTaxEstimate {
  const basicDeductionKRW = input.basicDeductionKRW ?? DEFAULT_BASIC_DEDUCTION_KRW;
  const rate = input.rate ?? DEFAULT_FOREIGN_TAX_RATE;
  const realized = input.realizedForeignGainKRW;
  const planned = input.plannedForeignGainKRW;
  const net = realized + planned;

  const taxableKRW = Math.max(0, net - basicDeductionKRW);
  const estimatedTaxKRW = taxableKRW * rate;

  const taxWithoutPlanned = Math.max(0, realized - basicDeductionKRW) * rate;
  const offsetSavingsKRW = Math.max(0, taxWithoutPlanned - estimatedTaxKRW);

  return {
    year: input.year,
    realizedForeignGainKRW: realized,
    plannedForeignGainKRW: planned,
    netForeignGainKRW: net,
    basicDeductionKRW,
    taxableKRW,
    estimatedTaxKRW,
    offsetSavingsKRW,
    rate,
    isReference: true,
  };
}
