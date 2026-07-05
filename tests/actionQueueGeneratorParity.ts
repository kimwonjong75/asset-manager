// tests/actionQueueGeneratorParity.ts
// ---------------------------------------------------------------------------
// 터틀 주문 생성기(Phase 2a) 골든 테스트.
//   · 진입 생성(돌파) / 미돌파·데이터결손·기보유 → 미생성
//   · 손절>청산>피라미딩 우선순위
//   · 중복 방지(이미 대기 중인 (kind,ticker))
//   · 배치 리스크 누적 → 12% 한도 초과 진입 차단
//   · 파생 헬퍼(daysIgnored/escalation/snooze)
// 수동 실행: npm run test:actionqueue (tsx). 통과 시 exit 0.

import { TurtleSettings, DEFAULT_TURTLE_SETTINGS, TurtlePosition } from '../types/turtle';
import { ActionItem } from '../types/actionQueue';
import {
  buildTurtleActions,
  TurtleMarketInput,
  TurtleCandidateRef,
  actionDaysIgnored,
  actionEscalationLevel,
  isSnoozeExpired,
} from '../utils/actionQueueGenerator';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else fails.push(`✗ ${name}: expected true`);
}

const TODAY = '2026-07-05';
const makeId = (seq: number) => `t${seq}`;
const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({
  ...DEFAULT_TURTLE_SETTINGS, satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 0.5,
  stopMultipleN: 2, positionValueCapPct: 0, maxUnitsPerPosition: 2, maxTotalRiskPct: 12, ...over,
});

function mkMarket(p: Partial<TurtleMarketInput> & { ticker: string }): TurtleMarketInput {
  return {
    name: p.ticker, price: 0, n: null, donchianHigh: null, donchianLow: null, fxRate: 1,
    ...p,
  };
}
function mkPos(p: { ticker: string; fillPrice: number; qty: number; n: number; stopPrice: number; status?: 'open' | 'closed' }): TurtlePosition {
  return {
    id: `pos-${p.ticker}`, ticker: p.ticker, name: p.ticker, status: p.status ?? 'open',
    openedAt: '2026-01-01', entryDonchianHigh: p.fillPrice,
    units: [{ fillDate: '2026-01-01', fillPrice: p.fillPrice, quantity: p.qty, nAtFill: p.n, fxRateAtFill: 1 }],
    stopPrice: p.stopPrice,
  };
}
const base = (over: Partial<Parameters<typeof buildTurtleActions>[0]> = {}) => buildTurtleActions({
  positions: [], candidates: [], marketByTicker: new Map(), settings: S(),
  existingQueue: [], remainingBudgetKRW: 100_000_000, today: TODAY, makeId, ...over,
});

// ════════════════════════════════════════════════════════════════════════════
// 1. 진입 생성 — 55일 신고가 돌파
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', name: '에이', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const out = base({ candidates: [{ ticker: 'AAA', name: '에이' }], marketByTicker: market });
  check('진입 1건 생성', out.length, 1);
  check('진입 kind', out[0].kind, 'TURTLE_ENTRY');
  check('진입 수량 250 (50만÷2000)', out[0].quantity, 250);
  checkClose('진입 손절가 76,000 (원통화)', out[0].ruleSnapshot.stopPrice, 76_000);
  checkClose('진입 riskKRW 1% = 1,000,000', out[0].ruleSnapshot.riskKRW, 1_000_000);
  checkTrue('진입 reasonText 비어있지 않음', out[0].reasonText.length > 0);
}

// 미돌파 / 데이터결손 / 기보유 → 미생성
{
  const noBreak = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 79_999, n: 2000, donchianHigh: 80_000 })]]);
  check('미돌파 → 미생성', base({ candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: noBreak }).length, 0);
  check('시장입력 없음 → 미생성', base({ candidates: [{ ticker: 'ZZZ', name: 'Z' }], marketByTicker: new Map() }).length, 0);
  const nNull = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: null, donchianHigh: 80_000 })]]);
  check('N null → 미생성', base({ candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: nNull }).length, 0);
  // 이미 보유 중인 종목은 진입 후보에서 제외 (피라미딩 대상)
  const held = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000, donchianLow: 1 })]]);
  const outHeld = base({
    positions: [mkPos({ ticker: 'AAA', fillPrice: 79_000, qty: 250, n: 2000, stopPrice: 75_000 })],
    candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: held,
  });
  checkTrue('기보유 종목 진입 없음', !outHeld.some(a => a.kind === 'TURTLE_ENTRY'));
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 매도 우선순위 — 손절 > 청산 > 피라미딩
// ════════════════════════════════════════════════════════════════════════════
{
  // 손절+청산 동시 조건 → 손절만
  const m = new Map([['BBB', mkMarket({ ticker: 'BBB', price: 76_000, n: 2000, donchianLow: 77_000 })]]);
  const out = base({ positions: [mkPos({ ticker: 'BBB', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('손절 우선 (청산 미발행)', out.map(a => a.kind), ['TURTLE_STOP']);
  check('손절 전량 250', out[0].quantity, 250);
}
{
  // 손절 미도달, 청산만 → 청산
  const m = new Map([['BBB', mkMarket({ ticker: 'BBB', price: 78_000, n: 2000, donchianLow: 78_500 })]]);
  const out = base({ positions: [mkPos({ ticker: 'BBB', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('청산 발행', out.map(a => a.kind), ['TURTLE_EXIT']);
}
{
  // 매도 없음 + 피라미딩 트리거 → 피라미딩
  const m = new Map([['CCC', mkMarket({ ticker: 'CCC', price: 81_000, n: 2000, donchianLow: 70_000 })]]);
  const out = base({ positions: [mkPos({ ticker: 'CCC', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 })], marketByTicker: m });
  check('피라미딩 발행', out.map(a => a.kind), ['TURTLE_PYRAMID']);
  checkClose('피라미딩 후 손절 77,000 (81000−2×2000)', out[0].ruleSnapshot.newStopPrice, 77_000);
}
{
  // 최대 유닛 도달 → 피라미딩 없음
  const m = new Map([['CCC', mkMarket({ ticker: 'CCC', price: 90_000, n: 2000, donchianLow: 70_000 })]]);
  const full: TurtlePosition = {
    ...mkPos({ ticker: 'CCC', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 }),
    units: [
      { fillDate: '2026-01-01', fillPrice: 80_000, quantity: 250, nAtFill: 2000, fxRateAtFill: 1 },
      { fillDate: '2026-01-02', fillPrice: 81_000, quantity: 250, nAtFill: 2000, fxRateAtFill: 1 },
    ],
  };
  check('최대 유닛 도달 → 미생성', base({ positions: [full], marketByTicker: m }).length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 중복 방지 — 이미 대기 중인 (kind,ticker)
// ════════════════════════════════════════════════════════════════════════════
{
  const market = new Map([['AAA', mkMarket({ ticker: 'AAA', price: 80_000, n: 2000, donchianHigh: 80_000 })]]);
  const existing: ActionItem[] = [{
    id: 'x', createdDate: '2026-07-04', kind: 'TURTLE_ENTRY', ticker: 'AAA', name: 'A',
    quantity: 250, refPrice: 80_000, reasonText: 'prev', ruleSnapshot: {}, status: 'pending',
  }];
  check('대기 중 진입 있으면 중복 미생성', base({ candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market, existingQueue: existing }).length, 0);
  // snoozed도 대기 취급
  const snoozed: ActionItem[] = [{ ...existing[0], status: 'snoozed', snoozedUntil: '2026-07-10' }];
  check('스누즈 중이면 중복 미생성', base({ candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market, existingQueue: snoozed }).length, 0);
  // done이면 다시 생성 허용
  const done: ActionItem[] = [{ ...existing[0], status: 'done', resolvedDate: '2026-07-04' }];
  check('done이면 재생성 허용', base({ candidates: [{ ticker: 'AAA', name: 'A' }], marketByTicker: market, existingQueue: done }).length, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 배치 리스크 누적 — 12% 동시전멸 한도 초과 진입 차단
// ════════════════════════════════════════════════════════════════════════════
{
  // 각 진입: price 8000, n 2000 → qty 250, risk 250×4000=1,000,000=1%, positionValue 250×8000=2,000,000
  // 예산 1억이라 budget는 여유(12×2M=24M<1억). risk가 12%에서 바인딩 → 12건 채택.
  const candidates: TurtleCandidateRef[] = [];
  const market = new Map<string, TurtleMarketInput>();
  for (let i = 1; i <= 15; i++) {
    const t = `R${i}`;
    candidates.push({ ticker: t, name: t });
    market.set(t, mkMarket({ ticker: t, price: 8000, n: 2000, donchianHigh: 8000 }));
  }
  const out = base({ candidates, marketByTicker: market });
  check('12% 한도 → 12건만 채택', out.filter(a => a.kind === 'TURTLE_ENTRY').length, 12);
}
{
  // 예산 바인딩: 예산을 30M로 줄이면 20M positionValue 진입은 1건만 (2건째 예산초과)
  const market = new Map<string, TurtleMarketInput>([
    ['P1', mkMarket({ ticker: 'P1', price: 80_000, n: 2000, donchianHigh: 80_000 })],
    ['P2', mkMarket({ ticker: 'P2', price: 80_000, n: 2000, donchianHigh: 80_000 })],
  ]);
  const out = base({
    candidates: [{ ticker: 'P1', name: 'P1' }, { ticker: 'P2', name: 'P2' }],
    marketByTicker: market, settings: S({ satelliteBudgetKRW: 100_000_000 }), remainingBudgetKRW: 30_000_000,
  });
  // P1 positionValue 20M → 채택, 잔여 10M. P2 20M > 10M → 예산부족 차단.
  check('예산 잔여 부족 → 1건만', out.filter(a => a.kind === 'TURTLE_ENTRY').length, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 통화 규약 관통(D6) — 생성기가 fxRate를 엔진에 넘겨도 ruleSnapshot 손절가는 원통화
// ════════════════════════════════════════════════════════════════════════════
{
  // NVDA $109, N $5, fx 1400 → 손절 $99 (원통화), riskKRW = qty×10×1400
  const market = new Map([['NVDA', mkMarket({ ticker: 'NVDA', name: '엔비디아', price: 109, n: 5, donchianHigh: 108, fxRate: 1400 })]]);
  const out = base({ candidates: [{ ticker: 'NVDA', name: '엔비디아' }], marketByTicker: market });
  check('NVDA 진입 1건', out.length, 1);
  checkClose('★ ruleSnapshot 손절가 원통화 99 (환율 무관)', out[0].ruleSnapshot.stopPrice, 99);
  check('ruleSnapshot fxRate 1400', out[0].ruleSnapshot.fxRate, 1400);
  checkClose('riskKRW = qty×2N×fx', out[0].ruleSnapshot.riskKRW, out[0].quantity * 10 * 1400);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 중복 방지 granularity — 같은 티커라도 positionId 다르면 각각 주문
// ════════════════════════════════════════════════════════════════════════════
{
  const m = new Map([['DUP', mkMarket({ ticker: 'DUP', price: 76_000, n: 2000, donchianLow: 1 })]]);
  const posA1: TurtlePosition = { ...mkPos({ ticker: 'DUP', fillPrice: 80_000, qty: 250, n: 2000, stopPrice: 76_000 }), id: 'pos-A1' };
  const posA2: TurtlePosition = { ...mkPos({ ticker: 'DUP', fillPrice: 80_000, qty: 100, n: 2000, stopPrice: 76_000 }), id: 'pos-A2' };
  // pos-A1의 손절만 이미 대기 중
  const existing: ActionItem[] = [{
    id: 'e', createdDate: '2026-07-04', kind: 'TURTLE_STOP', ticker: 'DUP', name: 'DUP', positionId: 'pos-A1',
    quantity: 250, refPrice: 76_000, reasonText: '', ruleSnapshot: {}, status: 'pending',
  }];
  const out = base({ positions: [posA1, posA2], marketByTicker: m, existingQueue: existing });
  check('pos-A1 중복 억제, pos-A2만 신규 STOP', out.map(a => a.positionId), ['pos-A2']);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 파생 헬퍼 — daysIgnored / escalation / snooze
// ════════════════════════════════════════════════════════════════════════════
{
  const item = (over: Partial<ActionItem>): ActionItem => ({
    id: 'i', createdDate: '2026-07-01', kind: 'TURTLE_STOP', ticker: 'A', name: 'A',
    quantity: 1, refPrice: 1, reasonText: '', ruleSnapshot: {}, status: 'pending', ...over,
  });
  check('daysIgnored 4일', actionDaysIgnored(item({ createdDate: '2026-07-01' }), TODAY), 4);
  check('daysIgnored 음수→0', actionDaysIgnored(item({ createdDate: '2026-07-10' }), TODAY), 0);
  check('escalation 0 (오늘 생성)', actionEscalationLevel(item({ createdDate: TODAY }), TODAY), 0);
  check('escalation 1 (4일 무시)', actionEscalationLevel(item({ createdDate: '2026-07-01' }), TODAY), 1);
  check('escalation 2 (7일+ 무시)', actionEscalationLevel(item({ createdDate: '2026-06-28' }), TODAY), 2);
  check('escalation 1 (스누즈 2회)', actionEscalationLevel(item({ createdDate: TODAY, status: 'snoozed', snoozeCount: 2 }), TODAY), 1);
  check('escalation 2 (스누즈 3회)', actionEscalationLevel(item({ createdDate: TODAY, status: 'snoozed', snoozeCount: 3 }), TODAY), 2);
  check('done은 escalation 0', actionEscalationLevel(item({ createdDate: '2026-06-01', status: 'done' }), TODAY), 0);
  check('스누즈 만료 (도달)', isSnoozeExpired(item({ status: 'snoozed', snoozedUntil: TODAY }), TODAY), true);
  check('스누즈 미만료 (미래)', isSnoozeExpired(item({ status: 'snoozed', snoozedUntil: '2026-07-06' }), TODAY), false);
  check('pending은 스누즈만료 아님', isSnoozeExpired(item({ status: 'pending' }), TODAY), false);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ actionQueueGenerator parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ actionQueueGenerator parity 전체 통과 (${pass} 단언)`);
}
