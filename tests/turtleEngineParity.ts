// tests/turtleEngineParity.ts
// ---------------------------------------------------------------------------
// 터틀 엔진 골든 테스트 — 원전 문서(터틀트레이딩_통합검증_최종본.md)의 실제 예시를 그대로 재현.
//   · §4 유닛 사이징: 난방유 16계약 / 삼성전자 500주 / 비트코인 0.0667 BTC
//   · §7 손절+피라미딩: 금 310→311.25→312.50→313.75, 손절 305→306.25→307.50→308.75
//   · 돈치안 채널 당일 제외 / 폴백
//   · 경계: N=0/null·미돌파·0주·예산부족·12% 한도 → fail-closed
//   · 드로다운 감쇄 §10: 100→80(equity90) / 100→64(equity82)
// 수동 실행: npm run test:turtle (tsx). 통과 시 exit 0.

import {
  TurtleSettings,
  DEFAULT_TURTLE_SETTINGS,
  TurtlePosition,
  TurtleUnit,
} from '../types/turtle';
import {
  calculateDonchianHigh,
  calculateDonchianLow,
  buildDonchianChannels,
} from '../utils/donchianChannel';
import {
  computeN,
  computeUnitSize,
  evaluateEntry,
  evaluatePyramid,
  recomputeStop,
  evaluateStop,
  evaluateExit,
  positionQuantity,
  computeTotalOpenRisk,
  applyDrawdownScaling,
} from '../utils/turtleEngine';

let pass = 0;
const fails: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++;
  else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}
function checkTrue(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

const S = (over: Partial<TurtleSettings> = {}): TurtleSettings => ({ ...DEFAULT_TURTLE_SETTINGS, ...over });

// ════════════════════════════════════════════════════════════════════════════
// 1. 돈치안 채널 — 당일 제외가 기본
// ════════════════════════════════════════════════════════════════════════════
// [1,2,3,4,5]: 당일(5) 제외, 직전 3일 [2,3,4] → high 4. 오늘 5 ≥ 4 → 돌파.
check('돈치안 high 당일제외(3)', calculateDonchianHigh([1, 2, 3, 4, 5], 3), 4);
check('돈치안 high 당일포함(3)', calculateDonchianHigh([1, 2, 3, 4, 5], 3, { excludeToday: false }), 5);
check('돈치안 low 당일제외(3)', calculateDonchianLow([5, 4, 3, 2, 1], 3), 2);
check('돈치안 데이터부족→가용범위', calculateDonchianHigh([9, 7], 55), 9); // 당일7 제외 → [9] → 9
check('돈치안 전부 null → null', calculateDonchianHigh([null, null, null], 2), null);
check('돈치안 단일값 당일제외 → null', calculateDonchianHigh([3], 5), null);

// 폴백: 고가 전부 null → 종가로 대체, lowFallback도 확인
const ch = buildDonchianChannels(
  [null, null, null, null, null],
  [null, null, null, null, null],
  [10, 11, 12, 13, 14],
  3, 3
);
check('폴백 entryHigh(종가 [11,12,13] max)', ch.entryHigh, 13);
check('폴백 exitLow(종가 [11,12,13] min)', ch.exitLow, 11);
check('highFallback=true', ch.highFallback, true);
check('lowFallback=true', ch.lowFallback, true);

// 정상 OHLC (폴백 없음)
const ch2 = buildDonchianChannels([2, 4, 6, 8, 10], [1, 2, 3, 4, 5], [1, 3, 5, 7, 9], 3, 3);
check('정상 entryHigh(고가 [4,6,8] max)', ch2.entryHigh, 8);
check('정상 exitLow(저가 [2,3,4] min)', ch2.exitLow, 2);
check('highFallback=false', ch2.highFallback, false);

// ════════════════════════════════════════════════════════════════════════════
// 2. §4 유닛 사이징 — 원본 선물(난방유) + 현물(삼성/비트코인)
// ════════════════════════════════════════════════════════════════════════════
// 난방유: 계좌 100만, 리스크 1%, N=0.0141, 계약당 42,000 → 10,000/(0.0141×42,000)=16.88→16.
// 계약승수 검증이므로 상한(cap) 비활성(positionValueCapPct:0).
const heatingOil = computeUnitSize(
  S({ satelliteBudgetKRW: 1_000_000, riskPerUnitPct: 1, positionValueCapPct: 0 }),
  0.0141, 0, { dollarPerPoint: 42_000 }
);
checkClose('난방유 unitsExact ≈16.88', heatingOil.unitsExact, 10_000 / (0.0141 * 42_000), 1e-4);
check('난방유 16계약 (절사)', heatingOil.units, 16);

// 삼성전자: 총자산 1억, 리스크 1%, N=2,000 → 1,000,000/2,000 = 500주.
const samsung = computeUnitSize(
  S({ satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 1, positionValueCapPct: 0 }),
  2000, 80_000
);
check('삼성전자 500주', samsung.units, 500);

// 비트코인: 총자산 1,000만, 리스크 1%, N=150만 → 100,000/1,500,000 = 0.0667 BTC (소수 허용).
const btc = computeUnitSize(
  S({ satelliteBudgetKRW: 10_000_000, riskPerUnitPct: 1, positionValueCapPct: 0 }),
  1_500_000, 93_000_000, { allowFractional: true }
);
checkClose('비트코인 unitsExact ≈0.06667', btc.unitsExact, 100_000 / 1_500_000, 1e-9);
checkTrue('비트코인 소수 수량 > 0', btc.units > 0 && btc.units < 0.07);

// 25% 상한: 예산 1억, 리스크1%, N=2000 → uncapped 500주×80,000=4,000만(40%). cap 25%=2,500만 → 312주.
const capped = computeUnitSize(
  S({ satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 1, positionValueCapPct: 25 }),
  2000, 80_000
);
check('25% 상한 적용 수량', capped.units, Math.floor(25_000_000 / 80_000)); // 312
check('capped 플래그', capped.capped, true);

// 예산 0 → 사이징 0 (fail-closed)
check('예산 0 → units 0', computeUnitSize(S({ satelliteBudgetKRW: 0 }), 2000, 80_000).units, 0);
check('N 0 → units 0', computeUnitSize(S({ satelliteBudgetKRW: 1e8 }), 0, 80_000).units, 0);

// ════════════════════════════════════════════════════════════════════════════
// 3. §7 손절 + §6 피라미딩 — 금 예시 (N=2.50, 돌파가 310, 최대 4유닛)
// ════════════════════════════════════════════════════════════════════════════
// 예산 지정: 피라미딩 quantity 계산(computeUnitSize)이 0주 fail-closed로 빠지지 않도록.
// 이 블록의 검증 대상은 "손절 사다리"이므로 수량 값 자체는 부차적.
const gset = S({ satelliteBudgetKRW: 100_000_000, maxUnitsPerPosition: 4, stopMultipleN: 2, pyramidStepN: 0.5 });
const N = 2.50;

// 최초 진입 310, 1유닛
let gold: TurtlePosition = {
  id: 'gold', ticker: 'GC', name: '금', status: 'open', openedAt: '2024-01-01',
  entryDonchianHigh: 310,
  units: [{ fillDate: '2024-01-01', fillPrice: 310, quantity: 1, nAtFill: N }],
  stopPrice: 0,
};
gold.stopPrice = recomputeStop(gold, gset);
checkClose('금 1유닛 손절 305', gold.stopPrice, 305);

// 311.25 도달 → 피라미딩 (310 + 0.5×2.5 = 311.25)
const p2 = evaluatePyramid(gold, 311.25, N, gset);
checkTrue('금 2유닛 피라미딩 트리거', p2 !== null);
checkClose('금 2유닛 후 손절 306.25', p2!.newStopPrice, 306.25);
// 유닛 추가 반영
gold.units.push({ fillDate: '2024-01-02', fillPrice: 311.25, quantity: 1, nAtFill: N });
gold.stopPrice = recomputeStop(gold, gset);
checkClose('금 2유닛 recomputeStop 306.25', gold.stopPrice, 306.25);

// 311.24 (트리거 직전) → 피라미딩 없음
checkTrue('금 트리거 직전 피라미딩 없음', evaluatePyramid(gold, 312.49, N, gset) === null);

// 312.50 → 3유닛
const p3 = evaluatePyramid(gold, 312.50, N, gset);
checkTrue('금 3유닛 트리거', p3 !== null);
gold.units.push({ fillDate: '2024-01-03', fillPrice: 312.50, quantity: 1, nAtFill: N });
gold.stopPrice = recomputeStop(gold, gset);
checkClose('금 3유닛 후 손절 307.50', gold.stopPrice, 307.50);

// 313.75 → 4유닛째
const p4 = evaluatePyramid(gold, 313.75, N, gset);
checkTrue('금 4유닛 트리거', p4 !== null);
gold.units.push({ fillDate: '2024-01-04', fillPrice: 313.75, quantity: 1, nAtFill: N });
gold.stopPrice = recomputeStop(gold, gset);
checkClose('금 4유닛 후 전체 손절 308.75', gold.stopPrice, 308.75);

// 최대 유닛(4) 도달 → 추가 피라미딩 없음
checkTrue('금 최대유닛 도달 → 피라미딩 없음', evaluatePyramid(gold, 320, N, gset) === null);
check('금 총 수량 4', positionQuantity(gold), 4);

// N=null 이면 피라미딩 없음 (fail-closed)
checkTrue('N null 피라미딩 없음', evaluatePyramid(gold, 320, null, gset) === null);

// ════════════════════════════════════════════════════════════════════════════
// 4. 손절/청산 판정
// ════════════════════════════════════════════════════════════════════════════
// 손절: 가격이 308.75 이하 → 전량(4) 매도, reason stop
const stopHit = evaluateStop(gold, 308.75);
checkTrue('손절 트리거(=308.75)', stopHit !== null);
check('손절 전량 수량 4', stopHit!.quantity, 4);
check('손절 reason', stopHit!.reason, 'stop');
checkTrue('손절 미도달(308.76) → null', evaluateStop(gold, 308.76) === null);

// 청산: 20일 최저가 이탈. donchianLow=309, 가격 309 이하 → channel-exit
const exitHit = evaluateExit(gold, 309, 308.9);
checkTrue('청산 트리거', exitHit !== null);
check('청산 reason', exitHit!.reason, 'channel-exit');
checkTrue('청산 미이탈(309.1) → null', evaluateExit(gold, 309, 309.1) === null);
checkTrue('청산 donchianLow null → null', evaluateExit(gold, null, 100) === null);

// ════════════════════════════════════════════════════════════════════════════
// 5. evaluateEntry — 돌파/가드/사이징 통합
// ════════════════════════════════════════════════════════════════════════════
const eset = S({ satelliteBudgetKRW: 100_000_000, riskPerUnitPct: 0.5, stopMultipleN: 2, positionValueCapPct: 0, maxTotalRiskPct: 12 });
// N=2000, 돌파가 80,000, 현재가 80,000 (=돌파) → 수량 500,000×... risk 0.5%×1e8=500,000; /2000=250주
const entryOk = evaluateEntry({
  ticker: 'X', name: 'X', price: 80_000, n: 2000, donchianHigh: 80_000,
  settings: eset, openRiskKRW: 0, remainingBudgetKRW: 100_000_000,
});
checkTrue('진입 OK (돌파)', entryOk.ok);
check('진입 수량 250', entryOk.proposal!.quantity, 250);
checkClose('진입 손절가 = 80,000 − 2×2000', entryOk.proposal!.stopPrice, 76_000);
// riskKRW = 250 × (80,000 − 76,000) = 250×4,000 = 1,000,000 = 위성예산의 1% (0.5%×2N)
checkClose('진입 리스크 = 예산의 1%', entryOk.proposal!.riskKRW, 1_000_000);

// 미돌파 (현재가 < 돌파가)
check('미돌파 → no-breakout', evaluateEntry({
  ticker: 'X', name: 'X', price: 79_999, n: 2000, donchianHigh: 80_000,
  settings: eset, openRiskKRW: 0, remainingBudgetKRW: 1e8,
}).reason, 'no-breakout');

// N null → no-n
check('N null → no-n', evaluateEntry({
  ticker: 'X', name: 'X', price: 80_000, n: null, donchianHigh: 80_000,
  settings: eset, openRiskKRW: 0, remainingBudgetKRW: 1e8,
}).reason, 'no-n');

// 예산 부족 (잔여 예산 < positionValue)
check('예산부족 → insufficient-budget', evaluateEntry({
  ticker: 'X', name: 'X', price: 80_000, n: 2000, donchianHigh: 80_000,
  settings: eset, openRiskKRW: 0, remainingBudgetKRW: 1_000_000, // 250×80,000=2,000만 > 100만
}).reason, 'insufficient-budget');

// 12% 한도 초과 (기존 오픈리스크가 이미 큼): openRisk 11.5% + 새 1% = 12.5% > 12
check('한도초과 → risk-limit', evaluateEntry({
  ticker: 'X', name: 'X', price: 80_000, n: 2000, donchianHigh: 80_000,
  settings: eset, openRiskKRW: 11_500_000, remainingBudgetKRW: 1e8,
}).reason, 'risk-limit');

// ════════════════════════════════════════════════════════════════════════════
// 6. computeTotalOpenRisk — 신규 포지션 리스크 = 예산의 1% (0.5%×2N), 손절 상향 시 감소
// ════════════════════════════════════════════════════════════════════════════
const rset = S({ satelliteBudgetKRW: 1_000_000, riskPerUnitPct: 0.5, stopMultipleN: 2 });
// 진입 310, qty 2000, stop 305 → risk = 2000×(310−305)=10,000 = 예산의 1%
const freshPos: TurtlePosition = {
  id: 'p', ticker: 'T', name: 'T', status: 'open', openedAt: '2024-01-01', entryDonchianHigh: 310,
  units: [{ fillDate: '2024-01-01', fillPrice: 310, quantity: 2000, nAtFill: 2.5 }],
  stopPrice: 305,
};
const risk1 = computeTotalOpenRisk([freshPos], rset);
checkClose('신규 포지션 리스크 = 예산 1%', risk1.riskPct, 1);
// 손절이 체결가 위로 상향(수익 확정)되면 포지션 리스크 0 (음수 미포함)
const profitPos: TurtlePosition = { ...freshPos, stopPrice: 315 };
checkClose('손절 상향(수익확정) → 리스크 0', computeTotalOpenRisk([profitPos], rset).riskKRW, 0);
// closed 포지션은 제외
const closedPos: TurtlePosition = { ...freshPos, status: 'closed' };
checkClose('closed 포지션 제외', computeTotalOpenRisk([closedPos], rset).riskKRW, 0);

// ════════════════════════════════════════════════════════════════════════════
// 7. §10 드로다운 감쇄 — 100만 기준, equity 90만→명목 80만 / equity 82만→명목 64만
// ════════════════════════════════════════════════════════════════════════════
checkClose('감쇄 없음(equity=100)', applyDrawdownScaling(100, 100), 100);
checkClose('감쇄 1단계(equity=90 → 80)', applyDrawdownScaling(90, 100), 80);
checkClose('감쇄 2단계(equity=82 → 64)', applyDrawdownScaling(82, 100), 64);
checkClose('감쇄 3단계(equity=75.6 → 51.2)', applyDrawdownScaling(75.6, 100), 51.2, 1e-9);
checkClose('회복(equity≥기준) → 기준 복귀', applyDrawdownScaling(105, 100), 100);

// ════════════════════════════════════════════════════════════════════════════
// 8. D6 통화 규약 — 외화(NVDA USD): 돈=KRW / 가격=원통화 / FX는 사이징·리스크만
// ════════════════════════════════════════════════════════════════════════════
const usdSet = S({ satelliteBudgetKRW: 95_000_000, riskPerUnitPct: 0.5, stopMultipleN: 2, positionValueCapPct: 25, maxTotalRiskPct: 12 });
const FX = 1400;
// 사이징: riskKRW 475,000 ÷ (N $5 × 1400) = 67.86 → 67주 (예산은 KRW, N은 원통화)
const nvdaSize = computeUnitSize(usdSet, 5, 109, { fxRate: FX });
check('NVDA 67주 (KRW예산 ÷ N×환율)', nvdaSize.units, 67);
checkClose('NVDA positionValueKRW = 67×109×1400', nvdaSize.positionValueKRW, 67 * 109 * 1400);

// 진입: 돌파가 $108, 현재가 $109
const nvdaEntry = evaluateEntry({
  ticker: 'NVDA', name: '엔비디아', price: 109, n: 5, donchianHigh: 108,
  settings: usdSet, openRiskKRW: 0, remainingBudgetKRW: 95_000_000, fxRate: FX,
});
checkTrue('NVDA 진입 OK', nvdaEntry.ok);
checkClose('NVDA 손절가 = $99 원통화(109−2×5)', nvdaEntry.proposal!.stopPrice, 99);
checkClose('NVDA riskKRW = 67×10×1400 (원통화 리스크×환율)', nvdaEntry.proposal!.riskKRW, 67 * 10 * 1400);
check('NVDA fxRateUsed 저장', nvdaEntry.proposal!.fxRateUsed, 1400);

// ★ 환율 변동 후에도 stopPriceOriginal 불변, openRiskKRW만 최신 환율로 변동 (D6 핵심)
const nvdaPos: TurtlePosition = {
  id: 'nvda', ticker: 'NVDA', name: '엔비디아', status: 'open', openedAt: '2024-01-01', entryDonchianHigh: 108,
  units: [{ fillDate: '2024-01-01', fillPrice: 109, quantity: 67, nAtFill: 5, fxRateAtFill: 1400 }],
  stopPrice: 99,
};
const risk1400 = computeTotalOpenRisk([nvdaPos], usdSet, () => 1400);
const risk1478 = computeTotalOpenRisk([nvdaPos], usdSet, () => 1478);
checkClose('openRiskKRW @1400 = 67×10×1400', risk1400.riskKRW, 67 * 10 * 1400);
checkClose('openRiskKRW @1478 = 67×10×1478 (게이지=최신환율)', risk1478.riskKRW, 67 * 10 * 1478);
checkTrue('환율 상승 → riskKRW 증가', risk1478.riskKRW > risk1400.riskKRW);
checkClose('★ 환율 변동 후에도 stopPriceOriginal 불변 = 99', nvdaPos.stopPrice, 99);

// 25% 상한도 KRW(priceOriginal×fx×qty)로 판정: 예산 작게+리스크 크게 → cap 발동
const capSet = S({ satelliteBudgetKRW: 5_000_000, riskPerUnitPct: 5, stopMultipleN: 2, positionValueCapPct: 25 });
const nvdaCap = computeUnitSize(capSet, 5, 109, { fxRate: 1400 });
check('NVDA 25% 상한(KRW) 적용', nvdaCap.units, Math.floor(1_250_000 / (109 * 1400))); // 8
check('NVDA capped 플래그', nvdaCap.capped, true);

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ turtleEngine parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  console.error(`\n통과 ${pass} / 실패 ${fails.length}`);
  process.exit(1);
} else {
  console.log(`✅ turtleEngine parity 전체 통과 (${pass} 단언)`);
}
