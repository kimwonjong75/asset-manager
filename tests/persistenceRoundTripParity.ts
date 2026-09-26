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
import type { TurtleSettings, TurtlePosition } from '../types/turtle';
import type { TurtleHoldingsSettings, TurtleHoldingsWatchEntry, TurtleHoldDecision } from '../types/turtleHoldings';
import { resolveHoldingsSettings } from '../utils/turtleHoldings';
import { sanitizeTurtleWatchEntry, sanitizeTurtleHoldDecisions, sanitizeWatchlistTurtleFields } from '../utils/turtleHoldingsState';

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
    valuationSettings: { plBasis: 'krw' },
    columnConfig: [], tableLayout: {}, lastUpdateDate: '2026-07-05',
  };
  const loaded = roundTrip(exportShape) as Record<string, unknown>;
  for (const key of ['actionQueue', 'turtlePositions', 'turtleSettings', 'valuationSettings', 'allocationTargets']) {
    check(`exportData 키 존재: ${key}`, key in loaded, true);
  }
  // 수익률 기준은 값까지 확인 — 키만 있고 값이 기본값으로 돌아가면 두 PC의 판정이 갈린다.
  check('valuationSettings.plBasis 보존', (loaded.valuationSettings as { plBasis?: string })?.plBasis, 'krw');
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

// ════════════════════════════════════════════════════════════════════════════
// 7. turtleSettings.holdings(P0, TurtleHoldingsSettings) 라운드트립 — 새 필드는 기존 turtleSettings
//    객체 안에 실려 저장 경로(commitPortfolio/saveNow)를 그대로 타므로 여기서는 그 전제(JSON 직렬화가
//    새 중첩 optional 필드를 보존하는지 + 구 저장본(홀딩스 없음)에서 resolveHoldingsSettings가 안전한
//    기본값을 만드는지)만 확인한다. 저장 파이프라인 자체(usePortfolioData 등)는 수정하지 않았다.
// ════════════════════════════════════════════════════════════════════════════
{
  const holdings: TurtleHoldingsSettings = {
    entryLookback: 55, exitMethod: 'donchian', exitLookback: 20, maPeriod: 50, atrTrailMultiple: 3,
    stopMultipleN: 2, riskPerUnitPct: 1, maxUnitsPerPosition: 4, pyramidSpacing: '2R', pyramidCustomN: 1,
    pyramidSizeMultiplier: 1, positionCapPct: 10, maxTotalRiskPct: 24, drawdownScalingEnabled: true,
    minOrderKRW: 50_000, excludeFamilyOwner: true, excludedAssetIds: ['a1'], excludedCategoryIds: [9],
  };
  const settings: TurtleSettings = {
    satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 0.5, maxUnitsPerPosition: 2, entryLookback: 55,
    exitLookback: 20, stopMultipleN: 2, pyramidStepN: 0.5, maxTotalRiskPct: 12, positionValueCapPct: 25,
    drawdownScalingEnabled: true, holdings,
  };
  const loaded = roundTrip(settings);
  check('turtleSettings.holdings 라운드트립 보존(전체 동일)', loaded.holdings, holdings);
  check('기존 위성 필드 불변(satelliteBudgetKRW)', loaded.satelliteBudgetKRW, 100_000_000);
  check('기존 위성 필드 불변(maxTotalRiskPct=12, holdings와 별개)', loaded.maxTotalRiskPct, 12);
  check('resolveHoldingsSettings — 라운드트립된 값 그대로 반환', resolveHoldingsSettings(loaded.holdings), holdings);

  // 구 저장본(홀딩스 필드 없음) — resolveHoldingsSettings가 안전한 기본값을 만들어야 한다.
  const legacySettings: TurtleSettings = { ...settings, holdings: undefined };
  const loadedLegacy = roundTrip(legacySettings) as TurtleSettings & { holdings?: unknown };
  check('구 저장본은 holdings 키 없음(직렬화 생략)', 'holdings' in loadedLegacy, false);
  const resolvedLegacy = resolveHoldingsSettings(loadedLegacy.holdings as TurtleHoldingsSettings | undefined);
  check('구 저장본 → resolveHoldingsSettings 기본값(entryLookback=55)', resolvedLegacy.entryLookback, 55);
  check('구 저장본 → resolveHoldingsSettings 기본값(positionCapPct=10)', resolvedLegacy.positionCapPct, 10);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 보유종목 터틀 P1 저장 필드 — WatchlistItem.turtleWatch · Asset.turtleDecisions ·
//    TurtlePosition.origin/trailHighClose 왕복 보존, 구 저장본 안전 로드, 손상값 폐기.
//    (watchlist·turtlePositions는 로더가 `Array.isArray` 캐스팅만 하므로 여기서는 그 전제 위에서
//    검증 접근자 sanitizeTurtleWatchEntry/sanitizeTurtleHoldDecisions가 손상값을 거르는지 확인한다.)
// ════════════════════════════════════════════════════════════════════════════
{
  const watchEntry: TurtleHoldingsWatchEntry = { soldAt: '2026-09-20', soldPriceOriginal: 68_000, source: 'turtle-exit' };
  const watch: WatchlistItem = {
    id: 'w1', ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자', categoryId: 1,
    currency: Currency.KRW, isTurtleCandidate: true, turtleWatch: watchEntry,
  };
  const loadedWatch = roundTrip([watch])[0];
  check('turtleWatch 라운드트립 보존', loadedWatch.turtleWatch, watchEntry);
  check('sanitizeTurtleWatchEntry — 정상값 통과', sanitizeTurtleWatchEntry(loadedWatch.turtleWatch), watchEntry);

  // 구 저장본(필드 없음) — 미주입, 기본값 강제 없음
  const legacyWatch = { id: 'w2', ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple', categoryId: 2 } as WatchlistItem;
  const loadedLegacyWatch = roundTrip(legacyWatch);
  check('구 저장본 turtleWatch 미주입(undefined)', loadedLegacyWatch.turtleWatch, undefined);
  check('구 저장본 직렬화에 turtleWatch 키 없음', 'turtleWatch' in JSON.parse(JSON.stringify(legacyWatch)), false);
  check('sanitizeTurtleWatchEntry — undefined 입력 → undefined', sanitizeTurtleWatchEntry(undefined), undefined);

  // 손상값 폐기 — 형태 불량(soldPriceOriginal 음수·source 모르는 값·객체 아님)은 값을 지어내지 않고 버림
  check('sanitize — soldPriceOriginal<=0 폐기', sanitizeTurtleWatchEntry({ soldAt: 'x', soldPriceOriginal: 0, source: 'manual' }), undefined);
  check('sanitize — 알 수 없는 source 폐기', sanitizeTurtleWatchEntry({ soldAt: 'x', soldPriceOriginal: 100, source: 'hacked' }), undefined);
  check('sanitize — 객체 아님(문자열) 폐기', sanitizeTurtleWatchEntry('not-an-object'), undefined);
  check('sanitize — null 폐기', sanitizeTurtleWatchEntry(null), undefined);

  // Asset.turtleDecisions — mapToNewAssetStructure(spread) 경유 보존
  const decisions: TurtleHoldDecision[] = [
    { date: '2026-09-01', action: 'hold', reason: '반등 기대' },
    { date: '2026-09-08', action: 'hold', reason: '한 번 더 보류' },
  ];
  const assetWithDecisions: Asset = {
    id: 'a10', categoryId: 1, ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자', quantity: 10,
    purchasePrice: 60_000, purchaseDate: '2026-01-01', currency: Currency.KRW,
    currentPrice: 65_000, priceOriginal: 65_000, highestPrice: 70_000, turtleDecisions: decisions,
  };
  const loadedAsset = mapToNewAssetStructure(roundTrip(assetWithDecisions));
  check('Asset.turtleDecisions 라운드트립 보존', loadedAsset.turtleDecisions, decisions);
  check('sanitizeTurtleHoldDecisions — 정상 배열 통과', sanitizeTurtleHoldDecisions(loadedAsset.turtleDecisions), decisions);

  const legacyAsset = mapToNewAssetStructure(roundTrip({ ...assetWithDecisions, turtleDecisions: undefined }));
  check('구 저장본 turtleDecisions 미주입(undefined)', legacyAsset.turtleDecisions, undefined);
  check('sanitizeTurtleHoldDecisions — undefined 입력 → undefined', sanitizeTurtleHoldDecisions(undefined), undefined);

  // 손상값 폐기 — 배열 아님/원소 형태 불량(사유 없음·action 다름)은 해당 원소만 제외
  check('sanitize — 배열 아님 폐기(undefined 반환)', sanitizeTurtleHoldDecisions('not-an-array'), undefined);
  const mixed = [
    { date: '2026-09-01', action: 'hold', reason: '정상' },
    { date: '2026-09-02', action: 'hold', reason: '' },          // 사유 없음 → 제외
    { date: '2026-09-03', action: 'sell', reason: '다른 action' }, // action 불일치 → 제외
    { date: '2026-09-04' },                                       // 필드 누락 → 제외
  ];
  const sanitizedMixed = sanitizeTurtleHoldDecisions(mixed);
  check('sanitize — 손상 원소만 제외, 정상 1건만 통과', sanitizedMixed, [{ date: '2026-09-01', action: 'hold', reason: '정상' }]);

  // TurtlePosition.origin/trailHighClose — 순수 배열 라운드트립(turtlePositions 로더는 Array.isArray 캐스팅만)
  const position: TurtlePosition = {
    id: 'tp-1', ticker: '005930', name: '삼성전자', units: [{ fillDate: '2026-09-22', fillPrice: 50_000, quantity: 20, nAtFill: 1_500 }],
    stopPrice: 47_000, entryDonchianHigh: 51_000, status: 'open', openedAt: '2026-09-22',
    origin: 'holdings-reentry', trailHighClose: 50_000,
  };
  const loadedPositions = roundTrip([position]);
  check('TurtlePosition.origin 라운드트립 보존', loadedPositions[0].origin, 'holdings-reentry');
  check('TurtlePosition.trailHighClose 라운드트립 보존', loadedPositions[0].trailHighClose, 50_000);

  const legacyPosition = { ...position, origin: undefined, trailHighClose: undefined };
  const loadedLegacyPosition = roundTrip(legacyPosition);
  check('구 위성 포지션 origin 미주입(undefined)', loadedLegacyPosition.origin, undefined);
  check('구 위성 포지션 직렬화에 origin 키 없음', 'origin' in JSON.parse(JSON.stringify(legacyPosition)), false);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. P2 — 로드 경로 실배선 확인. §7·§8은 sanitize 함수 자체와 mapToNewAssetStructure의 spread 보존만
//    확인했다(경로 A-vs-B 자기참조가 아니라, 실제 로드 파이프라인이 손상값을 걸러내는지 확인).
//    hooks/usePortfolioData.ts는 mapToNewAssetStructure(자산)와 sanitizeWatchlistTurtleFields(watchlist,
//    2곳)를 호출한다 — 여기서는 그 두 진입점 자체를 손상 입력으로 직접 두드린다.
// ════════════════════════════════════════════════════════════════════════════
{
  // 9-a. mapToNewAssetStructure가 손상된 turtleDecisions 원소를 실제로 걸러낸다(사유 없음 항목 제외).
  const corruptedAsset = {
    id: 'a11', categoryId: 1, ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자', quantity: 10,
    purchasePrice: 60_000, purchaseDate: '2026-01-01', currency: Currency.KRW,
    currentPrice: 65_000, priceOriginal: 65_000, highestPrice: 70_000,
    turtleDecisions: [
      { date: '2026-09-01', action: 'hold', reason: '정상' },
      { date: '2026-09-02', action: 'hold', reason: '' }, // 사유 없음 → mapToNewAssetStructure가 걸러내야 함
    ],
  } as unknown as Asset;
  const mapped = mapToNewAssetStructure(corruptedAsset);
  check('mapToNewAssetStructure — 손상 원소 제외, 정상 1건만 통과', mapped.turtleDecisions, [
    { date: '2026-09-01', action: 'hold', reason: '정상' },
  ]);

  // 9-b. mapToNewAssetStructure — turtleDecisions 필드 자체가 없으면 그대로 undefined(기본값 주입 금지).
  const plainAsset = {
    id: 'a12', categoryId: 1, ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple', quantity: 5,
    purchasePrice: 150, purchaseDate: '2026-01-01', currency: Currency.USD,
    currentPrice: 200, priceOriginal: 200, highestPrice: 210,
  } as unknown as Asset;
  check('mapToNewAssetStructure — 필드 없으면 undefined', mapToNewAssetStructure(plainAsset).turtleDecisions, undefined);

  // 9-c. sanitizeWatchlistTurtleFields(실제 로드 경로 헬퍼) — 손상된 turtleWatch만 제거, 나머지 보존.
  const w1: WatchlistItem = {
    id: 'w1', ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자', categoryId: 1,
    currency: Currency.KRW, isTurtleCandidate: true,
    turtleWatch: { soldAt: '2026-09-20', soldPriceOriginal: 68_000, source: 'turtle-exit' },
  };
  const w2 = {
    id: 'w2', ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple', categoryId: 2,
    isTurtleCandidate: true, turtleWatch: { soldAt: 'x', soldPriceOriginal: -1, source: 'turtle-exit' },
  } as unknown as WatchlistItem; // 손상(soldPriceOriginal<=0)
  const w3: WatchlistItem = { id: 'w3', ticker: 'MSFT', exchange: 'NASDAQ', name: 'Microsoft', categoryId: 2 }; // turtleWatch 없음

  const sanitized = sanitizeWatchlistTurtleFields([w1, w2, w3]);
  check('9-c 정상 turtleWatch 보존', sanitized[0].turtleWatch, w1.turtleWatch);
  check('9-c 손상 turtleWatch 제거', 'turtleWatch' in sanitized[1], false);
  check('9-c turtleWatch 없던 항목은 원본 참조 유지(불필요한 복제 없음)', sanitized[2] === w3, true);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ persistenceRoundTrip parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ persistenceRoundTrip parity 전체 통과 (${pass} 단언)`);
