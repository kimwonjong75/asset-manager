// tests/portfolioMetricsParity.ts
// ---------------------------------------------------------------------------
// 수익률 기준(PLBasis) 계산 골든 테스트 — `utils/portfolioMetrics` 순수 함수만 호출(React/DOM 없음).
//
// 이 테스트가 지키는 것:
//   ① **'krw' 모드는 기존 동작과 동일** — 추출 리팩터가 화면 숫자를 바꾸지 않았음을 절대값으로 고정
//   ② **'native' 모드는 환율 무관 수익률** — 매입가·평가액을 모두 오늘 환율로 환산(증권사 방식)
//   ③ **두 모드가 동일해야 하는 경로**(KRW 자산·업비트/빗썸·레거시 매도 레코드)는 deep-equal
//   ④ 매도 카드 항등식 `매도금액 − 매수금액 = 실현손익`이 **두 모드 모두**에서 성립
//   ⑤ 매수정보 없음 → 실현손익 **정확히 0**(soldPLBreakdown의 "0=정보없음" 규약 보존)
//
// ⚠ 경로-대-경로 비교는 공통 함수 추출 후 자기참조 타우톨로지가 되므로 **명시 절대값**만 쓴다
//   (예외: ③의 두-모드 동일성은 "분기가 일어나면 안 되는 곳"을 증명하는 것이므로 의도적 대조).
//
// 참고: node에는 localStorage가 없어 `resolveRate`의 캐시 폴백이 항상 실패한다(내부 try/catch).
//       → 환율 0 케이스는 "현재 환율도 캐시도 없음" 상태를 그대로 재현한다.
//
// 수동 실행: npm run test:metrics. 통과 시 exit 0.
// ---------------------------------------------------------------------------

import { Asset, AssetSnapshot, Currency, ExchangeRates, SellRecord } from '../types';
import {
  MAX_REASONABLE_EXCHANGE_RATES,
  getValueInKRW,
  getPurchaseValueInKRW,
  computeAssetMetrics,
  computePortfolioStats,
  computeSoldRecordPL,
  computeSoldAssetsStats,
  computeAlertCount,
  deriveSnapshotPurchaseValue,
} from '../utils/portfolioMetrics';
import {
  DEFAULT_VALUATION_SETTINGS,
  PL_BASIS_ORDER,
  PL_BASIS_LABELS,
  PL_BASIS_SUBLABELS,
  normalizeValuationSettings,
} from '../types/valuation';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}
/** KRW 금액용 — 100만 단위에서 double 오차가 1e-6을 넘으므로 절대 1e-3으로 본다. */
const KRW_EPS = 1e-3;

const NATIVE = { plBasis: 'native' } as const;
const KRW = { plBasis: 'krw' } as const;

// ════════════════════════════════════════════════════════════════════════════
// 픽스처 — 실제 사례 XLE (앱 −1.45% vs 키움 +7.5% 불일치의 발단)
//   매수 $59.08 @1,498.8 / 현재 $63.78 @1,368.07
// ════════════════════════════════════════════════════════════════════════════
const XLE: Asset = {
  id: 'xle', categoryId: 2, ticker: 'XLE', exchange: 'NYSE', name: 'Energy Select Sector SPDR',
  quantity: 50, purchasePrice: 59.08, purchaseDate: '2025-03-01', currency: Currency.USD,
  purchaseExchangeRate: 1498.8, currentPrice: 63.78, priceOriginal: 63.78, highestPrice: 70,
};
const RATES: ExchangeRates = { USD: 1368.07, JPY: 9.5 };
const NO_RATES: ExchangeRates = { USD: 0, JPY: 0 };

// ════════════════════════════════════════════════════════════════════════════
// 1. XLE — 두 모드 공통 값 (환산 기준과 무관한 필드)
// ════════════════════════════════════════════════════════════════════════════
{
  const n = computeAssetMetrics(XLE, RATES, 0, NATIVE).metrics;
  const k = computeAssetMetrics(XLE, RATES, 0, KRW).metrics;

  for (const [label, m] of [['native', n], ['krw', k]] as const) {
    checkClose(`XLE ${label} currentPriceKRW`, m.currentPriceKRW, 87255.5046, KRW_EPS);
    checkClose(`XLE ${label} currentValueKRW`, m.currentValueKRW, 4_362_775.23, KRW_EPS);
    checkClose(`XLE ${label} purchaseValue(원통화)`, m.purchaseValue, 2954);
    checkClose(`XLE ${label} currentValue(원통화)`, m.currentValue, 3189);
    checkClose(`XLE ${label} profitLoss(원통화)`, m.profitLoss, 235);
    checkClose(`XLE ${label} dropFromHigh`, m.dropFromHigh, -8.8857142857);
    checkClose(`XLE ${label} diffFromHigh`, m.diffFromHigh, -6.22, 1e-6);
    checkClose(`XLE ${label} allocation(총액 0)`, m.allocation, 0);
    // changeRate·previousClosePrice 없는 레거시 → 어제대비 0 (두 모드 공통)
    checkClose(`XLE ${label} yesterdayChange`, m.yesterdayChange, 0);
    checkClose(`XLE ${label} diffFromYesterday`, m.diffFromYesterday, 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. XLE — 'krw' 모드 (기존 동작 박제: 매입원가는 매수 당시 환율 1,498.8)
// ════════════════════════════════════════════════════════════════════════════
{
  const m = computeAssetMetrics(XLE, RATES, 0, KRW).metrics;
  checkClose('XLE krw purchasePriceKRW (59.08×1498.8)', m.purchasePriceKRW, 88_549.104, KRW_EPS);
  checkClose('XLE krw purchaseValueKRW', m.purchaseValueKRW, 4_427_455.2, KRW_EPS);
  checkClose('XLE krw profitLossKRW (환차손 포함)', m.profitLossKRW, -64_679.97, KRW_EPS);
  checkClose('XLE krw returnPercentage = −1.4608837%', m.returnPercentage, -1.4608837);
  checkClose('XLE krw getPurchaseValueInKRW 단독', getPurchaseValueInKRW(XLE, RATES, 'krw'), 88_549.104, KRW_EPS);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. XLE — 'native' 모드 (증권사 방식: 양쪽 다 오늘 환율 1,368.07 → 환율 약분)
// ════════════════════════════════════════════════════════════════════════════
{
  const m = computeAssetMetrics(XLE, RATES, 0, NATIVE).metrics;
  checkClose('XLE native purchasePriceKRW (59.08×1368.07)', m.purchasePriceKRW, 80_825.5756, KRW_EPS);
  checkClose('XLE native purchaseValueKRW', m.purchaseValueKRW, 4_041_278.78, KRW_EPS);
  checkClose('XLE native profitLossKRW (235×1368.07)', m.profitLossKRW, 321_496.45, KRW_EPS);
  checkClose('XLE native returnPercentage = +7.9553148% (환율 무관)', m.returnPercentage, 7.9553148);
  checkClose('XLE native getPurchaseValueInKRW 단독', getPurchaseValueInKRW(XLE, RATES, 'native'), 80_825.5756, KRW_EPS);

  // ★ 이 프로젝트를 촉발한 부호 반전: 같은 데이터, 규약만 다르다
  const k = computeAssetMetrics(XLE, RATES, 0, KRW).metrics;
  check('XLE 두 모드 수익률 부호가 반대', [k.returnPercentage < 0, m.returnPercentage > 0], [true, true]);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. allocation — 총 평가액 대비 비중 (두 모드 공통, 평가액 기준)
// ════════════════════════════════════════════════════════════════════════════
{
  const total = 8_725_550.46; // = XLE 평가액 × 2
  checkClose('XLE native allocation 50%', computeAssetMetrics(XLE, RATES, total, NATIVE).metrics.allocation, 50);
  checkClose('XLE krw allocation 50%', computeAssetMetrics(XLE, RATES, total, KRW).metrics.allocation, 50);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 환율 없음(현재 0 + 캐시 없음) fail-safe — 현행 동작 그대로 핀
// ════════════════════════════════════════════════════════════════════════════
{
  const n = computeAssetMetrics(XLE, NO_RATES, 0, NATIVE).metrics;
  checkClose('환율0 native returnPercentage 유지 7.9553148', n.returnPercentage, 7.9553148);
  checkClose('환율0 native profitLoss(원통화) 유지 235', n.profitLoss, 235);
  checkClose('환율0 native purchasePriceKRW 0', n.purchasePriceKRW, 0);
  checkClose('환율0 native purchaseValueKRW 0', n.purchaseValueKRW, 0);
  checkClose('환율0 native profitLossKRW 0', n.profitLossKRW, 0);
  checkClose('환율0 native currentValueKRW 0', n.currentValueKRW, 0);
  checkClose('환율0 native allocation 0', n.allocation, 0);

  const k = computeAssetMetrics(XLE, NO_RATES, 0, KRW).metrics;
  checkClose('환율0 krw currentValueKRW 0', k.currentValueKRW, 0);
  checkClose('환율0 krw purchaseValueKRW 유지(매수환율 사용)', k.purchaseValueKRW, 4_427_455.2, KRW_EPS);
  checkClose('환율0 krw profitLossKRW = −매수액', k.profitLossKRW, -4_427_455.2, KRW_EPS);
  checkClose('환율0 krw returnPercentage −100%', k.returnPercentage, -100);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 분기가 일어나면 안 되는 경로 — 두 모드 metrics 객체 deep-equal
//    (a) KRW 자산  (b) 업비트(통화 USD로 저장된 특이 케이스)
// ════════════════════════════════════════════════════════════════════════════
{
  const krwAsset: Asset = {
    id: 'k1', categoryId: 1, ticker: '005930', exchange: 'KRX', name: '삼성전자',
    quantity: 5, purchasePrice: 70_000, purchaseDate: '2025-01-02', currency: Currency.KRW,
    currentPrice: 75_000, priceOriginal: 75_000, highestPrice: 90_000,
  };
  const n = computeAssetMetrics(krwAsset, RATES, 0, NATIVE).metrics;
  const k = computeAssetMetrics(krwAsset, RATES, 0, KRW).metrics;
  check('KRW 자산 — 두 모드 metrics deep-equal', n, k);
  checkClose('KRW 자산 purchaseValueKRW 350,000', n.purchaseValueKRW, 350_000);
  checkClose('KRW 자산 currentValueKRW 375,000', n.currentValueKRW, 375_000);
  checkClose('KRW 자산 profitLossKRW 25,000', n.profitLossKRW, 25_000);
  checkClose('KRW 자산 returnPercentage 7.1428571%', n.returnPercentage, 7.1428571);

  // 업비트/빗썸: 통화가 USD여도 시세는 KRW → 달러 분기를 타면 안 된다(기존 특이 동작 보존)
  const upbit: Asset = {
    id: 'u1', categoryId: 3, ticker: 'BTC', exchange: 'Upbit', name: '비트코인',
    quantity: 0.1, purchasePrice: 100, purchaseDate: '2025-01-02', currency: Currency.USD,
    purchaseExchangeRate: 1400, currentPrice: 50_000_000, priceOriginal: 50_000_000, highestPrice: 60_000_000,
  };
  const un = computeAssetMetrics(upbit, RATES, 0, NATIVE).metrics;
  const uk = computeAssetMetrics(upbit, RATES, 0, KRW).metrics;
  check('업비트 자산 — 두 모드 metrics deep-equal', un, uk);
  checkClose('업비트 currentPriceKRW = 시세 그대로', un.currentPriceKRW, 50_000_000);
  checkClose('업비트 purchasePriceKRW = 매수환율 적용(특이 동작 보존)', un.purchasePriceKRW, 140_000);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. computePortfolioStats — 합산은 자산별 metrics의 합
// ════════════════════════════════════════════════════════════════════════════
{
  const assets = [XLE];
  const n = computePortfolioStats(assets, RATES, NATIVE);
  checkClose('stats native totalValue', n.totalValue, 4_362_775.23, KRW_EPS);
  checkClose('stats native totalPurchaseValue', n.totalPurchaseValue, 4_041_278.78, KRW_EPS);
  checkClose('stats native totalGainLoss', n.totalGainLoss, 321_496.45, KRW_EPS);
  checkClose('stats native totalReturn', n.totalReturn, 7.9553148);

  const k = computePortfolioStats(assets, RATES, KRW);
  checkClose('stats krw totalPurchaseValue', k.totalPurchaseValue, 4_427_455.2, KRW_EPS);
  checkClose('stats krw totalGainLoss', k.totalGainLoss, -64_679.97, KRW_EPS);
  checkClose('stats krw totalReturn', k.totalReturn, -1.4608837);

  const empty = computePortfolioStats([], RATES, NATIVE);
  check('stats 빈 배열 → 전부 0', empty, { totalValue: 0, totalPurchaseValue: 0, totalGainLoss: 0, totalReturn: 0 });
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 매도 실현손익 — 표준 레코드 ($100 → $120, 10주)
// ════════════════════════════════════════════════════════════════════════════
const SOLD_RATES: ExchangeRates = { USD: 1450, JPY: 9.5 };

const standardSell: SellRecord = {
  id: 's1', assetId: 'a1', ticker: 'AAPL', name: '애플', categoryId: 2,
  sellDate: '2026-02-01', sellPrice: 174_000, sellPriceOriginal: 120, sellPriceSettlement: 120,
  sellQuantity: 10, sellExchangeRate: 1450, settlementCurrency: Currency.USD,
  originalCurrency: Currency.USD, originalPurchasePrice: 100, originalPurchaseExchangeRate: 1400,
};

{
  const k = computeSoldRecordPL(standardSell, undefined, SOLD_RATES, 'krw');
  checkClose('매도 krw sellAmountKRW 1,740,000', k.sellAmountKRW, 1_740_000, KRW_EPS);
  checkClose('매도 krw purchaseValueKRW 1,400,000 (매수환율 1400)', k.purchaseValueKRW, 1_400_000, KRW_EPS);
  checkClose('매도 krw realizedKRW 340,000', k.realizedKRW, 340_000, KRW_EPS);
  check('매도 krw hasCostBasis', k.hasCostBasis, true);
  check('매도 krw currency', k.currency, Currency.USD);
  checkClose('★ 항등식 krw: 매도−매수 = 손익', k.sellAmountKRW - k.purchaseValueKRW, k.realizedKRW, KRW_EPS);

  const n = computeSoldRecordPL(standardSell, undefined, SOLD_RATES, 'native');
  checkClose('매도 native realizedNative $200', n.realizedNative ?? NaN, 200);
  checkClose('매도 native realizedKRW 290,000 (200×1450)', n.realizedKRW, 290_000, KRW_EPS);
  checkClose('매도 native sellAmountKRW 1,740,000', n.sellAmountKRW, 1_740_000, KRW_EPS);
  checkClose('매도 native purchaseValueKRW 1,450,000 (오늘 환율)', n.purchaseValueKRW, 1_450_000, KRW_EPS);
  check('매도 native hasCostBasis', n.hasCostBasis, true);
  checkClose('★ 항등식 native: 매도−매수 = 손익', n.sellAmountKRW - n.purchaseValueKRW, n.realizedKRW, KRW_EPS);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 비정상 매도환율(5,000 > 상한 3,000) 보정 — 'krw'만 보정, 'native'는 애초에 무관
// ════════════════════════════════════════════════════════════════════════════
{
  const corrupted: SellRecord = { ...standardSell, id: 's2', sellExchangeRate: 5000, sellPrice: 999_999 };
  check('상한 상수 USD 3000', MAX_REASONABLE_EXCHANGE_RATES[Currency.USD], 3000);
  check('상한 상수 JPY 50', MAX_REASONABLE_EXCHANGE_RATES[Currency.JPY], 50);
  check('상한 상수 CNY 400', MAX_REASONABLE_EXCHANGE_RATES[Currency.CNY], 400);

  const k = computeSoldRecordPL(corrupted, undefined, SOLD_RATES, 'krw');
  checkClose('이상환율 krw sellAmountKRW 보정 1,740,000', k.sellAmountKRW, 1_740_000, KRW_EPS);
  checkClose('이상환율 krw realizedKRW 340,000', k.realizedKRW, 340_000, KRW_EPS);

  const n = computeSoldRecordPL(corrupted, undefined, SOLD_RATES, 'native');
  checkClose('이상환율 native realizedKRW 290,000', n.realizedKRW, 290_000, KRW_EPS);
  checkClose('이상환율 native sellAmountKRW 1,740,000', n.sellAmountKRW, 1_740_000, KRW_EPS);
}

// ════════════════════════════════════════════════════════════════════════════
// 10. XLE 부분 매도 — 부호 반전 골든 (원화 −23,410 / 달러 +128,599)
// ════════════════════════════════════════════════════════════════════════════
{
  const xleSell: SellRecord = {
    id: 's3', assetId: 'xle', ticker: 'XLE', name: 'XLE', categoryId: 2,
    sellDate: '2026-03-02', sellPrice: 87_378.6, sellPriceOriginal: 63.78, sellPriceSettlement: 63.78,
    sellQuantity: 20, sellExchangeRate: 1370, settlementCurrency: Currency.USD,
    originalCurrency: Currency.USD, originalPurchasePrice: 59.08, originalPurchaseExchangeRate: 1498.8,
  };

  const k = computeSoldRecordPL(xleSell, undefined, RATES, 'krw');
  checkClose('XLE매도 krw realizedKRW −23,410.08', k.realizedKRW, -23_410.08, KRW_EPS);
  checkClose('XLE매도 krw sellAmountKRW 1,747,572', k.sellAmountKRW, 1_747_572, KRW_EPS);
  checkClose('XLE매도 krw purchaseValueKRW 1,770,982.08', k.purchaseValueKRW, 1_770_982.08, KRW_EPS);

  const n = computeSoldRecordPL(xleSell, undefined, RATES, 'native');
  checkClose('XLE매도 native realizedNative $94', n.realizedNative ?? NaN, 94, 1e-6);
  checkClose('★ XLE매도 native realizedKRW +128,598.58 (부호 반전)', n.realizedKRW, 128_598.58, KRW_EPS);
  checkClose('XLE매도 native sellAmountKRW 1,745,110.092', n.sellAmountKRW, 1_745_110.092, KRW_EPS);
  checkClose('XLE매도 native purchaseValueKRW 1,616,511.512', n.purchaseValueKRW, 1_616_511.512, KRW_EPS);
  checkClose('★ 항등식 native', n.sellAmountKRW - n.purchaseValueKRW, n.realizedKRW, KRW_EPS);
  check('두 모드 부호 반전', [k.realizedKRW < 0, n.realizedKRW > 0], [true, true]);
}

// ════════════════════════════════════════════════════════════════════════════
// 11. 레거시 레코드(통화 필드 전무) — 'native'도 'krw' 경로로 폴백해야 한다
// ════════════════════════════════════════════════════════════════════════════
const liveUsdAsset: Asset = {
  id: 'a-live', categoryId: 2, ticker: 'AAPL', exchange: 'NASDAQ', name: '애플',
  quantity: 20, purchasePrice: 100, purchaseDate: '2025-01-02', currency: Currency.USD,
  purchaseExchangeRate: 1400, currentPrice: 150, priceOriginal: 150, highestPrice: 200,
};
// 실제 저장본에 존재하는 형태 — SellRecord의 필수 필드조차 없다(tests/restoreRoundTripParity.ts:42 참조)
const legacySell = {
  id: 's-legacy', ticker: 'AAPL', assetId: 'a-live',
  sellPrice: 150_000, sellQuantity: 10, sellDate: '2025-02-01',
} as unknown as SellRecord;

{
  const k = computeSoldRecordPL(legacySell, liveUsdAsset, SOLD_RATES, 'krw');
  const n = computeSoldRecordPL(legacySell, liveUsdAsset, SOLD_RATES, 'native');
  check('레거시+보유자산 — 두 모드 deep-equal(폴백)', n, k);
  checkClose('레거시+보유자산 realizedKRW 100,000', k.realizedKRW, 100_000, KRW_EPS);
  checkClose('레거시+보유자산 sellAmountKRW 1,500,000', k.sellAmountKRW, 1_500_000, KRW_EPS);
  checkClose('레거시+보유자산 purchaseValueKRW 1,400,000', k.purchaseValueKRW, 1_400_000, KRW_EPS);
  check('레거시+보유자산 hasCostBasis', k.hasCostBasis, true);

  const kNone = computeSoldRecordPL(legacySell, undefined, SOLD_RATES, 'krw');
  const nNone = computeSoldRecordPL(legacySell, undefined, SOLD_RATES, 'native');
  check('레거시+자산없음 — 두 모드 deep-equal', nNone, kNone);
  check('★ 레거시+자산없음 realizedKRW 정확히 0', kNone.realizedKRW, 0);
  check('레거시+자산없음 hasCostBasis false', kNone.hasCostBasis, false);
  checkClose('레거시+자산없음 매수금액=매도금액', kNone.purchaseValueKRW, kNone.sellAmountKRW, KRW_EPS);
}

// ════════════════════════════════════════════════════════════════════════════
// 12. computeSoldAssetsStats — 합계·수익률·이익/손실 분해
// ════════════════════════════════════════════════════════════════════════════
{
  const history = [standardSell, legacySell];
  const assets = [liveUsdAsset];

  const k = computeSoldAssetsStats(history, assets, SOLD_RATES, KRW);
  checkClose('stats krw totalSoldAmount', k.totalSoldAmount, 3_240_000, KRW_EPS);
  checkClose('stats krw totalSoldPurchaseValue', k.totalSoldPurchaseValue, 2_800_000, KRW_EPS);
  checkClose('stats krw totalSoldProfit', k.totalSoldProfit, 440_000, KRW_EPS);
  checkClose('stats krw soldReturn', k.soldReturn, 15.7142857);
  check('stats krw soldCount', k.soldCount, 2);
  checkClose('stats krw grossProfit', k.grossProfit, 440_000, KRW_EPS);
  check('stats krw profitCount', k.profitCount, 2);
  check('stats krw lossCount', k.lossCount, 0);

  const n = computeSoldAssetsStats(history, assets, SOLD_RATES, NATIVE);
  // 표준 레코드만 달러 경로(290,000), 레거시는 폴백(100,000)
  checkClose('stats native totalSoldProfit 390,000', n.totalSoldProfit, 390_000, KRW_EPS);
  checkClose('stats native totalSoldAmount', n.totalSoldAmount, 3_240_000, KRW_EPS);
  checkClose('stats native totalSoldPurchaseValue', n.totalSoldPurchaseValue, 2_850_000, KRW_EPS);
  check('stats native soldCount', n.soldCount, 2);

  // 매수정보 없는 건은 0 → 이익/손실 어느 건수에도 들어가지 않는다
  const orphan = computeSoldAssetsStats([legacySell], [], SOLD_RATES, NATIVE);
  check('stats 매수정보 없음 — profitCount 0', orphan.profitCount, 0);
  check('stats 매수정보 없음 — lossCount 0', orphan.lossCount, 0);
  check('stats 매수정보 없음 — totalSoldProfit 0', orphan.totalSoldProfit, 0);
  check('stats 매수정보 없음 — soldReturn 0', orphan.soldReturn, 0);

  const emptyStats = computeSoldAssetsStats([], [], SOLD_RATES, KRW);
  check('stats 빈 이력 soldCount 0', emptyStats.soldCount, 0);
  check('stats 빈 이력 soldReturn 0', emptyStats.soldReturn, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 13. getValueInKRW / computeAlertCount — 환율 기준과 무관한 기존 동작
// ════════════════════════════════════════════════════════════════════════════
{
  checkClose('getValueInKRW KRW 그대로', getValueInKRW(1234, Currency.KRW, RATES), 1234);
  checkClose('getValueInKRW USD 환산', getValueInKRW(10, Currency.USD, RATES), 13_680.7, KRW_EPS);
  checkClose('getValueInKRW CNY 미지원 → 0', getValueInKRW(10, Currency.CNY, RATES), 0);

  const mk = (id: string, currentPrice: number, highestPrice: number, own?: number): Asset => ({
    id, categoryId: 2, ticker: id, exchange: 'NASDAQ', name: id, quantity: 1,
    purchasePrice: 100, purchaseDate: '2025-01-01', currency: Currency.USD,
    currentPrice, priceOriginal: currentPrice, highestPrice, sellAlertDropRate: own,
  });
  const alertAssets = [
    mk('a', 90, 100),        // −10% → 전역 15% 미달
    mk('b', 80, 100),        // −20% → 발동
    mk('c', 95, 100, 3),     // −5%  → 자산별 3% 발동
    mk('d', 50, 0),          // 최고가 0 → 제외
  ];
  check('computeAlertCount 전역 15%', computeAlertCount(alertAssets, 15), 2);
  check('computeAlertCount 전역 5%', computeAlertCount(alertAssets, 5), 3);
  check('computeAlertCount 빈 배열', computeAlertCount([], 10), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 14. normalizeValuationSettings — 방어적 파싱(P2 저장 도메인 대비)
// ════════════════════════════════════════════════════════════════════════════
{
  check('기본값 = native', DEFAULT_VALUATION_SETTINGS.plBasis, 'native');
  check('normalize undefined → native', normalizeValuationSettings(undefined), { plBasis: 'native' });
  check('normalize null → native', normalizeValuationSettings(null), { plBasis: 'native' });
  check('normalize {} → native', normalizeValuationSettings({}), { plBasis: 'native' });
  check("normalize {plBasis:'krw'} → krw", normalizeValuationSettings({ plBasis: 'krw' }), { plBasis: 'krw' });
  check("normalize {plBasis:'native'} → native", normalizeValuationSettings({ plBasis: 'native' }), { plBasis: 'native' });
  check("normalize {plBasis:'usd'} → native", normalizeValuationSettings({ plBasis: 'usd' }), { plBasis: 'native' });
  check("normalize 'krw'(맨 문자열) → native", normalizeValuationSettings('krw'), { plBasis: 'native' });
  check('normalize 배열 → native', normalizeValuationSettings([]), { plBasis: 'native' });
  check('normalize {plBasis:null} → native', normalizeValuationSettings({ plBasis: null }), { plBasis: 'native' });

  // 입력 불변 + 반환은 항상 새 객체(공유 참조로 기본값이 오염되지 않게)
  const input = { plBasis: 'krw', extra: 1 };
  const out = normalizeValuationSettings(input);
  check('normalize 입력 불변', input, { plBasis: 'krw', extra: 1 });
  check('normalize 여분 필드 제거', out, { plBasis: 'krw' });
  check('normalize 기본값 객체 재사용 안 함', normalizeValuationSettings(null) === DEFAULT_VALUATION_SETTINGS, false);

  check('PL_BASIS_ORDER', PL_BASIS_ORDER, ['native', 'krw']);
  check('라벨 키 2종', Object.keys(PL_BASIS_LABELS).sort(), ['krw', 'native']);
  check('부제 키 2종', Object.keys(PL_BASIS_SUBLABELS).sort(), ['krw', 'native']);
}

// ════════════════════════════════════════════════════════════════════════════
// 15. deriveSnapshotPurchaseValue — 손익 차트의 투자 원금 파생
//     스냅샷의 purchaseValue는 **항상 원화 기준**으로 저장된다. 달러 모드는 그날의 환율을
//     `currentValue / unitPriceOriginal`로 약분해 복원한다(스냅샷에 환율 필드는 없다).
// ════════════════════════════════════════════════════════════════════════════
{
  // XLE 오늘 스냅샷: 평가액 4,362,775.23 / 원본단가 $63.78 / 저장 원금 4,427,455.2(매수환율 1,498.8)
  // 파생: 59.08 × 4,362,775.23 / 63.78 = 59.08 × (50 × 1,368.07) = 4,041,278.78
  const xleSnap: AssetSnapshot = {
    id: 'xle', name: 'XLE', currency: Currency.USD,
    currentValue: 4_362_775.23, unitPriceOriginal: 63.78,
    purchaseValue: 4_427_455.2, purchaseUnitOriginal: 59.08,
  };
  checkClose('스냅샷 native 원금 4,041,278.78 (환율 약분)', deriveSnapshotPurchaseValue(xleSnap, 'native'), 4_041_278.78, KRW_EPS);
  checkClose('스냅샷 krw 원금 = 저장값 4,427,455.2', deriveSnapshotPurchaseValue(xleSnap, 'krw'), 4_427_455.2, KRW_EPS);
  // 파생값은 같은 날 metrics의 purchaseValueKRW와 일치해야 한다(차트 ↔ 표 정합) — 둘 다 절대값으로 고정돼 있다
  checkClose('스냅샷 native 원금 = 표의 native purchaseValueKRW',
    deriveSnapshotPurchaseValue(xleSnap, 'native'), computeAssetMetrics(XLE, RATES, 0, NATIVE).metrics.purchaseValueKRW, KRW_EPS);

  // KRW 자산 스냅샷 — 두 모드 모두 저장값(파생 분기 진입 금지)
  const krwSnap: AssetSnapshot = {
    id: 'k1', name: '삼성전자', currency: Currency.KRW,
    currentValue: 375_000, unitPrice: 75_000, unitPriceOriginal: 75_000,
    purchaseValue: 350_000,
  };
  checkClose('스냅샷 KRW 자산 native = 저장값', deriveSnapshotPurchaseValue(krwSnap, 'native'), 350_000);
  checkClose('스냅샷 KRW 자산 krw = 저장값', deriveSnapshotPurchaseValue(krwSnap, 'krw'), 350_000);

  // 통화 필드조차 없는 아주 오래된 스냅샷 → 저장값
  const noCurrencySnap = { id: 'old', name: 'OLD', currentValue: 100, purchaseValue: 90 } as AssetSnapshot;
  checkClose('스냅샷 통화 없음 native = 저장값', deriveSnapshotPurchaseValue(noCurrencySnap, 'native'), 90);

  // purchaseUnitOriginal 없는 구 스냅샷(외화) → 두 모드 모두 저장값(원화 기준으로 남는다)
  const legacySnap: AssetSnapshot = {
    id: 'xle', name: 'XLE', currency: Currency.USD,
    currentValue: 4_362_775.23, unitPriceOriginal: 63.78, purchaseValue: 4_427_455.2,
  };
  checkClose('스냅샷 구버전(필드 없음) native = 저장값', deriveSnapshotPurchaseValue(legacySnap, 'native'), 4_427_455.2, KRW_EPS);
  checkClose('스냅샷 구버전(필드 없음) krw = 저장값', deriveSnapshotPurchaseValue(legacySnap, 'krw'), 4_427_455.2, KRW_EPS);

  // unitPriceOriginal이 0(시세 미수신) → 0으로 나누지 않고 저장값
  const noPriceSnap: AssetSnapshot = {
    id: 'xle', name: 'XLE', currency: Currency.USD,
    currentValue: 0, unitPriceOriginal: 0, purchaseValue: 4_427_455.2, purchaseUnitOriginal: 59.08,
  };
  checkClose('스냅샷 원본단가 0 → 저장값(0 나눗셈 없음)', deriveSnapshotPurchaseValue(noPriceSnap, 'native'), 4_427_455.2, KRW_EPS);

  // 매수 전 0행 — 전부 0이면 두 모드 모두 0
  const zeroSnap: AssetSnapshot = {
    id: 'z', name: 'ZERO', currency: Currency.USD,
    currentValue: 0, unitPriceOriginal: 0, purchaseValue: 0, purchaseUnitOriginal: 0,
  };
  checkClose('스냅샷 0행 native 0', deriveSnapshotPurchaseValue(zeroSnap, 'native'), 0);
  checkClose('스냅샷 0행 krw 0', deriveSnapshotPurchaseValue(zeroSnap, 'krw'), 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n[portfolioMetricsParity] ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  fails.forEach(f => console.error(f));
  process.exit(1);
}
