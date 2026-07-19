// tests/stockReviewParity.ts
// ---------------------------------------------------------------------------
// "종목 검토(Stock Review)" ViewModel 골든 회귀 — 명시적 절대값 핀 (RULES §13).
// **3축 분리 모델**(A 평가 / B 품질 qualityNote / C 상태 stateNote) + 단일 소스(indicators strip).
//   경계: (1)climax 충족인데 MA60 없음→충족 유지 (2)최근13 volRatio有+OHLC無→'완전0일' 아님·부분 데이터
//        (3)복수계정 손익 상이→통합 평가(임의선택 아님) (4)순수 하락추세→헤더 정상+slope 상태라벨+캐비엇 미증가
//        (5)enriched 코어 비어있음(asset.indicators만)→stale 폴백 차단(모순 없음).
// 수동 실행: npm run test:stockreview (tsx). 통과 시 exit 0.

import { buildStockReviewViewModel, consolidateHoldingAsset, matchHoldings } from '../utils/stockReview';
import { STOCK_REVIEW_DISCLAIMER } from '../types/stockReview';
import type { StockReviewViewModel, StockReviewCondition, StockReviewIndicator } from '../types/stockReview';
import type { EnrichedAsset, AssetMetrics } from '../types/ui';
import type { Indicators } from '../types/api';
import type { EnrichedIndicatorData } from '../hooks/useEnrichedIndicators';
import type { DistributionDayMeta } from '../utils/marketDistribution';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const BASE_METRICS: AssetMetrics = {
  purchasePrice: 0, currentPrice: 0, currentPriceKRW: 0, purchasePriceKRW: 0,
  purchaseValue: 0, currentValue: 0, purchaseValueKRW: 0, currentValueKRW: 0,
  returnPercentage: 0, allocation: 0, dropFromHigh: 0, profitLoss: 0, profitLossKRW: 0,
  diffFromHigh: 0, yesterdayChange: 0, diffFromYesterday: 0,
};
function mkAsset(o: { ticker?: string; exchange?: string; priceOriginal?: number; metrics?: Partial<AssetMetrics>; indicators?: Indicators } = {}): EnrichedAsset {
  return {
    id: 'id', ticker: o.ticker ?? 'TST', exchange: o.exchange ?? 'NASDAQ', name: '종목',
    priceOriginal: o.priceOriginal ?? 0, changeRate: 0,
    indicators: o.indicators, metrics: { ...BASE_METRICS, ...o.metrics },
  } as unknown as EnrichedAsset;
}
function mkEnriched(o: Partial<EnrichedIndicatorData> = {}): EnrichedIndicatorData {
  return {
    ma: {}, prevMa: {}, rsi: null, prevRsi: null, maCrossDays: {},
    prevClose: null, priceCrossMaDays: {}, priceBreakBelowMaDays: {},
    rsiBounceDay: null, rsiOverheatEntryDay: null,
    atr14: null, high52w: null, volume52wMax: null, slopeRatio: null, dayRangeOverAtr: null,
    priceIsAt52wHigh: false, volumeIsAt52wMax: false, distributionDayMeta: [], ohlcvAvailable: true,
    isBullishCandle: null, longTrendUp: null, recentSwingLow: null, ...o,
  };
}
function meta(volRatio: number | null): DistributionDayMeta {
  return { volRatio, isBearish: false, isLowerHalfClose: false, changeRatio: 0 };
}
function metaNoOhlc(volRatio: number | null): DistributionDayMeta {
  return { volRatio, isBearish: null, isLowerHalfClose: null, changeRatio: 0 };
}
function findCond(vm: StockReviewViewModel, key: string): StockReviewCondition | undefined {
  return [...vm.buyConditions, ...vm.sellConditions].find(c => c.key === key);
}
function findInd(vm: StockReviewViewModel, key: string): StockReviewIndicator | undefined {
  return vm.indicators.find(i => i.key === key);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 포트폴리오 — 지표 원값 + 조건 evaluation + 요약(3축 카운트)
// ════════════════════════════════════════════════════════════════════════════
// climax 품질 complete 조건: longTrendUp 확정 + ohlcv + slope 결정 + **당일 캔들(dayRangeOverAtr·isBullishCandle) 확정**.
// slopeRatio 미설정(null)+MA60=하락추세(축C). dayRangeOverAtr 1.0(<임계, (b) 미발화)·isBullishCandle 지정으로 당일 데이터 완비.
const vm1 = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 110 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 75, atr14: 5, high52w: 120, longTrendUp: true, dayRangeOverAtr: 1.0, isBullishCandle: false }),
  source: 'portfolio', name: '종목1', asOfLabel: '2026-07-19',
});
check('1: rsi raw', findInd(vm1, 'rsi14')?.raw, 75);
check('1: atr14 raw', findInd(vm1, 'atr14')?.raw, 5);
check('1: high52w 라벨', findInd(vm1, 'high52w')?.label, '최근 252개 일봉 최고 종가');
const cAbove = findCond(vm1, 'PRICE_ABOVE_LONG_MA')!;
check('1: PRICE_ABOVE eval 충족', cAbove.evaluation, '충족');
check('1: PRICE_ABOVE actual', cAbove.rawActual, 110);
check('1: PRICE_ABOVE threshold', cAbove.rawThreshold, 90);
const cOb = findCond(vm1, 'RSI_OVERBOUGHT')!;
check('1: RSI_OVERBOUGHT eval 충족', cOb.evaluation, '충족');
check('1: RSI_OVERBOUGHT actual', cOb.rawActual, 75);
check('1: RSI_OVERSOLD 미충족', findCond(vm1, 'RSI_OVERSOLD')!.evaluation, '미충족');
check('1: MA_BULLISH 충족', findCond(vm1, 'MA_BULLISH_ALIGN')!.evaluation, '충족');
check('1: disclaimer', vm1.disclaimer, STOCK_REVIEW_DISCLAIMER);
// CLIMAX: 미충족 + 축C stateNote(품질 아님, qualityNote 없음). DISTRIBUTION: meta 없음 → 판정불가.
check('1: CLIMAX eval 미충족', findCond(vm1, 'CLIMAX_TOP')!.evaluation, '미충족');
check('1: CLIMAX qualityNote 없음(축B)', findCond(vm1, 'CLIMAX_TOP')!.qualityNote, null);
check('1: CLIMAX stateNote 장기추세 비상승(축C)', findCond(vm1, 'CLIMAX_TOP')!.stateNote, '장기추세 비상승');
check('1: climax 지표 0/3', findInd(vm1, 'climaxFlags')?.display, '0/3');
check('1: climax 지표 raw=0', findInd(vm1, 'climaxFlags')?.raw, 0);
check('1: DISTRIBUTION eval 판정불가', findCond(vm1, 'DISTRIBUTION_HIGH')!.evaluation, '판정불가');
check('1: summary.buy', vm1.summary.buy, { met: 2, evaluated: 3, qualityCaveats: 0, dataMissing: 0, notApplicable: 0 });
check('1: summary.sell(축C 캐비엇 미포함)', vm1.summary.sell, { met: 1, evaluated: 5, qualityCaveats: 0, dataMissing: 1, notApplicable: 0 });

// ════════════════════════════════════════════════════════════════════════════
// 2. 관심종목 (미보유) — 보유 의존 매도 조건 = '해당 없음'
// ════════════════════════════════════════════════════════════════════════════
const vm2 = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 110 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50 }),
  source: 'watchlist', name: '관심1', asOfLabel: '2026-07-19',
});
check('2: LOSS 해당 없음', findCond(vm2, 'LOSS_THRESHOLD')!.evaluation, '해당 없음');
check('2: DROP 해당 없음', findCond(vm2, 'DROP_FROM_HIGH')!.evaluation, '해당 없음');
check('2: notApplicable=2', vm2.summary.sell.notApplicable, 2);
check('2: holdingEvaluated=false', vm2.holdingEvaluated, false);

// ════════════════════════════════════════════════════════════════════════════
// 2b. Q6 단일 보유 — holdingAsset로 매도 조건 실제 평가.
// ════════════════════════════════════════════════════════════════════════════
const vm2b = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 110 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50 }),
  source: 'watchlist', name: '보유관심', asOfLabel: '2026-07-19',
  holdingAsset: mkAsset({ priceOriginal: 110, metrics: { returnPercentage: -10, dropFromHigh: -25 } }),
});
check('2b: holdingEvaluated=true', vm2b.holdingEvaluated, true);
check('2b: LOSS 실제평가 충족', findCond(vm2b, 'LOSS_THRESHOLD')!.evaluation, '충족');
check('2b: DROP 실제평가 충족', findCond(vm2b, 'DROP_FROM_HIGH')!.evaluation, '충족');
check('2b: holdingNote null(단일)', vm2b.holdingNote, null);

// ════════════════════════════════════════════════════════════════════════════
// #3(a). 복수 계정 통합 — 결정론적(임의 첫 선택 금지). 손익 상이 → 합산 재산출.
//   a1: pvKRW=100 cvKRW=90 drop=-10 / a2: pvKRW=100 cvKRW=80 drop=-30
//   → returnPct=(170-200)/200*100=-15, dropFromHigh=min=-30, note='복수 계정 통합 기준'
// ════════════════════════════════════════════════════════════════════════════
const a1 = mkAsset({ ticker: 'aapl', exchange: 'nasdaq', metrics: { purchaseValueKRW: 100, currentValueKRW: 90, dropFromHigh: -10, returnPercentage: -10 } });
const a2 = mkAsset({ ticker: 'AAPL', exchange: 'NASDAQ', metrics: { purchaseValueKRW: 100, currentValueKRW: 80, dropFromHigh: -30, returnPercentage: -20 } });
const other = mkAsset({ ticker: 'MSFT', exchange: 'NASDAQ' });
const matched = matchHoldings('AAPL', 'NASDAQ', [a1, a2, other]);
check('#3a: matchHoldings 정규화 매칭 2건', matched.length, 2);
const consol = consolidateHoldingAsset(matched)!;
check('#3a: 통합 returnPercentage=-15(임의선택 아님)', consol.asset.metrics.returnPercentage, -15);
check('#3a: 통합 dropFromHigh=-30(보수적 min)', consol.asset.metrics.dropFromHigh, -30);
check('#3a: holdingNote 복수 계정 통합 기준', consol.note, '복수 계정 통합 기준');

// #3(b). 통합 자산으로 빌더 평가 — LOSS(-15<=-5)·DROP(-30<=-20) 충족 + holdingNote 노출.
const vm3b = buildStockReviewViewModel({
  asset: mkAsset({ ticker: 'AAPL', exchange: 'NASDAQ', priceOriginal: 110 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50 }),
  source: 'watchlist', name: 'AAPL관심', asOfLabel: '2026-07-19',
  holdingAsset: consol.asset, holdingNote: consol.note,
});
check('#3b: LOSS 통합평가 충족', findCond(vm3b, 'LOSS_THRESHOLD')!.evaluation, '충족');
check('#3b: DROP 통합평가 충족', findCond(vm3b, 'DROP_FROM_HIGH')!.evaluation, '충족');
check('#3b: holdingNote 복수 계정 통합 기준', vm3b.holdingNote, '복수 계정 통합 기준');

// ════════════════════════════════════════════════════════════════════════════
// P1-1. 현재가 결측(price=0) — 가격 의존 조건 '판정불가' & 매도 오발 없음
// ════════════════════════════════════════════════════════════════════════════
const vmP0 = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 0 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50, high52w: 120 }),
  source: 'portfolio', name: '결측', asOfLabel: '2026-07-19',
});
check('P1-1: PRICE_BELOW 판정불가', findCond(vmP0, 'PRICE_BELOW_LONG_MA')!.evaluation, '판정불가');
check('P1-1: PRICE_BELOW ≠ 충족', findCond(vmP0, 'PRICE_BELOW_LONG_MA')!.evaluation !== '충족', true);
check('P1-1: MA_BULLISH(가격무관) 충족', findCond(vmP0, 'MA_BULLISH_ALIGN')!.evaluation, '충족');
check('P1-1: currentPrice raw=null', findInd(vmP0, 'currentPrice')?.raw, null);
check('P1-1: summary.buy dataMissing=1', vmP0.summary.buy.dataMissing, 1);

// ════════════════════════════════════════════════════════════════════════════
// P1-3. price>high — "--%" 아님(신고가 상회 라벨)
// ════════════════════════════════════════════════════════════════════════════
const vmHi = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 110 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50, high52w: 100 }),
  source: 'portfolio', name: '신고가', asOfLabel: '2026-07-19',
});
check('P1-3: pct display 고점 상회', findInd(vmHi, 'pctBelow52wHigh')?.display, '고점 상회(신고가 부근)');
check('P1-3: pct raw=-10', findInd(vmHi, 'pctBelow52wHigh')?.raw, -10);

// ════════════════════════════════════════════════════════════════════════════
// #(new)1. 거래량 비율 = 마지막 원소만. [1.8, null] → 마지막 null → '데이터 부족'.
// ════════════════════════════════════════════════════════════════════════════
const vmVol = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50, distributionDayMeta: [meta(1.8), meta(null)] }),
  source: 'portfolio', name: '거래량', asOfLabel: '2026-07-19',
});
check('N1: volumeRatio 마지막 null → 데이터 부족', findInd(vmVol, 'volumeRatio')?.display, '데이터 부족');
check('N1: volumeRatio raw=null', findInd(vmVol, 'volumeRatio')?.raw, null);

// ════════════════════════════════════════════════════════════════════════════
// #3(지표). 신규 지표 골든 + dataStatus 정상
// ════════════════════════════════════════════════════════════════════════════
const vm4 = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({
    ma: { 20: 100, 60: 90 }, rsi: 50, atr14: 5, high52w: 120,
    volume52wMax: 1000000, volumeIsAt52wMax: true, slopeRatio: 1.8, dayRangeOverAtr: 1.2, isBullishCandle: false,
    distributionDayMeta: [meta(1.2), meta(1.5)], ohlcvAvailable: true, longTrendUp: true,
  }),
  source: 'portfolio', name: '지표4', asOfLabel: '2026-07-19',
});
check('#3ind: atrRatio raw=5', findInd(vm4, 'atrRatio')?.raw, 5);
check('#3ind: atrRatio display=5%', findInd(vm4, 'atrRatio')?.display, '5%');
check('#3ind: volumeRatio raw=1.5', findInd(vm4, 'volumeRatio')?.raw, 1.5);
check('#3ind: volume52wMax raw=1000000', findInd(vm4, 'volume52wMax')?.raw, 1000000);
check('#3ind: volume52wMax 당일최대', findInd(vm4, 'volume52wMax')?.display.includes('(당일 최대)'), true);
check('#3ind: slopeRatio raw=1.8', findInd(vm4, 'slopeRatio')?.raw, 1.8);
check('#3ind: dataStatus 정상', vm4.dataStatus, '정상');

// ════════════════════════════════════════════════════════════════════════════
// 경계(1). 짧은 이력(MA60·slope 불확정)인데 climax 충족(b+c) → 충족 유지(숨김 금지) + '부분 데이터'.
//   MA60은 climax 입력이 아님 — slopeRatio=null & MA60 없음 = (a) 불확정 → 품질 부분(하지만 평가는 보존).
// ════════════════════════════════════════════════════════════════════════════
const vmC = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({
    ma: { 20: 100 }, rsi: 50, ohlcvAvailable: true,
    slopeRatio: null, dayRangeOverAtr: 3, isBullishCandle: true, priceIsAt52wHigh: true, volumeIsAt52wMax: true, longTrendUp: true,
  }),
  source: 'portfolio', name: '짧은이력', asOfLabel: '2026-07-19',
});
check('경계1: CLIMAX 충족 유지(판정불가 아님)', findCond(vmC, 'CLIMAX_TOP')!.evaluation, '충족');
check('경계1: CLIMAX qualityNote 부분 데이터(slope 불확정)', findCond(vmC, 'CLIMAX_TOP')!.qualityNote, '부분 데이터');
check('경계1: CLIMAX stateNote 없음(하락추세 확정 불가)', findCond(vmC, 'CLIMAX_TOP')!.stateNote, undefined);

// ════════════════════════════════════════════════════════════════════════════
// 경계(2). 최근13 volRatio有 + OHLC파생 무 → '완전0일' 확정 금지: 미충족 + '부분 데이터'.
// ════════════════════════════════════════════════════════════════════════════
const vmD = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({ ma: { 20: 100, 60: 90 }, rsi: 50, ohlcvAvailable: true, distributionDayMeta: [metaNoOhlc(1.0), metaNoOhlc(1.0)] }),
  source: 'portfolio', name: 'OHLC결측', asOfLabel: '2026-07-19',
});
check('경계2: DISTRIBUTION 평가 유지(판정불가 아님)', findCond(vmD, 'DISTRIBUTION_HIGH')!.evaluation !== '판정불가', true);
check('경계2: DISTRIBUTION qualityNote 부분 데이터', findCond(vmD, 'DISTRIBUTION_HIGH')!.qualityNote, '부분 데이터');
check('경계2: distribution 지표 데이터 부족 아님(카운트 노출)', findInd(vmD, 'distributionCount')?.display !== '데이터 부족', true);

// ════════════════════════════════════════════════════════════════════════════
// 경계(4). 순수 하락추세 → 헤더 '정상' + slope 타일 상태라벨 + qualityCaveats 미증가.
// ════════════════════════════════════════════════════════════════════════════
const vmDown = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({
    ma: { 20: 100, 60: 90 }, rsi: 50, atr14: 5, high52w: 120, volume52wMax: 1000000,
    slopeRatio: null, dayRangeOverAtr: 1.2, isBullishCandle: false, distributionDayMeta: [meta(1.5)], ohlcvAvailable: true, longTrendUp: true,
  }),
  source: 'portfolio', name: '하락추세', asOfLabel: '2026-07-19',
});
check('경계4: 헤더 정상(축C는 부분 아님)', vmDown.dataStatus, '정상');
check('경계4: slope 타일 상태 라벨', findInd(vmDown, 'slopeRatio')?.display, '장기 추세 비상승 · 비율 해당 없음');
check('경계4: CLIMAX stateNote(축C)', findCond(vmDown, 'CLIMAX_TOP')!.stateNote, '장기추세 비상승');
check('경계4: CLIMAX qualityNote 없음(축B)', findCond(vmDown, 'CLIMAX_TOP')!.qualityNote, null);
check('경계4: summary.sell.qualityCaveats=0', vmDown.summary.sell.qualityCaveats, 0);

// ════════════════════════════════════════════════════════════════════════════
// 경계(5). enriched 코어 비어있음 + asset.indicators만 → strip으로 stale 폴백 차단(모순 없음).
// ════════════════════════════════════════════════════════════════════════════
const vmStale = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 110, indicators: { ma20: 100, ma60: 90, rsi: 20, signal: 'STRONG_BUY' } as unknown as Indicators }),
  enriched: mkEnriched({ ma: {}, rsi: 50 }),
  source: 'portfolio', name: 'stale', asOfLabel: '2026-07-19',
});
check('경계5: PRICE_ABOVE 판정불가(stale indicators 폴백 차단)', findCond(vmStale, 'PRICE_ABOVE_LONG_MA')!.evaluation, '판정불가');
check('경계5: PRICE_ABOVE ≠ 충족(모순 없음)', findCond(vmStale, 'PRICE_ABOVE_LONG_MA')!.evaluation !== '충족', true);
check('경계5: MA_BULLISH 판정불가', findCond(vmStale, 'MA_BULLISH_ALIGN')!.evaluation, '판정불가');
check('경계5: ma60 지표 raw=null(헤더/조건 정합)', findInd(vmStale, 'ma60')?.raw, null);

// ════════════════════════════════════════════════════════════════════════════
// 경계(6). longTrendUp=null(게이트 불확정) → climax 충족 유지 + '부분 데이터'(숨김 금지) + 타일 '(불완전)'.
//   longTrendUp은 countClimaxFlags의 실제 게이트 입력 → 미상이면 카운트가 과대/불확정 → 품질 부분.
// ════════════════════════════════════════════════════════════════════════════
const vmLT = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({
    ma: { 20: 100, 60: 90 }, rsi: 50, atr14: 5, high52w: 120, ohlcvAvailable: true,
    slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: true, priceIsAt52wHigh: true, volumeIsAt52wMax: true,
    longTrendUp: null, distributionDayMeta: [meta(1.0)],
  }),
  source: 'portfolio', name: 'longTrend미상', asOfLabel: '2026-07-19',
});
check('경계6: longTrendUp=null → climax 충족 유지', findCond(vmLT, 'CLIMAX_TOP')!.evaluation, '충족');
check('경계6: longTrendUp=null → 부분 데이터(게이트 불확정)', findCond(vmLT, 'CLIMAX_TOP')!.qualityNote, '부분 데이터');
check('경계6: climax 타일 불완전 표기', findInd(vmLT, 'climaxFlags')?.display, '3/3 (불완전)');
check('경계6: 헤더 부분', vmLT.dataStatus, '부분');

// ════════════════════════════════════════════════════════════════════════════
// 경계(7). distribution 부분(OHLC 결손, 하한값) → 타일 '최소 N일'(확정 표기 금지).
// ════════════════════════════════════════════════════════════════════════════
check('경계7: distribution 타일 "최소 0일"(부분=하한)', findInd(vmD, 'distributionCount')?.display, '최소 0일');

// ════════════════════════════════════════════════════════════════════════════
// 경계(8). 보유 매칭 = 공용 normalizeExchange (거래소 별칭). AMEX ↔ 'NYSE American' 동일 종목 매칭.
// ════════════════════════════════════════════════════════════════════════════
const heldAmex = mkAsset({ ticker: 'SPY', exchange: 'AMEX', metrics: { purchaseValueKRW: 100, currentValueKRW: 80, dropFromHigh: -25, returnPercentage: -20 } });
check('경계8: AMEX↔NYSE American 정규화 매칭', matchHoldings('SPY', 'NYSE American', [heldAmex]).length, 1);
check('경계8: 대소문자 무시 매칭(nyse american)', matchHoldings('spy', 'nyse american', [heldAmex]).length, 1);

// ════════════════════════════════════════════════════════════════════════════
// 경계(9). 당일 캔들 결손(시가 누락 → isBullishCandle=null)인데 전체이력 ohlcvAvailable=true.
//   climax (b)가 미확인 양봉에 카운트 → 충족이지만 '부분 데이터'(확정처럼 2/3 표기 금지) + 헤더 부분.
// ════════════════════════════════════════════════════════════════════════════
const vmCandle = buildStockReviewViewModel({
  asset: mkAsset({ priceOriginal: 100 }),
  enriched: mkEnriched({
    ma: { 20: 100, 60: 90 }, rsi: 50, atr14: 5, high52w: 120, ohlcvAvailable: true, longTrendUp: true,
    slopeRatio: 3, dayRangeOverAtr: 3, isBullishCandle: null, // 당일 시가 누락 → 양봉 미확인
    distributionDayMeta: [meta(1.0)],
  }),
  source: 'portfolio', name: '당일시가결손', asOfLabel: '2026-07-19',
});
check('경계9: CLIMAX 충족 유지(숨김 금지)', findCond(vmCandle, 'CLIMAX_TOP')!.evaluation, '충족');
check('경계9: 당일 캔들 결손 → 부분 데이터', findCond(vmCandle, 'CLIMAX_TOP')!.qualityNote, '부분 데이터');
check('경계9: climax 타일 (불완전) 표기', findInd(vmCandle, 'climaxFlags')?.display, '2/3 (불완전)');
check('경계9: 헤더 부분', vmCandle.dataStatus, '부분');

// ────────────────────────────────────────────────────────────────────────────
if (fails.length > 0) {
  console.error(`\n종목 검토 패리티 실패 (${fails.length}):`);
  for (const f of fails) console.error('  ' + f);
  console.error(`\n${pass} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`✓ stockReviewParity: ${pass} assertions passed`);
