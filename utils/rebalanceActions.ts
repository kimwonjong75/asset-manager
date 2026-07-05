// utils/rebalanceActions.ts
// ---------------------------------------------------------------------------
// 코어 리밸런싱 주문 생성기 (Phase 4b-2, 순수 함수).
//
// 범위(4b-2): 밴드 이탈(4a) + 대표 종목 매핑(4b-1)을 받아 `REBALANCE_BUY/SELL` ActionItem으로 번역.
//   · 가격 fetch 없음 — 미보유 대표종목 가격은 **`marketByInstrument`로 주입**받는다(4b-3에서 fetch로 채움).
//   · 밴드 0건이면 0건. 미지정/무가격/FX미지원/무보유/0수량은 **해당 카테고리만 스킵 + diagnostics 사유**.
//   · dedup은 **categoryId 기준**(ticker 아님) — active REBALANCE_* 있으면 스킵.
//   · 통화 규약(D6): refPrice=원통화, 금액/차액=KRW, fxRate는 수량 번역에만.
//   · 라운딩: 일반 자산 floor, 암호화폐만 소수(8자리 내림).
//
// UI·저장·fetch·버튼 없음(4b-3+). 이 함수는 계산만 한다.

import { Asset, Currency, ExchangeRates, RebalanceInstrument, normalizeExchange } from '../types';
import { ActionItem, ActionKind, isActiveAction } from '../types/actionQueue';
import { isBaseType } from '../types/category';
import { getAssetBucket } from '../types/bucket';
import { assetValueKRW } from './bucketRebalancing';
import { RebalanceBandDeviation } from './rebalanceBands';

/** 주입 가격 맵 키 — ticker+거래소로 안정화(같은 티커 다른 거래소 충돌 방지). */
export function instrumentKey(ticker: string, exchange: string): string {
  return `${ticker.toUpperCase()}|${normalizeExchange(exchange)}`;
}

/**
 * 대표종목이 이미 보유 중인 코어 자산인지 판정 (Phase 4b 매칭 보정).
 * 카테고리 ETF가 실제로는 KRX 상장이라 저장된 거래소 문자열이 달라도 "같은 종목"으로 인식하게 한다.
 * 규칙(엄격): CORE + 같은 categoryId + ticker 일치 종목 중
 *   ① 거래소까지 일치가 정확히 1개 → 그것.
 *   ② 거래소 불일치면 → **티커 일치가 카테고리 내 유일할 때만** 폴백.
 *   ③ 2개 이상(거래소 같은 중복/티커 중복) → **ambiguous → null(fail-closed)**.
 * 못 찾으면 null(=미보유, 신규 매수 경로).
 */
export function findHeldCoreInstrument(
  assets: Asset[],
  inst: { ticker: string; exchange: string; categoryId: number },
): Asset | null {
  const t = inst.ticker.toUpperCase();
  const sameCat = assets.filter(a => getAssetBucket(a) === 'CORE' && a.categoryId === inst.categoryId && a.ticker.toUpperCase() === t);
  if (sameCat.length === 0) return null;
  const exact = sameCat.filter(a => normalizeExchange(a.exchange) === normalizeExchange(inst.exchange));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;                 // 거래소까지 동일 중복 → ambiguous
  return sameCat.length === 1 ? sameCat[0] : null;   // 거래소 불일치: 티커 유일할 때만 폴백
}

/**
 * 대표종목 지정(InstrumentRow) 시 저장할 RebalanceInstrument 구성 (순수).
 * 티커가 보유 종목과 일치하면 **name·currency·exchange를 보유 자산 값으로 복사**
 *   — 카테고리 고정 거래소 드롭다운("미국 국채")이 아니라 실제 상장 거래소("KRX…")를 저장해
 *     이후 findHeldCoreInstrument 매칭·시세 조회가 어긋나지 않게 한다.
 * 미일치면 fallbackExchange(드롭다운 선택값) 사용, name/currency 미지정(4b-3b fetch로 확정).
 */
export function buildInstrumentFromPick(
  ticker: string,
  fallbackExchange: string,
  categoryId: number,
  holdings: { ticker: string; name: string; currency?: Currency; exchange: string }[],
): RebalanceInstrument | null {
  const t = ticker.trim().toUpperCase();
  const match = holdings.find(h => h.ticker.toUpperCase() === t);
  const exchange = match?.exchange ?? fallbackExchange;
  if (!t || !exchange) return null;
  return { ticker: t, exchange, categoryId, name: match?.name, currency: match?.currency };
}

/** 종목 통화 → KRW 환율 (KRW=1). USD/JPY만 지원, 그 외는 null(FX 미지원 → 스킵). ExchangeRates=USD/JPY. */
function resolveFxRate(currency: Currency | undefined, rates: ExchangeRates): number | null {
  if (currency === Currency.KRW) return 1;
  if (currency === Currency.USD) return rates.USD > 0 ? rates.USD : null;
  if (currency === Currency.JPY) return rates.JPY > 0 ? rates.JPY : null;
  return null;
}

/** KRW 차액 + 원통화 가격 + fx → 주수 (일반 floor, 암호화폐 소수 8자리 내림). */
function translateQuantity(diffKRW: number, priceOriginal: number, fxRate: number, allowFractional: boolean): number {
  const raw = Math.abs(diffKRW) / (priceOriginal * fxRate);
  if (!(raw > 0)) return 0;
  return allowFractional ? Math.floor(raw * 1e8) / 1e8 : Math.floor(raw);
}

export type RebalanceGenReason =
  | 'generated-buy'
  | 'generated-sell'
  | 'no-instrument'   // BUY: 대표 종목 미지정
  | 'no-price'        // 보유가/주입가 없음
  | 'no-fx'           // 환율 미지원 통화(CNY 등)
  | 'no-holding'      // SELL: 카테고리에 코어 보유 없음
  | 'zero-qty'        // 사이징 0주
  | 'duplicate';      // 같은 categoryId active REBALANCE_* 존재

export interface RebalanceGenDiag {
  categoryId: number;
  label: string;
  direction: 'BUY' | 'SELL';
  reason: RebalanceGenReason;
}

export interface RebalanceGenResult {
  actions: ActionItem[];
  diagnostics: RebalanceGenDiag[];
}

export interface BuildRebalanceActionsInput {
  bandDeviations: RebalanceBandDeviation[];        // 저장본 기준으로 계산된 이탈 (호출부 책임)
  categoryInstruments: Record<string, RebalanceInstrument>;
  assets: Asset[];
  rates: ExchangeRates;
  existingQueue: ActionItem[];
  today: string;
  makeId: (seq: number) => string;
  /** 미보유 대표종목 가격 주입 (4b-3 fetch). 키=ticker 대문자. 보유 종목은 asset.priceOriginal 우선. */
  marketByInstrument?: Record<string, { price: number; currency: Currency }>;
}

const REBALANCE_KINDS: ActionKind[] = ['REBALANCE_BUY', 'REBALANCE_SELL'];

/** 코어 리밸런싱 주문 생성 (순수). 밴드 이탈 카테고리별 BUY/SELL 1건 또는 스킵 사유. */
export function buildRebalanceActions(input: BuildRebalanceActionsInput): RebalanceGenResult {
  const { bandDeviations, categoryInstruments, assets, rates, existingQueue, today, makeId, marketByInstrument } = input;

  // categoryId 기준 dedup — 이미 대기 중인 REBALANCE_* 카테고리
  const activeCats = new Set<number>();
  for (const it of existingQueue) {
    if (REBALANCE_KINDS.includes(it.kind) && isActiveAction(it.status) && typeof it.ruleSnapshot.categoryId === 'number') {
      activeCats.add(it.ruleSnapshot.categoryId);
    }
  }

  const actions: ActionItem[] = [];
  const diagnostics: RebalanceGenDiag[] = [];
  let seq = 0;

  for (const dev of bandDeviations) {
    const categoryId = Number(dev.key);
    const push = (reason: RebalanceGenReason) => diagnostics.push({ categoryId, label: dev.label, direction: dev.direction, reason });

    if (activeCats.has(categoryId)) { push('duplicate'); continue; }
    const allowFractional = isBaseType(categoryId, 'CRYPTOCURRENCY');
    const snapBase = { categoryId, diffKRW: dev.difference, currentWeight: dev.currentWeight, targetWeight: dev.targetWeight };

    if (dev.direction === 'BUY') {
      const inst = categoryInstruments[dev.key];
      if (!inst) { push('no-instrument'); continue; }
      // 보유 대표종목이면 assetId 세팅(추가매수)·priceOriginal 사용 → 없으면(미보유) 주입가(신규 매수).
      // 거래소 문자열이 달라도 findHeldCoreInstrument가 티커+카테고리로 매칭(중복 생성 버그 차단).
      const held = findHeldCoreInstrument(assets, { ticker: inst.ticker, exchange: inst.exchange, categoryId });
      let price: number, currency: Currency | undefined, assetId: string | undefined;
      if (held) {
        if (!(held.priceOriginal > 0)) { push('no-price'); continue; } // 보유이나 시세 없음 → 스킵(신규 생성 안 함)
        price = held.priceOriginal; currency = held.currency; assetId = held.id;
      } else {
        const m = marketByInstrument?.[instrumentKey(inst.ticker, inst.exchange)];
        if (!m || !(m.price > 0)) { push('no-price'); continue; }
        price = m.price; currency = m.currency; assetId = undefined; // 미보유 → 새 자산(4c addAsset)
      }
      const fx = resolveFxRate(currency, rates);
      if (fx == null) { push('no-fx'); continue; }
      const qty = translateQuantity(dev.difference, price, fx, allowFractional);
      if (!(qty > 0)) { push('zero-qty'); continue; }
      actions.push({
        id: makeId(seq++), createdDate: today, kind: 'REBALANCE_BUY',
        ticker: inst.ticker, name: inst.name ?? inst.ticker, assetId,
        quantity: qty, refPrice: price,
        reasonText: `리밸런싱 매수 — ${dev.label} 목표 대비 부족 (₩${Math.round(Math.abs(dev.difference)).toLocaleString('ko-KR')})`,
        ruleSnapshot: { ...snapBase, refPrice: price, fxRate: fx },
        status: 'pending',
      });
      push('generated-buy');
      continue;
    }

    // SELL — 대표종목 보유 우선, 없으면 카테고리 내 최대 보유
    const categoryAssets = assets.filter(a => getAssetBucket(a) === 'CORE' && a.categoryId === categoryId);
    if (categoryAssets.length === 0) { push('no-holding'); continue; }
    const inst = categoryInstruments[dev.key];
    const mappedHeld = inst
      ? categoryAssets.find(a => a.ticker.toUpperCase() === inst.ticker.toUpperCase() && normalizeExchange(a.exchange) === normalizeExchange(inst.exchange))
      : undefined;
    const largest = [...categoryAssets].sort((a, b) => assetValueKRW(b, rates) - assetValueKRW(a, rates))[0];
    const target = mappedHeld ?? largest;
    if (!(target.priceOriginal > 0)) { push('no-price'); continue; }
    const fx = resolveFxRate(target.currency, rates);
    if (fx == null) { push('no-fx'); continue; }
    let qty = translateQuantity(dev.difference, target.priceOriginal, fx, allowFractional);
    qty = Math.min(qty, target.quantity); // 과매도 방지
    if (!(qty > 0)) { push('zero-qty'); continue; }
    actions.push({
      id: makeId(seq++), createdDate: today, kind: 'REBALANCE_SELL',
      ticker: target.ticker, name: target.customName?.trim() || target.name, assetId: target.id, // assetId 필수
      quantity: qty, refPrice: target.priceOriginal,
      reasonText: `리밸런싱 매도 — ${dev.label} 목표 대비 초과 (₩${Math.round(Math.abs(dev.difference)).toLocaleString('ko-KR')})`,
      ruleSnapshot: { ...snapBase, refPrice: target.priceOriginal, fxRate: fx },
      status: 'pending',
    });
    push('generated-sell');
  }

  return { actions, diagnostics };
}
