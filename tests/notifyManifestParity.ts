// tests/notifyManifestParity.ts
// ---------------------------------------------------------------------------
// utils/notifyManifest.ts 골든 테스트 — 명시적 절대값만 고정한다.
//   · buildNotifyManifest: 활성 계획만 · CASH 제외 · 유선(YUSEON) 기본 제외(옵션으로 포함) ·
//     필드 매핑(assetId/ticker/exchange/name/currency/quantity/plan) · customName 우선
//   · manifestHash: 안정(키 순서 무관) · 시각 필드(asOf/updatedAt) 제외 · 내용 변경 시 값 변경
//
// 수동 실행: npm run test:notifymanifest (tsx). 통과 시 exit 0.

import { Currency, type Asset, type WatchlistItem } from '../types';
import { DEFAULT_CATEGORIES } from '../types/category';
import type { TradePlan } from '../types/tradePlan';
import type { TurtlePosition } from '../types/turtle';
import { buildTradePlan } from '../utils/tradePlan';
import { buildNotifyManifest, manifestHash, type NotifyManifest } from '../utils/notifyManifest';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function ok(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}`);
}

const CASH_CATEGORY_ID = DEFAULT_CATEGORIES.find(c => c.baseType === 'CASH')?.id ?? -1;
const STOCK_CATEGORY_ID = DEFAULT_CATEGORIES.find(c => c.baseType === 'KOREAN_STOCK')?.id
  ?? DEFAULT_CATEGORIES.find(c => c.baseType !== 'CASH')!.id;

function mkPlan(now = '2026-09-01T00:00:00.000Z'): TradePlan {
  const r = buildTradePlan({
    mode: 'holding', anchor: 'today', anchorPrice: 10_000, anchorDate: '2026-09-01',
    currency: Currency.KRW, totalEquityKRW: 1_000_000_000, riskPct: 1, stopPct: 7, profitMultiple: 3,
    exitLine: { kind: 'ma', period: 20 }, pyramid: { enabled: false, stepUnit: 'pct', step: 10, sizing: 'half', maxAdds: 3 },
    holdingQuantity: 100, fxRateToKRW: 1, now,
  });
  if (!r.ok) throw new Error('fixture plan build failed');
  return r.plan;
}

function mkAsset(o: Partial<Asset> = {}): Asset {
  return {
    id: 'a1', categoryId: STOCK_CATEGORY_ID, ticker: 'PUNGSAN', exchange: 'KRX (코스피/코스닥)',
    name: '풍산', quantity: 100, purchasePrice: 10_000, purchaseDate: '2026-01-01',
    currency: Currency.KRW, currentPrice: 12_000, priceOriginal: 12_000, highestPrice: 13_000,
    ...o,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. buildNotifyManifest — 대상 필터
// ════════════════════════════════════════════════════════════════════════════
{
  const active = mkAsset({ id: 'a1', tradePlan: mkPlan() });
  const noPlan = mkAsset({ id: 'a2', ticker: 'NOPLAN' });
  const closedPlan = mkAsset({ id: 'a3', ticker: 'CLOSED', tradePlan: { ...mkPlan(), status: 'closed' } });
  const cash = mkAsset({ id: 'a4', ticker: 'CASH', categoryId: CASH_CATEGORY_ID, tradePlan: mkPlan() });
  const yuseon = mkAsset({ id: 'a5', ticker: 'YUSEON1', owner: 'YUSEON', tradePlan: mkPlan() });

  const manifest = buildNotifyManifest({
    assets: [active, noPlan, closedPlan, cash, yuseon],
    appUrl: 'https://example.test/', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: false,
  });

  check('활성 계획 1건만 포함(계획없음/종료/현금/유선 제외)', manifest.items.map(i => i.assetId), ['a1']);
  check('version=1', manifest.version, 1);
  check('asOf=now', manifest.asOf, '2026-09-03T00:00:00.000Z');
  check('updatedAt=now', manifest.updatedAt, '2026-09-03T00:00:00.000Z');
  check('appUrl 전달', manifest.appUrl, 'https://example.test/');
  check('pyramidAlerts 전달(false)', manifest.pyramidAlerts, false);

  const withYuseon = buildNotifyManifest({
    assets: [active, yuseon], appUrl: 'https://example.test/', now: '2026-09-03T00:00:00.000Z',
    pyramidAlerts: true, includeYuseon: true,
  });
  check('includeYuseon:true → 유선도 포함(2건)', withYuseon.items.map(i => i.assetId).sort(), ['a1', 'a5']);
  check('pyramidAlerts 전달(true)', withYuseon.pyramidAlerts, true);
  check('planlessCount: 위성 아님 → 0', manifest.planlessCount, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 1b. buildNotifyManifest — planlessCount(계획 없는 투더문 보유)
// ════════════════════════════════════════════════════════════════════════════
{
  const planlessSatellite = mkAsset({ id: 'p1', ticker: 'SAT1', bucket: 'SATELLITE' }); // 계획 없음
  const planlessSatellite2 = mkAsset({ id: 'p2', ticker: 'SAT2', bucket: 'SATELLITE' });
  const satelliteWithPlan = mkAsset({ id: 'p3', ticker: 'SAT3', bucket: 'SATELLITE', tradePlan: mkPlan() });
  const coreNoPlan = mkAsset({ id: 'p4', ticker: 'CORE1', bucket: 'CORE' }); // 코어는 대상 아님
  const manifest = buildNotifyManifest({
    assets: [planlessSatellite, planlessSatellite2, satelliteWithPlan, coreNoPlan],
    appUrl: 'https://example.test/', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: false,
  });
  check('계획 있는 위성 1건만 items에 포함', manifest.items.map(i => i.assetId), ['p3']);
  check('planlessCount: 계획 없는 위성 2건', manifest.planlessCount, 2);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. buildNotifyManifest — 필드 매핑
// ════════════════════════════════════════════════════════════════════════════
{
  const plan = mkPlan();
  const withCustomName = mkAsset({
    id: 'b1', ticker: 'PUNGSAN', exchange: 'KRX (코스피/코스닥)', name: '풍산',
    customName: '풍산(메모)', currency: Currency.KRW, quantity: 77, tradePlan: plan,
  });
  const manifest = buildNotifyManifest({
    assets: [withCustomName], appUrl: 'https://a.test', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: false,
  });
  const item = manifest.items[0];
  check('assetId', item.assetId, 'b1');
  check('ticker', item.ticker, 'PUNGSAN');
  check('exchange', item.exchange, 'KRX (코스피/코스닥)');
  check('customName 우선', item.name, '풍산(메모)');
  check('currency', item.currency, Currency.KRW);
  check('quantity', item.quantity, 77);
  check('plan 참조 그대로', item.plan, plan);

  const withoutCustomName = mkAsset({ id: 'b2', name: '한샘', customName: undefined, tradePlan: mkPlan() });
  const manifest2 = buildNotifyManifest({
    assets: [withoutCustomName], appUrl: 'https://a.test', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: false,
  });
  check('customName 없으면 name 사용', manifest2.items[0].name, '한샘');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. manifestHash — 안정성
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = mkAsset({ id: 'c1', tradePlan: mkPlan() });
  const m1: NotifyManifest = buildNotifyManifest({
    assets: [asset], appUrl: 'https://a.test', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: false,
  });
  const m2: NotifyManifest = buildNotifyManifest({
    assets: [asset], appUrl: 'https://a.test', now: '2026-09-05T12:34:56.000Z', pyramidAlerts: false,
  });
  ok('내용 동일 + asOf만 다름 → 해시 동일', manifestHash(m1) === manifestHash(m2));
  ok('해시는 8자리 16진수', /^[0-9a-f]{8}$/.test(manifestHash(m1)));

  const m3: NotifyManifest = buildNotifyManifest({
    assets: [asset], appUrl: 'https://a.test', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: true, // 내용 변경
  });
  ok('pyramidAlerts 변경 → 해시 변경', manifestHash(m1) !== manifestHash(m3));

  const emptyManifest: NotifyManifest = buildNotifyManifest({
    assets: [], appUrl: 'https://a.test', now: '2026-09-03T00:00:00.000Z', pyramidAlerts: false,
  });
  ok('빈 items 도 안정적인 해시를 반환', /^[0-9a-f]{8}$/.test(manifestHash(emptyManifest)));

  // 키 순서만 다른 동일 객체 → 동일 해시(stableStringify 정렬 확인)
  const reordered: NotifyManifest = { ...m1, items: m1.items.map(i => ({ plan: i.plan, quantity: i.quantity, name: i.name, exchange: i.exchange, ticker: i.ticker, currency: i.currency, assetId: i.assetId })) };
  ok('필드 순서만 다른 아이템 → 동일 해시', manifestHash(m1) === manifestHash(reordered));

  const differentQty: NotifyManifest = { ...m1, items: [{ ...m1.items[0], quantity: 999 }] };
  ok('수량 변경 → 해시 변경', manifestHash(m1) !== manifestHash(differentQty));
}

// ════════════════════════════════════════════════════════════════════════════
// 4. buildNotifyManifest — "보유종목 터틀" 섹션(P4, 2026-09-26)
// ════════════════════════════════════════════════════════════════════════════
{
  const legacyHolding = mkAsset({ id: 'h1', ticker: 'OTTOGI', name: '오뚜기', quantity: 10, tradePlan: undefined });
  const reentryAsset = mkAsset({ id: 'h2', ticker: 'SAMSUNG', name: '삼성전자', quantity: 50, tradePlan: undefined });
  const yuseonHolding = mkAsset({ id: 'h3', ticker: 'FAMILY', name: '가족종목', quantity: 5, owner: 'YUSEON', tradePlan: undefined });
  const cashAsset = mkAsset({ id: 'h4', ticker: 'CASH2', categoryId: CASH_CATEGORY_ID, quantity: 1, tradePlan: undefined });

  const reentryPosition: TurtlePosition = {
    id: 'pos1', ticker: 'SAMSUNG', name: '삼성전자', assetId: 'h2',
    units: [{ fillDate: '2026-09-01', fillPrice: 68_000, quantity: 50, nAtFill: 1_500 }],
    stopPrice: 65_000, entryDonchianHigh: 70_000, status: 'open', openedAt: '2026-09-01',
    origin: 'holdings-reentry',
  };
  const closedPosition: TurtlePosition = {
    ...reentryPosition, id: 'pos-closed', status: 'closed', closedAt: '2026-09-10',
  };
  const satellitePosition: TurtlePosition = {
    id: 'pos-satellite', ticker: 'ETC', name: '위성종목', units: [{ fillDate: '2026-09-01', fillPrice: 1000, quantity: 1, nAtFill: 10 }],
    stopPrice: 900, entryDonchianHigh: 1100, status: 'open', openedAt: '2026-09-01', // origin 미지정 — 위성(90/10)
  };

  const watchCandidate: WatchlistItem = {
    id: 'w1', ticker: 'HYUNDAI', exchange: 'KRX (코스피/코스닥)', name: '현대차', categoryId: STOCK_CATEGORY_ID,
    isTurtleCandidate: true,
  };
  const watchNotCandidate: WatchlistItem = {
    id: 'w2', ticker: 'KIA', exchange: 'KRX (코스피/코스닥)', name: '기아', categoryId: STOCK_CATEGORY_ID,
    isTurtleCandidate: false,
  };
  // 이미 보유(legacyHolding=OTTOGI)와 같은 종목의 감시 항목 — 중복 매수 방지로 제외되어야 함
  const watchDuplicateOfHeld: WatchlistItem = {
    id: 'w3', ticker: 'OTTOGI', exchange: 'KRX (코스피/코스닥)', name: '오뚜기(중복)', categoryId: STOCK_CATEGORY_ID,
    isTurtleCandidate: true,
  };

  const manifest = buildNotifyManifest({
    assets: [legacyHolding, reentryAsset, yuseonHolding, cashAsset],
    watchlist: [watchCandidate, watchNotCandidate, watchDuplicateOfHeld],
    turtlePositions: [reentryPosition, closedPosition, satellitePosition],
    appUrl: 'https://example.test/', now: '2026-09-15T00:00:00.000Z', pyramidAlerts: false,
  });

  ok('turtle 섹션 존재', manifest.turtle !== undefined);
  const turtle = manifest.turtle!;

  check('legacyHoldings: 재매수 포지션 있는 자산·현금·유선 제외 → OTTOGI만',
    turtle.legacyHoldings.map(h => h.ticker), ['OTTOGI']);
  check('legacyHoldings 필드 매핑', turtle.legacyHoldings[0], {
    assetId: 'h1', ticker: 'OTTOGI', exchange: 'KRX (코스피/코스닥)', name: '오뚜기',
    currency: Currency.KRW, isCrypto: false, quantity: 10,
  });

  check('reentryPositions: open + origin=holdings-reentry만(위성·closed 제외) → 1건',
    turtle.reentryPositions.map(p => p.positionId), ['pos1']);
  check('reentryPositions 필드 매핑', turtle.reentryPositions[0], {
    positionId: 'pos1', assetId: 'h2', ticker: 'SAMSUNG', exchange: 'KRX (코스피/코스닥)', name: '삼성전자',
    currency: Currency.KRW, isCrypto: false,
    units: [{ fillPrice: 68_000, quantity: 50, nAtFill: 1_500 }],
    quantity: 50, stopPrice: 65_000, trailHighClose: null, openedAt: '2026-09-01',
  });

  check('watchItems: isTurtleCandidate만 + 이미 보유 중인 티커(OTTOGI) 중복 제외 → HYUNDAI만',
    turtle.watchItems.map(w => w.ticker), ['HYUNDAI']);
  check('watchItems 필드 매핑', turtle.watchItems[0], {
    watchItemId: 'w1', ticker: 'HYUNDAI', exchange: 'KRX (코스피/코스닥)', name: '현대차',
    currency: Currency.KRW, isCrypto: false,
  });

  ok('turtle.settings는 resolveHoldingsSettings 결과(기본값 exitLookback=20 포함)', turtle.settings.exitLookback === 20);

  // 가족(유선) 제외 옵션 끄기 — excludeFamilyOwner:false 로 재조립하면 유선 보유도 legacyHoldings에 포함
  const manifestWithFamily = buildNotifyManifest({
    assets: [legacyHolding, yuseonHolding],
    turtleHoldingsSettings: { excludeFamilyOwner: false },
    appUrl: 'https://example.test/', now: '2026-09-15T00:00:00.000Z', pyramidAlerts: false,
  });
  check('excludeFamilyOwner:false → 유선 보유도 포함(2건)',
    manifestWithFamily.turtle!.legacyHoldings.map(h => h.ticker).sort(), ['FAMILY', 'OTTOGI']);

  // watchlist/turtlePositions 미지정 → 빈 배열(하위 호환)
  const bareManifest = buildNotifyManifest({
    assets: [legacyHolding], appUrl: 'https://example.test/', now: '2026-09-15T00:00:00.000Z', pyramidAlerts: false,
  });
  check('watchlist/turtlePositions 미지정 → 터틀 섹션도 정상 조립(빈 목록)', {
    reentry: bareManifest.turtle!.reentryPositions.length, watch: bareManifest.turtle!.watchItems.length,
  }, { reentry: 0, watch: 0 });
}

// ════════════════════════════════════════════════════════════════════════════
// 4b. manifestHash — 터틀 섹션 변경 감지
// ════════════════════════════════════════════════════════════════════════════
{
  const legacyHolding = mkAsset({ id: 'th1', ticker: 'OTTOGI', name: '오뚜기', quantity: 10, tradePlan: undefined });
  const base = buildNotifyManifest({
    assets: [legacyHolding], appUrl: 'https://a.test', now: '2026-09-15T00:00:00.000Z', pyramidAlerts: false,
  });
  const qtyChanged = buildNotifyManifest({
    assets: [{ ...legacyHolding, quantity: 999 }], appUrl: 'https://a.test', now: '2026-09-20T00:00:00.000Z', pyramidAlerts: false,
  });
  ok('터틀 보유 수량 변경 → 해시 변경(시각만 다른 재조립과 구분)', manifestHash(base) !== manifestHash(qtyChanged));

  const settingsChanged = buildNotifyManifest({
    assets: [legacyHolding], turtleHoldingsSettings: { exitLookback: 10 },
    appUrl: 'https://a.test', now: '2026-09-15T00:00:00.000Z', pyramidAlerts: false,
  });
  ok('터틀 설정 변경(exitLookback) → 해시 변경', manifestHash(base) !== manifestHash(settingsChanged));

  const sameAgain = buildNotifyManifest({
    assets: [legacyHolding], appUrl: 'https://a.test', now: '2026-09-25T00:00:00.000Z', pyramidAlerts: false,
  });
  ok('내용 동일 + 시각만 다름(터틀 포함) → 해시 동일', manifestHash(base) === manifestHash(sameAgain));
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ notifyManifest parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ notifyManifest parity 전체 통과 (${pass} 단언)`);
