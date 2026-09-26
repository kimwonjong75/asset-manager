// tests/turtleHoldingsStateParity.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" P1 — 순수 상태 전이 골든 테스트 (계획서 PLAN_터틀중심_앱재정비_260925.md §6 P1).
// 명시적 절대값 고정: 매도→감시 등록/dedup, 재매수 손절가, 불타기 손절 상향·유닛 한도, 보류 기록/연속 카운트,
// 불변성. 별도 절: 위성 실행 큐 생성기(actionQueueGenerator)가 holdings-reentry 포지션을 오인하지 않는지.
//
// 실행: npx tsx tests/turtleHoldingsStateParity.ts

import { WatchlistItem, Currency } from '../types';
import { TurtlePosition, DEFAULT_TURTLE_SETTINGS } from '../types/turtle';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS, TurtleHoldingsSettings } from '../types/turtleHoldings';
import {
  recordTurtleExit,
  recordTurtleReentry,
  recordTurtlePyramid,
  recordTurtleHold,
  consecutiveHoldCount,
  RecordTurtleExitInput,
} from '../utils/turtleHoldingsState';
import { buildTurtleActions, diagnoseTurtleActions } from '../utils/actionQueueGenerator';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else { fail++; console.error(`  ✗ ${name}\n      기대=${e} 실제=${a}`); }
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++; else { fail++; console.error(`  ✗ ${name} (false)`); }
}

const S: TurtleHoldingsSettings = DEFAULT_TURTLE_HOLDINGS_SETTINGS; // stopMultipleN=2, maxUnitsPerPosition=4

// ════════════════════════════════════════════════════════════════════════════
// 1. recordTurtleExit — 감시 명단 신규 등록 + dedup 갱신 + 포지션 종료
// ════════════════════════════════════════════════════════════════════════════
{
  const asset = { ticker: '005930', exchange: 'KRX (코스피/코스닥)', name: '삼성전자', categoryId: 1, currency: Currency.KRW };
  const base: RecordTurtleExitInput = {
    asset, soldAt: '2026-09-20', soldPriceOriginal: 68_000, watchlist: [],
    makeWatchId: () => 'w-new-1',
  };

  // 1-a. 신규 등록 (watchlist 비어 있음)
  const r1 = recordTurtleExit(base);
  checkTrue('1-a ok', r1.ok);
  if (r1.ok) {
    check('1-a watchlist 1건 생성', r1.watchlist.length, 1);
    check('1-a isNewWatchItem', r1.isNewWatchItem, true);
    check('1-a isTurtleCandidate=true', r1.watchlist[0].isTurtleCandidate, true);
    check('1-a turtleWatch.soldAt', r1.watchlist[0].turtleWatch?.soldAt, '2026-09-20');
    check('1-a turtleWatch.soldPriceOriginal', r1.watchlist[0].turtleWatch?.soldPriceOriginal, 68_000);
    check('1-a turtleWatch.source 기본값', r1.watchlist[0].turtleWatch?.source, 'turtle-exit');
    check('1-a closedPosition null(포지션 미지정)', r1.closedPosition, null);
  }

  // 1-b. 이미 관심종목에 있으면(대소문자·거래소 표기 달라도) 필드만 갱신 — dedup, 신규 생성 안 함
  const existing: WatchlistItem = {
    id: 'w-existing', ticker: 'aapl', exchange: 'NASDAQ', name: 'Apple', categoryId: 2, currency: Currency.USD,
    notes: '기존 메모',
  };
  const r2 = recordTurtleExit({
    asset: { ticker: 'AAPL', exchange: 'NASDAQ', name: 'Apple Inc.', categoryId: 2, currency: Currency.USD },
    soldAt: '2026-09-21', soldPriceOriginal: 230.5, watchlist: [existing],
    makeWatchId: () => { throw new Error('dedup 매칭 시 호출되면 안 됨'); },
  });
  checkTrue('1-b ok', r2.ok);
  if (r2.ok) {
    check('1-b watchlist 길이 불변(1)', r2.watchlist.length, 1);
    check('1-b 기존 id 재사용', r2.watchItemId, 'w-existing');
    check('1-b isNewWatchItem=false', r2.isNewWatchItem, false);
    check('1-b 기존 메모 보존', r2.watchlist[0].notes, '기존 메모');
    check('1-b turtleWatch 갱신', r2.watchlist[0].turtleWatch?.soldPriceOriginal, 230.5);
  }

  // 1-c. 재매수분 매도 — position 전달 시 closed로 종료
  const openPos: TurtlePosition = {
    id: 'tp-1', ticker: '005930', name: '삼성전자',
    units: [{ fillDate: '2026-08-01', fillPrice: 60_000, quantity: 10, nAtFill: 1_200 }],
    stopPrice: 57_600, entryDonchianHigh: 61_000, status: 'open', openedAt: '2026-08-01',
    origin: 'holdings-reentry',
  };
  const r3 = recordTurtleExit({ ...base, position: openPos, exitReason: 'stop', watchlist: [] });
  checkTrue('1-c ok', r3.ok);
  if (r3.ok && r3.closedPosition) {
    check('1-c 포지션 status=closed', r3.closedPosition.status, 'closed');
    check('1-c closedAt=soldAt', r3.closedPosition.closedAt, '2026-09-20');
    check('1-c exitReason=stop', r3.closedPosition.exitReason, 'stop');
    check('1-c 원본 유닛 보존', r3.closedPosition.units, openPos.units);
    checkTrue('1-c 원본 포지션 불변(status)', openPos.status === 'open');
  }

  // 1-d. 잘못된 체결가 → 거부
  const r4 = recordTurtleExit({ ...base, soldPriceOriginal: 0 });
  check('1-d 거부(invalid-sold-price)', r4.ok ? 'ok' : r4.reason, 'invalid-sold-price');
  const r5 = recordTurtleExit({ ...base, soldPriceOriginal: -100 });
  check('1-d 거부(음수)', r5.ok ? 'ok' : r5.reason, 'invalid-sold-price');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. recordTurtleReentry — 재매수 50,000 · N 1,500 → 손절 47,000 (stopMultipleN=2 기본값)
// ════════════════════════════════════════════════════════════════════════════
let reentryPosition: TurtlePosition;
{
  const r = recordTurtleReentry({
    id: 'tp-2', ticker: '005930', name: '삼성전자', assetId: 'a-1',
    fillDate: '2026-09-22', fillPrice: 50_000, quantity: 20, nAtFill: 1_500,
    donchianHigh: 51_000, settings: S,
  });
  checkTrue('2 ok', r.ok);
  if (r.ok) {
    reentryPosition = r.position;
    check('2 손절가=47,000', r.position.stopPrice, 47_000);
    check('2 origin=holdings-reentry', r.position.origin, 'holdings-reentry');
    check('2 status=open', r.position.status, 'open');
    check('2 units 1개', r.position.units.length, 1);
    check('2 trailHighClose=fillPrice', r.position.trailHighClose, 50_000);
    check('2 entryDonchianHigh 보존', r.position.entryDonchianHigh, 51_000);
  } else {
    throw new Error('2. recordTurtleReentry 실패 — 이후 테스트 진행 불가');
  }

  // 잘못된 입력 → 거부
  const rBad1 = recordTurtleReentry({ id: 'x', ticker: 't', name: 'n', fillDate: '2026-01-01', fillPrice: 0, quantity: 1, nAtFill: 1, donchianHigh: 1, settings: S });
  check('2 거부(fillPrice=0)', rBad1.ok ? 'ok' : rBad1.reason, 'invalid-fill');
  const rBad2 = recordTurtleReentry({ id: 'x', ticker: 't', name: 'n', fillDate: '2026-01-01', fillPrice: 100, quantity: 0, nAtFill: 1, donchianHigh: 1, settings: S });
  check('2 거부(quantity=0)', rBad2.ok ? 'ok' : rBad2.reason, 'invalid-fill');
  const rBad3 = recordTurtleReentry({ id: 'x', ticker: 't', name: 'n', fillDate: '2026-01-01', fillPrice: 100, quantity: 1, nAtFill: 0, donchianHigh: 1, settings: S });
  check('2 거부(nAtFill=0)', rBad3.ok ? 'ok' : rBad3.reason, 'invalid-n');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. recordTurtlePyramid — 2R 트리거(50,000 + 2×2×1,500 = 56,000)에서 체결 → 공통 손절 53,000
//    (트리거 가격 계산 자체는 P0 computePyramidTriggerPrice 담당 — 여기선 "그 가격에 실제 체결됐다"를 기록)
// ════════════════════════════════════════════════════════════════════════════
let pyramidedPosition: TurtlePosition;
{
  const before = JSON.parse(JSON.stringify(reentryPosition)) as TurtlePosition; // 불변성 대조용 스냅샷
  const r = recordTurtlePyramid(reentryPosition, {
    fillDate: '2026-09-25', fillPrice: 56_000, quantity: 20, nAtFill: 1_500,
  }, S);
  checkTrue('3 ok', r.ok);
  if (r.ok) {
    pyramidedPosition = r.position;
    check('3 공통 손절=53,000', r.position.stopPrice, 53_000);
    check('3 units 2개', r.position.units.length, 2);
    check('3 두번째 유닛 체결가', r.position.units[1].fillPrice, 56_000);
    check('3 trailHighClose 갱신(56,000)', r.position.trailHighClose, 56_000);
  } else {
    throw new Error('3. recordTurtlePyramid 실패 — 이후 테스트 진행 불가');
  }
  check('3 원본 포지션 불변(JSON)', reentryPosition, before);

  // 손절 상향만(래칫) — 새 체결가가 이전보다 낮은 극단 입력이 와도 기존 손절가 아래로 안 내려간다.
  const rLowerFill = recordTurtlePyramid(reentryPosition, {
    fillDate: '2026-09-26', fillPrice: 47_100, quantity: 5, nAtFill: 100,
  }, S);
  if (rLowerFill.ok) {
    // computed = 47,100 - 2*100 = 46,900 < 기존 손절 47,000 → 기존 유지
    check('3 손절 하향 방지(래칫, 47,000 유지)', rLowerFill.position.stopPrice, 47_000);
  } else {
    fail++; console.error('  ✗ 3 손절 하향 방지 케이스가 거부되면 안 됨');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. maxUnitsPerPosition 가드 — 4유닛(기본 한도) 도달 후 추가 시도 → 거부
// ════════════════════════════════════════════════════════════════════════════
{
  let pos = pyramidedPosition; // 이미 2유닛
  const r3rd = recordTurtlePyramid(pos, { fillDate: '2026-09-28', fillPrice: 60_000, quantity: 10, nAtFill: 1_500 }, S);
  checkTrue('4 3번째 유닛 성공', r3rd.ok);
  if (r3rd.ok) pos = r3rd.position;
  const r4th = recordTurtlePyramid(pos, { fillDate: '2026-10-01', fillPrice: 64_000, quantity: 10, nAtFill: 1_500 }, S);
  checkTrue('4 4번째 유닛 성공', r4th.ok);
  if (r4th.ok) pos = r4th.position;
  check('4 유닛 수=4', pos.units.length, 4);

  const r5th = recordTurtlePyramid(pos, { fillDate: '2026-10-05', fillPrice: 68_000, quantity: 10, nAtFill: 1_500 }, S);
  check('4 5번째 거부(max-units-reached)', r5th.ok ? 'ok' : r5th.reason, 'max-units-reached');
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 0.5배 수량(pyramidSizeMultiplier=0.5 적용 후 값) — 그대로 기록되는지(재계산 안 함)
// ════════════════════════════════════════════════════════════════════════════
{
  const first = recordTurtleReentry({
    id: 'tp-half', ticker: 'SLV', name: 'iShares Silver', fillDate: '2026-09-01',
    fillPrice: 100, quantity: 100, nAtFill: 3, donchianHigh: 101, settings: S,
  });
  checkTrue('5 최초 유닛 성공', first.ok);
  if (first.ok) {
    // 호출부가 pyramidSizeMultiplier=0.5를 이미 적용해 quantity=50(최초 100의 절반)으로 넘긴 경우
    const half = recordTurtlePyramid(first.position, { fillDate: '2026-09-10', fillPrice: 112, quantity: 50, nAtFill: 3 }, S);
    checkTrue('5 0.5배 유닛 성공', half.ok);
    if (half.ok) {
      check('5 최초 수량 100 보존', half.position.units[0].quantity, 100);
      check('5 추가 수량 50(0.5배) 그대로 기록', half.position.units[1].quantity, 50);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6. recordTurtleHold — 사유 필수 + 연속 보류 카운트
// ════════════════════════════════════════════════════════════════════════════
{
  const rNoReason = recordTurtleHold({ decisions: undefined, date: '2026-09-01', reason: '' });
  check('6 사유 없으면 거부', rNoReason.ok ? 'ok' : rNoReason.reason, 'reason-required');
  const rBlank = recordTurtleHold({ decisions: undefined, date: '2026-09-01', reason: '   ' });
  check('6 공백만 있으면 거부', rBlank.ok ? 'ok' : rBlank.reason, 'reason-required');

  const r1 = recordTurtleHold({ decisions: undefined, date: '2026-09-01', reason: '아직 반등 기대' });
  checkTrue('6 첫 보류 성공', r1.ok);
  let decisions = r1.ok ? r1.decisions : [];
  check('6 첫 보류 후 길이 1', decisions.length, 1);
  check('6 연속 보류 1', consecutiveHoldCount(decisions), 1);

  const r2 = recordTurtleHold({ decisions, date: '2026-09-08', reason: '한 번 더 보류' });
  decisions = r2.ok ? r2.decisions : decisions;
  check('6 두 번째 보류 후 길이 2', decisions.length, 2);
  check('6 연속 보류 2', consecutiveHoldCount(decisions), 2);
  check('6 원본 배열 불변(길이 1 유지)', (r1.ok ? r1.decisions : []).length, 1);

  // 캡(TURTLE_HOLD_DECISIONS_CAP=20) — 21번째부터 오래된 것부터 버림
  let capDecisions: typeof decisions = [];
  for (let i = 0; i < 21; i++) {
    const r = recordTurtleHold({ decisions: capDecisions, date: `2026-01-${String(i + 1).padStart(2, '0')}`, reason: `사유${i}` });
    if (r.ok) capDecisions = r.decisions;
  }
  check('6 캡 20개 유지', capDecisions.length, 20);
  check('6 가장 오래된 항목(사유0) 제거됨', capDecisions[0].reason, '사유1');
  check('6 최신 항목 보존(사유20)', capDecisions[capDecisions.length - 1].reason, '사유20');
  check('6 캡 상황에서도 연속 보류=20', consecutiveHoldCount(capDecisions), 20);

  check('6 빈 이력 연속 보류 0', consecutiveHoldCount(undefined), 0);
  check('6 빈 배열 연속 보류 0', consecutiveHoldCount([]), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 위성 실행 큐 생성기(actionQueueGenerator)가 holdings-reentry 포지션을 오인하지 않는지
//    — 손절가 도달 상태의 포지션을 origin 유무만 바꿔 넣고 생성 결과를 대조한다.
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = DEFAULT_TURTLE_SETTINGS; // 위성 TurtleSettings(예산 등은 이 테스트에서 무의미하도록 0으로 둠)
  const holdingsPos: TurtlePosition = {
    id: 'tp-h1', ticker: 'HOLD1', name: '보유종목재매수', origin: 'holdings-reentry',
    units: [{ fillDate: '2026-09-01', fillPrice: 50_000, quantity: 10, nAtFill: 1_500 }],
    stopPrice: 47_000, entryDonchianHigh: 51_000, status: 'open', openedAt: '2026-09-01',
  };
  const satellitePos: TurtlePosition = { ...holdingsPos, id: 'tp-s1', ticker: 'SAT1', name: '위성포지션', origin: undefined };

  const marketByTicker = new Map([
    ['HOLD1', { ticker: 'HOLD1', name: '보유종목재매수', price: 46_000, n: 1_500, donchianHigh: 60_000, donchianLow: 45_000, fxRate: 1 }],
    ['SAT1', { ticker: 'SAT1', name: '위성포지션', price: 46_000, n: 1_500, donchianHigh: 60_000, donchianLow: 45_000, fxRate: 1 }],
  ]);
  const genInput = {
    positions: [holdingsPos, satellitePos], candidates: [], marketByTicker, settings,
    existingQueue: [], remainingBudgetKRW: 0, today: '2026-09-30',
  };
  const generated = buildTurtleActions({ ...genInput, makeId: (seq) => `t-${seq}` });
  checkTrue('7 holdings-reentry 포지션은 주문 생성 안 됨', !generated.some(a => a.positionId === 'tp-h1'));
  checkTrue('7 위성 포지션(origin 없음)은 정상 손절 주문 생성', generated.some(a => a.positionId === 'tp-s1' && a.kind === 'TURTLE_STOP'));

  const diag = diagnoseTurtleActions(genInput);
  const holdingsDiag = diag.positions.find(p => p.positionId === 'tp-h1');
  checkTrue('7 진단에도 holdings-reentry 포지션 없음(오픈 포지션 평가 자체에서 제외)', holdingsDiag === undefined);
  check('7 진단 generatedCount는 buildTurtleActions 결과와 일치', diag.generatedCount, generated.length);
}

// ── 결과 ──
if (fail > 0) {
  console.error(`\n❌ turtleHoldingsState parity 실패 (${fail})`);
  process.exit(1);
}
console.log(`✅ turtleHoldingsState parity 전체 통과 (${pass} 단언)`);
