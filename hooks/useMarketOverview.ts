import { useState, useCallback, useEffect, useRef } from 'react';
import { fetchMarketOverviewSnapshot } from '../services/marketOverviewService';
import { MarketOverviewSnapshot, MarketOverviewStatus } from '../types/marketOverview';
import { createLogger } from '../utils/logger';

const log = createLogger('MarketOverview');

const STORAGE_KEY = 'asset-manager-market-overview-cache';
const VISIBILITY_COOLDOWN_MS = 10 * 60 * 1000; // 10분

interface UseMarketOverviewReturn {
  snapshot: MarketOverviewSnapshot | null;
  status: MarketOverviewStatus;
  error: string | null;
  refresh: () => Promise<void>;
}

/** localStorage 캐시 로드 (실패 폴백 전용 — 성공 경로에서는 절대 먼저 표시하지 않음). */
function loadCache(): MarketOverviewSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.fetchedAt === 'string') {
      return parsed as MarketOverviewSnapshot;
    }
  } catch { /* ignore */ }
  return null;
}

function saveCache(snapshot: MarketOverviewSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch { /* ignore */ }
}

/**
 * 시장 요약(금 김치 프리미엄 + 환율) 상태 훅.
 *
 * 동작 (B안 — "앱을 연 순간의 진짜 현재값"):
 *  · 마운트 즉시 fresh 조회. 응답 전까지 snapshot=null(바가 '...' 표시).
 *  · 성공 → fresh 값 표시 + 캐시 저장. **과거 캐시를 현재값처럼 먼저 보여주지 않는다.**
 *  · 실패 → 캐시가 있으면 stale-fallback으로 표시('갱신 실패' 명시), 없으면 error.
 *  · StrictMode 이중 마운트/동시 호출은 in-flight 프라미스 공유로 1회만 실제 요청.
 */
export function useMarketOverview(): UseMarketOverviewReturn {
  const [snapshot, setSnapshot] = useState<MarketOverviewSnapshot | null>(null);
  const [status, setStatus] = useState<MarketOverviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef<Promise<MarketOverviewSnapshot | null> | null>(null);
  const lastFetchedAtRef = useRef<number>(0);
  const hasSnapshotRef = useRef<boolean>(false);

  const refresh = useCallback(async () => {
    // 동시 호출 dedupe (StrictMode 이중 마운트, 새로고침 버튼 연타 등)
    if (inFlightRef.current) {
      await inFlightRef.current;
      return;
    }
    setStatus('loading');
    setError(null);

    const p = fetchMarketOverviewSnapshot();
    inFlightRef.current = p;
    try {
      const result = await p;
      if (result) {
        setSnapshot(result);
        hasSnapshotRef.current = true;
        setStatus('fresh');
        lastFetchedAtRef.current = Date.now();
        saveCache(result);
      } else {
        // 전부 실패 — 이번 세션에 아직 fresh 값이 없으면 캐시로 폴백
        if (!hasSnapshotRef.current) {
          const cached = loadCache();
          if (cached) {
            setSnapshot(cached);
            setStatus('stale-fallback');
          } else {
            setStatus('error');
            setError('시세 조회 실패');
          }
        } else {
          // 이미 이번 세션 fresh 값 보유 — 그 값을 유지한 채 실패만 표시
          setStatus('error');
          setError('갱신 실패');
        }
      }
    } catch (e) {
      log.error(e);
      if (!hasSnapshotRef.current) {
        const cached = loadCache();
        if (cached) {
          setSnapshot(cached);
          setStatus('stale-fallback');
        } else {
          setStatus('error');
          setError('시세 조회 실패');
        }
      } else {
        setStatus('error');
        setError('갱신 실패');
      }
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  // 마운트 시 1회 fresh 조회
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 탭 재활성화 시 10분 쿨다운 후 갱신
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const elapsed = Date.now() - lastFetchedAtRef.current;
      if (elapsed >= VISIBILITY_COOLDOWN_MS) refresh();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refresh]);

  return { snapshot, status, error, refresh };
}
