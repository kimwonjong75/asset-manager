// tests/usRoughCheckParity.ts
// ---------------------------------------------------------------------------
// 미국 약식 사전점검(`scripts/backtest/usRoughCheck/`) 골든 테스트.
//
// 이 스위트의 목적은 "돌아간다"가 아니라 **엔진 정의를 절대값으로 못박는 것**이다
// (RULES.md §13 교훈: 경로A-vs-경로B 비교는 공통함수 추출 후 자기참조 항등식이 된다).
//   §1 RS 산식 — 손계산 골든 절대값
//   §2 횡단면 백분위 — 순위·동률 결정론
//   §3 RS90 진입/에피소드 — 20일 경계 정확성
//   §4 E1/E2 이벤트 경계
//   §5 룩어헤드 금지 — 직전평균 당일 제외 · 이동평균 당일 포함 · 미래 변경 무영향
//   §6 전방수익·구간 라벨·통계 결정론
//
// 실행: npx tsx tests/usRoughCheckParity.ts   (package.json 미등록 — 수동 실행)

// ---------------------------------------------------------------------------

import {
  assignPercentiles,
  buildE2Episode,
  computeRsRaw,
  detectUsRsEntries,
  firstRsBelow50AfterEntry,
  firstStrictStallAfterEntry,
  priorMean,
  rollingPriorMean,
  returnK,
  smaInclusive,
  US_RS,
  volumeExcess60,
  volumeMultipleAt,
  type RankDay,
} from '../scripts/backtest/usRoughCheck/rsUs';
import {
  buildRegimePanel,
  forwardExcess,
  forwardReturn,
  makeIndexLookup,
  periodOf,
  priceBucket,
  tertileSplit,
  volumeBucket,
} from '../scripts/backtest/usRoughCheck/analysis';
import {
  bootstrapTwoGroupDiff,
  median,
  summarize,
  type GroupEvent,
} from '../scripts/backtest/usRoughCheck/stats';
import { isPlausibleSymbol, parseConstituents, toYahooSymbol } from '../scripts/backtest/usRoughCheck/universe';
import { reconstruct } from '../scripts/backtest/usRoughCheck/usFetch';
import type { UsBars } from '../scripts/backtest/usRoughCheck/usFetch';

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.error(`  ✗ ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function close(actual: number | null, expected: number, tol: number, label: string): void {
  if (actual !== null && Math.abs(actual - expected) <= tol) passed++;
  else {
    failed++;
    console.error(`  ✗ ${label}: expected ${expected} ±${tol}, got ${String(actual)}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ===========================================================================
// §1. RS 산식 — 손계산 골든
// ===========================================================================
section('§1 RS 산식 골든(손계산 절대값)');
{
  // 길이 253(인덱스 0..252). i=252에서 평가.
  // base 인덱스: R21 → 231, R63 → 189, R126 → 126, R252 → 0
  const n = 253;
  const p: number[] = new Array(n).fill(100);
  p[0] = 50;    // R252 base
  p[126] = 80;  // R126 base
  p[189] = 96;  // R63  base
  p[231] = 120; // R21  base
  p[252] = 120; // 평가일 종가

  // R21  = 120/120 - 1 = 0
  // R63  = 120/96  - 1 = 0.25
  // R126 = 120/80  - 1 = 0.5
  // R252 = 120/50  - 1 = 1.4
  // rsRaw = 0.4*0 + 0.2*0.25 + 0.2*0.5 + 0.2*1.4 = 0 + 0.05 + 0.1 + 0.28 = 0.43
  close(returnK(p, 252, 21), 0, 1e-15, 'R21 = 0');
  close(returnK(p, 252, 63), 0.25, 1e-15, 'R63 = 0.25');
  close(returnK(p, 252, 126), 0.5, 1e-15, 'R126 = 0.5');
  close(returnK(p, 252, 252), 1.4, 1e-15, 'R252 = 1.4');
  close(computeRsRaw(p, 252), 0.43, 1e-12, '골든① rsRaw = 0.43');

  // 골든② R21을 0.2로 (base 100) → 0.4*0.2 = 0.08 추가 → 0.51
  const q = [...p];
  q[231] = 100;
  close(computeRsRaw(q, 252), 0.51, 1e-12, '골든② rsRaw = 0.51');

  // 웜업: i=251 이하는 R252 계산 불가 → null
  eq(computeRsRaw(p, 251), null, 'i=251(252바 미만) → null');
  eq(computeRsRaw(p, 252) === null, false, 'i=252 → 계산 가능');

  // 기준가 0 방어
  const z = [...p];
  z[0] = 0;
  eq(computeRsRaw(z, 252), null, 'base=0 → null');

  // 가중치 합 = 1
  close(
    US_RS.weightR21 + US_RS.weightR63 + US_RS.weightR126 + US_RS.weightR252,
    1,
    1e-15,
    '가중치 합 = 1'
  );
}

// ===========================================================================
// §2. 횡단면 백분위
// ===========================================================================
section('§2 횡단면 백분위 결정론');
{
  const m = assignPercentiles([
    { code: 'AAA', rsRaw: 0.3 },
    { code: 'BBB', rsRaw: 0.1 },
    { code: 'CCC', rsRaw: 0.2 },
  ]);
  close(m.get('BBB') ?? null, 0, 1e-15, '최저 rsRaw → 0');
  close(m.get('CCC') ?? null, 50, 1e-15, '중간 → 50');
  close(m.get('AAA') ?? null, 100, 1e-15, '최고 → 100');

  // 동률은 code 오름차순으로 분리(낮은 code가 낮은 백분위)
  const t = assignPercentiles([
    { code: 'ZZZ', rsRaw: 0.5 },
    { code: 'AAA', rsRaw: 0.5 },
    { code: 'MMM', rsRaw: 0.9 },
  ]);
  close(t.get('AAA') ?? null, 0, 1e-15, '동률 — code 낮은 쪽 0');
  close(t.get('ZZZ') ?? null, 50, 1e-15, '동률 — code 높은 쪽 50');
  close(t.get('MMM') ?? null, 100, 1e-15, '최고 100');

  // 입력 순서 무관(결정론)
  const rev = assignPercentiles([
    { code: 'MMM', rsRaw: 0.9 },
    { code: 'AAA', rsRaw: 0.5 },
    { code: 'ZZZ', rsRaw: 0.5 },
  ]);
  ok(
    rev.get('AAA') === t.get('AAA') && rev.get('ZZZ') === t.get('ZZZ') && rev.get('MMM') === t.get('MMM'),
    '입력 순서 무관'
  );

  // 단일 원소 → 100
  const one = assignPercentiles([{ code: 'X', rsRaw: 0.1 }]);
  close(one.get('X') ?? null, 100, 1e-15, '단일 원소 → 100');

  // 90 임계: 11개 균등 → k=10 이 100, k=9 가 90
  const eleven = assignPercentiles(
    Array.from({ length: 11 }, (_, i) => ({ code: `S${String(i).padStart(2, '0')}`, rsRaw: i }))
  );
  close(eleven.get('S09') ?? null, 90, 1e-12, '11개 중 2등 → 정확히 90');
  ok((eleven.get('S09') ?? 0) >= US_RS.entryThreshold, 'rsRank 90 은 진입 임계 포함(≥)');
  ok((eleven.get('S08') ?? 0) < US_RS.entryThreshold, 'rsRank 80 은 진입 임계 미만');
}

// ===========================================================================
// §3. RS90 진입 / 에피소드 20일 경계
// ===========================================================================
section('§3 RS90 진입·에피소드 경계');
{
  const mkDates = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `2015-01-${String((i % 28) + 1).padStart(2, '0')}`);

  // (a) 첫 랭크일이 이미 ≥90 이면 진입 아님(직전 랭크일이 없으므로)
  {
    const ranks: (number | null)[] = [95, 96, 97];
    const r = detectUsRsEntries('T', mkDates(3), ranks);
    eq(r.entries.length, 0, '(a) 첫 랭크일 ≥90 → 진입 없음');
  }

  // (b) 89.9 → 90.0 은 진입(경계 포함)
  {
    const ranks: (number | null)[] = [89.9, 90.0];
    const r = detectUsRsEntries('T', mkDates(2), ranks);
    eq(r.entries.length, 1, '(b) 89.9→90.0 진입 1건');
    eq(r.entries[0].bar, 1, '(b) 진입 바 = 1');
  }

  // (c) 정확히 20 랭크일 연속 미만 → 에피소드 종료 → 재진입 가능
  {
    const seq = [80, 95, ...new Array(20).fill(50), 95];
    const r = detectUsRsEntries('T', mkDates(seq.length), seq as (number | null)[]);
    eq(r.entries.length, 2, '(c) 20일 연속 미만 후 재진입 → 2건');
    eq(r.entries[1].bar, 22, '(c) 두 번째 진입 바 = 22');
  }

  // (d) 19 랭크일 연속 미만이면 에피소드 유지 → 재진입 금지
  {
    const seq = [80, 95, ...new Array(19).fill(50), 95];
    const r = detectUsRsEntries('T', mkDates(seq.length), seq as (number | null)[]);
    eq(r.entries.length, 1, '(d) 19일 연속 미만 → 재진입 없음(1건)');
  }

  // (e) 중간에 한 번 ≥90 이 끼면 연속 카운트 리셋
  {
    const seq = [80, 95, ...new Array(15).fill(50), 95, ...new Array(15).fill(50), 95];
    const r = detectUsRsEntries('T', mkDates(seq.length), seq as (number | null)[]);
    eq(r.entries.length, 1, '(e) 중간 ≥90 리셋 → 재진입 없음');
  }

  // (f) null(비적격) 바는 랭크일 시퀀스에서 제외되며 "연속" 계산에 끼어들지 않는다
  {
    const seq: (number | null)[] = [80, 95, null, null, 50];
    const r = detectUsRsEntries('T', mkDates(seq.length), seq);
    eq(r.rankList.length, 3, '(f) 랭크일 3개(null 제외)');
    eq(r.rankList[2].bar, 4, '(f) 세 번째 랭크일의 바 인덱스 = 4');
    eq(r.entries.length, 1, '(f) 진입 1건');
  }
}

// ===========================================================================
// §4. E1 / E2 이벤트 경계
// ===========================================================================
section('§4 E1·E2 이벤트 경계');
{
  const mkRankList = (ranks: number[], barStep = 1): RankDay[] =>
    ranks.map((r, i) => ({ bar: i * barStep, date: `2015-06-${String((i % 28) + 1).padStart(2, '0')}`, rank: r }));

  // E1: 진입(t=0) 후 처음 <50 인 랭크일
  {
    const rl = mkRankList([95, 80, 60, 49.9, 30]);
    const w = firstRsBelow50AfterEntry(rl, 0);
    ok(w !== null && w.bar === 3, 'E1 첫 <50 랭크일 = bar 3');
  }
  // E1: 50 정확히는 하회 아님
  {
    const rl = mkRankList([95, 50, 50, 50]);
    eq(firstRsBelow50AfterEntry(rl, 0), null, 'E1 rank=50 은 하회 아님 → null');
  }
  // E1: 252바 창 밖 이벤트는 무시
  {
    const rl = mkRankList([95, 80, 40], 200); // bar 0, 200, 400 → 400 > 0+252
    eq(firstRsBelow50AfterEntry(rl, 0), null, 'E1 창(252바) 밖 → null');
  }

  // E2: 밴드 진입 후 50 랭크일 안에 ≥70 없으면 STALL
  {
    const ranks = [95, 60, ...new Array(60).fill(60)];
    const ep = buildE2Episode(mkRankList(ranks), 0);
    ok(ep !== null, 'E2 에피소드 생성');
    ok(ep !== null && ep.bandEntry.bar === 1, 'E2 밴드 진입 바 = 1');
    ok(ep !== null && ep.evalDay !== null && ep.evalDay.bar === 1 + US_RS.stallDays, 'E2 평가일 = 밴드진입+50 랭크일');
    ok(ep !== null && !ep.recovered, 'E2 미회복 → STALL');
  }
  // E2: 평가창 안에 ≥70 한 번이라도 있으면 RECOVERED
  {
    const ranks = [95, 60, ...new Array(60).fill(60)];
    ranks[25] = 75;
    const ep = buildE2Episode(mkRankList(ranks), 0);
    ok(ep !== null && ep.recovered, 'E2 창 안 ≥70 → RECOVERED');
  }
  // E2: 회복이 평가창 **밖**(51번째 랭크일 이후)이면 STALL로 남는다(룩어헤드 금지)
  {
    const ranks = [95, 60, ...new Array(60).fill(60)];
    ranks[1 + US_RS.stallDays + 1] = 99; // 평가일 다음날 회복
    const ep = buildE2Episode(mkRankList(ranks), 0);
    ok(ep !== null && !ep.recovered, 'E2 평가일 이후 회복은 분류에 반영되지 않음(룩어헤드 금지)');
  }
  // E2: 평가일까지 랭크일이 모자라면 evalDay=null(표본 제외)
  {
    const ranks = [95, 60, 60, 60];
    const ep = buildE2Episode(mkRankList(ranks), 0);
    ok(ep !== null && ep.evalDay === null, 'E2 랭크일 부족 → evalDay null');
  }
  // E2 엄격정의(한국 A13): 연속 체류만 인정 → 중간 이탈 시 리셋
  {
    const ranks = [95, ...new Array(60).fill(60)];
    ranks[30] = 95; // 중간 이탈
    eq(firstStrictStallAfterEntry(mkRankList(ranks), 0), null, 'E2 엄격정의 — 중간 이탈 시 미발화');
  }
  {
    const ranks = [95, ...new Array(60).fill(60)];
    const s = firstStrictStallAfterEntry(mkRankList(ranks), 0);
    ok(s !== null && s.bar === US_RS.stallDays, 'E2 엄격정의 — 연속 50일 채운 첫 바');
  }
}

// ===========================================================================
// §5. 룩어헤드 금지
// ===========================================================================
section('§5 룩어헤드 금지 규약');
{
  // (a) priorMean 은 당일 D 를 제외한다
  const v = [1, 2, 3, 4, 100];
  close(priorMean(v, 4, 2), 3.5, 1e-15, '(a) priorMean(i=4,w=2) = (3+4)/2 — 당일 100 제외');
  close(priorMean(v, 4, 4), 2.5, 1e-15, '(a) priorMean(i=4,w=4) = (1+2+3+4)/4');
  eq(priorMean(v, 1, 2), null, '(a) 창 부족 → null');

  // (b) rollingPriorMean 은 전 바에서 priorMean 과 정확히 일치해야 한다(오프바이원 회귀 방지)
  {
    const series = Array.from({ length: 60 }, (_, i) => (i * 37) % 17 + 1);
    for (const w of [1, 2, 5, 20]) {
      const roll = rollingPriorMean(series, w);
      let allMatch = true;
      for (let i = 0; i < series.length; i++) {
        const direct = priorMean(series, i, w);
        const r = roll[i];
        if (direct === null) {
          if (r !== null) allMatch = false;
        } else if (r === null || Math.abs(r - direct) > 1e-9) allMatch = false;
      }
      ok(allMatch, `(b) rollingPriorMean(w=${w}) == priorMean 전 바 일치`);
    }
  }

  // (c) smaInclusive 는 당일 D 를 **포함**한다(200일선 규약)
  close(smaInclusive([1, 2, 3], 2, 3), 2, 1e-15, '(c) smaInclusive(i=2,p=3) = 2 — 당일 포함');
  eq(smaInclusive([1, 2, 3], 1, 3), null, '(c) 창 부족 → null');

  // (d) 거래량 배수의 기준선도 당일 제외
  {
    const vol = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 50];
    // i=20: 직전 20일 평균 = 10 → 배수 = 50/10 = 5. 당일(50)이 기준선에 섞이면 5보다 작아진다.
    close(volumeMultipleAt(vol, 20), 5, 1e-12, '(d) volumeMultiple = 5 — 당일 값이 기준선에 미포함');
  }

  // (e) volumeExcess60 은 창 안 최댓값이며 기준선은 각 날의 직전 20일
  {
    const vol = new Array(100).fill(10);
    vol[70] = 40; // 배수 4
    // i=99: 창 [40,99] 안에 70 포함 → 최댓값 4
    close(volumeExcess60(vol, 99), 4, 1e-12, '(e) volumeExcess60 = 4');
    // i=99 창 밖(인덱스 30)의 스파이크는 잡히면 안 된다
    const vol2 = new Array(100).fill(10);
    vol2[30] = 90;
    close(volumeExcess60(vol2, 99), 1, 1e-12, '(e) 창 밖 스파이크 미포함 → 1');
  }

  // (f) 레짐 판정은 미래 종가를 쓰지 않는다 — 미래 바를 바꿔도 과거 판정 불변
  {
    const n = 300;
    const dates = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(2015, 0, 1) + i * 86400000);
      return d.toISOString().slice(0, 10);
    });
    const mkBench = (mutateFrom: number, factor: number): UsBars => {
      const adj = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 15) * 12 + i * 0.02);
      for (let i = mutateFrom; i < n; i++) adj[i] *= factor;
      return {
        symbol: '^TEST', source: 'yahoo-v8', dates, adjClose: adj, close: adj,
        volume: new Array(n).fill(1000), amount: adj.map((c) => c * 1000), ok: true,
      };
    };
    const stock: UsBars = {
      symbol: 'S', source: 'yahoo-v8', dates,
      adjClose: Array.from({ length: n }, (_, i) => 50 + i * 0.05),
      close: Array.from({ length: n }, (_, i) => 50 + i * 0.05),
      volume: new Array(n).fill(1000),
      amount: Array.from({ length: n }, (_, i) => (50 + i * 0.05) * 1000),
      ok: true,
    };
    const map = new Map<string, UsBars>([['S', stock]]);
    const a = buildRegimePanel(mkBench(n, 1), map, 'US200_LEVEL', 10);
    const b = buildRegimePanel(mkBench(250, 3), map, 'US200_LEVEL', 10);
    const cut = a.findIndex((d) => d.date === dates[249]);
    let same = cut > 0;
    for (let i = 0; i < cut; i++) if (a[i].risk !== b[i].risk) same = false;
    ok(same, '(f) 미래(250일 이후) 종가 변경이 과거 레짐 판정을 바꾸지 않음');
    ok(a.length > 0 && a[0].date === dates[199], '(f) 첫 레짐일 = 200번째 바(MA200 최소창)');
  }
}

// ===========================================================================
// §6. 전방수익 · 구간 라벨 · 통계 결정론
// ===========================================================================
section('§6 전방수익·라벨·통계');
{
  const dates = ['2015-01-02', '2015-01-05', '2015-01-06', '2015-01-07'];
  const stock: UsBars = {
    symbol: 'S', source: 'yahoo-v8', dates,
    adjClose: [100, 105, 110, 121], close: [100, 105, 110, 121],
    volume: [1, 1, 1, 1], amount: [100, 105, 110, 121], ok: true,
  };
  const index = makeIndexLookup(dates, [1000, 1000, 1000, 1100]);
  // 종목 3일 수익 = 121/100-1 = 0.21, 시장 = 1100/1000-1 = 0.10 → 초과 = 0.11
  close(forwardReturn(stock, 0, 3), 0.21, 1e-12, '전방 절대수익 = 21%');
  close(forwardExcess(stock, 0, 3, index), 0.11, 1e-12, '전방 시장초과 = 11%');
  eq(forwardExcess(stock, 0, 5, index), null, '호라이즌 초과 → null');
  close(index.levelAtOrBefore('2015-01-04'), 1000, 1e-12, '지수 조회는 date 이하 최근 값');
  eq(index.levelAtOrBefore('2014-12-31'), null, '데이터 이전 날짜 → null');

  // 가격 구간 경계(E3의 VIP 정의 = $1~10 포함)
  eq(priceBucket(0.99), '<$1', '가격 <$1');
  eq(priceBucket(1), '$1-10', '가격 $1 포함');
  eq(priceBucket(10), '$1-10', '가격 $10 포함');
  eq(priceBucket(10.01), '$10-20', '가격 $10 초과');
  eq(priceBucket(150), '>$100', '가격 >$100');

  // 거래량 배수 구간(한국 팩터패널 경계와 동일)
  eq(volumeBucket(0.99), '<1x', '배수 <1x');
  eq(volumeBucket(1), '1-2x', '배수 1x');
  eq(volumeBucket(4.99), '2-5x', '배수 2-5x');
  eq(volumeBucket(5), '>=5x', '배수 5x');

  // 표본 구간 라벨(한국 개발/검증 경계와 동일)
  eq(periodOf('2019-12-31'), 'dev', '개발 구간 끝');
  eq(periodOf('2020-01-01'), 'val', '검증 구간 시작');
  eq(periodOf('2023-01-01'), 'other', '잠금 이후는 other');

  // 3분위 분할
  {
    const items = [5, 1, 4, 2, 3, 6];
    const t = tertileSplit(items, (x) => x);
    eq(t.low.join(','), '1,2', '3분위 하위');
    eq(t.mid.join(','), '3,4', '3분위 중간');
    eq(t.high.join(','), '5,6', '3분위 상위');
  }

  // 요약통계
  {
    const s = summarize([-0.1, 0, 0.1, 0.2]);
    eq(s.n, 4, '요약 n');
    close(s.mean, 0.05, 1e-12, '요약 평균');
    close(s.median, 0.05, 1e-12, '요약 중앙값');
    close(s.positiveShare, 0.5, 1e-12, '요약 양(+)비율');
  }
  close(median([3, 1, 2]), 2, 1e-15, '홀수 중앙값');
  close(median([4, 1, 2, 3]), 2.5, 1e-15, '짝수 중앙값');

  // 부트스트랩 결정론(같은 시드 → 같은 결과, Math.random 미사용 보장)
  {
    const evs: GroupEvent[] = Array.from({ length: 120 }, (_, i) => ({
      date: `2016-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      group: i % 2 === 0 ? ('A' as const) : ('B' as const),
      value: ((i * 13) % 21) / 100 - 0.1,
    }));
    const r1 = bootstrapTwoGroupDiff(evs, 20260726, 'mean');
    const r2 = bootstrapTwoGroupDiff(evs, 20260726, 'mean');
    ok(r1.point === r2.point && r1.ciLower === r2.ciLower && r1.ciUpper === r2.ciUpper && r1.pValue === r2.pValue,
      '부트스트랩 시드 재현성(동일 시드 → 바이트 동일)');
    const r3 = bootstrapTwoGroupDiff(evs, 20260727, 'mean');
    ok(r3.ciLower !== r1.ciLower || r3.ciUpper !== r1.ciUpper, '다른 시드 → 다른 CI(시드가 실제로 쓰임)');
    ok(r1.nA === 60 && r1.nB === 60, '그룹 크기 집계');
  }
}

// ===========================================================================
// §7. 유니버스 파싱 · 데이터 재구성
// ===========================================================================
section('§7 유니버스 파싱·데이터 재구성');
{
  eq(toYahooSymbol('BRK.B'), 'BRK-B', '클래스 티커 변환 BRK.B → BRK-B');
  eq(toYahooSymbol(' aapl '), 'AAPL', '공백·소문자 정규화');
  ok(isPlausibleSymbol('BRK-B'), '유효 심볼');
  ok(!isPlausibleSymbol('TOO_LONG_SYMBOL'), '비정상 심볼 거부');

  const html =
    '<table id="constituents"><tbody>' +
    '<tr><th>Symbol</th><th>Security</th></tr>' +
    '<tr><td><a href="#">MMM</a></td><td>3M</td></tr>' +
    '<tr><td><a href="#">BRK.B</a></td><td>Berkshire</td></tr>' +
    '<tr><td>AOS</td><td>A. O. Smith</td></tr>' +
    '</tbody></table><table id="other"><tr><td>ZZZ</td></tr></table>';
  const parsed = parseConstituents(html);
  eq(parsed.join(','), 'MMM,BRK.B,AOS', '구성종목 테이블만 파싱(헤더 제외, 다른 테이블 미포함)');

  // reconstruct: adjclose/close/volume 이 모두 있는 바만 채택
  const raw = {
    timestamp: [1262304000, 1262390400, 1262476800],
    indicators: {
      quote: [{ close: [10, null, 12], volume: [100, 100, 200] }],
      adjclose: [{ adjclose: [9, 9.5, 11] }],
    },
  };
  const bars = reconstruct('T', raw, true);
  eq(bars.dates.length, 2, 'close 결측 바 제외');
  close(bars.adjClose[1], 11, 1e-12, 'adjClose 채택');
  close(bars.amount[1], 2400, 1e-12, '달러거래대금 = close × volume');
  const noAdj = reconstruct('T', {
    timestamp: [1262304000],
    indicators: { quote: [{ close: [10], volume: [5] }], adjclose: [{ adjclose: [null] }] },
  }, true);
  ok(noAdj.ok && Math.abs(noAdj.adjClose[0] - 10) < 1e-12, 'adjclose 전무 시 close 폴백(지수용 경로)');
}

// ===========================================================================
console.log(`\n${'='.repeat(60)}`);
console.log(`통과 ${passed} · 실패 ${failed}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
