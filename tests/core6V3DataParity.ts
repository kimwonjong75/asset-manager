// tests/core6V3DataParity.ts
// 코어 6종 신호 로테이션 V3 — 데이터 모듈(패널·합성·게이트) 오프라인 골든 테스트.
// 네트워크·로컬 원자료 없이 합성 픽스처만 쓴다. 기대값은 손계산/독립 계산으로 고정한 절대값이다(함수 결과끼리 비교하지 않는다).
import { strict as assert } from 'assert';
import {
  buildPanelP,
  buildPanelP5,
  buildPanelWithMeta,
  buildSessionCalendar,
  computeSpliceScale,
  computeSyntheticDays,
  slicePanel,
  validatePanelShape,
} from '../scripts/backtest/core6SignalRotationV3/data/panel';
import type { PanelInput } from '../scripts/backtest/core6SignalRotationV3/data/panel';
import {
  compareReturns,
  dg1Series,
  dg2Compare,
  dg3Series,
  findRuns,
  impossibleOhlc,
  isoWeekKey,
  monthKey,
  periodEndPoints,
  proxyFidelity,
} from '../scripts/backtest/core6SignalRotationV3/data/gates';
import {
  FILL_DATES,
  applyBackendFill,
  applyEventLedger,
  backendImplied,
  compareFactors,
  computeLedgerEvents,
  ledgerFactorAt,
  parseBackendHistory,
  unitCheck,
  withYahooFactors,
} from '../scripts/backtest/core6SignalRotationV3/data/amendment';
import type { BackendImplied, BackendSeries, LedgerEvent } from '../scripts/backtest/core6SignalRotationV3/data/amendment';
import { KNOWN_LEDGER_ERRORS, buildBackendParsed, explainDg2, ratioPoints } from '../scripts/backtest/core6SignalRotationV3/data/amendment2';
import type { KnownLedgerError, RatioPoint } from '../scripts/backtest/core6SignalRotationV3/data/amendment2';
import { adjCloseSeries, localDate, parseYahooAdjusted, rawCloseSeries } from '../scripts/backtest/core6SignalRotationV3/data/yahoo';
import type { YahooParsed } from '../scripts/backtest/core6SignalRotationV3/data/yahoo';
import { ASSET_CODES } from '../scripts/backtest/core6SignalRotationV3/types';
import type { AssetCode } from '../scripts/backtest/core6SignalRotationV3/types';

console.log('core6 V3 data parity');

function near(actual: number | null, expected: number, eps = 1e-9, msg = ''): void {
  assert.ok(actual !== null && Math.abs(actual - expected) <= eps, `${msg} expected ${expected}, got ${actual}`);
}

// ---------------------------------------------------------------------------
// 픽스처: Yahoo chart 응답 흉내
// ---------------------------------------------------------------------------
interface FxBar {
  date: string;
  o?: number | null;
  h?: number | null;
  l?: number | null;
  c?: number | null;
  adj?: number | null;
}

function chart(
  symbol: string,
  tz: string,
  bars: FxBar[],
  dividends: Array<{ date: string; amount: number }> = [],
  hourUtc = 0
): unknown {
  const epoch = (d: string): number => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, dd, hourUtc) / 1000;
  };
  const pick = (f: (b: FxBar) => number | null | undefined): Array<number | null> => bars.map(b => f(b) ?? null);
  const divs: Record<string, { date: number; amount: number }> = {};
  dividends.forEach(d => {
    divs[String(epoch(d.date))] = { date: epoch(d.date), amount: d.amount };
  });
  return {
    chart: {
      result: [
        {
          meta: { symbol, currency: 'KRW', exchangeTimezoneName: tz },
          timestamp: bars.map(b => epoch(b.date)),
          indicators: {
            quote: [{ open: pick(b => b.o), high: pick(b => b.h), low: pick(b => b.l), close: pick(b => b.c), volume: bars.map(() => 1) }],
            adjclose: [{ adjclose: pick(b => b.adj) }],
          },
          events: { dividends: divs },
        },
      ],
    },
  };
}

/** adj를 생략하면 factor 1(adj = close). */
function bar(date: string, o: number, h: number, l: number, c: number, factor = 1): FxBar {
  return { date, o, h, l, c, adj: c * factor };
}
function nullBar(date: string): FxBar {
  return { date, o: null, h: null, l: null, c: null, adj: null };
}

// ---------------------------------------------------------------------------
// (a) 시각 → 현지 날짜 / TR 계수 적용
// ---------------------------------------------------------------------------
{
  assert.equal(localDate(Date.UTC(2024, 5, 2, 23) / 1000, 'Europe/London'), '2024-06-03'); // BST 자정 = 다음 날 표기
  assert.equal(localDate(Date.UTC(2024, 0, 2, 0) / 1000, 'Asia/Seoul'), '2024-01-02'); // 09:00 KST
  assert.equal(localDate(Date.UTC(2024, 0, 2, 14, 30) / 1000, 'America/New_York'), '2024-01-02');

  const parsed = parseYahooAdjusted(chart('X', 'Asia/Seoul', [bar('2024-03-04', 100, 110, 90, 104, 0.5), nullBar('2024-03-05')]));
  const r = parsed.rows[0];
  assert.equal(r.valid, true);
  near(r.factor, 0.5);
  // 조정 O/H/L/C = 원시 × factor (4값에 같은 계수), 종가는 adjclose 그대로
  near(r.open, 50);
  near(r.high, 55);
  near(r.low, 45);
  near(r.close, 52);
  assert.equal(parsed.rows[1].valid, false);
  assert.equal(parsed.rows[1].close, null);
}

// ---------------------------------------------------------------------------
// (b) 픽스처 패널: 달력 규칙 / 이월 / 합성 / 이음새
// ---------------------------------------------------------------------------
// KRX 세션 후보 10일(d0..d9 = 2024-03-04 ~ 03-15). 464470은 d5(03-11)에 상장.
const D = ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08', '2024-03-11', '2024-03-12', '2024-03-13', '2024-03-14', '2024-03-15'];

function krBars(code: AssetCode): FxBar[] {
  const base = Number(code.slice(0, 3)) || 100;
  return D.map((date, i) => {
    const c = base + i;
    const factor = code === '069500' && i <= 3 ? 0.5 : 1; // 069500은 d3까지 계수 0.5(이후 분배락 반영)
    if (code === '464470') {
      if (i < 5) return nullBar(date); // 상장 전: Yahoo 행이 없는 게 실제이나 여기서는 null 행도 "미상장"으로 처리됨을 확인
      if (i === 8) return nullBar(date);
      return bar(date, c - 1, c + 2, c - 2, c, factor);
    }
    if (i === 4) return nullBar(date); // d4: 전 종목 null → 주 달력에서 제외
    if (i === 6 && code === '069500') return nullBar(date); // d6: 069500만 null → 이월
    if (i === 7 && (code === '069500' || code === '379800')) return nullBar(date); // d7: 2종 null이나 과반 유효 → 세션
    if (i === 8 && ['069500', '379800', '283580'].includes(code)) return nullBar(date); // d8: 유효 2/6 → 제외
    return bar(date, c - 1, c + 2, c - 2, c, factor);
  });
}

// 464470은 상장 전 행 자체가 없는 게 현실이므로 d5 이후 행만 준다(null 행 d4는 제거).
const krParsed = {} as Record<AssetCode, YahooParsed>;
for (const code of ASSET_CODES) {
  const bars = code === '464470' ? krBars(code).filter((_, i) => i >= 5) : krBars(code);
  krParsed[code] = parseYahooAdjusted(chart(`${code}.KS`, 'Asia/Seoul', bars));
}
// TLT(미국 휴장: 03-05 없음), KRW=X
const tltBars: FxBar[] = [
  bar('2024-02-29', 89, 91, 88, 89.5),
  bar('2024-03-01', 90, 91, 89, 90),
  bar('2024-03-04', 91, 92, 90, 91),
  // 2024-03-05 휴장
  bar('2024-03-06', 92, 93, 91, 92),
  bar('2024-03-07', 93, 94, 92, 93),
  bar('2024-03-08', 94, 95, 93, 94),
  bar('2024-03-11', 95, 96, 94, 95),
];
const fxBars: FxBar[] = [
  bar('2024-02-29', 1299, 1301, 1298, 1299),
  bar('2024-03-01', 1300, 1301, 1299, 1300),
  bar('2024-03-04', 1310, 1311, 1309, 1310),
  bar('2024-03-05', 1320, 1321, 1319, 1320),
  bar('2024-03-06', 1330, 1331, 1329, 1330),
  bar('2024-03-07', 1340, 1341, 1339, 1340),
  bar('2024-03-08', 1350, 1351, 1349, 1350),
];
const tltParsed = parseYahooAdjusted(chart('TLT', 'America/New_York', tltBars, [], 14));
const fxParsed = parseYahooAdjusted(chart('KRW=X', 'Europe/London', fxBars, [], 0));
const input: PanelInput = { kr: krParsed, tlt: tltParsed, fx: fxParsed };

// 464470 실제 상장일(03-11) 첫 종가는 시가/종가를 일부러 합성 수준과 다르게 둔다.
// krBars(464470)의 d5 종가 = base(464)+5 = 469 이므로 아래 기대값은 c = 469 / P(d5) 로 계산된다.

{
  // 달력 규칙 (주): d4 제외(전 종목 null), d8 제외(유효 2/6), d6·d7은 세션
  const cal = buildSessionCalendar(krParsed, '2024-03-04', '2024-03-15', 'majority-valid');
  assert.deepEqual(cal.dates, [D[0], D[1], D[2], D[3], D[5], D[6], D[7], D[9]]);
  assert.deepEqual(cal.dropped.map(x => x.date), [D[4], D[8]]);
  assert.equal(cal.dropped[0].status['464470'], 'unlisted');
  assert.equal(cal.dropped[0].status['069500'], 'null');
  assert.equal(cal.dropped[1].status['464470'], 'null');
  assert.equal(cal.dropped[0].weekday, 5); // 2024-03-08 금
  // 달력 규칙 (민감도): Yahoo 행이 있으면 세션 — null 행도 포함
  const strict = buildSessionCalendar(krParsed, '2024-03-04', '2024-03-15', 'yahoo-rows');
  assert.deepEqual(strict.dates, D);
  assert.equal(strict.dropped.length, 0);
}

{
  // 합성가: TLT(날짜<D 최근) × KRW(날짜<D 최근)
  const tlt = adjCloseSeries(tltParsed);
  const fx = rawCloseSeries(fxParsed);
  const days = computeSyntheticDays([D[0], D[1], D[2], D[3], D[5]], tlt, fx);
  const prices = days.map(d => d?.price ?? null);
  // d0=03-04: TLT 03-01(90)×FX 03-01(1300); d1=03-05: 91×1310; d2=03-06: TLT 03-05 휴장→03-04(91)×FX 03-05(1320);
  // d3=03-07: 92×1330; d5=03-11: TLT 03-08(94)×FX 03-08(1350)
  assert.deepEqual(prices, [117000, 119210, 120120, 122360, 126900]);
  assert.deepEqual(days.map(d => d?.tltDate), ['2024-03-01', '2024-03-04', '2024-03-04', '2024-03-06', '2024-03-08']);
  assert.deepEqual(days.map(d => d?.fxDate), ['2024-03-01', '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-08']);
  // 미국 휴장(03-05)으로 같은 TLT 봉이 반복되는 d2만 fresh=false
  assert.deepEqual(days.map(d => d?.fresh), [true, true, false, true, true]);

  // 룩어헤드 0: 날짜 >= D 인 입력을 10배로 바꿔도 P_D(와 그 이전 값)는 불변
  const dates = [D[0], D[1], D[2], D[3], D[5]];
  for (let i = 0; i < dates.length; i++) {
    const tampTlt = tlt.map(v => (v.date >= dates[i] ? { ...v, value: v.value * 10 } : v));
    const tampFx = fx.map(v => (v.date >= dates[i] ? { ...v, value: v.value * 10 } : v));
    const alt = computeSyntheticDays(dates, tampTlt, tampFx);
    for (let k = 0; k <= i; k++) assert.equal(alt[k]?.price, prices[k], `lookahead at D=${dates[i]} k=${k}`);
  }
  // 입력이 전혀 없는 첫날은 null
  assert.equal(computeSyntheticDays(['2024-02-01'], tlt.filter(v => v.date > '2024-02-20'), fx)[0], null);

  const splice = computeSpliceScale(D[5], 469, tlt, fx);
  near(splice?.scale ?? null, 469 / 126900, 1e-15);
  assert.equal(splice?.syntheticAtListing, 126900);
}

{
  const built = buildPanelWithMeta(input, { includeSynthetic464470: true, start: '2024-03-04', end: '2024-03-15' });
  const { panel } = built;
  assert.deepEqual(panel.dates, [D[0], D[1], D[2], D[3], D[5], D[6], D[7], D[9]]);
  assert.deepEqual(validatePanelShape(panel), []);

  // 069500: TR 계수 — d0..d3은 ×0.5, d5부터 ×1
  const a = panel.assets['069500']; // base = 69 → c(d0)=69... (Number('069')=69)
  near(a.close[0], 69 * 0.5);
  near(a.open[0], (69 - 1) * 0.5);
  near(a.high[0], (69 + 2) * 0.5);
  near(a.low[0], (69 - 2) * 0.5);
  near(a.close[4], 69 + 5); // d5 (계수 1)
  // 069500은 d6에 null → 달력 인덱스 5(d6)는 d5 값을 이월, fresh=false, source는 actual 유지
  assert.equal(a.fresh[5], false);
  assert.equal(a.close[5], a.close[4]);
  assert.equal(a.open[5], a.open[4]);
  assert.equal(a.source[5], 'actual');
  assert.equal(a.fresh[4], true);
  // d7: 069500·379800 null이나 세션 → 둘 다 이월
  assert.equal(a.fresh[6], false);
  assert.equal(panel.assets['379800'].fresh[6], false);
  assert.equal(panel.assets['283580'].fresh[6], true);

  // 464470: 합성(스케일) + 실제. 골든은 손계산: c = 469/126900, P = {117000, 119210, 120120, 122360}
  const b = panel.assets['464470'];
  assert.deepEqual(b.source, ['synthetic', 'synthetic', 'synthetic', 'synthetic', 'actual', 'actual', 'actual', 'actual']);
  // 손계산: 117000×469/126900 = 432.41134751773..., 119210×469/126900 = 440.579..., 122360×469/126900 = 452.221...
  near(b.close[0], 432.4113475177305, 1e-9);
  near(b.close[1], 440.5791174152876, 1e-9);
  near(b.close[3], 452.2209613869188, 1e-9);
  // 합성 봉은 O=H=L=C
  for (let i = 0; i < 4; i++) {
    assert.equal(b.open[i], b.close[i]);
    assert.equal(b.high[i], b.close[i]);
    assert.equal(b.low[i], b.close[i]);
  }
  assert.deepEqual(b.fresh.slice(0, 4), [true, true, false, true]);
  // 상장일 이후는 실제 봉 그대로(d5 종가 469)
  near(b.close[4], 469);
  assert.equal(b.fresh[4], true);

  // 이음새 수익률 보존: 스케일 합성의 마지막 종가 → 상장일 실제 종가 수익률 = 스케일 전 합성의 P(상장일)/P(직전) - 1
  const seamReturn = (b.close[4] as number) / (b.close[3] as number) - 1;
  near(seamReturn, 126900 / 122360 - 1, 1e-12);
  near(seamReturn, 0.037103628636809383, 1e-12); // 손계산 고정값
  assert.ok(built.synthetic);
  near(built.synthetic!.seam?.actualCloseReturn ?? null, 0.037103628636809383, 1e-12);
  // 합성 구간 내부 수익률도 스케일과 무관하게 보존
  near((b.close[3] as number) / (b.close[2] as number) - 1, 122360 / 120120 - 1, 1e-12);
  assert.equal(built.synthetic!.syntheticSessions, 4);
  assert.equal(built.synthetic!.syntheticFreshSessions, 3);
}

{
  // P5: 464470 전 기간 absent, 가격 null, fresh=false. 나머지 5종과 날짜는 P와 동일
  const p = buildPanelP(input, 'majority-valid');
  const p5 = buildPanelP5(input, 'majority-valid');
  assert.deepEqual(p5.dates, p.dates);
  const b = p5.assets['464470'];
  assert.ok(b.source.every(s => s === 'absent'));
  assert.ok(b.close.every(v => v === null) && b.open.every(v => v === null));
  assert.ok(b.fresh.every(f => f === false));
  assert.deepEqual(validatePanelShape(p5), []);
  for (const code of ASSET_CODES) {
    if (code === '464470') continue;
    assert.deepEqual(p5.assets[code], p.assets[code], `P5 differs from P for ${code}`);
  }
}

{
  // PA: 날짜 범위 슬라이스(양끝 포함), 길이 일관
  const p = buildPanelP(input, 'majority-valid');
  const pa = slicePanel(p, '2024-03-11', '2024-03-15');
  assert.deepEqual(pa.dates, [D[5], D[6], D[7], D[9]]);
  assert.ok(pa.assets['464470'].source.every(s => s === 'actual'));
  assert.deepEqual(validatePanelShape(pa), []);
  assert.deepEqual(slicePanel(p, '2030-01-01', '2030-02-01').dates, []);
}

// ---------------------------------------------------------------------------
// (c) DG1
// ---------------------------------------------------------------------------
{
  const kinds = (b: FxBar): string[] => impossibleOhlc(parseYahooAdjusted(chart('Z', 'Asia/Seoul', [b])).rows).map(x => x.kind);
  assert.deepEqual(kinds(bar('2024-01-02', 100, 110, 90, 100)), []); // 정상
  assert.ok(kinds(bar('2024-01-03', 100, 90, 110, 100)).includes('H<L'));
  assert.deepEqual(kinds(bar('2024-01-04', 120, 110, 90, 100)), ['O>H']);
  assert.deepEqual(kinds(bar('2024-01-05', 80, 110, 90, 100)), ['O<L']);
  assert.deepEqual(kinds(bar('2024-01-08', 100, 110, 90, 120)), ['C>H']);
  assert.deepEqual(kinds(bar('2024-01-09', 100, 110, 90, 80)), ['C<L']);
  // 허용 오차 epsilon = max(1e-10, 가격×1e-12) (가격 110 → 1.1e-10): 1e-13 초과는 정상, 1e-9 초과는 불가능
  assert.deepEqual(kinds(bar('2024-01-10', 100, 110 - 1e-13, 90, 110)), []);
  assert.deepEqual(kinds(bar('2024-01-11', 100, 110 - 1e-9, 90, 110)), ['C>H']);
}

{
  // 결측 비율 / 중복·역순 / 비양수 / 일간 ±20%
  const sessions = ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'];
  const parsed = parseYahooAdjusted(
    chart('Y', 'Asia/Seoul', [
      bar('2024-01-02', 100, 101, 99, 100),
      bar('2024-01-03', 100, 101, 99, 100),
      bar('2024-01-03', 100, 101, 99, 100), // 중복
      bar('2024-01-05', 130, 131, 129, 130), // +30% (직전 유효 01-03 대비)
      bar('2024-01-04', 100, 101, 99, 100), // 역순
      { date: '2024-01-06', o: -1, h: 1, l: -2, c: -1, adj: -1 }, // 비양수(+ valid=false: close<=0)
    ])
  );
  const r = dg1Series({ asset: 'Y', parsed, from: '2024-01-02', to: '2024-01-31', primarySessions: sessions, strictSessions: [...sessions, '2024-01-08'] });
  assert.equal(r.duplicateDates.length, 1);
  assert.equal(r.outOfOrderDates.length, 1);
  assert.ok(r.nonPositive.length >= 1);
  assert.equal(r.primary.missing, 0);
  assert.equal(r.strict.missing, 1); // 01-08은 행이 없다
  near(r.strict.missingRatio, 0.2, 1e-12);
  assert.equal(r.status, 'FAIL');
  assert.ok(r.bigMoves.length >= 1 && r.bigMoves.some(m => m.date === '2024-01-04' || m.date === '2024-01-05'));

  // 결측 1% 이하 + 이상 없음 → PASS
  const clean = parseYahooAdjusted(chart('C', 'Asia/Seoul', sessions.map(d => bar(d, 100, 101, 99, 100))));
  const rc = dg1Series({ asset: 'C', parsed: clean, from: '2024-01-02', to: '2024-01-31', primarySessions: sessions, strictSessions: sessions });
  assert.equal(rc.status, 'PASS');
  assert.equal(rc.primary.missing, 0);
  // 결측 1개/4 = 25% → FAIL
  const holey = parseYahooAdjusted(chart('H', 'Asia/Seoul', [bar(sessions[0], 100, 101, 99, 100), nullBar(sessions[1]), bar(sessions[2], 100, 101, 99, 100), bar(sessions[3], 100, 101, 99, 100)]));
  const rh = dg1Series({ asset: 'H', parsed: holey, from: '2024-01-02', to: '2024-01-31', primarySessions: sessions, strictSessions: sessions });
  near(rh.primary.missingRatio, 0.25, 1e-12);
  assert.equal(rh.status, 'FAIL');
}

// ---------------------------------------------------------------------------
// (d) DG3 — 조정계수 변화점 = 분배 이벤트
// ---------------------------------------------------------------------------
{
  // 종가 100 고정, 분배락일(03-06) 전 계수 0.99, 당일부터 1.0, 분배금 1원(=1%)
  const days = ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07'];
  const mk = (div: Array<{ date: string; amount: number }>, factors: number[]): YahooParsed =>
    parseYahooAdjusted(chart('Q', 'Asia/Seoul', days.map((d, i) => bar(d, 100, 101, 99, 100, factors[i])), div));

  const ok = dg3Series('Q', mk([{ date: '2024-03-06', amount: 1 }], [0.99, 0.99, 1, 1]), '2024-03-04', '2024-03-31');
  assert.equal(ok.status, 'PASS');
  assert.equal(ok.changePoints.length, 1);
  assert.equal(ok.changePoints[0].prevDate, '2024-03-05');
  assert.equal(ok.changePoints[0].date, '2024-03-06');
  near(ok.changePoints[0].impliedYield, 0.01, 1e-12);
  near(ok.maxAmountMismatchBp, 0, 1e-9);

  // 이벤트가 있는데 계수 불변 → FAIL
  const noChange = dg3Series('Q', mk([{ date: '2024-03-06', amount: 1 }], [1, 1, 1, 1]), '2024-03-04', '2024-03-31');
  assert.equal(noChange.status, 'FAIL');
  assert.equal(noChange.eventsWithoutChange.length, 1);

  // 이벤트 없이 계수가 바뀜 → FAIL
  const unexplained = dg3Series('Q', mk([], [0.99, 0.99, 1, 1]), '2024-03-04', '2024-03-31');
  assert.equal(unexplained.status, 'FAIL');
  assert.equal(unexplained.unexplainedChanges.length, 1);

  // 이벤트 일자가 결측 행 위에 있어도(03-06 null) 변화 구간 (03-05, 03-07] 안이면 일치
  const gapBars = [bar('2024-03-04', 100, 101, 99, 100, 0.99), bar('2024-03-05', 100, 101, 99, 100, 0.99), nullBar('2024-03-06'), bar('2024-03-07', 100, 101, 99, 100, 1)];
  const gap = dg3Series('Q', parseYahooAdjusted(chart('Q', 'Asia/Seoul', gapBars, [{ date: '2024-03-06', amount: 1 }])), '2024-03-04', '2024-03-31');
  assert.equal(gap.status, 'PASS');

  // 1e-6 이하 잡음은 변화로 보지 않는다
  const noise = dg3Series('Q', mk([], [1, 1 + 5e-7, 1 + 5e-7, 1]), '2024-03-04', '2024-03-31');
  assert.equal(noise.status, 'PASS');
  assert.ok(noise.maxNoEventRelChange > 0 && noise.maxNoEventRelChange <= 1e-6);
}

// ---------------------------------------------------------------------------
// (e) DG4 보조 / DG2 비교기
// ---------------------------------------------------------------------------
{
  const s = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const miss = new Set(['b', 'c', 'd', 'f']);
  assert.deepEqual(findRuns(s, x => miss.has(x), 3), [{ start: 'b', end: 'd', length: 3 }]);
  assert.deepEqual(findRuns(s, x => miss.has(x), 1).length, 2);
  assert.deepEqual(findRuns(['a', 'b'], () => true, 2), [{ start: 'a', end: 'b', length: 2 }]);
}

{
  const yahoo = parseYahooAdjusted(chart('K', 'Asia/Seoul', [bar('2024-01-02', 100, 101, 99, 100), bar('2024-01-03', 200, 201, 199, 200), bar('2024-01-04', 300, 301, 299, 300), bar('2024-01-05', 400, 401, 399, 400)]));
  // 100.05(0.05% 일치), 200.4(0.2% 불일치), 300, 400
  const cmp = dg2Compare('K', { dates: ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'], close: [100.05, 200.4, 300, 400] }, yahoo, '2024-01-01', '2024-01-31');
  assert.equal(cmp.compared, 4);
  assert.equal(cmp.matched, 3);
  near(cmp.matchRate, 0.75, 1e-12);
  assert.equal(cmp.status, 'FAIL');
  assert.equal(cmp.mismatchCount, 1);
  assert.equal(cmp.mismatches[0].date, '2024-01-03');
  const none = dg2Compare('K', { dates: ['2023-01-02'], close: [1] }, yahoo, '2024-01-01', '2024-01-31');
  assert.equal(none.status, 'UNAVAILABLE'); // 겹치는 날이 없으면 통과가 아니라 확인 불가
  const ok = dg2Compare('K', { dates: ['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'], close: [100, 200.1, 300, 400] }, yahoo, '2024-01-01', '2024-01-31');
  assert.equal(ok.status, 'PASS');
  // 비교 기준: 백엔드가 배당조정 종가를 주는 경우(계수 0.5) — 조정 기준에서는 일치, 원시 기준에서는 불일치
  const yAdj = parseYahooAdjusted(chart('K2', 'Asia/Seoul', [bar('2024-01-02', 100, 101, 99, 100, 0.5), bar('2024-01-03', 200, 201, 199, 200, 0.5)]));
  const appAdj = { dates: ['2024-01-02', '2024-01-03'], close: [50, 100] };
  assert.equal(dg2Compare('K2', appAdj, yAdj, '2024-01-01', '2024-01-31', 'adjusted').status, 'PASS');
  assert.equal(dg2Compare('K2', appAdj, yAdj, '2024-01-01', '2024-01-31', 'raw').status, 'FAIL');
  const partial = dg2Compare('K', { dates: ['2024-01-02'], close: [100] }, yahoo, '2024-01-01', '2024-01-31');
  assert.equal(partial.status, 'PARTIAL'); // 포괄률 25% < 95%
}

// ---------------------------------------------------------------------------
// (f) §10 수익률 비교 — 손계산 골든
// ---------------------------------------------------------------------------
{
  // 독립 계산(파이썬, 표본 분산 n-1)으로 고정한 값
  const a = [0.01, -0.02, 0.03, 0.0, 0.015];
  const p = [0.012, -0.01, 0.02, 0.005, 0.01];
  const monthly = compareReturns('monthly', a, p, 12);
  assert.equal(monthly.observations, 5);
  near(monthly.correlation, 0.9810496631767707, 1e-12);
  near(monthly.beta, 1.6377221324717286, 1e-12);
  near(monthly.alpha, -0.005119143780290792, 1e-12);
  near(monthly.trackingErrorAnnual, 0.027560841786854043, 1e-12);
  near(monthly.directionMatch, 0.8, 1e-12); // 0 vs +0.005는 부호 불일치
  const weekly = compareReturns('weekly', a, p, 52);
  near(weekly.trackingErrorAnnual, 0.057372467264359475, 1e-12);
  assert.equal(compareReturns('daily', [0.1, 0.2], [0.1, 0.2], 252).correlation, null); // 관측 3 미만

  // 완전 비례 수익률(proxy = 2배 수준) → 베타 = 회귀 기울기
  const lin = compareReturns('weekly', [0.02, 0.04, 0.06, 0.08], [0.01, 0.02, 0.03, 0.04], 52);
  near(lin.correlation, 1, 1e-12);
  near(lin.beta, 2, 1e-12);
  near(lin.alpha, 0, 1e-12);
}

{
  // ISO 주/월 키
  assert.equal(isoWeekKey('2024-12-30'), '2025-W01'); // 월요일, 목요일(01-02)이 2025년
  assert.equal(isoWeekKey('2021-01-03'), '2020-W53');
  assert.equal(isoWeekKey('2026-01-01'), '2026-W01');
  assert.equal(isoWeekKey('2024-01-01'), '2024-W01');
  assert.equal(isoWeekKey('2024-01-07'), '2024-W01'); // 일요일은 같은 주
  assert.equal(isoWeekKey('2024-01-08'), '2024-W02');
  assert.equal(monthKey('2024-03-31'), '2024-03');
}

{
  // 주간: 5주(월~금) 중 금요일 종가만 의미 있다. 비금요일은 50으로 채워 무시되는지 확인.
  const sessions: string[] = [];
  for (let d = new Date('2024-01-01T00:00:00Z'); sessions.length < 25; d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) sessions.push(d.toISOString().slice(0, 10));
  }
  const fri = (i: number) => sessions[i].length > 0 && new Date(`${sessions[i]}T00:00:00Z`).getUTCDay() === 5;
  const actualFri = [100, 110, 99, 108.9, 98.01];
  const proxyFri = [100, 105, 105, 110.25, 110.25];
  let w = 0;
  const actual: number[] = [];
  const proxy: number[] = [];
  sessions.forEach((_, i) => {
    if (fri(i)) {
      actual.push(actualFri[w]);
      proxy.push(proxyFri[w]);
      w++;
    } else {
      actual.push(50);
      proxy.push(50);
    }
  });
  const pts = actual.map((v, i) => ({ date: sessions[i], actual: v, proxy: proxy[i] }));
  const ends = periodEndPoints(pts, isoWeekKey);
  assert.equal(ends.length, 5);
  assert.deepEqual(ends.map(e => e.actual), actualFri);
  // 4주 구간 수익률만(첫 4개 금요일): a=[+10%,-10%,+10%], p=[+5%,0,+5%] → 상관 1, 베타 4, 절편 -0.1, TE=sqrt(0.0075*52)
  const first4 = ends.slice(0, 4);
  const st = compareReturns('weekly', [first4[1].actual / first4[0].actual - 1, first4[2].actual / first4[1].actual - 1, first4[3].actual / first4[2].actual - 1],
    [first4[1].proxy / first4[0].proxy - 1, first4[2].proxy / first4[1].proxy - 1, first4[3].proxy / first4[2].proxy - 1], 52);
  near(st.correlation, 1, 1e-12);
  near(st.beta, 4, 1e-12);
  near(st.alpha, -0.1, 1e-12);
  near(st.trackingErrorAnnual, 0.62449979983983983, 1e-12);
  near(st.directionMatch, 2 / 3, 1e-12);
  // 월 키: 1월 마지막 세션(01-31)과 2월 마지막 세션(02-02)
  const m = periodEndPoints(pts, monthKey);
  assert.deepEqual(m.map(x => x.date), ['2024-01-31', '2024-02-02']);
}

{
  // proxyFidelity 판정: 합성 = 실제(동일 수익률, 수준만 2배) → 모든 기준 통과; 무관한 계열 → 실패
  const sessions: string[] = [];
  for (let d = new Date('2024-01-01T00:00:00Z'); d < new Date('2024-09-01T00:00:00Z'); d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) sessions.push(d.toISOString().slice(0, 10));
  }
  const actual = sessions.map((_, i) => 100 * (1 + 0.001 * i + 0.05 * Math.sin(i / 5)));
  const same = actual.map(v => v * 2);
  const good = proxyFidelity(sessions, actual, same, '2024-01-01', '2024-12-31');
  assert.equal(good.pass, true);
  assert.equal(good.status, 'PASS');
  near(good.weekly.correlation, 1, 1e-9);
  near(good.weekly.beta, 1, 1e-9);
  near(good.monthly.trackingErrorAnnual, 0, 1e-9);
  assert.equal(good.criteria.length, 5);
  assert.ok(good.criteria.every(c => c.pass));
  assert.equal(good.monthly.observations, 7); // 1~8월 월말 8개 → 수익률 7개

  const unrelated = sessions.map((_, i) => 100 * (1 + 0.0005 * i + 0.05 * Math.cos(i / 2.3)));
  const bad = proxyFidelity(sessions, actual, unrelated, '2024-01-01', '2024-12-31');
  assert.equal(bad.pass, false);
  assert.equal(bad.status, 'FAIL');
  // 일간 지표는 판정 기준에 들어가지 않는다
  assert.ok(bad.criteria.every(c => !c.name.includes('일간')));
}

// ---------------------------------------------------------------------------
// (g) Amendment 1 — 이벤트 원장 TR 계수 / 백엔드 보충 / 단위 검증 / 엄격 달력
//     기대값은 전부 손계산 절대값이다(원장 함수 결과끼리 비교하지 않는다).
// ---------------------------------------------------------------------------
{
  // 보충 대상일 21개(정정 1 §1) 고정
  assert.equal(FILL_DATES.length, 21);
  assert.equal(FILL_DATES[0], '2022-02-14');
  assert.equal(FILL_DATES[20], '2024-11-05');
  assert.ok(FILL_DATES.includes('2023-07-27') && FILL_DATES.includes('2024-01-18'));
  assert.deepEqual([...FILL_DATES].sort(), [...FILL_DATES]);

  // 백엔드 응답 파싱: NaN → null, 날짜 오름차순
  const be = parseBackendHistory('{"X":{"data":{"2024-03-05":NaN,"2024-03-04":100.5},"open":{"2024-03-04":99,"2024-03-05":NaN},"high":{"2024-03-04":101},"low":{"2024-03-04":98}}}', 'X');
  assert.deepEqual(be.dates, ['2024-03-04', '2024-03-05']);
  assert.deepEqual(be.close, [100.5, null]);
  assert.deepEqual(be.open, [99, null]);
  assert.throws(() => parseBackendHistory('{"X":{"error":"nope"}}', 'X'));
}

{
  // (g1) 이벤트 원장: Yahoo 계수가 전부 1(틀림)이어도 원장 계수가 O/H/L/C 4값에 같이 적용된다.
  // 종가 100,100,200,200,200,200 / 분배 A: 03-06 2원(직전 03-05 종가 100 → 2%) / B: 03-08 4원(직전 03-07 종가 200 → 2%)
  const days = ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08', '2024-03-11'];
  const closes = [100, 100, 200, 200, 200, 200];
  const y = parseYahooAdjusted(
    chart('Q', 'Asia/Seoul', days.map((d, i) => bar(d, closes[i] - 1, closes[i] + 2, closes[i] - 2, closes[i], 1)), [
      { date: '2024-03-06', amount: 2 },
      { date: '2024-03-08', amount: 4 },
    ])
  );
  const events = computeLedgerEvents(y);
  assert.equal(events.length, 2);
  assert.equal(events[0].exDate, '2024-03-06');
  assert.equal(events[0].prevDate, '2024-03-05');
  assert.equal(events[0].prevRawSource, 'yahoo');
  near(events[0].yield, 0.02, 1e-15);
  near(events[1].yield, 0.02, 1e-15);
  near(ledgerFactorAt(events, '2024-03-04'), 0.9604, 1e-15); // 0.98 × 0.98
  near(ledgerFactorAt(events, '2024-03-06'), 0.98, 1e-15);
  near(ledgerFactorAt(events, '2024-03-08'), 1, 1e-15);
  const led = applyEventLedger(y, events);
  const r0 = led.rows[0];
  near(r0.factor, 0.9604, 1e-15);
  near(r0.close, 96.04, 1e-12);
  near(r0.open, 99 * 0.9604, 1e-12); // 95.0796
  near(r0.high, 102 * 0.9604, 1e-12); // 97.9608
  near(r0.low, 98 * 0.9604, 1e-12); // 94.1192
  near(r0.adjClose, 96.04, 1e-12);
  assert.equal(r0.yahooFactor, 1); // Yahoo 원래 값 보존
  assert.equal(r0.yahooAdjClose, 100);
  near(led.rows[3].close, 196, 1e-12); // 03-07: 200 × 0.98
  near(led.rows[5].close, 200, 1e-12);
  // 비교용으로 Yahoo 원래 계수로 되돌릴 수 있다
  const back = withYahooFactors(led);
  near(back.rows[0].close, 100, 1e-12);
  assert.equal(back.rows[0].factor, 1);
}

{
  // (g2) 분배락 직전일을 Yahoo가 비웠을 때(069500 2023-07-27 유형): 백엔드 조정 종가에서 역산한다.
  // d1 03-04 종가 102 / d2 03-05 null(백엔드만 있음, 진짜 원시 100) / d3 03-06 종가 150, 분배 1원 / d4 03-07 종가 150, 분배 3원(직전 d3 150 → 2%)
  // 백엔드 조정 종가(d2) = (원시 − 분배금) × 이후 이벤트 계수 = (100 − 1) × 0.98 = 97.02 → 역산 원시 = 97.02/0.98 + 1 = 100 → 수익률 1/100
  const y = parseYahooAdjusted(
    chart(
      'W',
      'Asia/Seoul',
      [bar('2024-03-04', 101, 104, 100, 102), nullBar('2024-03-05'), bar('2024-03-06', 149, 152, 148, 150), bar('2024-03-07', 149, 152, 148, 150), bar('2024-03-08', 149, 152, 148, 150)],
      [
        { date: '2024-03-06', amount: 1 },
        { date: '2024-03-07', amount: 3 },
      ]
    )
  );
  const be: BackendSeries = {
    dates: ['2024-03-05'],
    open: [97.02],
    high: [97.02],
    low: [97.02],
    close: [97.02],
  };
  const ev = computeLedgerEvents(y, be);
  assert.equal(ev[0].prevDate, '2024-03-05');
  assert.equal(ev[0].prevRawSource, 'backend-derived');
  near(ev[0].prevRaw, 100, 1e-9);
  near(ev[0].yield, 0.01, 1e-12);
  near(ev[0].alternativeYield, 1 / 102, 1e-15); // 0.00980392156862745: 마지막 유효 원시 종가(102)를 썼다면
  near(ev[1].yield, 0.02, 1e-15);
  assert.equal(ev[1].prevRawSource, 'yahoo');
  // 백엔드 없이는 마지막 유효 종가로 대체(표시됨)
  const evNo = computeLedgerEvents(y);
  assert.equal(evNo[0].prevRawSource, 'last-valid-fallback');
  assert.equal(evNo[0].prevDate, '2024-03-04');
  near(evNo[0].yield, 1 / 102, 1e-15);
  // d2 결측 행은 원장 적용 후에도 무효 그대로
  const led = applyEventLedger(y, ev);
  assert.equal(led.rows[1].valid, false);
  assert.equal(led.rows[1].close, null);
  near(led.rows[0].factor, 0.99 * 0.98, 1e-15); // 0.9702
  near(led.rows[0].close, 102 * 0.9702, 1e-12); // 98.9604

  // (g3) 보충: d2에 백엔드 O/H/L/C(이미 조정 단위)를 그대로 넣는다. 날짜가 없거나 이미 유효한 행은 건너뛴다.
  const beFull: BackendSeries = { dates: ['2024-03-05'], open: [96], high: [98], low: [95], close: [97.02] };
  const res = applyBackendFill(led, beFull, ['2024-03-01', '2024-03-04', '2024-03-05']);
  assert.equal(res.filled.length, 1);
  assert.deepEqual(res.filled[0], { date: '2024-03-05', open: 96, high: 98, low: 95, close: 97.02 });
  assert.deepEqual(res.skipped, [
    { date: '2024-03-01', reason: 'no-yahoo-row' },
    { date: '2024-03-04', reason: 'yahoo-row-already-valid' },
  ]);
  const frow = res.parsed.rows[1];
  assert.equal(frow.valid, true);
  assert.equal(frow.source, 'backend-fill');
  assert.equal(frow.rawClose, null); // 원시값은 없다
  assert.equal(frow.factor, null);
  near(frow.close, 97.02);
  near(frow.open, 96);
  assert.equal(res.parsed.rows[0].source, 'yahoo');
  // 백엔드에 값이 없는 날은 채우지 않고 사유를 남긴다
  const none = applyBackendFill(led, { dates: [], open: [], high: [], low: [], close: [] }, ['2024-03-05']);
  assert.equal(none.filled.length, 0);
  assert.deepEqual(none.skipped, [{ date: '2024-03-05', reason: 'no-backend-bar' }]);
  // DG3: 보충 행(계수 null)은 건너뛰어도 분배락일이 구간 안에 있으면 변화점으로 잡힌다
  const dg3 = dg3Series('W', res.parsed, '2024-03-04', '2024-03-31');
  assert.equal(dg3.status, 'PASS');
  assert.equal(dg3.changePoints.length, 2);
  assert.equal(dg3.changePoints[0].prevDate, '2024-03-04');
  assert.equal(dg3.changePoints[0].date, '2024-03-06');
}

{
  // (g4) 단위 검증: 백엔드 = 새 TR × 1.0005(일정) → 통과, 비율 1.0005. × 0.998 → 실패(허용 0.1%).
  const days: string[] = [];
  for (let d = new Date('2024-04-01T00:00:00Z'); days.length < 12; d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) days.push(d.toISOString().slice(0, 10));
  }
  const fillDay = days[6];
  const y = parseYahooAdjusted(chart('U', 'Asia/Seoul', days.map((d, i) => (i === 6 ? nullBar(d) : bar(d, 99 + i, 102 + i, 98 + i, 100 + i, 1)))));
  const led = applyEventLedger(y, computeLedgerEvents(y));
  const mk = (k: number): BackendSeries => ({
    dates: days,
    open: days.map((_, i) => (99 + i) * k),
    high: days.map((_, i) => (102 + i) * k),
    low: days.map((_, i) => (98 + i) * k),
    close: days.map((_, i) => (100 + i) * k),
  });
  const ok = unitCheck(led, mk(1.0005), [fillDay], days[0], days[11]);
  assert.equal(ok.rows.length, 1);
  assert.equal(ok.rows[0].neighbors, 10); // 앞 5 + 뒤 5
  assert.equal(ok.rows[0].pass, true);
  near(ok.rows[0].closeRatioMin, 1.0005, 1e-12);
  near(ok.rows[0].closeRatioMax, 1.0005, 1e-12);
  near(ok.rows[0].maxDev.close, 0.0005, 1e-12);
  assert.equal(ok.overlap.n, 11); // 보충일 제외 전 구간
  near(ok.overlap.ratioMean, 1.0005, 1e-12);
  assert.equal(ok.pass, true);
  const bad = unitCheck(led, mk(0.998), [fillDay], days[0], days[11]);
  assert.equal(bad.rows[0].pass, false);
  near(bad.rows[0].maxDev.close, 0.002, 1e-12); // |0.998 − 1|
  assert.equal(bad.pass, false);
  // 보충 대상이 없으면 통과가 아니다
  assert.equal(unitCheck(led, mk(1), ['2023-01-02'], days[0], days[11]).pass, false);
}

{
  // (g5) 백엔드 암시 단계 vs 원장, 구간 대조 — (g1)과 같은 픽스처
  const days = ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08', '2024-03-11'];
  const closes = [100, 100, 200, 200, 200, 200];
  const y = parseYahooAdjusted(
    chart('Q', 'Asia/Seoul', days.map((d, i) => bar(d, closes[i] - 1, closes[i] + 2, closes[i] - 2, closes[i], 1)), [
      { date: '2024-03-06', amount: 2 },
      { date: '2024-03-08', amount: 4 },
    ])
  );
  const events = computeLedgerEvents(y);
  const led = applyEventLedger(y, events);
  const fac = [0.9604, 0.9604, 0.98, 0.98, 1, 1];
  const mkBe = (f: number[]): BackendSeries => ({
    dates: days,
    open: days.map((_, i) => (closes[i] - 1) * f[i]),
    high: days.map((_, i) => (closes[i] + 2) * f[i]),
    low: days.map((_, i) => (closes[i] - 2) * f[i]),
    close: days.map((_, i) => closes[i] * f[i]),
  });

  // 백엔드가 원장과 같으면: 이벤트 단위 모두 ok, 단독 단계 없음, 원장-백엔드 구간 일치
  const same = backendImplied(led, events, mkBe(fac), '2024-03-04', '2024-03-31');
  assert.deepEqual(same.events.map(e => e.flag), ['ok', 'ok']);
  near(same.events[0].backendYield, 0.02, 1e-12);
  near(same.events[0].diffBp, 0, 1e-8);
  assert.equal(same.backendOnlySteps.length, 0);
  const cmpSame = compareFactors(led, events, mkBe(fac), '2024-03-04', '2024-03-31');
  assert.equal(cmpSame.hasUnexplainedSegment, false); // Yahoo 계수(1)와는 달라도 백엔드와 맞으면 '어느 쪽과도 안 맞음'이 아니다
  assert.equal(cmpSame.segments.length, 3);
  near(cmpSame.vsBackend.max, 0, 1e-12);
  near(cmpSame.vsYahoo.max, 0.0396, 1e-12); // |0.9604/1 − 1|
  assert.equal(cmpSame.vsYahoo.maxDate, '2024-03-04');

  // 백엔드에 이벤트 B가 없으면: B는 -200bp 불일치(백엔드 암시 0)
  const noB = backendImplied(led, events, mkBe([0.98, 0.98, 1, 1, 1, 1]), '2024-03-04', '2024-03-31');
  assert.deepEqual(noB.events.map(e => e.flag), ['ok', 'mismatch']);
  near(noB.events[1].backendYield, 0, 1e-12);
  near(noB.events[1].diffBp, -200, 1e-8);

  // 원장에 없는 단계(03-08→03-11 에 1%)가 백엔드에만 있으면 단독 단계로 잡힌다
  const extra = backendImplied(led, events, mkBe([0.9604 * 0.99, 0.9604 * 0.99, 0.98 * 0.99, 0.98 * 0.99, 0.99, 1]), '2024-03-04', '2024-03-31');
  assert.deepEqual(extra.events.map(e => e.flag), ['ok', 'ok']);
  assert.equal(extra.backendOnlySteps.length, 1);
  assert.equal(extra.backendOnlySteps[0].prevDate, '2024-03-08');
  assert.equal(extra.backendOnlySteps[0].date, '2024-03-11');
  near(extra.backendOnlySteps[0].backendYield, 0.01, 1e-12);

  // 백엔드와 Yahoo 둘 다 원장과 다르면 해당 구간이 '어느 쪽과도 안 맞음'
  const cmpBad = compareFactors(led, events, mkBe([0.9604 * 0.99, 0.9604 * 0.99, 0.98 * 0.99, 0.98 * 0.99, 0.99, 0.99]), '2024-03-04', '2024-03-31');
  assert.equal(cmpBad.hasUnexplainedSegment, true);
  assert.deepEqual(cmpBad.segments.map(s => s.matchesNeither), [true, true, false]); // 마지막 구간(계수 1)은 Yahoo 계수(1)와 일치
  assert.equal(cmpBad.segments[0].from, '2024-03-04');
}

{
  // (g6) 엄격 달력: 보충 후에는 보충한 날이 과반 규칙 달력에도 돌아오고, 보충하지 못한 날은 엄격 달력에서만 남아 이월(fresh=false)된다.
  const be1: BackendSeries = { dates: ['2024-03-08'], open: [100], high: [102], low: [98], close: [101] };
  const filledKr = {} as Record<AssetCode, YahooParsed>;
  for (const code of ASSET_CODES) filledKr[code] = applyBackendFill(applyEventLedger(krParsed[code], computeLedgerEvents(krParsed[code])), be1, ['2024-03-08']).parsed;
  // 464470은 03-08에 Yahoo 행이 없다(상장 전) → 보충 대상 아님
  assert.equal(filledKr['464470'].rows.some(r => r.date === '2024-03-08'), false);
  const maj = buildSessionCalendar(filledKr, '2024-03-04', '2024-03-15', 'majority-valid');
  assert.deepEqual(maj.dates, [D[0], D[1], D[2], D[3], D[4], D[5], D[6], D[7], D[9]]); // 03-08 복귀, 03-14(D8)는 여전히 2/6이라 제외
  const strictCal = buildSessionCalendar(filledKr, '2024-03-04', '2024-03-15', 'yahoo-rows');
  assert.deepEqual(strictCal.dates, D);
  const built = buildPanelWithMeta({ kr: filledKr, tlt: tltParsed, fx: fxParsed }, { includeSynthetic464470: true, calendarRule: 'yahoo-rows', start: '2024-03-04', end: '2024-03-15' });
  assert.deepEqual(built.panel.dates, D);
  const a = built.panel.assets['069500'];
  assert.equal(a.fresh[4], true); // 보충한 03-08
  assert.equal(a.source[4], 'actual');
  near(a.close[4], 101);
  near(a.open[4], 100);
  assert.equal(a.fresh[8], false); // 03-14: 보충하지 않은 결측 → 직전 봉 이월
  assert.equal(a.close[8], a.close[7]);
  assert.deepEqual(validatePanelShape(built.panel), []);
}

// ---------------------------------------------------------------------------
// (h) Amendment 2 — 백엔드 기준 TR / 비율 시계열 / DG2 구간 설명
// ---------------------------------------------------------------------------
{
  // (h1) buildBackendParsed: 달력(Yahoo 행)은 그대로, 값은 백엔드 그대로(계수 곱하지 않음), 백엔드에 값이 없는 Yahoo 날은 invalid(이월 대상)
  const y = parseYahooAdjusted(chart('X', 'Asia/Seoul', [bar('2024-03-04', 100, 110, 90, 104, 0.5), bar('2024-03-05', 101, 111, 91, 105, 0.5), bar('2024-03-06', 102, 112, 92, 106, 0.5), bar('2024-03-07', 103, 113, 93, 107, 0.5)]));
  const be: BackendSeries = {
    dates: ['2024-03-04', '2024-03-05', '2024-03-07', '2024-03-08'],
    open: [50, 51, 53, 54],
    high: [56, 57, 59, 60],
    low: [45, 46, 48, 49],
    close: [52, 53, 55, 56],
  };
  const out = buildBackendParsed(y, be, '2024-03-04', '2024-03-31');
  assert.deepEqual(out.parsed.rows.map(r => r.valid), [true, true, false, true]);
  assert.deepEqual(out.parsed.rows.map(r => r.date), ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07']);
  near(out.parsed.rows[0].close, 52);
  near(out.parsed.rows[0].open, 50);
  near(out.parsed.rows[3].high, 59);
  assert.equal(out.parsed.rows[2].close, null);
  assert.equal(out.parsed.rows[0].source, 'backend');
  assert.deepEqual(out.carriedDates, ['2024-03-06']);
  assert.deepEqual(out.backendOnlyDates, ['2024-03-08']);
  assert.equal(out.barsInRange, 4);
  assert.equal(out.integerValuedBars, 3); // 03-08은 Yahoo 행이 없어 valid 행에 들지 않는다
  assert.deepEqual(out.impossible, []);
  // 불가능 OHLC 보고: 고가 < 종가
  const beBad: BackendSeries = { dates: ['2024-03-04'], open: [50], high: [51], low: [45], close: [52] };
  assert.deepEqual(buildBackendParsed(y, beBad, '2024-03-04', '2024-03-31').impossible, [{ date: '2024-03-04', kind: 'C>H' }]);
  // 달력 규칙 경유: 백엔드 기준 파싱 결과로 엄격 달력·이월이 동작한다
  const p5 = buildPanelWithMeta(
    { kr: { '069500': out.parsed, '379800': out.parsed, '283580': out.parsed, '385560': out.parsed, '464470': out.parsed, '411060': out.parsed }, tlt: tltParsed, fx: fxParsed },
    { includeSynthetic464470: false, calendarRule: 'yahoo-rows', start: '2024-03-04', end: '2024-03-31' }
  );
  assert.deepEqual(p5.panel.dates, ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07']);
  const a069 = p5.panel.assets['069500'];
  assert.deepEqual(a069.fresh, [true, true, false, true]);
  near(a069.close[2], 53); // 03-06 이월 = 03-05 백엔드 종가
  near(a069.close[3], 55);
}

{
  // (h2) ratioPoints: 두 계열 모두 값이 있는 날만, 비율 = 백엔드 종가 / 원장 TR 종가
  const y = parseYahooAdjusted(chart('X', 'Asia/Seoul', [bar('2024-03-04', 100, 110, 90, 100), bar('2024-03-05', 100, 110, 90, 200), nullBar('2024-03-06'), bar('2024-03-07', 100, 110, 90, 400)]));
  const led = applyEventLedger(y, []);
  const be: BackendSeries = { dates: ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07'], open: [1, 1, 1, 1], high: [1, 1, 1, 1], low: [1, 1, 1, 1], close: [101, 202, 303, 396] };
  const pts = ratioPoints(be, led, '2024-03-04', '2024-03-31');
  assert.deepEqual(pts.map(p => p.date), ['2024-03-04', '2024-03-05', '2024-03-07']);
  near(pts[0].ratio, 1.01);
  near(pts[1].ratio, 1.01);
  near(pts[2].ratio, 0.99);
}

{
  // (h3) explainDg2 — 골든 케이스. 비율 = 백엔드/원장TR.
  const mkEvent = (exDate: string, y: number): LedgerEvent => ({ exDate, amount: 1, prevDate: null, prevRaw: 1, prevRawSource: 'yahoo', yield: y, alternativeYield: null });
  const emptyImplied: BackendImplied = { events: [], backendOnlySteps: [] };
  const days = (from: number, n: number, month: string): string[] => Array.from({ length: n }, (_, i) => `${month}-${String(from + i).padStart(2, '0')}`);
  const pts = (ds: string[], ratio: number): RatioPoint[] => ds.map(date => ({ date, ratio }));
  const errMissing: KnownLedgerError = { asset: '464470', kind: 'missing-event', windowFrom: '2025-03-28', windowTo: '2025-03-28', description: 'm' };
  const errMisdated: KnownLedgerError = { asset: '069500', kind: 'misdated-event', windowFrom: '2022-10-27', windowTo: '2022-10-27', description: 'd' };
  assert.equal(KNOWN_LEDGER_ERRORS.length, 3);
  assert.deepEqual(KNOWN_LEDGER_ERRORS.map(e => `${e.asset}:${e.kind}`), ['069500:missing-event', '069500:misdated-event', '464470:missing-event']);

  // (i) 누락 사건: 사건 전 비율 0.998, 이후 1.0. 백엔드 단계 0.2% → 측정 단계 1 − 0.998/1 = 0.002 (차이 0bp) → 설명됨
  const impMissing: BackendImplied = { events: [], backendOnlySteps: [{ prevDate: '2025-03-27', date: '2025-03-28', backendYield: 0.002 }] };
  const ptsA = [...pts(days(10, 18, '2025-03'), 0.998), ...pts(days(28, 4, '2025-03'), 1)];
  const exA = explainDg2('464470', ptsA, [errMissing], [], impMissing);
  assert.equal(exA.explained, true);
  assert.deepEqual(exA.unexplainedDates, []);
  assert.equal(exA.intervals.length, 2);
  assert.equal(exA.intervals[0].mismatchDays, 18);
  assert.equal(exA.intervals[0].explainable, true);
  assert.equal(exA.intervals[1].clean, true);
  assert.equal(exA.steps[0].date, '2025-03-28');
  near(exA.steps[0].measuredStep, 0.002, 1e-12);
  near(exA.steps[0].diffBp, 0, 1e-8);

  // (ii) 사건 이후 구간에 어긋난 날이 하나라도 남으면 설명 실패
  const ptsB = [...ptsA, { date: '2025-04-02', ratio: 1.003 }];
  const exB = explainDg2('464470', ptsB, [errMissing], [], impMissing);
  assert.equal(exB.explained, false);
  assert.ok(exB.unexplainedDates.includes('2025-04-02')); // 사건 이후에도 어긋나면 앞 구간의 어긋남까지 인정되지 않는다(사슬 전체가 미설명)
  assert.equal(exB.unexplainedDates.length, 19);

  // (iii) 단계 크기가 사건과 5bp 넘게 다르면 실패(측정 0.5% vs 사건 0.2% → 30bp)
  const ptsC = [...pts(days(10, 18, '2025-03'), 0.995), ...pts(days(28, 4, '2025-03'), 1)];
  const exC = explainDg2('464470', ptsC, [errMissing], [], impMissing);
  assert.equal(exC.explained, false);
  near(exC.steps[0].diffBp, 30, 1e-6);
  assert.equal(exC.steps[0].ok, false);

  // (iv) 구간 안에서 비율이 일정하지 않으면(점진적 이탈) 단계형 차이가 아니므로 실패
  const ptsD = [...days(10, 18, '2025-03').map((date, i) => ({ date, ratio: 0.998 - i * 0.0001 })), ...pts(days(28, 4, '2025-03'), 1)];
  assert.equal(explainDg2('464470', ptsD, [errMissing], [], impMissing).explained, false);

  // (v) 알려진 사건과 무관한 원장·백엔드 불일치가 있으면 실패
  const impExtra: BackendImplied = { events: [], backendOnlySteps: [...impMissing.backendOnlySteps, { prevDate: '2025-01-02', date: '2025-01-03', backendYield: 0.003 }] };
  const exE = explainDg2('464470', ptsA, [errMissing], [], impExtra);
  assert.equal(exE.explained, false);
  assert.equal(exE.extraDisagreements.length, 1);

  // (vi) 사건을 못 찾으면(창 안에 백엔드 단계 없음) 어긋난 날이 설명되지 않는다
  const exF = explainDg2('464470', ptsA, [errMissing], [], emptyImplied);
  assert.equal(exF.explained, false);
  assert.equal(exF.steps[0].date, null);
  assert.equal(exF.unexplainedDates.length, 22 - 4);

  // (vii) 날짜가 틀린 사건: 원장이 분배 0.29%를 2022-10-27로 잘못 적용 → 그 전 구간 비율 1/(1−0.0029), 이후 1. 기대 단계 = 1 − 1/(1−y)
  const r1 = 1 / (1 - 0.0029);
  const ptsM = [...pts(['2022-10-24', '2022-10-25', '2022-10-26'], r1), ...pts(['2022-10-27', '2022-10-28'], 1)];
  const exM = explainDg2('069500', ptsM, [errMisdated], [mkEvent('2022-10-27', 0.0029)], emptyImplied);
  assert.equal(exM.explained, true);
  near(exM.steps[0].expectedStep, 1 - 1 / (1 - 0.0029), 1e-12);
  near(exM.steps[0].measuredStep, 1 - r1, 1e-12);
  assert.equal(exM.intervals[0].explainable, true);

  // (viii) 두 사건(누락 + 날짜 오류)이 이어진 069500 모양: 세 구간 [r0, r1, 1]
  const y2 = 0.0022;
  const yo = 0.0029;
  const rMid = 1 / (1 - yo);
  const rEarly = rMid * (1 - y2);
  const imp2: BackendImplied = { events: [], backendOnlySteps: [{ prevDate: '2022-07-27', date: '2022-07-28', backendYield: y2 }] };
  const errJul: KnownLedgerError = { asset: '069500', kind: 'missing-event', windowFrom: '2022-07-01', windowTo: '2022-07-31', description: 'j' };
  const ptsT = [...pts(['2022-07-25', '2022-07-26', '2022-07-27'], rEarly), ...pts(['2022-07-28', '2022-08-01', '2022-10-26'], rMid), ...pts(['2022-10-27', '2022-10-28'], 1)];
  const exT = explainDg2('069500', ptsT, [errJul, errMisdated], [mkEvent('2022-10-27', yo)], imp2);
  assert.equal(exT.explained, true);
  assert.deepEqual(exT.intervals.map(iv => iv.rows), [3, 3, 2]);
  assert.deepEqual(exT.intervals.map(iv => iv.mismatchDays), [0, 3, 0]); // 첫 구간은 1.0007이라 0.1% 안(실제 069500과 같은 모양)
  assert.deepEqual(exT.unexplainedDates, []);
  // 중간 구간의 단계가 맞지 않으면(두 번째 사건 전 수준이 어긋남) 전체가 설명되지 않는다
  const ptsT2 = [...pts(['2022-07-25', '2022-07-26', '2022-07-27'], rEarly), ...pts(['2022-07-28', '2022-08-01', '2022-10-26'], 1.01), ...pts(['2022-10-27', '2022-10-28'], 1)];
  assert.equal(explainDg2('069500', ptsT2, [errJul, errMisdated], [mkEvent('2022-10-27', yo)], imp2).explained, false);
}

console.log('core6 V3 data parity: all assertions passed');
