// tests/turtleHoldingsParity.ts
// ---------------------------------------------------------------------------
// "보유종목 터틀" P0 순수 계산 골든 테스트 (계획서 PLAN_터틀중심_앱재정비_260925 §3.1·§6 P0).
// 명시적 절대값 고정 + 백테스트 모듈(scripts/backtest/portfolioTurtle/{exitRules,sizing}.ts)과의 교차 파리티.
//
// 실행: npx tsx tests/turtleHoldingsParity.ts

import {
  resolveHoldingsSettings, computeMaExitLine, initAtrTrailState, updateAtrTrailState,
  computeAtrTrailExitLine, computeExitLine, computeReentryLine, checkReentrySignal,
  computeFirstUnitSize, computePyramidUnitSize, computePyramidTriggerPrice, computeCommonStopPrice,
  evaluateLegacyHoldingsStatus, computeLambdaScale, checkTotalRiskLimit, isInHoldingsScope,
  classifyVolatility, describeStopExplanation, describeExitLineExplanation, describeStopOrderCheckText,
  formatMoney, roundHoldingsQty,
  DailyBar,
} from '../utils/turtleHoldings';
import { DEFAULT_TURTLE_HOLDINGS_SETTINGS, TurtleHoldingsSettings } from '../types/turtleHoldings';
import { checkExitSignal, checkEntrySignal, initTrailState, updateTrailState } from '../scripts/backtest/portfolioTurtle/exitRules';
import { sizeFixedUnitCapDiv, sizeUnitWithRoom, roundQty as btRoundQty } from '../scripts/backtest/portfolioTurtle/sizing';
import type { PortfolioSecurity } from '../scripts/backtest/portfolioTurtle/data';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}
function checkClose(name: string, actual: number | null, expected: number, tol = 1e-6): void {
  if (actual !== null && Number.isFinite(actual) && Math.abs(actual - expected) <= tol) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${expected} 실제=${String(actual)}`); }
}

const D = DEFAULT_TURTLE_HOLDINGS_SETTINGS;

function iso(i: number): string {
  const base = new Date('2026-01-01T00:00:00Z').getTime();
  return new Date(base + i * 86_400_000).toISOString().slice(0, 10);
}
function mkBars(closes: number[], highs?: number[], lows?: number[]): DailyBar[] {
  return closes.map((c, i) => ({
    date: iso(i),
    open: c,
    high: highs ? highs[i] : c + 1,
    low: lows ? lows[i] : c - 1,
    close: c,
  }));
}

// ════════════════════════════════════════════════════════════════════════════
// 0. 설정 병합·가드
// ════════════════════════════════════════════════════════════════════════════
{
  const resolved = resolveHoldingsSettings(undefined);
  check('기본값 entryLookback=55', resolved.entryLookback, 55);
  check('기본값 exitLookback=20', resolved.exitLookback, 20);
  check('기본값 pyramidSpacing=2R', resolved.pyramidSpacing, '2R');
  check('기본값 positionCapPct=10', resolved.positionCapPct, 10);
  check('기본값 maxTotalRiskPct=24', resolved.maxTotalRiskPct, 24);
  check('기본값 riskPerUnitPct=1', resolved.riskPerUnitPct, 1);

  const partial = resolveHoldingsSettings({ exitLookback: 10, positionCapPct: 15 });
  check('부분 저장본 — 지정값 반영(exitLookback)', partial.exitLookback, 10);
  check('부분 저장본 — 지정값 반영(positionCapPct)', partial.positionCapPct, 15);
  check('부분 저장본 — 나머지는 기본값(entryLookback)', partial.entryLookback, 55);

  const invalid = resolveHoldingsSettings({
    entryLookback: 5,            // 20 미만 → 가드
    exitLookback: 999,           // 55 초과 → 가드
    stopMultipleN: 10,           // 3 초과 → 가드
    riskPerUnitPct: 5,           // 1 초과 → 가드
    maxUnitsPerPosition: 0,      // 1 미만 → 가드
    positionCapPct: 1,           // 5 미만 → 가드
    maxTotalRiskPct: 1,          // 12 미만 → 가드
    exitMethod: 'bogus' as unknown as TurtleHoldingsSettings['exitMethod'],
    pyramidSizeMultiplier: 0.3 as unknown as 0.5,
  });
  check('범위 밖 entryLookback(5) → 하한 20으로 클램프', invalid.entryLookback, 20);
  check('범위 밖 exitLookback(999) → 상한 55로 클램프', invalid.exitLookback, 55);
  check('잘못된 stopMultipleN → 상한 3으로 클램프', invalid.stopMultipleN, 3);
  check('잘못된 riskPerUnitPct → 상한 1로 클램프', invalid.riskPerUnitPct, 1);
  check('잘못된 maxUnitsPerPosition → 하한 1로 클램프', invalid.maxUnitsPerPosition, 1);
  check('잘못된 positionCapPct → 하한 5로 클램프', invalid.positionCapPct, 5);
  check('잘못된 maxTotalRiskPct → 하한 12로 클램프', invalid.maxTotalRiskPct, 12);
  check('알 수 없는 exitMethod → 기본값 donchian', invalid.exitMethod, 'donchian');
  check('0.3 → pyramidSizeMultiplier 1로 대체(0.5 아니면 1)', invalid.pyramidSizeMultiplier, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 청산선 — donchian(당일 제외) · ma(당일 포함) · atrTrail(래칫)
// ════════════════════════════════════════════════════════════════════════════
{
  // donchian: 21봉 필요(20 + D). D 제외 직전 20개 저가 최솟값.
  const closes = Array.from({ length: 21 }, (_, i) => 100 + i); // 100..120, D=120
  const lows = closes.map(c => c - 1); // 99..119
  const bars = mkBars(closes, undefined, lows);
  const line = computeExitLine({ bars, settings: { ...D, exitMethod: 'donchian', exitLookback: 20 } });
  checkClose('donchian 20일 청산선 = D 제외 직전 20봉 low 최솟값(99)', line, 99);

  const shortBars = mkBars(closes.slice(0, 20)); // 20봉만 — 21 미만이라 부족
  const shortLine = computeExitLine({ bars: shortBars, settings: { ...D, exitMethod: 'donchian', exitLookback: 20 } });
  check('donchian 데이터 부족 → null(확인 불가)', shortLine, null);

  // ma(50): 당일 포함 SMA. 마지막 50개 종가 평균.
  const maCloses = Array.from({ length: 55 }, () => 100);
  maCloses[54] = 200; // 마지막(당일) 포함되어 평균이 올라가야 함
  const maBars = mkBars(maCloses);
  const maLine = computeMaExitLine(maBars, 50);
  // 마지막 50개 = index 5..54 → 49개의 100 + 1개의 200 = (49*100+200)/50 = 102
  checkClose('ma(50) 당일 포함 SMA = 102', maLine, 102);
  const maShort = computeMaExitLine(maBars.slice(0, 49), 50);
  check('ma 데이터 부족(49봉) → null', maShort, null);

  // atrTrail: 래칫(하향 금지) — 상태 입력/출력형
  const entryBar: DailyBar = { date: iso(0), open: 100, high: 100, low: 98, close: 100 };
  let trail = initAtrTrailState(entryBar, 10, 3); // running=100, trail=100-30=70
  checkClose('ATR 추적 초기 상태 = 70', trail.trailStop, 70);
  trail = updateAtrTrailState(trail, { date: iso(1), open: 110, high: 120, low: 108, close: 118 }, 10, 3);
  checkClose('ATR 추적 상향(고가 120) = 90', trail.trailStop, 90);
  const ratchetInput = updateAtrTrailState(trail, { date: iso(2), open: 100, high: 105, low: 95, close: 96 }, 10, 3);
  checkClose('ATR 추적 하락일에도 래칫 유지(하향 금지) = 90', ratchetInput.trailStop, 90);
  const noN = updateAtrTrailState(trail, { date: iso(3), open: 100, high: 130, low: 95, close: 96 }, null, 3);
  check('N 없으면 최고가는 갱신되지만 추적선은 유지(120)', noN.runningHigh, 130);
  checkClose('N 없으면 추적선 불변(90)', noN.trailStop, 90);

  const atrBars: DailyBar[] = [entryBar,
    { date: iso(1), open: 110, high: 120, low: 108, close: 118 },
    { date: iso(2), open: 118, high: 125, low: 110, close: 122 },
  ];
  // computeAtrTrailExitLine은 N을 calculateATR로 직접 계산 — period=20이라 3봉으로는 항상 null(부족).
  const atrFull = computeAtrTrailExitLine(atrBars, 0, 2, 3, 20);
  check('ATR 추적선 — 워밍업 미달(20일 ATR 요구) → null(확인 불가, 짧은 데이터로 값 내지 않음)', atrFull, null);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 재진입선 — 55일 최고가(당일 제외), 확정 종가 기준
// ════════════════════════════════════════════════════════════════════════════
{
  const closes = Array.from({ length: 56 }, (_, i) => 100 + i); // D=155(index55), 최고가는 D 제외 직전 55개
  const highs = closes.map(c => c + 1);
  const bars = mkBars(closes, highs);
  const settings: TurtleHoldingsSettings = { ...D, entryLookback: 55 };
  const line = computeReentryLine(bars, settings);
  // D 제외 직전 55개(index0..54) high 최댓값 = closes[54]+1 = 154+1 = 155
  checkClose('재진입선 = D 제외 직전 55봉 high 최댓값(155)', line!, 155);
  check('재진입 발생(종가 D=155 ≥ 155)', checkReentrySignal(bars, settings), true);

  const belowBars = mkBars(closes.slice(0, 55).concat([100])); // D 종가가 낮음
  check('재진입 미발생(종가가 선 아래)', checkReentrySignal(belowBars, settings), false);
  const shortBars = mkBars(closes.slice(0, 55));
  check('재진입선 데이터 부족(56봉 미만) → null', computeReentryLine(shortBars, settings), null);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 유닛 사이징 — 계획서 §3.2 8.5억 원 / 종목 한도 10% 예시
// ════════════════════════════════════════════════════════════════════════════
{
  const settings: TurtleHoldingsSettings = { ...D, positionCapPct: 10, maxUnitsPerPosition: 4, riskPerUnitPct: 1 };
  const equity = 850_000_000;
  const price = 50_000;
  const n = 1_500; // 3% 변동성(국내 개별주 평균)
  const size = computeFirstUnitSize(equity, n, price, 1, settings, false);
  // qtyRisk = 850,000,000*0.01/1500 = 5,666.67 → cap: 21,250,000/50,000=425 → 한도가 작음
  check('종목 한도가 리스크공식보다 작아 캡 적용', size.cappedByPosition, true);
  checkClose('1유닛 매수금액 = 21,250,000원(한도)', size.positionValueKRW, 21_250_000);
  check('1유닛 수량 = 425', size.qty, 425);
  check('skip 사유 없음', size.skipReason, null);

  const stopPrice = computeCommonStopPrice(price, n, settings);
  check('손절가 = 50,000 - 2×1,500 = 47,000', stopPrice, 47_000);
  const trigger = computePyramidTriggerPrice(price, n, settings);
  check('2R 불타기 트리거 = 50,000 + 2×2×1,500 = 56,000', trigger, 56_000);

  // 잔잔한 종목(1.5%) — N=750, 원조공식 금액이 훨씬 큼(§3.2 표) → 여전히 한도 지배
  const calmSize = computeFirstUnitSize(equity, 750, price, 1, settings, false);
  check('잔잔한 종목도 한도가 지배(캡 적용)', calmSize.cappedByPosition, true);
  checkClose('잔잔한 종목도 1유닛 = 21,250,000원(한도)', calmSize.positionValueKRW, 21_250_000);

  // 코인급(6%) — N=3,000, 리스크공식 = 850,000,000*0.01/3000=2833.3 → cap=425 → 여전히 캡
  const coinSize = computeFirstUnitSize(equity, 3_000, price, 1, settings, false);
  check('코인급 변동성도 한도가 지배', coinSize.cappedByPosition, true);

  // 5만 원 미만 skip
  const tinyEquity = computeFirstUnitSize(1_000_000, 1_500, 50_000, 1, settings, false);
  check('금액 5만 원 미만 → skip(below-min-order)', tinyEquity.skipReason, 'below-min-order');
  check('skip 시 qty=0', tinyEquity.qty, 0);

  // 환율 없음 → null(0원 대체 금지)
  const noFx = computeFirstUnitSize(equity, n, price, null, settings, false);
  check('환율 없음 → skip(no-fx)', noFx.skipReason, 'no-fx');
  check('환율 없음 → qty=0(0원 대체 금지)', noFx.qty, 0);

  // N 없음 → null
  const noN = computeFirstUnitSize(equity, null, price, 1, settings, false);
  check('N 없음 → skip(no-n)', noN.skipReason, 'no-n');

  // 코인 1e-8 내림
  check('코인 수량 라운딩(1e-8 내림)', roundHoldingsQty(0.123456789, true), 0.12345678);
  check('일반 수량 라운딩(정수 내림)', roundHoldingsQty(425.9, false), 425);

  // 불타기 유닛 크기 — 최초유닛 × pyramidSizeMultiplier(0.5)
  const halfSettings: TurtleHoldingsSettings = { ...settings, pyramidSizeMultiplier: 0.5 };
  const pyramidHalf = computePyramidUnitSize(425, 1, price, 1, halfSettings, false);
  check('불타기 0.5배 수량 = floor(425*0.5)=212', pyramidHalf.qty, 212);
  const pyramidFull = computePyramidUnitSize(425, 1, price, 1, settings, false);
  check('불타기 1배 수량 = 425(고정, 재계산 아님)', pyramidFull.qty, 425);
  const maxedOut = computePyramidUnitSize(425, 4, price, 1, settings, false);
  check('종목 한도(4유닛) 도달 → skip(max-units-reached)', maxedOut.skipReason, 'max-units-reached');
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 원래 보유분(터틀 매수 이력 없음) 상태 판정
// ════════════════════════════════════════════════════════════════════════════
{
  check('청산선 아래 → sell-check', evaluateLegacyHoldingsStatus(90, 95), 'sell-check');
  check('청산선 위 → hold', evaluateLegacyHoldingsStatus(100, 95), 'hold');
  check('청산선=종가(같으면 이탈 처리) → sell-check', evaluateLegacyHoldingsStatus(95, 95), 'sell-check');
  check('데이터 없음 → unavailable', evaluateLegacyHoldingsStatus(null, 95), 'unavailable');
  check('청산선 없음 → unavailable', evaluateLegacyHoldingsStatus(100, null), 'unavailable');
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 공통비율 λ 축소 — 현금 부족 시 선착순 아님
// ════════════════════════════════════════════════════════════════════════════
{
  const candidates = [
    { ticker: 'AAA', qtyAtFull: 100, priceLocal: 10_000, fx: 1, isCrypto: false, riskDeltaKRWAtFull: 200_000 },
    { ticker: 'BBB', qtyAtFull: 200, priceLocal: 10_000, fx: 1, isCrypto: false, riskDeltaKRWAtFull: 400_000 },
  ];
  // 풀필요현금 = 100*10000 + 200*10000 = 3,000,000. 현금 1,500,000 → λ=0.5 근처
  const result = computeLambdaScale(candidates, 1_500_000, 0, 1_000_000_000);
  check('λ 축소 발동(현금 부족)', result.wasScaled, true);
  const totalCash = result.qtys.AAA * 10_000 + result.qtys.BBB * 10_000;
  check('λ 축소 후 필요 현금이 가용 현금 이내', totalCash <= 1_500_000, true);
  // 같은 비율 축소 확인 — 두 종목의 체결비율이 거의 같아야 함(선착순이면 한쪽만 꽉 참)
  const ratioA = result.qtys.AAA / 100, ratioB = result.qtys.BBB / 200;
  check('두 종목이 비슷한 비율로 축소(선착순 아님)', Math.abs(ratioA - ratioB) < 0.05, true);

  const enoughCash = computeLambdaScale(candidates, 10_000_000, 0, 1_000_000_000);
  check('현금 충분하면 λ=1(축소 없음)', enoughCash.wasScaled, false);
  check('현금 충분하면 전량 체결(AAA)', enoughCash.qtys.AAA, 100);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 전체 위험 한도 — 24% vs 12%
// ════════════════════════════════════════════════════════════════════════════
{
  const settings24: TurtleHoldingsSettings = { ...D, maxTotalRiskPct: 24 };
  const settings12: TurtleHoldingsSettings = { ...D, maxTotalRiskPct: 12 };
  const equity = 1_000_000_000;
  const r24 = checkTotalRiskLimit(200_000_000, 40_000_000, equity, settings24); // 24%
  check('24% 한도 — 정확히 한도(허용오차 내 통과)', r24.ok, true);
  const r12 = checkTotalRiskLimit(200_000_000, 40_000_000, equity, settings12); // 24% > 12%
  check('12% 한도 — 초과(거부)', r12.ok, false);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. 적용 범위 판정
// ════════════════════════════════════════════════════════════════════════════
{
  const settings = D;
  check('가족(유선) 계정 제외', isInHoldingsScope({ id: 'a1', categoryId: 1, owner: 'YUSEON' }, settings), false);
  check('본인(원종) 계정 포함', isInHoldingsScope({ id: 'a2', categoryId: 1, owner: 'WONJONG' }, settings), true);
  check('미지정 owner는 원종으로 간주 → 포함', isInHoldingsScope({ id: 'a3', categoryId: 1 }, settings), true);
  const withExclusion: TurtleHoldingsSettings = { ...D, excludedAssetIds: ['a4'], excludedCategoryIds: [9] };
  check('개별 자산 제외', isInHoldingsScope({ id: 'a4', categoryId: 1 }, withExclusion), false);
  check('카테고리 제외', isInHoldingsScope({ id: 'a5', categoryId: 9 }, withExclusion), false);
  check('제외 목록에 없으면 포함', isInHoldingsScope({ id: 'a6', categoryId: 1 }, withExclusion), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. 변동성 라벨 경계 + 쉬운 말 설명
// ════════════════════════════════════════════════════════════════════════════
{
  check('1.9% → 잔잔함', classifyVolatility(1.9), 'calm');
  check('2.0% → 보통(경계 포함)', classifyVolatility(2.0), 'normal');
  check('4.0% → 보통(경계 포함)', classifyVolatility(4.0), 'normal');
  check('4.01% → 출렁임 큼', classifyVolatility(4.01), 'volatile');

  const stopExpl = describeStopExplanation({ priceLocal: 50_000, n: 1_500, stopMultipleN: 2, stopPrice: 47_000 });
  check('손절 설명 문구(예시)', stopExpl,
    '이 종목은 하루 평균 1,500원(3.0%)씩 움직입니다. 그래서 손절가를 3,000원(6.0%) 아래인 47,000원으로 잡았습니다.');

  const exitExpl = describeExitLineExplanation({ exitLookback: 20, exitLine: 51_200, lastClose: 50_800 });
  check('청산선 설명 문구(예시)', exitExpl, '20일 최저가 51,200원 이하로 마감 (종가 50,800원)');
  // Advisor 보정(2026-09-26): 같은 값도 청산(<=)이라 '이하', 달러 종목은 $·소수 2자리
  // Advisor 보정(2026-09-26): 청산 방식별 선 이름(카톡·화면 공통)
  check('청산선 설명 — 이동평균', describeExitLineExplanation({ exitLookback: 20, exitLine: 50_000, lastClose: 49_500, exitMethod: 'ma', maPeriod: 50 }), '50일 이동평균 50,000원 이하로 마감 (종가 49,500원)');
  check('청산선 설명 — ATR 추적', describeExitLineExplanation({ exitLookback: 20, exitLine: 50_000, lastClose: 49_500, exitMethod: 'atrTrail', atrTrailMultiple: 3 }), '추적 손절선(최고 종가 − 3N) 50,000원 이하로 마감 (종가 49,500원)');
  check('청산선 설명 — USD 통화 표기', describeExitLineExplanation({ exitLookback: 20, exitLine: 79.12, lastClose: 79.12, currency: 'USD' }), '20일 최저가 $79.12 이하로 마감 (종가 $79.12)');

  // formatMoney — KRW/JPY 정수+기호, USD·CNY 소수 2자리(§4.1 통화 단위 누락 수정, 2026-09-26)
  check('formatMoney KRW(기본값)', formatMoney(48_800), '48,800원');
  check('formatMoney KRW(명시)', formatMoney(48_800, 'KRW'), '48,800원');
  check('formatMoney USD', formatMoney(79.123, 'USD'), '$79.12');
  check('formatMoney JPY', formatMoney(1_234, 'JPY'), '¥1,234');

  // 손절 예약주문 점검 문구("손절선 확인" 칸 전용) — describeExitLineExplanation(판정 사유)과 문장이 겹치면 안 됨
  const stopCheckExpl = describeStopOrderCheckText({ stopPrice: 48_800, exitLine: 49_000 });
  check('손절 예약주문 점검 문구(예시)', stopCheckExpl, '증권사 손절 예약 48,800원이 걸려 있는지 확인하세요 (청산선 49,000원).');
  check('손절 예약주문 점검 문구 — 청산선 없음(ma/atrTrail 등)', describeStopOrderCheckText({ stopPrice: 48_800, exitLine: null }), '증권사 손절 예약 48,800원이 걸려 있는지 확인하세요.');
  check('손절 예약주문 점검 문구 — USD 통화 표기', describeStopOrderCheckText({ stopPrice: 96.7, exitLine: 99, currency: 'USD' }), '증권사 손절 예약 $96.70이 걸려 있는지 확인하세요 (청산선 $99.00).');
  check('손절 예약주문 점검 문구 ≠ 청산선 이탈 판정 문구(칸 의미 혼동 방지)', stopCheckExpl !== describeExitLineExplanation({ exitLookback: 20, exitLine: 49_000, lastClose: 48_800 }), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 9. 백테스트 모듈과의 교차 파리티 — 같은 합성 입력 → 같은 값 (exitRules.ts / sizing.ts)
// ════════════════════════════════════════════════════════════════════════════
{
  // 9-1. 청산선(donchian) — checkExitSignal(W1, lookback=20)과 동일 판정.
  //   PortfolioSecurity는 필드가 많아 이 파리티에 필요한 것만 채운 최소 스텁을 만든다.
  const n = 21;
  const closesArr = Array.from({ length: n }, (_, i) => 100 - i); // 하락 추세 → D=80이 최저권
  const lowsArr = closesArr.map(c => c - 1);
  const sec = {
    ownClose: closesArr, lowChannel20: (() => {
      // exitRules.checkExitSignal은 sec.lowChannel20[ownIdx]를 그대로 읽는다(당일 제외 선 계산은
      // data.ts가 미리 채워둔다는 전제) — 여기서는 우리 함수와 "같은 정의"로 직접 채워 교차비교한다.
      const out: (number | null)[] = new Array(n).fill(null);
      for (let i = 20; i < n; i++) {
        let m = Infinity;
        for (let k = i - 20; k < i; k++) m = Math.min(m, lowsArr[k]);
        out[i] = m;
      }
      return out;
    })(),
    lowChannel55: new Array(n).fill(null),
    sma50: new Array(n).fill(null),
    atr: new Array(n).fill(null),
    highChannel55: new Array(n).fill(null),
  } as unknown as PortfolioSecurity;
  const btExit = checkExitSignal({ method: 'donchian', lookback: 20, currentBarExcluded: true }, sec, n - 1, null);

  const ourBars = mkBars(closesArr, undefined, lowsArr);
  const ourLine = computeExitLine({ bars: ourBars, settings: { ...D, exitMethod: 'donchian', exitLookback: 20 } });
  const ourExit = ourLine !== null && closesArr[n - 1] <= ourLine;
  check('청산 발동 여부 — 백테스트/앱 교차 일치', ourExit, btExit);
  checkClose('청산선 절대값 — 백테스트/앱 교차 일치', ourLine!, sec.lowChannel20[n - 1]!, 1e-9);

  // 9-2. 재진입선(55일 고가 돌파) — checkEntrySignal과 교차.
  const n2 = 56;
  const upCloses = Array.from({ length: n2 }, (_, i) => 100 + i);
  const upHighs = upCloses.map(c => c + 1);
  const sec2 = {
    ownClose: upCloses,
    highChannel55: (() => {
      const out: (number | null)[] = new Array(n2).fill(null);
      for (let i = 55; i < n2; i++) {
        let m = -Infinity;
        for (let k = i - 55; k < i; k++) m = Math.max(m, upHighs[k]);
        out[i] = m;
      }
      return out;
    })(),
  } as unknown as PortfolioSecurity;
  const btEntry = checkEntrySignal(sec2, n2 - 1);
  const upBars = mkBars(upCloses, upHighs);
  const ourEntry = checkReentrySignal(upBars, { ...D, entryLookback: 55 });
  check('재진입 발동 여부 — 백테스트/앱 교차 일치', ourEntry, btEntry);
  checkClose('재진입선 절대값 — 백테스트/앱 교차 일치', computeReentryLine(upBars, { ...D, entryLookback: 55 })!, sec2.highChannel55[n2 - 1]!, 1e-9);

  // 9-3. ATR 추적(atrTrailing) 래칫 — initTrailState/updateTrailState와 같은 결과.
  const trailSec = {
    ownHigh: [100, 120, 105, 130],
    ownClose: [100, 118, 96, 128],
    atr: [10, 10, 10, 10],
  } as unknown as PortfolioSecurity;
  let btTrail = initTrailState(trailSec, 0, 3);
  let ourTrail = initAtrTrailState({ date: iso(0), open: 100, high: 100, low: 98, close: 100 }, 10, 3);
  checkClose('ATR 추적 초기값 — 백테스트/앱 교차 일치', ourTrail.trailStop!, btTrail.trailStop, 1e-9);
  btTrail = updateTrailState(btTrail, trailSec, 1, 3);
  ourTrail = updateAtrTrailState(ourTrail, { date: iso(1), open: 110, high: 120, low: 108, close: 118 }, 10, 3);
  checkClose('ATR 추적 1일 갱신 — 백테스트/앱 교차 일치', ourTrail.trailStop!, btTrail.trailStop, 1e-9);
  btTrail = updateTrailState(btTrail, trailSec, 2, 3);
  ourTrail = updateAtrTrailState(ourTrail, { date: iso(2), open: 100, high: 105, low: 95, close: 96 }, 10, 3);
  checkClose('ATR 추적 래칫(하락일) — 백테스트/앱 교차 일치', ourTrail.trailStop!, btTrail.trailStop, 1e-9);

  // 9-4. 유닛 사이징(G — fixed-cap-div4) — sizeFixedUnitCapDiv와 앱 사이징 공식 일치(사이징 분모만
  //   위성예산(앱) vs 포트폴리오 평가액(백테스트)로 이름이 다를 뿐 같은 공식 — 같은 숫자를 넣으면 같은 값).
  const ctx = { equityKRW: 850_000_000, riskPerUnitPct: 1, positionCapPct: 10, maxUnits: 4 };
  const btSize = sizeFixedUnitCapDiv(ctx, 1_500, 50_000, 1);
  const ourSize = computeFirstUnitSize(850_000_000, 1_500, 50_000, 1, { ...D, riskPerUnitPct: 1, positionCapPct: 10, maxUnitsPerPosition: 4 }, false);
  check('1유닛 수량 — 백테스트(G)/앱 교차 일치', ourSize.qty, btRoundQty(btSize.qty, false));

  // 9-5. B(room 기반) 사이징은 상한 정의가 다르다 — B는 "포지션 전체 상한"(existingValue 차감,
  //   maxUnits로 나누지 않음)이라 최초 진입(existingValueKRW=0)에서는 상한이 그대로 10%(85,000,000원)로
  //   적용돼 앱(§3.1 공식, 상한÷maxUnits)과 다른 값이 나온다 — 의도된 차이이므로 각자의 정의대로 확인한다.
  const btRoom = sizeUnitWithRoom({ equityKRW: 850_000_000, riskPerUnitPct: 1, positionCapPct: 10, maxUnits: 4 }, 1_500, 50_000, 1, 0);
  checkClose('B(room) 최초 유닛 상한 = 10% 전체(85,000,000원 ÷ 가격) = 1,700주', btRoundQty(btRoom.qty, false), 1_700);
  check('앱 공식(§3.1, 상한÷maxUnits)은 의도적으로 더 작음(425 < 1700)', ourSize.qty < btRoundQty(btRoom.qty, false), true);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
