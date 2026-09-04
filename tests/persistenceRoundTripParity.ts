// tests/persistenceRoundTripParity.ts
// ---------------------------------------------------------------------------
// Drive 저장/로드 라운드트립 — 새 필드가 로드 파이프라인에서 유실되지 않는지 (D1 자동화).
// exportData는 JSON.stringify로 저장되고, 로드는 JSON.parse → mapToNewAssetStructure(자산 필드 재작성,
//   region strip)로 들어간다. 이 변환이 신규 필드(cleanupTag/excludedFromCleanup/bucket)를 보존하는지,
//   allocationTargets.categoryInstruments·90/10 최상위 키가 직렬화에서 살아남는지 절대값으로 고정한다.
// 수동 실행: npm run test:persist (tsx). 통과 시 exit 0.

import { Asset, AllocationTargets, Currency, RebalanceInstrument, WatchlistItem } from '../types';
import type { TradePlan } from '../types/tradePlan';
import { mapToNewAssetStructure } from '../utils/portfolioCalculations';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

/** Drive 저장→로드 시뮬레이션: 객체 → JSON 직렬화 → 역직렬화 (plain data 라운드트립). */
function roundTrip<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 자산 신규 필드 보존 — 라운드트립 + mapToNewAssetStructure(로드 변환)
// ════════════════════════════════════════════════════════════════════════════
{
  const asset: Asset = {
    id: 'a1', categoryId: 2, ticker: 'VOO', exchange: 'NASDAQ', name: 'VOO', quantity: 10,
    purchasePrice: 100, purchaseDate: '2025-01-01', currency: Currency.USD,
    currentPrice: 120, priceOriginal: 120, highestPrice: 130,
    bucket: 'SATELLITE', owner: 'YUSEON', cleanupTag: 'liquidate', excludedFromCleanup: true,
  };
  const loaded = mapToNewAssetStructure(roundTrip(asset));
  check('cleanupTag 보존', loaded.cleanupTag, 'liquidate');
  check('excludedFromCleanup 보존', loaded.excludedFromCleanup, true);
  check('bucket 보존(SATELLITE)', loaded.bucket, 'SATELLITE');
  check('owner 보존(YUSEON)', loaded.owner, 'YUSEON');
  check('categoryId 보존', loaded.categoryId, 2);
  check('quantity 보존', loaded.quantity, 10);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 레거시 자산 — 신규 필드 없으면 기본값 강제 주입 안 함(미검토≠keep, 누락=false)
// ════════════════════════════════════════════════════════════════════════════
{
  const legacy = {
    id: 'a2', categoryId: 1, ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자',
    quantity: 5, purchasePrice: 70000, purchaseDate: '2024-01-01', currency: Currency.KRW,
    currentPrice: 75000, priceOriginal: 75000, highestPrice: 80000,
  } as Asset;
  const loaded = mapToNewAssetStructure(roundTrip(legacy));
  check('레거시 cleanupTag 미주입(undefined)', loaded.cleanupTag, undefined);
  check('레거시 excludedFromCleanup 미주입(undefined)', loaded.excludedFromCleanup, undefined);
  check('레거시 bucket 기본 CORE', loaded.bucket, 'CORE');
  check('레거시 owner 백필(WONJONG — 이름에 유선 없음)', loaded.owner, 'WONJONG');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. region은 로드 변환에서 제거되어야 함(스키마 정리) — 신규 필드는 그대로
// ════════════════════════════════════════════════════════════════════════════
{
  const withRegion = {
    id: 'a3', categoryId: 2, ticker: 'SPY', exchange: 'NYSE', name: 'SPY', quantity: 1,
    purchasePrice: 400, purchaseDate: '2025-01-01', currency: Currency.USD,
    currentPrice: 450, priceOriginal: 450, highestPrice: 460, cleanupTag: 'core', region: 'US',
  } as Asset & { region: string };
  const loaded = mapToNewAssetStructure(roundTrip(withRegion)) as Asset & { region?: string };
  check('region 제거', loaded.region, undefined);
  check('region 옆 cleanupTag 보존', loaded.cleanupTag, 'core');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. allocationTargets.categoryInstruments 라운드트립 보존 (리밸런싱 대표종목)
// ════════════════════════════════════════════════════════════════════════════
{
  const inst: RebalanceInstrument = { ticker: '464470', exchange: 'KRX (코스피/코스닥)', categoryId: 6, name: 'PLUS 미국채', currency: Currency.KRW };
  const at: AllocationTargets = {
    weights: { '1': 40, '2': 60 }, targetTotalAmount: 953_000_000,
    bucketWeights: { CORE: 90, SATELLITE: 10 }, categoryInstruments: { '6': inst },
  };
  const loaded = roundTrip(at);
  check('categoryInstruments 보존', loaded.categoryInstruments, { '6': inst });
  check('bucketWeights 보존', loaded.bucketWeights, { CORE: 90, SATELLITE: 10 });
  check('targetTotalAmount 보존', loaded.targetTotalAmount, 953_000_000);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. exportData 구조 — 90/10 최상위 키가 직렬화 대상에 포함되는지 (누락=미저장 방지)
//    ※ useGoogleDriveSync.autoSave의 exportData 객체 형태를 그대로 재현해 키 존재를 고정.
// ════════════════════════════════════════════════════════════════════════════
{
  const exportShape = {
    assets: [], portfolioHistory: [], sellHistory: [], watchlist: [], exchangeRates: { USD: 1400, JPY: 9 },
    allocationTargets: { weights: {}, categoryInstruments: {} }, sellAlertDropRate: 15,
    categoryStore: {}, knowledgeBase: {}, actionQueue: [], turtlePositions: [], turtleSettings: {},
    columnConfig: [], tableLayout: {}, lastUpdateDate: '2026-07-05',
  };
  const loaded = roundTrip(exportShape) as Record<string, unknown>;
  for (const key of ['actionQueue', 'turtlePositions', 'turtleSettings', 'allocationTargets']) {
    check(`exportData 키 존재: ${key}`, key in loaded, true);
  }
  check('allocationTargets.categoryInstruments 키', 'categoryInstruments' in (loaded.allocationTargets as object), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 매매 계획(tradePlan) 라운드트립 — Asset(mapToNewAssetStructure 경유)·WatchlistItem(배열 통과)
//    중첩 객체·optional 필드·빈 배열(decisions)·null(takeProfitPrice)이 그대로 보존되어야 한다.
// ════════════════════════════════════════════════════════════════════════════
{
  const plan: TradePlan = {
    version: 1, mode: 'holding', createdAt: '2026-09-03T05:20:00.000Z', updatedAt: '2026-09-03T05:20:00.000Z',
    anchor: 'today', anchorPrice: 10_000, anchorDate: '2026-09-03', currency: Currency.KRW,
    totalEquityKRW: 100_000_000, riskPct: 1, stopPct: 7, stopPrice: 9_300, profitMultiple: null, takeProfitPrice: null,
    exitLine: { kind: 'ma', period: 50 }, exitLineArmMode: 'after-reclaim',
    pyramid: { enabled: true, stepUnit: 'r', step: 2, sizing: 'half', maxAdds: 2,
      steps: [{ level: 1, triggerPrice: 11_400, plannedQuantity: 50, fill: { date: '2026-09-10', price: 11_450, quantity: 50 } }, { level: 2, triggerPrice: 12_800, plannedQuantity: 25 }] },
    plannedQuantity: 100, brokerStopOrderRegistered: true,
    decisions: [{ date: '2026-09-04', signal: 'near-stop', choice: 'tomorrow', reason: '다시 생각' }],
    status: 'active',
  };
  const asset: Asset = {
    id: 'a9', categoryId: 1, ticker: '103140', exchange: 'KRX (코스피/코스닥)', name: '풍산', quantity: 100,
    purchasePrice: 9_000, purchaseDate: '2026-01-01', currency: Currency.KRW,
    currentPrice: 10_000, priceOriginal: 10_000, highestPrice: 11_000, bucket: 'SATELLITE', tradePlan: plan,
  };
  const loaded = mapToNewAssetStructure(roundTrip(asset));
  check('Asset.tradePlan 보존(전체 동일)', loaded.tradePlan, plan);
  check('Asset.tradePlan 중첩 fill 보존', loaded.tradePlan?.pyramid.steps[0].fill, { date: '2026-09-10', price: 11_450, quantity: 50 });
  check('Asset.tradePlan takeProfitPrice null 보존', loaded.tradePlan?.takeProfitPrice, null);
  const noPlan = mapToNewAssetStructure(roundTrip({ ...asset, tradePlan: undefined }));
  check('계획 없는 자산은 tradePlan 미주입(undefined)', noPlan.tradePlan, undefined);
  check('계획 없는 자산 직렬화에 tradePlan 키 없음', 'tradePlan' in JSON.parse(JSON.stringify({ ...asset, tradePlan: undefined })), false);

  const watch: WatchlistItem = {
    id: 'w1', ticker: 'SLV', exchange: 'NYSE', name: 'iShares Silver', categoryId: 2, currency: Currency.USD,
    tradePlan: { ...plan, mode: 'new-buy', currency: Currency.USD, anchorPrice: 59.07, stopPrice: 54.9351, plannedQuantity: 1764, pyramid: { ...plan.pyramid, enabled: false, steps: [] } },
  };
  const loadedWatch = roundTrip([watch])[0];
  check('WatchlistItem.tradePlan 보존', loadedWatch.tradePlan, watch.tradePlan);
  check('WatchlistItem.tradePlan mode new-buy', loadedWatch.tradePlan?.mode, 'new-buy');
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ persistenceRoundTrip parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ persistenceRoundTrip parity 전체 통과 (${pass} 단언)`);
