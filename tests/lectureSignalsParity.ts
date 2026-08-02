// tests/lectureSignalsParity.ts
// ---------------------------------------------------------------------------
// 강의 신호 하네스(D1/D2) 골든/불변식 테스트(RULES §13). 명시적 절대 골든값을 손계산해
// 못박는다 — 경로A-vs-경로B 자기참조 금지.
//
// 실행: npm run test:lecturesignals
// ---------------------------------------------------------------------------

import {
  dailyReturn,
  isRollingMaxInclusive,
  priorMean,
  realizedVol,
  returnK,
  smaInclusive,
  smaSlopeIsNegative,
  stddevPop,
  volumeMultiple,
} from '../scripts/backtest/lectureSignals/features';
import { testSignalAt, scanSignalEvents } from '../scripts/backtest/lectureSignals/events';
import {
  buildCrossSection,
  dailyAbsShockBin,
  dailyReturnBin,
  factorLabels,
  quantileBin,
  sizeBucket,
  stockFeaturesAt,
  volumeMultipleBin,
} from '../scripts/backtest/lectureSignals/factorPanel';
import { matchControls } from '../scripts/backtest/lectureSignals/matching';
import { FACTOR_DECOMP_AXES, computeOverlap } from '../scripts/backtest/lectureSignals/pipeline';
import type { SecurityBars, AcuteSignalCode } from '../scripts/backtest/lectureSignals/configTypes';
import {
  ACUTE_SIGNAL_CODES,
  S5_VARIANTS,
} from '../scripts/backtest/lectureSignals/configTypes';
import { buildPitUniverse, pitLookup } from '../scripts/backtest/lectureSignals/dataAccess';
import type { MonthlyGroupFlags } from '../types/backtestConditionalChannel';
import { mulberry32 } from '../scripts/backtest/conditionalChannel/statistics';

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = Object.is(actual, expected);
  if (ok) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${String(expected)} 실제=${String(actual)}`);
  }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  const ok = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  if (ok) pass++;
  else {
    fail++;
    console.error(`  x ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`);
  }
}

/** 배열/보조 필드를 채워 SecurityBars를 만든다(테스트 전용). */
function makeBars(
  code: string,
  adjClose: number[],
  opts: Partial<{
    adjOpen: number[];
    adjHigh: number[];
    adjLow: number[];
    adjVolume: number[];
    amount: number[];
    market: string[];
    dates: string[];
    /** 원시(무조정) 종가·거래량 — S5_APP_RUNTIME_RAW 전용. 기본값 없음(미주입 = 판정불가). */
    close: number[];
    volume: number[];
  }> = {}
): SecurityBars {
  const n = adjClose.length;
  const dates = opts.dates ?? adjClose.map((_, i) => `D${String(i).padStart(4, '0')}`);
  const dateIndex = new Map<string, number>();
  dates.forEach((d, i) => dateIndex.set(d, i));
  return {
    code,
    name: code,
    dates,
    adjClose,
    adjOpen: opts.adjOpen ?? [...adjClose],
    adjHigh: opts.adjHigh ?? adjClose.map((c) => c),
    adjLow: opts.adjLow ?? adjClose.map((c) => c),
    adjVolume: opts.adjVolume ?? adjClose.map(() => 100),
    amount: opts.amount ?? adjClose.map(() => 100),
    market: opts.market ?? adjClose.map(() => 'KOSPI'),
    close: opts.close,
    volume: opts.volume,
    dateIndex,
  };
}

const EMPTY = new Set<string>();
console.log('강의 신호 하네스 골든/불변식 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. 이동평균 · 기울기 · 수익률');
{
  const v = [1, 2, 3, 4, 5];
  checkClose('smaInclusive 전체', smaInclusive(v, 4, 5) as number, 3);
  checkClose('smaInclusive 최근3', smaInclusive(v, 4, 3) as number, 4);
  check('smaInclusive 창부족→null', smaInclusive(v, 1, 5), null);

  const up = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  check('SLOPE 상승→false', smaSlopeIsNegative(up, 9, 3, 2), false);
  const down = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  check('SLOPE 하락→true', smaSlopeIsNegative(down, 9, 3, 2), true);
  check('SLOPE 창부족→null', smaSlopeIsNegative(down, 1, 3, 2), null);

  checkClose('returnK 10%', returnK([100, 110], 1, 1) as number, 0.1);
  check('returnK 창부족→null', returnK([100], 0, 1), null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. 직전평균(당일 제외) · 거래량배수 · 실현변동성 · 이동최대');
{
  // priorMean: 당일 D 제외(§15-18). values[i-window..i-1]
  check('priorMean 당일제외', priorMean([0, 10, 10, 10, 999], 4, 3), 10);

  // volumeMultiple: 300 / mean(100×20) = 3
  const vol = [0, ...Array(20).fill(100), 300];
  checkClose('volumeMultiple 3배', volumeMultiple(vol, 21, 20) as number, 3);

  // realizedVol: rets=[0,0.1] → sd_pop=0.05 → ×sqrt(252)
  checkClose(
    'realizedVol sd0.05',
    realizedVol([100, 100, 110, 99], 3, 2) as number,
    0.05 * Math.sqrt(252),
    1e-9
  );
  checkClose('stddevPop [0,0.1]', stddevPop([0, 0.1]), 0.05);

  // isRollingMaxInclusive(당일 포함)
  check('rollMax 당일아님→false', isRollingMaxInclusive([1, 5, 3], 2, 3), false);
  check('rollMax 당일최대→true', isRollingMaxInclusive([1, 5, 3], 1, 2), true);
  check('rollMax 창부족→null', isRollingMaxInclusive([1, 5, 3], 0, 3), null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. S1/S2 급등 신호 경계값(직전/일치/초과)');
{
  const mk = (last: number, k: number) => {
    const arr = Array(k + 1).fill(100);
    arr[k] = last;
    return makeBars('T', arr);
  };
  // S1: 21일 100%↑
  check('S1 일치(=1.00)', testSignalAt('S1_RUNUP_21D_100', mk(200, 21), 21, EMPTY), true);
  check('S1 직전(0.99)', testSignalAt('S1_RUNUP_21D_100', mk(199, 21), 21, EMPTY), false);
  check('S1 초과(1.01)', testSignalAt('S1_RUNUP_21D_100', mk(201, 21), 21, EMPTY), true);
  // S2: 5일 40%↑
  check('S2 일치(=0.40)', testSignalAt('S2_RUNUP_5D_40', mk(140, 5), 5, EMPTY), true);
  check('S2 직전(0.398)', testSignalAt('S2_RUNUP_5D_40', mk(139, 5), 5, EMPTY), false);
  check('S2 초과(0.42)', testSignalAt('S2_RUNUP_5D_40', mk(142, 5), 5, EMPTY), true);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. S3 상한가 — 2015-06-15 전후 임계값 분기 + 기업행위일 제외');
{
  // 전(<2015-06-15): 14.5%, close==high
  const before = makeBars('T', [100, 114.5], {
    adjHigh: [100, 114.5],
    dates: ['2015-06-13', '2015-06-14'],
  });
  check('S3 전 14.5%+종가=고가', testSignalAt('S3_LIMIT_UP', before, 1, EMPTY), true);

  const beforeHighGt = makeBars('T', [100, 114.5], {
    adjHigh: [100, 115],
    dates: ['2015-06-13', '2015-06-14'],
  });
  check('S3 전 종가<고가→false', testSignalAt('S3_LIMIT_UP', beforeHighGt, 1, EMPTY), false);

  const beforeLow = makeBars('T', [100, 114.4], {
    adjHigh: [100, 114.4],
    dates: ['2015-06-13', '2015-06-14'],
  });
  check('S3 전 14.4%→false', testSignalAt('S3_LIMIT_UP', beforeLow, 1, EMPTY), false);

  // 후(>=2015-06-15): 14.5%로는 부족, 29.5% 필요
  const afterLow = makeBars('T', [100, 114.5], {
    adjHigh: [100, 114.5],
    dates: ['2015-06-14', '2015-06-15'],
  });
  check('S3 후 14.5%→false(임계상향)', testSignalAt('S3_LIMIT_UP', afterLow, 1, EMPTY), false);

  const afterHi = makeBars('T', [100, 129.5], {
    adjHigh: [100, 129.5],
    dates: ['2015-06-14', '2015-06-15'],
  });
  check('S3 후 29.5%+종가=고가', testSignalAt('S3_LIMIT_UP', afterHi, 1, EMPTY), true);

  // 기업행위일 제외
  const caSet = new Set<string>(['T|2015-06-14']);
  check('S3 기업행위일 제외', testSignalAt('S3_LIMIT_UP', before, 1, caSet), false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. S4 갭·음봉·거래량 2배');
{
  const base = () => {
    const adjClose = [...Array(21).fill(100), 104];
    const adjOpen = [...Array(21).fill(100), 105];
    const adjVolume = [0, ...Array(20).fill(100), 200];
    const adjHigh = adjClose.map((c, i) => Math.max(c, adjOpen[i]));
    const adjLow = adjClose.map((c, i) => Math.min(c, adjOpen[i]));
    return makeBars('T', adjClose, { adjOpen, adjVolume, adjHigh, adjLow });
  };
  check('S4 갭5%+음봉+2배 일치', testSignalAt('S4_GAP_BEAR_VOLUME', base(), 21, EMPTY), true);

  const b2 = base();
  (b2.adjOpen as number[])[21] = 104.9; // 갭 4.9%
  check('S4 갭4.9%→false', testSignalAt('S4_GAP_BEAR_VOLUME', b2, 21, EMPTY), false);

  const b3 = base();
  (b3.adjClose as number[])[21] = 106; // close>open (양봉)
  check('S4 양봉→false', testSignalAt('S4_GAP_BEAR_VOLUME', b3, 21, EMPTY), false);

  const b4 = base();
  (b4.adjVolume as number[])[21] = 199; // <2배
  check('S4 거래량1.99배→false', testSignalAt('S4_GAP_BEAR_VOLUME', b4, 21, EMPTY), false);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. S5_AMOUNT vs S5_APP_PROXY(원천 amount vs 프록시) + S6');
{
  // 길이 64, i=63. close[62]=100, close[63]=90 → -10%
  const adjClose = [...Array(63).fill(100), 90];
  adjClose[62] = 100;
  // amount: 63일 최대가 당일
  const amountMax = [...Array(63).fill(100), 150];
  const barsA = makeBars('T', adjClose, { amount: amountMax });
  check('S5_AMOUNT -10%+거래대금최대', testSignalAt('S5_AMOUNT', barsA, 63, EMPTY), true);

  const amountNotMax = [...Array(63).fill(100), 99];
  const barsA2 = makeBars('T', adjClose, { amount: amountNotMax });
  check('S5_AMOUNT 거래대금 비최대→false', testSignalAt('S5_AMOUNT', barsA2, 63, EMPTY), false);

  const adjClose9 = [...Array(63).fill(100), 91]; // -9%
  const barsA3 = makeBars('T', adjClose9, { amount: amountMax });
  check('S5_AMOUNT -9%→false', testSignalAt('S5_AMOUNT', barsA3, 63, EMPTY), false);

  // 프록시 vs 원천 발산: amount 비최대(50)지만 proxy(close×vol) 최대
  const adjVolume = [...Array(63).fill(100), 1000];
  const amountLow = [...Array(63).fill(100), 50];
  const barsP = makeBars('T', adjClose, { amount: amountLow, adjVolume });
  check('S5_APP_PROXY 프록시최대→true', testSignalAt('S5_APP_PROXY', barsP, 63, EMPTY), true);
  check('S5_AMOUNT 같은데이터→false(발산 입증)', testSignalAt('S5_AMOUNT', barsP, 63, EMPTY), false);

  // S6: -5% + 거래량 2배
  const c6 = [...Array(21).fill(100), 95];
  const v6 = [0, ...Array(20).fill(100), 200];
  const bars6 = makeBars('T', c6, { adjVolume: v6 });
  check('S6 -5%+2배 일치', testSignalAt('S6_CRASH_5_VOLUME_2X', bars6, 21, EMPTY), true);
  const c6b = [...Array(21).fill(100), 96]; // -4%
  check(
    'S6 -4%→false',
    testSignalAt('S6_CRASH_5_VOLUME_2X', makeBars('T', c6b, { adjVolume: v6 }), 21, EMPTY),
    false
  );
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 이벤트 중복제거(주호라이즌 종료까지 재등록 금지)');
{
  // close[0..20]=100, close[21..]=250 → S1은 i=21..41 연속 true(그 뒤 base=250 → false)
  const adjClose = [...Array(21).fill(100), ...Array(24).fill(250)]; // 길이 45
  const bars = makeBars('T', adjClose);
  const always = () => true;
  const ev63 = scanSignalEvents('S1_RUNUP_21D_100', bars, EMPTY, 63, 0, 44, always);
  check('dedup 63: 1건', ev63.length, 1);
  check('dedup 63: 첫 인덱스21', ev63[0]?.barIndex, 21);

  const ev5 = scanSignalEvents('S1_RUNUP_21D_100', bars, EMPTY, 5, 0, 44, always);
  // 21 → block26 → 27 → block32 → 33 → block38 → 39 → block44 → (41은 <=44 차단)
  check('dedup 5: 4건', ev5.length, 4);
  check('dedup 5: 인덱스열', ev5.map((e) => e.barIndex).join(','), '21,27,33,39');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. 팩터 패널 bin — 1일수익률(부호) ≠ 1일절대충격(부호제거)');
{
  check('sizeBucket 대형(>=80)', sizeBucket(80), 'LARGE');
  check('sizeBucket 소형(<20)', sizeBucket(19.9), 'SMALL');
  check('sizeBucket 중형', sizeBucket(50), 'MID');

  check('volMultBin 2-5x', volumeMultipleBin(3), '2-5x');
  check('volMultBin >=5', volumeMultipleBin(5), '>=5x');

  // -7%: 부호 있는 값 '-10~-5%', 절대충격 '5-10%' — 서로 다른 열
  check('dailyReturnBin(-7%)', dailyReturnBin(-0.07), '-10~-5%');
  check('dailyAbsShockBin(-7%)', dailyAbsShockBin(-0.07), '5-10%');
  const different = dailyReturnBin(-0.07) !== dailyAbsShockBin(-0.07);
  check('1일수익률≠1일절대충격(별도값)', different, true);
  // +7%: 부호 '5~10%', 절대 '5-10%'
  check('dailyReturnBin(+7%)', dailyReturnBin(0.07), '5~10%');
  check('dailyAbsShockBin(+7%)', dailyAbsShockBin(0.07), '5-10%');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. 분위 bin · 매칭 결정론(입력 순서 무관)');
{
  const sorted = [10, 20, 30, 40, 50];
  // 3분위 컷 = p33.3, p66.7. quantileBin은 x>=cut 개수.
  check('quantileBin 최저→0', quantileBin(sorted, 10, 3), 0);
  check('quantileBin 최고→2', quantileBin(sorted, 50, 3), 2);
  check('quantileBin null→-1', quantileBin(sorted, null, 3), -1);

  // 매칭 결정론: 같은 특성 집합을 다른 순서로 넣어도 동일 대조군
  const mkFeat = (code: string, pct: number, ret63: number, vol63: number, amt: number) => ({
    code,
    market: 'KOSPI' as const,
    mktcapPercentile: pct,
    ret5: 0,
    ret21: 0,
    ret63,
    dailyRet: 0,
    vol20: vol63,
    vol63,
    amount20Avg: amt,
    volMultiple: 1,
  });
  const feats = [
    mkFeat('EVENT', 50, 0.1, 0.3, 1e9),
    mkFeat('A0001', 51, 0.11, 0.31, 1.1e9),
    mkFeat('A0002', 52, 0.12, 0.32, 1.2e9),
    mkFeat('A0003', 90, 0.9, 0.9, 9e9),
  ];
  const excl = new Set<string>(['EVENT']);
  const c1 = buildCrossSection('D', feats);
  const c2 = buildCrossSection('D', [...feats].reverse());
  const m1 = matchControls('EVENT', c1, excl);
  const m2 = matchControls('EVENT', c2, excl);
  check('매칭 순서무관 동일', m1.controls.join(',') === m2.controls.join(','), true);
  check('매칭 최근접 우선(A0001)', m1.controls[0], 'A0001');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. mulberry32 시드 고정 재현(바이트 동일)');
{
  const a = mulberry32(20260725);
  checkClose('mulberry32 v0 골든', a(), 0.2109803317580372, 0);
  const b = mulberry32(20260725);
  const c = mulberry32(20260725);
  const seqB = [b(), b(), b(), b(), b()];
  const seqC = [c(), c(), c(), c(), c()];
  check('mulberry32 재실행 동일', seqB.join(',') === seqC.join(','), true);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. stockFeaturesAt — 1일수익률 부호 보존');
{
  const bars = makeBars('T', [100, 90]);
  const f = stockFeaturesAt(bars, 1, 'KOSPI', 42);
  checkClose('dailyRet 부호(-0.1)', f.dailyRet as number, -0.1);
  check('mktcapPercentile 주입', f.mktcapPercentile, 42);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('12. PIT 유니버스 룩어헤드 방지 — effectiveMonth 키(as-of월 아님)');
{
  // 합성 월말 스냅샷:
  //   as-of "2014-01"(1월말) → effectiveMonth "2014-02"(2월부터 적용), AAA 백분위 30·대형 아님
  //   as-of "2014-02"(2월말) → effectiveMonth "2014-03"(3월부터 적용), AAA 백분위 90·대형
  const mkFlag = (
    securityId: string,
    asOf: string,
    effectiveMonth: string,
    percentile: number,
    large: boolean
  ): MonthlyGroupFlags => ({
    securityId,
    market: 'KR',
    asOfMonthEnd: `${asOf}-28`,
    effectiveMonth,
    investable: true,
    marketCap: percentile * 1e9,
    marketCapPercentile: percentile,
    large,
    sectorCode: null,
    sectorRankByMarketCap: null,
    sectorInvestableCount: null,
    leader: false,
    group: 'B',
    unclassifiable: false,
    tieBreakNote: null,
  });
  // ⚠ Map 키는 loadKrSizeDataset 관례대로 as-of월(파일명)
  const monthlyFlags = new Map<string, MonthlyGroupFlags[]>([
    ['2014-01', [mkFlag('AAA', '2014-01', '2014-02', 30, false)]],
    ['2014-02', [mkFlag('AAA', '2014-02', '2014-03', 90, true)]],
  ]);
  const { pit } = buildPitUniverse(monthlyFlags);

  // 2월 10일 조회: as-of "2014-01"(effective 2014-02) 스냅샷이 나와야 함(백분위 30·대형 아님).
  // 버그(as-of 키)라면 as-of "2014-02"(백분위 90·대형)가 잘못 나온다 → 1개월 룩어헤드.
  const feb = pitLookup(pit, 'AAA', '2014-02-10');
  check('2월조회 → 1월말 스냅샷(백분위 30)', feb?.percentile, 30);
  check('2월조회 → 대형 아님(2월말 90 아님)', feb?.large, false);

  // 3월 10일 조회: as-of "2014-02"(effective 2014-03) 스냅샷(백분위 90·대형).
  const mar = pitLookup(pit, 'AAA', '2014-03-10');
  check('3월조회 → 2월말 스냅샷(백분위 90)', mar?.percentile, 90);
  check('3월조회 → 대형', mar?.large, true);

  // 1월 10일 조회: 유효 스냅샷 없음(as-of 2013-12 미존재) → null(당월 as-of 룩어헤드 금지).
  check('1월조회 → null(룩어헤드 금지)', pitLookup(pit, 'AAA', '2014-01-10'), null);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('13. S5_APP_RUNTIME_RAW — 앱 런타임 규약(원시 close×volume) 경계 3종');
{
  // 길이 64, i=63. adjClose[62]=100, adjClose[63]=90 → -10%(세 변형 공통 판정, adj 기준).
  const adjClose = [...Array(63).fill(100), 90];
  // 창은 k=1..63(start = 63-63+1 = 1). 과거 원시 거래대금 = 200×500 = 100,000.
  const rawClosePast = 200;
  const rawVolPast = 500;
  const mkRuntime = (todayClose: number, todayVol: number): SecurityBars =>
    makeBars('T', adjClose, {
      close: [...Array(63).fill(rawClosePast), todayClose],
      volume: [...Array(63).fill(rawVolPast), todayVol],
    });

  // 일치: 오늘 원시 거래대금 = 100,000 (동률도 최대로 인정)
  check(
    'S5_APP_RUNTIME_RAW 일치(=100,000)',
    testSignalAt('S5_APP_RUNTIME_RAW', mkRuntime(100, 1000), 63, EMPTY),
    true
  );
  // 직전: 99,900 < 100,000
  check(
    'S5_APP_RUNTIME_RAW 직전(99,900)',
    testSignalAt('S5_APP_RUNTIME_RAW', mkRuntime(100, 999), 63, EMPTY),
    false
  );
  // 초과: 100,100 > 100,000
  check(
    'S5_APP_RUNTIME_RAW 초과(100,100)',
    testSignalAt('S5_APP_RUNTIME_RAW', mkRuntime(100, 1001), 63, EMPTY),
    true
  );

  // 수익률 판정은 세 변형 모두 adj_close 기준(-9%면 거래대금 최대여도 불발)
  const adj9 = [...Array(63).fill(100), 91];
  const bars9 = makeBars('T', adj9, {
    close: [...Array(63).fill(rawClosePast), 100],
    volume: [...Array(63).fill(rawVolPast), 1000],
  });
  check('S5_APP_RUNTIME_RAW -9%→false(수익률은 adj 기준)', testSignalAt('S5_APP_RUNTIME_RAW', bars9, 63, EMPTY), false);

  // 원시 배열 미주입 → 판정불가(false). 조용한 0건을 만들지 않도록 run.ts가 별도 가드.
  check(
    'S5_APP_RUNTIME_RAW 원시배열 없음→false',
    testSignalAt('S5_APP_RUNTIME_RAW', makeBars('T', adjClose), 63, EMPTY),
    false
  );
  // 창 부족(i < 62) → false
  check(
    'S5_APP_RUNTIME_RAW 창부족→false',
    testSignalAt('S5_APP_RUNTIME_RAW', mkRuntime(100, 1000), 62, EMPTY),
    false
  );
}

// ════════════════════════════════════════════════════════════════════════════
console.log('14. 분할 경계 — 세 변형이 갈리는 합성 케이스');
{
  const adjClose = [...Array(63).fill(100), 90]; // -10%

  // (a) 물리적 1:50 분할일: 원시 가격 1/50, 원시 거래량 ×50.
  //     거래대금(가격×수량)은 분할 불변이므로 RUNTIME 오탐이 **생기지 않는다**.
  //     과거 원시: 5000×100 = 500,000 / 당일 원시: 90×5000 = 450,000
  const splitDay = makeBars('T', adjClose, {
    adjVolume: [...Array(63).fill(5000), 5000], // 조정 거래량(과거도 50배 소급)
    amount: [...Array(63).fill(500_000), 450_000], // 원천 거래대금(무조정)
    close: [...Array(63).fill(5000), 90],
    volume: [...Array(63).fill(100), 5000],
  });
  check('분할일: RUNTIME 오탐 없음(거래대금 불변)', testSignalAt('S5_APP_RUNTIME_RAW', splitDay, 63, EMPTY), false);
  check('분할일: PROXY도 false', testSignalAt('S5_APP_PROXY', splitDay, 63, EMPTY), false);
  check('분할일: AMOUNT도 false', testSignalAt('S5_AMOUNT', splitDay, 63, EMPTY), false);

  // (b) 실제로 세 변형이 갈리는 원인은 분할 자체가 아니라 **adj_volume 정수 절삭**이다.
  //     과거 원시 거래대금 300×1000 = 300,000, 그러나 조정 거래량이 int(1000/af)로 절삭돼
  //     조정 프록시 과거값은 100×2999 = 299,900 으로 과소평가된다.
  //     당일 거래대금 90×3333 = 299,970 → PROXY만 "63일 최대"로 오판.
  const truncation = makeBars('T', adjClose, {
    adjVolume: [...Array(63).fill(2999), 3333],
    amount: [...Array(63).fill(300_000), 299_970],
    close: [...Array(63).fill(300), 90],
    volume: [...Array(63).fill(1000), 3333],
  });
  check('절삭왜곡: PROXY만 발화', testSignalAt('S5_APP_PROXY', truncation, 63, EMPTY), true);
  check('절삭왜곡: RUNTIME 불발', testSignalAt('S5_APP_RUNTIME_RAW', truncation, 63, EMPTY), false);
  check('절삭왜곡: AMOUNT 불발', testSignalAt('S5_AMOUNT', truncation, 63, EMPTY), false);

  // (c) 진짜 거래대금 급증(원시 거래량이 분할 없이 12배) → 세 변형 모두 발화
  const realSpike = makeBars('T', adjClose, {
    adjVolume: [...Array(63).fill(5000), 6000],
    amount: [...Array(63).fill(500_000), 540_000],
    close: [...Array(63).fill(5000), 90],
    volume: [...Array(63).fill(100), 6000],
  });
  check('실질 급증: RUNTIME 발화', testSignalAt('S5_APP_RUNTIME_RAW', realSpike, 63, EMPTY), true);
  check('실질 급증: AMOUNT 발화', testSignalAt('S5_AMOUNT', realSpike, 63, EMPTY), true);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('15. §5.6 분해 축 완비 — 축 배열이 팩터 라벨 키와 1:1');
{
  check('축 개수 12(초판 10 + ret5·vol20)', FACTOR_DECOMP_AXES.length, 12);
  check('ret5Tertile 축 포함', FACTOR_DECOMP_AXES.includes('ret5Tertile'), true);
  check('vol20Tertile 축 포함', FACTOR_DECOMP_AXES.includes('vol20Tertile'), true);

  // 실제 팩터 라벨 객체의 키와 축 배열이 정확히 같아야 한다(누락 재발 방지).
  const feats = [
    {
      code: 'E',
      market: 'KOSPI' as const,
      mktcapPercentile: 50,
      ret5: 0.1,
      ret21: 0.2,
      ret63: 0.3,
      dailyRet: -0.07,
      vol20: 0.4,
      vol63: 0.5,
      amount20Avg: 1e9,
      volMultiple: 3,
    },
  ];
  const cs = buildCrossSection('D', feats);
  const labels = factorLabels(feats[0], cs, false);
  check(
    '축 배열 == FactorPanelLabels 키(순서 포함)',
    Object.keys(labels).join(','),
    FACTOR_DECOMP_AXES.join(',')
  );
  // 실제 라벨 값 골든(누락 축이 'NA'로 조용히 채워지지 않음을 확인)
  check('ret5Tertile 라벨(단일원소 횡단면→High)', labels.ret5Tertile, 'High');
  check('vol20Tertile 라벨(단일원소 횡단면→High)', labels.vol20Tertile, 'High');
  check('dailyReturn 라벨(-7%)', labels.dailyReturn, '-10~-5%');
  check('dailyAbsShock 라벨(-7%)', labels.dailyAbsShock, '5-10%');

  check('급성신호 8종(S5 3변형)', ACUTE_SIGNAL_CODES.length, 8);
  check('S5_APP_RUNTIME_RAW 등록', ACUTE_SIGNAL_CODES.includes('S5_APP_RUNTIME_RAW'), true);
  check('S5 변형 3종', S5_VARIANTS.length, 3);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('16. 신호 일치율 — Jaccard · 재현율 · 정밀도 골든');
{
  const o1 = computeOverlap('A', ['x|1', 'x|2', 'x|3'], 'B', ['x|2', 'x|3', 'x|4']);
  check('교집합 2', o1.intersection, 2);
  check('합집합 4', o1.union, 4);
  checkClose('Jaccard 0.5', o1.jaccard, 0.5);
  checkClose('재현율 2/3', o1.recallOfBvsA, 2 / 3, 1e-12);
  checkClose('정밀도 2/3', o1.precisionOfBvsA, 2 / 3, 1e-12);

  // B가 A의 진부분집합: 재현율 0.5, 정밀도 1.0
  const o2 = computeOverlap('A', ['x|1', 'x|2', 'x|3', 'x|4'], 'B', ['x|2', 'x|3']);
  checkClose('부분집합 Jaccard 0.5', o2.jaccard, 0.5);
  checkClose('부분집합 재현율 0.5', o2.recallOfBvsA, 0.5);
  checkClose('부분집합 정밀도 1.0', o2.precisionOfBvsA, 1);

  // 완전 불일치
  const o3 = computeOverlap('A', ['x|1'], 'B', ['x|9']);
  checkClose('불일치 Jaccard 0', o3.jaccard, 0);
  check('빈 교집합', o3.intersection, 0);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
