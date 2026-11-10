// utils/loadTiming.ts
// 앱 시작 단계별 소요 시간 계측 (진단 전용, 순수 TS — React 없음).
//  · 단계 마크는 "처음 발생한 시각"만 기록한다 (performance.now() 기준, ms).
//  · 요청 통계는 종류별로 누적한다 (요청 수 / 종목 수 / 총 ms / 실패 수).
//  · 시세 갱신 종료(또는 건너뜀) AND enriched 종료가 모두 기록되면 1회 확정(localStorage 최근 10회 + 요약 로그)하고,
//    이후 모든 함수는 no-op 이다 (시작 이후 오버헤드 0).
//  · 어떤 경로에서도 throw 하지 않고 제어 흐름을 바꾸지 않는다. 이 키는 Drive 동기화 대상이 아닌 로컬 진단이다.
import { createLogger } from './logger';

const log = createLogger('LoadTiming');

export const LOAD_TIMING_STORAGE_KEY = 'asset-manager-load-timing-v1';
export const LOAD_TIMING_MAX_RUNS = 10;

export type LoadStage =
  | 'app-mount'
  | 'signed-in'
  | 'drive-load-start'
  | 'drive-load-end'
  | 'data-applied'
  | 'price-refresh-start'
  | 'price-refresh-end'
  | 'price-refresh-skipped'
  | 'enriched-start'
  | 'enriched-end'
  | 'backfill-start'
  | 'backfill-end';

export type LoadRequestKind = 'price' | 'history' | 'upbit' | 'upbit-history' | 'fx';

export interface LoadRequestStat {
  requests: number;
  tickers: number;
  totalMs: number;
  failures: number;
}

export interface LoadTimingRun {
  at: string;
  marks: Partial<Record<LoadStage, number>>;
  requests: Partial<Record<LoadRequestKind, LoadRequestStat>>;
}

let marks: Partial<Record<LoadStage, number>> = {};
let requests: Partial<Record<LoadRequestKind, LoadRequestStat>> = {};
let finalized = false;

function nowMs(): number {
  try {
    return Math.round(performance.now());
  } catch {
    return 0;
  }
}

function tryFinalize(): void {
  const priceDone = marks['price-refresh-end'] !== undefined || marks['price-refresh-skipped'] !== undefined;
  if (!priceDone || marks['enriched-end'] === undefined) return;
  finalized = true;
  const run: LoadTimingRun = { at: new Date().toISOString(), marks, requests };
  try {
    let runs: LoadTimingRun[] = [];
    try {
      const raw = localStorage.getItem(LOAD_TIMING_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) runs = parsed as LoadTimingRun[];
    } catch { /* ignore */ }
    runs.push(run);
    try {
      localStorage.setItem(LOAD_TIMING_STORAGE_KEY, JSON.stringify(runs.slice(-LOAD_TIMING_MAX_RUNS)));
    } catch { /* ignore */ }
  } catch { /* ignore */ }
  try {
    const m = Object.entries(marks).map(([k, v]) => `${k}=${v}`).join(' ');
    const r = Object.entries(requests)
      .map(([k, v]) => `${k}:${v?.requests}req/${v?.tickers}t/${v?.totalMs}ms/${v?.failures}fail`)
      .join(' ');
    log.info(`startup marks(ms) ${m} | requests ${r}`);
  } catch { /* ignore */ }
}

/** 단계 마크 — 같은 단계는 처음 한 번만 기록. */
export function markLoadStage(stage: LoadStage): void {
  if (finalized) return;
  try {
    if (marks[stage] === undefined) marks[stage] = nowMs();
    tryFinalize();
  } catch { /* never throw */ }
}

/** 요청 1건(재시도 포함) 통계 누적. */
export function recordLoadRequest(
  kind: LoadRequestKind,
  info: { tickers: number; ms: number; ok: boolean },
): void {
  if (finalized) return;
  try {
    const s = requests[kind] ?? { requests: 0, tickers: 0, totalMs: 0, failures: 0 };
    s.requests += 1;
    s.tickers += info.tickers;
    s.totalMs += Math.round(info.ms);
    if (!info.ok) s.failures += 1;
    requests[kind] = s;
  } catch { /* never throw */ }
}

/** 저장된 최근 실행 기록 (진단/테스트용). */
export function readLoadTimingRuns(): LoadTimingRun[] {
  try {
    const raw = localStorage.getItem(LOAD_TIMING_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as LoadTimingRun[]) : [];
  } catch {
    return [];
  }
}

/** 테스트 전용 — 모듈 상태 초기화. */
export function __resetLoadTimingForTest(): void {
  marks = {};
  requests = {};
  finalized = false;
}

/** 요청 소요 시간 측정용 시작 시각 (throw 안 함). */
export function loadTimingNow(): number {
  try { return performance.now(); } catch { return 0; }
}
