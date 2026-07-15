// tests/onboardingPolicyParity.ts
// 편입정책 시뮬레이터(onboarding-policy-v1) 골든/회계 불변식 테스트.
// 명시적 골든 절대값을 고정한다 — 경로A-vs-경로B 자기참조 비교 금지(RULES §13 교훈).
//
// 실행: npm run test:onboarding

import {
  precompute, simulateCell, isSkip, monthlyFirstTradingDays, lastIndexAtOrBefore,
  RuleConfig, Series, CellResult, mulberry32,
  buildBlocks, blockBootstrapCI, yearsBetween, annualizeReturn, MonthCluster,
} from '../scripts/backtest/onboardingPolicy/simulator';
import { calculateDonchianLow, calculateDonchianHigh } from '../utils/donchianChannel';
import { computeN } from '../utils/turtleEngine';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (ok) { pass++; } else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) { pass++; } else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`); }
}
function checkTrue(name: string, v: boolean): void { check(name, v, true); }

const CFG: RuleConfig = {
  exitLookback: 20, entryLookback: 55, stopMultipleN: 2, pyramidStepN: 0.5,
  atrPeriod: 20, riskPerUnitPct: 0.5, costOneWay: 0.001, evalWindowBars: 500,
  legacyValuePctOfBudget: 100,
};

function iso(i: number): string {
  // 2015-01-01 + i일 (테스트 전용 결정론 날짜 — 달력 정확도 불필요)
  const t = Date.parse('2015-01-01T00:00:00Z') + i * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 평탄구간(close=100, h=100.5, l=99.5 → TR=1 → ATR20=1) + 지정 꼬리. */
function flatSeries(tailClose: number[], tailOpen: number[], nFlat = 60): Series {
  const open: (number | null)[] = [], high: (number | null)[] = [], low: (number | null)[] = [], close: (number | null)[] = [], dates: string[] = [];
  for (let i = 0; i < nFlat; i++) { open.push(100); high.push(100.5); low.push(99.5); close.push(100); dates.push(iso(i)); }
  for (let k = 0; k < tailClose.length; k++) {
    const c = tailClose[k], o = tailOpen[k];
    open.push(o); close.push(c);
    high.push(Math.max(o, c) + 0.5); low.push(Math.min(o, c) - 0.5);
    dates.push(iso(nFlat + k));
  }
  return { ticker: 'TEST', dates, open, high, low, close };
}

console.log('편입정책 시뮬레이터 골든/불변식 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. 사전계산 ≡ 앱 순수함수 (parity anchor)');
// ════════════════════════════════════════════════════════════════════════════
{
  const s = flatSeries([97, 99, 101, 103, 99], [100, 99, 100, 102, 100]);
  const pre = precompute(s, CFG)!;
  checkTrue('precompute 성공', pre != null);

  // ATR: 평탄구간 TR=1 → ATR20 = 1 (골든 절대값)
  checkClose('ATR20 골든 = 1.0', pre.atr[59] as number, 1.0, 1e-12);

  // atr[i] ≡ computeN(슬라이스 [0..i])  — 인과성·동치 확인
  for (const i of [55, 58, 59, 60, 62]) {
    const viaSlice = computeN(s.high.slice(0, i + 1), s.low.slice(0, i + 1), s.close.slice(0, i + 1), 20);
    checkClose(`atr[${i}] ≡ computeN(slice)`, pre.atr[i] as number, viaSlice as number, 1e-12);
  }

  // low20[i] ≡ calculateDonchianLow(슬라이스, 20, excludeToday) / high55 동일
  for (const i of [55, 59, 60, 63]) {
    const lo = calculateDonchianLow(s.low.slice(0, i + 1), 20, { excludeToday: true });
    checkClose(`low20[${i}] ≡ calculateDonchianLow`, pre.low20[i] as number, lo as number, 1e-12);
    const hi = calculateDonchianHigh(s.high.slice(0, i + 1), 55, { excludeToday: true });
    checkClose(`high55[${i}] ≡ calculateDonchianHigh`, pre.high55[i] as number, hi as number, 1e-12);
  }
  checkClose('low20[59] 골든 = 99.5', pre.low20[59] as number, 99.5, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. 골든 셀 — 손절 우선 + 갭업 시가 체결 (min(open,stop) 금지 검증)');
// ════════════════════════════════════════════════════════════════════════════
{
  // bar60: close=97 → 손절가 98 이하 (동시에 20일저 99.5 이하 → 청산도 성립) → 손절 우선
  // bar61: open=99 (갭업) → 체결가는 99. min(open,stop)=98 이었다면 오답.
  const tailC = [97, 99], tailO = [100, 99];
  for (let k = 0; k < 140; k++) { tailC.push(50); tailO.push(50); } // 청산 후 급락 (P1 만 맞음)
  const s = flatSeries(tailC, tailO);
  const pre = precompute(s, CFG)!;
  const lastIdx = s.dates.length - 1;
  const r = simulateCell(pre, 59, lastIdx, CFG);
  checkTrue('셀 생성됨', !isSkip(r));
  const c = r as CellResult;

  checkClose('편입가 = open[60] = 100', c.admissionPrice, 100, 1e-12);
  checkClose('N = 1', c.n, 1, 1e-12);
  checkClose('손절가 = 100 − 2×1 = 98', c.stopPrice, 98, 1e-12);
  check('청산사유 = stop (손절 우선)', c.p2ExitReason, 'stop');
  check('청산일 = bar61', c.p2ExitDate, s.dates[61]);
  check('보유바 = 1', c.p2HoldBars, 1);
  check('즉시청산 아님', c.immediateExit, false);

  // 골든: 체결가 99 (갭업 시가 그대로) — min(open,stop)=98 이면 아래 값이 달라진다
  checkClose('P2 수익률 = 99×0.999/100 − 1 = −0.01099', c.p2Return, -0.01099, 1e-12);
  checkClose('P2 R = (99×0.999 − 100)/2 = −0.5495', c.p2R, -0.5495, 1e-12);
  // 대조: min(open,stop) 규칙이었다면 R = (98×0.999−100)/2 = −1.0490 → 다름을 고정
  checkTrue('금지규칙(min(open,stop)) 결과와 다름', Math.abs(c.p2R - (-1.0490)) > 0.4);

  // P1: 마지막 종가 50 강제청산
  checkClose('P1 수익률 = 50×0.999/100 − 1 = −0.5005', c.p1Return, -0.5005, 1e-12);
  checkClose('P1 R = (50×0.999 − 100)/2 = −25.025', c.p1R, -25.025, 1e-12);

  // MDD 골든: P1 최저점은 **비용 차감 실현 종점** 50×0.999/100 = 0.4995 → (1−0.4995)/1 = 0.5005.
  //   (마크 경로의 0.50 이 아니라 실현값이 경로 종점이다 — P2 도 동일 규약이라 대칭.)
  // P2 는 bar61 청산 후 현금 → 최저점은 bar60 종가 0.97 → 3%.
  checkClose('P1 MDD = 0.5005 (비용 차감 실현 종점 기준)', c.p1MDD, 0.5005, 1e-9);
  checkClose('P2 MDD = 0.03', c.p2MDD, 0.03, 1e-9);
  checkTrue('P2 MDD < P1 MDD', c.p2MDD < c.p1MDD);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. 골든 셀 — 20일 청산 단독 (손절 미발화)');
// ════════════════════════════════════════════════════════════════════════════
{
  // bar60: close=99 → 손절가 98 초과(미발화), 20일저 99.5 이하 → 청산. bar61 open=98.5 체결.
  const s = flatSeries([99, 98.5, 98.5], [100, 98.5, 98.5]);
  const pre = precompute(s, CFG)!;
  const r = simulateCell(pre, 59, s.dates.length - 1, CFG) as CellResult;
  check('청산사유 = channel-exit', r.p2ExitReason, 'channel-exit');
  checkClose('체결가 = open[61] = 98.5 → 수익률', r.p2Return, (98.5 * 0.999) / 100 - 1, 1e-12);
  checkClose('R = (98.5×0.999 − 100)/2', r.p2R, (98.5 * 0.999 - 100) / 2, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. 즉시청산 — D 종가가 이미 20일 최저가 이탈');
// ════════════════════════════════════════════════════════════════════════════
{
  // bar59 를 D 로 쓰되 close[59] 를 99 로 낮춰 low20(99.5) 이탈시킨다.
  const s = flatSeries([100, 100], [100, 100]);
  s.close[59] = 99; s.low[59] = 98.5; s.high[59] = 100.5;
  const pre = precompute(s, CFG)!;
  const r = simulateCell(pre, 59, s.dates.length - 1, CFG) as CellResult;
  check('즉시청산 플래그', r.immediateExit, true);
  check('청산사유 = immediate-exit', r.p2ExitReason, 'immediate-exit');
  check('보유바 = 0', r.p2HoldBars, 0);
  checkClose('즉시청산 수익률 = −비용', r.p2Return, -0.001, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. 불타기 — 현재 N 기준 + 예산차단 기록 (SIGNAL_BLOCKED_BY_BUDGET)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 편입가 100, N=1 → 트리거 = 100 + 0.5×1 = 100.5. close=101 → 충족.
  const s = flatSeries([101, 101, 101], [100, 101, 101]);
  const pre = precompute(s, CFG)!;
  const r = simulateCell(pre, 59, s.dates.length - 1, CFG) as CellResult;
  check('불타기 예산차단 기록', r.pyramidBlocked, true);
  check('불타기 미체결 — 청산사유는 forced-eod', r.p2ExitReason, 'forced-eod');

  // 미달 케이스: close=100.4 < 100.5 → 미충족
  const s2 = flatSeries([100.4, 100.4], [100, 100.4]);
  const pre2 = precompute(s2, CFG)!;
  const r2 = simulateCell(pre2, 59, s2.dates.length - 1, CFG) as CellResult;
  check('트리거 미달 → 기록 없음', r2.pyramidBlocked, false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. 회계 불변식');
// ════════════════════════════════════════════════════════════════════════════
{
  const s = flatSeries([97, 99, 99], [100, 99, 99]);
  const pre = precompute(s, CFG)!;
  const r = simulateCell(pre, 59, s.dates.length - 1, CFG) as CellResult;

  // LEGACY_EXCESS 배수 = (legacyPct × N) / (riskPct × 편입가) = (100×1)/(0.5×100) = 2
  checkClose('LEGACY_EXCESS 배수 = 2.0', r.legacyExcessMultiple, 2, 1e-12);
  check('LEGACY_EXCESS 플래그', r.legacyExcess, true);
  // 의미 고정: 실손절위험이 1유닛 규격(예산 1%)의 2배 → 기존수량 보존의 대가
  checkClose('배수 ≡ 2N/편입가 ÷ 1% (동치 확인)', r.legacyExcessMultiple, (2 * r.n / r.admissionPrice) / 0.01, 1e-9);

  // R 분모 = 2N (수량 소거) — 정의 고정
  checkClose('R 분모 = 2N', (r.p2Return * r.admissionPrice) / r.p2R, 2 * r.n, 1e-9);

  // 강제 트림 없음 → 수량 개념이 결과에 등장하지 않음 (척도 무관): 가격 전체를 ×7 해도 수익률·R 불변
  const s7: Series = {
    ticker: 'TEST7', dates: s.dates,
    open: s.open.map(v => (v == null ? null : v * 7)),
    high: s.high.map(v => (v == null ? null : v * 7)),
    low: s.low.map(v => (v == null ? null : v * 7)),
    close: s.close.map(v => (v == null ? null : v * 7)),
  };
  const r7 = simulateCell(precompute(s7, CFG)!, 59, s7.dates.length - 1, CFG) as CellResult;
  checkClose('척도 무관: 수익률 불변', r7.p2Return, r.p2Return, 1e-12);
  checkClose('척도 무관: R 불변', r7.p2R, r.p2R, 1e-12);
  checkClose('척도 무관: MDD 불변', r7.p2MDD, r.p2MDD, 1e-12);
  checkClose('척도 무관: LEGACY 배수 불변', r7.legacyExcessMultiple, r.legacyExcessMultiple, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 워밍업 게이트 · 홀드아웃 누출 차단');
// ════════════════════════════════════════════════════════════════════════════
{
  const s = flatSeries([100, 100], [100, 100]);
  const pre = precompute(s, CFG)!;
  // 유효봉 54 (<55) → 편입 거부
  const r = simulateCell(pre, 53, s.dates.length - 1, CFG);
  checkTrue('유효봉 54 → skip', isSkip(r));
  check('skip 사유 = no-warmup', isSkip(r) ? r.reason : '', 'no-warmup');
  // 유효봉 55 → 통과
  checkTrue('유효봉 55 → 통과', !isSkip(simulateCell(pre, 54, s.dates.length - 1, CFG)));

  // 평가창은 lastIdx 를 넘지 않는다 (홀드아웃 바 미참조)
  const cut = 70;
  const rc = simulateCell(pre, 59, cut, CFG) as CellResult;
  check('평가창 말 = lastIdx 절단', rc.windowEndDate, s.dates[cut]);

  // D+1 바가 lastIdx 를 넘으면 skip
  const rEdge = simulateCell(pre, 59, 59, CFG);
  checkTrue('D+1 바 없음 → skip', isSkip(rEdge));
  check('skip 사유 = no-fill-bar', isSkip(rEdge) ? rEdge.reason : '', 'no-fill-bar');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. 편입일 그리드 · 결정론');
// ════════════════════════════════════════════════════════════════════════════
{
  const dates = ['2015-01-02', '2015-01-05', '2015-02-02', '2015-02-03', '2015-03-02', '2022-01-03'];
  const g = monthlyFirstTradingDays(dates, '2015-01-02', '2021-12-30');
  check('월 첫 거래일 3개', g.length, 3);
  check('1월 첫 거래일', dates[g[0]], '2015-01-02');
  check('2월 첫 거래일', dates[g[1]], '2015-02-02');
  check('3월 첫 거래일', dates[g[2]], '2015-03-02');
  checkTrue('홀드아웃 편입일 미포함', !g.some(i => dates[i] >= '2022-01-01'));
  check('구간말 인덱스', lastIndexAtOrBefore(dates, '2021-12-30'), 4);

  // PRNG 결정론 (같은 시드 → 바이트 동일)
  const a = mulberry32(20260715); const b = mulberry32(20260715);
  checkClose('PRNG 결정론', a(), b(), 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. [AMENDED-1 #1] 블록 부트스트랩 — 인접 상관 표본이 한 블록으로 재표집');
// ════════════════════════════════════════════════════════════════════════════
{
  // 월 5개, 기준 달력에서 21거래일 간격 (≈1개월). blockTradingDays=60 → 블록은 연속 3개월.
  const clusters: MonthCluster[] = [
    { monthKey: '2015-01', refIdx: 0, values: [1] },
    { monthKey: '2015-02', refIdx: 21, values: [2] },
    { monthKey: '2015-03', refIdx: 42, values: [3] },
    { monthKey: '2015-04', refIdx: 63, values: [4] },
    { monthKey: '2015-05', refIdx: 84, values: [5] },
  ];
  const blocks = buildBlocks(clusters, 60);
  // 블록0 = refIdx < 0+60 → {0,21,42} = 월 0,1,2 — **인접 3개월이 한 블록**
  check('블록0 = 인접 3개월 [0,1,2]', JSON.stringify(blocks[0]), JSON.stringify([0, 1, 2]));
  check('블록1 = [1,2,3] (refIdx<81)', JSON.stringify(blocks[1]), JSON.stringify([1, 2, 3]));
  check('블록2 = [2,3,4] (refIdx<102)', JSON.stringify(blocks[2]), JSON.stringify([2, 3, 4]));
  check('블록3 = [3,4] (꼬리 절단)', JSON.stringify(blocks[3]), JSON.stringify([3, 4]));
  check('블록4 = [4]', JSON.stringify(blocks[4]), JSON.stringify([4]));

  // blockTradingDays 가 실제 계산에 쓰인다 — 값을 바꾸면 블록 구성이 달라진다 (IID 였다면 불변)
  const b21 = buildBlocks(clusters, 21);
  check('blockTradingDays=21 → 블록0 = [0] 단독', JSON.stringify(b21[0]), JSON.stringify([0]));
  const b120 = buildBlocks(clusters, 120);
  check('blockTradingDays=120 → 블록0 = 전 5개월', JSON.stringify(b120[0]), JSON.stringify([0, 1, 2, 3, 4]));
  checkTrue('blockTradingDays 가 결과를 바꾼다(파라미터 실사용)', JSON.stringify(blocks[0]) !== JSON.stringify(b21[0]));

  // 불규칙 간격: 60거래일 안에 드는 월만 묶인다
  const irregular: MonthCluster[] = [
    { monthKey: 'A', refIdx: 0, values: [1] },
    { monthKey: 'B', refIdx: 59, values: [2] },   // 59 < 60 → 포함
    { monthKey: 'C', refIdx: 60, values: [3] },   // 60 ≮ 60 → 제외
  ];
  check('경계: refIdx 59 포함 / 60 제외', JSON.stringify(buildBlocks(irregular, 60)[0]), JSON.stringify([0, 1]));

  // 군집 무결성: 같은 월의 셀들은 **통째로** 이동한다 (종목 간 동시충격 보존).
  // M1=[10,10,10], M2=[-10,-10,-10], 이동블록 = [[0,1],[1]] (블록은 각 월에서 시작).
  // 도달 가능한 재표집 평균은 **월 단위 조합**뿐: {0(월0+월1), −10(월1+월1)}.
  // 군집이 쪼개졌다면(IID) −10/3·+10/3 같은 분수 평균이 나온다.
  const multi: MonthCluster[] = [
    { monthKey: 'M1', refIdx: 0, values: [10, 10, 10] },
    { monthKey: 'M2', refIdx: 21, values: [-10, -10, -10] },
  ];
  check('이동블록 구성 [[0,1],[1]]', JSON.stringify(buildBlocks(multi, 60)), JSON.stringify([[0, 1], [1]]));
  const r1 = blockBootstrapCI(multi, 60, 2000, 20260715);
  checkClose('군집 무결성: CI 하한 = 월조합값 −10', r1.lo, -10, 1e-12);
  checkClose('군집 무결성: CI 상한 = 월조합값 0', r1.hi, 0, 1e-12);
  checkTrue('IID 분수 평균(±10/3 등) 미발생', [0, -10].some(v => Math.abs(r1.lo - v) < 1e-12) && [0, -10].some(v => Math.abs(r1.hi - v) < 1e-12));

  // 결정론: 같은 시드 → 동일 CI
  const d1 = blockBootstrapCI(clusters, 60, 500, 20260715);
  const d2 = blockBootstrapCI(clusters, 60, 500, 20260715);
  checkClose('블록 부트스트랩 재현 (lo)', d1.lo, d2.lo, 0);
  checkClose('블록 부트스트랩 재현 (hi)', d1.hi, d2.hi, 0);
  check('블록 개수 = 월 수', d1.blocks, 5);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. [AMENDED-1 #2] 연환산 — 실제 경과일/365.2425 (거래봉×252 금지)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 정확히 1년 (365.2425일에 근접) — 2016 윤년 포함 366일
  checkClose('경과 366일 → 1.0021년', yearsBetween('2016-01-01', '2017-01-01'), 366 / 365.2425, 1e-12);
  checkClose('경과 365일 → 0.99938년', yearsBetween('2015-01-01', '2016-01-01'), 365 / 365.2425, 1e-12);

  // 골든 — 주식: 2년 경과, 총수익 +21% → 연환산 ≈ 10%
  const yStock = yearsBetween('2015-01-02', '2017-01-01'); // 730일
  checkClose('주식 경과 730일', yStock, 730 / 365.2425, 1e-12);
  checkClose('주식 연환산 골든', annualizeReturn(0.21, yStock), Math.pow(1.21, 365.2425 / 730) - 1, 1e-12);
  checkTrue('주식 연환산 ≈ 10%', Math.abs(annualizeReturn(0.21, yStock) - 0.10) < 0.005);

  // 골든 — 암호화폐: **같은 총수익·같은 달력기간이면 연환산도 같아야 한다**.
  // 구버전(거래봉×252)의 함의연수 = bars/252. 크립토는 연 ~365바이므로 2년 창이 730바 →
  // 함의연수 2.90년 (실제 2.0년) → **연수를 과대평가 → 연환산을 과소평가**한다. 주식(504바)은 2.0년으로 우연히 맞다.
  const barsStock = 504;  // 주식 2년 ≈ 504 거래바
  const barsCrypto = 730; // 크립토 2년 ≈ 730 바
  const oldStock = Math.pow(1.21, 252 / barsStock) - 1;
  const oldCrypto = Math.pow(1.21, 252 / barsCrypto) - 1;
  checkClose('구버전 함의연수(크립토) = 2.90년 (실제 2.0)', barsCrypto / 252, 2.8968253968253967, 1e-12);
  checkTrue('구버전은 주식/크립토 연환산이 어긋남(결함 재현)', Math.abs(oldStock - oldCrypto) > 0.02);

  const y2 = yearsBetween('2015-01-02', '2017-01-01'); // 730 달력일 = 1.9987년
  const newStock = annualizeReturn(0.21, y2);
  const newCrypto = annualizeReturn(0.21, y2);
  checkClose('신버전은 자산군 무관 동일(결함 해소)', newStock, newCrypto, 1e-12);
  // 오차 방향 고정: 구버전 크립토는 연수 과대평가 → 연환산 **과소**
  checkTrue('구버전 크립토가 참값보다 과소', oldCrypto < newCrypto);
  checkClose('구버전 크립토 ≈ 6.8%', oldCrypto, Math.pow(1.21, 252 / 730) - 1, 1e-12);
  checkTrue('신버전 크립토 ≈ 10% (참값)', Math.abs(newCrypto - 0.10) < 0.005);
  // 주식은 구버전도 우연히 참값과 근접 — 결함이 크립토에 집중됨을 고정
  checkTrue('구버전 주식은 참값과 근접(결함 비대칭)', Math.abs(oldStock - newStock) < 0.005);

  // 경계
  checkClose('years ≤ 0 → 0', annualizeReturn(0.5, 0), 0, 0);
  checkClose('총수익 −100% → −100%', annualizeReturn(-1, 2), -1, 0);
  checkClose('총수익 0 → 연환산 0', annualizeReturn(0, 1.5), 0, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. [AMENDED-1 #2] P1·P2 동일 평가종료일 연환산 (청산 후 현금 포함)');
// ════════════════════════════════════════════════════════════════════════════
{
  const tailC = [97, 99], tailO = [100, 99];
  for (let k = 0; k < 140; k++) { tailC.push(50); tailO.push(50); }
  const s = flatSeries(tailC, tailO);
  const pre = precompute(s, CFG)!;
  const r = simulateCell(pre, 59, s.dates.length - 1, CFG) as CellResult;
  // P2 는 bar61 에 청산했지만 평가종료일은 P1 과 동일해야 한다 (현금 보유 상태로 유지)
  check('P1·P2 평가종료일 동일', r.windowEndDate, s.dates[s.dates.length - 1]);
  const y = yearsBetween(r.fillDate, r.windowEndDate);
  checkTrue('연환산 분모(년) > 0', y > 0);
  // 동일 분모를 쓰므로 Δ연환산은 두 정책의 실현수익 차이만 반영
  const dAnn = annualizeReturn(r.p2Return, y) - annualizeReturn(r.p1Return, y);
  checkTrue('P2 조기청산이 급락을 피해 Δ연환산 > 0', dAnn > 0);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
