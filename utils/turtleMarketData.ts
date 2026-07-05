// utils/turtleMarketData.ts
// ---------------------------------------------------------------------------
// 터틀 시장 입력 조립 (Phase 2b, 순수 함수) — 훅(useActionQueue)이 fetch한 OHLCV를
// 생성기(buildTurtleActions)가 먹는 TurtleMarketInput으로 변환한다.
//
// 통화 규약(D6): N·돈치안·가격은 종목 통화 원본. fxRate는 KRW/종목통화(사이징·리스크 환산용).
// 데이터 소스 분리: fetch(impure)는 훅, 계산(pure)은 여기 — 테스트 가능.

import { Currency, ExchangeRates } from '../types';
import { TurtleSettings, TurtlePosition } from '../types/turtle';
import { TurtleMarketInput } from './actionQueueGenerator';
import { computeN } from './turtleEngine';
import { buildDonchianChannels } from './donchianChannel';

const ATR_PERIOD = 20; // N = 20일 ATR (터틀 원본)

/**
 * 종목 통화 → KRW 환율 (KRW per 1 종목통화).
 * USD/JPY만 rates에서, 그 외(KRW·코인[KRW기준]·레이트 없는 CNY 등)는 1. 0/음수는 1로 방어.
 */
export function turtleFxRate(currency: Currency | undefined, rates: ExchangeRates): number {
  if (currency === Currency.USD) return rates.USD > 0 ? rates.USD : 1;
  if (currency === Currency.JPY) return rates.JPY > 0 ? rates.JPY : 1;
  return 1;
}

/**
 * OHLCV 조회 최소 기간 [startDate, endDate] — 55일 돈치안 + ATR20 워밍업만 커버(10년 fetch 금지).
 * 필요 거래일 = max(entryLookback+1, exitLookback+1, ATR20×3) → 주말·공휴일 보정 ×1.5 + 여유.
 */
export function turtleHistoryWindow(settings: TurtleSettings, todayISO: string): { startDate: string; endDate: string } {
  const tradingDaysNeeded = Math.max(settings.entryLookback + 1, settings.exitLookback + 1, ATR_PERIOD * 3);
  const calendarDays = Math.ceil(tradingDaysNeeded * 1.5) + 15;
  return { startDate: shiftDateISO(todayISO, -calendarDays), endDate: todayISO };
}

/** 오픈 포지션에 이미 배정된 예산 (KRW, 원가 기준) = Σ 유닛 수량×체결가×체결시환율. */
export function computeDeployedBudgetKRW(positions: TurtlePosition[]): number {
  return positions
    .filter(p => p.status === 'open')
    .reduce((sum, p) => sum + p.units.reduce(
      (s, u) => s + u.quantity * u.fillPrice * (u.fxRateAtFill && u.fxRateAtFill > 0 ? u.fxRateAtFill : 1), 0), 0);
}

export interface OhlcvSeries {
  sortedDates: string[];
  closes: (number | null)[];
  highs: (number | null)[];
  lows: (number | null)[];
}

/** historicalPriceService 결과(날짜→값 맵)에서 날짜 오름차순 OHLC 시계열 추출. 고가/저가 미수신은 null. */
export function extractOhlcvSeries(
  result: { data?: Record<string, number>; high?: Record<string, number>; low?: Record<string, number> } | undefined
): OhlcvSeries {
  const data = result?.data ?? {};
  const sortedDates = Object.keys(data).sort();
  return {
    sortedDates,
    closes: sortedDates.map(d => (typeof data[d] === 'number' ? data[d] : null)),
    highs: sortedDates.map(d => (typeof result?.high?.[d] === 'number' ? result!.high![d] : null)),
    lows: sortedDates.map(d => (typeof result?.low?.[d] === 'number' ? result!.low![d] : null)),
  };
}

/**
 * OHLCV 시계열 + 종목 메타 → TurtleMarketInput.
 * N=ATR20(원통화), 돈치안 진입=entryLookback 고가/청산=exitLookback 저가(당일 제외).
 * fail-closed: 데이터 부족 시 n·donchian은 null → 생성기가 진입/피라미딩을 만들지 않음.
 */
export function assembleMarketInput(params: {
  ticker: string;
  name: string;
  price: number;                 // 현재가 (priceOriginal, 원통화)
  currency: Currency | undefined;
  isCrypto: boolean;
  series: OhlcvSeries;
  settings: TurtleSettings;
  rates: ExchangeRates;
}): TurtleMarketInput {
  const { series, settings } = params;
  const n = computeN(series.highs, series.lows, series.closes, ATR_PERIOD);
  const ch = buildDonchianChannels(series.highs, series.lows, series.closes, settings.entryLookback, settings.exitLookback);
  return {
    ticker: params.ticker,
    name: params.name,
    price: params.price,
    n,
    donchianHigh: ch.entryHigh,
    donchianLow: ch.exitLow,
    fxRate: turtleFxRate(params.currency, params.rates),
    allowFractional: params.isCrypto,
    dollarPerPoint: 1,
  };
}

function shiftDateISO(iso: string, deltaDays: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t + deltaDays * 86_400_000).toISOString().slice(0, 10);
}
