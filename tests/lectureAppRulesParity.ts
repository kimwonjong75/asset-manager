// tests/lectureAppRulesParity.ts
// ---------------------------------------------------------------------------
// P4 — 앱 매도규칙 재현(`scripts/backtest/lectureSignals/appRules.ts`)의 골든/불변식 테스트.
//
// RULES §13 준수: **명시적 절대 골든값**을 손계산해 못박는다(경로A-vs-경로B 자기참조 금지).
//   · §1~§3  저수준 지표(SMA/RSI/ATR/기울기/롤링최대)의 절대값 골든
//   · §4~§16 규칙 13종 각각 **경계값 골든 2건 이상**(발동/미발동 쌍)
//   · §17    C(기존규칙 OR) · D(C ∪ 신규신호) 결합 로직 골든
//   · §18    앱 실제 함수(`utils/buildEnrichedIndicator` → `utils/alertChecker.matchesRule`)와의
//            독립 구현 동치 확인. 두 구현은 **공통 함수를 공유하지 않으므로** 자기참조가 아니다.
//
// 실행: npx --yes tsx tests/lectureAppRulesParity.ts   (package.json 미등록 — 지시대로)
// ---------------------------------------------------------------------------

import {
  APP_SELL_RULE_IDS,
  APP_RULE_CONST,
  anyAppRuleFired,
  appHighestPrice,
  atrSeries,
  buildAppIndicatorSeries,
  evaluateAppSellRules,
  firedAppRules,
  normalizedSlopeAt,
  rollingMaxSeries,
  rsiSeries,
  slopeRatioAt,
  smaSeries,
  type AppIndicatorSeries,
  type AppSellRuleId,
} from '../scripts/backtest/lectureSignals/appRules';
import { testSignalAt } from '../scripts/backtest/lectureSignals/events';
import type { SecurityBars } from '../scripts/backtest/lectureSignals/configTypes';
import { buildEnrichedIndicator } from '../utils/buildEnrichedIndicator';
import { matchesRule } from '../utils/alertChecker';
import { DEFAULT_ALERT_RULES } from '../constants/alertRules';
import { Currency } from '../types';
import type { EnrichedAsset } from '../types/ui';

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

// ── 합성 바 생성 ────────────────────────────────────────────────────────────
function mkDates(n: number): string[] {
  const out: string[] = [];
  const base = Date.UTC(2012, 0, 2);
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

interface BarsInit {
  close: number[];
  open?: number[];
  high?: number[];
  low?: number[];
  volume?: number[];
}

function mkBars(init: BarsInit, code = 'T0001'): SecurityBars {
  const n = init.close.length;
  const dates = mkDates(n);
  const dateIndex = new Map<string, number>();
  dates.forEach((d, i) => dateIndex.set(d, i));
  const close = init.close;
  const open = init.open ?? close.slice();
  const high = init.high ?? close.slice();
  const low = init.low ?? close.slice();
  const volume = init.volume ?? new Array<number>(n).fill(1000);
  return {
    code,
    name: code,
    dates,
    adjOpen: open,
    adjHigh: high,
    adjLow: low,
    adjClose: close,
    adjVolume: volume,
    amount: close.map((c, i) => c * volume[i]),
    market: new Array<string>(n).fill('KOSPI'),
    close: close.slice(),
    volume: volume.slice(),
    dateIndex,
  };
}

/** 재현 경로 규칙 판정. */
function flagsAt(
  s: AppIndicatorSeries,
  i: number,
  purchasePrice: number | null,
  highestPrice?: number
): Record<AppSellRuleId, boolean> {
  const pos =
    purchasePrice === null
      ? null
      : { purchasePrice, highestPrice: highestPrice ?? appHighestPrice(s, i, purchasePrice, s.close[i]) };
  return evaluateAppSellRules(s, i, pos);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('1. SMA 절대 골든');
{
  check('smaSeries([1,2,3,4,5],3)[0]', smaSeries([1, 2, 3, 4, 5], 3)[0], null);
  check('smaSeries([1,2,3,4,5],3)[1]', smaSeries([1, 2, 3, 4, 5], 3)[1], null);
  checkClose('smaSeries([1,2,3,4,5],3)[2]=2', smaSeries([1, 2, 3, 4, 5], 3)[2], 2);
  checkClose('smaSeries([1,2,3,4,5],3)[3]=3', smaSeries([1, 2, 3, 4, 5], 3)[3], 3);
  checkClose('smaSeries([1,2,3,4,5],3)[4]=4', smaSeries([1, 2, 3, 4, 5], 3)[4], 4);
  // 재계산(re-seed) 경로: 300개 상수열의 MA20은 어디서나 정확히 100
  const flat = new Array<number>(300).fill(100);
  const m = smaSeries(flat, 20);
  checkClose('상수열 MA20[19]=100', m[19], 100, 0);
  checkClose('상수열 MA20[275](re-seed 이후)=100', m[275], 100, 0);
  // 선형열 100+i 의 MA20[i] = 100 + (i-9.5)
  const lin = Array.from({ length: 120 }, (_, i) => 100 + i);
  checkClose('선형열 MA20[19]=109.5', smaSeries(lin, 20)[19], 109.5);
  checkClose('선형열 MA20[119]=209.5', smaSeries(lin, 20)[119], 209.5);
  checkClose('선형열 MA5[119]=217', smaSeries(lin, 5)[119], 217);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. RSI(Wilder) 절대 골든');
{
  const up = Array.from({ length: 30 }, (_, i) => 100 + i); // 전부 +1
  const r = rsiSeries(up, 14);
  check('상승열 RSI[13]=null(워밍업)', r[13], null);
  checkClose('상승열 RSI[14]=100(손실 0)', r[14], 100);
  checkClose('상승열 RSI[29]=100', r[29], 100);

  const flat = new Array<number>(30).fill(100);
  checkClose('상수열 RSI[29]=100(avgLoss=0 규약)', rsiSeries(flat, 14)[29], 100);

  // +1 × 25 후 -0.5 → avgGain=13/14, avgLoss=1/28, RS=26, RSI=100-100/27
  const mixed = [...Array.from({ length: 26 }, (_, i) => 100 + i), 124.5];
  const rm = rsiSeries(mixed, 14);
  checkClose('상승 후 -0.5 → RSI=100-100/27', rm[26], 100 - 100 / 27, 1e-10);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. ATR · 기울기 · 롤링최대 절대 골든');
{
  const c = Array.from({ length: 30 }, (_, i) => 100 + i);
  const a = atrSeries(c, c, c, 14); // h=l=c → TR = |Δclose| = 1
  check('ATR[13]=null', a[13], null);
  checkClose('ATR[14]=1', a[14], 1);
  checkClose('ATR[29]=1', a[29], 1);

  // 선형열 100..109, period 10 → slope=1, meanY=104.5 → 1/104.5
  const lin10 = Array.from({ length: 10 }, (_, i) => 100 + i);
  checkClose('normalizedSlopeAt(선형,9,10)=1/104.5', normalizedSlopeAt(lin10, 9, 10), 1 / 104.5, 1e-12);
  // 선형열 100..159 : slope10/meanY10 ÷ slope60/meanY60 = meanY60/meanY10 = 129.5/154.5
  const lin60 = Array.from({ length: 60 }, (_, i) => 100 + i);
  checkClose('slopeRatioAt(선형,59)=129.5/154.5', slopeRatioAt(lin60, 59), 129.5 / 154.5, 1e-12);
  // 하락 장기추세 → null
  const dn = Array.from({ length: 60 }, (_, i) => 200 - i);
  check('slopeRatioAt(하락열)=null', slopeRatioAt(dn, 59), null);

  const rm = rollingMaxSeries([3, 1, 4, 1, 5], 2);
  check('rollingMax w2 [0]', rm[0], 3);
  check('rollingMax w2 [1]', rm[1], 3);
  check('rollingMax w2 [2]', rm[2], 4);
  check('rollingMax w2 [3]', rm[3], 4);
  check('rollingMax w2 [4]', rm[4], 5);
}

// ════════════════════════════════════════════════════════════════════════════
// 공통 픽스처 A: 상수 100 × 59 + 마지막 1일
//   MA20 = (19·100 + x)/20, MA5 = (4·100 + x)/5, MA60 = (59·100 + x)/60
//   swing low = 100 (직전 확정 저점), 52주 최고 종가 = max(100, x)
// ════════════════════════════════════════════════════════════════════════════
function constFixture(last: number): AppIndicatorSeries {
  const close = new Array<number>(60).fill(100);
  close[59] = last;
  return buildAppIndicatorSeries(mkBars({ close }));
}

console.log('4. stop-loss 경계값 골든 (−5%)');
{
  const s95 = constFixture(95);
  checkClose('MA20[59] 골든 99.75', s95.ma[20][59], 99.75);
  checkClose('MA5[59] 골든 99', s95.ma[5][59], 99);
  check('매수가 100·종가 95 → 수익률 −5% → 발동', flagsAt(s95, 59, 100)['stop-loss'], true);

  const s9501 = constFixture(95.01);
  check('종가 95.01 → 수익률 −4.99% → 미발동', flagsAt(s9501, 59, 100)['stop-loss'], false);
  check('보유상태 없음(pos=null) → 미발동', flagsAt(s95, 59, null)['stop-loss'], false);
}

console.log('5. profit-target 경계값 골든 (+20%)');
{
  const s120 = constFixture(120);
  check('종가 120 → +20% → 발동', flagsAt(s120, 59, 100)['profit-target'], true);
  const s11999 = constFixture(119.99);
  check('종가 119.99 → +19.99% → 미발동', flagsAt(s11999, 59, 100)['profit-target'], false);
}

console.log('6. daily-crash 경계값 골든 (−5%)');
{
  const s95 = constFixture(95);
  check('전일 100 → 당일 95 (−5%) → 발동', flagsAt(s95, 59, 100)['daily-crash'], true);
  const s951 = constFixture(95.1);
  check('전일 100 → 당일 95.1 (−4.9%) → 미발동', flagsAt(s951, 59, 100)['daily-crash'], false);
}

console.log('7. trend-break 경계값 골든 (MA20 아래 + 손실중)');
{
  const s95 = constFixture(95);
  check('종가 95 < MA20 99.75 · 손실중 → 발동', flagsAt(s95, 59, 100)['trend-break'], true);
  check('MA20 아래지만 매수가 90(이익중) → 미발동', flagsAt(s95, 59, 90)['trend-break'], false);
  const s120 = constFixture(120);
  check('종가 120 > MA20 101 → 미발동', flagsAt(s120, 59, 130)['trend-break'], false);
}

console.log('8. swing-low-break 경계값 골든');
{
  // 100×20 → 90(저점) → 101..114 → 85×5
  const close: number[] = [];
  for (let i = 0; i < 20; i++) close.push(100);
  close.push(90);
  for (let i = 21; i <= 34; i++) close.push(100 + (i - 20));
  for (let i = 35; i <= 39; i++) close.push(85);
  const s = buildAppIndicatorSeries(mkBars({ close }));
  checkClose('swing low 골든 90 (i=39)', s.swingLow[39], 90);
  check('종가 85 < swing low 90 → 발동', flagsAt(s, 39, 100)['swing-low-break'], true);
  checkClose('swing low 골든 90 (i=34)', s.swingLow[34], 90);
  check('종가 114 > swing low 90 → 미발동', flagsAt(s, 34, 100)['swing-low-break'], false);
  // 저점 미형성(우측 5봉 미확보) → event-not-found = false
  const shortBars = buildAppIndicatorSeries(mkBars({ close: new Array<number>(8).fill(100) }));
  check('데이터 8봉 → swing low 없음 → 미발동', flagsAt(shortBars, 7, 100)['swing-low-break'], false);
}

console.log('9. dead-cross 경계값 골든 (MA5<MA20 + 교차 252일 이내)');
{
  // 100..139 상승(40봉) → 137,135,...,109 하락(15봉)
  const close: number[] = [];
  for (let i = 0; i <= 39; i++) close.push(100 + i);
  for (let k = 0; k < 15; k++) close.push(139 - 2 * (k + 1));
  const s = buildAppIndicatorSeries(mkBars({ close }));
  checkClose('MA5[54] 골든 113', s.ma[5][54], 113, 1e-9);
  checkClose('MA20[54] 골든 126.5', s.ma[20][54], 126.5, 1e-9);
  check('MA 교차경과일 골든 −9(데드크로스 9일 전)', s.maCrossDays5x20[54], -9);
  check('MA5<MA20 + 교차 9일 전 → 발동', flagsAt(s, 54, 100)['dead-cross'], true);

  // 단조 상승만 → 정배열 → 미발동
  const up = buildAppIndicatorSeries(
    mkBars({ close: Array.from({ length: 40 }, (_, i) => 100 + i) })
  );
  check('단조 상승 MA5>MA20 → 미발동', flagsAt(up, 39, 100)['dead-cross'], false);
  check('단조 상승 교차경과일=null', up.maCrossDays5x20[39], null);

  // 단조 하락만 → 역배열이지만 교차 이력 없음(event-not-found) → 미발동
  const dn = buildAppIndicatorSeries(
    mkBars({ close: Array.from({ length: 60 }, (_, i) => 200 - i) })
  );
  check('단조 하락 교차경과일=null', dn.maCrossDays5x20[59], null);
  check('역배열이나 교차 미확인 → 미발동', flagsAt(dn, 59, 300)['dead-cross'], false);
}

console.log('10. long-decline 경계값 골든 (역배열 + 고점대비 −20%)');
{
  const close = Array.from({ length: 100 }, (_, i) => 200 - i); // 200 → 101
  const s = buildAppIndicatorSeries(mkBars({ close }));
  checkClose('MA20[99] 골든 110.5', s.ma[20][99], 110.5, 1e-9);
  checkClose('MA60[99] 골든 130.5', s.ma[60][99], 130.5, 1e-9);
  // 고점 126.25 → (101−126.25)/126.25 = −20% (경계)
  check('역배열 + 고점대비 −20%(경계) → 발동', flagsAt(s, 99, 200, 126.25)['long-decline'], true);
  // 고점 110 → −8.18% → 미발동
  check('역배열 + 고점대비 −8.2% → 미발동', flagsAt(s, 99, 200, 110)['long-decline'], false);
  // 정배열이면 고점대비 폭락이어도 미발동
  const upClose = Array.from({ length: 100 }, (_, i) => 100 + i);
  const su = buildAppIndicatorSeries(mkBars({ close: upClose }));
  check('정배열(MA20>MA60) → 고점대비 −50%여도 미발동', flagsAt(su, 99, 400, 400)['long-decline'], false);
}

console.log('11. overheat-drop 경계값 골든 (RSI≥70 + 당일 하락)');
{
  const down = [...Array.from({ length: 26 }, (_, i) => 100 + i), 124.5];
  const sd = buildAppIndicatorSeries(mkBars({ close: down }));
  checkClose('RSI[26] 골든 100−100/27', sd.rsi[26], 100 - 100 / 27, 1e-10);
  check('RSI 96.3 ≥70 + 당일 −0.4% → 발동', flagsAt(sd, 26, 100)['overheat-drop'], true);

  const up = [...Array.from({ length: 26 }, (_, i) => 100 + i), 125.5];
  const su = buildAppIndicatorSeries(mkBars({ close: up }));
  checkClose('RSI[26] 골든 100(전부 상승)', su.rsi[26], 100);
  check('RSI 100 ≥70 이지만 당일 상승 → 미발동', flagsAt(su, 26, 100)['overheat-drop'], false);

  const s95 = constFixture(95);
  checkClose('상수열+하락일 RSI[59] 골든 0', s95.rsi[59], 0);
  check('RSI 0 <70 + 당일 하락 → 미발동', flagsAt(s95, 59, 100)['overheat-drop'], false);
}

console.log('12. overheat-profit 경계값 골든 (+15% + RSI 과열진입 3일 이내)');
{
  // 100 기준 ±1 교대 30봉(RSI≈50) → +30 급등 → 이후 보합 4봉
  const close: number[] = [100];
  for (let i = 1; i <= 30; i++) close.push(close[i - 1] + (i % 2 === 1 ? 1 : -1));
  const jump = close.length; // 급등일 인덱스
  close.push(close[close.length - 1] + 30);
  for (let k = 0; k < 4; k++) close.push(close[close.length - 1]);
  const s = buildAppIndicatorSeries(mkBars({ close }));

  check('급등일 RSI 과열진입 경과일 골든 0', s.rsiOverheatEntryDay[jump], 0);
  check('급등 +4일 RSI 과열진입 경과일 골든 4', s.rsiOverheatEntryDay[jump + 4], 4);
  check('급등일: +15% 이상 + 진입 0일 → 발동', flagsAt(s, jump, 100)['overheat-profit'], true);
  check('급등 +4일: 진입 4일 경과(>3) → 미발동', flagsAt(s, jump + 4, 100)['overheat-profit'], false);
  // 수익률 미달
  check('급등일이라도 매수가 130(+0.8%) → 미발동', flagsAt(s, jump, 130)['overheat-profit'], false);
}

console.log('13. climax-top 경계값 골든 (플래그 ≥2)');
{
  const n = 100;
  const close = Array.from({ length: n }, (_, i) => 100 + 0.5 * i); // 100 → 149.5
  const open = close.slice();
  const high = close.slice();
  const low = close.slice();
  const volume = new Array<number>(n).fill(1000);
  // 마지막 바: 거래량 52주 최대 + (고−저)=6, 양봉
  volume[n - 1] = 5000;
  high[n - 1] = close[n - 1] + 3;
  low[n - 1] = close[n - 1] - 3;
  open[n - 1] = close[n - 1] - 2;
  const s = buildAppIndicatorSeries(mkBars({ close, open, high, low, volume }));
  check('클라이맥스 플래그 수 골든 2 ((b)+(c))', s.climaxFlagCount[99], 2);
  check('플래그 2 ≥ 임계 2 → 발동', flagsAt(s, 99, 100)['climax-top'], true);

  // 폭발 없는 동일 추세: (c)만 성립 → 1 → 미발동
  const s1 = buildAppIndicatorSeries(mkBars({ close }));
  check('플래그 수 골든 1 ((c)만)', s1.climaxFlagCount[99], 1);
  check('플래그 1 < 2 → 미발동', flagsAt(s1, 99, 100)['climax-top'], false);

  // 52주 신고가 아님((c) 탈락) + ATR 폭발만 성립 → 1 → 미발동
  // 100+0.5i 로 98봉(→149) 오른 뒤 마지막 봉만 148로 눌림(고 151·저 145·시 147, 양봉).
  //   TR[99]=max(6, |151−149|, |145−149|)=6 → ATR[99]=(0.5×13+6)/14=12.5/14 → 6/(12.5/14)=6.72 ≥2.5
  const close2 = Array.from({ length: n }, (_, i) => 100 + 0.5 * i);
  close2[n - 1] = 148;
  const high2 = close2.slice();
  const low2 = close2.slice();
  const open2 = close2.slice();
  high2[n - 1] = 151;
  low2[n - 1] = 145;
  open2[n - 1] = 147;
  const s2 = buildAppIndicatorSeries(
    mkBars({ close: close2, open: open2, high: high2, low: low2 })
  );
  checkClose('ATR[99] 골든 12.5/14', s2.climaxFlagCount[99] >= 0 ? atrSeries(high2, low2, close2, 14)[99] : null, 12.5 / 14, 1e-12);
  check('신고가 아님 → 플래그 수 골든 1 ((b)만)', s2.climaxFlagCount[99], 1);
  check('플래그 1 < 2 → 미발동', flagsAt(s2, 99, 100)['climax-top'], false);
}

console.log('14. distribution-high 경계값 골든 (13일 내 5회)');
{
  const n = 80;
  const close = new Array<number>(n).fill(100);
  const volume = new Array<number>(n).fill(1000);
  for (let i = 75; i <= 79; i++) volume[i] = 2000; // 5일
  const s5 = buildAppIndicatorSeries(mkBars({ close, volume }));
  check('디스트리뷰션 카운트 골든 5', s5.distributionCount[79], 5);
  check('카운트 5 ≥ 임계 5 → 발동', flagsAt(s5, 79, 100)['distribution-high'], true);

  const volume4 = new Array<number>(n).fill(1000);
  for (let i = 76; i <= 79; i++) volume4[i] = 2000; // 4일
  const s4 = buildAppIndicatorSeries(mkBars({ close, volume: volume4 }));
  check('디스트리뷰션 카운트 골든 4', s4.distributionCount[79], 4);
  check('카운트 4 < 5 → 미발동', flagsAt(s4, 79, 100)['distribution-high'], false);
}

console.log('15. weinstein-150-break / ma120-break 경계값 골든 (이탈 5일 이내)');
{
  const close: number[] = [];
  for (let i = 0; i <= 189; i++) close.push(100 + 0.5 * i); // → 194.5
  for (let i = 190; i <= 199; i++) close.push(60);
  const s = buildAppIndicatorSeries(mkBars({ close }));

  check('MA150 이탈 경과일 골든 5 (i=195)', s.breakBelowMaDays[150][195], 5);
  check('MA150 이탈 경과일 골든 6 (i=196)', s.breakBelowMaDays[150][196], 6);
  check('이탈 5일차 → 발동', flagsAt(s, 195, 300)['weinstein-150-break'], true);
  check('이탈 6일차(>5) → 미발동', flagsAt(s, 196, 300)['weinstein-150-break'], false);

  check('MA120 이탈 경과일 골든 5 (i=195)', s.breakBelowMaDays[120][195], 5);
  check('MA120 이탈 경과일 골든 6 (i=196)', s.breakBelowMaDays[120][196], 6);
  check('MA120 이탈 5일차 → 발동', flagsAt(s, 195, 300)['ma120-break'], true);
  check('MA120 이탈 6일차(>5) → 미발동', flagsAt(s, 196, 300)['ma120-break'], false);

  // MA150 미산출 구간(60봉) → 미발동
  const short = constFixture(95);
  check('MA150 미산출 → 미발동', flagsAt(short, 59, 100)['weinstein-150-break'], false);
  check('MA120 미산출 → 미발동', flagsAt(short, 59, 100)['ma120-break'], false);
}

console.log('16. 설정 상수 골든 (앱 alertRules.ts 기본값 고정)');
{
  check('재현 규칙 13종', APP_SELL_RULE_IDS.length, 13);
  check('손절 임계 5', APP_RULE_CONST.lossThreshold, 5);
  check('데드크로스 5/20', `${APP_RULE_CONST.deadCrossShort}/${APP_RULE_CONST.deadCrossLong}`, '5/20');
  check('데드크로스 lookback 252', APP_RULE_CONST.deadCrossMaxLookback, 252);
  check('고점대비 임계 20', APP_RULE_CONST.dropFromHighThreshold, 20);
  check('목표수익 20', APP_RULE_CONST.profitTarget, 20);
  check('과열익절 15 / 3일', `${APP_RULE_CONST.overheatProfitTarget}/${APP_RULE_CONST.overheatWithinDays}`, '15/3');
  check('급락 임계 5', APP_RULE_CONST.dailyCrashThreshold, 5);
  check('클라이맥스 플래그 2 · 기울기 2.5 · ATR 2.5', `${APP_RULE_CONST.climaxFlagsRequired}/${APP_RULE_CONST.climaxSlopeMultiplier}/${APP_RULE_CONST.climaxAtrMultiple}`, '2/2.5/2.5');
  check('디스트리뷰션 13/1.5/5', `${APP_RULE_CONST.distributionWindow}/${APP_RULE_CONST.distributionVolumeRatio}/${APP_RULE_CONST.distributionThreshold}`, '13/1.5/5');
  check('와인스타인 150/5', `${APP_RULE_CONST.weinsteinMa}/${APP_RULE_CONST.weinsteinWithinDays}`, '150/5');
  check('MA120 120/5', `${APP_RULE_CONST.ma120Period}/${APP_RULE_CONST.ma120WithinDays}`, '120/5');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('17. C(기존규칙 OR) · D(C ∪ 신규신호) 결합 로직 골든');
{
  // C: 상수열 + −5% 마감 → stop-loss·trend-break·daily-crash·swing-low-break 4종 발동
  const s95 = constFixture(95);
  const f = flagsAt(s95, 59, 100);
  check('C 발동 규칙 목록 골든', firedAppRules(f).join(','), 'stop-loss,trend-break,daily-crash,swing-low-break');
  check('C 트리거 = true', anyAppRuleFired(f), true);

  // 전부 미발동 케이스: 상수열 + 보합, 매수가 100
  const s100 = constFixture(100);
  const f0 = flagsAt(s100, 59, 100);
  check('보합 → 발동 규칙 0종', firedAppRules(f0).length, 0);
  check('C 트리거 = false', anyAppRuleFired(f0), false);

  // D = C ∪ 신규신호. **신규신호만** 발동하는 상황을 만든다:
  //   160×50봉(과거 고점) → 100×45봉(횡보) → 109,118,127,136,145(5일 +45%)
  //   · S2(5거래일 +40%)는 발동 · 52주 고점 160 > 145 이므로 클라이맥스(c)·고점대비(−9.4%)는 미발동
  //   · 당일 매수(수익률 0%) → 손절/익절류 미발동, 종가 145 > MA20 106.75 → 추세이탈 미발동
  const closeD: number[] = [];
  for (let i = 0; i < 50; i++) closeD.push(160);
  for (let i = 50; i <= 94; i++) closeD.push(100);
  for (const v of [109, 118, 127, 136, 145]) closeD.push(v);
  const barsD = mkBars({ close: closeD });
  const sD = buildAppIndicatorSeries(barsD);
  checkClose('MA20[99] 골든 106.75', sD.ma[20][99], 106.75, 1e-9);
  checkClose('MA5[99] 골든 127', sD.ma[5][99], 127, 1e-9);
  checkClose('트레일링252 최고 종가 골든 160', sD.trailingHigh252[99], 160);
  const fD = flagsAt(sD, 99, 145); // 당일 매수 상태(수익률 0%)
  const cFired = anyAppRuleFired(fD);
  const s2 = testSignalAt('S2_RUNUP_5D_40', barsD, 99, new Set<string>());
  const s1 = testSignalAt('S1_RUNUP_21D_100', barsD, 99, new Set<string>());
  check('C 미발동(발동 규칙 목록 비어있음)', firedAppRules(fD).join(','), '');
  check('C = false', cFired, false);
  check('S2(5일 +45%) = true', s2, true);
  check('S1(21일 +45% < +100%) = false', s1, false);
  check('D = C ∪ NEW = true', cFired || s2 || s1, true);

  // C가 이미 발동한 날 신규신호가 겹치면 D는 여전히 true(중복) — 중복률 계산 규약
  const bars95 = mkBars({ close: (() => { const c = new Array<number>(60).fill(100); c[59] = 95; return c; })() });
  const s6 = testSignalAt('S6_CRASH_5_VOLUME_2X', bars95, 59, new Set<string>());
  check('S6(−5%인데 거래량 2배 아님) = false', s6, false);
  check('C=true·NEW=false → D=true(중복 아님)', anyAppRuleFired(flagsAt(s95, 59, 100)) || s6, true);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('18. 앱 실제 함수 경로와의 독립 구현 동치 (buildEnrichedIndicator → matchesRule)');
{
  function appFlags(
    bars: SecurityBars,
    i: number,
    purchasePrice: number,
    highestPrice: number
  ): Record<string, boolean> {
    const end = i + 1;
    const enriched = buildEnrichedIndicator({
      sortedDates: bars.dates.slice(0, end) as string[],
      closes: bars.adjClose.slice(0, end) as number[],
      opens: bars.adjOpen.slice(0, end) as number[],
      highs: bars.adjHigh.slice(0, end) as number[],
      lows: bars.adjLow.slice(0, end) as number[],
      volumes: bars.adjVolume.slice(0, end) as number[],
    });
    const close = bars.adjClose[i];
    const prev = i >= 1 ? bars.adjClose[i - 1] : close;
    // 앱 usePortfolioCalculator 산식 그대로: changeRate=(종가−전일)/전일,
    // returnPercentage=(profitLoss/purchaseValue)×100 (수량 1 기준)
    const changeRate = prev > 0 ? (close - prev) / prev : 0;
    const returnPercentage = purchasePrice > 0 ? ((close - purchasePrice) / purchasePrice) * 100 : 0;
    const dropFromHigh = highestPrice > 0 ? ((close - highestPrice) / highestPrice) * 100 : 0;
    const asset = {
      id: 'x',
      ticker: bars.code,
      name: bars.code,
      categoryId: 1,
      exchange: '',
      quantity: 1,
      purchasePrice,
      purchaseDate: '',
      currency: Currency.KRW,
      currentPrice: close,
      priceOriginal: close,
      highestPrice,
      changeRate,
      indicators: undefined,
      metrics: {
        purchasePrice,
        currentPrice: close,
        currentPriceKRW: close,
        purchasePriceKRW: purchasePrice,
        purchaseValue: purchasePrice,
        currentValue: close,
        purchaseValueKRW: purchasePrice,
        currentValueKRW: close,
        returnPercentage,
        allocation: 0,
        dropFromHigh,
        profitLoss: 0,
        profitLossKRW: 0,
        diffFromHigh: 0,
        yesterdayChange: changeRate * 100,
        diffFromYesterday: 0,
      },
    } as unknown as EnrichedAsset;
    const out: Record<string, boolean> = {};
    for (const id of APP_SELL_RULE_IDS) {
      const rule = DEFAULT_ALERT_RULES.find((r) => r.id === id);
      out[id] = rule ? matchesRule(asset, rule, enriched) : false;
    }
    return out;
  }

  interface Case {
    name: string;
    bars: SecurityBars;
    i: number;
    purchase: number;
    highest: number;
  }
  const cases: Case[] = [];
  {
    const c = new Array<number>(60).fill(100);
    c[59] = 95;
    cases.push({ name: '상수+(-5%)', bars: mkBars({ close: c }), i: 59, purchase: 100, highest: 100 });
  }
  {
    const c = new Array<number>(60).fill(100);
    c[59] = 120;
    cases.push({ name: '상수+(+20%)', bars: mkBars({ close: c }), i: 59, purchase: 100, highest: 120 });
  }
  {
    const c: number[] = [];
    for (let i = 0; i <= 39; i++) c.push(100 + i);
    for (let k = 0; k < 15; k++) c.push(139 - 2 * (k + 1));
    cases.push({ name: '데드크로스', bars: mkBars({ close: c }), i: 54, purchase: 100, highest: 139 });
  }
  {
    const c = Array.from({ length: 100 }, (_, i) => 200 - i);
    cases.push({ name: '장기하락', bars: mkBars({ close: c }), i: 99, purchase: 200, highest: 126.25 });
  }
  {
    const n = 100;
    const close = Array.from({ length: n }, (_, i) => 100 + 0.5 * i);
    const open = close.slice();
    const high = close.slice();
    const low = close.slice();
    const volume = new Array<number>(n).fill(1000);
    volume[n - 1] = 5000;
    high[n - 1] = close[n - 1] + 3;
    low[n - 1] = close[n - 1] - 3;
    open[n - 1] = close[n - 1] - 2;
    cases.push({
      name: '클라이맥스',
      bars: mkBars({ close, open, high, low, volume }),
      i: 99,
      purchase: 100,
      highest: 149.5,
    });
  }
  {
    const n = 80;
    const close = new Array<number>(n).fill(100);
    const volume = new Array<number>(n).fill(1000);
    for (let i = 75; i <= 79; i++) volume[i] = 2000;
    cases.push({ name: '디스트리뷰션', bars: mkBars({ close, volume }), i: 79, purchase: 100, highest: 100 });
  }
  {
    const c: number[] = [];
    for (let i = 0; i <= 189; i++) c.push(100 + 0.5 * i);
    for (let i = 190; i <= 199; i++) c.push(60);
    cases.push({ name: 'MA150/120 이탈 5일차', bars: mkBars({ close: c }), i: 195, purchase: 300, highest: 194.5 });
    cases.push({ name: 'MA150/120 이탈 6일차', bars: mkBars({ close: c }), i: 196, purchase: 300, highest: 194.5 });
  }
  {
    const close: number[] = [100];
    for (let i = 1; i <= 30; i++) close.push(close[i - 1] + (i % 2 === 1 ? 1 : -1));
    const jump = close.length;
    close.push(close[close.length - 1] + 30);
    for (let k = 0; k < 4; k++) close.push(close[close.length - 1]);
    const b = mkBars({ close });
    cases.push({ name: '과열익절 진입일', bars: b, i: jump, purchase: 100, highest: close[jump] });
    cases.push({ name: '과열익절 +4일', bars: b, i: jump + 4, purchase: 100, highest: close[jump] });
  }
  {
    const close: number[] = [];
    for (let i = 0; i < 20; i++) close.push(100);
    close.push(90);
    for (let i = 21; i <= 34; i++) close.push(100 + (i - 20));
    for (let i = 35; i <= 39; i++) close.push(85);
    cases.push({ name: 'swing low 이탈', bars: mkBars({ close }), i: 39, purchase: 100, highest: 114 });
  }

  let mismatch = 0;
  for (const cse of cases) {
    const s = buildAppIndicatorSeries(cse.bars);
    const repro = evaluateAppSellRules(s, cse.i, {
      purchasePrice: cse.purchase,
      highestPrice: cse.highest,
    });
    const app = appFlags(cse.bars, cse.i, cse.purchase, cse.highest);
    for (const id of APP_SELL_RULE_IDS) {
      if (repro[id] !== app[id]) {
        mismatch++;
        console.error(`  x [${cse.name}] ${id}: 앱=${app[id]} 재현=${repro[id]}`);
      }
    }
    check(`동치 — ${cse.name}`, APP_SELL_RULE_IDS.map((id) => (repro[id] ? '1' : '0')).join(''), APP_SELL_RULE_IDS.map((id) => (app[id] ? '1' : '0')).join(''));
  }
  check('앱경로 vs 재현경로 불일치 0건', mismatch, 0);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
