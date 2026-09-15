// utils/todayTurtleCache.ts
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" 모듈 캐시 — **순수 판정만**. 캐시 저장소(Map)·in-flight 공유는 hooks/useTodayTurtle 이 소유한다.
//
// 왜 필요한가: 홈은 탭 전환마다 언마운트→재마운트되고, 훅의 loadedKeyRef 는 한 마운트 안에서만 중복을 막는다.
//   → 탭 재진입마다 POST /history(주식·코인 최대 2건, ≈130일)를 다시 불렀다.
//
// 신선도 규약:
//   · requestKey(대상 집합 + UTC 날짜)가 다르면 'miss'.
//   · **시장 현지 날짜 서명**이 다르면 'expired'. 완료봉 판정은 KR(Asia/Seoul)·US(America/New_York)·
//     CRYPTO(UTC) 현지 날짜로 하는데, requestKey 의 UTC 날짜만으로는 **KST 자정 넘김**을 놓친다
//     (예: 05:00Z=14:00 KST 장중에 받은 당일 진행 봉을 15:10Z=다음날 00:10 KST 에 완료봉으로 오인).
//   · 시계 역행(now < fetchedAt)·비유한 값은 보수적으로 'expired'.
//   · TTL(30분) 경과 시 'expired'.
// 저장 규약 (RULES §8 캐시 오염): **완전 성공(실패 0 + 대상 1 이상)만 저장**. 부분 실패·빈 결과는 저장하지 않는다.

import { todayInTz } from './todayTurtle';

/** 캐시 수명 — 30분. 가격 새로고침 버튼은 이 캐시를 비우지 않는다(날짜·서명·requestKey 가 신선도를 담당). */
export const TODAY_TURTLE_CACHE_TTL_MS = 30 * 60 * 1000;
/** 보관 최대 항목 수 (계정 뷰 전환 등으로 requestKey 가 몇 개 오갈 수 있다) */
export const TODAY_TURTLE_CACHE_MAX_ENTRIES = 4;

/**
 * 시장 현지 날짜 서명 `"KR날짜|US날짜|UTC날짜"`.
 * 시간대는 utils/todayTurtle 의 완료봉 판정(TZ_OF: KR=Asia/Seoul, US=America/New_York, CRYPTO=UTC)과 **같아야 한다**.
 * 셋 중 하나라도 날짜가 바뀌면 완료봉 경계가 바뀐 것이므로 캐시를 재사용하지 않는다.
 */
export function marketDaySignature(now: Date): string {
  return [
    todayInTz('Asia/Seoul', now),
    todayInTz('America/New_York', now),
    todayInTz('UTC', now),
  ].join('|');
}

export type TodayCacheVerdict = 'fresh' | 'expired' | 'miss';

/** 캐시 항목의 판정용 메타 (본문 데이터는 판정에 쓰지 않는다) */
export interface TodayCacheEntryMeta {
  requestKey: string;
  fetchedAtMs: number;
  signature: string;
}

export interface TodayCacheContext {
  requestKey: string;
  nowMs: number;
  signature: string;
}

export interface TodayCachePolicy {
  ttlMs: number;
}

/**
 * 캐시 항목 판정.
 *   · 항목 없음 / requestKey 불일치 → 'miss'
 *   · 서명 불일치 → 'expired'
 *   · 비유한 시각·TTL≤0 → 'expired' (보수적)
 *   · now < fetchedAt (시계 역행) → 'expired'
 *   · now − fetchedAt ≥ ttl → 'expired'  (경계값은 만료)
 *   · 그 외 → 'fresh'
 */
export function evaluateCacheEntry(
  entry: TodayCacheEntryMeta | undefined,
  ctx: TodayCacheContext,
  policy: TodayCachePolicy
): TodayCacheVerdict {
  if (!entry || entry.requestKey !== ctx.requestKey) return 'miss';
  if (entry.signature !== ctx.signature) return 'expired';
  if (!Number.isFinite(ctx.nowMs) || !Number.isFinite(entry.fetchedAtMs) || !(policy.ttlMs > 0)) return 'expired';
  if (ctx.nowMs < entry.fetchedAtMs) return 'expired';
  if (ctx.nowMs - entry.fetchedAtMs >= policy.ttlMs) return 'expired';
  return 'fresh';
}

/**
 * 캐시에 저장해도 되는 결과인가 — **실패 0 + 대상 1개 이상**.
 * 부분 실패를 저장하면 TTL 동안 'fetch-failed' 행이 재시도 없이 굳고, 빈 결과는 "신호 없음"으로 오인된다(RULES §8).
 */
export function isCacheableResult(result: { failed: number; total: number }): boolean {
  return result.failed === 0 && result.total > 0;
}

/**
 * 크기 제한 초과분의 삭제 대상 키 — Map **삽입 순서 기준 오래된 것부터**.
 * 호출부는 재저장 시 delete→set 으로 순서를 갱신한다. max 가 NaN 이면 삭제하지 않는다.
 */
export function pruneCacheEntries<K, V>(entries: ReadonlyMap<K, V>, max: number): K[] {
  const limit = Math.max(0, Math.floor(max));
  if (!Number.isFinite(limit) || entries.size <= limit) return [];
  const excess = entries.size - limit;
  const out: K[] = [];
  for (const k of entries.keys()) {
    if (out.length >= excess) break;
    out.push(k);
  }
  return out;
}

// ── 표시 선택 (훅의 렌더 파생값) ───────────────────────────────────────────

/** 훅 state 에 커밋된 결과 — 어떤 requestKey 의 결과인지 함께 보관 */
export interface KeyedTodayResult<R> {
  requestKey: string;
  raw: R | null;
  failedKeys: ReadonlySet<string>;
}

/** 렌더 중 캐시 엿보기로 얻은 결과 (현재 requestKey 기준으로 fresh 판정된 것만) */
export interface PeekedTodayResult<R> {
  raw: R | null;
  failedKeys: ReadonlySet<string>;
}

export type TodayDisplaySource = 'no-targets' | 'loaded' | 'cache' | 'previous-while-loading' | 'empty-while-loading';

export interface TodayDisplay<R> {
  source: TodayDisplaySource;
  raw: R | null;
  failedKeys: ReadonlySet<string>;
  isLoading: boolean;
}

const NO_FAILED_KEYS: ReadonlySet<string> = new Set<string>();

/**
 * 화면에 쓸 결과 선택 (effect 안 동기 setState 없이 로딩·캐시를 파생하기 위한 순수 규칙).
 *   1) 조회 대상 0 → raw=null, 로딩 아님 (이전 raw map 을 남기지 않는다)
 *   2) 현재 requestKey 로 커밋된 결과 → 그대로
 *   3) 렌더 중 캐시 엿보기(fresh) → 즉시 표시, 로딩 아님 (탭 재진입 로딩 깜빡임 방지)
 *   4) 이전 requestKey 결과만 있음 → 그것을 보여주되 로딩 중 (기존 동작: 새 조회 동안 이전 raw 유지)
 *   5) 아무것도 없음 → raw=null, 로딩 중
 */
export function selectDisplayedResult<R>(input: {
  requestKey: string;
  hasTargets: boolean;
  loaded: KeyedTodayResult<R> | null;
  peek: PeekedTodayResult<R> | null;
}): TodayDisplay<R> {
  const { requestKey, hasTargets, loaded, peek } = input;
  if (!hasTargets) return { source: 'no-targets', raw: null, failedKeys: NO_FAILED_KEYS, isLoading: false };
  if (loaded && loaded.requestKey === requestKey) {
    return { source: 'loaded', raw: loaded.raw, failedKeys: loaded.failedKeys, isLoading: false };
  }
  if (peek) return { source: 'cache', raw: peek.raw, failedKeys: peek.failedKeys, isLoading: false };
  if (loaded) return { source: 'previous-while-loading', raw: loaded.raw, failedKeys: loaded.failedKeys, isLoading: true };
  return { source: 'empty-while-loading', raw: null, failedKeys: NO_FAILED_KEYS, isLoading: true };
}
