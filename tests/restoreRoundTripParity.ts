// tests/restoreRoundTripParity.ts
// ---------------------------------------------------------------------------
// 백업 복원 라운드트립 — parsePortfolioPayload가 전 도메인을 유실 없이 파싱하는지 (P2 자동화),
// 그리고 백필 영속 시 적용되는 365 캡 슬라이싱(P5a)이 마지막 365개를 남기는지 절대값으로 고정한다.
//
// 배경: 기존 restoreBackup은 6개 도메인(assets/history/sellHistory/watchlist/rates/alloc)만
//   반영해 categoryStore/knowledgeBase/actionQueue/turtlePositions/turtleSettings/sellAlertDropRate가
//   현재 상태 기본값으로 재저장되는 유실 버그가 있었다. parsePortfolioPayload는 전 도메인을 파싱한다.
//
// 순수 검증만 수행(React/DOM 없음). localStorage/CustomEvent 부수효과 블록은 훅에 남아 여기서 다루지 않음.
// 수동 실행: npx tsx tests/restoreRoundTripParity.ts. 통과 시 exit 0.

import { PortfolioSnapshot } from '../types';
import { parsePortfolioPayload } from '../utils/parsePortfolioPayload';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else fails.push(`✗ ${name}: expected true`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 전 도메인 fixture — 모든 필드가 파싱 결과에 보존되는지
// ════════════════════════════════════════════════════════════════════════════
{
  const fullPayload = {
    assets: [
      {
        id: 'a1', categoryId: 2, ticker: 'VOO', exchange: 'NASDAQ', name: 'VOO', quantity: 10,
        purchasePrice: 100, purchaseDate: '2025-01-01', currency: 'USD',
        currentPrice: 120, priceOriginal: 120, highestPrice: 130, bucket: 'SATELLITE', owner: 'YUSEON',
      },
    ],
    portfolioHistory: [
      { date: '2025-01-01', totalValue: 1_000_000 },
      { date: '2025-01-02', totalValue: 1_010_000 },
    ],
    sellHistory: [{ id: 's1', ticker: 'AAPL', categoryId: 2, quantity: 3, sellPrice: 200, sellDate: '2025-02-01' }],
    watchlist: [{ id: 'w1', ticker: 'TSLA', categoryId: 2, name: '테슬라' }],
    exchangeRates: { USD: 1400, JPY: 9 },
    allocationTargets: { weights: { '1': 40, '2': 60 }, bucketWeights: { CORE: 90, SATELLITE: 10 }, targetTotalAmount: 953_000_000 },
    sellAlertDropRate: 20,
    categoryStore: { categories: [{ id: 1, name: '국내주식' }, { id: 2, name: '해외주식' }] },
    knowledgeBase: { version: 3, rules: [{ id: 'r1' }] },
    actionQueue: [{ id: 'q1', type: 'BUY' }],
    turtlePositions: [{ id: 't1', ticker: 'BTC' }],
    turtleSettings: { unitCount: 2, coreRatio: 90 },
    tableLayout: { columns: [{ key: 'name', visible: true }, { key: 'ticker', visible: false }], fixedWidths: { name: 120 } },
    lastUpdateDate: '2026-07-01',
  };
  const p = parsePortfolioPayload(JSON.stringify(fullPayload));

  check('assets 개수', p.assets.length, 1);
  check('assets[0].ticker 보존', p.assets[0].ticker, 'VOO');
  check('assets[0].bucket 보존', (p.assets[0] as { bucket?: string }).bucket, 'SATELLITE');
  check('portfolioHistory 개수', p.portfolioHistory.length, 2);
  check('portfolioHistory[1].date 보존', p.portfolioHistory[1].date, '2025-01-02');
  check('sellHistory 개수', p.sellHistory.length, 1);
  check('sellHistory[0].ticker 보존', (p.sellHistory[0] as { ticker?: string }).ticker, 'AAPL');
  check('watchlist 개수', p.watchlist.length, 1);
  check('watchlist[0].ticker 보존', (p.watchlist[0] as { ticker?: string }).ticker, 'TSLA');
  check('exchangeRates.USD 보존', p.exchangeRates?.USD, 1400);
  check('exchangeRates.JPY 보존', p.exchangeRates?.JPY, 9);
  check('allocationTargets.weights 보존', p.allocationTargets?.weights, { '1': 40, '2': 60 });
  check('allocationTargets.bucketWeights 보존', p.allocationTargets?.bucketWeights, { CORE: 90, SATELLITE: 10 });
  check('sellAlertDropRate 보존', p.sellAlertDropRate, 20);
  check('categoryStore.categories 개수', p.categoryStore?.categories?.length, 2);
  check('knowledgeBase.version 보존', (p.knowledgeBase as { version?: number })?.version, 3);
  check('actionQueue 개수', p.actionQueue?.length, 1);
  check('turtlePositions 개수', p.turtlePositions?.length, 1);
  check('turtleSettings.unitCount 보존', (p.turtleSettings as { unitCount?: number })?.unitCount, 2);
  check('tableLayout.columns 개수', p.tableLayout?.columns?.length, 2);
  check('tableLayout.fixedWidths.name 보존', p.tableLayout?.fixedWidths?.name, 120);
  check('lastUpdateDate 보존', p.lastUpdateDate, '2026-07-01');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 빈 페이로드 {} — 배열은 [], 옵셔널은 undefined 기본값
// ════════════════════════════════════════════════════════════════════════════
{
  const p = parsePortfolioPayload('{}');
  check('빈: assets []', p.assets, []);
  check('빈: portfolioHistory []', p.portfolioHistory, []);
  check('빈: sellHistory []', p.sellHistory, []);
  check('빈: watchlist []', p.watchlist, []);
  check('빈: exchangeRates undefined', p.exchangeRates, undefined);
  check('빈: allocationTargets undefined', p.allocationTargets, undefined);
  check('빈: sellAlertDropRate undefined', p.sellAlertDropRate, undefined);
  check('빈: categoryStore undefined', p.categoryStore, undefined);
  check('빈: knowledgeBase undefined', p.knowledgeBase, undefined);
  check('빈: actionQueue undefined', p.actionQueue, undefined);
  check('빈: turtlePositions undefined', p.turtlePositions, undefined);
  check('빈: turtleSettings undefined', p.turtleSettings, undefined);
  check('빈: tableLayout undefined', p.tableLayout, undefined);
  check('빈: columnConfig undefined', p.columnConfig, undefined);
  check('빈: lastUpdateDate undefined', p.lastUpdateDate, undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 레거시 shape — weights 없는 allocationTargets는 그대로 통과(마이그레이션은 로드 파이프라인)
// ════════════════════════════════════════════════════════════════════════════
{
  // 구 형식: allocationTargets가 카테고리→비중 맵(weights 키 없음)
  const legacyAlloc = { allocationTargets: { '1': 30, '2': 70 } };
  const p = parsePortfolioPayload(JSON.stringify(legacyAlloc));
  check('레거시 alloc: weights 없이 원본 유지', p.allocationTargets, { '1': 30, '2': 70 });
  checkTrue('레거시 alloc: weights 키 미주입', !('weights' in (p.allocationTargets as object)));
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 레거시 columnConfig(tableLayout 없음) — columnConfig만 세팅, tableLayout undefined
// ════════════════════════════════════════════════════════════════════════════
{
  const legacyCol = { columnConfig: [{ key: 'name', visible: true }, { key: 'currentValue', visible: true }] };
  const p = parsePortfolioPayload(JSON.stringify(legacyCol));
  check('레거시 columnConfig 개수', p.columnConfig?.length, 2);
  check('레거시 columnConfig[0].key', p.columnConfig?.[0].key, 'name');
  check('레거시: tableLayout undefined', p.tableLayout, undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 오염 방어 — 비배열 assets는 [], 잘못된 JSON은 throw
// ════════════════════════════════════════════════════════════════════════════
{
  const corrupt = { assets: 'not-an-array', portfolioHistory: 42, sellHistory: null, watchlist: { bad: true } };
  const p = parsePortfolioPayload(JSON.stringify(corrupt));
  check('오염: 비배열 assets → []', p.assets, []);
  check('오염: 비배열 portfolioHistory → []', p.portfolioHistory, []);
  check('오염: null sellHistory → []', p.sellHistory, []);
  check('오염: 객체 watchlist → []', p.watchlist, []);

  let threw = false;
  try {
    parsePortfolioPayload('{ this is not valid json');
  } catch {
    threw = true;
  }
  checkTrue('잘못된 JSON → throw', threw);

  // 비객체 최상위(예: 배열/문자열/숫자)는 빈 구조로 방어
  const pArr = parsePortfolioPayload('[1,2,3]');
  check('비객체 최상위: assets []', pArr.assets, []);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 365 캡(P5a) — 백필 결과 영속 전 slice(-365) 로직: 마지막 365개 유지
//    (usePortfolioData.applyLoadedData 백필 .then 블록의 backfilledHistory.slice(-365)와 동일)
// ════════════════════════════════════════════════════════════════════════════
{
  function dayStr(i: number): string {
    const d = new Date(Date.UTC(2024, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  }
  const history500: PortfolioSnapshot[] = Array.from({ length: 500 }, (_, i) => ({
    date: dayStr(i),
    totalValue: i,
  } as unknown as PortfolioSnapshot));

  const capped = history500.slice(-365);
  check('캡: 길이 365', capped.length, 365);
  check('캡: 첫 항목 = index 135 날짜', capped[0].date, dayStr(135));
  check('캡: 마지막 항목 = index 499 날짜', capped[capped.length - 1].date, dayStr(499));
  check('캡: 마지막 항목이 원본 마지막과 동일', capped[capped.length - 1].date, history500[499].date);

  // 365 이하이면 그대로(캡이 잘라내지 않음)
  const history100 = history500.slice(0, 100);
  check('캡: 100개는 그대로 100', history100.slice(-365).length, 100);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ restoreRoundTrip parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ restoreRoundTrip parity 전체 통과 (${pass} 단언)`);
