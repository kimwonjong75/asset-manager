// services/marketOverviewService.ts
// ---------------------------------------------------------------------------
// 시장 요약(금 김치 프리미엄 + 환율)의 **현재값** 조회.
// 기존 goldPremiumService.fetchGoldPremium 을 대체.
//
// · 금 2종(KRX-GOLD KRW/g, GC=F USD/oz)은 Cloud Run `/` 엔드포인트로 조회.
//   요청에 `quotes_only:true`를 포함 — 백엔드가 지원하면 MA/RSI 계산을 생략해
//   응답이 빨라지고, 미지원(구버전)이면 무시되어 기존과 동일 동작(하위호환).
// · 환율 2종(USD/KRW, JPY/KRW)은 `/exchange-rate` 엔드포인트로 조회 —
//   현재값 + 기준일(date)을 함께 받는다.
// · 부분 실패 허용: 일부만 성공해도 받은 값으로 스냅샷을 구성(RULES: fallback).
//   프리미엄은 저장하지 않는다 — 렌더 시 유효 환율로 파생(utils/marketOverviewCalculations).
// ---------------------------------------------------------------------------

import { CLOUD_RUN_BASE_URL } from '../constants/api';
import { createLogger } from '../utils/logger';
import { MarketOverviewSnapshot } from '../types/marketOverview';

const log = createLogger('MarketOverview');
const BASE = CLOUD_RUN_BASE_URL;

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

interface GoldQuote {
  price: number;
  prev: number;
  date: string | null;
}

/** `/` 응답을 티커(대문자) 키 맵으로 평탄화 (array / {results} / object-keyed 대응). */
function flattenByTicker(data: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const push = (item: Record<string, unknown>, keyHint?: string) => {
    const t = String(item.ticker ?? item.symbol ?? keyHint ?? '').toUpperCase();
    if (t) map.set(t, item);
  };
  if (Array.isArray(data)) {
    data.forEach((it) => it && typeof it === 'object' && push(it as Record<string, unknown>));
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      obj.results.forEach((it) => it && typeof it === 'object' && push(it as Record<string, unknown>));
    } else {
      Object.entries(obj).forEach(([key, val]) => {
        if (val && typeof val === 'object') push(val as Record<string, unknown>, key);
      });
    }
  }
  return map;
}

function readGoldQuote(map: Map<string, Record<string, unknown>>, ticker: string): GoldQuote {
  const item = map.get(ticker.toUpperCase());
  if (!item) return { price: 0, prev: 0, date: null };
  const price = toNumber(item.priceOriginal ?? item.price ?? item.close, 0);
  const prev = toNumber(item.prev_close ?? item.previousClose ?? item.yesterdayPrice, 0);
  const date = typeof item.date === 'string' ? item.date : null;
  return { price, prev, date };
}

/** 금 2종 현재 시세 조회 (KRX-GOLD, GC=F). 실패 시 0값 반환(throw 안 함 — 부분 성공 허용). */
async function fetchGoldQuotes(): Promise<{ krx: GoldQuote; comex: GoldQuote }> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tickers: [
          { ticker: 'KRX-GOLD', exchange: 'KRX 금시장' },
          { ticker: 'GC=F', exchange: 'COMEX' },
        ],
        quotes_only: true, // 백엔드 지원 시 지표 생략(가속), 미지원 시 무시(하위호환)
      }),
    });
    if (!res.ok) throw new Error(`gold API ${res.status}`);
    const raw = await res.text();
    const data = JSON.parse(raw.replace(/\bNaN\b/g, 'null'));
    const map = flattenByTicker(data);
    return {
      krx: readGoldQuote(map, 'KRX-GOLD'),
      comex: readGoldQuote(map, 'GC=F'),
    };
  } catch (e) {
    log.error('gold quotes failed:', e);
    return { krx: { price: 0, prev: 0, date: null }, comex: { price: 0, prev: 0, date: null } };
  }
}

/** 환율 1종 현재값 + 기준일 조회. 실패 시 {rate:0,date:null}. */
async function fetchFxQuote(from: 'USD' | 'JPY'): Promise<{ rate: number; date: string | null }> {
  try {
    const res = await fetch(`${BASE}/exchange-rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: 'KRW' }),
    });
    if (!res.ok) throw new Error(`fx API ${res.status}`);
    const data = await res.json();
    return { rate: toNumber(data.rate, 0), date: typeof data.date === 'string' ? data.date : null };
  } catch (e) {
    log.error(`fx ${from} failed:`, e);
    return { rate: 0, date: null };
  }
}

/**
 * 현재 시장 요약 스냅샷 조회.
 * 금·USD·JPY를 병렬 조회. 각 조회는 자체적으로 실패를 흡수하므로
 * 부분 성공 시에도 받은 값으로 스냅샷을 구성한다.
 * 세 조회가 모두 0을 반환하면(전부 실패) null을 반환 — 호출측이 폴백/에러 처리.
 */
export async function fetchMarketOverviewSnapshot(): Promise<MarketOverviewSnapshot | null> {
  const [gold, usd, jpy] = await Promise.all([
    fetchGoldQuotes(),
    fetchFxQuote('USD'),
    fetchFxQuote('JPY'),
  ]);

  const anySuccess =
    gold.krx.price > 0 || gold.comex.price > 0 || usd.rate > 0 || jpy.rate > 0;
  if (!anySuccess) return null;

  return {
    domesticGoldKRWPerG: gold.krx.price,
    domesticGoldPrevKRWPerG: gold.krx.prev,
    intlGoldUSDPerOz: gold.comex.price,
    intlGoldPrevUSDPerOz: gold.comex.prev,
    usdKrw: usd.rate,
    jpyKrw: jpy.rate,
    goldSourceDate: gold.krx.date ?? gold.comex.date,
    fxSourceDate: usd.date ?? jpy.date,
    fetchedAt: new Date().toISOString(),
  };
}
