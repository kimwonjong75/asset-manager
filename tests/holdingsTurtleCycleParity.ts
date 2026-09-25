// tests/holdingsTurtleCycleParity.ts
// holdings-turtle-cycle-v1 골든·불변식 테스트. 오프라인·합성 데이터 전용(실사용자 데이터 없음).
// 실행: npx tsx tests/holdingsTurtleCycleParity.ts

import { buildSecurity, SecurityData } from '../scripts/backtest/holdingsTurtleCycle/data';
import {
  simulateCell, isSkip, monthlyFirstTradingDayIndices, yearsBetweenIso, latestChannelStatus, VariantRules,
} from '../scripts/backtest/holdingsTurtleCycle/engine';
import { computeCostRates, baseOneWayRate, krSellTaxRate } from '../scripts/backtest/holdingsTurtleCycle/costs';
import { classifyExchange, resolveSymbol, isKrEtfName } from '../scripts/backtest/holdingsTurtleCycle/symbolResolve';
import { parseHoldingsCsvText, dedupeByTicker } from '../scripts/backtest/holdingsTurtleCycle/csvHoldings';
import { median, percentile, leaveOneOutMaxContributor, periodBucketOf } from '../scripts/backtest/holdingsTurtleCycle/aggregate';
import { runGrid } from '../scripts/backtest/holdingsTurtleCycle/gridRunner';
import { detectDrawdownEpisodes, decomposeEpisodes } from '../scripts/backtest/holdingsTurtleCycle/episodeAnalysis';
import { computeN } from '../utils/turtleEngine';
import type { SymbolSeries } from '../scripts/backtest/lib/fetchHistory';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number, expected: number, tol = 1e-9): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${actual} (tol ${tol})`); }
}
function checkTrue(name: string, v: boolean): void { check(name, v, true); }
function checkThrows(name: string, fn: () => void): void {
  try { fn(); fail++; console.error(`  ✗ ${name}\n      기대=throw 실제=정상반환`); }
  catch { pass++; }
}

// ── 합성 데이터 헬퍼 ─────────────────────────────────────────────────────
function iso(i: number): string {
  return new Date(Date.parse('2015-01-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
}

interface Bar { o: number; h: number; l: number; c: number }

function mkSymbolSeries(bars: Bar[]): SymbolSeries {
  return {
    symbol: 'X',
    dates: bars.map((_, i) => iso(i)),
    open: bars.map(b => b.o), high: bars.map(b => b.h),
    low: bars.map(b => b.l), close: bars.map(b => b.c),
    ok: true,
  };
}

function buildTestSecurity(bars: Bar[], opts: Partial<{
  currency: 'KRW' | 'USD' | 'JPY'; isCryptoTicker: boolean; isKrEtf: boolean;
}> = {}): SecurityData {
  return buildSecurity({
    ticker: 'X', name: '테스트종목', assetClass: '한국주식',
    currency: opts.currency ?? 'KRW', isCryptoTicker: opts.isCryptoTicker ?? false, isKrEtf: opts.isKrEtf ?? false,
    raw: mkSymbolSeries(bars), atrPeriod: 5, lookbacks: [3, 5],
  });
}

const V_TEST: VariantRules = { id: 'TEST', name: 'test', entryLookback: 5, exitLookback: 3, atrPeriod: 5, stopMultipleN: 2 };

console.log('holdings-turtle-cycle-v1 골든·불변식 테스트\n');

// ════════════════════════════════════════════════════════════════════════════
console.log('1. symbolResolve — 통화·심볼·ETF 판정');
// ════════════════════════════════════════════════════════════════════════════
{
  check('KRX → KRW', classifyExchange('KRX (코스피/코스닥)').currency, 'KRW');
  check('도쿄 표기 → JPY', classifyExchange('TSE (도쿄)').currency, 'JPY');
  check('도쿄증권거래소 → JPY', classifyExchange('도쿄증권거래소').currency, 'JPY');
  check('주요 거래소 (종합) → USD+코인거래소', classifyExchange('주요 거래소 (종합)').currency, 'USD');
  checkTrue('주요 거래소 (종합) isCryptoExchange', classifyExchange('주요 거래소 (종합)').isCryptoExchange);
  check('NYSE → USD', classifyExchange('NYSE').currency, 'USD');
  checkTrue('NYSE isCryptoExchange=false', !classifyExchange('NYSE').isCryptoExchange);

  const btc = resolveSymbol({ ticker: 'BTC', exchange: '주요 거래소 (종합)', name: '비트코인' });
  check('BTC fetchSymbol', btc.fetchSymbol, 'BTC-USD');
  checkTrue('BTC isCryptoTicker', btc.isCryptoTicker);

  const kr = resolveSymbol({ ticker: '069500', exchange: 'KRX (코스피/코스닥)', name: 'KODEX 200' });
  check('KRX fetchSymbol = 원형(6자리), .KS 접미 없음', kr.fetchSymbol, '069500');
  checkTrue('KODEX → KR ETF', kr.isKrEtf);

  const kr2 = resolveSymbol({ ticker: '005380', exchange: 'KRX (코스피/코스닥)', name: '현대차' });
  checkTrue('개별주(현대차) → KR ETF 아님', !kr2.isKrEtf);

  const jp = resolveSymbol({ ticker: '8002.T', exchange: 'TSE (도쿄)', name: '마루베니' });
  check('도쿄 fetchSymbol 그대로', jp.fetchSymbol, '8002.T');
  check('도쿄 통화 JPY', jp.currency, 'JPY');

  checkTrue('TIGER 이름 → ETF', isKrEtfName('TIGER 차이나테크TOP10'));
  checkTrue('KB RISE...상장지수투자신탁 → ETF', isKrEtfName('KB RISE KIS국고채30년Enhanced증권상장지수투자신탁(채권)'));
  checkTrue('풍산 → ETF 아님', !isKrEtfName('풍산'));
  checkTrue('고려아연 → ETF 아님', !isKrEtfName('고려아연'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('2. costs — 비용 모델');
// ════════════════════════════════════════════════════════════════════════════
{
  check('코인 편도율 0.05%', baseOneWayRate({ currency: 'USD', isCryptoTicker: true, isKrEtf: false }), 0.0005);
  check('일반 편도율 0.1%', baseOneWayRate({ currency: 'USD', isCryptoTicker: false, isKrEtf: false }), 0.001);

  // 2015-01-12 → 구 세율 30bps (2010-01-01~2019-03-31)
  checkClose('KR 개별주 매도세 2015년 30bps', krSellTaxRate({ currency: 'KRW', isCryptoTicker: false, isKrEtf: false }, '2015-01-12'), 0.003, 1e-12);
  // 2024-01-01 → 18bps (2023-05-01~)
  checkClose('KR 개별주 매도세 2024년 18bps', krSellTaxRate({ currency: 'KRW', isCryptoTicker: false, isKrEtf: false }, '2024-01-01'), 0.0018, 1e-12);
  check('KR ETF는 매도세 면제', krSellTaxRate({ currency: 'KRW', isCryptoTicker: false, isKrEtf: true }, '2015-01-12'), 0);
  check('USD는 매도세 없음', krSellTaxRate({ currency: 'USD', isCryptoTicker: false, isKrEtf: false }, '2015-01-12'), 0);
  check('코인은 매도세 없음', krSellTaxRate({ currency: 'KRW', isCryptoTicker: true, isKrEtf: false }, '2015-01-12'), 0);

  const r0 = computeCostRates({ currency: 'KRW', isCryptoTicker: false, isKrEtf: false }, '2015-01-12', 0);
  check('비용 0단계 → buyRate 0', r0.buyRate, 0);
  check('비용 0단계 → sellRate 0', r0.sellRate, 0);
  const r1 = computeCostRates({ currency: 'KRW', isCryptoTicker: false, isKrEtf: false }, '2015-01-12', 1);
  checkClose('비용 기본 → buyRate 0.1%', r1.buyRate, 0.001, 1e-12);
  checkClose('비용 기본 → sellRate 0.1%+0.3%=0.4%', r1.sellRate, 0.004, 1e-12);
  const r2 = computeCostRates({ currency: 'KRW', isCryptoTicker: false, isKrEtf: false }, '2015-01-12', 2);
  checkClose('비용 2배 → buyRate 0.2%', r2.buyRate, 0.002, 1e-12);
  checkClose('비용 2배 → sellRate 0.8%(세금 포함 스케일)', r2.sellRate, 0.008, 1e-12);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('3. computeN parity — 앱 utils/turtleEngine.computeN 과 동일 값');
// ════════════════════════════════════════════════════════════════════════════
{
  // 평탄바 20개(h=10250,l=9750,c=10000) → TR=500 고정 → ATR(20 기간이면 워밍업 부족, 5기간으로 검증)
  const bars: Bar[] = [];
  for (let i = 0; i < 10; i++) bars.push({ o: 10000, h: 10250, l: 9750, c: 10000 });
  const sec = buildTestSecurity(bars);
  const idx = 9;
  checkClose('data.ts atr[9] = 500', sec.atr[idx] as number, 500, 1e-9);
  const nViaApp = computeN(
    sec.ownHigh.slice(0, idx + 1), sec.ownLow.slice(0, idx + 1), sec.ownClose.slice(0, idx + 1), 5
  );
  checkTrue('computeN 결과가 null이 아님', nViaApp !== null);
  checkClose('data.ts atr[i] ≡ utils/turtleEngine.computeN(슬라이스)', sec.atr[idx] as number, nViaApp as number, 1e-9);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('4. 비정상 OHLC 행 제거 (classifyBar 재사용) — 채널 창을 오염시키지 않음');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 5; i++) bars.push({ o: 100, h: 110, l: 90, c: 100 });
  // 6번째 행: 전부 null 취급될 값(비정상) — 여기서는 OHLC 관계 위반(l>h)으로 만든다.
  bars.push({ o: 100, h: 90, l: 110, c: 100 }); // l>h — 비정상
  for (let i = 0; i < 5; i++) bars.push({ o: 200, h: 210, l: 190, c: 200 });
  const sec = buildTestSecurity(bars);
  check('비정상 행 1건 제외 기록', sec.excludedRows.length, 1);
  check('제외 사유 = ohlc-relation', sec.excludedRows[0].reason, 'ohlc-relation');
  check('유효 거래일 배열에서 제거되어 11행 → 10행', sec.ownDates.length, 10);
  // 비정상 행이 제거됐으므로 own 인덱스 5는 곧바로 200대 값이어야 한다.
  check('제거 후 idx5 close = 200', sec.ownClose[5], 200);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('5. 채널이 현재 봉을 포함하지 않음(현재봉 제외)');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 10; i++) bars.push({ o: i + 1, h: i + 1, l: i + 1, c: i + 1 }); // 1..10 단조증가
  const sec = buildTestSecurity(bars);
  // lookback=5, idx=9(10번째, 값10) → 창=[4..8]=값[5..9] → max=9 (현재봉 10 제외)
  checkClose('highChannel[5][9] = 9 (현재봉 10 제외)', sec.highChannel[5][9] as number, 9, 1e-12);
  checkTrue('highChannel[5][9] ≠ 10', (sec.highChannel[5][9] as number) !== 10);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('6. 완전한 터틀 사이클 골든(비용 0) — 보유청산→현금→재진입→손절');
// ════════════════════════════════════════════════════════════════════════════
{
  // 상세 도출 과정은 PR 설명 참고. 모든 봉 h=c+250,l=c-250(TR=500 고정 유지) 규칙으로 ATR을 500에 고정한다.
  const C = [
    10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, // 0-9 (9=시작일)
    9750,  // 10: 신호일(청산) close<=loArr(9750)
    9500,  // 11: 체결일 — open=9400(갭)으로 별도 지정
    9250, 9250, 9250, 9250, 9250, // 12-16
    9500,  // 17: 신호일(재진입) close>=hiArr(9500)
    9600,  // 18: 체결일 — open=9600(재진입)
    9600, 9600, 9600, // 19-21
    8500,  // 22: 신호일(손절) close<=stopPrice(8600)
    8400,  // 23: 체결일 — open=8400(갭)
  ];
  const bars: Bar[] = C.map((c) => ({ o: c, h: c + 250, l: c - 250, c }));
  bars[11] = { ...bars[11], o: 9400 };
  bars[18] = { ...bars[18], o: 9600 };
  bars[23] = { ...bars[23], o: 8400 };

  const sec = buildTestSecurity(bars);
  const rules: VariantRules = { id: 'V1', name: 'test', entryLookback: 5, exitLookback: 3, atrPeriod: 5, stopMultipleN: 2 };
  const r = simulateCell(sec, 9, rules, 0);
  checkTrue('셀이 스킵되지 않음(워밍업 충족)', !isSkip(r));
  if (!isSkip(r)) {
    checkClose('atr[17] = 500 (신호일 N)', sec.atr[17] as number, 500, 1e-9);
    checkClose('B&H 최종비율 = 8400/10000 = 0.84', r.bhFinalRatio, 0.84, 1e-12);
    checkClose('터틀 최종비율 = (9400/10000)*(8400/9600) = 0.8225 (비용0)', r.turtleFinalRatio, 0.8225, 1e-9);
    checkClose('최종가치 비율(터틀/B&H) = 47/48', r.finalRatioRatio, 47 / 48, 1e-9);
    checkTrue('터틀이 B&H를 이기지 못함(이 셀)', !r.turtleBeatsBh);
    checkClose('B&H MDD = 0.16', r.bhMdd, 0.16, 1e-9);
    checkClose('터틀 MDD = 0.1775', r.turtleMdd, 0.1775, 1e-9);
    checkTrue('B&H -50% 미경험', !r.bhWorst50);
    checkTrue('터틀 -50% 미경험', !r.turtleWorst50);
    check('초기 보유분 청산일 = idx11 날짜', r.initialExitDate, iso(11));
    check('재진입(매수) 체결 1건', r.roundTrips, 1);
    check('완료된 왕복 1건', r.completedRoundTrips, 1);
    check('휩쏘 1건(매도 9400 → 7거래일 후 9600 재매수)', r.whipsaws, 1);
    checkClose('시장 참여 시간 = 7/15*100', r.timeInMarketPct, 7 / 15 * 100, 1e-9);
    check('종료 상태 = CASH', r.finalState, 'CASH');
    check('체결 로그 3건(매도·매수·매도)', r.fills.length, 3);
    check('체결1 = 매도/exit, 가격 9400 (신호가 9750이 아닌 실제 시가 — 클램프 없음)', r.fills[0].price, 9400);
    check('체결1 사유 = exit', r.fills[0].reason, 'exit');
    check('체결2 = 매수/entry, 가격 9600 (돌파선 9500이 아닌 실제 시가)', r.fills[1].price, 9600);
    check('체결2 사유 = entry', r.fills[1].reason, 'entry');
    check('체결3 = 매도/stop, 가격 8400 (손절가 8600이 아닌 실제 시가 — 갭 그대로)', r.fills[2].price, 8400);
    check('체결3 사유 = stop', r.fills[2].reason, 'stop');
  }

  // 같은 시나리오, 한국 개별주 비용 기본(0.1%+매도세 0.3%=0.4%, 매수 0.1%) 적용 — 명시적 골든.
  const rTaxed = simulateCell(sec, 9, rules, 1);
  if (!isSkip(rTaxed)) {
    const expected = 1 * (9400 / 10000) * (1 - 0.004) * (1 - 0.001) * (8400 / 9600) * (1 - 0.004);
    checkClose('KR 개별주 비용 기본 적용 골든', rTaxed.turtleFinalRatio, expected, 1e-9);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('7. 워밍업 미충족 → 스킵');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 3; i++) bars.push({ o: 100, h: 110, l: 90, c: 100 });
  const sec = buildTestSecurity(bars);
  const r = simulateCell(sec, 1, V_TEST, 0);
  checkTrue('워밍업 부족 → skip', isSkip(r));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('8. 입력 순서 무관 — 종목 배열을 섞어도 종목별 결과는 동일');
// ════════════════════════════════════════════════════════════════════════════
{
  function flatSeries(base: number, n: number): Bar[] {
    const out: Bar[] = [];
    for (let i = 0; i < n; i++) out.push({ o: base, h: base + 250, l: base - 250, c: base });
    return out;
  }
  const secA = buildSecurity({
    ticker: 'AAA', name: 'A', assetClass: '한국주식', currency: 'KRW', isCryptoTicker: false, isKrEtf: false,
    raw: mkSymbolSeries(flatSeries(10000, 30)), atrPeriod: 5, lookbacks: [3, 5],
  });
  const secB = buildSecurity({
    ticker: 'ZZZ', name: 'Z', assetClass: '한국주식', currency: 'KRW', isCryptoTicker: false, isKrEtf: false,
    raw: mkSymbolSeries(flatSeries(20000, 30)), atrPeriod: 5, lookbacks: [3, 5],
  });
  const g1 = runGrid([secA, secB], [V_TEST], [{ tier: 'zero', mult: 0 }], iso(0), iso(29));
  const g2 = runGrid([secB, secA], [V_TEST], [{ tier: 'zero', mult: 0 }], iso(0), iso(29));
  const sortKey = (c: { ticker: string; startDate: string }): string => `${c.ticker}|${c.startDate}`;
  const s1 = [...g1.cells].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const s2 = [...g2.cells].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  check('셀 개수 동일', s1.length, s2.length);
  let allMatch = true;
  for (let i = 0; i < s1.length; i++) {
    if (s1[i].ticker !== s2[i].ticker || s1[i].turtleFinalRatio !== s2[i].turtleFinalRatio) allMatch = false;
  }
  checkTrue('종목 배열 순서를 바꿔도 셀별 결과 동일', allMatch);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('9. monthlyFirstTradingDayIndices / yearsBetweenIso');
// ════════════════════════════════════════════════════════════════════════════
{
  const dates = [iso(0), iso(1), iso(31), iso(32), iso(62)]; // 2015-01-01,02,02-01,02-02,03-04
  const idxs = monthlyFirstTradingDayIndices(dates, iso(0), iso(62));
  check('월별 첫 거래일 3개(1월/2월/3월)', idxs.length, 3);
  check('첫 인덱스 0', idxs[0], 0);

  checkClose('yearsBetweenIso 365일 = 1년(365/365.2425)', yearsBetweenIso('2015-01-01', '2016-01-01'), 365 / 365.2425, 1e-9);
  check('yearsBetweenIso 동일일 = 0', yearsBetweenIso('2015-01-01', '2015-01-01'), 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('10. latestChannelStatus — 최신 상태(청산선 위/아래·재진입선까지 거리)');
// ════════════════════════════════════════════════════════════════════════════
{
  const bars: Bar[] = [];
  for (let i = 0; i < 10; i++) bars.push({ o: 10000, h: 10250, l: 9750, c: 10000 });
  bars.push({ o: 9000, h: 9250, l: 8750, c: 9000 }); // 마지막 봉: 청산선 아래
  const sec = buildTestSecurity(bars);
  const status = latestChannelStatus(sec, V_TEST);
  check('최신 종가 9000', status.latestClose, 9000);
  checkTrue('청산선 아래 판정', status.belowExit === true);
  checkTrue('재진입선까지 거리 > 0(양수 — 더 올라야 함)', (status.distanceToEntryPct as number) > 0);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('11. CSV 파서 — 헤더 검증·중복 티커 합산 (합성 데이터)');
// ════════════════════════════════════════════════════════════════════════════
{
  const HEADER = '종목명,티커,거래소,자산구분,보유수량,매수단가(자국통화),매수환율,총매수금액(원화),현재단가(원화),현재평가금액(원화),총손익(원화),수익률(%)';
  const csv = [
    HEADER,
    '테스트회사,TEST,NYSE,미국주식,10,100,1400,1400000,150,1500000,100000,7.14',
    '중복종목A,DUP,NASDAQ,미국주식,5,50,1400,350000,60,300000,-50000,-14.29',
    '중복종목B,DUP,NASDAQ,미국주식,3,50,1400,210000,60,180000,-30000,-14.29',
    '빈환율,EMPTY,NYSE,미국주식,1,10,,10000,12,12000,2000,20',
  ].join('\n');
  const rows = parseHoldingsCsvText('﻿' + csv); // BOM 포함
  check('행 수 4', rows.length, 4);
  check('BOM 제거 후 첫 행 이름 정상 파싱', rows[0].name, '테스트회사');
  check('빈 매수환율 → null', rows[3].buyFxRate, null);

  const uniq = dedupeByTicker(rows);
  check('고유 티커 3개(DUP 합산)', uniq.length, 3);
  const dup = uniq.find(u => u.ticker === 'DUP')!;
  check('DUP 보유수량 합산 = 8', dup.totalQuantity, 8);
  check('DUP 평가금액 합산 = 480000', dup.totalCurrentValueKRW, 480000);

  checkThrows('헤더 열 순서가 바뀌면 throw', () => {
    parseHoldingsCsvText('티커,종목명,거래소,자산구분,보유수량,매수단가(자국통화),매수환율,총매수금액(원화),현재단가(원화),현재평가금액(원화),총손익(원화),수익률(%)\nA,B,C,D,1,1,1,1,1,1,1,1');
  });
}

// ════════════════════════════════════════════════════════════════════════════
console.log('12. aggregate — median/percentile/구간분류/최대기여 제거 민감도');
// ════════════════════════════════════════════════════════════════════════════
{
  check('median([1,2,3]) = 2', median([1, 2, 3]), 2);
  checkClose('median([1,2,3,4]) = 2.5', median([1, 2, 3, 4]), 2.5, 1e-12);
  checkClose('percentile([0..10],0.5) = 5', percentile([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5, 1e-12);

  check('구간분류 2016 → 2015-2019', periodBucketOf('2016-05-01'), '2015-2019');
  check('구간분류 2021 → 2020-2022', periodBucketOf('2021-05-01'), '2020-2022');
  check('구간분류 2024 → 2023-present', periodBucketOf('2024-05-01'), '2023-present');

  function fakeCell(ticker: string, finalRatioRatio: number): Parameters<typeof leaveOneOutMaxContributor>[0][number] {
    return {
      ticker, startDate: '2015-01-01', startIdx: 0, endDate: '2016-01-01', years: 1,
      bhFinalRatio: 1, bhCagr: 0, bhMdd: 0, bhWorst50: false,
      turtleFinalRatio: finalRatioRatio, turtleCagr: 0, turtleMdd: 0, turtleWorst50: false,
      finalRatioRatio, turtleBeatsBh: finalRatioRatio > 1, timeInMarketPct: 100,
      roundTrips: 0, completedRoundTrips: 0, whipsaws: 0, initialExitDate: null,
      finalState: 'HOLD_INITIAL', fills: [],
    };
  }
  // A: 살짝 우위(1.05) 5셀, B: 압도적 우위(3.0) 1셀 → 전체 median>1(B의 극단값 때문일 수 있음), B 제거 시 결론이 뒤집히는지 확인.
  const cells = [
    ...Array.from({ length: 5 }, () => fakeCell('A', 1.05)),
    fakeCell('B', 3.0),
  ];
  const loo = leaveOneOutMaxContributor(cells)!;
  check('최대 기여 종목 = B', loo.droppedTicker, 'B');
  checkTrue('제거 후에도 median>1 유지(A만으로도 우위)', loo.after > 1);
  checkTrue('방향 불변(둘 다 median>1)', loo.directionUnchanged);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('13. 현금 이자 오버레이(cashAnnualRatePct) — §재검증 과제 "현금 0%/2.5%"');
// ════════════════════════════════════════════════════════════════════════════
{
  // 6번 골든과 동일 시나리오 재사용(체결 일정 동일 확인됨) — CASH 상태 기간에만 이자가 복리로 붙는지 확인.
  // 매도 체결(idx11) 직후 → 재매수 체결(idx18)까지, CASH 상태로 "상단(0단계)에서 이자 반영"되는 실제
  // 캘린더일수는 12,13,14,15,16,17,18 이터레이션 총 7일(매수 체결일 당일 아침까지의 이자도 포함 — 엔진
  // 설계상 "그날 매수가 체결되기 직전까지"의 현금 보유 기간으로 취급, 본문 주석 참고).
  const C = [
    10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000,
    9750, 9500, 9250, 9250, 9250, 9250, 9250, 9500, 9600, 9600, 9600, 9600, 8500, 8400,
  ];
  const bars: Bar[] = C.map((c) => ({ o: c, h: c + 250, l: c - 250, c }));
  bars[11] = { ...bars[11], o: 9400 };
  bars[18] = { ...bars[18], o: 9600 };
  bars[23] = { ...bars[23], o: 8400 };
  const sec = buildTestSecurity(bars);
  const rules: VariantRules = { id: 'V1', name: 'test', entryLookback: 5, exitLookback: 3, atrPeriod: 5, stopMultipleN: 2 };

  const rNoInterest = simulateCell(sec, 9, rules, 0, { cashAnnualRatePct: 0 });
  checkTrue('현금이자 0% 옵션도 스킵 안 됨', !isSkip(rNoInterest));
  if (!isSkip(rNoInterest)) {
    checkClose('현금이자 0%는 기존 골든과 동일(하위호환)', rNoInterest.turtleFinalRatio, 0.8225, 1e-9);
  }

  const rInterest = simulateCell(sec, 9, rules, 0, { cashAnnualRatePct: 2.5 });
  checkTrue('현금이자 2.5% 옵션도 스킵 안 됨', !isSkip(rInterest));
  if (!isSkip(rInterest) && !isSkip(rNoInterest)) {
    const cashRatePerDay = Math.pow(1 + 2.5 / 100, 1 / 365.2425) - 1;
    const expected = 0.8225 * Math.pow(1 + cashRatePerDay, 7); // CASH 7일(달력일) 복리
    checkClose('현금이자 2.5% — CASH 7일 복리 반영된 최종비율', rInterest.turtleFinalRatio, expected, 1e-9);
    checkTrue('현금이자가 붙으면 무이자보다 최종비율이 더 높음', rInterest.turtleFinalRatio > rNoInterest.turtleFinalRatio);
    checkTrue('B&H는 현금이자와 무관(변화 없음)', rInterest.bhFinalRatio === rNoInterest.bhFinalRatio);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('14. maxEndIdx(고정기간 롤링 창) — 창 밖 체결 누출 금지');
// ════════════════════════════════════════════════════════════════════════════
{
  const C = [
    10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000,
    9750, 9500, 9250, 9250, 9250, 9250, 9250, 9500, 9600, 9600, 9600, 9600, 8500, 8400,
  ];
  const bars: Bar[] = C.map((c) => ({ o: c, h: c + 250, l: c - 250, c }));
  bars[11] = { ...bars[11], o: 9400 };
  bars[18] = { ...bars[18], o: 9600 };
  bars[23] = { ...bars[23], o: 8400 };
  const sec = buildTestSecurity(bars);
  const rules: VariantRules = { id: 'V1', name: 'test', entryLookback: 5, exitLookback: 3, atrPeriod: 5, stopMultipleN: 2 };

  // 창을 idx14에서 자름 — 매도(idx11)는 창 안, 재진입 신호(idx17)·체결(idx18)은 창 밖.
  const r14 = simulateCell(sec, 9, rules, 0, { maxEndIdx: 14 });
  checkTrue('maxEndIdx=14: 스킵 안 됨', !isSkip(r14));
  if (!isSkip(r14)) {
    check('종료일 = idx14 날짜', r14.endDate, iso(14));
    checkClose('B&H 최종비율 = 9250/10000', r14.bhFinalRatio, 0.925, 1e-12);
    checkClose('터틀 최종비율 = 매도 후 현금 그대로(0.94, 재진입 신호는 창 밖)', r14.turtleFinalRatio, 0.94, 1e-12);
    check('체결 1건(매도만, 매수는 창 밖이라 없음)', r14.fills.length, 1);
    check('종료 상태 = CASH', r14.finalState, 'CASH');
  }

  // 창을 idx17(신호일 그 자체)에서 자름 — i+1(=18)이 lastIdx(17)를 넘으므로 체결 예약 자체가 안 됨.
  const r17 = simulateCell(sec, 9, rules, 0, { maxEndIdx: 17 });
  checkTrue('maxEndIdx=17: 스킵 안 됨', !isSkip(r17));
  if (!isSkip(r17)) {
    check('신호일 자체로 창을 잘라도 체결은 예약되지 않음(체결 1건 유지)', r17.fills.length, 1);
    check('종료 상태 여전히 CASH(재진입 미체결)', r17.finalState, 'CASH');
    checkClose('터틀 최종비율 = 0.94(변화 없음)', r17.turtleFinalRatio, 0.94, 1e-12);
  }

  // maxEndIdx 미지정 시 기존 동작과 완전히 동일해야 함(하위호환).
  const rFull = simulateCell(sec, 9, rules, 0);
  const rFullExplicit = simulateCell(sec, 9, rules, 0, {});
  checkTrue('rFull 스킵 안 됨', !isSkip(rFull));
  checkTrue('rFullExplicit 스킵 안 됨', !isSkip(rFullExplicit));
  if (!isSkip(rFull) && !isSkip(rFullExplicit)) {
    checkClose('opts 생략과 opts={} 는 동일한 결과', rFull.turtleFinalRatio, rFullExplicit.turtleFinalRatio, 1e-15);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('15. detectDrawdownEpisodes — 고점 대비 −20%+ 하락 에피소드 탐지(순수)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 손으로 추적한 시나리오: 고점(idx10=13000)→저점(idx15=9000, -30.77%)→회복(idx20=13500),
  // 그 뒤 다시 고점(idx15… 아님, 별도 배열) — 여기서는 20%/25% 경계값 케이스를 검증하는 두 번째 배열 사용.
  const dates = Array.from({ length: 17 }, (_, i) => iso(i));
  const closes = [100, 120, 150, 200, 180, 160, 150, 170, 190, 210, 205, 190, 168, 175, 195, 220, 150];
  // 고점3(200)→저점6(150): -25% / 고점9(210)→저점12(168): 정확히 -20% / 고점15(220)→저점16(150, 미회복): -31.82%

  const eps20 = detectDrawdownEpisodes(dates, closes, 20);
  check('임계값 20%: 에피소드 3건', eps20.length, 3);
  if (eps20.length === 3) {
    check('에피소드1 고점 idx=3', eps20[0].peakIdx, 3);
    check('에피소드1 저점 idx=6', eps20[0].troughIdx, 6);
    checkClose('에피소드1 하락폭 25%', eps20[0].drawdownPct, 25, 1e-9);
    check('에피소드1 회복 idx=9(신고점 210)', eps20[0].recoveredIdx, 9);

    check('에피소드2 고점 idx=9(210)', eps20[1].peakIdx, 9);
    check('에피소드2 저점 idx=12(168)', eps20[1].troughIdx, 12);
    checkClose('에피소드2 하락폭 정확히 20%(경계값)', eps20[1].drawdownPct, 20, 1e-9);
    check('에피소드2 회복 idx=15(신고점 220)', eps20[1].recoveredIdx, 15);

    check('에피소드3 고점 idx=15(220)', eps20[2].peakIdx, 15);
    check('에피소드3 저점 idx=16(150, 데이터 끝)', eps20[2].troughIdx, 16);
    checkTrue('에피소드3 미회복(recoveredIdx=null)', eps20[2].recoveredIdx === null);
    checkTrue('에피소드3 미회복이면 recoveredDate도 null', eps20[2].recoveredDate === null);
  }

  const eps25 = detectDrawdownEpisodes(dates, closes, 25);
  check('임계값 25%: 경계값 에피소드(정확히 20%)는 탈락 → 2건만', eps25.length, 2);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('16. decomposeEpisodes — 피한 하락 vs 놓친 반등 분해(엔진 실제 궤적 재사용)');
// ════════════════════════════════════════════════════════════════════════════
{
  // 손으로 추적: 고점(idx10=13000)에서 이미 보유 중(HOLD_INITIAL) → idx13 신호로 idx14에 매도(청산선 이탈,
  // 갭 하락 체결 9400→12600) → CASH 상태로 저점(idx15=9000)까지 하락을 대부분 피함 → idx18 신호로 idx19에
  // 재진입 체결(9600, 갭) → idx20에 13500으로 신고점 회복(에피소드 회복 판정).
  const bars: Bar[] = [];
  for (let i = 0; i < 10; i++) bars.push({ o: 10000, h: 10250, l: 9750, c: 10000 }); // 0-9, start=9
  bars.push({ o: 13000, h: 13250, l: 12750, c: 13000 }); // 10 (고점)
  bars.push({ o: 13000, h: 13250, l: 12750, c: 13000 }); // 11
  bars.push({ o: 13000, h: 13250, l: 12750, c: 13000 }); // 12
  bars.push({ o: 12700, h: 12950, l: 12450, c: 12700 }); // 13 (청산 신호일)
  bars.push({ o: 12600, h: 12750, l: 12450, c: 12500 }); // 14 (매도 체결, 갭 12600)
  bars.push({ o: 9000, h: 9250, l: 8750, c: 9000 });      // 15 (저점)
  bars.push({ o: 9000, h: 9250, l: 8750, c: 9000 });      // 16
  bars.push({ o: 9000, h: 9250, l: 8750, c: 9000 });      // 17
  bars.push({ o: 9500, h: 9750, l: 9250, c: 9500 });      // 18 (재진입 신호일)
  bars.push({ o: 9600, h: 9950, l: 9450, c: 9700 });      // 19 (매수 체결, 갭 9600)
  bars.push({ o: 13500, h: 13750, l: 13250, c: 13500 }); // 20 (회복 — 신고점)

  const sec = buildSecurity({
    ticker: 'EP', name: '에피소드테스트', assetClass: '실물자산', currency: 'USD', isCryptoTicker: false, isKrEtf: false,
    raw: mkSymbolSeries(bars), atrPeriod: 5, lookbacks: [3],
  });
  const rules: VariantRules = { id: 'EP', name: 'test', entryLookback: 3, exitLookback: 3, atrPeriod: 5, stopMultipleN: 2 };

  const { episodes, skipped } = decomposeEpisodes(sec, rules, 0, 9, { cashAnnualRatePct: 0, thresholdPct: 20 });
  checkTrue('스킵되지 않음', !skipped);
  check('에피소드 1건(고점이 시작일 이후라 포함됨)', episodes.length, 1);
  if (episodes.length === 1) {
    const e = episodes[0];
    check('고점 idx=10', e.peakIdx, 10);
    check('저점 idx=15', e.troughIdx, 15);
    check('회복 idx=20', e.recoveredIdx, 20);
    checkClose('B&H 하락폭 = 400/13% (30.77%)', e.bhDeclinePct, 400 / 13, 1e-9);
    checkClose('드로다운%(가격 기준)과 B&H 하락폭 항상 일치', e.drawdownPct, e.bhDeclinePct, 1e-9);
    checkClose('터틀 하락폭 = 40/13% (3.08% — 매도로 대부분 피함)', e.turtleDeclinePct, 40 / 13, 1e-9);
    checkClose('피한 하락폭 = 360/13%p (27.69%p)', e.avoidedDeclinePct, 360 / 13, 1e-9);
    checkClose('B&H 반등폭 = 50%(저점→회복)', e.bhReboundPct, 50, 1e-9);
    checkClose('터틀 반등폭 = 40.625%(재진입 지연으로 일부만 참여)', e.turtleReboundPct, 40.625, 1e-9);
    checkClose('놓친 반등폭 = 9.375%p', e.missedReboundPct, 9.375, 1e-9);
  }

  // 워밍업 시작을 고점(idx10) 이후로 늦추면 이 에피소드는 대상에서 제외되어야 한다(시작 전 고점은 포함 불가).
  const { episodes: episodesLate } = decomposeEpisodes(sec, rules, 0, 12, { thresholdPct: 20 });
  check('시작일을 고점 이후(idx12)로 하면 에피소드 0건(고점이 시작 이전)', episodesLate.length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
