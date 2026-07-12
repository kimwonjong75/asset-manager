// tests/safeStorageParity.ts
// ---------------------------------------------------------------------------
// safeStorage 골든 테스트 — QuotaExceededError 방어 계층의 불변식을 절대값으로 고정.
//   · 정상 저장 → ok:true, 축출 없음.
//   · 용량 초과 + 축출로 공간 확보 → ok:true, evicted 에 캐시 키, 값 실제 저장.
//   · 용량 초과 + 축출해도 부족 → ok:false·quotaExceeded, 원본 미저장, 사용자 데이터 키 불변.
//   · isQuotaError 변종 판별 / 비-용량 예외는 축출 미실행.
//   · estimateUsageBytes 골든 절대값 / keepLast 꼬리 보존.
// 수동 실행: npx --yes tsx tests/safeStorageParity.ts. 통과 시 exit 0, 실패 시 exit 1.
// React/DOM import 없음 — 주입형 StorageLike 로만 검증(window 미접근).

import {
  setItemSafe,
  isQuotaError,
  estimateUsageBytes,
  keepLast,
  EVICTABLE_CACHE_KEYS,
  type StorageLike,
  type SafeSetResult,
} from '../utils/safeStorage';

let pass = 0;
const fails: string[] = [];
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else fails.push(`✗ ${name}: got ${a}, expected ${e}`);
}
function ok(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(`✗ ${name}: expected true`);
}

const SYMBOL_KEY = 'asset-manager-symbol-index-v1'; // EVICTABLE_CACHE_KEYS[0]
const VERDICTS_KEY = 'asset-manager-replay-verdicts-v1'; // 사용자 데이터 — 축출 금지 대상

// UTF-16 바이트 예산으로 setItem 을 제한하는 가짜 Storage(용량 초과 시 QuotaExceededError 유사 throw).
class FakeQuotaError extends Error {
  code = 22;
  constructor(msg = 'quota exceeded') {
    super(msg);
    this.name = 'QuotaExceededError';
  }
}

interface EnumerableStorage extends StorageLike {
  length: number;
  key(i: number): string | null;
  size(): number; // 헬퍼: 현재 바이트 사용량
}

function makeStorage(budgetBytes: number): EnumerableStorage {
  const map = new Map<string, string>();
  const usageExcluding = (skip?: string): number => {
    let b = 0;
    for (const [k, v] of map) {
      if (k === skip) continue;
      b += (k.length + v.length) * 2;
    }
    return b;
  };
  return {
    get length() {
      return map.size;
    },
    key(i: number): string | null {
      return [...map.keys()][i] ?? null;
    },
    getItem(k: string): string | null {
      return map.has(k) ? (map.get(k) as string) : null;
    },
    setItem(k: string, v: string): void {
      // 기존 키 교체를 반영한 최종 사용량이 예산을 넘으면 throw.
      const projected = usageExcluding(k) + (k.length + v.length) * 2;
      if (projected > budgetBytes) throw new FakeQuotaError();
      map.set(k, v);
    },
    removeItem(k: string): void {
      map.delete(k);
    },
    size(): number {
      return usageExcluding();
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 0. 고정 상수 — 축출 목록에 사용자 데이터가 없어야 한다(안전 불변식)
// ════════════════════════════════════════════════════════════════════════════
check('EVICTABLE_CACHE_KEYS = 심볼 인덱스만', EVICTABLE_CACHE_KEYS, [SYMBOL_KEY]);
ok('축출 목록에 판정 키 없음', !EVICTABLE_CACHE_KEYS.includes(VERDICTS_KEY));

// ════════════════════════════════════════════════════════════════════════════
// 1. 정상 저장 → ok:true, 축출 없음
// ════════════════════════════════════════════════════════════════════════════
{
  const s = makeStorage(10000);
  const r: SafeSetResult = setItemSafe('user-key', 'hello', s);
  check('정상 저장 ok', r.ok, true);
  check('정상 저장 evicted 없음', r.evicted, undefined);
  check('정상 저장 quotaExceeded 없음', r.quotaExceeded, undefined);
  check('정상 저장 값 확인', s.getItem('user-key'), 'hello');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 용량 초과 + 축출로 공간 확보 → ok:true, evicted 에 심볼 키, 값 실제 저장
// ════════════════════════════════════════════════════════════════════════════
{
  // 예산 200바이트. 심볼 캐시(대략 80바이트 점유) + 새 값이 함께면 초과, 축출 후엔 여유.
  const s = makeStorage(200);
  s.setItem(SYMBOL_KEY, 'x'.repeat(50)); // (31+50)*2 = 162 바이트 점유
  const before = s.size();
  ok('사전조건: 심볼 캐시 존재', s.getItem(SYMBOL_KEY) !== null && before > 100);

  const value = 'y'.repeat(60); // (8+60)*2 = 136 바이트 → 162+136=298 > 200 이지만 축출 후 136 <= 200
  const r = setItemSafe('newuser1', value, s);
  check('축출 후 저장 ok', r.ok, true);
  check('축출 후 evicted = 심볼 키', r.evicted, [SYMBOL_KEY]);
  check('축출 후 quotaExceeded 없음', r.quotaExceeded, undefined);
  check('축출 후 값 실제 저장', s.getItem('newuser1'), value);
  check('심볼 캐시 축출됨', s.getItem(SYMBOL_KEY), null);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 용량 초과 + 축출해도 부족 → ok:false·quotaExceeded, 원본 미저장, 사용자 데이터 불변
// ════════════════════════════════════════════════════════════════════════════
{
  // 예산 400: 판정(224B)+심볼(98B)=322B 는 수용, 아래 거대 blob 은 심볼 축출 후에도 초과.
  const s = makeStorage(400);
  s.setItem(VERDICTS_KEY, 'v'.repeat(80)); // 사용자 데이터 — 절대 삭제 금지
  s.setItem(SYMBOL_KEY, 'x'.repeat(20));
  const verdictBefore = s.getItem(VERDICTS_KEY);

  const huge = 'z'.repeat(400); // 축출 가능한 심볼을 지워도 예산 초과
  const r = setItemSafe('bigblob', huge, s);
  check('부족 시 ok=false', r.ok, false);
  check('부족 시 quotaExceeded=true', r.quotaExceeded, true);
  check('부족 시 evicted = 심볼 키', r.evicted, [SYMBOL_KEY]);
  check('부족 시 원본 미저장', s.getItem('bigblob'), null);
  check('사용자 데이터(판정) 불변', s.getItem(VERDICTS_KEY), verdictBefore);
  ok('사용자 데이터 여전히 존재', s.getItem(VERDICTS_KEY) !== null);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. isQuotaError 변종 판별
// ════════════════════════════════════════════════════════════════════════════
check('isQuotaError name=QuotaExceededError', isQuotaError({ name: 'QuotaExceededError' }), true);
check('isQuotaError name=NS_ERROR_DOM_QUOTA_REACHED', isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
check('isQuotaError code=22', isQuotaError({ code: 22 }), true);
check('isQuotaError code=1014', isQuotaError({ code: 1014 }), true);
check('isQuotaError 일반 에러 false', isQuotaError(new TypeError('x')), false);
check('isQuotaError null false', isQuotaError(null), false);
check('isQuotaError 문자열 false', isQuotaError('QuotaExceededError'), false);

// ════════════════════════════════════════════════════════════════════════════
// 5. 비-용량 예외 → ok:false, 축출 미실행(캐시 보존)
// ════════════════════════════════════════════════════════════════════════════
{
  const map = new Map<string, string>();
  let removeCalled = false;
  const s: StorageLike = {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: () => {
      throw new TypeError('non-quota failure');
    },
    removeItem: (k) => {
      removeCalled = true;
      map.delete(k);
    },
  };
  map.set(SYMBOL_KEY, 'cached');
  const r = setItemSafe('anything', 'v', s);
  check('비-용량 예외 ok=false', r.ok, false);
  check('비-용량 예외 quotaExceeded 없음', r.quotaExceeded, undefined);
  check('비-용량 예외 evicted 없음', r.evicted, undefined);
  ok('비-용량 예외 축출 미실행', removeCalled === false);
  check('비-용량 예외 캐시 보존', s.getItem(SYMBOL_KEY), 'cached');
}

// ════════════════════════════════════════════════════════════════════════════
// 6. estimateUsageBytes 골든 절대값
// ════════════════════════════════════════════════════════════════════════════
{
  const s = makeStorage(100000);
  s.setItem('ab', 'cde'); // (2+3)*2 = 10
  s.setItem('xy', 'zw'); // (2+2)*2 = 8
  check('estimateUsageBytes 골든(18)', estimateUsageBytes(s), 18);

  const empty = makeStorage(100000);
  check('estimateUsageBytes 빈 저장소 = 0', estimateUsageBytes(empty), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. keepLast — 60개 → 마지막 50개, 순서 보존
// ════════════════════════════════════════════════════════════════════════════
{
  const sixty = Array.from({ length: 60 }, (_, i) => i);
  const last50 = keepLast(sixty, 50);
  check('keepLast 길이 50', last50.length, 50);
  check('keepLast 첫 원소 = 10', last50[0], 10);
  check('keepLast 마지막 원소 = 59', last50[49], 59);
  check('keepLast 순서 보존', last50, Array.from({ length: 50 }, (_, i) => i + 10));
  check('keepLast 짧으면 원본 유지', keepLast([1, 2, 3], 50), [1, 2, 3]);
  check('keepLast max=0 → 빈 배열', keepLast([1, 2, 3], 0), []);
}

// ── 결과 ──
if (fails.length) {
  console.error(`\n❌ safeStorageParity: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
} else {
  console.log(`✅ safeStorageParity: ${pass} assertions passed`);
}
