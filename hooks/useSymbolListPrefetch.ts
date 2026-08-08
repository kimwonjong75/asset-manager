// hooks/useSymbolListPrefetch.ts
// 로그인 직후 종목 목록(약 1.3MB)을 백그라운드로 미리 받아 **첫 종목검색의 대기를 없앤다**.
//
// 왜 필요한가
//  · 백엔드 `/symbols` 는 gzip 미적용 1.29MB(RULES §14 측정) — 느린 회선/콜드 스타트에서 첫 검색이 초 단위로 걸린다.
//  · 대시보드를 보는 동안 미리 받아두면 자산추가 모달을 열었을 때 이미 캐시가 준비돼 있다.
//
// 설계 원칙
//  · **실질 비용은 기기당 하루 1회** — 메모리/localStorage(24h TTL) + HTTP 캐시(max-age=86400)가 있으면 네트워크를 타지 않는다.
//  · **시세 초기 로딩과 경쟁하지 않는다**: `isLoading`이 끝난 뒤 + 유휴 지연 후 시작.
//    백엔드가 단일 인스턴스면 무거운 `/symbols`가 시세 배치 앞에 끼어들어 초기 로딩을 늦출 수 있다.
//  · **세션당 1회만 시도**하고 실패는 무시한다 — 사유는 실제 검색 시 모달이 `searchError`로 표시한다.
//  · 서버 파생 **캐시만** 기록한다(사용자 데이터 아님) → '보이지 않는 쓰기 금지' 규칙 대상이 아니다.

import { useEffect, useRef } from 'react';
import { loadSymbolList } from '../services/symbolListService';
import { createLogger } from '../utils/logger';

const log = createLogger('symbolPrefetch');

/** 시세 초기 로딩이 끝난 뒤 프리페치를 시작하기까지의 유휴 지연. */
export const PREFETCH_IDLE_DELAY_MS = 3000;

export interface PrefetchGateState {
  /** Google Drive 로그인 여부 */
  isSignedIn: boolean;
  /** 시세 갱신 진행 여부 */
  isLoading: boolean;
  /** 이번 세션에 이미 시도했는지 */
  attempted: boolean;
}

/**
 * 프리페치 착수 조건 (순수 함수 — 회귀 테스트 대상).
 * 로그인 완료 && 초기/수동 시세 로딩 종료 && 이번 세션 미시도. 세 조건 중 하나라도 어긋나면 착수하지 않는다.
 */
export function shouldPrefetchSymbols(state: PrefetchGateState): boolean {
  return state.isSignedIn && !state.isLoading && !state.attempted;
}

/**
 * 로그인 + 초기 로딩 완료 후 종목 목록을 백그라운드로 받아 캐시에 올린다.
 * @param isSignedIn Google Drive 로그인 여부 (미로그인 시 아무것도 하지 않음)
 * @param isLoading  시세 갱신 진행 여부 (진행 중이면 끝날 때까지 대기)
 */
export function useSymbolListPrefetch(isSignedIn: boolean, isLoading: boolean): void {
  // 세션당 1회 — 실패해도 재시도하지 않는다(1.3MB 재요청 폭주 방지).
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!shouldPrefetchSymbols({ isSignedIn, isLoading, attempted: attemptedRef.current })) return;

    let alive = true;
    const timer = setTimeout(() => {
      if (!alive) return;
      attemptedRef.current = true;
      loadSymbolList()
        .then(list => { log.debug(`Prefetched ${list.length} symbols`); })
        .catch(() => { /* 사유 표시는 검색 경로(모달 searchError)가 담당 */ });
    }, PREFETCH_IDLE_DELAY_MS);

    return () => { alive = false; clearTimeout(timer); };
  }, [isSignedIn, isLoading]);
}
