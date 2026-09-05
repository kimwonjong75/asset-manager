// tests/historySnapshotParity.ts
// ---------------------------------------------------------------------------
// 이력 스냅샷 **내부 정합성** 골든 테스트 — `utils/historyUtils`(순수 부분) + `deriveSnapshotPurchaseValue`.
//
// 지키는 불변식 (달러 기준 손익 차트가 통째로 기대는 것):
//
//     unitPrice === unitPriceOriginal × rate(그날)      … 단가 쌍
//     currentValue === quantity × unitPrice             … 평가액 쌍
//     ⇒ currentValue / unitPriceOriginal === quantity × rate(그날)
//
// 스냅샷에 환율 필드가 없기 때문에 `deriveSnapshotPurchaseValue`는 위 등식으로 환율을 약분한다.
// 따라서 스냅샷을 고치는 코드가 **한쪽만** 바꾸면 원화 기준 차트는 멀쩡한데
// 달러 기준 차트만 조용히 틀린다 — 아래 두 회귀가 정확히 그 사고였다.
//
//   ① 백필 단가 쌍 어긋남 (`correctSnapshotPricePair`): JPY/CNY 경로가 `unitPriceOriginal`만
//      새 종가로 바꾸고 `unitPrice`(→ `currentValue`)는 장중 옛값으로 남겨 원금을 부풀렸다.
//   ② 복구 케이스 A (`repairCorruptedSnapshots`): 손익을 0으로 누른 뒤에도
//      `purchaseUnitOriginal`이 살아남아 달러 모드에서만 없는 수익이 생겼다.
//
// ⚠ 경로-대-경로 비교 금지 — 전부 **명시 절대값**으로 고정한다(CLAUDE.md의 과거 실패 사례).
//   "수정 전 값"도 함께 핀으로 박아 두어 버그의 크기와 방향을 문서로 남긴다.
//
// 수동 실행: npm run test:history. 통과 시 exit 0.
// ---------------------------------------------------------------------------

import { AssetSnapshot, Currency, PortfolioSnapshot } from '../types';
import { correctSnapshotPricePair, repairCorruptedSnapshots } from '../utils/historyUtils';
import { deriveSnapshotPurchaseValue } from '../utils/portfolioMetrics';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function checkClose(name: string, actual: number, expected: number, eps = 1e-6): void {
  if (Math.abs(actual - expected) <= eps) pass++; else fails.push(`✗ ${name}: got ${actual}, expected ${expected}`);
}
/** KRW 금액용 — 100만 단위에서 double 오차가 1e-6을 넘으므로 절대 1e-3으로 본다. */
const KRW_EPS = 1e-3;

// ════════════════════════════════════════════════════════════════════════════
// 1. 백필 단가 쌍 정합 가드 — correctSnapshotPricePair
//    픽스처: JPY 자산 100주, 원통화 평균단가 ¥2,000, 스냅샷 장중 ¥2,500 @환율 9.5
//            (unitPrice 23,750 / currentValue 2,375,000 / 저장 원금 1,800,000)
//            백필로 받은 그날 **종가는 ¥2,200**.
// ════════════════════════════════════════════════════════════════════════════
{
  const jpyBefore: AssetSnapshot = {
    id: 'jp1', name: '일본주', currency: Currency.JPY,
    currentValue: 2_375_000, unitPrice: 23_750, unitPriceOriginal: 2_500,
    purchaseValue: 1_800_000, purchaseUnitOriginal: 2_000,
  };

  // 백필 전 파생: 2,000 × 2,375,000 / 2,500 = 2,000 × (100 × 9.5) = 1,900,000
  checkClose('백필 전 JPY native 원금 1,900,000', deriveSnapshotPurchaseValue(jpyBefore, 'native'), 1_900_000, KRW_EPS);
  checkClose('백필 전 JPY krw 원금 = 저장값 1,800,000', deriveSnapshotPurchaseValue(jpyBefore, 'krw'), 1_800_000, KRW_EPS);

  // 교정된 단가 쌍 — 스냅샷 내재 환율 9.5(=23,750/2,500)를 그대로 이어 쓴다
  const pair = correctSnapshotPricePair(jpyBefore, 2_200, Currency.JPY, 1_368.07);
  check('JPY 쌍 교정 성공', pair !== null, true);
  checkClose('JPY 교정 unitPriceOriginal = 종가 2,200', pair!.unitPriceOriginal, 2_200);
  checkClose('JPY 교정 unitPrice = 2,200 × 9.5 = 20,900', pair!.unitPrice, 20_900);

  // correctAssets가 이어서 하는 계산 그대로: 수량 = currentValue / unitPrice(옛 쌍) → 새 평가액
  const quantity = jpyBefore.currentValue / jpyBefore.unitPrice!;
  checkClose('역산 수량 100주', quantity, 100);
  const jpyAfter: AssetSnapshot = {
    ...jpyBefore,
    unitPrice: pair!.unitPrice,
    unitPriceOriginal: pair!.unitPriceOriginal,
    currentValue: quantity * pair!.unitPrice,
  };
  checkClose('백필 후 평가액 2,090,000', jpyAfter.currentValue, 2_090_000, KRW_EPS);

  // 핵심 골든 — 백필은 **종가 교정**이지 원금 변경이 아니다. 환율이 그대로면 원금도 그대로.
  checkClose('백필 후 JPY native 원금 1,900,000 (쌍 정합 가드)',
    deriveSnapshotPurchaseValue(jpyAfter, 'native'), 1_900_000, KRW_EPS);
  checkClose('백필 후 JPY krw 원금 = 저장값 1,800,000 (원화 모드 무영향)',
    deriveSnapshotPurchaseValue(jpyAfter, 'krw'), 1_800_000, KRW_EPS);

  // 수정 전 동작 재현 — unitPriceOriginal만 종가로 바뀌고 unitPrice/currentValue는 장중 옛값
  const jpyBroken: AssetSnapshot = { ...jpyBefore, unitPriceOriginal: 2_200 };
  checkClose('(수정 전) 반쪽 교정 스냅샷은 원금을 2,159,090.909…로 부풀렸다',
    deriveSnapshotPurchaseValue(jpyBroken, 'native'), 2_159_090.909090909, KRW_EPS);

  // ── 통화별 규칙 ──────────────────────────────────────────────────────────
  const usdSnap: AssetSnapshot = {
    id: 'xle', name: 'XLE', currency: Currency.USD,
    currentValue: 4_362_775.23, unitPrice: 87_255.5046, unitPriceOriginal: 63.78,
    purchaseValue: 4_427_455.2, purchaseUnitOriginal: 59.08,
  };
  const usdPair = correctSnapshotPricePair(usdSnap, 63.78, Currency.USD, 1_368.07);
  checkClose('USD 교정 unitPrice = 63.78 × 1,368.07 = 87,255.5046', usdPair!.unitPrice, 87_255.5046, 1e-9);
  checkClose('USD 교정 unitPriceOriginal = 63.78', usdPair!.unitPriceOriginal, 63.78);

  const krwPair = correctSnapshotPricePair(
    { unitPrice: 70_000, unitPriceOriginal: 70_000 }, 75_000, Currency.KRW, 1_368.07);
  check('KRW 교정은 환율 1 — 두 필드 모두 종가', krwPair, { unitPrice: 75_000, unitPriceOriginal: 75_000 });

  // ── 교정 불가 → null (반쪽 교정 금지) ────────────────────────────────────
  check('종가 0 → null', correctSnapshotPricePair(jpyBefore, 0, Currency.JPY, 1_368.07), null);
  check('종가 음수 → null', correctSnapshotPricePair(jpyBefore, -5, Currency.JPY, 1_368.07), null);
  check('USD 그날 환율 0 → null', correctSnapshotPricePair(usdSnap, 63.78, Currency.USD, 0), null);
  check('JPY 옛 unitPrice 없음 → null',
    correctSnapshotPricePair({ unitPriceOriginal: 2_500 }, 2_200, Currency.JPY, 1_368.07), null);
  check('JPY 옛 unitPriceOriginal 0 → null',
    correctSnapshotPricePair({ unitPrice: 23_750, unitPriceOriginal: 0 }, 2_200, Currency.JPY, 1_368.07), null);
  check('통화 미상(구 스냅샷) + 쌍 없음 → null',
    correctSnapshotPricePair({}, 2_200, undefined, 1_368.07), null);
  // 통화 미상이라도 쌍이 온전하면 내재 환율로 교정한다(외화 취급)
  check('통화 미상 + 쌍 온전 → 내재 환율 9.5 적용',
    correctSnapshotPricePair({ unitPrice: 23_750, unitPriceOriginal: 2_500 }, 2_200, undefined, 1_368.07),
    { unitPrice: 20_900, unitPriceOriginal: 2_200 });

  // CNY도 같은 규칙(내재 환율 200 = 40,000/200)
  check('CNY 내재 환율 이어쓰기',
    correctSnapshotPricePair({ unitPrice: 40_000, unitPriceOriginal: 200 }, 210, Currency.CNY, 1_368.07),
    { unitPrice: 42_000, unitPriceOriginal: 210 });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 복구 케이스 A — purchaseUnitOriginal 동반 삭제
//    "unitPrice도 기준 데이터도 없어 손익을 0으로 눌러 차트 폭발을 막는" 분기.
//    필드가 남으면 달러 모드에서만 없는 수익 +326,262.77원(+7.96%)이 생겼다.
// ════════════════════════════════════════════════════════════════════════════
{
  // refMap을 비우지 않기 위한 정상 자산(다른 id) — refMap이 비면 repair가 통째로 조기 반환한다
  const healthy: AssetSnapshot = {
    id: 'k1', name: '삼성전자', currency: Currency.KRW,
    currentValue: 375_000, unitPrice: 75_000, unitPriceOriginal: 75_000, purchaseValue: 350_000,
  };
  // 오염된 XLE — unitPrice 없음(수량 역산 불가) + 비율 11.29배
  const corrupted: AssetSnapshot = {
    id: 'xle', name: 'XLE', currency: Currency.USD,
    currentValue: 50_000_000, unitPriceOriginal: 63.78,
    purchaseValue: 4_427_455.2, purchaseUnitOriginal: 59.08,
  };
  const history: PortfolioSnapshot[] = [{ date: '2026-09-01', assets: [healthy, corrupted] }];

  const repaired = repairCorruptedSnapshots(history);
  const fixed = repaired[0].assets.find(a => a.id === 'xle')!;

  checkClose('케이스 A 평가액 = purchaseValue 4,427,455.2', fixed.currentValue, 4_427_455.2, KRW_EPS);
  check('케이스 A purchaseUnitOriginal 비움', fixed.purchaseUnitOriginal, undefined);
  check('케이스 A unitPriceOriginal은 유지(차트 축)', fixed.unitPriceOriginal, 63.78);

  checkClose('케이스 A native 원금 = 저장값 4,427,455.2', deriveSnapshotPurchaseValue(fixed, 'native'), 4_427_455.2, KRW_EPS);
  checkClose('케이스 A krw 원금 = 저장값 4,427,455.2', deriveSnapshotPurchaseValue(fixed, 'krw'), 4_427_455.2, KRW_EPS);
  checkClose('케이스 A native 손익 정확히 0', fixed.currentValue - deriveSnapshotPurchaseValue(fixed, 'native'), 0, KRW_EPS);
  checkClose('케이스 A krw 손익 정확히 0', fixed.currentValue - deriveSnapshotPurchaseValue(fixed, 'krw'), 0, KRW_EPS);

  // 정상 자산은 손대지 않는다
  check('정상 자산 무변경', repaired[0].assets.find(a => a.id === 'k1'), healthy);

  // 수정 전 동작 재현 — 눌러놓은 스냅샷에 purchaseUnitOriginal이 남아 있으면
  const beforeFix: AssetSnapshot = { ...fixed, purchaseUnitOriginal: 59.08 };
  checkClose('(수정 전) 케이스 A native 원금 4,101,192.4304797…',
    deriveSnapshotPurchaseValue(beforeFix, 'native'), 4_101_192.430479774, KRW_EPS);
  checkClose('(수정 전) 케이스 A native 손익 +326,262.7695…(없는 수익)',
    beforeFix.currentValue - deriveSnapshotPurchaseValue(beforeFix, 'native'), 326_262.7695202264, KRW_EPS);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 복구 다른 분기(수량 재구성)는 purchaseUnitOriginal을 **유지**해야 한다
//    새 currentValue가 그 스냅샷 자신의 unitPrice로 계산돼 쌍이 그대로 성립하기 때문.
// ════════════════════════════════════════════════════════════════════════════
{
  // 기준 스냅샷(정상): 수량 50주, 단가 87,255.5046 → 평가액 4,362,775.23 / 원금 4,427,455.2
  const good: AssetSnapshot = {
    id: 'xle', name: 'XLE', currency: Currency.USD,
    currentValue: 4_362_775.23, unitPrice: 87_255.5046, unitPriceOriginal: 63.78,
    purchaseValue: 4_427_455.2, purchaseUnitOriginal: 59.08,
  };
  // 오염 스냅샷: 평가액만 100배로 튐(unitPrice는 살아 있음)
  const blown: AssetSnapshot = { ...good, currentValue: 436_277_523 };
  const repaired = repairCorruptedSnapshots([
    { date: '2026-09-01', assets: [blown] },
    { date: '2026-09-02', assets: [good] },
  ]);
  const fixed = repaired[0].assets[0];

  // ref.purchaseValuePerUnit = 4,427,455.2 / 50 = 88,549.104 → 수량 50 복원 → 50 × 87,255.5046
  checkClose('수량 재구성 분기 평가액 4,362,775.23', fixed.currentValue, 4_362_775.23, KRW_EPS);
  check('수량 재구성 분기 purchaseUnitOriginal 유지', fixed.purchaseUnitOriginal, 59.08);
  checkClose('수량 재구성 후 native 원금 4,041,278.78 (표와 동일)',
    deriveSnapshotPurchaseValue(fixed, 'native'), 4_041_278.78, KRW_EPS);
}

// ════════════════════════════════════════════════════════════════════════════
console.log(`\n[historySnapshotParity] ${pass} passed, ${fails.length} failed`);
if (fails.length > 0) {
  fails.forEach(f => console.error(f));
  process.exit(1);
}
