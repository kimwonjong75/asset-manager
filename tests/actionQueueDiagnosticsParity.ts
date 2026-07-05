// tests/actionQueueDiagnosticsParity.ts
// ---------------------------------------------------------------------------
// diagnoseTurtleActions 골든 테스트 (Phase 2b-6).
// 핵심 앵커: **diagnose.generatedCount === buildTurtleActions(...).length** (진단이 생성과 어긋나지 않음).
// + 후보/포지션별 사유 정확성(no-breakout/risk-limit/insufficient-budget/zero-qty/already-open/
//   duplicate-pending/no-market/no-n/no-trigger/*-generated).
// 수동 실행: npm run test:actiondiag (tsx). 통과 시 exit 0.

import { TurtleSettings, DEFAULT_TURTLE_SETTINGS, TurtlePosition } from '../types/turtle';
import { ActionItem } from '../types/actionQueue';
import {
  buildTurtleActions,
  diagnoseTurtleActions,
  TurtleMarketInput,
  TurtleCandidateRef,
  BuildTurtleActionsInput,
} from '../utils/actionQueueGenerator';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const TODAY = '2026-07-05';
const makeId = (seq: number) => `t${seq}`;
const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({
  ...DEFAULT_TURTLE_SETTINGS, satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 0.5,
  stopMultipleN: 2, positionValueCapPct: 0, maxUnitsPerPosition: 2, maxTotalRiskPct: 12, ...over,
});
function mkMarket(p: Partial<TurtleMarketInput> & { ticker: string }): TurtleMarketInput {
  return { name: p.ticker, price: 0, n: null, donchianHigh: null, donchianLow: null, fxRate: 1, ...p };
}
function mkPos(p: { ticker: string; fillPrice: number; qty: number; n: number; stopPrice: number; status?: 'open' | 'closed'; id?: string }): TurtlePosition {
  return {
    id: p.id ?? `pos-${p.ticker}`, ticker: p.ticker, name: p.ticker, status: p.status ?? 'open',
    openedAt: '2026-01-01', entryDonchianHigh: p.fillPrice,
    units: [{ fillDate: '2026-01-01', fillPrice: p.fillPrice, quantity: p.qty, nAtFill: p.n, fxRateAtFill: 1 }],
    stopPrice: p.stopPrice,
  };
}

type BuildInput = BuildTurtleActionsInput;
function mkInput(over: Partial<BuildInput> = {}): BuildInput {
  return {
    positions: [], candidates: [], marketByTicker: new Map(), settings: S(),
    existingQueue: [], remainingBudgetKRW: 100_000_000, today: TODAY, makeId, ...over,
  };
}

/** 모든 시나리오에서 diagnose.generatedCount === build(...).length 를 강제하는 앵커. */
function checkParity(name: string, over: Partial<BuildInput>): ReturnType<typeof diagnoseTurtleActions> {
  const input = mkInput(over);
  const built = buildTurtleActions(input);
  const { makeId: _omit, ...diagInput } = input;
  const diag = diagnoseTurtleActions(diagInput);
  check(`${name}: generatedCount == build.length`, diag.generatedCount, built.length);
  return diag;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 진입 생성 vs 미돌파(중립) — 사유 구분
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const d = checkParity('진입 생성', { candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market });
  check('진입 후보 사유 generated', d.candidates[0].reason, 'generated');
  check('진입 generatedCount 1', d.generatedCount, 1);
}
{
  const noBreak = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 79_999, n: 2000, donchianHigh: 80_000 })]]);
  const d = checkParity('미돌파', { candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: noBreak });
  check('미돌파 사유 no-breakout', d.candidates[0].reason, 'no-breakout');
  check('미돌파 generatedCount 0', d.generatedCount, 0);
}
{
  const d = checkParity('시장입력 없음', { candidates: [{ ticker: 'ZZZ', name: 'Z' }], marketByTicker: new Map() });
  check('no-market 사유', d.candidates[0].reason, 'no-market');
}
{
  const nNull = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: null, donchianHigh: 80_000 })]]);
  const d = checkParity('N null', { candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: nNull });
  check('no-n 사유', d.candidates[0].reason, 'no-n');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 기보유 → already-open
// ════════════════════════════════════════════════════════════════════════════
{
  const held = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000, donchianLow: 1 })]]);
  const d = checkParity('기보유', {
    positions: [mkPos({ ticker: 'AAA', fillPrice: 79_000, qty: 250, n: 2000, stopPrice: 75_000 })],
    candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: held,
  });
  check('기보유 후보 사유 already-open', d.candidates.find(c => c.ticker === 'AAA')!.reason, 'already-open');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 포지션 사유 — stop/exit/pyramid-generated, no-trigger, no-market
// ════════════════════════════════════════════════════════════════════════════
{
  const m = new Map([['BBB', mkMarket({ ticker: 'BBB', price: 76_000, n: 2000, donchianLow: 77_000 })]]);
  const d = checkParity('손절', { positions: [mkPos({ ticker: 'BBB', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('손절 사유 stop-generated', d.positions[0].reason, 'stop-generated');
}
{
  const m = new Map([['BBB', mkMarket({ ticker: 'BBB', price: 78_000, n: 2000, donchianLow: 78_500 })]]);
  const d = checkParity('청산', { positions: [mkPos({ ticker: 'BBB', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('청산 사유 exit-generated', d.positions[0].reason, 'exit-generated');
}
{
  const m = new Map([['CCC', mkMarket({ ticker: 'CCC', price: 81_000, n: 2000, donchianLow: 70_000 })]]);
  const d = checkParity('피라미딩', { positions: [mkPos({ ticker: 'CCC', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('피라미딩 사유 pyramid-generated', d.positions[0].reason, 'pyramid-generated');
}
{
  // 매도·피라미딩 조건 모두 미충족 → no-trigger (정상 대기)
  const m = new Map([['CCC', mkMarket({ ticker: 'CCC', price: 80_100, n: 2000, donchianLow: 70_000 })]]);
  const d = checkParity('트리거 없음', { positions: [mkPos({ ticker: 'CCC', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('no-trigger 사유', d.positions[0].reason, 'no-trigger');
}
{
  // 포지션인데 시장입력 없음
  const d = checkParity('포지션 no-market', { positions: [mkPos({ ticker: 'DDD', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: new Map() });
  check('포지션 no-market 사유', d.positions[0].reason, 'no-market');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 중복 대기 → duplicate-pending (진입/포지션)
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const existing: ActionItem[] = [{ id: 'x', createdDate: '2026-07-04', kind: 'TURTLE_ENTRY', ticker: 'AAA', name: 'A', quantity: 250, refPrice: 80_000, reasonText: '', ruleSnapshot: {}, status: 'pending' }];
  const d = checkParity('진입 중복', { candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market, existingQueue: existing });
  check('진입 duplicate-pending', d.candidates[0].reason, 'duplicate-pending');
  check('진입 중복 generatedCount 0', d.generatedCount, 0);
}
{
  const m = new Map([['BBB', mkMarket({ ticker: 'BBB', price: 76_000, n: 2000, donchianLow: 1 })]]);
  const existing: ActionItem[] = [{ id: 'e', createdDate: '2026-07-04', kind: 'TURTLE_STOP', ticker: 'BBB', name: 'BBB', positionId: 'pos-BBB', quantity: 250, refPrice: 76_000, reasonText: '', ruleSnapshot: {}, status: 'pending' }];
  const d = checkParity('손절 중복', { positions: [mkPos({ ticker: 'BBB', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m, existingQueue: existing });
  check('포지션 duplicate-pending', d.positions[0].reason, 'duplicate-pending');
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 배치 리스크 12% 한도 → 초과 후보 risk-limit (13번째부터), 앵커 유지
// ════════════════════════════════════════════════════════════════════════════
{
  const candidates: TurtleCandidateRef[] = [];
  const market = new Map<string, TurtleMarketInput>();
  for (let i = 1; i <= 15; i++) {
    const t = `R${i}`;
    candidates.push({ ticker: t, name: t });
    market.set(t, mkMarket({ ticker: t, price: 8000, n: 2000, donchianHigh: 8000 }));
  }
  const d = checkParity('12% 한도', { candidates, marketByTicker: market });
  check('12% 채택 12건', d.candidates.filter(c => c.reason === 'generated').length, 12);
  check('12% 초과 risk-limit 3건', d.candidates.filter(c => c.reason === 'risk-limit').length, 3);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 예산 부족 → insufficient-budget
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map<string, TurtleMarketInput>([
    ['P1', mkMarket({ ticker: 'P1', price: 80_000, n: 2000, donchianHigh: 80_000 })],
    ['P2', mkMarket({ ticker: 'P2', price: 80_000, n: 2000, donchianHigh: 80_000 })],
  ]);
  const d = checkParity('예산 부족', {
    candidates: [{ ticker: 'P1', name: 'P1' }, { ticker: 'P2', name: 'P2' }],
    marketByTicker: market, remainingBudgetKRW: 30_000_000,
  });
  check('P1 generated', d.candidates[0].reason, 'generated');
  check('P2 insufficient-budget', d.candidates[1].reason, 'insufficient-budget');
}

// ════════════════════════════════════════════════════════════════════════════
// 7. zero-qty — 사이징 0주 (예산 대비 N 과대)
// ════════════════════════════════════════════════════════════════════════════
{
  // riskAmount = budget×0.5% = 5,000 (budget 1,000,000). N 100,000 → units = 5000/100000 = 0.05 → 내림 0
  const market = new Map([['ZQ', mkMarket({ ticker: 'ZQ', price: 200_000, n: 100_000, donchianHigh: 200_000 })]]);
  const d = checkParity('zero-qty', {
    candidates: [{ ticker: 'ZQ', name: 'ZQ' }], marketByTicker: market,
    settings: S({ satelliteBudgetKRW: 1_000_000 }), remainingBudgetKRW: 1_000_000,
  });
  check('zero-qty 사유', d.candidates[0].reason, 'zero-qty');
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 혼합 시나리오 앵커 — 포지션+후보 섞여도 generatedCount 일치
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map<string, TurtleMarketInput>([
    ['STOPME', mkMarket({ ticker: 'STOPME', price: 76_000, n: 2000, donchianLow: 1 })],
    ['ENTER', mkMarket({ ticker: 'ENTER', price: 80_000, n: 2000, donchianHigh: 80_000 })],
    ['WAIT', mkMarket({ ticker: 'WAIT', price: 79_000, n: 2000, donchianHigh: 80_000 })],
  ]);
  const d = checkParity('혼합', {
    positions: [mkPos({ ticker: 'STOPME', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })],
    candidates: [{ ticker: 'ENTER', name: 'E' }, { ticker: 'WAIT', name: 'W' }],
    marketByTicker: market,
  });
  check('혼합 generatedCount 2 (손절+진입)', d.generatedCount, 2);
  check('혼합 WAIT no-breakout', d.candidates.find(c => c.ticker === 'WAIT')!.reason, 'no-breakout');
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ actionQueueDiagnostics parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
} else {
  console.log(`✅ actionQueueDiagnostics parity 전체 통과 (${pass} 단언)`);
}
