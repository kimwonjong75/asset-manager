// tests/portfolioSaveSnapshotParity.ts
// ---------------------------------------------------------------------------
// 저장 스냅샷 회귀 핀 (5-A). 두 층을 고정한다:
//
//   ① mergeSaveSnapshot 순수 규약
//      - `undefined` 인 키만 base 로 채운다. **truthy 검사 금지** — `0`(sellAlertDropRate)과
//        빈 배열이 "값 없음"으로 오인되면 안 된다(옛 triggerAutoSave 는 `||`/`??` 혼용이었다).
//      - 입력 불변, 스냅샷 키 집합 = PORTFOLIO_SAVE_DOMAINS.
//
//   ② **같은 틱 연속 부분 저장에서 앞선 변경이 유실되지 않는다** ← 이번 단계의 핵심
//      Drive 저장은 항상 전체 스냅샷이고 saveQueue 는 last-write-wins 이므로,
//      두 번째 저장이 형제 도메인을 "옛 값"으로 만들면 첫 번째 변경이 조용히 사라진다.
//      · 클로저 기반(옛 구현) 재현 → 유실이 실제로 발생함을 먼저 증명하고,
//      · ref 기반(현 구현) → 유실이 없음을 고정한다.
//      객체 인자로 바꾼 것만으로는 이 문제가 해결되지 않으므로 별도 핀이 필요하다.
//
// 수동 실행: npx tsx tests/portfolioSaveSnapshotParity.ts (npm test 가 자동 포함)

import {
  mergeSaveSnapshot, PORTFOLIO_SAVE_DOMAINS,
  type PortfolioSaveSnapshot, type PortfolioSavePatch,
} from '../types/portfolioSave';
import { Currency, type Asset, type WatchlistItem } from '../types';
import { DEFAULT_CATEGORY_STORE } from '../types/category';
import { DEFAULT_TURTLE_SETTINGS } from '../types/turtle';
import type { ActionItem } from '../types/actionQueue';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

// ── fixture ──────────────────────────────────────────────────────────────────
const mkAsset = (id: string): Asset => ({
  id, ticker: `T${id}`, name: `종목${id}`, exchange: 'KRX', categoryId: 1,
  quantity: 1, purchasePrice: 100, currentPrice: 100, priceOriginal: 100,
  highestPrice: 100, currency: Currency.KRW, purchaseDate: '2026-01-01',
} as unknown as Asset);

const mkQueueItem = (id: string): ActionItem => ({ id, kind: 'BUY' } as unknown as ActionItem);
const mkWatch = (id: string): WatchlistItem => ({ id, ticker: `W${id}` } as unknown as WatchlistItem);

const A1 = [mkAsset('a1')];
const A2 = [mkAsset('a1'), mkAsset('a2')];
const Q1: ActionItem[] = [];
const Q2 = [mkQueueItem('q1')];

const BASE: PortfolioSaveSnapshot = {
  assets: A1,
  portfolioHistory: [],
  sellHistory: [],
  watchlist: [],
  exchangeRates: { USD: 1450, JPY: 9.5 },
  allocationTargets: { weights: {} },
  sellAlertDropRate: 15,
  categoryStore: DEFAULT_CATEGORY_STORE,
  knowledgeBase: { rules: [] } as unknown as PortfolioSaveSnapshot['knowledgeBase'],
  actionQueue: Q1,
  turtlePositions: [],
  turtleSettings: { ...DEFAULT_TURTLE_SETTINGS },
};

// ════════════════════════════════════════════════════════════════════════════
// ① mergeSaveSnapshot 규약
// ════════════════════════════════════════════════════════════════════════════
check('빈 patch → base 그대로', mergeSaveSnapshot(BASE, {}), BASE);
check('한 도메인만 교체', mergeSaveSnapshot(BASE, { assets: A2 }).assets, A2);
check('교체하지 않은 형제는 base 유지', mergeSaveSnapshot(BASE, { assets: A2 }).actionQueue, Q1);

// truthy 검사였다면 아래 두 건이 base 값으로 되돌아간다 — `!== undefined` 여야 통과.
check('0 은 유효한 값 (sellAlertDropRate=0 보존)',
  mergeSaveSnapshot(BASE, { sellAlertDropRate: 0 }).sellAlertDropRate, 0);
check('빈 배열은 유효한 값 (assets=[] 보존)',
  mergeSaveSnapshot({ ...BASE, assets: A2 }, { assets: [] }).assets, []);
check('빈 객체 weights 도 보존',
  mergeSaveSnapshot(BASE, { allocationTargets: { weights: {} } }).allocationTargets, { weights: {} });

// undefined 를 명시로 넘겨도 base 를 지우지 않는다(부분 저장이 도메인 삭제로 번지지 않게)
check('명시적 undefined 는 base 유지',
  mergeSaveSnapshot(BASE, { assets: undefined } as PortfolioSavePatch).assets, A1);

// 불변성 — 입력을 건드리지 않는다
{
  const baseCopy = JSON.parse(JSON.stringify(BASE));
  const patch: PortfolioSavePatch = { assets: A2 };
  const patchCopy = JSON.parse(JSON.stringify(patch));
  mergeSaveSnapshot(BASE, patch);
  check('base 불변', JSON.parse(JSON.stringify(BASE)), baseCopy);
  check('patch 불변', JSON.parse(JSON.stringify(patch)), patchCopy);
}

// 키 집합 동일성 — 도메인이 추가되면 이 테스트가 먼저 깨져 반영을 강제한다
check('스냅샷 키 = PORTFOLIO_SAVE_DOMAINS',
  Object.keys(mergeSaveSnapshot(BASE, {})).sort(), [...PORTFOLIO_SAVE_DOMAINS].sort());
check('도메인 12개', PORTFOLIO_SAVE_DOMAINS.length, 12);

// ════════════════════════════════════════════════════════════════════════════
// ② 같은 틱 연속 부분 저장 — 앞선 변경 유실 방지 (이번 단계의 핵심 회귀)
// ════════════════════════════════════════════════════════════════════════════
// saveQueue 는 마지막 payload 만 남긴다(last-write-wins). 이 최소 모델로 재현한다.
function makeQueue() {
  let pending: PortfolioSaveSnapshot | null = null;
  return {
    request(s: PortfolioSaveSnapshot) { pending = s; }, // 뒤 호출이 앞 것을 덮음
    flush() { return pending; },
  };
}

// (a) 옛 구현 재현 — 형제 도메인을 "렌더 클로저"(고정된 옛 스냅샷)에서 읽는다.
{
  const q = makeQueue();
  const closure = BASE; // 렌더 시점에 캡처된 값. 같은 틱에는 갱신되지 않는다.
  const saveViaClosure = (patch: PortfolioSavePatch) => q.request(mergeSaveSnapshot(closure, patch));

  saveViaClosure({ assets: A2 });      // 자산 추가
  saveViaClosure({ actionQueue: Q2 }); // 같은 틱에 실행 큐 변경

  const saved = q.flush();
  checkTrue('(a) 옛 방식은 실제로 앞선 변경을 유실한다 — 이 테스트의 전제',
    saved !== null && saved.assets.length === 1 && saved.actionQueue.length === 1);
}

// (b) 현 구현 — ref 를 동기 갱신하므로 두 번째 저장이 최신 형제를 본다.
{
  const q = makeQueue();
  const ref: { current: PortfolioSaveSnapshot } = { current: BASE };
  const saveViaRef = (patch: PortfolioSavePatch) => {
    const next = mergeSaveSnapshot(ref.current, patch);
    ref.current = next; // ← 동기 갱신이 핵심
    q.request(next);
  };

  saveViaRef({ assets: A2 });
  saveViaRef({ actionQueue: Q2 });

  const saved = q.flush();
  checkTrue('(b) ref 방식은 두 변경이 모두 살아남는다', saved !== null);
  check('(b) 자산 변경 보존', saved?.assets.length, 2);
  check('(b) 실행 큐 변경 보존', saved?.actionQueue.length, 1);
}

// (c) 3연속·역순·중복 도메인에서도 마지막 값이 이긴다
{
  const ref: { current: PortfolioSaveSnapshot } = { current: BASE };
  const apply = (patch: PortfolioSavePatch) => { ref.current = mergeSaveSnapshot(ref.current, patch); };
  apply({ assets: A2 });
  apply({ watchlist: [mkWatch('w1')] });
  apply({ assets: A1 });          // 같은 도메인 재변경 — 최신이 이긴다
  apply({ sellAlertDropRate: 0 }); // 0 도 정상 반영
  check('(c) 재변경된 도메인은 최신값', ref.current.assets.length, 1);
  check('(c) 사이에 낀 도메인 보존', ref.current.watchlist.length, 1);
  check('(c) 0 반영', ref.current.sellAlertDropRate, 0);
  check('(c) 미변경 도메인 유지', ref.current.exchangeRates, { USD: 1450, JPY: 9.5 });
}

// (d) 전 도메인을 한 번씩 바꿔도 서로 덮어쓰지 않는다
{
  const ref: { current: PortfolioSaveSnapshot } = { current: BASE };
  const patches: PortfolioSavePatch[] = [
    { assets: A2 }, { portfolioHistory: [{ date: '2026-01-01' } as never] },
    { sellHistory: [{ id: 's1' } as never] }, { watchlist: [mkWatch('w1')] },
    { exchangeRates: { USD: 1400, JPY: 9 } }, { allocationTargets: { weights: { '1': 50 } } },
    { sellAlertDropRate: 7 }, { categoryStore: DEFAULT_CATEGORY_STORE },
    { knowledgeBase: { rules: [] } as never }, { actionQueue: Q2 },
    { turtlePositions: [{ id: 't1' } as never] }, { turtleSettings: { ...DEFAULT_TURTLE_SETTINGS } },
  ];
  for (const p of patches) ref.current = mergeSaveSnapshot(ref.current, p);
  check('(d) 12개 연속 변경 후 자산 보존', ref.current.assets.length, 2);
  check('(d) 12개 연속 변경 후 환율 반영', ref.current.exchangeRates, { USD: 1400, JPY: 9 });
  check('(d) 12개 연속 변경 후 큐 반영', ref.current.actionQueue.length, 1);
  check('(d) 12개 연속 변경 후 기준율 반영', ref.current.sellAlertDropRate, 7);
}

// ── 결과 ─────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error(`저장 스냅샷 parity: ${pass} passed, ${fails.length} failed`);
  fails.forEach(f => console.error(f));
  process.exit(1);
}
console.log(`저장 스냅샷 parity: ${pass} passed, 0 failed`);
console.log('✓ mergeSaveSnapshot 규약(0/빈배열 보존·불변·키집합) + 같은 틱 연속 부분저장 유실 방지');
