// tests/allocationTargetsParity.ts
// ---------------------------------------------------------------------------
// AllocationTargets 저장 병합(Phase 4b-1) 골든 테스트.
// 핵심: **목표비중만 저장해도 categoryInstruments(대표 종목 매핑)가 보존**된다.
// 수동 실행: npm run test:alloc (tsx). 통과 시 exit 0.

import { AllocationTargets, Currency, RebalanceInstrument } from '../types';
import { buildAllocationTargetsSave, isAllocationDirty } from '../utils/allocationTargets';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}

const inst = (t: string, cid: number): RebalanceInstrument => ({ ticker: t, exchange: 'KRX (코스피/코스닥)', categoryId: cid, currency: Currency.KRW });

// ════════════════════════════════════════════════════════════════════════════
// 1. 목표비중만 저장 — categoryInstruments 보존 (핵심 결함 방지)
// ════════════════════════════════════════════════════════════════════════════
{
  const prev: AllocationTargets = {
    weights: { '1': 40, '2': 60 },
    targetTotalAmount: 10_000_000,
    bucketWeights: { CORE: 90, SATELLITE: 10 },
    categoryInstruments: { '1': inst('KODEX200', 1) },
  };
  // 매핑 미관리(undefined) — 목표비중만 편집
  const saved = buildAllocationTargetsSave(prev, {
    weights: { '1': 50, '2': 50 },
    targetTotalAmount: 12_000_000,
    bucketWeights: { CORE: 90, SATELLITE: 10 },
  });
  check('weights 갱신', saved.weights, { '1': 50, '2': 50 });
  check('targetTotalAmount 갱신', saved.targetTotalAmount, 12_000_000);
  check('★ categoryInstruments 보존', saved.categoryInstruments, { '1': inst('KODEX200', 1) });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 매핑 편집값 있으면 반영 (추가)
// ════════════════════════════════════════════════════════════════════════════
{
  const prev: AllocationTargets = { weights: {}, categoryInstruments: { '1': inst('OLD', 1) } };
  const saved = buildAllocationTargetsSave(prev, {
    weights: {}, targetTotalAmount: 0, bucketWeights: {},
    categoryInstruments: { '1': inst('KODEX200', 1), '2': inst('TIGERGOLD', 7) },
  });
  check('매핑 교체+추가', saved.categoryInstruments, { '1': inst('KODEX200', 1), '2': inst('TIGERGOLD', 7) });
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 전량 삭제({})는 그대로 반영 (undefined 아님)
// ════════════════════════════════════════════════════════════════════════════
{
  const prev: AllocationTargets = { weights: {}, categoryInstruments: { '1': inst('KODEX200', 1) } };
  const saved = buildAllocationTargetsSave(prev, { weights: {}, targetTotalAmount: 0, bucketWeights: {}, categoryInstruments: {} });
  check('전량 삭제 반영', saved.categoryInstruments, {});
}

// ════════════════════════════════════════════════════════════════════════════
// 4. prev에 매핑 없음 + 편집도 없음 → undefined 유지(억지 생성 안 함)
// ════════════════════════════════════════════════════════════════════════════
{
  const prev: AllocationTargets = { weights: { '1': 100 } };
  const saved = buildAllocationTargetsSave(prev, { weights: { '1': 100 }, targetTotalAmount: 5_000_000, bucketWeights: { CORE: 100 } });
  check('매핑 undefined 유지', saved.categoryInstruments, undefined);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. prev의 미래/미관리 필드 보존 (spread)
// ════════════════════════════════════════════════════════════════════════════
{
  const prev = { weights: { '1': 100 }, bucketWeights: { CORE: 100 }, futureField: 42 } as unknown as AllocationTargets;
  const saved = buildAllocationTargetsSave(prev, { weights: { '1': 50 }, targetTotalAmount: 1, bucketWeights: { CORE: 100 } });
  check('미래 필드 보존', (saved as unknown as { futureField: number }).futureField, 42);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. isAllocationDirty — canonicalize 비교 (오탐 방지 + undefined≡{} 의미 보존)
// ════════════════════════════════════════════════════════════════════════════
{
  const saved: AllocationTargets = { weights: { '1': 40, '2': 60 }, targetTotalAmount: 10_000_000, bucketWeights: { CORE: 90, SATELLITE: 10 }, categoryInstruments: { '1': inst('KODEX200', 1) } };
  const editSame = { weights: { '1': 40, '2': 60 }, bucketWeights: { CORE: 90, SATELLITE: 10 }, targetTotalAmount: 10_000_000, categoryInstruments: { '1': inst('KODEX200', 1) } };
  check('동일 → not dirty', isAllocationDirty(editSame, saved), false);
  check('weights 변경 → dirty', isAllocationDirty({ ...editSame, weights: { '1': 50, '2': 50 } }, saved), true);
  check('bucketWeights 변경 → dirty', isAllocationDirty({ ...editSame, bucketWeights: { CORE: 80, SATELLITE: 20 } }, saved), true);
  check('targetTotalAmount 변경 → dirty', isAllocationDirty({ ...editSame, targetTotalAmount: 12_000_000 }, saved), true);
  check('매핑 추가 → dirty', isAllocationDirty({ ...editSame, categoryInstruments: { '1': inst('KODEX200', 1), '2': inst('X', 2) } }, saved), true);
}
{
  // 키 순서 무관 (오탐 방지)
  const saved: AllocationTargets = { weights: { '1': 40, '2': 60 } };
  const editReordered = { weights: { '2': 60, '1': 40 }, bucketWeights: {}, targetTotalAmount: 0, categoryInstruments: {} };
  check('키 순서 달라도 not dirty', isAllocationDirty(editReordered, saved), false);
}
{
  // instrument 내부 키 순서 무관
  const saved: AllocationTargets = { weights: {}, categoryInstruments: { '1': { ticker: 'A', exchange: 'KRX (코스피/코스닥)', categoryId: 1, currency: Currency.KRW } } };
  const edit = { weights: {}, bucketWeights: {}, targetTotalAmount: 0, categoryInstruments: { '1': { currency: Currency.KRW, categoryId: 1, exchange: 'KRX (코스피/코스닥)', ticker: 'A' } as RebalanceInstrument } };
  check('instrument 키 순서 무관 not dirty', isAllocationDirty(edit, saved), false);
}
{
  // undefined ≡ {} (매핑 없음은 동일)
  const savedNoInst: AllocationTargets = { weights: { '1': 100 }, bucketWeights: { CORE: 100 }, targetTotalAmount: 5_000_000 };
  const editEmptyInst = { weights: { '1': 100 }, bucketWeights: { CORE: 100 }, targetTotalAmount: 5_000_000, categoryInstruments: {} };
  check('매핑 undefined≡{} → not dirty', isAllocationDirty(editEmptyInst, savedNoInst), false);
  // 저장본 {'1':inst} vs 편집 {} (전량 삭제) → dirty
  const savedWithInst: AllocationTargets = { ...savedNoInst, categoryInstruments: { '1': inst('KODEX200', 1) } };
  check('전량 삭제 → dirty', isAllocationDirty(editEmptyInst, savedWithInst), true);
}
{
  // undefined 목표금액 ≡ 0
  const saved: AllocationTargets = { weights: {} };
  const edit = { weights: {}, bucketWeights: {}, targetTotalAmount: 0, categoryInstruments: {} };
  check('targetTotalAmount undefined≡0 → not dirty', isAllocationDirty(edit, saved), false);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ allocationTargets parity 실패 (${fails.length})`);
  fails.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log(`✅ allocationTargets parity 전체 통과 (${pass} 단언)`);
