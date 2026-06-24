// 키리스(Keyless) 종목 검색
// =====================================
// 백엔드(Cloud Run `/symbols`)에서 전체 종목 목록을 1회만 내려받아
// 브라우저 메모리/localStorage에 캐시하고, 검색 매칭은 클라이언트에서 즉시 수행한다.
// - 사용자 Gemini API 키가 전혀 필요 없다 (기본 검색 경로).
// - 키스트로크마다 서버를 호출하지 않는다 (목록 1회 fetch 후 로컬 필터).
// - 자연어/별칭 검색이 필요하면 모달의 "AI로 더 찾기"(geminiService.searchSymbolsAI)로 보강.

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
  symbols?: SymbolSearchResult[];
}

let memoryList: SymbolSearchResult[] | null = null;
let inflight: Promise<SymbolSearchResult[]> | null = null;

function readLocal(): SymbolSearchResult[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; symbols: SymbolSearchResult[] };
    if (!Array.isArray(parsed.symbols) || Date.now() - parsed.savedAt > TTL) return null;
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
  if (memoryList) return memoryList;

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
    const list = Array.isArray(data.symbols) ? data.symbols : [];
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
