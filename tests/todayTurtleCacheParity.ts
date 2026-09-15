// tests/todayTurtleCacheParity.ts
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" 모듈 캐시 순수 판정 골든 테스트 (Stage D2 F1).
// 명시적 골든 절대값을 고정한다 (RULES §13 — 경로A-vs-경로B 자기참조 비교 금지).
//
// 실행: npx tsx tests/todayTurtleCacheParity.ts

import { readFileSync } from 'fs';
import {
  marketDaySignature, evaluateCacheEntry, isCacheableResult, pruneCacheEntries, selectDisplayedResult,
  TODAY_TURTLE_CACHE_TTL_MS, TODAY_TURTLE_CACHE_MAX_ENTRIES,
  type TodayCacheEntryMeta, type KeyedTodayResult,
} from '../utils/todayTurtleCache';

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) pass++;
  else { fail++; console.error(`  ✗ ${name}\n      기대=${String(expected)} 실제=${String(actual)}`); }
}

const at = (iso: string): number => Date.parse(iso);
const policy = { ttlMs: TODAY_TURTLE_CACHE_TTL_MS };

// ── 상수 ────────────────────────────────────────────────────────────────────
check('TTL = 30분(1,800,000ms)', TODAY_TURTLE_CACHE_TTL_MS, 1_800_000);
check('최대 항목 4', TODAY_TURTLE_CACHE_MAX_ENTRIES, 4);

// ── marketDaySignature ─────────────────────────────────────────────────────
check('05:00Z = KST 14:00 / EDT 01:00 → 세 날짜 동일',
  marketDaySignature(new Date('2026-09-15T05:00:00Z')), '2026-09-15|2026-09-15|2026-09-15');
check('15:10Z = KST 다음날 00:10 → KR 날짜만 넘어감',
  marketDaySignature(new Date('2026-09-15T15:10:00Z')), '2026-09-16|2026-09-15|2026-09-15');
check('03:30Z = EDT 전날 23:30 → US 만 전날',
  marketDaySignature(new Date('2026-09-16T03:30:00Z')), '2026-09-16|2026-09-15|2026-09-16');
check('04:10Z = EDT 00:10 → US 날짜 넘어감',
  marketDaySignature(new Date('2026-09-16T04:10:00Z')), '2026-09-16|2026-09-16|2026-09-16');
// DST 인접 (2026-11-01 06:00Z 에 EDT→EST)
check('DST 종료 당일 05:30Z = EDT 01:30 → US 2026-11-01',
  marketDaySignature(new Date('2026-11-01T05:30:00Z')), '2026-11-01|2026-11-01|2026-11-01');
check('DST 종료 당일 04:30Z = EDT 00:30 (EST 고정이면 10-31 로 틀림)',
  marketDaySignature(new Date('2026-11-01T04:30:00Z')), '2026-11-01|2026-11-01|2026-11-01');
check('DST 종료 다음날 04:30Z = EST 23:30 전날 (EDT 고정이면 11-02 로 틀림)',
  marketDaySignature(new Date('2026-11-02T04:30:00Z')), '2026-11-02|2026-11-01|2026-11-02');

// ── evaluateCacheEntry ─────────────────────────────────────────────────────
const SIG = '2026-09-15|2026-09-15|2026-09-15';
const entry: TodayCacheEntryMeta = { requestKey: 'K1', fetchedAtMs: at('2026-09-15T10:00:00.000Z'), signature: SIG };
check('TTL 1ms 전 → fresh',
  evaluateCacheEntry(entry, { requestKey: 'K1', nowMs: at('2026-09-15T10:29:59.999Z'), signature: SIG }, policy), 'fresh');
check('TTL 정확히 경계 → expired',
  evaluateCacheEntry(entry, { requestKey: 'K1', nowMs: at('2026-09-15T10:30:00.000Z'), signature: SIG }, policy), 'expired');
check('fetchedAt 과 같은 시각 → fresh',
  evaluateCacheEntry(entry, { requestKey: 'K1', nowMs: at('2026-09-15T10:00:00.000Z'), signature: SIG }, policy), 'fresh');
check('requestKey 불일치 → miss',
  evaluateCacheEntry(entry, { requestKey: 'K2', nowMs: at('2026-09-15T10:05:00.000Z'), signature: SIG }, policy), 'miss');
check('항목 없음 → miss',
  evaluateCacheEntry(undefined, { requestKey: 'K1', nowMs: at('2026-09-15T10:05:00.000Z'), signature: SIG }, policy), 'miss');
check('시계 역행(now < fetchedAt) → expired',
  evaluateCacheEntry(entry, { requestKey: 'K1', nowMs: at('2026-09-15T09:59:59.999Z'), signature: SIG }, policy), 'expired');
check('now NaN → expired',
  evaluateCacheEntry(entry, { requestKey: 'K1', nowMs: NaN, signature: SIG }, policy), 'expired');

// KST 자정 넘김: 05:00Z(14:00 KST) 에 받은 항목을 15:10Z(00:10 KST 다음날) 에 — TTL 은 판정과 무관하게 서명으로 만료
const kstEntry: TodayCacheEntryMeta = {
  requestKey: 'K1', fetchedAtMs: at('2026-09-15T14:50:00.000Z'),
  signature: marketDaySignature(new Date('2026-09-15T14:50:00.000Z')),
};
check('14:50Z 서명 = KST 23:50 → KR 아직 9/15', kstEntry.signature, '2026-09-15|2026-09-15|2026-09-15');
check('TTL 20분 이내라도 KST 자정 넘기면 expired',
  evaluateCacheEntry(kstEntry, {
    requestKey: 'K1', nowMs: at('2026-09-15T15:10:00.000Z'), signature: marketDaySignature(new Date('2026-09-15T15:10:00.000Z')),
  }, policy), 'expired');
check('같은 서명·TTL 이내면 fresh (대조군)',
  evaluateCacheEntry(kstEntry, { requestKey: 'K1', nowMs: at('2026-09-15T14:59:59.000Z'), signature: SIG }, policy), 'fresh');
// US 자정 넘김도 동일
const usEntry: TodayCacheEntryMeta = {
  requestKey: 'K1', fetchedAtMs: at('2026-09-16T03:50:00.000Z'),
  signature: marketDaySignature(new Date('2026-09-16T03:50:00.000Z')),
};
check('US 자정(04:00Z) 넘기면 TTL 이내라도 expired',
  evaluateCacheEntry(usEntry, {
    requestKey: 'K1', nowMs: at('2026-09-16T04:10:00.000Z'), signature: marketDaySignature(new Date('2026-09-16T04:10:00.000Z')),
  }, policy), 'expired');

// ── isCacheableResult ──────────────────────────────────────────────────────
check('실패 0 / 대상 5 → 저장', isCacheableResult({ failed: 0, total: 5 }), true);
check('실패 1 / 대상 5 → 저장 금지(부분 실패)', isCacheableResult({ failed: 1, total: 5 }), false);
check('실패 0 / 대상 0 → 저장 금지(빈 결과)', isCacheableResult({ failed: 0, total: 0 }), false);
check('전부 실패 → 저장 금지', isCacheableResult({ failed: 5, total: 5 }), false);

// ── pruneCacheEntries ──────────────────────────────────────────────────────
const m5 = new Map<string, number>();
['a', 'b', 'c', 'd', 'e'].forEach((k, i) => m5.set(k, i));
const pruned5 = pruneCacheEntries(m5, 4);
check('5개 삽입·최대 4 → 삭제 1개', pruned5.length, 1);
check('5개 삽입·최대 4 → 가장 먼저 넣은 키', pruned5[0], 'a');
const m4 = new Map<string, number>([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
check('4개·최대 4 → 삭제 없음', pruneCacheEntries(m4, 4).length, 0);
const m6 = new Map<string, number>([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5], ['f', 6]]);
check('6개·최대 4 → a,b', pruneCacheEntries(m6, 4).join(','), 'a,b');
// delete→set 재삽입은 순서를 뒤로 보낸다 (훅의 저장 규약)
const mRe = new Map<string, number>([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
mRe.delete('a'); mRe.set('a', 9); mRe.set('e', 5);
check('재저장한 a 는 뒤로 → 삭제 대상은 b', pruneCacheEntries(mRe, 4).join(','), 'b');
check('max NaN → 삭제 없음', pruneCacheEntries(m6, NaN).length, 0);

// ── selectDisplayedResult ──────────────────────────────────────────────────
const failedA: ReadonlySet<string> = new Set(['A']);
const loadedK1: KeyedTodayResult<string> = { requestKey: 'K1', raw: 'RAW-K1', failedKeys: failedA };
{
  const d = selectDisplayedResult<string>({ requestKey: 'K0', hasTargets: false, loaded: loadedK1, peek: { raw: 'RAW-P', failedKeys: new Set() } });
  check('대상 0 → no-targets', d.source, 'no-targets');
  check('대상 0 → raw null (이전 raw 폐기)', d.raw, null);
  check('대상 0 → 로딩 아님', d.isLoading, false);
  check('대상 0 → 실패 0', d.failedKeys.size, 0);
}
{
  const d = selectDisplayedResult<string>({ requestKey: 'K1', hasTargets: true, loaded: loadedK1, peek: { raw: 'RAW-P', failedKeys: new Set() } });
  check('같은 키 커밋 결과가 캐시 엿보기보다 우선', d.source, 'loaded');
  check('loaded raw', d.raw, 'RAW-K1');
  check('loaded 실패키 유지', d.failedKeys.has('A'), true);
  check('loaded → 로딩 아님', d.isLoading, false);
}
{
  const d = selectDisplayedResult<string>({ requestKey: 'K2', hasTargets: true, loaded: loadedK1, peek: { raw: 'RAW-K2', failedKeys: new Set() } });
  check('키 바뀜 + fresh 캐시 → cache (로딩 깜빡임 없음)', d.source, 'cache');
  check('cache raw', d.raw, 'RAW-K2');
  check('cache → 로딩 아님', d.isLoading, false);
}
{
  const d = selectDisplayedResult<string>({ requestKey: 'K2', hasTargets: true, loaded: loadedK1, peek: null });
  check('키 바뀜 + 캐시 없음 → 이전 결과 유지하며 로딩', d.source, 'previous-while-loading');
  check('이전 raw 유지', d.raw, 'RAW-K1');
  check('이전 결과 표시 중 로딩', d.isLoading, true);
}
{
  const d = selectDisplayedResult<string>({ requestKey: 'K1', hasTargets: true, loaded: null, peek: null });
  check('최초 마운트 + 캐시 없음 → empty-while-loading', d.source, 'empty-while-loading');
  check('최초 raw null', d.raw, null);
  check('최초 로딩', d.isLoading, true);
}
{
  const d = selectDisplayedResult<string>({ requestKey: 'K1', hasTargets: true, loaded: null, peek: { raw: 'RAW-P', failedKeys: new Set() } });
  check('최초 마운트 + fresh 캐시 → cache, 로딩 아님', `${d.source}/${d.isLoading}`, 'cache/false');
}
{
  // 대상 0 커밋(raw null) 뒤 새 키 조회 중 → 옛 raw map 이 되살아나지 않는다
  const afterEmpty: KeyedTodayResult<string> = { requestKey: 'K0', raw: null, failedKeys: new Set() };
  const d = selectDisplayedResult<string>({ requestKey: 'K3', hasTargets: true, loaded: afterEmpty, peek: null });
  check('대상0 커밋 뒤 새 키 로딩 → raw null', d.raw, null);
  check('대상0 커밋 뒤 새 키 로딩 → 로딩 중', d.isLoading, true);
}

// ── 구조 가드 ──────────────────────────────────────────────────────────────
const utilSrc = readFileSync(new URL('../utils/todayTurtleCache.ts', import.meta.url), 'utf-8');
check('utils/todayTurtleCache: react import 없음(순수)', /from ['"]react['"]/.test(utilSrc), false);
check('utils/todayTurtleCache: services import 없음', utilSrc.includes('/services/'), false);
check('utils/todayTurtleCache: 모듈 Map 저장소 없음(상태는 훅 소유)', /new Map\s*</.test(utilSrc), false);

const hookSrc = readFileSync(new URL('../hooks/useTodayTurtle.ts', import.meta.url), 'utf-8');
check('훅: 캐시 저장은 isCacheableResult 게이트 경유', hookSrc.includes('isCacheableResult('), true);
check('훅: 신선도 판정은 evaluateCacheEntry 경유', hookSrc.includes('evaluateCacheEntry('), true);
check('훅: 오래된 응답 가드 유지(isStaleResponse)', hookSrc.includes('isStaleResponse('), true);
check('훅: 저장 함수 미사용(saveNow)', hookSrc.includes('saveNow('), false);
check('훅: 저장 함수 미사용(commitPortfolio)', hookSrc.includes('commitPortfolio('), false);
check('훅: 큐 생성 미사용(updateActionQueue)', hookSrc.includes('updateActionQueue('), false);

console.log(`\ntodayTurtleCacheParity: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
