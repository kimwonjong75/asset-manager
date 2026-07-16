// utils/todayTurtle.ts
// ---------------------------------------------------------------------------
// "오늘의 터틀 확인" 순수 계산 — OHLC 유효성 · 완료봉 필터 · 55/20 채널 · 상태 우선순위.
// side effect·저장·주문 없음. `buildTurtleActions`/`diagnoseTurtleActions`/`evaluatePyramid`/
// `computeDeployedBudgetKRW` 를 **import 하지 않는다**(생성 경로의 결함 상속 차단).
//
// 기존 `buildDonchianChannels` 를 쓰지 않는 이유: 그 함수는 창 내 유효값이 1개만 있어도 값을 반환하고
// high/low 전부 null 이면 close 로 폴백한다(utils/donchianChannel.ts). 이 화면은 **정확한 봉수 충족 +
// high/low 실존**을 강제하고 부족하면 '확인 불가'로 처리해야 하므로 전용 계산을 둔다.
//
// 봉수 규약:
//   · 55일 돌파: D 1개 + 직전 55개 = **총 56개** 필요. D 의 high 는 비교선에 포함하지 않는다.
//   · 20일 청산: D 1개 + 직전 20개 = **총 21개** 필요.

import { MarketTz, BarQuality, TodayDataIssue, WatchRow, PositionRow, LegacySatelliteRow, TodayRow } from '../types/todayTurtle';

export const ENTRY_LOOKBACK = 55;
export const EXIT_LOOKBACK = 20;
/** 55일 돌파 판정 최소 총 봉수 (D + 직전 55) */
export const ENTRY_MIN_BARS = ENTRY_LOOKBACK + 1;
/** 20일 청산 판정 최소 총 봉수 (D + 직전 20) */
export const EXIT_MIN_BARS = EXIT_LOOKBACK + 1;

/** 일봉 1개 (원통화). */
export interface DailyBar {
  date: string;   // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 조회 결과 원본 (services/historicalPriceService 의 HistoricalPriceResult 형태). */
export interface RawSeries {
  data?: Record<string, number>;
  open?: Record<string, number>;
  high?: Record<string, number>;
  low?: Record<string, number>;
}

function isPos(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 유효 일봉 판정.
 * open/high/low/close 가 모두 유한한 **양수**이고 `low ≤ open ≤ high`, `low ≤ close ≤ high`.
 * 빈 행·일부 null·0 이하·관계 위반은 전부 제외한다(기간 슬롯도 차지하지 않는다).
 */
export function isValidBar(o: unknown, h: unknown, l: unknown, c: unknown): boolean {
  if (!isPos(o) || !isPos(h) || !isPos(l) || !isPos(c)) return false;
  return l <= o && o <= h && l <= c && c <= h;
}

/** 거래소 → 완료봉 판정 시장 기준. 스펙 §4 폴백: KR/US/CRYPTO 외는 UNKNOWN(보수적 제외). */
export function resolveMarketTz(exchange: string, isCrypto: boolean): MarketTz {
  if (isCrypto) return 'CRYPTO';
  const e = (exchange || '').toUpperCase();
  if (e.includes('KRX') || e.includes('KONEX') || e.includes('금시장')) return 'KR';
  if (e.includes('NASDAQ') || e.includes('NYSE') || e.includes('AMEX')) return 'US';
  return 'UNKNOWN';
}

const TZ_OF: Record<Exclude<MarketTz, 'UNKNOWN'>, string> = {
  KR: 'Asia/Seoul',
  US: 'America/New_York',
  // 암호화폐: 백엔드 일봉의 기준 시간대를 이 리포에서 확인할 수 없다(백엔드 리포 밖).
  // UTC 를 쓰면 KST 기준 공급자보다 항상 같거나 더 보수적으로 제외되므로 UTC 로 고정하고
  // conservativeDrop 플래그로 "확인되지 않음"을 표시한다.
  CRYPTO: 'UTC',
};

/** 특정 시간대의 오늘 날짜 (YYYY-MM-DD). 한국 로컬시간 하드코딩 금지. */
export function todayInTz(tz: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export interface CompletedBarsResult {
  bars: DailyBar[];
  droppedRows: number;
  conservativeDrop: boolean;
  hasHighLow: boolean;
}

/** 저장된 stopPrice 가 쓸 수 있는 값인가 — number·유한·양수. 무효를 0으로 대체하지 않기 위한 게이트. */
export function isValidStopPrice(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * **완료 종가만** 추출 (C-4) — 저장된 stopPrice 비교 **전용**.
 * open/high/low 가 없어도 종가만 있으면 `완료종가 ≤ stopPrice` 판정은 가능하다(약속값 비교라 채널 계산이 아님).
 * ⚠ 55일 돌파·20일 청산선에는 **절대 쓰지 않는다** — 그쪽은 완전한 유효 OHLC를 요구하고 종가 폴백을 금지한다.
 */
export function extractCompletedCloses(
  raw: RawSeries | undefined, marketTz: MarketTz, now: Date
): { dates: string[]; closes: number[] } {
  const closes = raw?.data ?? {};
  const all = Object.keys(closes).sort().filter(d => isPos(closes[d]));
  const usable = marketTz === 'UNKNOWN'
    ? all.slice(0, Math.max(0, all.length - 1))     // 완료 여부 미상 → 최신 1개 보수적 제외
    : all.filter(d => d < todayInTz(TZ_OF[marketTz], now));
  return { dates: usable, closes: usable.map(d => closes[d]) };
}

/**
 * 원본 시계열 → **유효 완료봉** 배열(날짜 오름차순).
 *   1) high/low 미수신이면 hasHighLow=false (종가 폴백 금지 — 호출부가 '확인 불가' 처리)
 *   2) 유효 일봉만 남긴다 (비정상 행은 기간 슬롯도 차지하지 않음)
 *   3) 진행 중 당일 봉 제외 — 시장 현지 날짜 기준. UNKNOWN 은 최신 행을 보수적으로 1개 제외.
 */
export function extractCompletedBars(raw: RawSeries | undefined, marketTz: MarketTz, now: Date): CompletedBarsResult {
  const closes = raw?.data ?? {};
  const dates = Object.keys(closes).sort();
  const hasHighLow = raw?.high != null && raw?.low != null && raw?.open != null;
  if (!hasHighLow) return { bars: [], droppedRows: 0, conservativeDrop: false, hasHighLow: false };

  const all: DailyBar[] = [];
  let dropped = 0;
  for (const d of dates) {
    const o = raw!.open![d], h = raw!.high![d], l = raw!.low![d], c = closes[d];
    if (!isValidBar(o, h, l, c)) { dropped++; continue; }
    all.push({ date: d, open: o, high: h, low: l, close: c });
  }

  if (marketTz === 'UNKNOWN') {
    // 완료 여부를 알 수 없다 → 최신 행을 보수적으로 제외하고 그 사실을 표시
    return { bars: all.slice(0, Math.max(0, all.length - 1)), droppedRows: dropped, conservativeDrop: true, hasHighLow: true };
  }
  const today = todayInTz(TZ_OF[marketTz], now);
  const bars = all.filter(b => b.date < today);
  return {
    bars,
    droppedRows: dropped,
    // 암호화폐는 공급자 일봉 기준 시간대 미확인 → UTC 로 보수적 판정했음을 표시
    conservativeDrop: marketTz === 'CRYPTO',
    hasHighLow: true,
  };
}

function baseQuality(r: CompletedBarsResult, marketTz: MarketTz): BarQuality {
  const issues: TodayDataIssue[] = [];
  if (!r.hasHighLow) issues.push('no-high-low');
  if (r.hasHighLow && r.bars.length === 0) issues.push('no-completed-bar');
  return {
    validCompletedBars: r.bars.length,
    asOfDate: r.bars.length > 0 ? r.bars[r.bars.length - 1].date : null,
    droppedRows: r.droppedRows,
    marketTz,
    conservativeDrop: r.conservativeDrop,
    issues,
  };
}

/** D 제외 직전 `lookback` 개 완료봉의 high 최댓값. 봉수 부족이면 null. */
export function entryBreakoutLine(bars: DailyBar[], lookback: number = ENTRY_LOOKBACK): number | null {
  if (bars.length < lookback + 1) return null;
  const end = bars.length - 1;                 // D 인덱스 — 비교선에서 제외
  const window = bars.slice(end - lookback, end);
  return window.reduce((m, b) => (b.high > m ? b.high : m), -Infinity);
}

/** D 제외 직전 `lookback` 개 완료봉의 low 최솟값. 봉수 부족이면 null. */
export function exitChannelLine(bars: DailyBar[], lookback: number = EXIT_LOOKBACK): number | null {
  if (bars.length < lookback + 1) return null;
  const end = bars.length - 1;
  const window = bars.slice(end - lookback, end);
  return window.reduce((m, b) => (b.low < m ? b.low : m), Infinity);
}

// ── 행 빌더 ────────────────────────────────────────────────────────────────

export interface WatchInput {
  ticker: string;
  name: string;
  raw: RawSeries | undefined;
  exchange: string;
  isCrypto: boolean;
  /** 장중 현재가 (참고 표시 전용 — 확정 판정 금지) */
  intradayPrice: number | null;
  now: Date;
  /** 조회 자체가 실패했는가 (no-high-low 와 구분) */
  fetchFailed?: boolean;
}

/**
 * 관심종목 55일 돌파 상태 (상호배타 1개).
 * 발생 조건: `D.close >= 비교선` (같으면 발생). 장중가는 확정에 쓰지 않는다.
 * 채널 계산은 완전한 유효 OHLC 를 요구하고 **종가 폴백을 금지**한다(C-4 예외는 stopPrice 비교에만 적용).
 */
export function buildWatchRow(input: WatchInput): WatchRow {
  const marketTz = resolveMarketTz(input.exchange, input.isCrypto);
  const r = extractCompletedBars(input.raw, marketTz, input.now);
  const quality = baseQuality(r, marketTz);
  if (input.fetchFailed) {
    quality.issues = quality.issues.filter(i => i !== 'no-high-low' && i !== 'no-completed-bar');
    quality.issues.push('fetch-failed');
  }

  const enough = r.bars.length >= ENTRY_MIN_BARS;
  if (!quality.issues.length && !enough) quality.issues.push('insufficient-bars');

  const base = {
    kind: 'watch' as const, ticker: input.ticker, name: input.name, quality,
    intradayPrice: input.intradayPrice,
  };
  if (!r.hasHighLow || !enough || r.bars.length === 0) {
    return { ...base, status: 'unavailable', completedClose: null, breakoutLine: null, gapToLinePct: null, intradayAboveLine: false };
  }

  const d = r.bars[r.bars.length - 1];
  const line = entryBreakoutLine(r.bars)!;
  const confirmed = d.close >= line;
  const intradayAbove = !confirmed && input.intradayPrice != null && input.intradayPrice >= line;

  return {
    ...base,
    status: confirmed ? 'breakout-confirmed' : 'waiting',
    completedClose: d.close,
    breakoutLine: line,
    gapToLinePct: confirmed ? null : ((line - d.close) / d.close) * 100,
    intradayAboveLine: intradayAbove,
  };
}

export interface PositionInput {
  ticker: string;
  name: string;
  raw: RawSeries | undefined;
  exchange: string;
  isCrypto: boolean;
  /** 저장된 공통 손절가 (포지션 기록의 약속값). 무효면 0 대체 금지 → 'stop-record-error' */
  stopPrice: number | null | undefined;
  now: Date;
  /** 조회 자체가 실패했는가 (no-high-low 와 구분) */
  fetchFailed?: boolean;
  /** 포지션↔자산 연결 실패 (assetId 없음/깨짐 + ticker 후보 0개 또는 2개 이상) */
  linkError?: boolean;
}

/**
 * 정식 터틀 포지션 상태 (상호배타 1개).
 * 우선순위: 연결 오류 → 손절선 기록 오류 → 손절 → 20일 청산 → (20일 확인 불가) → 기다림.
 *
 * **C-4**: 저장된 stopPrice 비교에는 **완료 종가만** 필요하다(약속값 비교이지 채널 계산이 아님).
 * 따라서 open/high/low 가 없어도 손절 판정은 살리고, 20일 청산선만 '확인 불가'로 낮춘다.
 */
export function buildPositionRow(input: PositionInput): PositionRow {
  const marketTz = resolveMarketTz(input.exchange, input.isCrypto);
  const r = extractCompletedBars(input.raw, marketTz, input.now);
  const quality = baseQuality(r, marketTz);
  if (input.fetchFailed) {
    quality.issues = quality.issues.filter(i => i !== 'no-high-low' && i !== 'no-completed-bar');
    quality.issues.push('fetch-failed');
  }

  const base = { kind: 'position' as const, ticker: input.ticker, name: input.name, quality };

  // 0순위: 포지션 연결 확인 필요 — 임의 선택 금지
  if (input.linkError) {
    quality.issues.push('position-link');
    return { ...base, status: 'link-error', completedClose: null, stopPrice: null, exitLine: null };
  }

  // 종가 전용 시계열 — high/low 가 없어도 손절 비교는 가능
  const closeOnly = input.fetchFailed
    ? { dates: [], closes: [] }
    : extractCompletedCloses(input.raw, marketTz, input.now);
  const lastClose = closeOnly.closes.length > 0 ? closeOnly.closes[closeOnly.closes.length - 1] : null;
  const lastCloseDate = closeOnly.dates.length > 0 ? closeOnly.dates[closeOnly.dates.length - 1] : null;
  // 판정 기준일 = **실제 판정에 쓴 완료종가의 날짜**. baseQuality 는 채널 봉(마지막 유효 OHLC) 날짜를
  // 넣지만, 정식 포지션의 1차 판정은 종가 기준이므로 종가 날짜로 덮어 화면 표기와 판정을 일치시킨다.
  if (lastCloseDate != null) quality.asOfDate = lastCloseDate;

  // 1순위: 손절선 기록 오류 — 0으로 대체하지 않고 명시
  if (!isValidStopPrice(input.stopPrice)) {
    quality.issues.push('stop-record-invalid');
    return { ...base, status: 'stop-record-error', completedClose: lastClose, stopPrice: null, exitLine: null };
  }
  const stopPrice = input.stopPrice;

  // 종가조차 없으면 전체 확인 불가
  if (lastClose == null) {
    return { ...base, status: 'unavailable', completedClose: null, stopPrice, exitLine: null };
  }

  // ── 20일 청산선 (AMENDMENT-2: 기준일 일치 강제) ───────────────────────────
  // 채널의 D 는 **마지막 유효 OHLC 봉**이고 비교 종가는 **최신 완료종가**다. 최신 행에 close 만 있고
  // OHLC 가 불완전하면 두 날짜가 어긋나는데, 그때 과거 채널과 최신 종가를 비교하면 **서로 다른 날짜를
  // 결합**한 판정이 된다. 날짜가 정확히 같을 때만 청산 판정에 쓴다(다르면 '확인 불가').
  const channelDate = r.bars.length > 0 ? r.bars[r.bars.length - 1].date : null;
  const sameAsOf = channelDate != null && channelDate === lastCloseDate;
  const hasChannel = r.hasHighLow && r.bars.length > 0 && sameAsOf;
  const exitLine = hasChannel ? exitChannelLine(r.bars) : null;

  // 2순위: 손절 — **완료종가만으로 판정**(high/low 부족과 무관)
  if (lastClose <= stopPrice) {
    return { ...base, status: 'sell-check-stop', completedClose: lastClose, stopPrice, exitLine };
  }
  // 3순위: 20일 청산
  if (exitLine != null && lastClose <= exitLine) {
    return { ...base, status: 'sell-check-exit', completedClose: lastClose, stopPrice, exitLine };
  }
  // 손절선 위인데 20일선을 못 구함 → 부분 성공(기본 노출)
  if (exitLine == null) {
    if (!quality.issues.includes('insufficient-bars') && !quality.issues.includes('no-high-low') && !quality.issues.includes('fetch-failed')) {
      quality.issues.push('insufficient-bars');
    }
    return { ...base, status: 'waiting-exit-unknown', completedClose: lastClose, stopPrice, exitLine: null };
  }
  return { ...base, status: 'waiting', completedClose: lastClose, stopPrice, exitLine };
}

export interface LegacyInput {
  ticker: string;
  name: string;
  raw: RawSeries | undefined;
  exchange: string;
  isCrypto: boolean;
  now: Date;
  /** 조회 자체가 실패했는가 (no-high-low 와 구분) */
  fetchFailed?: boolean;
}

/**
 * 기존 SATELLITE 보유분 상태 (상호배타 1개) — **20일 참고만**.
 * 2N 손절·불타기는 계산하지 않는다(진입 당시 N 기록 없음 / 불타기 검증 탈락).
 */
export function buildLegacyRow(input: LegacyInput): LegacySatelliteRow {
  const marketTz = resolveMarketTz(input.exchange, input.isCrypto);
  const r = extractCompletedBars(input.raw, marketTz, input.now);
  const quality = baseQuality(r, marketTz);
  if (input.fetchFailed) {
    quality.issues = quality.issues.filter(i => i !== 'no-high-low' && i !== 'no-completed-bar');
    quality.issues.push('fetch-failed');
  }

  const enough = r.bars.length >= EXIT_MIN_BARS;
  if (!quality.issues.length && !enough) quality.issues.push('insufficient-bars');

  const base = { kind: 'legacy' as const, ticker: input.ticker, name: input.name, quality };
  if (!r.hasHighLow || !enough || r.bars.length === 0) {
    return { ...base, status: 'unavailable', completedClose: null, exitLine: null };
  }
  const d = r.bars[r.bars.length - 1];
  const line = exitChannelLine(r.bars)!;
  return {
    ...base,
    status: d.close <= line ? 'exit-line-touched' : 'above-exit-line',
    completedClose: d.close,
    exitLine: line,
  };
}

// ── 정렬 · 요약 ────────────────────────────────────────────────────────────

/**
 * 표시 정렬 순위 (C-5). 낮을수록 위. **오직 rank 5(단순 기다림)만 기본 접힘**이다.
 *   0. 데이터·포지션 연결 확인 필요 (unavailable/link-error/stop-record-error/waiting-exit-unknown/fetch-failed)
 *   1. 정식 터틀 손절·청산 확인
 *   2. 기존 투더문 20일선 참고
 *   3. 55일 돌파 확정
 *   4. 장중 돌파 중 — 종가 확인 전
 *   5. 단순 기다림
 */
export function rowSortRank(row: TodayRow): number {
  if (row.status === 'unavailable') return 0;
  if (row.quality.issues.includes('fetch-failed')) return 0;
  if (row.kind === 'position') {
    // 손절선 기록 오류·연결 오류·20일선 확인 불가는 '기다림'이 아니다 — 기본 화면에 노출한다
    if (row.status === 'link-error' || row.status === 'stop-record-error' || row.status === 'waiting-exit-unknown') return 0;
    if (row.status === 'sell-check-stop' || row.status === 'sell-check-exit') return 1;
    return 5;
  }
  if (row.kind === 'legacy') return row.status === 'exit-line-touched' ? 2 : 5;
  // watch
  if (row.status === 'breakout-confirmed') return 3;
  if (row.intradayAboveLine) return 4;   // 장중 돌파 중 — 접힘 금지
  return 5;
}

/** 결정적 정렬 — 순위 → 티커. 입력 순서를 바꿔도 결과가 같다. */
export function sortRows(rows: TodayRow[]): TodayRow[] {
  return [...rows].sort((a, b) => {
    const d = rowSortRank(a) - rowSortRank(b);
    if (d !== 0) return d;
    return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
  });
}

/** 이 행이 기본 접힘 대상('단순 기다림')인가. rank 5 만 접는다. */
export function isWaitingRow(row: TodayRow): boolean {
  return rowSortRank(row) === 5;
}

/** 요약 숫자 — rowSortRank 와 **동일 기준**(C-5). 데이터 확인 필요에 연결·손절기록 오류도 포함된다. */
export function summarizeRows(rows: TodayRow[]): { sellCheck: number; breakout: number; legacyTouched: number; dataIssues: number; intradayBreakout: number; waiting: number } {
  let sellCheck = 0, breakout = 0, legacyTouched = 0, dataIssues = 0, intradayBreakout = 0, waiting = 0;
  for (const r of rows) {
    switch (rowSortRank(r)) {
      case 0: dataIssues++; break;
      case 1: sellCheck++; break;
      case 2: legacyTouched++; break;
      case 3: breakout++; break;
      case 4: intradayBreakout++; break;
      default: waiting++; break;
    }
  }
  return { sellCheck, breakout, legacyTouched, dataIssues, intradayBreakout, waiting };
}

/**
 * 보유 중복 차단용 정규화 키.
 * 기존 `normalizeExchange`(별칭 매핑: AMEX/NYSE MKT → 'NYSE American')를 먼저 적용하고
 * **거래소도 대문자로 정규화**한다 — normalizeExchange 는 별칭 외에는 원문을 그대로 돌려주므로
 * (`'nasdaq'` → `'nasdaq'`), 대문자화하지 않으면 `nasdaq` 보유분이 `NASDAQ` 관심종목과 다른 키가 되어
 * **보유 중인데 신규진입 후보로 뜨는** 중복이 생긴다. 서로 다른 실제 거래소는 그대로 구분된다.
 */
export function todayInstrumentKey(ticker: string, exchange: string, normalizeExchangeFn: (e: string) => string): string {
  return `${ticker.trim().toUpperCase()}|${normalizeExchangeFn(exchange).trim().toUpperCase()}`;
}

// ── 재조회 수명주기 (C-3) ──────────────────────────────────────────────────

/** requestKey 산출에 쓰는 대상 식별 정보 (장중 가격은 **의도적으로 제외**). */
export interface TodayTargetIdentity {
  key: string;
  kind: 'watch' | 'position' | 'legacy';
  fetchTicker: string;
}

/**
 * 결정적 `requestKey` — 정렬된 (대상 키·조회 티커·종류) + 조회 기준일.
 * 이 값이 바뀔 때만 재조회한다.
 *   · 계정 필터·관심종목 추가/삭제·보유 변경·포지션 연결 변경 → 대상 집합이 바뀌므로 키가 바뀐다.
 *   · **날짜 변경** → asOfDate 가 바뀌므로 키가 바뀐다(앱을 켜둔 채 자정을 넘겨도 재평가).
 *   · **장중 가격 변동은 키에 넣지 않는다** — 가격이 흔들릴 때마다 OHLC 를 재조회하지 않기 위함.
 */
export function buildTodayRequestKey(targets: TodayTargetIdentity[], asOfDate: string): string {
  const parts = targets
    .map(t => `${t.kind}:${t.key}:${t.fetchTicker}`)
    .sort();
  return `${asOfDate}|${parts.join(',')}`;
}

/**
 * 오래된 비동기 응답인가 — true 면 결과를 버린다(새 요청을 덮어쓰지 않게).
 * 훅 내부 `requestIdRef` 비교를 순수 함수로 분리해 테스트 가능하게 한 것(훅 테스트 도구 미사용).
 */
export function isStaleResponse(responseReqId: number, currentReqId: number): boolean {
  return responseReqId !== currentReqId;
}
