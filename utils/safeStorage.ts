// utils/safeStorage.ts
// localStorage 안전 쓰기 — QuotaExceededError 방어 계층.
//
// 목적: 프로젝트 어디에도 용량 초과 처리가 없어 성장 키(리플레이 사례/판정·어시스턴트 기록)가
//       조용히 저장 실패하던 문제를 막는다.
// 동작: setItem 실패가 "용량 초과"면 → **재취득 가능한 저우선 캐시만** 순서대로 축출하며 재시도.
//       모든 축출 후에도 실패하면 절대 throw 하지 않고 { ok:false, quotaExceeded:true } 반환 +
//       'asset-manager:storage-warning' CustomEvent 발화(UI가 UpdateStatusIndicator 로 표면화).
// 불변식:
//   · 축출 대상은 **재취득 가능한 캐시(EVICTABLE_CACHE_KEYS)** 뿐 — 사용자 데이터(판정/사례/설정/토큰)는 절대 삭제 금지.
//   · window/localStorage 부재(Node·테스트) 안전 — 주입형 StorageLike 로 테스트 가능.
//   · 순수 계층: React/DOM import 없음(window 접근은 typeof 가드).

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface SafeSetResult {
  ok: boolean;
  evicted?: string[];
  quotaExceeded?: boolean;
}

/**
 * 용량 초과 시 축출 가능한 저우선 캐시 키 — **고정 순서**.
 * 기준: TTL 있고 서버/네트워크로 재취득 가능하며 사용자가 생성하지 않은 데이터만.
 *  · asset-manager-symbol-index-v1 : 종목 인덱스(24h TTL, Cloud Run /symbols 재fetch 가능) — services/symbolListService.ts
 * ⚠️ 판정(verdicts)·사례(cases)·설정·토큰 등 사용자 데이터는 절대 추가 금지.
 */
export const EVICTABLE_CACHE_KEYS: readonly string[] = [
  'asset-manager-symbol-index-v1',
];

export const STORAGE_WARNING_EVENT = 'asset-manager:storage-warning';

/**
 * 용량 초과 예외 판별 — 브라우저별 이름/코드 변종을 모두 커버.
 *  · 표준 DOMException name 'QuotaExceededError'
 *  · Firefox 레거시 'NS_ERROR_DOM_QUOTA_REACHED'
 *  · code 22(표준) / 1014(Firefox 레거시)
 */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: unknown; code?: unknown };
  const name = typeof err.name === 'string' ? err.name : '';
  const code = typeof err.code === 'number' ? err.code : undefined;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // 프라이버시 모드 등에서 localStorage 접근 자체가 throw — 저장 불가로 처리.
  }
  return null;
}

function dispatchWarning(key: string, message: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_WARNING_EVENT, { detail: { key, message } }));
  } catch {
    // CustomEvent 미지원 환경 — 무시(경보 표면화 실패해도 반환값으로 호출부가 인지).
  }
}

/**
 * 안전한 setItem. 절대 throw 하지 않는다.
 * @returns ok=true 저장 성공 / ok=false 실패(quotaExceeded 로 원인 구분, evicted 로 축출 내역).
 */
export function setItemSafe(key: string, value: string, storage?: StorageLike): SafeSetResult {
  const store = resolveStorage(storage);
  if (!store) return { ok: false };

  try {
    store.setItem(key, value);
    return { ok: true };
  } catch (e) {
    // 용량 초과가 아닌 다른 실패(직렬화·보안 등)는 축출 없이 즉시 실패 — 캐시를 헛되이 지우지 않는다.
    if (!isQuotaError(e)) return { ok: false };
  }

  // 용량 초과 — 재취득 가능한 캐시를 고정 순서로 축출하며 매번 재시도.
  const evicted: string[] = [];
  for (const cacheKey of EVICTABLE_CACHE_KEYS) {
    if (cacheKey === key) continue; // 자기 자신은 축출 대상 아님
    let removedThis = false;
    try {
      if (store.getItem(cacheKey) === null) continue; // 이미 없음 — 확보할 공간 없음, 건너뜀
      store.removeItem(cacheKey);
      evicted.push(cacheKey);
      removedThis = true;
    } catch {
      continue;
    }
    if (!removedThis) continue;
    try {
      store.setItem(key, value);
      return { ok: true, evicted };
    } catch (e) {
      if (!isQuotaError(e)) return { ok: false, evicted };
      // 여전히 초과 — 다음 캐시로 계속.
    }
  }

  const message = `저장 공간이 가득 찼습니다 (key: ${key})`;
  dispatchWarning(key, message);
  return { ok: false, quotaExceeded: true, evicted };
}

// ── 관찰성(observability) ──

function collectKeys(store: StorageLike): string[] {
  // 브라우저 Storage 는 length + key(i) 로 열거 가능. 그 외(주입 StorageLike)는 Object.keys 폴백.
  const anyStore = store as unknown as { length?: number; key?: (i: number) => string | null };
  if (typeof anyStore.length === 'number' && typeof anyStore.key === 'function') {
    const keys: string[] = [];
    for (let i = 0; i < anyStore.length; i++) {
      const k = anyStore.key(i);
      if (k !== null) keys.push(k);
    }
    return keys;
  }
  return Object.keys(store as unknown as Record<string, unknown>);
}

/** 대략적 사용량(바이트) — 모든 (key+value) 길이 합 ×2 (UTF-16). 로깅/관찰용. */
export function estimateUsageBytes(storage?: StorageLike): number {
  const store = resolveStorage(storage);
  if (!store) return 0;
  let bytes = 0;
  for (const k of collectKeys(store)) {
    const v = store.getItem(k);
    bytes += (k.length + (v ? v.length : 0)) * 2;
  }
  return bytes;
}

/** 배열 뒤쪽 max 개만 유지(순서 보존). 성장 기록을 최근 N개로 제한 — 어시스턴트 대화 등. */
export function keepLast<T>(items: T[], max: number): T[] {
  if (max < 0) return [];
  return items.length <= max ? items : items.slice(items.length - max);
}
