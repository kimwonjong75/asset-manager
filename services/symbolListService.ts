// 키리스(Keyless) 종목 검색
// =====================================
// 백엔드(Cloud Run `/symbols`)에서 전체 종목 목록을 1회만 내려받아
// 브라우저 메모리/localStorage에 캐시하고, 검색 매칭은 클라이언트에서 즉시 수행한다.
// - 사용자 Gemini API 키가 전혀 필요 없다 (기본 검색 경로).
// - 키스트로크마다 서버를 호출하지 않는다 (목록 1회 fetch 후 로컬 필터).
// - 자연어/별칭 검색이 필요하면 모달의 "AI로 더 찾기"(geminiService.searchSymbolsAI)로 보강.
//
// 불변식: **빈 목록은 유효한 캐시가 아니다.** 서버가 빈/이상 응답을 준 순간을 캐시하면
//         TTL(24h) 동안 모든 모달에서 검색이 "결과 없음"으로만 보인다(원인 표시 없음).
//         → 빈 응답은 캐시 금지 + throw, 기존 오염 캐시는 읽는 즉시 폐기(자가 복구).

import { SymbolSearchResult } from '../types';
import { CLOUD_RUN_BASE_URL } from '../constants/api';
import { createLogger } from '../utils/logger';
import { findSpecialAsset } from './specialAssets';
import { fetchAssetData } from './priceService';
import { fetchUpbitPrice } from './upbitService';

const log = createLogger('symbolList');
const SYMBOLS_URL = `${CLOUD_RUN_BASE_URL}/symbols`;
const LS_KEY = 'asset-manager-symbol-index-v1';
const TTL = 24 * 60 * 60 * 1000; // 24시간

interface SymbolIndexPayload {
  updatedAt?: number;
  count?: number;
  symbols?: unknown;
}

let memoryList: SymbolSearchResult[] | null = null;
let inflight: Promise<SymbolSearchResult[]> | null = null;

/**
 * 쓸 수 있는 목록인지 판정 — **빈 배열은 유효하지 않다**.
 * 빈/깨진 목록을 캐시하거나 사용하면 모달이 "검색 결과가 없습니다"만 보여주어
 * 목록 로드 실패와 진짜 무매칭을 구분할 수 없다(조용한 검색 불능이 TTL 24h 동안 지속).
 */
function isUsableSymbolList(value: unknown): value is SymbolSearchResult[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = value[0] as Partial<SymbolSearchResult> | null;
  return !!first && typeof first.ticker === 'string' && typeof first.name === 'string';
}

/** 목록 캐시(메모리+localStorage)를 비운다. 오염 캐시 자동 폐기 / "목록 새로 받기" 수동 복구용. */
export function clearSymbolIndexCache(): void {
  memoryList = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* localStorage 접근 불가 환경 — 메모리 캐시만 비움 */
  }
}

function readLocal(): SymbolSearchResult[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; symbols?: unknown };
    if (typeof parsed?.savedAt !== 'number' || Date.now() - parsed.savedAt > TTL) return null;
    if (!isUsableSymbolList(parsed.symbols)) {
      // 빈/깨진 캐시는 즉시 폐기 — 남겨두면 24시간 동안 검색이 조용히 0건이 된다.
      clearSymbolIndexCache();
      return null;
    }
    return parsed.symbols;
  } catch {
    return null;
  }
}

function writeLocal(symbols: SymbolSearchResult[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), symbols }));
  } catch {
    /* 용량 초과 등은 무시 — 메모리 캐시로 동작 */
  }
}

/**
 * 전체 종목 목록을 반환 (메모리 → localStorage → 백엔드 fetch 순).
 * 동시 호출은 inflight 프라미스를 공유해 중복 fetch를 막는다.
 * 백엔드 조회 실패 시 throw (호출부가 사유를 표시).
 */
export async function loadSymbolList(): Promise<SymbolSearchResult[]> {
  if (memoryList && memoryList.length > 0) return memoryList;

  const cached = readLocal();
  if (cached) {
    memoryList = cached;
    return cached;
  }

  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(SYMBOLS_URL);
    if (!res.ok) throw new Error(`종목 목록 조회 실패 (${res.status})`);
    const data = (await res.json()) as SymbolIndexPayload;
    if (!isUsableSymbolList(data.symbols)) {
      // 빈/이상 응답은 절대 캐시하지 않는다 — 캐시하면 TTL(24h) 내내 검색이 조용히 0건이 된다.
      throw new Error('종목 목록이 비어 있습니다. 잠시 후 다시 시도해 주세요.');
    }
    const list = data.symbols;
    memoryList = list;
    writeLocal(list);
    log.debug(`Loaded ${list.length} symbols`);
    return list;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

// 검색 점수: 정확 티커 > 티커 접두 > 이름 접두 > 이름 부분일치 > 티커 부분일치
function score(q: string, r: SymbolSearchResult): number {
  const ticker = r.ticker.toLowerCase();
  const name = r.name.toLowerCase();
  if (ticker === q) return 100;
  if (ticker.startsWith(q)) return 80;
  if (name.startsWith(q)) return 70;
  if (name.includes(q)) return 50;
  if (ticker.includes(q)) return 40;
  return -1;
}

/** 로컬 목록에서 쿼리와 매칭되는 상위 N개를 점수순으로 반환. */
export function searchLocalSymbols(
  query: string,
  list: SymbolSearchResult[],
  limit = 12,
): SymbolSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const scored: { r: SymbolSearchResult; s: number }[] = [];
  for (const r of list) {
    const s = score(q, r);
    if (s >= 0) scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s || a.r.name.length - b.r.name.length);
  return scored.slice(0, limit).map(x => x.r);
}

/**
 * 기본 종목 검색 (키 불필요). 특수종목(KRX 금) → 백엔드 목록 로컬 필터.
 * 백엔드 목록 로드 실패 시 throw (모달이 사유 표시, 사용자는 직접 티커 입력으로 추가 가능).
 */
export async function searchSymbols(query: string): Promise<SymbolSearchResult[]> {
  const special = findSpecialAsset(query);
  if (special) return [special];

  const list = await loadSymbolList();
  return searchLocalSymbols(query, list);
}

export interface TickerValidation {
  valid: boolean;
  name?: string;
}

/**
 * "직접 티커 추가" 검증. 입력값을 자산으로 확정하기 전에 실제 시세를 조회해
 * 유효한 티커인지 확인한다(이름 등 잘못된 입력 방지). 키 불필요.
 * - 암호화폐: Upbit 시세(trade_price > 0)
 * - 그 외: 주식/ETF 시세(isMocked=false && 가격 > 0)
 */
export async function validateTicker(
  ticker: string,
  exchange: string,
  isCrypto: boolean,
): Promise<TickerValidation> {
  const t = ticker.trim().toUpperCase();
  if (!t) return { valid: false };

  try {
    if (isCrypto) {
      const r = await fetchUpbitPrice(t);
      return r && r.trade_price > 0 ? { valid: true } : { valid: false };
    }
    const r = await fetchAssetData({ ticker: t, exchange });
    const ok = !r.isMocked && (r.priceKRW > 0 || r.priceOriginal > 0);
    return ok ? { valid: true, name: r.name } : { valid: false };
  } catch {
    return { valid: false };
  }
}
