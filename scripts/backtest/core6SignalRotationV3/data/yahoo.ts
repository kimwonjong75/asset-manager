// scripts/backtest/core6SignalRotationV3/data/yahoo.ts
// Yahoo chart API 응답 → 행 단위 파싱 (순수 함수, fs 없음).
// V1(core6SignalRotation/dataProcessing.ts)과 달리 null 행도 버리지 않고 `valid=false`로 남긴다.
// 이유: 어떤 날이 "Yahoo가 영업일로 인식했지만 값이 없는 날"인지 게이트(DG1·DG4)가 판단해야 하기 때문이다.
// 사전등록: docs/backtest/PREREG_코어6종_신호로테이션_V3.md §4.2 (TR 조정: factor = adjclose/close를 O/H/L/C 4값에 동일 적용)

export interface YahooRow {
  /** 거래소 현지 달력 날짜 (exchangeTimezoneName 기준). 한국 ETF = Asia/Seoul, TLT = America/New_York, KRW=X = Yahoo가 표기한 날짜. */
  date: string;
  timestampUtc: string;
  rawOpen: number | null;
  rawHigh: number | null;
  rawLow: number | null;
  rawClose: number | null;
  adjClose: number | null;
  volume: number | null;
  /** adjclose / close (둘 다 유한하고 close>0일 때). */
  factor: number | null;
  /** 원시 O/H/L/C 4값과 adjclose가 모두 유한하고 close>0 이면 true. 하나라도 null이면 false(결측 행). */
  valid: boolean;
  /** TR 조정 O/H/L/C = 원시 × factor (valid일 때만). 조정 종가는 adjclose 그대로. */
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /** Amendment 1: 'backend-fill' = Yahoo가 비운 날을 앱 백엔드 값으로 채운 행(원시값 없음, O/H/L/C는 백엔드 배당조정 단위). 생략 = 'yahoo'. */
  source?: 'yahoo' | 'backend-fill' | 'backend';
  /** Amendment 1: 이벤트 원장으로 TR을 다시 만들 때 보존한 Yahoo 원래 adjclose / 계수(비교용). */
  yahooAdjClose?: number | null;
  yahooFactor?: number | null;
}

export interface YahooDividend {
  date: string;
  amount: number;
}

export interface YahooParsed {
  symbol: string;
  currency: string;
  timezone: string;
  /** timestamp 순서 그대로(정렬하지 않는다 — 역순·중복 점검을 위해). */
  rows: YahooRow[];
  dividends: YahooDividend[];
  splitCount: number;
}

interface YahooChartResult {
  meta?: { currency?: string; symbol?: string; exchangeTimezoneName?: string };
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
    adjclose?: Array<{ adjclose?: Array<number | null> }>;
  };
  events?: {
    dividends?: Record<string, { date?: number; amount?: number }>;
    splits?: Record<string, { date?: number }>;
  };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function localDate(epochSeconds: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** @param raw `{ chart: { result: [...] } }` 형태(원자료 파일의 `.response`). */
export function parseYahooAdjusted(raw: unknown): YahooParsed {
  const root = raw as { chart?: { result?: YahooChartResult[]; error?: unknown } };
  const result = root.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo chart result missing: ${JSON.stringify(root.chart?.error ?? null)}`);
  const timezone = result.meta?.exchangeTimezoneName ?? 'UTC';
  const ts = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const rows: YahooRow[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    const a = adjusted[i];
    const rawOpen = finite(o) ? o : null;
    const rawHigh = finite(h) ? h : null;
    const rawLow = finite(l) ? l : null;
    const rawClose = finite(c) ? c : null;
    const adjClose = finite(a) ? a : null;
    const factor = rawClose !== null && rawClose > 0 && adjClose !== null ? adjClose / rawClose : null;
    const valid = rawOpen !== null && rawHigh !== null && rawLow !== null && rawClose !== null && rawClose > 0 && factor !== null;
    rows.push({
      date: localDate(ts[i], timezone),
      timestampUtc: new Date(ts[i] * 1000).toISOString(),
      rawOpen,
      rawHigh,
      rawLow,
      rawClose,
      adjClose,
      volume: finite(quote.volume?.[i]) ? (quote.volume![i] as number) : null,
      factor,
      valid,
      open: valid ? rawOpen! * factor! : null,
      high: valid ? rawHigh! * factor! : null,
      low: valid ? rawLow! * factor! : null,
      close: valid ? adjClose : null,
    });
  }
  const dividends: YahooDividend[] = Object.values(result.events?.dividends ?? {}).flatMap(event =>
    finite(event.date) && finite(event.amount) ? [{ date: localDate(event.date, timezone), amount: event.amount }] : []
  );
  dividends.sort((x, y) => x.date.localeCompare(y.date));
  return {
    symbol: result.meta?.symbol ?? 'unknown',
    currency: result.meta?.currency ?? 'unknown',
    timezone,
    rows,
    dividends,
    splitCount: Object.keys(result.events?.splits ?? {}).length,
  };
}

/** 같은 날짜 행이 둘 이상이면 valid 행(없으면 마지막 행)을 택해 날짜별로 색인한다. */
export function indexRowsByDate(parsed: YahooParsed): Map<string, YahooRow> {
  const map = new Map<string, YahooRow>();
  for (const row of parsed.rows) {
    const prev = map.get(row.date);
    if (!prev || row.valid || !prev.valid) map.set(row.date, row);
  }
  return map;
}

export interface DatedValue {
  date: string;
  value: number;
}

/** TLT: 조정종가(adjclose). 날짜 오름차순, 중복 날짜는 나중 값이 이긴다. */
export function adjCloseSeries(parsed: YahooParsed): DatedValue[] {
  const map = new Map<string, number>();
  for (const row of parsed.rows) {
    if (row.adjClose !== null && row.adjClose > 0) map.set(row.date, row.adjClose);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}

/** KRW=X: 원시 종가(close). 환율은 배당 조정이 없으므로 adjclose를 쓰지 않는다. */
export function rawCloseSeries(parsed: YahooParsed): DatedValue[] {
  const map = new Map<string, number>();
  for (const row of parsed.rows) {
    if (row.rawClose !== null && row.rawClose > 0) map.set(row.date, row.rawClose);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, value]) => ({ date, value }));
}
