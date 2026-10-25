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
import { closeConfirmTime } from './marketHours';

/**
 * 세션 봉 확정 정착 대기(분) — 마감 확정 시각(`closeConfirmTime`) 뒤 가격 공급자가 최종 일봉을 게시할 때까지 기다리는 시간.
 * **앱(`isSessionBarConfirmed`)과 카카오톡 GAS(`scripts/notify/gas/entry.ts` closeCheck 터틀 파트)가 이 한 상수를 함께 쓴다**
 * — 두 경로가 서로 다른 시각에 "오늘 봉이 확정"이라고 판단하지 않도록(드리프트 방지).
 */
export const SESSION_BAR_SETTLE_MIN = 20;

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

/**
 * 거래소 → 완료봉 판정 시장 기준. 스펙 §4 폴백: KR/US/JP/CRYPTO 외는 UNKNOWN(보수적 제외).
 * JP = 도쿄 증권거래소(실데이터 표기: `도쿄 증권거래소 (TYO)`·`도쿄증권거래소`·`TYO (도쿄 증권거래소)`·`TSE (도쿄)`).
 */
export function resolveMarketTz(exchange: string, isCrypto: boolean): MarketTz {
  if (isCrypto) return 'CRYPTO';
  const e = (exchange || '').toUpperCase();
  if (e.includes('KRX') || e.includes('KONEX') || e.includes('금시장')) return 'KR';
  if (e.includes('NASDAQ') || e.includes('NYSE') || e.includes('AMEX')) return 'US';
  if (e.includes('도쿄') || e.includes('TYO') || e.includes('TSE') || e.includes('TOKYO')) return 'JP';
  return 'UNKNOWN';
}

/** 시장 현지 날짜를 정의할 수 있는 시장(UNKNOWN 제외). */
export type KnownMarketTz = Exclude<MarketTz, 'UNKNOWN'>;

const TZ_OF: Record<KnownMarketTz, string> = {
  KR: 'Asia/Seoul',
  US: 'America/New_York',
  JP: 'Asia/Tokyo',
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

/** 시장 기준 시간대(`TZ_OF`)에서의 오늘 날짜 — 완료봉 경계(`extractCompleted*`)와 캐시 서명(`marketDaySignature`)이 공유한다. */
export function marketLocalDate(marketTz: KnownMarketTz, now: Date): string {
  return todayInTz(TZ_OF[marketTz], now);
}

/** 'YYYY-MM-DD' 에 일수를 더한 날짜(UTC 달력 산술, DST 무관). 해석 불가 입력은 그대로 돌려준다. */
export function addIsoDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * **시장 현지 날짜 `localDate` 의 일봉이 "확정"됐는가** — 마감 확정 시각(`closeConfirmTime`) + `SESSION_BAR_SETTLE_MIN` 경과.
 * 확정 전의 당일 봉은 장중 부분 봉일 수 있어 판정에 쓰면 안 된다(`extractCompletedBars` 가 제외).
 *   · KR  : `closeConfirmTime('KR', d)`(15:40 KST) + 20분 = 16:00 KST.
 *   · US  : `closeConfirmTime('US', d)`(16:40 ET, DST 반영) + 20분 = 17:00 ET.
 *   · JP  : TSE 는 15:30 JST 마감(2024-11 연장 이후)이고 JST = KST = UTC+9 (DST 없음)라 KR 과 같은 UTC 오프셋·같은 마감 시각이다
 *           → `closeConfirmTime('KR', d)` 를 그대로 재사용한다(15:40 + 20분 = 16:00 JST).
 *   · CRYPTO : 항상 false — 오늘(UTC) 일봉은 자기 UTC 날짜 안에서는 끝나지 않는다(기존 `date < 오늘(UTC)` 규칙이 이미 정확).
 *   · UNKNOWN: 항상 false — 완료 여부를 알 수 없다.
 * GAS(`scripts/notify/gas/entry.ts`)는 같은 `closeConfirmTime + SESSION_BAR_SETTLE_MIN` 규칙을 세션 날짜 기준으로 쓴다.
 * `now` 가 해석 불가(NaN)이면 false(보수적).
 */
export function isSessionBarConfirmed(marketTz: MarketTz, localDate: string, now: Date): boolean {
  let closeMarket: 'KR' | 'US';
  if (marketTz === 'KR' || marketTz === 'JP') closeMarket = 'KR';
  else if (marketTz === 'US') closeMarket = 'US';
  else return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return false;   // closeConfirmTime 은 깨진 날짜에서 던진다 — 형식 밖은 미확정으로 처리
  const confirmMs = Date.parse(closeConfirmTime(closeMarket, localDate));
  return now.getTime() >= confirmMs + SESSION_BAR_SETTLE_MIN * 60_000;   // now 가 NaN 이면 비교가 false → 미확정
}

/**
 * 완료봉 날짜 판정기 (UNKNOWN 제외).
 *   · KR/US/JP : `date < 시장 현지 오늘` **또는** (`date === 오늘` 이면서 그 세션 봉이 확정됨 — `isSessionBarConfirmed`)
 *   · CRYPTO   : `date < 오늘(UTC)` (오늘 일봉은 UTC 날짜 안에서 끝나지 않는다)
 * 미래 날짜(date > 오늘)는 어느 시장이든 완료봉이 아니다.
 */
function completedDatePredicate(marketTz: KnownMarketTz, now: Date): (date: string) => boolean {
  const today = marketLocalDate(marketTz, now);
  const todayConfirmed = isSessionBarConfirmed(marketTz, today, now);
  return (date: string) => date < today || (date === today && todayConfirmed);
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
 * 완료 판정은 `extractCompletedBars` 와 같은 규칙이다: KR/US/JP 는 시장 현지 오늘 이전 봉 + (오늘 봉이 마감 확정 + 정착 대기를
 * 지났으면 오늘 봉도), CRYPTO 는 UTC 오늘 이전 봉, UNKNOWN 은 최신 1개 보수적 제외.
 */
export function extractCompletedCloses(
  raw: RawSeries | undefined, marketTz: MarketTz, now: Date
): { dates: string[]; closes: number[] } {
  const closes = raw?.data ?? {};
  const all = Object.keys(closes).sort().filter(d => isPos(closes[d]));
  const usable = marketTz === 'UNKNOWN'
    ? all.slice(0, Math.max(0, all.length - 1))     // 완료 여부 미상 → 최신 1개 보수적 제외
    : all.filter(completedDatePredicate(marketTz, now));
  return { dates: usable, closes: usable.map(d => closes[d]) };
}

/**
 * 원본 시계열 → **유효 완료봉** 배열(날짜 오름차순).
 *   1) high/low 미수신이면 hasHighLow=false (종가 폴백 금지 — 호출부가 '확인 불가' 처리)
 *   2) 유효 일봉만 남긴다 (비정상 행은 기간 슬롯도 차지하지 않음)
 *   3) 완료봉만 남긴다 — 시장 현지 날짜 기준:
 *        · KR/US/JP : 현지 "오늘" 이전 봉은 완료. **현지 오늘 봉은 세션 마감 확정 + 정착 대기
 *          (`isSessionBarConfirmed`: closeConfirmTime + `SESSION_BAR_SETTLE_MIN`)가 지난 뒤에만** 완료 — 그 전에는
 *          장중 부분 봉일 수 있어 계속 제외한다(KR 16:00 KST·US 17:00 ET·JP 16:00 JST 부터 포함).
 *        · CRYPTO   : UTC 오늘 이전 봉만(오늘 일봉은 UTC 날짜 안에서 끝나지 않음). conservativeDrop=true.
 *        · UNKNOWN  : 최신 행을 보수적으로 1개 제외. conservativeDrop=true.
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
  const isCompleted = completedDatePredicate(marketTz, now);
  const bars = all.filter(b => isCompleted(b.date));
  return {
    bars,
    droppedRows: dropped,
    // 암호화폐는 공급자 일봉 기준 시간대 미확인 → UTC 로 보수적 판정했음을 표시
    conservativeDrop: marketTz === 'CRYPTO',
    hasHighLow: true,
  };
}

export interface BarsThroughSessionResult {
  /** 유효 일봉(날짜 오름차순) — `date ≤ sessionDate`(includeSession) 또는 `date < sessionDate`. */
  bars: DailyBar[];
  /** open/high/low 가 모두 수신됐는가 — false 면 bars 는 항상 빈 배열(종가 폴백 금지). */
  hasHighLow: boolean;
  /** 범위(위 날짜 조건) 안에서 무효 판정으로 제외된 행 수. 범위 밖(더 최신) 행은 세지 않는다. */
  droppedRows: number;
  /** bars 의 마지막 봉 날짜(없으면 null). */
  lastBarDate: string | null;
  /** 세션 날짜(sessionDate)의 유효 봉이 bars 에 실제로 들어 있는가(`lastBarDate === sessionDate`). includeSession=false 면 항상 false. */
  sessionBarPresent: boolean;
}

/**
 * **확정 세션까지의 유효 일봉** 추출 — 카카오톡 GAS(`scripts/notify/gas/entry.ts`)용. GAS-safe 순수 함수
 * (fetch·window·Intl 없음, "오늘"을 스스로 계산하지 않고 호출부가 확정한 세션 날짜를 받는다).
 *
 * `extractCompletedBars` 와의 차이: 그쪽은 "now 에서 시장 현지 오늘을 스스로 계산"해 경계를 정한다(2026-10-25 이전에는 현지 오늘
 * 봉을 자정까지 무조건 제외했다 — 그 때문에 마감이 이미 확정된 뒤(closeCheck: `closeConfirmTime` 경과)에도 같은 날 확정 봉(D)이
 * 잘려 직전 거래일(D-1) 봉이 마지막 봉이 되고, "…이하로 마감(종가 X)" 문구가 전일 종가로 발송되는 버그가 났다 — 실사용 카톡
 * 89건 대조). 지금은 그쪽도 `closeConfirmTime + SESSION_BAR_SETTLE_MIN` 이후 당일 봉을 포함하지만, 이 함수는 날짜 경계를
 * `sessionDate` 로 **명시**하고 세션 봉 실존(`sessionBarPresent`)까지 돌려줘 휴장일·공급자 미갱신을 호출부가 구분할 수 있다.
 *   · `includeSession=true`  : `date ≤ sessionDate` — 마감 확정 후. 세션 봉이 없으면 `sessionBarPresent=false`
 *     (공급자 미갱신 또는 휴장일 — 호출부가 "봉 대기/발송 보류"로 처리해야 하며 마지막 봉을 오늘 것처럼 쓰면 안 된다).
 *   · `includeSession=false` : `date < sessionDate` — 마감 전(진행 중 세션 제외).
 * 유효성 규칙은 `extractCompletedBars` 와 동일하다(`isValidBar`, open/high/low 미수신이면 빈 결과, 무효 행은 슬롯 미점유).
 */
export function extractBarsThroughSession(
  raw: RawSeries | undefined, sessionDate: string, includeSession: boolean
): BarsThroughSessionResult {
  const hasHighLow = raw?.high != null && raw?.low != null && raw?.open != null;
  if (!hasHighLow) {
    return { bars: [], hasHighLow: false, droppedRows: 0, lastBarDate: null, sessionBarPresent: false };
  }
  const closes = raw?.data ?? {};
  const dates = Object.keys(closes).sort();

  const bars: DailyBar[] = [];
  let dropped = 0;
  for (const d of dates) {
    if (includeSession ? d > sessionDate : d >= sessionDate) continue; // 범위 밖(더 최신) — 무효 집계에도 넣지 않는다
    const o = raw!.open![d], h = raw!.high![d], l = raw!.low![d], c = closes[d];
    if (!isValidBar(o, h, l, c)) { dropped++; continue; }
    bars.push({ date: d, open: o, high: h, low: l, close: c });
  }
  const lastBarDate = bars.length > 0 ? bars[bars.length - 1].date : null;
  return {
    bars,
    hasHighLow: true,
    droppedRows: dropped,
    lastBarDate,
    sessionBarPresent: lastBarDate === sessionDate,
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

/**
 * D 제외 직전 `lookback` 개 완료봉의 high 최댓값. 봉수 부족이면 null.
 * 로컬 변수명 `win`(과거 `window`) — 카카오톡 GAS 번들 가드(`scripts/notify/build-gas.mjs`)가
 * 브라우저 전역 `window` 참조를 문자열 그렙으로 잡는데, 로컬 변수 `window`는 실제로는 무해하지만
 * 그렙이 식별자 vs 전역을 구분하지 못해 오탐한다(2026-09-26, P4 — 이 함수가 GAS 번들에 처음 포함됨).
 */
export function entryBreakoutLine(bars: DailyBar[], lookback: number = ENTRY_LOOKBACK): number | null {
  if (bars.length < lookback + 1) return null;
  const end = bars.length - 1;                 // D 인덱스 — 비교선에서 제외
  const win = bars.slice(end - lookback, end);
  return win.reduce((m, b) => (b.high > m ? b.high : m), -Infinity);
}

/** D 제외 직전 `lookback` 개 완료봉의 low 최솟값. 봉수 부족이면 null. (변수명 `win` 사유는 위 참고) */
export function exitChannelLine(bars: DailyBar[], lookback: number = EXIT_LOOKBACK): number | null {
  if (bars.length < lookback + 1) return null;
  const end = bars.length - 1;
  const win = bars.slice(end - lookback, end);
  return win.reduce((m, b) => (b.low < m ? b.low : m), Infinity);
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
  /**
   * 진입 돌파 채널(일). 기본 ENTRY_LOOKBACK(55) — 미지정 시 기존 동작과 완전히 동일.
   * P0(2026-09-26): `utils/turtleHoldings.TurtleHoldingsSettings.entryLookback` 연결용(P2 화면에서 전달).
   */
  entryLookback?: number;
}

/**
 * 관심종목 55일 돌파 상태 (상호배타 1개).
 * 발생 조건: `D.close >= 비교선` (같으면 발생). 장중가는 확정에 쓰지 않는다.
 * 채널 계산은 완전한 유효 OHLC 를 요구하고 **종가 폴백을 금지**한다(C-4 예외는 stopPrice 비교에만 적용).
 */
export function buildWatchRow(input: WatchInput): WatchRow {
  const entryLookback = input.entryLookback ?? ENTRY_LOOKBACK;
  const entryMinBars = entryLookback + 1;
  const marketTz = resolveMarketTz(input.exchange, input.isCrypto);
  const r = extractCompletedBars(input.raw, marketTz, input.now);
  const quality = baseQuality(r, marketTz);
  if (input.fetchFailed) {
    quality.issues = quality.issues.filter(i => i !== 'no-high-low' && i !== 'no-completed-bar');
    quality.issues.push('fetch-failed');
  }

  const enough = r.bars.length >= entryMinBars;
  if (!quality.issues.length && !enough) quality.issues.push('insufficient-bars');

  const base = {
    kind: 'watch' as const, ticker: input.ticker, name: input.name, quality,
    intradayPrice: input.intradayPrice,
  };
  if (!r.hasHighLow || !enough || r.bars.length === 0) {
    return { ...base, status: 'unavailable', completedClose: null, breakoutLine: null, gapToLinePct: null, intradayAboveLine: false };
  }

  const d = r.bars[r.bars.length - 1];
  const line = entryBreakoutLine(r.bars, entryLookback)!;
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
  /** 청산 채널(일). 기본 EXIT_LOOKBACK(20) — 미지정 시 기존 동작과 완전히 동일. (P0 §todayTurtle 하드코딩 해소) */
  exitLookback?: number;
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
  const exitLookback = input.exitLookback ?? EXIT_LOOKBACK;
  const channelDate = r.bars.length > 0 ? r.bars[r.bars.length - 1].date : null;
  const sameAsOf = channelDate != null && channelDate === lastCloseDate;
  const hasChannel = r.hasHighLow && r.bars.length > 0 && sameAsOf;
  const exitLine = hasChannel ? exitChannelLine(r.bars, exitLookback) : null;

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
  /** 청산 채널(일). 기본 EXIT_LOOKBACK(20) — 미지정 시 기존 동작과 완전히 동일. */
  exitLookback?: number;
}

/**
 * 기존 SATELLITE 보유분 상태 (상호배타 1개) — **20일 참고만**.
 * 2N 손절·불타기는 계산하지 않는다(진입 당시 N 기록 없음 / 불타기 검증 탈락).
 */
export function buildLegacyRow(input: LegacyInput): LegacySatelliteRow {
  const exitLookback = input.exitLookback ?? EXIT_LOOKBACK;
  const exitMinBars = exitLookback + 1;
  const marketTz = resolveMarketTz(input.exchange, input.isCrypto);
  const r = extractCompletedBars(input.raw, marketTz, input.now);
  const quality = baseQuality(r, marketTz);
  if (input.fetchFailed) {
    quality.issues = quality.issues.filter(i => i !== 'no-high-low' && i !== 'no-completed-bar');
    quality.issues.push('fetch-failed');
  }

  const enough = r.bars.length >= exitMinBars;
  if (!quality.issues.length && !enough) quality.issues.push('insufficient-bars');

  const base = { kind: 'legacy' as const, ticker: input.ticker, name: input.name, quality };
  if (!r.hasHighLow || !enough || r.bars.length === 0) {
    return { ...base, status: 'unavailable', completedClose: null, exitLine: null };
  }
  const d = r.bars[r.bars.length - 1];
  const line = exitChannelLine(r.bars, exitLookback)!;
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
