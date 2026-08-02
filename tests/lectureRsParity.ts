// tests/lectureRsParity.ts
// ---------------------------------------------------------------------------
// 3차 배치(RS 엔진 · RS90 진입 품질 · RS 보유열화) 골든/불변식 테스트(RULES §13).
//
// 규율: **명시적 절대 골든값을 손계산해 못박는다.** 경로A-vs-경로B 자기참조 비교 금지
//   (공통 함수를 추출한 뒤 두 경로를 비교하면 항진명제가 된다).
//   유일한 예외는 §1의 `rollingPriorMean` ↔ `features.priorMean` 대조인데, 이 둘은
//   **서로 다른 알고리즘**(증분 롤링 vs 매 바 재합산)이고 priorMean 자체는
//   `lectureSignalsParity.ts`가 절대 골든으로 이미 고정하고 있으므로 유효한 교차검증이다.
//
// 실행: npx tsx tests/lectureRsParity.ts
// ---------------------------------------------------------------------------

import {
  RS_CONST,
  assignPercentiles,
  buildRsRanks,
  computeRs50ToRs90,
  computeRsRaw,
  countBoomBustCycles,
  detectRsEntries,
  firstPostEntryRunup,
  firstRs5070StallAfterEntry,
  firstRs97AfterEntry,
  firstRsBelow50AfterEntry,
  rollingPriorMean,
  type RankDay,
} from '../scripts/backtest/lectureSignals/rs';
import {
  H_CODES,
  H_DIRECTION,
  H_FAMILY,
  Q_CODES,
  Q_DIRECTION,
  computeHWarnings,
  computeQFeatures,
  factorDecomposition,
} from '../scripts/backtest/lectureSignals/quality';
import { priorMean } from '../scripts/backtest/lectureSignals/features';
import { FACTOR_DECOMP_AXES } from '../scripts/backtest/lectureSignals/pipeline';
import type { SecurityBars } from '../scripts/backtest/lectureSignals/configTypes';
import type {
  LectureDataset,
  PitUniverse,
} from '../scripts/backtest/lectureSignals/dataAccess';
import type { FactorPanelLabels } from '../scripts/backtest/lectureSignals/factorPanel';

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${String(expected)} 실제=${String(actual)}`);
  }
}
function checkClose(name: string, actual: number | null, expected: number, tol = 1e-9): void {
  const ok = actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${expected} 실제=${String(actual)} (tol ${tol})`);
  }
}

// ── 합성 데이터 헬퍼 ─────────────────────────────────────────────────────────

/** 2010-01-01부터 n일(달력일 연속) — 합성 테스트 전용 거래일 캘린더. */
function makeDates(n: number): string[] {
  const out: string[] = [];
  const base = Date.UTC(2010, 0, 1);
  for (let i = 0; i < n; i++) out.push(new Date(base + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function makeBars(
  code: string,
  adjClose: number[],
  opts: Partial<{
    adjHigh: number[];
    adjLow: number[];
    adjOpen: number[];
    adjVolume: number[];
    amount: number[];
    dates: string[];
  }> = {}
): SecurityBars {
  const n = adjClose.length;
  const dates = opts.dates ?? makeDates(n);
  const dateIndex = new Map<string, number>();
  dates.forEach((d, i) => dateIndex.set(d, i));
  return {
    code,
    name: code,
    dates,
    adjOpen: opts.adjOpen ?? [...adjClose],
    adjHigh: opts.adjHigh ?? [...adjClose],
    adjLow: opts.adjLow ?? [...adjClose],
    adjClose,
    adjVolume: opts.adjVolume ?? new Array(n).fill(1000),
    amount: opts.amount ?? new Array(n).fill(2_000_000_000),
    market: new Array(n).fill('KOSPI'),
    dateIndex,
  };
}

/** RankDay[] 생성(bar = 인덱스 + offset, 랭크일이 연속 바인 단순 케이스). */
function makeRankList(ranks: number[], barOffset = 0): RankDay[] {
  const dates = makeDates(ranks.length + barOffset);
  return ranks.map((r, t) => ({ bar: t + barOffset, date: dates[t + barOffset], rank: r }));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('1. rollingPriorMean — features.priorMean 대조(감사 수정 회귀 가드)');
{
  // 초판 버그: out[i]가 mean(values[i-w..i-1])이 아니라 원소 1개가 빠진 합/w 였다.
  const v = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8];
  for (const w of [1, 2, 3, 5]) {
    const roll = rollingPriorMean(v, w);
    let ok = true;
    for (let i = 0; i < v.length; i++) {
      const want = priorMean(v, i, w);
      const got = roll[i];
      if (want === null ? got !== null : got === null || Math.abs(got - want) > 1e-12) ok = false;
    }
    check(`window=${w} 전 바 일치`, ok, true);
  }
  // 절대 골든: [3,1,4,1,5], w=3 → out[3]=(3+1+4)/3=2.666.., out[4]=(1+4+1)/3=2
  const g = rollingPriorMean([3, 1, 4, 1, 5], 3);
  check('out[0..2] null', `${g[0]}|${g[1]}|${g[2]}`, 'null|null|null');
  checkClose('out[3]=8/3', g[3], 8 / 3, 1e-12);
  checkClose('out[4]=2', g[4], 2, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. computeRsRaw — 0.40×R21 + 0.20×R63 + 0.20×R126 + 0.20×R252 손계산 골든');
{
  const n = 300;
  const close = new Array<number>(n).fill(100);
  // i=260 기준 앵커: 260-252=8, 260-126=134, 260-63=197, 260-21=239
  close[8] = 100;
  close[134] = 200;
  close[197] = 250;
  close[239] = 400;
  close[260] = 500;
  // R21=500/400-1=0.25, R63=500/250-1=1.0, R126=500/200-1=1.5, R252=500/100-1=4.0
  // rsRaw = 0.4(0.25) + 0.2(1.0) + 0.2(1.5) + 0.2(4.0) = 0.1+0.2+0.3+0.8 = 1.4
  checkClose('rsRaw(i=260)=1.4', computeRsRaw(close, 260), 1.4, 1e-12);
  check('가중치 합=1', RS_CONST.weightR21 + RS_CONST.weightR63 + RS_CONST.weightR126 + RS_CONST.weightR252, 1);
  check('R252 창 부족 → null', computeRsRaw(close, 251), null);
  checkClose('i=252 경계 계산 가능', computeRsRaw(close, 252), (() => {
    const r21 = close[252] / close[231] - 1;
    const r63 = close[252] / close[189] - 1;
    const r126 = close[252] / close[126] - 1;
    const r252 = close[252] / close[0] - 1;
    return 0.4 * r21 + 0.2 * r63 + 0.2 * r126 + 0.2 * r252;
  })(), 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. assignPercentiles — 백분위 공식 + 동률 종목코드 오름차순 결정론');
{
  // 정렬(rsRaw↑, code↑): B(0.1) D(0.1) A(0.5) C(0.9) → pct = 100k/3
  const m = assignPercentiles([
    { code: 'C', rsRaw: 0.9 },
    { code: 'A', rsRaw: 0.5 },
    { code: 'D', rsRaw: 0.1 },
    { code: 'B', rsRaw: 0.1 },
  ]);
  checkClose('B(동률·코드 앞) = 0', m.get('B') ?? NaN, 0, 1e-12);
  checkClose('D(동률·코드 뒤) = 100/3', m.get('D') ?? NaN, 100 / 3, 1e-12);
  checkClose('A = 200/3', m.get('A') ?? NaN, 200 / 3, 1e-12);
  checkClose('C(최고) = 100', m.get('C') ?? NaN, 100, 1e-12);

  // 입력 순서를 바꿔도 동일(결정론)
  const m2 = assignPercentiles([
    { code: 'B', rsRaw: 0.1 },
    { code: 'C', rsRaw: 0.9 },
    { code: 'D', rsRaw: 0.1 },
    { code: 'A', rsRaw: 0.5 },
  ]);
  check('입력 순서 무관', ['A', 'B', 'C', 'D'].every((c) => m.get(c) === m2.get(c)), true);

  // N=1 → 100
  checkClose('단일 종목 = 100', assignPercentiles([{ code: 'X', rsRaw: -0.5 }]).get('X') ?? NaN, 100, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. buildRsRanks — 적격 유니버스(유동성 10억·R252·PIT) + 횡단면 백분위 통합 골든');
{
  const n = 300;
  const dates = makeDates(n);
  const mkClose = (anchors: Record<number, number>): number[] => {
    const c = new Array<number>(n).fill(100);
    for (const k of Object.keys(anchors)) c[Number(k)] = anchors[Number(k)];
    return c;
  };
  // 001: rsRaw=1.4 / 002·003: rsRaw=0.1(동률) / 004: rsRaw 최고이나 유동성 미달로 제외
  const bars = new Map<string, SecurityBars>();
  bars.set('000001', makeBars('000001', mkClose({ 8: 100, 134: 200, 197: 250, 239: 400, 260: 500 }), { dates }));
  bars.set('000002', makeBars('000002', mkClose({ 260: 110 }), { dates }));
  bars.set('000003', makeBars('000003', mkClose({ 260: 110 }), { dates }));
  bars.set(
    '000004',
    makeBars('000004', mkClose({ 8: 100, 134: 300, 197: 400, 239: 600, 260: 900 }), {
      dates,
      amount: new Array(n).fill(100_000_000), // 1억원 < 10억원 → 전 기간 부적격
    })
  );
  const pit: PitUniverse = new Map();
  for (const d of dates) {
    const eff = d.slice(0, 7);
    let inner = pit.get(eff);
    if (!inner) {
      inner = new Map();
      pit.set(eff, inner);
    }
    for (const c of ['000001', '000002', '000003', '000004']) inner.set(c, { percentile: 42, large: false });
  }
  const ds: LectureDataset = {
    bars,
    pit,
    investableUnion: new Set(bars.keys()),
    corpActionDates: new Set<string>(),
    unresolvedCodes: new Set<string>(),
    manifestPrelock: 'TEST',
  };
  const ranks = buildRsRanks(ds, dates[n - 1]);
  const at = (code: string): number | null => ranks.rankByCode.get(code)?.[260] ?? null;
  // 적격 3종목 → 정렬(0.1,'000002') (0.1,'000003') (1.4,'000001') → 0 / 50 / 100
  checkClose('000002(동률·코드앞) = 0', at('000002'), 0, 1e-12);
  checkClose('000003(동률·코드뒤) = 50', at('000003'), 50, 1e-12);
  checkClose('000001(최고) = 100', at('000001'), 100, 1e-12);
  check('000004(유동성 미달) = null', at('000004'), null);
  checkClose('평균 적격 = 3종목', ranks.avgEligible, 3, 1e-12);
  check('랭킹일 = 48일(i=252..299)', ranks.daysRanked, 48);
  check('i=251은 R252 부족 → null', ranks.rankByCode.get('000001')?.[251] ?? null, null);
  // 잠금 가드: toDate 이하만 캘린더에 포함
  const cut = buildRsRanks(ds, dates[100]);
  check('toDate 상한 준수(캘린더)', cut.calendar[cut.calendar.length - 1], dates[100]);
  check('toDate 이후 랭킹 없음', cut.daysRanked, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. detectRsEntries — 진입 · 에피소드 종료(20일 연속) · 종료 전 재진입 금지');
{
  // (a) 진입 → 20일 연속 미만90 → 종료 → 재진입
  const r1: number[] = [];
  r1.push(85); // t=0
  r1.push(92); // t=1  ← 진입 #1
  r1.push(95); // t=2
  for (let k = 0; k < 20; k++) r1.push(50); // t=3..22 (20 랭크일 연속 <90 → t=22에 종료)
  r1.push(95); // t=23 ← 진입 #2(직전 t=22 rank 50<90)
  const b1 = makeBars('A', new Array(r1.length).fill(100));
  const e1 = detectRsEntries(b1, r1);
  check('(a) 진입 2건', e1.entries.length, 2);
  check('(a) 진입 #1 bar=1', e1.entries[0]?.bar, 1);
  check('(a) 진입 #2 bar=23', e1.entries[1]?.bar, 23);
  check('(a) rankList 길이', e1.rankList.length, r1.length);

  // (b) 에피소드 중 19일만 하회 후 복귀 → 재진입 이벤트 생성 금지
  const r2: number[] = [85, 92];
  for (let k = 0; k < 19; k++) r2.push(50); // 19일(<20) → 에피소드 유지
  r2.push(95); // 복귀했지만 진행 중 에피소드라 진입 아님
  const b2 = makeBars('B', new Array(r2.length).fill(100));
  const e2 = detectRsEntries(b2, r2);
  check('(b) 진입 1건(재진입 금지)', e2.entries.length, 1);
  check('(b) 진입 bar=1', e2.entries[0]?.bar, 1);

  // (c) 첫 랭크일이 이미 ≥90이면 진입 아님(직전 랭크일 없음)
  const r3 = [95, 96, 97];
  check('(c) 첫날 ≥90은 진입 아님', detectRsEntries(makeBars('C', [100, 100, 100]), r3).entries.length, 0);

  // (d) 부적격일(null)은 랭크일에서 제외 — "직전 랭크일" 기준으로 판정
  const r4: (number | null)[] = [85, null, null, 92];
  const e4 = detectRsEntries(makeBars('D', [100, 100, 100, 100]), r4);
  check('(d) rankList는 2개', e4.rankList.length, 2);
  check('(d) 진입 bar=3', e4.entries[0]?.bar, 3);

  // (e) 경계: 정확히 90이면 진입(>= 90)
  check('(e) rank 90 = 진입', detectRsEntries(makeBars('E', [100, 100]), [89.999, 90]).entries.length, 1);
  check('(e) rank 89.999 = 미진입', detectRsEntries(makeBars('F', [100, 100]), [80, 89.999]).entries.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. computeRs50ToRs90 (Q4) — 에피소드 상태기계(감사 수정 회귀 가드)');
{
  // (a) 표준: <50 20일 연속(t=0..19) → t=20 시작 → t=30 진입. days = 30-20 = 10
  const a: number[] = [];
  for (let k = 0; k < 20; k++) a.push(30);
  for (let k = 20; k <= 30; k++) a.push(k === 30 ? 95 : 60);
  const ra = computeRs50ToRs90(makeRankList(a), 30);
  check('(a) days=10', ra.days, 10);
  check('(a) 미검열', ra.censored, false);

  // (b) 중간에 3일 하회 — 에피소드는 끊기지 않아야 한다(초판 버그: days=2로 계산)
  const b: number[] = [];
  for (let k = 0; k < 20; k++) b.push(30); // t=0..19  <50
  for (let k = 0; k < 5; k++) b.push(60); // t=20..24 ≥50 (시작 t=20)
  for (let k = 0; k < 3; k++) b.push(40); // t=25..27 <50 (3일 → 종료 아님)
  b.push(60); // t=28
  b.push(60); // t=29
  b.push(95); // t=30 진입
  const rb = computeRs50ToRs90(makeRankList(b), 30);
  check('(b) 일시 하회는 에피소드 유지 → days=10', rb.days, 10);
  check('(b) 미검열', rb.censored, false);

  // (c) 20일 연속 하회 후 새 에피소드 → 시작이 갱신된다
  const c: number[] = [];
  for (let k = 0; k < 20; k++) c.push(30); // t=0..19
  for (let k = 0; k < 5; k++) c.push(60); // t=20..24 (에피소드 #1 시작)
  for (let k = 0; k < 20; k++) c.push(40); // t=25..44 (20일 연속 → 종료)
  c.push(60); // t=45 에피소드 #2 시작
  c.push(70); // t=46
  c.push(95); // t=47 진입
  const rc = computeRs50ToRs90(makeRankList(c), 47);
  check('(c) 새 에피소드 기준 days=2', rc.days, 2);
  check('(c) 미검열', rc.censored, false);

  // (d) 시작점 미확인(처음부터 계속 ≥50) → 504+ 검열
  const d = new Array<number>(40).fill(60);
  d[39] = 95;
  const rd = computeRs50ToRs90(makeRankList(d), 39);
  check('(d) 검열', rd.censored, true);
  check('(d) days=504로 캡', rd.days, RS_CONST.rs50LookbackDays);

  // (e) 시작점은 있으나 504거래일 초과 → 검열 + 504 캡
  //     bar 인덱스를 벌려 (진입 bar − 시작 bar) = 600 이 되게 한다.
  const eRanks: number[] = [];
  for (let k = 0; k < 20; k++) eRanks.push(30);
  eRanks.push(60); // t=20 시작
  eRanks.push(95); // t=21 진입
  const eList: RankDay[] = eRanks.map((r, t) => ({
    bar: t < 21 ? t : t === 21 ? 620 : t,
    date: `2010-01-01`,
    rank: r,
  }));
  const re = computeRs50ToRs90(eList, 21);
  check('(e) 600거래일 → 검열', re.censored, true);
  check('(e) days 504 캡', re.days, 504);

  // (f) 경계: 정확히 20일 하회면 자격, 19일이면 자격 없음
  const f19: number[] = [];
  for (let k = 0; k < 19; k++) f19.push(30);
  f19.push(60);
  f19.push(95);
  check('(f) 19일 하회 → 시작점 미확인(검열)', computeRs50ToRs90(makeRankList(f19), 20).censored, true);
  check('(f) rank 50 정확히는 "하회 아님"', RS_CONST.rs50Threshold, 50);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. countBoomBustCycles (Q9/H5) — 비미래참조 상태기계 손계산 골든');
{
  // [100, 90, 200, 250, 100, 80, 300, 400, 150, 100]
  //  BOOM(runLow 100→90) → 200 ≥ 90×1.5=135 → BUST(runHigh 200→250)
  //  → 100 ≤ 250×0.7=175 → 사이클1, BOOM(runLow 100→80)
  //  → 300 ≥ 80×1.5=120 → BUST(runHigh 300→400) → 150 ≤ 400×0.7=280 → 사이클2
  check('사이클 2개', countBoomBustCycles([100, 90, 200, 250, 100, 80, 300, 400, 150, 100]), 2);
  check('단조 상승 = 0', countBoomBustCycles([100, 110, 120, 130]), 0);
  check('상승만(하락 미완) = 0', countBoomBustCycles([100, 200, 190]), 0);
  check('하락만(상승 없음) = 0', countBoomBustCycles([100, 90, 50, 10]), 0);
  check('빈 배열 = 0', countBoomBustCycles([]), 0);
  // 러닝 저점 갱신 후에야 +50% 판정: [100, 50, 80] → 80 < 50×1.5=75? 80 ≥ 75 → BUST 진입(사이클 0)
  check('러닝저점 갱신 반영', countBoomBustCycles([100, 50, 80]), 0);
  // 3사이클
  check(
    '사이클 3개',
    countBoomBustCycles([100, 200, 100, 300, 100, 400, 100]),
    3
  );
  check('배수 상수 확인', `${RS_CONST.boomUpMultiple}|${RS_CONST.bustDownMultiple}`, '1.5|0.7');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. firstPostEntryRunup (H1/H2) — 진입 전 가격 혼입 금지 + 임계 경계');
{
  const n = 30;
  const c = new Array<number>(n).fill(100);
  c[9] = 50; // 진입 전 저가 — 창에 섞이면 j=14에서 오탐이 난다
  c[15] = 120; // 120/100 = 1.20 → +20% 정확 경계
  check('첫 완전창 = entryBar+window(=15)', firstPostEntryRunup(c, 10, 5, 0.2), 15);

  const c2 = new Array<number>(n).fill(100);
  c2[15] = 119.99;
  check('경계 미달(+19.99%) → 이후 없음 = null', firstPostEntryRunup(c2, 10, 5, 0.2), null);

  const c3 = new Array<number>(n).fill(100);
  c3[14] = 500; // 진입 후이지만 완전한 5일 창이 아직 아님(j=14 < 10+5)
  check('불완전 창은 무시', firstPostEntryRunup(c3, 10, 5, 0.2), null);

  const c4 = new Array<number>(n).fill(100);
  c4[25] = 130;
  check('21일 창(H2) 첫 도달', firstPostEntryRunup(c4, 4, 21, 0.2), 25);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. firstRs97AfterEntry (A11/H6) — 21거래일 창 · 경계 포함');
{
  // 진입 랭크일 t=0(bar 100). 창 상한 bar = 100+21 = 121
  const mk = (pairs: [number, number][]): RankDay[] =>
    pairs.map(([bar, rank]) => ({ bar, date: '2010-01-01', rank }));
  check(
    'bar 121(경계) 도달 → 121',
    firstRs97AfterEntry(mk([[100, 92], [110, 96.9], [121, 97]]), 0),
    121
  );
  check('bar 122(창 밖) → null', firstRs97AfterEntry(mk([[100, 92], [122, 99]]), 0), null);
  check('96.9는 미달', firstRs97AfterEntry(mk([[100, 92], [110, 96.9]]), 0), null);
  check('진입일 자신은 제외', firstRs97AfterEntry(mk([[100, 99]]), 0), null);
  check('H6 임계/창 상수', `${RS_CONST.rs97Threshold}|${RS_CONST.h6WindowDays}`, '97|21');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. firstRsBelow50AfterEntry (A12/H7) — 50 미만 첫 하회일');
{
  const mk = (pairs: [number, number][]): RankDay[] =>
    pairs.map(([bar, rank]) => ({ bar, date: '2010-01-01', rank }));
  check(
    '49.9에서 발화',
    firstRsBelow50AfterEntry(mk([[10, 92], [20, 60], [30, 50], [40, 49.9]]), 0),
    40
  );
  check('정확히 50은 하회 아님', firstRsBelow50AfterEntry(mk([[10, 92], [20, 50]]), 0), null);
  check('미하회 → null', firstRsBelow50AfterEntry(mk([[10, 92], [20, 80]]), 0), null);
  check('창 제한 없음(먼 미래도 포착)', firstRsBelow50AfterEntry(mk([[10, 92], [900, 10]]), 0), 900);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. firstRs5070StallAfterEntry (A13/H8) — 50~70 연속 50랭크일');
{
  const build = (ranks: number[]): RankDay[] =>
    ranks.map((r, t) => ({ bar: t, date: '2010-01-01', rank: r }));
  // t=0 진입(92). t=1..49 밴드(49일) → t=50에서 이탈(75) → 리셋 → t=51..100 밴드(50일) → t=100 발화
  const r: number[] = [92];
  for (let k = 1; k <= 49; k++) r.push(60);
  r.push(75); // 이탈 → 리셋
  for (let k = 51; k <= 100; k++) r.push(60);
  check('49일 후 리셋 → 50일째(bar 100) 발화', firstRs5070StallAfterEntry(build(r), 0), 100);

  // 정확히 50일 연속이면 마지막 날 발화
  const r2: number[] = [92];
  for (let k = 1; k <= 50; k++) r2.push(65);
  check('연속 50일 → bar 50', firstRs5070StallAfterEntry(build(r2), 0), 50);

  // 49일이면 미발화
  const r3: number[] = [92];
  for (let k = 1; k <= 49; k++) r3.push(65);
  check('연속 49일 → null', firstRs5070StallAfterEntry(build(r3), 0), null);

  // 밴드 경계: 50은 포함, 70은 제외
  const r4: number[] = [92];
  for (let k = 1; k <= 50; k++) r4.push(50);
  check('rank 50(하단 포함) → 발화', firstRs5070StallAfterEntry(build(r4), 0), 50);
  const r5: number[] = [92];
  for (let k = 1; k <= 50; k++) r5.push(70);
  check('rank 70(상단 제외) → null', firstRs5070StallAfterEntry(build(r5), 0), null);
  check('A13 상수', `${RS_CONST.rs70Threshold}|${RS_CONST.rs5070StallDays}`, '70|50');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('12. computeQFeatures — 완전 정적(조용한) 종목 절대 골든');
{
  const n = 300;
  const dates = makeDates(n);
  const bars = makeBars('000010', new Array<number>(n).fill(100), { dates });
  const pit: PitUniverse = new Map();
  for (const d of dates) {
    const eff = d.slice(0, 7);
    if (!pit.has(eff)) pit.set(eff, new Map());
    pit.get(eff)?.set('000010', { percentile: 42, large: false });
  }
  const ds: LectureDataset = {
    bars: new Map([['000010', bars]]),
    pit,
    investableUnion: new Set(['000010']),
    corpActionDates: new Set<string>(),
    unresolvedCodes: new Set<string>(),
    manifestPrelock: 'TEST',
  };
  // Q4용 rankList: <50 20일 → 시작 → 진입(bar 260)
  const rl: RankDay[] = [];
  for (let k = 0; k < 20; k++) rl.push({ bar: 230 + k, date: dates[230 + k], rank: 30 });
  for (let k = 0; k < 10; k++) rl.push({ bar: 250 + k, date: dates[250 + k], rank: 60 });
  rl.push({ bar: 260, date: dates[260], rank: 95 });
  const q = computeQFeatures(bars, 260, rl, rl.length - 1, ds, ds.corpActionDates);
  checkClose('Q1 21일 수익률 = 0', q.q1, 0, 1e-12);
  checkClose('Q2 63일 최대 일간수익 = 0', q.q2, 0, 1e-12);
  check('Q3 상한가 횟수 = 0', q.q3, 0);
  check('Q4 = 10거래일(bar 260-250)', q.q4, 10);
  check('Q4 미검열', q.q4Censored, false);
  checkClose('Q5 PIT 시총 백분위 = 42', q.q5, 42, 1e-12);
  checkClose('Q6 거래량 과다 = 1.0배', q.q6, 1, 1e-12);
  checkClose('Q7 실현변동성 = 0', q.q7, 0, 1e-12);
  check('Q8 윗꼬리 = 0', q.q8, 0);
  check('Q9 붐버스트 = 0', q.q9, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('13. computeQFeatures — 요란한 종목(Q2·Q3·Q8) 절대 골든');
{
  const n = 300;
  const dates = makeDates(n);
  const close = new Array<number>(n).fill(100);
  const high = new Array<number>(n).fill(100);
  // Q8: 최근 60일 [201,260] 중 3일 윗꼬리 (110-100)/110 = 9.09% ≥ 5%
  for (const j of [210, 211, 212]) high[j] = 110;
  // Q3: bar 220 상한가 — 종가 120(전일 100 → +20% ≥ 14.5%) 이고 종가==고가
  close[220] = 120;
  high[220] = 120;
  // Q2: bar 250 일간 +30%(최댓값). 종가≠고가로 두어 상한가로 잡히지 않게 한다.
  close[250] = 130;
  high[250] = 135;
  const bars = makeBars('000011', close, { dates, adjHigh: high });
  const pit: PitUniverse = new Map();
  for (const d of dates) {
    const eff = d.slice(0, 7);
    if (!pit.has(eff)) pit.set(eff, new Map());
    pit.get(eff)?.set('000011', { percentile: 80, large: true });
  }
  const ds: LectureDataset = {
    bars: new Map([['000011', bars]]),
    pit,
    investableUnion: new Set(['000011']),
    corpActionDates: new Set<string>(),
    unresolvedCodes: new Set<string>(),
    manifestPrelock: 'TEST',
  };
  const rl: RankDay[] = [{ bar: 260, date: dates[260], rank: 95 }];
  const q = computeQFeatures(bars, 260, rl, 0, ds, ds.corpActionDates);
  checkClose('Q2 = +30%', q.q2, 0.3, 1e-9);
  check('Q3 상한가 1회', q.q3, 1);
  check('Q8 윗꼬리 3일', q.q8, 3);
  check('Q4 시작점 미확인 → 검열', q.q4Censored, true);
  // 기업행위일이면 상한가 판정 제외(§7.1)
  const ds2: LectureDataset = { ...ds, corpActionDates: new Set([`000011|${dates[220]}`]) };
  check('기업행위일 상한가 제외 → 0회', computeQFeatures(bars, 260, rl, 0, ds2, ds2.corpActionDates).q3, 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('14. computeHWarnings — 5경고 동시 산출');
{
  const n = 200;
  const close = new Array<number>(n).fill(100);
  close[25] = 130; // 진입(bar 20) 후 5일 창 첫 후보 j=25 → +30% (H1)
  close[45] = 130; // 21일 창 첫 후보는 j=41이며, j=45에서 base=close[24]=100 대비 +30% (H2)
  const bars = makeBars('000012', close);
  const rl: RankDay[] = [
    { bar: 20, date: bars.dates[20], rank: 92 },
    { bar: 30, date: bars.dates[30], rank: 98 }, // 21일 창(≤41) 내 RS97
    { bar: 60, date: bars.dates[60], rank: 40 }, // RS<50
  ];
  const w = computeHWarnings(bars, { code: '000012', bar: 20, date: bars.dates[20], rankDayIdx: 0 }, rl);
  check('H1(5일 급등) bar=25', w.h1, 25);
  check('H2(21일 급등) bar=45 — j=41(완전창 시작)엔 미도달', w.h2, 45);
  // H1의 급등(bar 25)이 H2 창(첫 후보 j=41)에 소급 적용되지 않음을 확인
  const closeOnlyH1 = new Array<number>(n).fill(100);
  closeOnlyH1[25] = 130;
  check(
    'H2는 5일 급등만으로 발화하지 않음',
    firstPostEntryRunup(closeOnlyH1, 20, 21, 0.2),
    null
  );
  check('H6(RS97) bar=30', w.h6, 30);
  check('H7(RS<50) bar=60', w.h7, 60);
  check('H8(정체) 미발생', w.h8, null);

  // 252거래일 관측창(감사 수정): 창 밖 사건은 경고로 등록하지 않는다.
  check('관측창 상수 = 252', RS_CONST.hWindowDays, 252);
  const long = new Array<number>(400).fill(100);
  long[272] = 200; // 진입 bar 20 + 252 = 272 → 경계 포함
  const barsIn = makeBars('000013', long);
  const wIn = computeHWarnings(barsIn, { code: '000013', bar: 20, date: barsIn.dates[20], rankDayIdx: 0 }, [
    { bar: 20, date: barsIn.dates[20], rank: 92 },
  ]);
  check('창 경계(bar 272) 포함', wIn.h1, 272);

  const long2 = new Array<number>(400).fill(100);
  long2[273] = 200; // 창 밖(273 > 272)
  const barsOut = makeBars('000014', long2);
  const wOut = computeHWarnings(barsOut, { code: '000014', bar: 20, date: barsOut.dates[20], rankDayIdx: 0 }, [
    { bar: 20, date: barsOut.dates[20], rank: 92 },
  ]);
  check('창 밖(bar 273) 배제', wOut.h1, null);

  // H7도 창 제한을 받는다(초판은 데이터 끝까지 탐색해 잠금표본 날짜까지 경고를 냈다)
  const rlFar: RankDay[] = [
    { bar: 20, date: barsOut.dates[20], rank: 92 },
    { bar: 300, date: barsOut.dates[300], rank: 10 },
  ];
  const wFar = computeHWarnings(barsOut, { code: '000014', bar: 20, date: barsOut.dates[20], rankDayIdx: 0 }, rlFar);
  check('H7 창 밖(bar 300) 배제', wFar.h7, null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('15. 사전등록 구조 불변식 — 축 12개 · 특성 9개 · 경고 5개 · 방향');
{
  check('Q 특성 9개', Q_CODES.length, 9);
  check('Q4 방향 HIGH(길수록 우수)', Q_DIRECTION.Q4, 'HIGH');
  check('Q5 방향 HIGH(대형주 우수)', Q_DIRECTION.Q5, 'HIGH');
  check(
    'Q1·Q2·Q3·Q6·Q7·Q8·Q9 방향 LOW',
    (['Q1', 'Q2', 'Q3', 'Q6', 'Q7', 'Q8', 'Q9'] as const).every((c) => Q_DIRECTION[c] === 'LOW'),
    true
  );
  check('H 경고 5개', H_CODES.length, 5);
  check('H1/H2 = 사후급등 패밀리', `${H_FAMILY.H1}|${H_FAMILY.H2}`, 'POST_ENTRY_RUNUP|POST_ENTRY_RUNUP');
  check(
    'H6/H7/H8 = RS열화 패밀리',
    `${H_FAMILY.H6}|${H_FAMILY.H7}|${H_FAMILY.H8}`,
    'RS_DETERIORATION|RS_DETERIORATION|RS_DETERIORATION'
  );
  check('H8만 NEUTRAL 방향', H_DIRECTION.H8, 'NEUTRAL');

  // §5.6 축 12개 — quality.factorDecomposition이 pipeline 축 배열과 일치해야 한다
  check('필수 팩터 축 12개', FACTOR_DECOMP_AXES.length, 12);
  const dummy: FactorPanelLabels = {
    market: 'KOSPI',
    size: 'LARGE',
    liquidityTertile: 'High',
    volumeMultiple: '1-2x',
    ret5Tertile: 'Mid',
    ret21Tertile: 'Mid',
    ret63Tertile: 'High',
    dailyReturn: '-5~5%',
    dailyAbsShock: '<3%',
    vol20Tertile: 'Low',
    vol63Tertile: 'Low',
    regime: 'NORMAL',
  };
  const dec = factorDecomposition([{ factors: dummy, excess: 0.1 }]);
  check('분해표 축 12개', dec.length, 12);
  check('축 순서 일치', dec.map((d) => d.axis).join(','), FACTOR_DECOMP_AXES.join(','));
  check('ret5Tertile 축 존재(P0 재발 방지)', dec.some((d) => d.axis === 'ret5Tertile'), true);
  check('vol20Tertile 축 존재(P0 재발 방지)', dec.some((d) => d.axis === 'vol20Tertile'), true);
  check('50건 미만 구간은 INCONCLUSIVE', dec[0].groups[0].inconclusive, true);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
