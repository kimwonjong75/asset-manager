// tests/turtleMarketDataParity.ts
// ---------------------------------------------------------------------------
// 터틀 시장 입력 조립(Phase 2b) + 큐 병합 순수 함수 골든 테스트.
//   · turtleFxRate / turtleHistoryWindow / computeDeployedBudgetKRW
//   · extractOhlcvSeries / assembleMarketInput (N·돈치안)
//   · reconcileActionQueue (스누즈 만료 복귀 + 신규 추가)
// 수동 실행: npm run test:turtledata (tsx). 통과 시 exit 0.

import { Currency, ExchangeRates } from '../types';
import { TurtleSettings, DEFAULT_TURTLE_SETTINGS, TurtlePosition } from '../types/turtle';
import { ActionItem } from '../types/actionQueue';
import {
  turtleFxRate,
  turtleHistoryWindow,
  computeDeployedBudgetKRW,
  extractOhlcvSeries,
  assembleMarketInput,
} from '../utils/turtleMarketData';
import { reconcileActionQueue } from '../utils/actionQueueGenerator';

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

const rates: ExchangeRates = { USD: 1400, JPY: 9 };
const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({ ...DEFAULT_TURTLE_SETTINGS, ...over });

// ════════════════════════════════════════════════════════════════════════════
// 1. turtleFxRate — USD/JPY만 rates, 나머지 1, 0/음수 방어
// ════════════════════════════════════════════════════════════════════════════
check('fx USD', turtleFxRate(Currency.USD, rates), 1400);
check('fx JPY', turtleFxRate(Currency.JPY, rates), 9);
check('fx KRW=1', turtleFxRate(Currency.KRW, rates), 1);
check('fx undefined=1', turtleFxRate(undefined, rates), 1);
check('fx CNY=1(레이트 없음)', turtleFxRate(Currency.CNY, rates), 1);
check('fx USD 0방어→1', turtleFxRate(Currency.USD, { USD: 0, JPY: 9 }), 1);

// ════════════════════════════════════════════════════════════════════════════
// 2. turtleHistoryWindow — 최소 기간(10년 아님)
// ════════════════════════════════════════════════════════════════════════════
{
  const w = turtleHistoryWindow(S({ entryLookback: 55, exitLookback: 20 }), '2026-07-05');
  check('endDate=today', w.endDate, '2026-07-05');
  const days = (Date.parse(`${w.endDate}T00:00:00Z`) - Date.parse(`${w.startDate}T00:00:00Z`)) / 86_400_000;
  // tradingDaysNeeded=max(56,21,60)=60 → calendar=ceil(90)+15=105
  check('lookback 105 캘린더일 (최소)', days, 105);
  checkTrue('10년(3650일) 미만', days < 200);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. computeDeployedBudgetKRW — 원가×환율, closed 제외
// ════════════════════════════════════════════════════════════════════════════
{
  const pos: TurtlePosition = {
    id: 'p', ticker: 'T', name: 'T', status: 'open', openedAt: '2026-01-01', entryDonchianHigh: 100,
    units: [
      { fillDate: '2026-01-01', fillPrice: 100, quantity: 10, nAtFill: 5, fxRateAtFill: 1400 },
      { fillDate: '2026-01-02', fillPrice: 110, quantity: 5, nAtFill: 5, fxRateAtFill: 1400 },
    ],
    stopPrice: 90,
  };
  const closed: TurtlePosition = { ...pos, id: 'c', status: 'closed' };
  // 10×100×1400 + 5×110×1400 = 1,400,000 + 770,000 = 2,170,000
  checkClose('배정 예산 = 원가×환율', computeDeployedBudgetKRW([pos, closed]), 2_170_000);
  // KRW 자산(fxRateAtFill 없음→1)
  const krwPos: TurtlePosition = {
    ...pos, id: 'k',
    units: [{ fillDate: '2026-01-01', fillPrice: 80_000, quantity: 3, nAtFill: 2000 }],
  };
  checkClose('KRW 배정(환율 없음→1)', computeDeployedBudgetKRW([krwPos]), 240_000);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. extractOhlcvSeries — 날짜 오름차순, 미수신 null
// ════════════════════════════════════════════════════════════════════════════
{
  const s = extractOhlcvSeries({
    data: { '2026-01-02': 101, '2026-01-01': 100 },
    high: { '2026-01-01': 102 },
    low: {},
  });
  check('정렬 날짜', s.sortedDates, ['2026-01-01', '2026-01-02']);
  check('종가 배열', s.closes, [100, 101]);
  check('고가 부분수신→null', s.highs, [102, null]);
  check('저가 미수신→전부 null', s.lows, [null, null]);
  check('빈 결과 안전', extractOhlcvSeries(undefined).sortedDates, []);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. assembleMarketInput — N(ATR20)·돈치안(진입55/청산20), 크립토=소수허용
// ════════════════════════════════════════════════════════════════════════════
{
  // 80일 상승 시계열: close=100+i, high=close+1, low=close-1
  const N = 80;
  const sortedDates: string[] = [];
  const closes: (number | null)[] = [];
  const highs: (number | null)[] = [];
  const lows: (number | null)[] = [];
  for (let i = 0; i < N; i++) {
    sortedDates.push(`2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`);
    const c = 100 + i;
    closes.push(c); highs.push(c + 1); lows.push(c - 1);
  }
  const mi = assembleMarketInput({
    ticker: 'ASC', name: '상승', price: 179, currency: Currency.USD, isCrypto: false,
    series: { sortedDates, closes, highs, lows }, settings: S({ entryLookback: 55, exitLookback: 20 }), rates,
  });
  // 진입 돈치안: 당일(idx79) 제외, 직전 55일 최고가 = high[78] = (100+78)+1 = 179
  checkClose('진입 돈치안 55일 최고가 179', mi.donchianHigh!, 179);
  // 청산 돈치안: 직전 20일 최저가 = low[59] = (100+59)-1 = 158
  checkClose('청산 돈치안 20일 최저가 158', mi.donchianLow!, 158);
  checkTrue('N(ATR20) > 0 산출', typeof mi.n === 'number' && mi.n! > 0);
  check('fxRate USD=1400', mi.fxRate, 1400);
  check('현물=소수 불가', mi.allowFractional, false);
  check('dollarPerPoint 1', mi.dollarPerPoint, 1);

  // 크립토 = 소수 허용, KRW 기준 fx 1
  const crypto = assembleMarketInput({
    ticker: 'BTC', name: '비트', price: 90_000_000, currency: Currency.KRW, isCrypto: true,
    series: { sortedDates, closes, highs, lows }, settings: S(), rates,
  });
  check('크립토=소수 허용', crypto.allowFractional, true);
  check('크립토 KRW fx=1', crypto.fxRate, 1);

  // 데이터 부족 → n null (fail-closed)
  const short = assembleMarketInput({
    ticker: 'X', name: 'X', price: 10, currency: Currency.KRW, isCrypto: false,
    series: { sortedDates: ['2026-01-01'], closes: [10], highs: [11], lows: [9] }, settings: S(), rates,
  });
  check('데이터 부족 → N null', short.n, null);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. reconcileActionQueue — 만료 스누즈 복귀 + 신규 추가, 이력 보존
// ════════════════════════════════════════════════════════════════════════════
{
  const TODAY = '2026-07-05';
  const mk = (over: Partial<ActionItem>): ActionItem => ({
    id: 'x', createdDate: '2026-07-01', kind: 'TURTLE_STOP', ticker: 'A', name: 'A',
    quantity: 1, refPrice: 1, reasonText: '', ruleSnapshot: {}, status: 'pending', ...over,
  });
  const existing: ActionItem[] = [
    mk({ id: 'expired', status: 'snoozed', snoozedUntil: '2026-07-04' }),  // 만료 → 복귀
    mk({ id: 'future', status: 'snoozed', snoozedUntil: '2026-07-10' }),   // 미래 → 유지
    mk({ id: 'pend', status: 'pending' }),
    mk({ id: 'done', status: 'done', resolvedDate: '2026-07-02' }),
  ];
  const generated: ActionItem[] = [mk({ id: 'new', status: 'pending' })];
  const out = reconcileActionQueue(existing, generated, TODAY);
  check('길이 = 기존4 + 신규1', out.length, 5);
  check('만료 스누즈 → pending 복귀', out.find(i => i.id === 'expired')!.status, 'pending');
  check('만료 스누즈 snoozedUntil 제거', out.find(i => i.id === 'expired')!.snoozedUntil, undefined);
  check('미래 스누즈 유지', out.find(i => i.id === 'future')!.status, 'snoozed');
  check('done 이력 보존', out.find(i => i.id === 'done')!.status, 'done');
  check('신규 추가됨', out.find(i => i.id === 'new')!.status, 'pending');
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ turtleMarketData parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ turtleMarketData parity 전체 통과 (${pass} 단언)`);
}
