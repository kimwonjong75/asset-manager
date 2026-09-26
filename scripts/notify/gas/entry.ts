// scripts/notify/gas/entry.ts
// ---------------------------------------------------------------------------
// 카카오톡 알림 v1 — Google Apps Script 발송기(P5, 계획서 §6 / RULES.md §15).
//
// 이 파일은 esbuild(scripts/notify/build-gas.mjs)가 `dist/bundle.js`(IIFE, 전역 `TradePlanNotify`)로
// 묶고, `dist/Code.js`가 최상위 함수(doGet/doPost/hourlyCheck/closeCheck/morningDigest/
// installTriggers/sendTestMessage)로 위임한다. GAS 런타임(V8, ES 모듈 아님)에서 그대로 돈다.
//
// 재사용(파리티 보증): utils/tradePlan.ts(evaluateTradePlan/formatKakaoText/formatKakaoDigest/
// computeExitLineValue) + utils/marketHours.ts(isMarketOpen/lastSessionDate/closeConfirmTime/
// isQuietHours/toKstParts) + constants/api.ts(CLOUD_RUN_BASE_URL/APP_PUBLIC_URL) — 전부 순수 TS라
// 앱과 계산 로직이 100% 동일하다(별도 재작성 금지 — RULES.md §15 "Python 재작성=파리티 리스크"와
// 같은 이유). services/*는 fetch()(브라우저 전용) 등을 쓰므로 import하지 않는다 — 동일한 요청/응답
// 포맷(§14)을 UrlFetchApp으로 이 파일 안에서 재현한다.
//
// 저장: 매니페스트·MA 캐시는 이 스크립트가 만든 Drive 파일에만 저장한다(용도상 drive.file로
// 충분하지만, `DriveApp.createFile()`이 drive.file 스코프에서 거부되는 GAS 레거시 제약 때문에
// appsscript.json은 전체 drive 스코프를 쓴다 — 2026-09-04, RULES.md §15 참고).
// **portfolio.json은 절대 읽지도 쓰지도 않는다**(RULES.md §15).

import { CLOUD_RUN_BASE_URL, APP_PUBLIC_URL } from '../../../constants/api';
import {
  evaluateTradePlan,
  computeExitLineValue,
  formatKakaoText,
  formatKakaoDigest,
} from '../../../utils/tradePlan';
import {
  isMarketOpen,
  lastSessionDate,
  closeConfirmTime,
  isQuietHours,
  toKstParts,
  type MarketId,
} from '../../../utils/marketHours';
import { PLAN_TIER_LABELS } from '../../../types/tradePlan';
import type {
  ExitLinePeriod,
  TradePlanEvaluation,
  TradePlanMarket,
} from '../../../types/tradePlan';
import type {
  NotifyManifest,
  NotifyManifestItem,
  NotifyManifestTurtleSection,
  NotifyManifestTurtleHolding,
  NotifyManifestTurtleReentryPosition,
  NotifyManifestTurtleWatch,
} from '../../../utils/notifyManifest';
import { resolveHoldingsSettings } from '../../../utils/turtleHoldings';
import { resolveMarketTz, extractCompletedBars } from '../../../utils/todayTurtle';
import type { DailyBar, RawSeries } from '../../../utils/todayTurtle';
import type { TurtleHoldingsSettings } from '../../../types/turtleHoldings';
import {
  evaluateLegacyHoldingForNotify,
  evaluateReentryPositionForNotify,
  evaluateWatchItemForNotify,
  formatTurtleMorningDigest,
} from '../../../utils/turtleHoldingsNotify';
import type { TurtleNotifyCandidate } from '../../../utils/turtleHoldingsNotify';

// ═══════════════════════════════════════════════════════════════════════════
// 상수
// ═══════════════════════════════════════════════════════════════════════════

const KAKAO_AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_SEND_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

const MANIFEST_FILE_NAME = 'trade-plan-manifest.json';
const MA_CACHE_FILE_NAME = 'trade-plan-ma-cache.json';

const DAILY_SEND_CAP = 8;
const SENT_LOG_RETENTION_DAYS = 7;
const MAIL_FAILURE_COOLDOWN_HOURS = 24;
const HISTORY_LOOKBACK_DAYS = 80;
const QUOTE_CHUNK_SIZE = 20;

const MARKET_IDS: MarketId[] = ['KR', 'US', 'CRYPTO'];

// ═══════════════════════════════════════════════════════════════════════════
// ScriptProperties 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

function getProp(key: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(key);
}
function setProp(key: string, value: string): void {
  PropertiesService.getScriptProperties().setProperty(key, value);
}
function getJsonProp<T>(key: string, fallback: T): T {
  const raw = getProp(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function setJsonProp(key: string, value: unknown): void {
  setProp(key, JSON.stringify(value));
}

// ═══════════════════════════════════════════════════════════════════════════
// 시각 유틸(KST) — utils/marketHours.toKstParts 재사용, 문자열 포맷만 이 파일 책임
// ═══════════════════════════════════════════════════════════════════════════

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function kstDateStr(now: Date): string {
  const p = toKstParts(now);
  return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
}
function hhmmKst(now: Date): string {
  const p = toKstParts(now);
  return `${pad2(p.hh)}:${pad2(p.mm)}`;
}
/** GAS Date 필드는 appsscript.json의 timeZone(Asia/Seoul) 기준이므로 로컬 필드가 곧 KST 날짜다. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysStr(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + deltaDays * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 시장 분류 — utils/holdingMarkets.marketIdForExchange와 동일 규칙을 자체 구현
// (그 파일은 services/historicalPriceService를 값으로 import해 fetch() 등 브라우저 전용
//  코드를 끌고 오므로 GAS 번들에 넣지 않는다 — 대신 규칙만 복제한다)
// ═══════════════════════════════════════════════════════════════════════════

function isCryptoExchangeLocal(exchange: string): boolean {
  const normalized = (exchange || '').toLowerCase().trim();
  return ['upbit', 'bithumb', '주요 거래소 (종합)'].some(ex => normalized.includes(ex));
}

function classifyMarket(exchange: string): MarketId {
  if (isCryptoExchangeLocal(exchange)) return 'CRYPTO';
  const e = (exchange || '').toUpperCase();
  if (e.includes('KRX') || e.includes('KONEX') || e.includes('금시장')) return 'KR';
  return 'US'; // NASDAQ/NYSE/AMEX 및 미분류는 US 규약 폴백(marketIdForExchange와 동일)
}

function toUpbitPair(symbol: string): string {
  const s = (symbol || '').trim().toUpperCase();
  if (!s) return '';
  if (s.startsWith('KRW-') || s.startsWith('BTC-') || s.startsWith('USDT-')) return s;
  return `KRW-${s.replace(/USDT$/, '')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 백엔드 HTTP 클라이언트 (Cloud Run, 무인증) — services/priceService·historicalPriceService·
// upbitService·marketOverviewService와 동일한 요청/응답 포맷을 UrlFetchApp으로 재현(RULES §14)
// ═══════════════════════════════════════════════════════════════════════════

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function httpPostJson(url: string, body: unknown): unknown {
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error(`백엔드 오류 ${code}: ${text.slice(0, 200)}`);
  }
  // 백엔드가 NaN을 반환할 수 있어 텍스트 치환 후 파싱(services/priceService.ts와 동일 관례)
  return JSON.parse(text.replace(/\bNaN\b/g, 'null'));
}

/** `/` 응답을 티커(대문자) 키 맵으로 평탄화(array / {results} / object-keyed 대응) — marketOverviewService.flattenByTicker와 동일 규칙. */
function flattenByTicker(data: unknown): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const push = (item: Record<string, unknown>, keyHint?: string) => {
    const t = String(item.ticker ?? item.symbol ?? keyHint ?? '').toUpperCase();
    if (t) map.set(t, item);
  };
  if (Array.isArray(data)) {
    data.forEach(it => it && typeof it === 'object' && push(it as Record<string, unknown>));
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) {
      (obj.results as unknown[]).forEach(it => it && typeof it === 'object' && push(it as Record<string, unknown>));
    } else {
      Object.entries(obj).forEach(([key, val]) => {
        if (val && typeof val === 'object') push(val as Record<string, unknown>, key);
      });
    }
  }
  return map;
}

interface QuoteResult { price: number; prevClose: number; date: string | null }

/** 주식/ETF/금 등 현재가 배치 조회(`/`, quotes_only). 20개씩 청크(services/priceService.CHUNK_SIZE와 동일). */
function fetchQuotes(items: { ticker: string; exchange: string }[]): Map<string, QuoteResult> {
  const result = new Map<string, QuoteResult>();
  for (let i = 0; i < items.length; i += QUOTE_CHUNK_SIZE) {
    const chunk = items.slice(i, i + QUOTE_CHUNK_SIZE);
    try {
      const data = httpPostJson(CLOUD_RUN_BASE_URL, {
        tickers: chunk.map(c => ({ ticker: c.ticker.toUpperCase(), exchange: c.exchange })),
        quotes_only: true,
      });
      const map = flattenByTicker(data);
      for (const c of chunk) {
        const item = map.get(c.ticker.toUpperCase());
        if (!item) continue;
        result.set(c.ticker.toUpperCase(), {
          price: toNumber(item.priceOriginal ?? item.price ?? item.close),
          prevClose: toNumber(item.prev_close ?? item.previousClose ?? item.yesterdayPrice),
          date: typeof item.date === 'string' ? item.date : null,
        });
      }
    } catch (e) {
      console.error('fetchQuotes 청크 실패:', e);
    }
  }
  return result;
}

/** 암호화폐 현재가 배치 조회(`/upbit`). */
function fetchUpbitQuotes(tickers: string[]): Map<string, QuoteResult> {
  const result = new Map<string, QuoteResult>();
  if (tickers.length === 0) return result;
  try {
    const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/upbit`, { symbols: tickers }) as Record<string, Record<string, unknown>>;
    for (const ticker of tickers) {
      const pair = toUpbitPair(ticker);
      const item = data[pair] ?? data[ticker.toUpperCase()];
      if (!item || item.error) continue;
      result.set(ticker.toUpperCase(), {
        price: toNumber(item.trade_price),
        prevClose: toNumber(item.prev_closing_price),
        date: null, // 업비트 현재가 응답엔 날짜가 없음 — 24시간 시장이라 세션일로 대체 표시
      });
    }
  } catch (e) {
    console.error('fetchUpbitQuotes 실패:', e);
  }
  return result;
}

function mergeQuoteMap(target: Map<string, QuoteResult>, source: Map<string, QuoteResult>): void {
  source.forEach((v, k) => target.set(k, v));
}

// ── 과거 종가(/history, /upbit/history) → MA 캐시 ──────────────────────────

interface MaCacheEntry {
  ma: Partial<Record<ExitLinePeriod, number | null>>;
  asOf: string;
  /** 확정 종가(마감 판정용) — 조회된 종가 시계열의 마지막 날짜 값. */
  lastClose?: number;
  lastCloseDate?: string;
}
type MaCache = Record<string, MaCacheEntry>;

function entryToMaCache(data: Record<string, number> | undefined, asOf: string): MaCacheEntry | null {
  if (!data) return null;
  const dates = Object.keys(data).sort();
  const closes = dates.map(d => data[d]).filter(c => typeof c === 'number' && isFinite(c) && c > 0);
  if (closes.length === 0) return null;
  const ma: Partial<Record<ExitLinePeriod, number | null>> = {};
  for (const period of [10, 20, 50] as ExitLinePeriod[]) {
    ma[period] = computeExitLineValue(closes, { kind: 'ma', period });
  }
  const lastDate = dates[dates.length - 1];
  return { ma, asOf, lastClose: data[lastDate], lastCloseDate: lastDate };
}

/** manifest 항목들의 MA 캐시를 배치 갱신한다(closeCheck 전용 — 마감 확정 후 1회). */
function updateMaCache(cache: MaCache, items: NotifyManifestItem[], market: MarketId, now: Date): void {
  const endDate = localDateStr(now);
  const startDate = addDaysStr(endDate, -HISTORY_LOOKBACK_DAYS);

  if (market === 'CRYPTO') {
    const symbols = items.map(it => it.ticker);
    try {
      const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/upbit/history`, {
        symbols, start_date: startDate, end_date: endDate,
      }) as Record<string, { data?: Record<string, number> }>;
      for (const it of items) {
        const pair = toUpbitPair(it.ticker);
        const entry = data[pair] ?? data[it.ticker.toUpperCase()];
        const parsed = entryToMaCache(entry?.data, endDate);
        if (parsed) cache[it.ticker.toUpperCase()] = parsed;
      }
    } catch (e) {
      console.error('crypto history 조회 실패:', e);
    }
    return;
  }

  const tickers = items.map(it => it.ticker.toUpperCase());
  for (let i = 0; i < tickers.length; i += QUOTE_CHUNK_SIZE) {
    const chunk = tickers.slice(i, i + QUOTE_CHUNK_SIZE);
    try {
      const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/history`, {
        tickers: chunk, start_date: startDate, end_date: endDate,
      }) as Record<string, { data?: Record<string, number> }>;
      for (const ticker of chunk) {
        const parsed = entryToMaCache(data[ticker]?.data, endDate);
        if (parsed) cache[ticker] = parsed;
      }
    } catch (e) {
      console.error('history 청크 실패:', e);
    }
  }
}

/** hourlyCheck에서 캐시가 비어 있을 때(첫 실행 등)만 쓰는 단건 폴백 — 브리프 §A hourlyCheck 명세. */
function bootstrapMaEntry(ticker: string, market: MarketId, now: Date): MaCacheEntry | null {
  const endDate = localDateStr(now);
  const startDate = addDaysStr(endDate, -HISTORY_LOOKBACK_DAYS);
  try {
    if (market === 'CRYPTO') {
      const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/upbit/history`, {
        symbols: [ticker], start_date: startDate, end_date: endDate,
      }) as Record<string, { data?: Record<string, number> }>;
      const pair = toUpbitPair(ticker);
      const entry = data[pair] ?? data[ticker.toUpperCase()];
      return entryToMaCache(entry?.data, endDate);
    }
    const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/history`, {
      tickers: [ticker.toUpperCase()], start_date: startDate, end_date: endDate,
    }) as Record<string, { data?: Record<string, number> }>;
    return entryToMaCache(data[ticker.toUpperCase()]?.data, endDate);
  } catch (e) {
    console.error('bootstrapMaEntry 실패:', ticker, e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 매니페스트 / MA 캐시 저장 — 이 스크립트가 만든 Drive 파일에만 저장(portfolio.json 무접촉)
// ═══════════════════════════════════════════════════════════════════════════

function loadManifest(): NotifyManifest | null {
  const fileId = getProp('MANIFEST_FILE_ID');
  if (!fileId) return null;
  try {
    const text = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
    return JSON.parse(text) as NotifyManifest;
  } catch (e) {
    console.error('매니페스트 로드 실패:', e);
    return null;
  }
}

function saveManifest(manifest: NotifyManifest): void {
  const json = JSON.stringify(manifest);
  const fileId = getProp('MANIFEST_FILE_ID');
  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setContent(json);
      if (manifest.appUrl) setProp('APP_URL', manifest.appUrl);
      return;
    } catch (e) {
      console.error('기존 매니페스트 파일 갱신 실패, 새로 생성합니다:', e);
    }
  }
  const file = DriveApp.createFile(MANIFEST_FILE_NAME, json, 'application/json');
  setProp('MANIFEST_FILE_ID', file.getId());
  if (manifest.appUrl) setProp('APP_URL', manifest.appUrl);
}

function loadMaCache(): MaCache {
  const fileId = getProp('MA_CACHE_FILE_ID');
  if (!fileId) return {};
  try {
    const text = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
    return JSON.parse(text) as MaCache;
  } catch (e) {
    console.error('MA 캐시 로드 실패:', e);
    return {};
  }
}

function saveMaCache(cache: MaCache): void {
  const json = JSON.stringify(cache);
  const fileId = getProp('MA_CACHE_FILE_ID');
  if (fileId) {
    try {
      DriveApp.getFileById(fileId).setContent(json);
      return;
    } catch (e) {
      console.error('기존 MA 캐시 파일 갱신 실패, 새로 생성합니다:', e);
    }
  }
  const file = DriveApp.createFile(MA_CACHE_FILE_NAME, json, 'application/json');
  setProp('MA_CACHE_FILE_ID', file.getId());
}

// ═══════════════════════════════════════════════════════════════════════════
// 멱등 / 일 상한 / 정숙시간 보류
// ═══════════════════════════════════════════════════════════════════════════

function hasSent(key: string): boolean {
  const log = getJsonProp<Record<string, string>>('SENT_LOG_JSON', {});
  return Object.prototype.hasOwnProperty.call(log, key);
}

function markSent(key: string, now: Date): void {
  const log = getJsonProp<Record<string, string>>('SENT_LOG_JSON', {});
  log[key] = now.toISOString();
  const cutoff = now.getTime() - SENT_LOG_RETENTION_DAYS * 86_400_000;
  for (const k of Object.keys(log)) {
    const t = new Date(log[k]).getTime();
    if (!isFinite(t) || t < cutoff) delete log[k];
  }
  setJsonProp('SENT_LOG_JSON', log);
}

function getDailyCount(now: Date): number {
  const d = getJsonProp<{ date: string; count: number }>('DAILY_COUNT_JSON', { date: '', count: 0 });
  return d.date === kstDateStr(now) ? d.count : 0;
}
function setDailyCount(count: number, now: Date): void {
  setJsonProp('DAILY_COUNT_JSON', { date: kstDateStr(now), count });
}

interface PendingEntry { summary: string; at: string }
function loadPending(): PendingEntry[] {
  return getJsonProp<PendingEntry[]>('PENDING_QUIET_JSON', []);
}
function queuePending(summary: string, now: Date): void {
  const list = loadPending();
  list.push({ summary, at: now.toISOString() });
  setJsonProp('PENDING_QUIET_JSON', list);
}
function clearPending(): void {
  setJsonProp('PENDING_QUIET_JSON', []);
}

// ═══════════════════════════════════════════════════════════════════════════
// 실행 상태 / 실패 메일
// ═══════════════════════════════════════════════════════════════════════════

interface LastRun { at: string; status: 'ok' | 'error'; message: string }
function recordLastRun(status: 'ok' | 'error', message: string): void {
  setJsonProp('LAST_RUN_JSON', { at: new Date().toISOString(), status, message } satisfies LastRun);
}

function maybeSendFailureMail(context: string, message: string): void {
  const lastMailAt = getProp('LAST_FAILURE_MAIL_AT');
  const nowMs = Date.now();
  if (lastMailAt && nowMs - new Date(lastMailAt).getTime() < MAIL_FAILURE_COOLDOWN_HOURS * 3_600_000) return;
  try {
    const to = Session.getEffectiveUser().getEmail();
    if (!to) return;
    MailApp.sendEmail(to, `[매매계획 알림] ${context} 실패`, `${message}\n\n시각: ${new Date().toISOString()}`);
    setProp('LAST_FAILURE_MAIL_AT', new Date().toISOString());
  } catch (mailErr) {
    console.error('실패 메일 발송도 실패:', mailErr);
  }
}

function handleFailure(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${context}] 실패:`, message);
  recordLastRun('error', `${context}: ${message}`);
  maybeSendFailureMail(context, message);
}

// ═══════════════════════════════════════════════════════════════════════════
// 카카오 OAuth / 발송
// ═══════════════════════════════════════════════════════════════════════════

function buildFormBody(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/**
 * 토큰 요청 파라미터에 client_secret을 조건부로 추가한다. 카카오 앱의 REST API 키는 "클라이언트
 * 시크릿" 기능이 최근 기본 활성화로 바뀌었다(2026-09 확인) — 활성화된 앱은 이 값 없이 토큰을
 * 요청하면 KOE010(invalid_client)로 거부된다. `KAKAO_CLIENT_SECRET` 속성이 없으면(클라이언트
 * 시크릿을 비활성화한 앱) 그대로 생략해 기존 동작을 유지한다.
 */
function withClientSecret(params: Record<string, string>): Record<string, string> {
  const secret = getProp('KAKAO_CLIENT_SECRET');
  return secret ? { ...params, client_secret: secret } : params;
}

/** 저장 성공을 확인한 뒤에만 발송 단계로 진행한다(§6.1 락아웃 가드). */
function refreshAccessToken(): string | null {
  const restKey = getProp('KAKAO_REST_KEY');
  const refreshToken = getProp('KAKAO_REFRESH_TOKEN');
  if (!restKey || !refreshToken) {
    console.error('KAKAO_REST_KEY 또는 KAKAO_REFRESH_TOKEN 미설정');
    return null;
  }
  try {
    const res = UrlFetchApp.fetch(KAKAO_TOKEN_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: buildFormBody(withClientSecret({ grant_type: 'refresh_token', client_id: restKey, refresh_token: refreshToken })),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error('토큰 갱신 실패:', res.getResponseCode(), res.getContentText());
      return null;
    }
    const data = JSON.parse(res.getContentText()) as {
      access_token?: string; expires_in?: number; refresh_token?: string;
    };
    if (!data.access_token) return null;

    if (data.refresh_token) {
      setProp('KAKAO_REFRESH_TOKEN', data.refresh_token);
      const verify = getProp('KAKAO_REFRESH_TOKEN');
      if (verify !== data.refresh_token) {
        throw new Error('리프레시 토큰 저장 확인 실패 — 락아웃 방지를 위해 발송을 중단합니다.');
      }
    }
    setProp('KAKAO_ACCESS_TOKEN', data.access_token);
    setProp('KAKAO_ACCESS_EXPIRES_AT', String(Date.now() + (data.expires_in ?? 21_600) * 1000));
    return data.access_token;
  } catch (e) {
    console.error('토큰 갱신 예외:', e);
    return null;
  }
}

function getAccessToken(): string | null {
  const expiresAt = getProp('KAKAO_ACCESS_EXPIRES_AT');
  const cached = getProp('KAKAO_ACCESS_TOKEN');
  if (cached && expiresAt && Date.now() < Number(expiresAt) - 60_000) return cached;
  return refreshAccessToken();
}

function sendKakaoMessage(text: string, linkUrl: string): boolean {
  const token = getAccessToken();
  if (!token) {
    console.error('액세스 토큰 없음 — 발송 취소');
    return false;
  }
  const templateObject = {
    object_type: 'text',
    text,
    link: { web_url: linkUrl, mobile_web_url: linkUrl },
    button_title: '앱에서 기록',
  };
  try {
    const res = UrlFetchApp.fetch(KAKAO_SEND_URL, {
      method: 'post',
      headers: { Authorization: `Bearer ${token}` },
      contentType: 'application/x-www-form-urlencoded',
      payload: buildFormBody({ template_object: JSON.stringify(templateObject) }),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      console.error('카카오 발송 실패:', res.getResponseCode(), res.getContentText());
      return false;
    }
    return true;
  } catch (e) {
    console.error('카카오 발송 예외:', e);
    return false;
  }
}

function buildDeepLink(assetId: string | null): string {
  const base = getProp('APP_URL') || APP_PUBLIC_URL;
  const url = base.endsWith('/') ? base : `${base}/`;
  // 2026-09-14 '오늘' 탭 폐지 → 홈(dashboard). 이미 발송된 `?tab=today` 링크는 앱의 resolveTabAlias가 계속 처리.
  return assetId ? `${url}?tab=dashboard&asset=${encodeURIComponent(assetId)}` : `${url}?tab=dashboard`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 신호 평가 → 발송 후보 → 디스패치(멱등 + 일 상한 + 정숙시간)
// ═══════════════════════════════════════════════════════════════════════════

interface NotifyCandidate {
  text: string;
  summary: string;
  linkUrl: string;
  idempotencyKey: string;
}

function buildCandidate(item: NotifyManifestItem, ev: TradePlanEvaluation, market: TradePlanMarket, now: Date): NotifyCandidate | null {
  if (market.price === null) return null;
  const idempotencyKey = `${item.assetId}|${ev.signal}|${kstDateStr(now)}`;
  if (hasSent(idempotencyKey)) return null;
  const text = formatKakaoText({
    name: item.name, evaluation: ev, plan: item.plan, price: market.price, priceAsOf: market.priceAsOf,
    timeLabel: hhmmKst(now), isIntraday: market.isIntraday, quantity: item.quantity,
  });
  return {
    text, summary: `${item.name} ${PLAN_TIER_LABELS[ev.tier]}`,
    linkUrl: buildDeepLink(item.assetId), idempotencyKey,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// "보유종목 터틀" 판정 — P4(계획서 §4.5·§6 P4). 마감 확정 종가로만 판정한다(장중 미판정).
// 재사용(재구현 금지): 판정 자체는 utils/turtleHoldings.ts(P0)·utils/turtleHoldingsNotify.ts(문구
// 조립)를 그대로 쓴다. 이 파일은 OHLCV 조회(UrlFetchApp)와 시장별 배선만 담당한다.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 완료봉 조회 창(달력일) — `utils/turtleHoldingsView.ts`의
 * `turtleHoldingsRequiredTradingDays`/`turtleHoldingsLookbackCalendarDays`와 동일한 여유 공식
 * (값 자체는 골든 대상이 아님, RULES §15). 그 파일 전체를 GAS 번들에 끌어오지 않기 위해
 * 이 계산만 별도로 둔다 — 판정 로직 자체(청산선·재진입선 등)는 utils/turtleHoldings.ts를
 * 값으로 그대로 import해서 쓰므로 재구현이 아니다.
 */
function turtleOhlcvLookbackDays(settings: TurtleHoldingsSettings): number {
  const tradingDays = Math.max(settings.entryLookback + 1, settings.exitLookback + 1, settings.maPeriod, 21);
  return Math.ceil(tradingDays * 2.4) + 30;
}

/** OHLCV(시가/고가/저가/종가) 배치 조회 — `/history`·`/upbit/history` 확장 응답(RULES §14)을 그대로 쓴다. */
function fetchOhlcvBatch(tickers: string[], market: MarketId, startDate: string, endDate: string): Map<string, RawSeries> {
  const result = new Map<string, RawSeries>();
  if (tickers.length === 0) return result;
  if (market === 'CRYPTO') {
    try {
      const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/upbit/history`, {
        symbols: tickers, start_date: startDate, end_date: endDate,
      }) as Record<string, RawSeries>;
      for (const ticker of tickers) {
        const pair = toUpbitPair(ticker);
        const entry = data[pair] ?? data[ticker.toUpperCase()];
        if (entry) result.set(ticker.toUpperCase(), entry);
      }
    } catch (e) {
      console.error('터틀 crypto OHLCV 조회 실패:', e);
    }
    return result;
  }
  const upper = tickers.map(t => t.toUpperCase());
  for (let i = 0; i < upper.length; i += QUOTE_CHUNK_SIZE) {
    const chunk = upper.slice(i, i + QUOTE_CHUNK_SIZE);
    try {
      const data = httpPostJson(`${CLOUD_RUN_BASE_URL}/history`, {
        tickers: chunk, start_date: startDate, end_date: endDate,
      }) as Record<string, RawSeries>;
      for (const ticker of chunk) {
        if (data[ticker]) result.set(ticker, data[ticker]);
      }
    } catch (e) {
      console.error('터틀 history OHLCV 청크 실패:', e);
    }
  }
  return result;
}

type TurtleItemKind = 'legacy' | 'reentry' | 'watch';
type TurtleNotifyItem = NotifyManifestTurtleHolding | NotifyManifestTurtleReentryPosition | NotifyManifestTurtleWatch;

/**
 * 한 시장(KR/US/CRYPTO)의 터틀 대상(원래 보유분·재매수분·감시 관심종목)을 전부 평가해
 * 신호가 난 것만 콜백으로 넘긴다. OHLCV는 이 함수 안에서 한 번만 배치 조회한다.
 */
function evaluateTurtleMarket(
  turtle: NotifyManifestTurtleSection,
  market: MarketId,
  sessionDate: string,
  now: Date,
  onResult: (kind: TurtleItemKind, item: TurtleNotifyItem, candidate: TurtleNotifyCandidate) => void,
): void {
  const settings = resolveHoldingsSettings(turtle.settings);
  const legacyItems = turtle.legacyHoldings.filter(it => classifyMarket(it.exchange) === market);
  const reentryItems = turtle.reentryPositions.filter(it => classifyMarket(it.exchange) === market);
  const watchItems = turtle.watchItems.filter(it => classifyMarket(it.exchange) === market);
  const tickers = [...legacyItems, ...reentryItems, ...watchItems].map(it => it.ticker);
  if (tickers.length === 0) return;

  const lookbackDays = turtleOhlcvLookbackDays(settings);
  const startDate = addDaysStr(sessionDate, -lookbackDays);
  const ohlcv = fetchOhlcvBatch(tickers, market, startDate, sessionDate);
  const barsFor = (it: { ticker: string; exchange: string; isCrypto: boolean }): DailyBar[] =>
    extractCompletedBars(ohlcv.get(it.ticker.toUpperCase()), resolveMarketTz(it.exchange, it.isCrypto), now).bars;

  for (const it of legacyItems) {
    const c = evaluateLegacyHoldingForNotify(it, barsFor(it), settings);
    if (c) onResult('legacy', it, c);
  }
  for (const it of reentryItems) {
    const c = evaluateReentryPositionForNotify(it, barsFor(it), settings);
    if (c) onResult('reentry', it, c);
  }
  for (const it of watchItems) {
    const c = evaluateWatchItemForNotify(it, barsFor(it), settings);
    if (c) onResult('watch', it, c);
  }
}

/** closeCheck 전용 — 신호를 실제 발송 후보(NotifyCandidate)로 변환해 candidates에 쌓는다(멱등 가드 포함). */
function dispatchTurtleForMarket(
  turtle: NotifyManifestTurtleSection, market: MarketId, sessionDate: string, now: Date, candidates: NotifyCandidate[],
): void {
  evaluateTurtleMarket(turtle, market, sessionDate, now, (kind, item, c) => {
    const idBase = kind === 'watch' ? (item as NotifyManifestTurtleWatch).watchItemId
      : (item as NotifyManifestTurtleHolding | NotifyManifestTurtleReentryPosition).assetId;
    const idempotencyKey = `turtle|${kind}|${idBase}|${c.signal}|${sessionDate}`;
    if (hasSent(idempotencyKey)) return;
    const linkAssetId = kind === 'watch' ? null : (item as NotifyManifestTurtleHolding | NotifyManifestTurtleReentryPosition).assetId;
    candidates.push({ text: c.text, summary: c.summary, linkUrl: buildDeepLink(linkAssetId), idempotencyKey });
  });
}

/** morningDigest 전용 — 발송 없이 종목명만 신호 종류별로 모은다(멱등 무관, 매번 신선 재계산). */
function collectTurtleMorningSummary(turtle: NotifyManifestTurtleSection, now: Date): {
  sellNames: string[]; reentryNames: string[]; pyramidNames: string[];
} {
  const sellNames: string[] = [];
  const reentryNames: string[] = [];
  const pyramidNames: string[] = [];
  for (const market of MARKET_IDS) {
    const sessionDate = lastSessionDate(market, now);
    evaluateTurtleMarket(turtle, market, sessionDate, now, (_kind, item, c) => {
      if (c.signal === 'reentry-pyramid') pyramidNames.push(item.name);
      else if (c.signal === 'watch-reentry') reentryNames.push(item.name);
      else sellNames.push(item.name);
    });
  }
  return { sellNames, reentryNames, pyramidNames };
}

function clipText(s: string, max = 200): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function formatOverflowBundle(overflow: NotifyCandidate[]): string {
  const top3 = overflow.slice(0, 3).map(c => c.summary).join(', ');
  const rest = overflow.length - Math.min(3, overflow.length);
  return clipText(`📋 [일 발송 상한 초과] ${top3}${rest > 0 ? ` 외 ${rest}건` : ''}\n앱에서 전체 확인하세요`);
}

/**
 * 발송 후보를 실제로 내보낸다.
 *  · 정숙시간(00:00–07:00 KST)이면 전부 보류 큐(PENDING_QUIET_JSON)에 쌓고 멱등키만 소비한다
 *    (morningDigest가 07시에 묶어 보낸다).
 *  · 아니면 일 상한(8건)까지는 개별 발송, 넘는 만큼은 "상위 3건 + N건" 요약 1건으로 묶는다.
 */
function dispatchNotifications(candidates: NotifyCandidate[], now: Date): number {
  if (candidates.length === 0) return 0;

  if (isQuietHours(now)) {
    for (const c of candidates) {
      queuePending(c.summary, now);
      markSent(c.idempotencyKey, now);
    }
    return 0;
  }

  let count = getDailyCount(now);
  const remaining = Math.max(0, DAILY_SEND_CAP - count);
  const toSendNow = candidates.slice(0, remaining);
  const overflow = candidates.slice(remaining);
  let sent = 0;

  for (const c of toSendNow) {
    if (sendKakaoMessage(c.text, c.linkUrl)) {
      markSent(c.idempotencyKey, now);
      count++;
      sent++;
    }
  }

  if (overflow.length > 0) {
    if (sendKakaoMessage(formatOverflowBundle(overflow), buildDeepLink(null))) {
      for (const c of overflow) markSent(c.idempotencyKey, now);
      count++;
      sent++;
    }
  }

  setDailyCount(count, now);
  return sent;
}

/** hourlyCheck 발송 대상 신호 — 손절·익절·불타기(옵션)·손절근접만. 추세선은 여기서 발송하지 않는다. */
function isHourlyNotifiable(ev: TradePlanEvaluation, pyramidAlerts: boolean): boolean {
  if (ev.signal === 'stop-hit' || ev.signal === 'take-profit-hit' || ev.signal === 'near-stop') return true;
  if (ev.signal === 'pyramid-hit') return pyramidAlerts;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// 트리거: hourlyCheck — 개장 중 매시간, 손절선·익절선·불타기선만
// ═══════════════════════════════════════════════════════════════════════════

function hourlyCheck(): void {
  const now = new Date();
  try {
    const manifest = loadManifest();
    if (!manifest) { recordLastRun('ok', 'hourlyCheck: 매니페스트 없음(아직 동기화 안 됨)'); return; }

    const openItems = manifest.items.filter(it => isMarketOpen(classifyMarket(it.exchange), now));
    if (openItems.length === 0) { recordLastRun('ok', 'hourlyCheck: 개장 중인 시장 없음'); return; }

    const stockItems = openItems.filter(it => classifyMarket(it.exchange) !== 'CRYPTO');
    const cryptoItems = openItems.filter(it => classifyMarket(it.exchange) === 'CRYPTO');
    const quoteMap = new Map<string, QuoteResult>();
    if (stockItems.length > 0) {
      mergeQuoteMap(quoteMap, fetchQuotes(stockItems.map(it => ({ ticker: it.ticker, exchange: it.exchange }))));
    }
    if (cryptoItems.length > 0) {
      mergeQuoteMap(quoteMap, fetchUpbitQuotes(cryptoItems.map(it => it.ticker)));
    }

    const maCache = loadMaCache();
    let cacheDirty = false;
    const candidates: NotifyCandidate[] = [];

    for (const item of openItems) {
      const market = classifyMarket(item.exchange);
      const quote = quoteMap.get(item.ticker.toUpperCase());
      if (!quote || !(quote.price > 0)) continue; // 시세 없음 — 일일 요약(unavailable)에서 별도 집계

      let maEntry = maCache[item.ticker.toUpperCase()];
      if (!maEntry && item.plan.exitLine.kind === 'ma') {
        const bootstrapped = bootstrapMaEntry(item.ticker, market, now);
        if (bootstrapped) {
          maCache[item.ticker.toUpperCase()] = bootstrapped;
          maEntry = bootstrapped;
          cacheDirty = true;
        }
      }

      const sessionDate = lastSessionDate(market, now);
      const tradeMarket: TradePlanMarket = {
        price: quote.price,
        priceAsOf: sessionDate,
        isIntraday: true,
        sessionDate,
        ma: maEntry ? maEntry.ma : {},
        maAsOf: maEntry ? maEntry.asOf : sessionDate,
      };
      const ev = evaluateTradePlan(item.plan, tradeMarket);
      if (isHourlyNotifiable(ev, manifest.pyramidAlerts)) {
        const c = buildCandidate(item, ev, tradeMarket, now);
        if (c) candidates.push(c);
      }
    }

    if (cacheDirty) saveMaCache(maCache);
    const sent = dispatchNotifications(candidates, now);
    recordLastRun('ok', `hourlyCheck 완료 · 대상 ${openItems.length} · 발송 ${sent}`);
  } catch (err) {
    handleFailure('hourlyCheck', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 트리거: closeCheck — 시장별 마감 확정 후 1회, 추세선 이탈/재돌파 + 일일 요약(KR 마감 시)
// ═══════════════════════════════════════════════════════════════════════════

interface DigestCounts { urgent: number; today: number; prepare: number; unavailable: number; brokerStopMissing: number }

function buildFullSummary(manifest: NotifyManifest, maCache: MaCache, now: Date): DigestCounts {
  const stockItems = manifest.items.filter(it => classifyMarket(it.exchange) !== 'CRYPTO');
  const cryptoItems = manifest.items.filter(it => classifyMarket(it.exchange) === 'CRYPTO');
  const quoteMap = new Map<string, QuoteResult>();
  if (stockItems.length > 0) mergeQuoteMap(quoteMap, fetchQuotes(stockItems.map(it => ({ ticker: it.ticker, exchange: it.exchange }))));
  if (cryptoItems.length > 0) mergeQuoteMap(quoteMap, fetchUpbitQuotes(cryptoItems.map(it => it.ticker)));

  const counts: DigestCounts = { urgent: 0, today: 0, prepare: 0, unavailable: 0, brokerStopMissing: 0 };
  for (const item of manifest.items) {
    if (!item.plan.brokerStopOrderRegistered) counts.brokerStopMissing++;
    const market = classifyMarket(item.exchange);
    const quote = quoteMap.get(item.ticker.toUpperCase());
    const sessionDate = lastSessionDate(market, now);
    const maEntry = maCache[item.ticker.toUpperCase()];
    const tradeMarket: TradePlanMarket = {
      price: quote && quote.price > 0 ? quote.price : null,
      priceAsOf: sessionDate,
      isIntraday: isMarketOpen(market, now),
      sessionDate,
      ma: maEntry ? maEntry.ma : {},
      maAsOf: maEntry ? maEntry.asOf : sessionDate,
    };
    const ev = evaluateTradePlan(item.plan, tradeMarket);
    if (ev.tier === 'urgent') counts.urgent++;
    else if (ev.tier === 'today') counts.today++;
    else if (ev.tier === 'prepare') counts.prepare++;
    if (ev.signal === 'unavailable') counts.unavailable++;
  }
  return counts;
}

function maybeSendDailyDigest(manifest: NotifyManifest, maCache: MaCache, now: Date): void {
  const todayKst = kstDateStr(now);
  if (getProp('LAST_DIGEST_DATE') === todayKst) return;
  const counts = buildFullSummary(manifest, maCache, now);
  const text = formatKakaoDigest({
    timeLabel: hhmmKst(now),
    urgent: counts.urgent, today: counts.today, prepare: counts.prepare,
    unavailable: counts.unavailable, brokerStopMissing: counts.brokerStopMissing,
    planless: manifest.planlessCount,
  });
  // 생존 신호(무신호도 발송) — 일 상한 디스패치를 거치지 않고 직접 보낸다(하루 1회로 자체 제한됨).
  if (sendKakaoMessage(text, buildDeepLink(null))) {
    setProp('LAST_DIGEST_DATE', todayKst);
  }
}

function buildTradeMarketFromClose(sessionDate: string, entry: MaCacheEntry | undefined): TradePlanMarket | null {
  if (!entry || typeof entry.lastClose !== 'number' || !entry.lastCloseDate) return null;
  return {
    price: entry.lastClose,
    priceAsOf: entry.lastCloseDate, // /history 최신 종가일 — sessionDate와 다르면 evaluateTradePlan이 stale로 처리(휴장일 안전망)
    isIntraday: false,
    sessionDate,
    ma: entry.ma,
    maAsOf: entry.asOf,
  };
}

function closeCheck(): void {
  const now = new Date();
  try {
    const manifest = loadManifest();
    if (!manifest) { recordLastRun('ok', 'closeCheck: 매니페스트 없음'); return; }

    const maCache = loadMaCache();
    const candidates: NotifyCandidate[] = [];
    let ranAny = false;
    let krRan = false;

    for (const market of MARKET_IDS) {
      const sessionDate = lastSessionDate(market, now);
      const confirmAt = closeConfirmTime(market, sessionDate);
      if (now.getTime() < new Date(confirmAt).getTime()) continue; // 아직 마감 확정 전

      const doneKey = `CLOSE_DONE_${market}`;
      if (getProp(doneKey) === sessionDate) continue; // 이미 이번 세션 처리함

      const items = manifest.items.filter(it => classifyMarket(it.exchange) === market);
      if (items.length > 0) {
        updateMaCache(maCache, items, market, now);
        for (const item of items) {
          const tradeMarket = buildTradeMarketFromClose(sessionDate, maCache[item.ticker.toUpperCase()]);
          if (!tradeMarket) continue;
          const ev = evaluateTradePlan(item.plan, tradeMarket);
          if (ev.signal === 'exit-line-hit' || ev.action === 'arm-exit') {
            const c = buildCandidate(item, ev, tradeMarket, now);
            if (c) candidates.push(c);
          }
        }
      }
      // P4 — "보유종목 터틀"(팔 때·손절 이탈·추가 매수·다시 살 때)도 같은 마감 확정 시점에 1회 판정한다.
      if (manifest.turtle) {
        dispatchTurtleForMarket(manifest.turtle, market, sessionDate, now, candidates);
      }
      setProp(doneKey, sessionDate);
      ranAny = true;
      if (market === 'KR') krRan = true;
    }

    if (!ranAny) { recordLastRun('ok', 'closeCheck: 처리할 마감 없음'); return; }

    saveMaCache(maCache);
    const sent = dispatchNotifications(candidates, now);
    if (krRan) maybeSendDailyDigest(manifest, maCache, now);

    recordLastRun('ok', `closeCheck 완료 · 발송 ${sent}`);
  } catch (err) {
    handleFailure('closeCheck', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 트리거: morningDigest — 정숙시간 보류분을 묶어 07시대에 발송
// ═══════════════════════════════════════════════════════════════════════════

function formatPendingBundle(pending: PendingEntry[]): string {
  const top3 = pending.slice(0, 3).map(p => p.summary).join(', ');
  const rest = pending.length - Math.min(3, pending.length);
  return clipText(`📋 [밤사이 보류분 ${pending.length}건] ${top3}${rest > 0 ? ` 외 ${rest}건` : ''}\n앱에서 전체 확인하세요`);
}

/**
 * P4 — "보유종목 터틀" 아침 요약(계획서 §4.5 "아침 요약 1번: 오늘 할 일 목록"). 발송이 아니라
 * 신선 재평가(멱등 무관)라 closeCheck에서 이미 개별 발송된 항목과 겹칠 수 있다 — 의도된 중복이다
 * (요약은 "오늘 할 일을 한눈에" 용도, 개별 알림은 "그때그때" 용도로 목적이 다르다).
 * 하루 1회만 보내도록 `LAST_TURTLE_DIGEST_DATE`로 가드한다(정숙시간 보류 묶음과는 별개 게이트).
 */
function buildTurtleMorningText(manifest: NotifyManifest, now: Date): string | null {
  if (!manifest.turtle) return null;
  const todayKst = kstDateStr(now);
  if (getProp('LAST_TURTLE_DIGEST_DATE') === todayKst) return null;
  const { sellNames, reentryNames, pyramidNames } = collectTurtleMorningSummary(manifest.turtle, now);
  return formatTurtleMorningDigest({ sellNames, reentryNames, pyramidNames });
}

function morningDigest(): void {
  const now = new Date();
  try {
    const pending = loadPending();
    const manifest = loadManifest();
    const turtleText = manifest ? buildTurtleMorningText(manifest, now) : null;

    if (pending.length === 0 && !turtleText) {
      recordLastRun('ok', 'morningDigest: 보낼 내용 없음(보류 메시지 없음 · 터틀 오늘 할 일 없음)');
      return;
    }

    // 각각 이미 200자 이내로 clip된 별개 메시지다 — 하나로 합쳐 재차 자르면 뒤쪽이 잘릴 수 있어
    // **두 통으로 나눠 보낸다**(계획서 §4.5 "200자 초과 시 분할").
    let sentAny = false;
    if (pending.length > 0) {
      if (sendKakaoMessage(formatPendingBundle(pending), buildDeepLink(null))) {
        clearPending();
        sentAny = true;
      }
    }
    if (turtleText) {
      if (sendKakaoMessage(turtleText, buildDeepLink(null))) {
        setProp('LAST_TURTLE_DIGEST_DATE', kstDateStr(now));
        sentAny = true;
      }
    }

    if (sentAny) {
      recordLastRun('ok', `morningDigest: 보류 ${pending.length}건 · 터틀 요약 ${turtleText ? '포함' : '없음'}`);
    } else {
      recordLastRun('error', 'morningDigest: 발송 실패(보류/터틀 요약 유지, 다음 실행에서 재시도)');
    }
  } catch (err) {
    handleFailure('morningDigest', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 트리거 설치 / 수동 테스트 발송
// ═══════════════════════════════════════════════════════════════════════════

function installTriggers(): void {
  const managed = new Set(['hourlyCheck', 'closeCheck', 'morningDigest']);
  for (const t of ScriptApp.getProjectTriggers()) {
    if (managed.has(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('hourlyCheck').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('closeCheck').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('morningDigest').timeBased().everyDays(1).atHour(7).create();
  recordLastRun('ok', '트리거 설치 완료(hourlyCheck·closeCheck 매시간, morningDigest 매일 07시대)');
}

function sendTestMessage(): void {
  const ok = sendKakaoMessage('[테스트] 매매계획 알림 스크립트 실행 확인 메시지입니다.', buildDeepLink(null));
  recordLastRun(ok ? 'ok' : 'error', ok ? '수동 테스트 발송 성공' : '수동 테스트 발송 실패(카카오 연결·토큰 확인)');
}

// ═══════════════════════════════════════════════════════════════════════════
// 웹앱 진입점: doGet(카카오 OAuth + 상태 페이지) / doPost(sync·test·status)
// ═══════════════════════════════════════════════════════════════════════════

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlPage(title: string, bodyHtml: string): GasHtmlOutput {
  return HtmlService.createHtmlOutput(
    `<html><body style="font-family:sans-serif;padding:24px;line-height:1.6"><h2>${escapeHtml(title)}</h2>${bodyHtml}</body></html>`,
  ).setTitle(title);
}

function handleKakaoAuthCode(code: string): GasHtmlOutput {
  const restKey = getProp('KAKAO_REST_KEY');
  if (!restKey) return htmlPage('설정 필요', '<p>스크립트 속성에 KAKAO_REST_KEY를 먼저 저장하세요.</p>');
  const redirectUri = ScriptApp.getService().getUrl();
  try {
    const res = UrlFetchApp.fetch(KAKAO_TOKEN_URL, {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: buildFormBody(withClientSecret({ grant_type: 'authorization_code', client_id: restKey, redirect_uri: redirectUri, code })),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      return htmlPage('연결 실패', `<p>카카오 토큰 교환 실패 (${res.getResponseCode()}): ${escapeHtml(res.getContentText())}</p>`);
    }
    const data = JSON.parse(res.getContentText()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!data.access_token || !data.refresh_token) {
      return htmlPage('연결 실패', '<p>토큰 응답에 access_token/refresh_token이 없습니다.</p>');
    }
    setProp('KAKAO_REFRESH_TOKEN', data.refresh_token);
    if (getProp('KAKAO_REFRESH_TOKEN') !== data.refresh_token) {
      return htmlPage('연결 실패', '<p>리프레시 토큰 저장 확인에 실패했습니다. 다시 시도하세요.</p>');
    }
    setProp('KAKAO_ACCESS_TOKEN', data.access_token);
    setProp('KAKAO_ACCESS_EXPIRES_AT', String(Date.now() + (data.expires_in ?? 21_600) * 1000));
    return htmlPage('연결됨', '<p>카카오톡 연결이 완료되었습니다. 이 창은 닫으셔도 됩니다.</p>');
  } catch (e) {
    return htmlPage('연결 실패', `<p>예외: ${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`);
  }
}

function statusPage(): GasHtmlOutput {
  const lastRun = getJsonProp<LastRun | null>('LAST_RUN_JSON', null);
  const connected = !!getProp('KAKAO_REFRESH_TOKEN');
  const body = `
    <p>카카오 연결: ${connected ? '연결됨' : '미연결'}</p>
    <p>마지막 실행: ${lastRun ? `${escapeHtml(lastRun.at)} — ${escapeHtml(lastRun.status)}: ${escapeHtml(lastRun.message)}` : '없음'}</p>
    <p>카카오 연결이 필요하면 <code>?action=kakao-auth</code>를 여세요.</p>
  `;
  return htmlPage('매매계획 알림 상태', body);
}

function doGet(e: GasDoGetEvent): GasTextOutput | GasHtmlOutput {
  const params = e && e.parameter ? e.parameter : {};
  // 카카오가 인가 코드를 붙여 돌아오는 리다이렉트는 redirect_uri(= 이 스크립트의 순수 /exec 주소, 아래
  // redirectUri와 동일)에 ?code=...만 붙인다 — ?action=kakao-auth는 우리가 처음 안내 링크에 붙인
  // 것일 뿐 카카오가 되돌려주는 요청에는 없다. action 체크보다 먼저 code 유무로 분기해야 한다.
  if (params.code) return handleKakaoAuthCode(params.code);
  if (params.action === 'kakao-auth') {
    const restKey = getProp('KAKAO_REST_KEY');
    if (!restKey) return htmlPage('설정 필요', '<p>스크립트 속성에 KAKAO_REST_KEY를 먼저 저장하세요.</p>');
    const redirectUri = ScriptApp.getService().getUrl();
    const authUrl = `${KAKAO_AUTHORIZE_URL}?client_id=${encodeURIComponent(restKey)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=talk_message`;
    return HtmlService.createHtmlOutput(
      `<html><body>카카오 로그인으로 이동합니다... <a href="${authUrl}" target="_top">여기를 눌러 계속</a><script>top.location.href=${JSON.stringify(authUrl)};</script></body></html>`,
    ).setTitle('카카오 연결');
  }
  return statusPage();
}

function jsonOutput(obj: unknown): GasTextOutput {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** 시간에 좌우되지 않는 비교이되, 이 스크립트 규모에서는 단순 XOR 누산으로 충분하다(짧은 길이 조기반환은 허용). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function buildStatusResponse(): unknown {
  const lastRun = getJsonProp<LastRun | null>('LAST_RUN_JSON', null);
  const manifest = loadManifest();
  return {
    ok: true,
    lastRun,
    dailyCount: getDailyCount(new Date()),
    kakaoConnected: !!getProp('KAKAO_REFRESH_TOKEN'),
    manifestItemCount: manifest ? manifest.items.length : 0,
    manifestUpdatedAt: manifest ? manifest.updatedAt : null,
  };
}

function doPost(e: GasDoPostEvent): GasTextOutput {
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    const body = raw
      ? (JSON.parse(raw) as { action?: string; secret?: string; manifest?: NotifyManifest })
      : {};
    const secret = getProp('SHARED_SECRET');
    if (!secret || !constantTimeEqual(body.secret ?? '', secret)) {
      return jsonOutput({ ok: false, error: 'secret 불일치' });
    }
    if (body.action === 'sync') {
      if (!body.manifest) return jsonOutput({ ok: false, error: 'manifest 없음' });
      saveManifest(body.manifest);
      return jsonOutput({ ok: true, receivedAt: new Date().toISOString(), itemCount: body.manifest.items.length });
    }
    if (body.action === 'test') {
      const ok = sendKakaoMessage('[테스트] 매매계획 알림 연결 확인 메시지입니다.', buildDeepLink(null));
      return jsonOutput({ ok });
    }
    if (body.action === 'status') {
      return jsonOutput(buildStatusResponse());
    }
    return jsonOutput({ ok: false, error: `알 수 없는 action: ${String(body.action)}` });
  } catch (err) {
    console.error('doPost 실패:', err);
    return jsonOutput({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 내보내기 — build-gas.mjs가 이 export들을 전역 `TradePlanNotify` 객체로 묶는다
// ═══════════════════════════════════════════════════════════════════════════

export { doGet, doPost, hourlyCheck, closeCheck, morningDigest, installTriggers, sendTestMessage };
